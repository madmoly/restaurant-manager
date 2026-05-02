/**
 * 대체휴무/연차 관리 라우터
 *
 * 핵심 로직:
 * - 5인 이상 사업장(over5Employees) 계약 직원이 공휴일에 근무하면 → 대체휴무 1일 자동 발생
 * - 연차: 근속 기간 기반 자동 산정 (1년 미만 월 1일, 1년 이상 15일 등)
 * - leaveTransactions 테이블에 earn/use 이력 기록
 * - employeeLeaves 테이블로 잔여일수 집계
 */
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { verifyStoreAccess } from "../middleware/storeAuth";
import { db } from "../db";
import {
  leaveTransactions,
  employeeLeaves,
  schedules,
  users,
  restaurantUsers,
} from "../../drizzle/schema";
import { getHolidayName, isHoliday, getHolidaysForYear } from "@shared/holidays";
import { getOver5ForEmployee } from "../helpers/labor";

export const leaveBalanceRouter = router({
  /**
   * 해당 월의 공휴일 근무 자동 감지
   * 스케줄 데이터에서 공휴일에 근무한 5인 이상 사업장 직원 목록 반환
   * + 이미 대체휴무 반영 여부 표시
   */
  detectHolidayWork: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      year: z.number(),
      month: z.number(),
    }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const { restaurantId, year, month } = input;
      // 해당 월의 공휴일 목록
      const holidays = getHolidaysForYear(year).filter((h) => {
        const m = parseInt(h.date.slice(5, 7));
        return m === month;
      });

      if (holidays.length === 0) return [];

      // 해당 월 시작/끝
      const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

      // 해당 월의 confirmed/completed 스케줄 조회 (userId가 있는 것만)
      const monthSchedules = await db.select({
        id: schedules.id,
        userId: schedules.userId,
        startTime: schedules.startTime,
        status: schedules.status,
      })
        .from(schedules)
        .where(and(
          eq(schedules.restaurantId, restaurantId),
          sql`${schedules.startTime} >= ${monthStart}`,
          sql`${schedules.startTime} < ${nextMonth}`,
          sql`${schedules.status} IN ('confirmed', 'completed', 'draft')`,
          sql`${schedules.userId} IS NOT NULL`,
        ));

      // 공휴일 근무 감지
      const results: Array<{
        holidayDate: string;
        holidayName: string;
        userId: number;
        userName: string;
        scheduleId: number;
        is5Plus: boolean;
        alreadyEarned: boolean;
      }> = [];

      // userId → userName 캐시
      const userNameCache: Record<number, string> = {};
      const is5PlusCache: Record<number, boolean> = {};

      for (const holiday of holidays) {
        // 이 공휴일에 근무한 스케줄 찾기
        const holidaySchedules = monthSchedules.filter((s) => {
          if (!s.startTime) return false;
          const d = new Date(s.startTime);
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          return dateStr === holiday.date;
        });

        for (const sched of holidaySchedules) {
          const uid = sched.userId!;

          // 5인 이상 체크 (캐시)
          if (is5PlusCache[uid] === undefined) {
            is5PlusCache[uid] = await check5PlusEmployee(uid, restaurantId);
          }
          if (!is5PlusCache[uid]) continue; // 5인 미만은 제외

          // 이름 캐시
          if (!userNameCache[uid]) {
            const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, uid)).limit(1);
            userNameCache[uid] = u?.name ?? `직원#${uid}`;
          }

          // 이미 반영 여부
          const [existing] = await db.select({ id: leaveTransactions.id })
            .from(leaveTransactions)
            .where(and(
              eq(leaveTransactions.userId, uid),
              eq(leaveTransactions.restaurantId, restaurantId),
              eq(leaveTransactions.holidayDate, holiday.date),
              eq(leaveTransactions.txType, "earn"),
            ))
            .limit(1);

          results.push({
            holidayDate: holiday.date,
            holidayName: holiday.name,
            userId: uid,
            userName: userNameCache[uid],
            scheduleId: sched.id,
            is5Plus: true,
            alreadyEarned: !!existing,
          });
        }
      }

      return results;
    }),

  /**
   * 대체휴무 반영 취소 (점장이 잘못 반영한 경우)
   */
  cancelEarnSubstitute: managerProcedure
    .input(z.object({
      userId: z.number(),
      restaurantId: z.number(),
      holidayDate: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      const [existing] = await db.select({ id: leaveTransactions.id })
        .from(leaveTransactions)
        .where(and(
          eq(leaveTransactions.userId, input.userId),
          eq(leaveTransactions.restaurantId, input.restaurantId),
          eq(leaveTransactions.holidayDate, input.holidayDate),
          eq(leaveTransactions.txType, "earn"),
          eq(leaveTransactions.leaveType, "substitute"),
        ))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "해당 대체휴무 기록이 없습니다" });
      }

      await db.delete(leaveTransactions).where(eq(leaveTransactions.id, existing.id));

      const year = parseInt(input.holidayDate.slice(0, 4));
      await syncLeaveBalance(input.userId, input.restaurantId, year, "substitute");

      return { ok: true };
    }),

  /**
   * 공휴일 근무 시 대체휴무 발생 등록
   * 점장이 인건비 정산에서 수동 반영
   */
  earnSubstitute: managerProcedure
    .input(z.object({
      userId: z.number(),
      restaurantId: z.number(),
      holidayDate: z.string(), // YYYY-MM-DD
      scheduleId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      const holidayName = getHolidayName(input.holidayDate);
      if (!holidayName) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${input.holidayDate}는 공휴일이 아닙니다` });
      }

      // 5인 이상 사업장 계약 확인
      const is5Plus = await check5PlusEmployee(input.userId, input.restaurantId);
      if (!is5Plus) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "5인 이상 사업장 계약 직원만 대체휴무가 발생합니다" });
      }

      // 중복 체크 (같은 공휴일에 이미 발생한 대체휴무)
      const year = parseInt(input.holidayDate.slice(0, 4));
      const [existing] = await db.select({ id: leaveTransactions.id })
        .from(leaveTransactions)
        .where(and(
          eq(leaveTransactions.userId, input.userId),
          eq(leaveTransactions.restaurantId, input.restaurantId),
          eq(leaveTransactions.holidayDate, input.holidayDate),
          eq(leaveTransactions.txType, "earn"),
        ))
        .limit(1);

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "이미 해당 공휴일에 대체휴무가 발생되었습니다" });
      }

      await db.insert(leaveTransactions).values({
        userId: input.userId,
        restaurantId: input.restaurantId,
        year,
        leaveType: "substitute",
        txType: "earn",
        days: "1",
        holidayDate: input.holidayDate,
        holidayName,
        scheduleId: input.scheduleId,
        createdBy: ctx.user.userId,
      } as any);

      // employeeLeaves 집계 업데이트
      await syncLeaveBalance(input.userId, input.restaurantId, year, "substitute");

      return { ok: true, holidayName };
    }),

  /**
   * 대체휴무/연차 소진 등록
   */
  useLeave: managerProcedure
    .input(z.object({
      userId: z.number(),
      restaurantId: z.number(),
      leaveType: z.enum(["annual", "substitute"]),
      useDate: z.string(), // YYYY-MM-DD
      days: z.number().min(0.5).max(1).default(1), // 0.5 = 반차
      note: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      const year = parseInt(input.useDate.slice(0, 4));

      // 잔여일수 확인
      const balance = await getLeaveBalance(input.userId, input.restaurantId, year, input.leaveType);
      if (balance.remaining < input.days) {
        const typeName = input.leaveType === "substitute" ? "대체휴무" : "연차";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${typeName} 잔여일수가 부족합니다 (잔여: ${balance.remaining}일)`,
        });
      }

      await db.insert(leaveTransactions).values({
        userId: input.userId,
        restaurantId: input.restaurantId,
        year,
        leaveType: input.leaveType,
        txType: "use",
        days: String(input.days),
        useDate: input.useDate,
        note: input.note,
        createdBy: ctx.user.userId,
      } as any);

      await syncLeaveBalance(input.userId, input.restaurantId, year, input.leaveType);

      return { ok: true };
    }),

  /**
   * 대체휴무 임의 조정 (점장 직접 편집)
   * - 공휴일/5인이상 검증 우회
   * - txType: earn(발생) | use(사용)
   * - 사용 시에는 잔여일수 검증
   */
  adjustSubstitute: managerProcedure
    .input(z.object({
      userId: z.number(),
      restaurantId: z.number(),
      txType: z.enum(["earn", "use"]),
      date: z.string(), // YYYY-MM-DD
      days: z.number().min(0.5).max(31),
      note: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      const year = parseInt(input.date.slice(0, 4));

      if (input.txType === "use") {
        const balance = await getLeaveBalance(input.userId, input.restaurantId, year, "substitute");
        if (balance.remaining < input.days) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `대체휴무 잔여일수가 부족합니다 (잔여: ${balance.remaining}일)`,
          });
        }
      }

      await db.insert(leaveTransactions).values({
        userId: input.userId,
        restaurantId: input.restaurantId,
        year,
        leaveType: "substitute",
        txType: input.txType,
        days: String(input.days),
        ...(input.txType === "earn"
          ? { holidayDate: input.date, holidayName: "수동 조정" }
          : { useDate: input.date }),
        note: input.note ?? "점장 임의 조정",
        createdBy: ctx.user.userId,
      } as any);

      await syncLeaveBalance(input.userId, input.restaurantId, year, "substitute");

      return { ok: true };
    }),

  /**
   * 대체휴무 이력 삭제 (점장 직접 편집 — 잘못 등록한 항목 정리)
   */
  deleteSubstituteTransaction: managerProcedure
    .input(z.object({
      transactionId: z.number(),
      restaurantId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      const [tx] = await db.select()
        .from(leaveTransactions)
        .where(and(
          eq(leaveTransactions.id, input.transactionId),
          eq(leaveTransactions.restaurantId, input.restaurantId),
          eq(leaveTransactions.leaveType, "substitute"),
        ))
        .limit(1);

      if (!tx) {
        throw new TRPCError({ code: "NOT_FOUND", message: "해당 이력을 찾을 수 없습니다" });
      }

      await db.delete(leaveTransactions).where(eq(leaveTransactions.id, input.transactionId));
      await syncLeaveBalance(tx.userId, tx.restaurantId, tx.year, "substitute");

      return { ok: true };
    }),

  /**
   * 매장 전체 직원의 대체휴무 이력 (점장 편집용)
   */
  storeSubstituteTransactions: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      year: z.number(),
    }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const txs = await db.select({
        id: leaveTransactions.id,
        userId: leaveTransactions.userId,
        userName: users.name,
        txType: leaveTransactions.txType,
        days: leaveTransactions.days,
        holidayDate: leaveTransactions.holidayDate,
        holidayName: leaveTransactions.holidayName,
        useDate: leaveTransactions.useDate,
        note: leaveTransactions.note,
        createdAt: leaveTransactions.createdAt,
      })
        .from(leaveTransactions)
        .innerJoin(users, eq(users.id, leaveTransactions.userId))
        .where(and(
          eq(leaveTransactions.restaurantId, input.restaurantId),
          eq(leaveTransactions.year, input.year),
          eq(leaveTransactions.leaveType, "substitute"),
        ))
        .orderBy(leaveTransactions.createdAt);

      return txs;
    }),

  /**
   * 특정 직원의 대체휴무/연차 잔여일수 조회
   */
  getBalance: protectedProcedure
    .input(z.object({
      userId: z.number(),
      restaurantId: z.number(),
      year: z.number(),
    }))
    .query(async ({ input }) => {
      const substitute = await getLeaveBalance(input.userId, input.restaurantId, input.year, "substitute");
      const annual = await getLeaveBalance(input.userId, input.restaurantId, input.year, "annual");

      return { substitute, annual };
    }),

  /**
   * 특정 직원의 대체휴무/연차 이력 목록
   */
  getTransactions: protectedProcedure
    .input(z.object({
      userId: z.number(),
      restaurantId: z.number(),
      year: z.number(),
    }))
    .query(async ({ input }) => {
      const txs = await db.select()
        .from(leaveTransactions)
        .where(and(
          eq(leaveTransactions.userId, input.userId),
          eq(leaveTransactions.restaurantId, input.restaurantId),
          eq(leaveTransactions.year, input.year),
        ))
        .orderBy(leaveTransactions.createdAt);

      return txs;
    }),

  /**
   * 매장 전체 직원의 대체휴무/연차 요약 (점장용)
   * - 5인 이상 직원: 자동 노출
   * - 5인 미만이라도 점장이 임의 편집한 이력이 있으면 노출
   */
  storeSummary: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      year: z.number(),
    }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      // 매장 소속 직원 목록
      const staffRows = await db.select({
        userId: restaurantUsers.userId,
        userName: users.name,
        storeRole: restaurantUsers.role,
      })
        .from(restaurantUsers)
        .innerJoin(users, eq(users.id, restaurantUsers.userId))
        .where(eq(restaurantUsers.restaurantId, input.restaurantId));

      // 대체휴무 이력이 있는 직원 ID (5인 미만 임의 편집 케이스 포함)
      const subTxRows = await db.select({ userId: leaveTransactions.userId })
        .from(leaveTransactions)
        .where(and(
          eq(leaveTransactions.restaurantId, input.restaurantId),
          eq(leaveTransactions.year, input.year),
          eq(leaveTransactions.leaveType, "substitute"),
        ));
      const hasSubTx = new Set(subTxRows.map((r) => r.userId));

      const results = [];
      for (const staff of staffRows) {
        const is5Plus = await check5PlusEmployee(staff.userId, input.restaurantId);
        if (!is5Plus && !hasSubTx.has(staff.userId)) continue;

        const sub = await getLeaveBalance(staff.userId, input.restaurantId, input.year, "substitute");
        const ann = await getLeaveBalance(staff.userId, input.restaurantId, input.year, "annual");

        results.push({
          userId: staff.userId,
          userName: staff.userName,
          storeRole: staff.storeRole,
          substitute: sub,
          annual: ann,
          is5Plus,
        });
      }

      return results;
    }),

  /**
   * 공휴일 근무 대체휴무 대상 확인 (스케줄 배정 시 사용)
   * 해당 날짜가 공휴일이고, 직원이 5인 이상 사업장 계약자인지
   */
  checkHolidayWork: protectedProcedure
    .input(z.object({
      userId: z.number(),
      restaurantId: z.number(),
      date: z.string(), // YYYY-MM-DD
    }))
    .query(async ({ input }) => {
      const holidayName = getHolidayName(input.date);
      if (!holidayName) return { isHoliday: false as const };

      const is5Plus = await check5PlusEmployee(input.userId, input.restaurantId);

      return {
        isHoliday: true as const,
        holidayName,
        generatesSubstitute: is5Plus,
        message: is5Plus
          ? `${holidayName} 근무 → 대체휴무 1일 발생`
          : `${holidayName} (5인 미만 사업장 → 대체휴무 미발생)`,
      };
    }),
});

