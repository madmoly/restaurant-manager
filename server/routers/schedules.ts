import { z } from "zod";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import {
  schedules,
  users,
  restaurants,
  storeClosedDays,
  storeWeeklyClosures,
} from "../../drizzle/schema";

// ─── 헬퍼 함수 ──────────────────────────────────────────────────────────────

function toKSTDateString(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split("T")[0];
}

/** 해당 날짜가 휴무일인지 검사 (특정 휴무일 + 정기 휴무 요일) */
async function isClosedDay(restaurantId: number, dateStr: string): Promise<boolean> {
  // 특정 휴무일 확인
  const [closedDay] = await db
    .select()
    .from(storeClosedDays)
    .where(
      and(
        eq(storeClosedDays.restaurantId, restaurantId),
        sql`${storeClosedDays.closedDate} = ${dateStr}`
      )
    )
    .limit(1);
  if (closedDay) return true;

  // 정기 휴무 요일 확인
  const d = new Date(dateStr + "T00:00:00+09:00");
  const weekday = d.getDay(); // 0=일, 1=월, ...6=토
  const [closure] = await db
    .select()
    .from(storeWeeklyClosures)
    .where(
      and(
        eq(storeWeeklyClosures.restaurantId, restaurantId),
        eq(storeWeeklyClosures.weekday, weekday),
        eq(storeWeeklyClosures.isClosed, true)
      )
    )
    .limit(1);
  return !!closure;
}

// ─── 스케줄 라우터 ──────────────────────────────────────────────────────────

