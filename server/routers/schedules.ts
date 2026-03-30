import { z } from "zod";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, managerProcedure, ownerProcedure } from "../trpc";
import { db } from "../db";
import {
  schedules,
  users,
  restaurants,
  storeClosedDays,
  storeWeeklyClosures,
  restaurantUsers,
  employeeContracts,
  restaurantShiftPresets,
} from "../../drizzle/schema";
import { verifyStoreAccess } from "../middleware/storeAuth";

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

/** 동일 매장·날짜에 해당 직원(또는 임시직원)의 스케줄이 이미 있는지 검사 */
async function hasDuplicateSchedule(
  restaurantId: number,
  dateStr: string,
  opts: { userId?: number | null; tempWorkerName?: string | null; excludeId?: number }
): Promise<boolean> {
  const dayStart = new Date(`${dateStr}T00:00:00+09:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59+09:00`);

  const conditions = [
    eq(schedules.restaurantId, restaurantId),
    gte(schedules.startTime, dayStart),
    sql`${schedules.startTime} <= ${dayEnd}`,
    sql`${schedules.status} != 'canceled'`,
  ];

  if (opts.userId) {
    conditions.push(eq(schedules.userId, opts.userId));
  } else if (opts.tempWorkerName) {
    conditions.push(sql`${schedules.tempWorkerName} = ${opts.tempWorkerName}`);
  }

  if (opts.excludeId) {
    conditions.push(sql`${schedules.id} != ${opts.excludeId}`);
  }

  const [existing] = await db
    .select({ id: schedules.id })
    .from(schedules)
    .where(and(...conditions))
    .limit(1);
  return !!existing;
}

// ─── 스케줄 라우터 ──────────────────────────────────────────────────────────