// ─── 헬퍼 함수 ─────────────────────────────────────────────────────────────

/** 직원이 5인 이상 사업장 소속인지 확인 (재설계 2026-05-02: 소속회사 마스터 기준) */
async function check5PlusEmployee(userId: number, restaurantId: number): Promise<boolean> {
  return getOver5ForEmployee(restaurantId, userId);
}

/** 대체휴무/연차 잔여일수 계산 */
async function getLeaveBalance(
  userId: number,
  restaurantId: number,
  year: number,
  leaveType: "substitute" | "annual",
): Promise<{ earned: number; used: number; remaining: number }> {
  const [earnResult] = await db.select({
    total: sql<string>`COALESCE(SUM(days), 0)`,
  })
    .from(leaveTransactions)
    .where(and(
      eq(leaveTransactions.userId, userId),
      eq(leaveTransactions.restaurantId, restaurantId),
      eq(leaveTransactions.year, year),
      eq(leaveTransactions.leaveType, leaveType),
      eq(leaveTransactions.txType, "earn"),
    ));

  const [useResult] = await db.select({
    total: sql<string>`COALESCE(SUM(days), 0)`,
  })
    .from(leaveTransactions)
    .where(and(
      eq(leaveTransactions.userId, userId),
      eq(leaveTransactions.restaurantId, restaurantId),
      eq(leaveTransactions.year, year),
      eq(leaveTransactions.leaveType, leaveType),
      eq(leaveTransactions.txType, "use"),
    ));

  const earned = parseFloat(earnResult?.total ?? "0");
  const used = parseFloat(useResult?.total ?? "0");

  return { earned, used, remaining: earned - used };
}

/** employeeLeaves 테이블 동기화 (집계 캐시) */
async function syncLeaveBalance(
  userId: number,
  restaurantId: number,
  year: number,
  leaveType: "substitute" | "annual",
): Promise<void> {
  const balance = await getLeaveBalance(userId, restaurantId, year, leaveType);

  // upsert: 있으면 업데이트, 없으면 삽입
  const [existing] = await db.select({ id: employeeLeaves.id })
    .from(employeeLeaves)
    .where(and(
      eq(employeeLeaves.userId, userId),
      eq(employeeLeaves.restaurantId, restaurantId),
      eq(employeeLeaves.year, year),
      eq(employeeLeaves.leaveType, leaveType),
    ))
    .limit(1);

  if (existing) {
    await db.update(employeeLeaves)
      .set({
        totalDays: String(balance.earned),
        usedDays: String(balance.used),
      })
      .where(eq(employeeLeaves.id, existing.id));
  } else {
    await db.insert(employeeLeaves).values({
      userId,
      restaurantId,
      year,
      leaveType,
      totalDays: String(balance.earned),
      usedDays: String(balance.used),
    } as any);
  }
}