export const schedulesRouter = router({
  /** 매장+기간별 스케줄 조회 */
  listByRestaurant: protectedProcedure
    .input(z.object({ restaurantId: z.number(), from: z.string(), to: z.string() }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          id: schedules.id,
          userId: schedules.userId,
          tempWorkerName: schedules.tempWorkerName,
          tempWageType: schedules.tempWageType,
          tempWageAmount: schedules.tempWageAmount,
          userName: users.name,
          startTime: schedules.startTime,
          endTime: schedules.endTime,
          status: schedules.status,
          shiftPreset: schedules.shiftPreset,
          note: schedules.note,
          editReason: schedules.editReason,
          payrollRecheckRequired: schedules.payrollRecheckRequired,
        })
        .from(schedules)
        .leftJoin(users, eq(schedules.userId, users.id))
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            gte(schedules.startTime, new Date(input.from)),
            sql`${schedules.startTime} <= ${new Date(input.to)}`
          )
        )
        .orderBy(schedules.startTime);
      return rows;
    }),

  /** 내 스케줄 조회 */
  listByUser: protectedProcedure
    .input(z.object({ userId: z.number(), from: z.string(), to: z.string() }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          id: schedules.id,
          restaurantId: schedules.restaurantId,
          startTime: schedules.startTime,
          endTime: schedules.endTime,
          status: schedules.status,
          shiftPreset: schedules.shiftPreset,
          note: schedules.note,
        })
        .from(schedules)
        .where(
          and(
            eq(schedules.userId, input.userId),
            gte(schedules.startTime, new Date(input.from)),
            sql`${schedules.startTime} <= ${new Date(input.to)}`
          )
        )
        .orderBy(schedules.startTime);
      return rows;
    }),

  /** 스케줄 생성 (배정 시 published) */
  create: managerProcedure
    .input(
      z.object({
        userId: z.number(),
        restaurantId: z.number(),
        workDate: z.string(), // YYYY-MM-DD
        startTime: z.string(), // HH:MM
        endTime: z.string(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (await isClosedDay(input.restaurantId, input.workDate)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "해당 날짜는 휴무일입니다." });
      }
      const now = new Date();
      const [result] = await db.insert(schedules).values({
        userId: input.userId,
        restaurantId: input.restaurantId,
        startTime: new Date(`${input.workDate}T${input.startTime}:00+09:00`),
        endTime: new Date(`${input.workDate}T${input.endTime}:00+09:00`),
        note: input.note,
        createdBy: ctx.user.userId,
        status: "published",
        publishedAt: now,
      });
      return { id: (result as any).insertId };
    }),

  /** 임시/급구 근로자 스케줄 생성 */
  createTempWorker: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        tempWorkerName: z.string().min(1),
        workDate: z.string(),
        startTime: z.string(),
        endTime: z.string(),
        wageType: z.enum(["hourly", "daily"]).optional(),
        wageAmount: z.number().optional(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (await isClosedDay(input.restaurantId, input.workDate)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "해당 날짜는 휴무일입니다." });
      }
      const [result] = await db.insert(schedules).values({
        userId: null as any,
        tempWorkerName: input.tempWorkerName,
        tempWageType: input.wageType ?? null,
        tempWageAmount: input.wageAmount ? String(input.wageAmount) : null,
        restaurantId: input.restaurantId,
        startTime: new Date(`${input.workDate}T${input.startTime}:00+09:00`),
        endTime: new Date(`${input.workDate}T${input.endTime}:00+09:00`),
        status: "published",
        note: input.note,
        createdBy: ctx.user.userId,
        publishedAt: new Date(),
      } as any);
      return { id: (result as any).insertId };
    }),

  /** 빠른 할당 (프리셋: open/fullday/close) */
  quickAssign: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        userId: z.number(),
        workDate: z.string(),
        preset: z.enum(["open", "fullday", "close"]),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (await isClosedDay(input.restaurantId, input.workDate)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "해당 날짜는 휴무일입니다." });
      }
      // 매장 운영시간 조회
      const [rest] = await db
        .select({ openTime: restaurants.openTime, closeTime: restaurants.closeTime })
        .from(restaurants)
        .where(eq(restaurants.id, input.restaurantId))
        .limit(1);
      const openTime = rest?.openTime ?? "09:00";
      const closeTime = rest?.closeTime ?? "22:00";

      const [oh, om] = openTime.split(":").map(Number);
      const [ch, cm] = closeTime.split(":").map(Number);
      const midMins = Math.round((oh * 60 + om + ch * 60 + cm) / 2);
      const midTime = `${String(Math.floor(midMins / 60)).padStart(2, "0")}:${String(midMins % 60).padStart(2, "0")}`;

      const presets: Record<string, { start: string; end: string }> = {
        open: { start: openTime, end: midTime },
        fullday: { start: openTime, end: closeTime },
        close: { start: midTime, end: closeTime },
      };
      const p = presets[input.preset];

      const [result] = await db.insert(schedules).values({
        userId: input.userId,
        restaurantId: input.restaurantId,
        startTime: new Date(`${input.workDate}T${p.start}:00+09:00`),
        endTime: new Date(`${input.workDate}T${p.end}:00+09:00`),
        note: input.note,
        createdBy: ctx.user.userId,
        status: "published",
        shiftPreset: input.preset === "fullday" ? "full" : input.preset,
        publishedAt: new Date(),
      });
      return { id: (result as any).insertId };
    }),

  /** 스케줄 수정 */
  update: managerProcedure
    .input(
      z.object({
        id: z.number(),
        restaurantId: z.number(),
        workDate: z.string().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        userId: z.number().optional(),
        status: z
          .enum(["draft", "published", "completed", "confirmed", "canceled"])
          .optional(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, workDate, startTime, endTime, ...rest } = input;
      const data: Record<string, unknown> = { ...rest };
      delete data.id;
      delete data.restaurantId;

      // 날짜 + 시간 조합 처리
      if (workDate && startTime) data.startTime = new Date(`${workDate}T${startTime}:00+09:00`);
      else if (startTime) data.startTime = new Date(startTime);
      if (workDate && endTime) data.endTime = new Date(`${workDate}T${endTime}:00+09:00`);
      else if (endTime) data.endTime = new Date(endTime);

      // 날짜만 변경 (시간 유지)
      if (workDate && !startTime && !endTime) {
        const [existing] = await db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
        if (existing) {
          const oldStart = new Date(existing.startTime);
          const oldEnd = new Date(existing.endTime);
          const hStart = `${String(oldStart.getHours()).padStart(2, "0")}:${String(oldStart.getMinutes()).padStart(2, "0")}`;
          const hEnd = `${String(oldEnd.getHours()).padStart(2, "0")}:${String(oldEnd.getMinutes()).padStart(2, "0")}`;
          data.startTime = new Date(`${workDate}T${hStart}:00+09:00`);
          data.endTime = new Date(`${workDate}T${hEnd}:00+09:00`);
        }
      }

      if (workDate) {
        if (await isClosedDay(input.restaurantId, workDate)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "해당 날짜는 휴무일입니다." });
        }
      }

      await db.update(schedules).set(data as any).where(eq(schedules.id, id));
      return { success: true };
    }),

  /** 삭제 */
  delete: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(schedules).where(eq(schedules.id, input.id));
      return { success: true };
    }),

  /** 지난주 복사 */
  copyPreviousWeek: managerProcedure
    .input(z.object({ restaurantId: z.number(), targetWeekStart: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const targetStart = new Date(input.targetWeekStart);
      const prevStart = new Date(targetStart);
      prevStart.setDate(prevStart.getDate() - 7);
      const prevEnd = new Date(prevStart);
      prevEnd.setDate(prevEnd.getDate() + 6);
      prevEnd.setHours(23, 59, 59);

      const prevSchedules = await db
        .select()
        .from(schedules)
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            gte(schedules.startTime, prevStart),
            sql`${schedules.startTime} <= ${prevEnd}`,
            sql`${schedules.status} IN ('draft','published')`
          )
        );

      const diff = 7 * 24 * 3600 * 1000;
      const inserts = prevSchedules.map((s) => ({
        userId: s.userId,
        restaurantId: s.restaurantId,
        startTime: new Date(new Date(s.startTime).getTime() + diff),
        endTime: new Date(new Date(s.endTime).getTime() + diff),
        note: s.note,
        createdBy: ctx.user.userId,
        status: "draft" as const,
      }));

      if (inserts.length > 0) await db.insert(schedules).values(inserts);
      return { copied: inserts.length };
    }),

  /** 범위 고지 (draft → published) */
  publishRange: managerProcedure
    .input(z.object({ restaurantId: z.number(), from: z.string(), to: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .update(schedules)
        .set({ status: "published", publishedAt: new Date() })
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            gte(schedules.startTime, new Date(input.from)),
            sql`${schedules.startTime} <= ${new Date(input.to)}`,
            eq(schedules.status, "draft")
          )
        );
      return { success: true };
    }),

  /** 범위 완료 (published → completed) */
  completeRange: managerProcedure
    .input(z.object({ restaurantId: z.number(), from: z.string(), to: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .update(schedules)
        .set({ status: "completed", completedAt: new Date() })
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            gte(schedules.startTime, new Date(input.from)),
            sql`${schedules.startTime} <= ${new Date(input.to)}`,
            eq(schedules.status, "published")
          )
        );
      return { success: true };
    }),

  /** 범위 인건비 확정 (completed → confirmed) */
  confirmRange: managerProcedure
    .input(z.object({ restaurantId: z.number(), from: z.string(), to: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .update(schedules)
        .set({ status: "confirmed", confirmedAt: new Date() })
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            gte(schedules.startTime, new Date(input.from)),
            sql`${schedules.startTime} <= ${new Date(input.to)}`,
            eq(schedules.status, "completed")
          )
        );
      return { success: true };
    }),

  /** 당일 published → completed */
  completeToday: managerProcedure
    .input(z.object({ restaurantId: z.number() }))
    .mutation(async ({ input }) => {
      const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const todayStr = nowKST.toISOString().split("T")[0];
      const dayStart = new Date(todayStr + "T00:00:00");
      const dayEnd = new Date(todayStr + "T23:59:59");
      await db
        .update(schedules)
        .set({ status: "completed", completedAt: new Date() })
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            gte(schedules.startTime, dayStart),
            sql`${schedules.startTime} <= ${dayEnd}`,
            eq(schedules.status, "published")
          )
        );
      return { success: true };
    }),

  /** 향후 7일 (대시보드용) */
  getUpcoming7Days: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input }) => {
      const now = new Date();
      const end = new Date(now);
      end.setDate(end.getDate() + 7);
      return db
        .select({
          id: schedules.id,
          userId: schedules.userId,
          userName: users.name,
          startTime: schedules.startTime,
          endTime: schedules.endTime,
          status: schedules.status,
          note: schedules.note,
        })
        .from(schedules)
        .leftJoin(users, eq(schedules.userId, users.id))
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            gte(schedules.startTime, now),
            sql`${schedules.startTime} <= ${end}`,
            sql`${schedules.status} IN ('published','confirmed')`
          )
        )
        .orderBy(schedules.startTime);
    }),

  /** 과거 스케줄 월별 조회 (급여 정산용) */
  listPast: managerProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input }) => {
      const monthStr = String(input.month).padStart(2, "0");
      const from = new Date(`${input.year}-${monthStr}-01T00:00:00`);
      const toDate = new Date(input.year, input.month, 1);
      const rows = await db
        .select({
          id: schedules.id,
          userId: schedules.userId,
          tempWorkerName: schedules.tempWorkerName,
          tempWageType: schedules.tempWageType,
          tempWageAmount: schedules.tempWageAmount,
          userName: users.name,
          startTime: schedules.startTime,
          endTime: schedules.endTime,
          status: schedules.status,
          note: schedules.note,
          editReason: schedules.editReason,
          payrollRecheckRequired: schedules.payrollRecheckRequired,
          confirmedAt: schedules.confirmedAt,
          completedAt: schedules.completedAt,
        })
        .from(schedules)
        .leftJoin(users, eq(schedules.userId, users.id))
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            gte(schedules.startTime, from),
            sql`${schedules.startTime} < ${toDate}`,
            sql`${schedules.status} IN ('completed','confirmed')`
          )
        )
        .orderBy(schedules.startTime);
      return rows;
    }),
});
