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
import { db } from "../db";
import {
  leaveTransactions,
  employeeLeaves,
  employmentElectronicContracts,
  schedules,
  users,
  restaurantUsers,
} from "../../drizzle/schema";
import { getHolidayName, isHoliday } from "@shared/holidays";

export const leaveBalanceRouter = router({
  /**
   * 공휴일 근무 시 대체휴무 발생 등록
   * 점장/매니져가 스케줄 확정 시 호출하거나, 수동 등록
   */
  earnSubstitute: managerProcedure
    .input(z.object({
      userId: z.number(),
      restaurantId: z.number(),
      holidayDate: z.string(), // YYYY-MM-DD
      scheduleId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
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
   */
  storeSummary: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      year: z.number(),
    }))
    .query(async ({ input }) => {
      // 매장 소속 직원 목록
      const staffRows = await db.select({
        userId: restaurantUsers.userId,
        userName: users.name,
        storeRole: restaurantUsers.role,
      })
        .from(restaurantUsers)
        .innerJoin(users, eq(users.id, restaurantUsers.userId))
        .where(eq(restaurantUsers.restaurantId, input.restaurantId));

      const results = [];
      for (const staff of staffRows) {
        const is5Plus = await check5PlusEmployee(staff.userId, input.restaurantId);
        if (!is5Plus) continue; // 5인 미만 계약자 제외

        const sub = await getLeaveBalance(staff.userId, input.restaurantId, input.year, "substitute");
        const ann = await getLeaveBalance(staff.userId, input.restaurantId, input.year, "annual");

        results.push({
          userId: staff.userId,
          userName: staff.userName,
          storeRole: staff.storeRole,
          substitute: sub,
          annual: ann,
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

/** 직원이 5인 이상 사업장 계약인지 확인 */
async function check5PlusEmployee(userId: number, restaurantId: number): Promise<boolean> {
  // 유효한(signed) 계약에서 over5Employees 확인
  const [contract] = await db.select({
    over5Employees: employmentElectronicContracts.over5Employees,
  })
    .from(employmentElectronicContracts)
    .where(and(
      eq(employmentElectronicContracts.employeeId, userId),
      eq(employmentElectronicContracts.restaurantId, restaurantId),
      eq(employmentElectronicContracts.status, "signed"),
    ))
    .orderBy(sql`${employmentElectronicContracts.createdAt} DESC`)
    .limit(1);

  return !!contract?.over5Employees;
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