export const schedulesRouter = router({
  /** 매장+기간별 스케줄 조회 */
  listByRestaurant: protectedProcedure
    .input(z.object({ restaurantId: z.number(), from: z.string(), to: z.string() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
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

  /** 스케줄 생성 (초안 상태) */
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
      if (await hasDuplicateSchedule(input.restaurantId, input.workDate, { userId: input.userId })) {
        throw new TRPCError({ code: "CONFLICT", message: "해당 직원은 이 날짜에 이미 스케줄이 등록되어 있습니다." });
      }
      const [result] = await db.insert(schedules).values({
        userId: input.userId,
        restaurantId: input.restaurantId,
        startTime: new Date(`${input.workDate}T${input.startTime}:00+09:00`),
        endTime: new Date(`${input.workDate}T${input.endTime}:00+09:00`),
        note: input.note,
        createdBy: ctx.user.userId,
        status: "draft",
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
      if (await hasDuplicateSchedule(input.restaurantId, input.workDate, { tempWorkerName: input.tempWorkerName })) {
        throw new TRPCError({ code: "CONFLICT", message: `임시직원 "${input.tempWorkerName}"은(는) 이 날짜에 이미 등록되어 있습니다.` });
      }
      const [result] = await db.insert(schedules).values({
        userId: null as any,
        tempWorkerName: input.tempWorkerName,
        tempWageType: input.wageType ?? null,
        tempWageAmount: input.wageAmount ? String(input.wageAmount) : null,
        restaurantId: input.restaurantId,
        startTime: new Date(`${input.workDate}T${input.startTime}:00+09:00`),
        endTime: new Date(`${input.workDate}T${input.endTime}:00+09:00`),
        status: "draft",
        note: input.note,
        createdBy: ctx.user.userId,
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
      if (await hasDuplicateSchedule(input.restaurantId, input.workDate, { userId: input.userId })) {
        throw new TRPCError({ code: "CONFLICT", message: "해당 직원은 이 날짜에 이미 스케줄이 등록되어 있습니다." });
      }
      // 매장별 커스텀 프리셋 조회 (우선) → 없으면 운영시간 기반 계산
      const presetKey = input.preset === "fullday" ? "full" : input.preset;
      const workDate = new Date(input.workDate + "T00:00:00+09:00");
      const dow = workDate.getDay(); // 0=일, 6=토
      const dayType = (dow === 0 || dow === 6) ? "weekend" : "weekday";

      const customPresets = await db.select()
        .from(restaurantShiftPresets)
        .where(and(
          eq(restaurantShiftPresets.restaurantId, input.restaurantId),
          eq(restaurantShiftPresets.presetType, presetKey),
          eq(restaurantShiftPresets.dayType, dayType),
        ))
        .limit(1);

      let p: { start: string; end: string };
      let breakMinutes: number;

      if (customPresets.length > 0) {
        // 커스텀 프리셋 사용
        p = { start: customPresets[0].startTime, end: customPresets[0].endTime };
        breakMinutes = customPresets[0].breakMinutes;
      } else {
        // 폴백: 매장 운영시간 기반 계산
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

        const fallbackPresets: Record<string, { start: string; end: string }> = {
          open: { start: openTime, end: midTime },
          fullday: { start: openTime, end: closeTime },
          close: { start: midTime, end: closeTime },
        };
        p = fallbackPresets[input.preset];
        breakMinutes = input.preset === "fullday" ? 60 : 0;
      }

      const [result] = await db.insert(schedules).values({
        userId: input.userId,
        restaurantId: input.restaurantId,
        startTime: new Date(`${input.workDate}T${p.start}:00+09:00`),
        endTime: new Date(`${input.workDate}T${p.end}:00+09:00`),
        breakMinutes,
        note: input.note,
        createdBy: ctx.user.userId,
        status: "draft",
        shiftPreset: input.preset === "fullday" ? "full" : input.preset,
      });
      return { id: (result as any).insertId };
    }),

  /** 스케줄 수정 — 상태별 정책 적용 */
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
          .enum(["draft", "completed", "confirmed", "canceled"])
          .optional(),
        shiftPreset: z.enum(["open", "full", "close", "custom"]).optional(),
        breakMinutes: z.number().min(0).max(240).optional(),
        note: z.string().optional(),
        editReason: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, workDate, startTime, endTime, editReason, ...rest } = input;

      // 현재 상태 조회 (정책 분기용)
      const [current] = await db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "스케줄을 찾을 수 없습니다." });

      // ── 상태별 수정 정책 ──
      if (current.status === "confirmed" || current.status === "completed") {
        if (!editReason || editReason.trim().length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: current.status === "confirmed"
              ? "확정된 스케줄 수정 시 사유를 입력해야 합니다."
              : "완료된 스케줄 수정 시 사유를 입력해야 합니다.",
          });
        }
      }

      const data: Record<string, unknown> = { ...rest };
      delete data.id;
      delete data.restaurantId;
      delete data.editReason;

      // 사유 및 정산 재확인 플래그 설정
      if (editReason) data.editReason = editReason.trim();
      if (current.status === "completed") data.payrollRecheckRequired = true;

      // 날짜 + 시간 조합 처리
      if (workDate && startTime) data.startTime = new Date(`${workDate}T${startTime}:00+09:00`);
      else if (startTime) data.startTime = new Date(startTime);
      if (workDate && endTime) data.endTime = new Date(`${workDate}T${endTime}:00+09:00`);
      else if (endTime) data.endTime = new Date(endTime);

      // 날짜만 변경 (시간 유지)
      if (workDate && !startTime && !endTime) {
        const oldStart = new Date(current.startTime);
        const oldEnd = new Date(current.endTime);
        const hStart = `${String(oldStart.getHours()).padStart(2, "0")}:${String(oldStart.getMinutes()).padStart(2, "0")}`;
        const hEnd = `${String(oldEnd.getHours()).padStart(2, "0")}:${String(oldEnd.getMinutes()).padStart(2, "0")}`;
        data.startTime = new Date(`${workDate}T${hStart}:00+09:00`);
        data.endTime = new Date(`${workDate}T${hEnd}:00+09:00`);
      }

      if (workDate) {
        if (await isClosedDay(input.restaurantId, workDate)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "해당 날짜는 휴무일입니다." });
        }
      }

      // 날짜 또는 직원이 변경되면 중복 체크
      if (workDate || input.userId) {
        const checkDate = workDate ?? toKSTDateString(new Date(current.startTime));
        const checkUserId = input.userId ?? current.userId;
        if (checkUserId) {
          if (await hasDuplicateSchedule(input.restaurantId, checkDate, { userId: checkUserId, excludeId: id })) {
            throw new TRPCError({ code: "CONFLICT", message: "해당 직원은 이 날짜에 이미 스케줄이 등록되어 있습니다." });
          }
        }
      }

      await db.update(schedules).set(data as any).where(eq(schedules.id, id));
      return { success: true, payrollRecheck: current.status === "completed" };
    }),

  /** 삭제 — 상태별 정책 적용 */
  delete: managerProcedure
    .input(z.object({ id: z.number(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      const [current] = await db.select().from(schedules).where(eq(schedules.id, input.id)).limit(1);
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "스케줄을 찾을 수 없습니다." });

      if (current.status === "draft") {
        // 초안: 바로 삭제
        await db.delete(schedules).where(eq(schedules.id, input.id));
        return { success: true, action: "deleted" as const };
      }

      // 확정/완료: 사유 필수, 실제 삭제 대신 canceled로 전환 (이력 보존)
      if (!input.reason || input.reason.trim().length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: current.status === "confirmed"
            ? "확정된 스케줄 삭제 시 사유를 입력해야 합니다."
            : "완료된 스케줄 삭제 시 사유를 입력해야 합니다.",
        });
      }

      const updateData: Record<string, unknown> = {
        status: "canceled",
        editReason: input.reason.trim(),
      };
      if (current.status === "completed") {
        updateData.payrollRecheckRequired = true;
      }

      await db.update(schedules).set(updateData as any).where(eq(schedules.id, input.id));
      return { success: true, action: "canceled" as const, payrollRecheck: current.status === "completed" };
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

      // 지난주 스케줄 조회 (canceled 제외, 모든 상태 포함)
      const prevSchedules = await db
        .select()
        .from(schedules)
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            gte(schedules.startTime, prevStart),
            sql`${schedules.startTime} <= ${prevEnd}`,
            sql`${schedules.status} != 'canceled'`
          )
        );

      const diff = 7 * 24 * 3600 * 1000;

      // 대상 주에 이미 존재하는 스케줄 조회 — 날짜 단위로 중복 판단
      const targetEnd = new Date(targetStart);
      targetEnd.setDate(targetEnd.getDate() + 6);
      targetEnd.setHours(23, 59, 59);
      const existingTargetWeek = await db
        .select({ startTime: schedules.startTime })
        .from(schedules)
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            gte(schedules.startTime, targetStart),
            sql`${schedules.startTime} <= ${targetEnd}`,
            sql`${schedules.status} != 'canceled'`
          )
        );
      // 이미 스케줄이 존재하는 날짜 Set
      const existingDates = new Set(
        existingTargetWeek.map((e) => toKSTDateString(new Date(e.startTime)))
      );

      const inserts = prevSchedules
        .map((s) => ({
          userId: s.userId,
          restaurantId: s.restaurantId,
          startTime: new Date(new Date(s.startTime).getTime() + diff),
          endTime: new Date(new Date(s.endTime).getTime() + diff),
          note: s.note,
          createdBy: ctx.user.userId,
          status: "draft" as const,
        }))
        .filter((s) => {
          // 해당 날짜에 이미 스케줄이 하나라도 있으면 건너뜀
          const dateKey = toKSTDateString(s.startTime);
          return !existingDates.has(dateKey);
        });

      if (inserts.length > 0) await db.insert(schedules).values(inserts);
      return { copied: inserts.length };
    }),

  /** 범위 확정 (draft → confirmed): 직원 공개 + 예상인건비 반영 */
  confirmRange: managerProcedure
    .input(z.object({ restaurantId: z.number(), from: z.string(), to: z.string() }))
    .mutation(async ({ input }) => {
      // KST 기준으로 범위 지정 (from은 YYYY-MM-DD, to는 YYYY-MM-DDT23:59:59 등)
      const fromStr = input.from.length === 10 ? input.from + "T00:00:00+09:00" : input.from + "+09:00";
      const toStr = input.to.includes("T") ? input.to.replace(/T.*/, "T23:59:59+09:00") : input.to + "T23:59:59+09:00";
      const fromDate = new Date(fromStr);
      const toDate = new Date(toStr);
      const result = await db
        .update(schedules)
        .set({ status: "confirmed", confirmedAt: new Date(), publishedAt: new Date() })
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            gte(schedules.startTime, fromDate),
            sql`${schedules.startTime} <= ${toDate}`,
            eq(schedules.status, "draft")
          )
        );
      return { success: true, affected: (result as any)[0]?.affectedRows ?? 0 };
    }),

  /** 날짜별 확정 (draft → confirmed) */
  confirmDay: managerProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .mutation(async ({ input }) => {
      const dayStart = new Date(input.date + "T00:00:00+09:00");
      const dayEnd = new Date(input.date + "T23:59:59+09:00");
      const result = await db
        .update(schedules)
        .set({ status: "confirmed", confirmedAt: new Date(), publishedAt: new Date() })
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            gte(schedules.startTime, dayStart),
            sql`${schedules.startTime} <= ${dayEnd}`,
            eq(schedules.status, "draft")
          )
        );
      return { success: true, affected: (result as any)[0]?.affectedRows ?? 0 };
    }),

  /** 범위 완료 (confirmed → completed): 일마감 확인 후 */
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
            eq(schedules.status, "confirmed")
          )
        );
      return { success: true };
    }),

  /** 특정일 스케줄 조회 (일마감 화면용) */
  getDaySchedules: managerProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      const dayStart = new Date(input.date + "T00:00:00+09:00");
      const dayEnd = new Date(input.date + "T23:59:59+09:00");
      return db
        .select({
          id: schedules.id,
          userId: schedules.userId,
          tempWorkerName: schedules.tempWorkerName,
          userName: users.name,
          startTime: schedules.startTime,
          endTime: schedules.endTime,
          status: schedules.status,
          shiftPreset: schedules.shiftPreset,
          note: schedules.note,
        })
        .from(schedules)
        .leftJoin(users, eq(schedules.userId, users.id))
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            gte(schedules.startTime, dayStart),
            sql`${schedules.startTime} <= ${dayEnd}`,
            sql`${schedules.status} != 'canceled'`
          )
        )
        .orderBy(schedules.startTime);
    }),

  /** 특정일 confirmed → completed (일마감 연동) */
  completeDay: managerProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .mutation(async ({ input }) => {
      const dayStart = new Date(input.date + "T00:00:00+09:00");
      const dayEnd = new Date(input.date + "T23:59:59+09:00");
      const result = await db
        .update(schedules)
        .set({ status: "completed", completedAt: new Date() })
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            gte(schedules.startTime, dayStart),
            sql`${schedules.startTime} <= ${dayEnd}`,
            eq(schedules.status, "confirmed")
          )
        );
      return { success: true, affected: (result as any)[0]?.affectedRows ?? 0 };
    }),

  /** 개별 스케줄 완료 처리 */
  completeOne: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const [existing] = await db.select({ status: schedules.status }).from(schedules).where(eq(schedules.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.status !== "confirmed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "확정 상태인 스케줄만 완료 처리할 수 있습니다." });
      }
      await db.update(schedules).set({ status: "completed", completedAt: new Date() }).where(eq(schedules.id, input.id));
      return { success: true };
    }),

  /** 향후 7일 (대시보드용) — 오늘 포함, draft/published/confirmed 모두 표시 */
  getUpcoming7Days: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      // 오늘 00:00부터 (이미 시작된 오늘 근무도 포함)
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const end = new Date(todayStart);
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
            gte(schedules.startTime, todayStart),
            sql`${schedules.startTime} <= ${end}`,
            sql`${schedules.status} IN ('draft', 'published', 'confirmed')`,
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

  /** 소속회사별 인건비 정산 조회 (점장 이상만) */
  laborCostByCompany: ownerProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input }) => {
      const monthStr = String(input.month).padStart(2, "0");
      const from = new Date(`${input.year}-${monthStr}-01T00:00:00`);
      const toDate = new Date(input.year, input.month, 1);

      // 완료/확정 스케줄 + 직원 정보 + 소속회사 + 시급 조인
      const rows = await db
        .select({
          userId: schedules.userId,
          userName: users.name,
          startTime: schedules.startTime,
          endTime: schedules.endTime,
          status: schedules.status,
          tempWorkerName: schedules.tempWorkerName,
          tempWageType: schedules.tempWageType,
          tempWageAmount: schedules.tempWageAmount,
          affiliatedCompany: restaurantUsers.affiliatedCompany,
          wageType: employeeContracts.wageType,
          wageAmount: employeeContracts.wageAmount,
          position: employeeContracts.position,
          contractStart: employeeContracts.contractStart,
          contractEnd: employeeContracts.contractEnd,
        })
        .from(schedules)
        .leftJoin(users, eq(schedules.userId, users.id))
        .leftJoin(restaurantUsers, and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, schedules.userId)
        ))
        .leftJoin(employeeContracts, and(
          eq(employeeContracts.userId, schedules.userId),
          eq(employeeContracts.restaurantId, input.restaurantId),
          eq(employeeContracts.isActive, true)
        ))
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            gte(schedules.startTime, from),
            sql`${schedules.startTime} < ${toDate}`,
            sql`${schedules.status} IN ('completed','confirmed')`
          )
        )
        .orderBy(schedules.startTime);

      // 소속회사별 그룹핑
      const companyMap: Record<string, {
        company: string;
        employees: Record<string, {
          name: string; totalHours: number; totalWage: number; shifts: number;
          wageType: string | null; wageAmount: string | null;
          position: string | null; contractStart: string | null; contractEnd: string | null;
        }>;
        totalHours: number;
        totalWage: number;
      }> = {};

      for (const r of rows) {
        const company = (r.affiliatedCompany ?? "미지정").trim() || "미지정";
        const name = r.userName ?? r.tempWorkerName ?? "미지정";
        const empKey = r.userId ? String(r.userId) : `temp_${name}`;

        if (!companyMap[company]) {
          companyMap[company] = { company, employees: {}, totalHours: 0, totalWage: 0 };
        }
        if (!companyMap[company].employees[empKey]) {
          companyMap[company].employees[empKey] = {
            name, totalHours: 0, totalWage: 0, shifts: 0,
            wageType: r.wageType ?? (r.tempWageType ?? null),
            wageAmount: r.wageAmount ?? (r.tempWageAmount ?? null),
            position: r.position ?? null,
            contractStart: r.contractStart ? String(r.contractStart) : null,
            contractEnd: r.contractEnd ? String(r.contractEnd) : null,
          };
        }

        const grossHours = (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 3600000;
        const breakHours = ((r as any).breakMinutes ?? 0) / 60;
        const hours = Math.max(0, grossHours - breakHours);
        let wage = 0;
        if (r.tempWageType === "hourly" && r.tempWageAmount) {
          wage = hours * Number(r.tempWageAmount);
        } else if (r.tempWageType === "daily" && r.tempWageAmount) {
          wage = Number(r.tempWageAmount);
        } else if (r.wageType === "hourly" && r.wageAmount) {
          wage = hours * Number(r.wageAmount);
        } else if (r.wageType === "monthly" && r.wageAmount) {
          // 월급제: 근무일수 비례 (간이 계산)
          wage = 0; // 월급은 별도 처리
        }

        companyMap[company].employees[empKey].totalHours += hours;
        companyMap[company].employees[empKey].totalWage += wage;
        companyMap[company].employees[empKey].shifts++;
        companyMap[company].totalHours += hours;
        companyMap[company].totalWage += wage;
      }

      return Object.values(companyMap).map(c => ({
        ...c,
        employees: Object.values(c.employees),
      }));
    }),
});
