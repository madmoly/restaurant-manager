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
  employeeWageHistory,
  restaurantShiftPresets,
  leaveTransactions,
  affiliatedCompanies,
  employmentElectronicContracts,
} from "../../drizzle/schema";
import { verifyStoreAccess } from "../middleware/storeAuth";
import { getHolidayName } from "@shared/holidays";
import {
  computeWageForShift,
  computeGuideWage,
  computeMonthlyOnlyWage,
  type WageType,
} from "../helpers/wage";
import {
  computeMonthlyStandardHours,
  groupHoursByWeek,
  computeWeeklyHolidayPay,
} from "../helpers/labor";
import { computeAnnualAccrual } from "../helpers/leave";

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
      // from/to는 KST 날짜 문자열 → KST 타임존으로 해석
      const fromKST = input.from.includes("T")
        ? new Date(input.from + (input.from.includes("+") ? "" : "+09:00"))
        : new Date(input.from + "T00:00:00+09:00");
      const toKST = input.to.includes("T")
        ? new Date(input.to + (input.to.includes("+") ? "" : "+09:00"))
        : new Date(input.to + "T23:59:59+09:00");
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
            gte(schedules.startTime, fromKST),
            sql`${schedules.startTime} <= ${toKST}`
          )
        )
        .orderBy(schedules.startTime);
      return rows;
    }),

  /** 내 스케줄 조회 */
  listByUser: protectedProcedure
    .input(z.object({ userId: z.number(), from: z.string(), to: z.string() }))
    .query(async ({ input, ctx }) => {
      // PR2: 본인 또는 admin/master만 타인 스케줄 조회 허용
      if (input.userId !== ctx.user.userId && ctx.user.role !== "admin" && ctx.user.role !== "master") {
        throw new TRPCError({ code: "FORBIDDEN", message: "본인 스케줄만 조회할 수 있습니다" });
      }
      const fromKST = input.from.includes("T")
        ? new Date(input.from + (input.from.includes("+") ? "" : "+09:00"))
        : new Date(input.from + "T00:00:00+09:00");
      const toKST = input.to.includes("T")
        ? new Date(input.to + (input.to.includes("+") ? "" : "+09:00"))
        : new Date(input.to + "T23:59:59+09:00");
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
            gte(schedules.startTime, fromKST),
            sql`${schedules.startTime} <= ${toKST}`
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
        breakMinutes: z.number().optional(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      if (await isClosedDay(input.restaurantId, input.workDate)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "해당 날짜는 휴무일입니다." });
      }
      // 퇴사자 스케줄 배정 방지
      const [ru] = await db.select({ resignedAt: restaurantUsers.resignedAt })
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId)
        )).limit(1);
      if (ru?.resignedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "퇴사한 직원에게는 스케줄을 배정할 수 없습니다." });
      }
      if (await hasDuplicateSchedule(input.restaurantId, input.workDate, { userId: input.userId })) {
        throw new TRPCError({ code: "CONFLICT", message: "해당 직원은 이 날짜에 이미 스케줄이 등록되어 있습니다." });
      }
      // breakMinutes 기본값: 명시적 입력 없으면 근무 6시간 이상 시 60분, 미만 시 0분
      const start = new Date(`${input.workDate}T${input.startTime}:00+09:00`);
      const end = new Date(`${input.workDate}T${input.endTime}:00+09:00`);
      const grossHours = (end.getTime() - start.getTime()) / 3600000;
      const breakMin = input.breakMinutes ?? (grossHours >= 6 ? 60 : 0);

      const [result] = await db.insert(schedules).values({
        userId: input.userId,
        restaurantId: input.restaurantId,
        startTime: start,
        endTime: end,
        breakMinutes: breakMin,
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
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
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
        preset: z.string().min(1),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
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
          eq(restaurantShiftPresets.isActive, true),
        ))
        .limit(1);

      let p: { start: string; end: string };
      let breakMinutes: number;

      if (customPresets.length > 0) {
        // 커스텀 프리셋 사용
        p = { start: customPresets[0].startTime, end: customPresets[0].endTime };
        breakMinutes = customPresets[0].breakMinutes;
      } else {
        // 폴백: 매장 운영시간 기반 계산 (기본 3종만)
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
          full: { start: openTime, end: closeTime },
          close: { start: midTime, end: closeTime },
        };
        const fallback = fallbackPresets[presetKey];
        if (!fallback) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `프리셋 "${input.preset}"에 대한 시간 설정이 없습니다. 매장 설정에서 해당 근무유형의 시간을 먼저 설정해주세요.` });
        }
        p = fallback;
        breakMinutes = presetKey === "full" ? 60 : 0;
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
        shiftPreset: presetKey,
      });
      return { id: (result as any).insertId };
    }),

  /** 다중 직원 일괄 빠른 배정 */
  batchQuickAssign: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        userIds: z.array(z.number()).min(1).max(30),
        workDate: z.string(),
        preset: z.string().min(1),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      if (await isClosedDay(input.restaurantId, input.workDate)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "해당 날짜는 휴무일입니다." });
      }

      // 프리셋 시간 계산 (전원 동일하므로 1회만)
      const presetKey = input.preset === "fullday" ? "full" : input.preset;
      const workDate = new Date(input.workDate + "T00:00:00+09:00");
      const dow = workDate.getDay();
      const dayType = (dow === 0 || dow === 6) ? "weekend" : "weekday";

      const customPresets = await db.select()
        .from(restaurantShiftPresets)
        .where(and(
          eq(restaurantShiftPresets.restaurantId, input.restaurantId),
          eq(restaurantShiftPresets.presetType, presetKey),
          eq(restaurantShiftPresets.dayType, dayType),
          eq(restaurantShiftPresets.isActive, true),
        ))
        .limit(1);

      let p: { start: string; end: string };
      let breakMinutes: number;

      if (customPresets.length > 0) {
        p = { start: customPresets[0].startTime, end: customPresets[0].endTime };
        breakMinutes = customPresets[0].breakMinutes;
      } else {
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
          full: { start: openTime, end: closeTime },
          close: { start: midTime, end: closeTime },
        };
        const fallback = fallbackPresets[presetKey];
        if (!fallback) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `프리셋 "${input.preset}"에 대한 시간 설정이 없습니다.` });
        }
        p = fallback;
        breakMinutes = presetKey === "full" ? 60 : 0;
      }

      // 각 직원별 중복 체크 + INSERT
      const results: { userId: number; id: number }[] = [];
      const skipped: { userId: number; reason: string }[] = [];

      for (const userId of input.userIds) {
        if (await hasDuplicateSchedule(input.restaurantId, input.workDate, { userId })) {
          skipped.push({ userId, reason: "이미 배정됨" });
          continue;
        }
        const [result] = await db.insert(schedules).values({
          userId,
          restaurantId: input.restaurantId,
          startTime: new Date(`${input.workDate}T${p.start}:00+09:00`),
          endTime: new Date(`${input.workDate}T${p.end}:00+09:00`),
          breakMinutes,
          note: input.note,
          createdBy: ctx.user.userId,
          status: "draft",
          shiftPreset: presetKey,
        });
        results.push({ userId, id: (result as any).insertId });
      }

      return { created: results, skipped };
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
        shiftPreset: z.string().max(30).optional(),
        breakMinutes: z.number().min(0).max(240).optional(),
        note: z.string().optional(),
        editReason: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      const { id, workDate, startTime, endTime, editReason, ...rest } = input;

      // 현재 상태 조회 (정책 분기용)
      const [current] = await db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "스케줄을 찾을 수 없습니다." });
      // 레코드의 restaurantId와 input.restaurantId 일치 검증 (cross-store id 위조 차단)
      if (current.restaurantId !== input.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "스케줄을 찾을 수 없습니다." });
      }

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
    .mutation(async ({ input, ctx }) => {
      const [current] = await db.select().from(schedules).where(eq(schedules.id, input.id)).limit(1);
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "스케줄을 찾을 수 없습니다." });
      // PR2: id-only fetch → restaurantId 기반 매장 검증
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, current.restaurantId, true);

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
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
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

      // 퇴사자 userId 목록 조회 — 복사 대상에서 제외
      const resignedRows = await db.select({ userId: restaurantUsers.userId })
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          sql`${restaurantUsers.resignedAt} IS NOT NULL`
        ));
      const resignedUserIds = new Set(resignedRows.map(r => r.userId));

      const inserts = prevSchedules
        .filter((s) => {
          // 퇴사자 스케줄 제외 (임시근로자는 userId가 null이므로 통과)
          if (s.userId && resignedUserIds.has(s.userId)) return false;
          return true;
        })
        .map((s) => ({
          userId: s.userId,
          restaurantId: s.restaurantId,
          startTime: new Date(new Date(s.startTime).getTime() + diff),
          endTime: new Date(new Date(s.endTime).getTime() + diff),
          shiftPreset: s.shiftPreset,
          breakMinutes: s.breakMinutes ?? 0,
          tempWorkerName: s.tempWorkerName,
          tempWageType: s.tempWageType,
          tempWageAmount: s.tempWageAmount,
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
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
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
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
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
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
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
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
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
          systemRole: users.role,
          storeRole: restaurantUsers.role,
        })
        .from(schedules)
        .leftJoin(users, eq(schedules.userId, users.id))
        .leftJoin(restaurantUsers, and(
          eq(restaurantUsers.userId, schedules.userId),
          eq(restaurantUsers.restaurantId, schedules.restaurantId),
        ))
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
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
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
    .mutation(async ({ input, ctx }) => {
      const [existing] = await db.select({ status: schedules.status, restaurantId: schedules.restaurantId }).from(schedules).where(eq(schedules.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      // PR2: id-only fetch → restaurantId 기반 매장 검증
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, existing.restaurantId, true);
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
      // KST 기준 오늘 (새벽 3시 이전이면 전날로 취급)
      const now = new Date();
      const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      // 3시간 빼서 영업일 기준 날짜 계산 (0~2시 → 전날)
      const bizKst = new Date(kstNow.getTime() - 3 * 60 * 60 * 1000);
      const kstDateStr = bizKst.toISOString().slice(0, 10);
      const todayStart = new Date(`${kstDateStr}T00:00:00+09:00`);
      const end = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000);
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
            sql`${schedules.status} IN ('draft', 'published', 'confirmed', 'completed')`,
          )
        )
        .orderBy(schedules.startTime);
    }),

  /** 과거 스케줄 월별 조회 (급여 정산용) */
  listPast: managerProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const monthStr = String(input.month).padStart(2, "0");
      const kstFrom = new Date(`${input.year}-${monthStr}-01T00:00:00+09:00`);
      const nm = input.month === 12 ? 1 : input.month + 1;
      const ny = input.month === 12 ? input.year + 1 : input.year;
      const kstTo = new Date(`${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+09:00`);
      const fromStr = kstFrom.toISOString().slice(0, 19).replace("T", " ");
      const toStr = kstTo.toISOString().slice(0, 19).replace("T", " ");

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
            sql`${schedules.startTime} >= ${fromStr}`,
            sql`${schedules.startTime} < ${toStr}`,
            sql`${schedules.status} IN ('draft','confirmed','completed','scheduled','published')`
          )
        )
        .orderBy(schedules.startTime);
      return rows;
    }),

  /** 소속회사별 인건비 정산 조회 (점장 이상만) */
  laborCostByCompany: ownerProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      // 매장 접근권 검증
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);

      const monthStr = String(input.month).padStart(2, "0");
      // KST 기준 월 범위를 UTC 문자열로 변환
      // KST 00:00 = UTC 전날 15:00 (9시간 차이)
      // JS Date → toISOString()으로 UTC 문자열 생성 후 MySQL 포맷으로 변환
      const kstFrom = new Date(`${input.year}-${monthStr}-01T00:00:00+09:00`);
      const nm = input.month === 12 ? 1 : input.month + 1;
      const ny = input.month === 12 ? input.year + 1 : input.year;
      const kstTo = new Date(`${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+09:00`);
      // MySQL DATETIME 형식 UTC 문자열
      const fromStr = kstFrom.toISOString().slice(0, 19).replace("T", " ");
      const toStr = kstTo.toISOString().slice(0, 19).replace("T", " ");

      // 전체 스케줄 + 직원 정보 + 소속회사 + 시급 조인
      // Phase E (2026-05-02): 운영 데이터(taxMode, weeklyHours, hourlyWageIncludesHolidayPay,
      //   position, contractStart, contractEnd) 출처를 restaurant_users로 변경.
      //   employee_contracts JOIN 제거 (테이블 폐기됨).
      //   wage는 wage_history 그대로.
      const rows = await db
        .select({
          scheduleId: schedules.id,
          userId: schedules.userId,
          userName: users.name,
          startTime: schedules.startTime,
          endTime: schedules.endTime,
          breakMinutes: schedules.breakMinutes,
          status: schedules.status,
          tempWorkerName: schedules.tempWorkerName,
          tempWageType: schedules.tempWageType,
          tempWageAmount: schedules.tempWageAmount,
          tempBankAccount: schedules.tempBankAccount,
          tempPhone: schedules.tempPhone,
          affiliatedCompany: restaurantUsers.affiliatedCompany,
          hireDate: restaurantUsers.hireDate,
          weeklyOffDays: restaurantUsers.weeklyOffDays,
          contractOffDays: restaurantUsers.contractOffDays,
          // Phase E: 운영 SSOT
          position: restaurantUsers.position,
          contractStart: restaurantUsers.contractStart,
          contractEnd: restaurantUsers.contractEnd,
          weeklyHours: restaurantUsers.weeklyHours,
          taxMode: restaurantUsers.taxMode,
          hourlyWageIncludesHolidayPay: restaurantUsers.hourlyWageIncludesHolidayPay,
          // 임금 (wage_history 시점별)
          wageType: employeeWageHistory.wageType,
          wageAmount: employeeWageHistory.wageAmount,
          payrollRecheckRequired: schedules.payrollRecheckRequired,
        })
        .from(schedules)
        .leftJoin(users, eq(schedules.userId, users.id))
        .leftJoin(restaurantUsers, and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, schedules.userId)
        ))
        .leftJoin(employeeWageHistory, and(
          eq(employeeWageHistory.userId, schedules.userId),
          eq(employeeWageHistory.restaurantId, input.restaurantId),
          sql`DATE_FORMAT(CONVERT_TZ(${schedules.startTime}, '+00:00', '+09:00'), '%Y-%m-01') >= ${employeeWageHistory.effectiveFrom}`,
          sql`(${employeeWageHistory.effectiveTo} IS NULL OR DATE_FORMAT(CONVERT_TZ(${schedules.startTime}, '+00:00', '+09:00'), '%Y-%m-01') < ${employeeWageHistory.effectiveTo})`,
        ))
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            sql`${schedules.startTime} >= ${fromStr}`,
            sql`${schedules.startTime} < ${toStr}`,
            sql`${schedules.status} = 'completed'`
          )
        )
        .orderBy(schedules.startTime);

      // 재설계 2026-05-02: noWeeklyHolidayPay 폐기. 시급제 + 주휴별도(hourlyWageIncludesHolidayPay=false)는
      // 별도 카드 분리하지 않고 같은 카드에서 주별 가산 라인으로 처리.

      // 매장의 affiliated_companies 마스터 → 회사명별 5인 여부
      const acRows = await db
        .select({
          companyName: affiliatedCompanies.companyName,
          over5Employees: affiliatedCompanies.over5Employees,
        })
        .from(affiliatedCompanies)
        .where(eq(affiliatedCompanies.restaurantId, input.restaurantId));
      const over5ByCompany = new Map<string, boolean>();
      for (const c of acRows) over5ByCompany.set(c.companyName, Boolean(c.over5Employees));

      // 박제 계약서 batch fetch (2026-05-02 노무사전송 누락 보완):
      //   restaurant_users.position이 NULL인 직원의 직위 / 직원 신원(주민·계좌)을 박제 계약서에서 채움.
      //   매칭: restaurantId + employeeId + [서명 이력 전체]. superseded(서명으로 대체)뿐 아니라
      //   expired+signedAt(갱신 계약 "발급" 시점에 expired로 밀려난 직전 서명본)도 포함해야
      //   과거 정산월의 계약기간 커버가 소급 소실되지 않음(2026-07-03 6월 계약미연결 오탐).
      //   미서명 만료본(draft/sent→expired, signedAt NULL)은 제외.
      //   snapshot* 컬럼 우선 (서명 시점 박제), NULL이면 본 컬럼 fallback (Phase E 박제 전 서명분).
      // 정산월 활성 계약 (2026-05-03):
      //   카드에 "현재 활성 계약"이 아닌 "정산월에 활성이었던 계약"을 노출. 진재이 사례 대응.
      //   범위: contractStart ≤ monthEnd AND (contractEnd IS NULL OR contractEnd ≥ monthStart)
      //   정산월 활성 계약 없으면 가장 최근 종료 계약을 fallback + monthlyContractMissing=true.
      const empIds = [...new Set(rows.map(r => r.userId).filter((v): v is number => Boolean(v)))];
      const contractMap = new Map<number, {
        position: string | null;
        bankName: string | null;
        bankAccount: string | null;
        residentNumber: string | null;
      }>();
      // 정산월 (KST) 범위 — 문자열 비교 (DATE 타입과 매칭)
      const monthStartStr = `${input.year}-${monthStr}-01`;
      const monthEndStr = `${ny}-${String(nm).padStart(2, "0")}-01`; // 다음 달 1일 (exclusive)
      type ContractRecord = { contractStart: string; contractEnd: string | null; signedAt: string | null };
      const monthlyContractMap = new Map<number, { record: ContractRecord; missing: boolean }>();
      const historyMap = new Map<number, ContractRecord[]>();
      if (empIds.length > 0) {
        const ecRows = await db
          .select({
            employeeId: employmentElectronicContracts.employeeId,
            position: employmentElectronicContracts.position,
            snapshotPosition: employmentElectronicContracts.snapshotPosition,
            bankName: employmentElectronicContracts.bankName,
            snapshotBankName: employmentElectronicContracts.snapshotBankName,
            employeeBankAccount: employmentElectronicContracts.employeeBankAccount,
            snapshotBankAccount: employmentElectronicContracts.snapshotBankAccount,
            employeeResidentNumber: employmentElectronicContracts.employeeResidentNumber,
            snapshotResidentNumber: employmentElectronicContracts.snapshotResidentNumber,
            contractStart: employmentElectronicContracts.contractStart,
            contractEnd: employmentElectronicContracts.contractEnd,
            snapshotContractStart: employmentElectronicContracts.snapshotContractStart,
            snapshotContractEnd: employmentElectronicContracts.snapshotContractEnd,
            signedAt: employmentElectronicContracts.signedAt,
            status: employmentElectronicContracts.status,
          })
          .from(employmentElectronicContracts)
          .where(and(
            eq(employmentElectronicContracts.restaurantId, input.restaurantId),
            sql`(${employmentElectronicContracts.status} IN ('signed', 'superseded') OR (${employmentElectronicContracts.status} = 'expired' AND ${employmentElectronicContracts.signedAt} IS NOT NULL))`,
            sql`${employmentElectronicContracts.employeeId} IN (${sql.join(empIds.map(id => sql`${id}`), sql`, `)})`,
          ))
          .orderBy(desc(employmentElectronicContracts.signedAt));
        for (const c of ecRows) {
          if (!c.employeeId) continue;
          // 노무사전송 누락 보완용 fallback 맵: 가장 최근 signedAt 1건만
          if (!contractMap.has(c.employeeId)) {
            contractMap.set(c.employeeId, {
              position: c.snapshotPosition ?? c.position ?? null,
              bankName: c.snapshotBankName ?? c.bankName ?? null,
              bankAccount: c.snapshotBankAccount ?? c.employeeBankAccount ?? null,
              residentNumber: c.snapshotResidentNumber ?? c.employeeResidentNumber ?? null,
            });
          }
          // 계약기간 박제 우선 (snapshot*), 없으면 본 컬럼
          const cs = c.snapshotContractStart ?? c.contractStart;
          if (!cs) continue;
          const csStr = String(cs);
          const ce = c.snapshotContractEnd ?? c.contractEnd;
          const ceStr = ce ? String(ce) : null;
          const record: ContractRecord = {
            contractStart: csStr,
            contractEnd: ceStr,
            signedAt: c.signedAt ? new Date(c.signedAt).toISOString() : null,
          };
          // 이력 누적 (signedAt desc 순, 동일 토큰 중복 가능성 매우 낮으므로 단순 push)
          const list = historyMap.get(c.employeeId) ?? [];
          list.push(record);
          historyMap.set(c.employeeId, list);
        }
        // 정산월 활성 계약 선택. monthEndStr는 다음달 1일(exclusive).
        for (const [empId, list] of historyMap.entries()) {
          // 1) 정산월에 활성 계약: signedAt desc 중 첫 번째 적합 (활성이 여러 건이면 가장 최근 서명이 사실상 유효)
          const active = list.find(r =>
            r.contractStart < monthEndStr &&
            (r.contractEnd === null || r.contractEnd >= monthStartStr)
          );
          if (active) {
            monthlyContractMap.set(empId, { record: active, missing: false });
            continue;
          }
          // 2) 정산월 이전에 가장 늦게 종료된 계약 (contractEnd desc 정렬)
          const past = list
            .filter(r => r.contractEnd !== null && r.contractEnd < monthStartStr)
            .sort((a, b) => (b.contractEnd ?? "").localeCompare(a.contractEnd ?? ""))[0];
          if (past) {
            monthlyContractMap.set(empId, { record: past, missing: true });
            continue;
          }
          // 3) 정산월 이후에 가장 먼저 시작될 계약 (contractStart asc 정렬)
          const future = list
            .filter(r => r.contractStart >= monthEndStr)
            .sort((a, b) => a.contractStart.localeCompare(b.contractStart))[0];
          if (future) {
            monthlyContractMap.set(empId, { record: future, missing: true });
          }
        }
      }

      console.log(`[laborCost] rows found: ${rows.length}, contracts mapped: ${contractMap.size}, monthly active: ${[...monthlyContractMap.values()].filter(v => !v.missing).length}/${monthlyContractMap.size}`);

      // ── 영업일수 계산 ──
      // 1) 정기 휴무 요일 조회
      const weeklyClosureRows = await db.select()
        .from(storeWeeklyClosures)
        .where(and(
          eq(storeWeeklyClosures.restaurantId, input.restaurantId),
          eq(storeWeeklyClosures.isClosed, true),
        ));
      const closedWeekdays = new Set(weeklyClosureRows.map(r => r.weekday)); // 0=일,1=월,...6=토

      // 2) 특정 휴무일 조회
      const closedDayRows = await db.select()
        .from(storeClosedDays)
        .where(and(
          eq(storeClosedDays.restaurantId, input.restaurantId),
          sql`${storeClosedDays.closedDate} >= ${`${input.year}-${monthStr}-01`}`,
          sql`${storeClosedDays.closedDate} < ${`${ny}-${String(nm).padStart(2, "0")}-01`}`,
        ));
      const closedDateSet = new Set(closedDayRows.map(r => String(r.closedDate)));

      // 3) 월 내 영업일수 계산
      const daysInMonth = new Date(input.year, input.month, 0).getDate();
      let operatingDays = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(input.year, input.month - 1, d);
        const jsDay = dt.getDay(); // 0=일,...6=토
        const dateStr = `${input.year}-${monthStr}-${String(d).padStart(2, "0")}`;
        if (closedWeekdays.has(jsDay) || closedDateSet.has(dateStr)) continue;
        operatingDays++;
      }

      // ── 계약휴무: contractOffDays(월 SSOT) 직접 사용 (2026-07-02: 주당×주수 곱셈 제거) ──

      // 소속회사별 그룹핑
      const companyMap: Record<string, {
        company: string;
        operatingDays: number;
        employees: Record<string, {
          name: string; totalHours: number; totalWage: number; shifts: number;
          wageType: string | null; wageAmount: string | null;
          weeklyHours: string | null;
          position: string | null; contractStart: string | null; contractEnd: string | null;
          daysOff: number; contractDaysOff: number;
          hireDate: string | null;
          userId: number | null;
          recheckRequired: boolean;
          bankName: string | null;
          bankAccount: string | null;
          residentNumber: string | null;
          phone: string | null;
          over5Employees: boolean;
          // 재설계 2026-05-02: 시급제 + 주휴별도(hourlyWageIncludesHolidayPay=false) 직원의 주별 시간 누적
          hourlyWageIncludesHolidayPay: boolean;
          taxMode: string | null;
          // 시급제 + 주휴별도 가산 합계 (월말 일괄 계산 후 wageBreakdown.weeklyHoliday로 노출)
          weeklyHolidayBonus: number;
          dateSet: Set<string>;
          shiftsForWeek: Array<{ startDate: string; hours: number }>;
        }>;
        totalHours: number;
        totalWage: number;
      }> = {};

      for (const r of rows) {
        const company = (r.affiliatedCompany ?? "미지정").trim() || "미지정";
        const name = r.userName ?? r.tempWorkerName ?? "미지정";
        // 재설계 2026-05-02: treatAsTemp(noWeeklyHolidayPay 분리) 폐기. 정규직은 항상 같은 카드.
        const empKey = !r.userId ? `temp_${name}` : String(r.userId);
        const over5 = over5ByCompany.get(company) ?? false;

        if (!companyMap[company]) {
          companyMap[company] = { company, operatingDays, employees: {}, totalHours: 0, totalWage: 0 };
        }
        if (!companyMap[company].employees[empKey]) {
          const uid = r.userId ? Number(r.userId) : null;
          // 박제 계약서 fallback (정규 직원만, 임시근로자는 schedule.tempBankAccount/tempPhone)
          const ec = uid ? contractMap.get(uid) ?? null : null;
          companyMap[company].employees[empKey] = {
            name, totalHours: 0, totalWage: 0, shifts: 0,
            wageType: r.wageType ?? (r.tempWageType ?? null),
            wageAmount: r.wageAmount ?? (r.tempWageAmount ?? null),
            weeklyHours: r.weeklyHours != null ? String(r.weeklyHours) : null,
            position: r.position ?? ec?.position ?? null,
            contractStart: r.contractStart ? String(r.contractStart) : null,
            contractEnd: r.contractEnd ? String(r.contractEnd) : null,
            daysOff: 0, // 아래에서 최종 계산
            contractDaysOff: r.contractOffDays ?? 4,
            hireDate: r.hireDate ? String(r.hireDate) : null,
            userId: uid,
            recheckRequired: false,
            // 노무사전송 누락 보완 (2026-05-02): 정규 직원은 박제 계약서에서, 임시는 schedule.tempBankAccount.
            bankName: uid ? ec?.bankName ?? null : null,
            bankAccount: uid ? ec?.bankAccount ?? null : (r.tempBankAccount ?? null),
            residentNumber: uid ? ec?.residentNumber ?? null : null,
            phone: r.tempPhone ?? null,
            over5Employees: over5,
            // 시급제 + 주휴포함 여부 (latest signed contract). null 시 true 폴백 (보수적)
            hourlyWageIncludesHolidayPay: r.hourlyWageIncludesHolidayPay ?? true,
            taxMode: r.taxMode ?? null,
            weeklyHolidayBonus: 0,
            dateSet: new Set<string>(),
            shiftsForWeek: [],
          };
        }

        const startDt = new Date(r.startTime);
        const endDt = new Date(r.endTime);
        const grossMin = (endDt.getTime() - startDt.getTime()) / 60000;
        const netMin = Math.max(0, grossMin - (r.breakMinutes ?? 0));
        const hours = netMin / 60; // 분 단위 정밀 계산

        // ── 시급 결정 (월급제 정산 정책 재설계 2026-05-02) ──
        //   시급 + 주휴포함  → 시간 × 시급 (현행)
        //   시급 + 주휴별도  → 시간 × 시급 + 주15h 이상 주별 8h × 시급 (월말 일괄, 아래 가산)
        //   월급            → 시프트마다 누적 안 함. 월말 일괄 (계약월급 - 미근무차감)
        //   임시근로자(시급/일급/월급) → 현행 누적 유지 (시프트 단위 정산)
        let shiftWageType: WageType = null;
        let shiftWageAmount: number | null = null;
        const stdHours = 209; // 분모 통일 (정책 §2.1)
        if (r.tempWageType && r.tempWageAmount) {
          shiftWageType = r.tempWageType as WageType;
          shiftWageAmount = Number(r.tempWageAmount);
        } else if (r.wageType && r.wageAmount) {
          shiftWageType = r.wageType as WageType;
          shiftWageAmount = Number(r.wageAmount);
        }

        // 월급제 정규직: 임금 누적 제외 (월말 일괄). 임시근로자는 현행 누적 유지.
        const isRegularMonthly = !r.tempWageType && r.wageType === "monthly";
        const wage = isRegularMonthly
          ? 0
          : computeWageForShift({
              wageType: shiftWageType,
              wageAmount: shiftWageAmount,
              hoursWorked: hours,
              monthlyStandardHours: stdHours,
            });

        // KST 날짜 기준 출근일수 집계 (같은 날 다중 시프트도 1일)
        const kstStartDt = new Date(startDt.getTime() + 9 * 60 * 60 * 1000);
        const dateStr = kstStartDt.toISOString().slice(0, 10);

        companyMap[company].employees[empKey].totalHours += hours;
        companyMap[company].employees[empKey].totalWage += wage;
        companyMap[company].employees[empKey].shifts++;
        companyMap[company].employees[empKey].dateSet.add(dateStr);
        // 시급제 + 주휴별도 직원의 주별 가산용 시프트 누적
        companyMap[company].employees[empKey].shiftsForWeek.push({ startDate: dateStr, hours });
        if (r.payrollRecheckRequired) companyMap[company].employees[empKey].recheckRequired = true;
        companyMap[company].totalHours += hours;
        companyMap[company].totalWage += wage;
      }

      // ── 월급제 정규직 합계 산출 (월말 일괄, 정책 §2.2 / §3.4) ──
      // 합계 = max(0, 계약월급 × proration비율 - 미근무시간 × (월급/209))
      // computeMonthlyOnlyWage(helpers/wage.ts)로 일원화 — Phase 5 (2026-05-02).
      // 임시근로자는 위에서 시프트 단위로 누적 완료 (이 단계 적용 X).
      for (const c of Object.values(companyMap)) {
        for (const [empKey, emp] of Object.entries(c.employees)) {
          if (empKey.startsWith("temp_")) continue;
          if (emp.wageType !== "monthly") continue;
          const result = computeMonthlyOnlyWage({
            monthlyWage: emp.wageAmount,
            actualHours: emp.totalHours,
            hireDate: emp.hireDate,
            resignDate: emp.contractEnd,
            year: input.year,
            month: input.month,
            stdHours: 209,
          });
          // companyMap의 totalWage(회사 누적)는 시프트 단계에서 wage=0으로 누적됐으므로 finalWage만 가산
          c.totalWage += result.finalWage;
          emp.totalWage = result.finalWage;
        }
      }

      // 시급제 + 주휴별도 직원 → 주별 8h × 시급 가산 (월말 일괄). bonus는 별도 필드로 보관해 wageBreakdown 분리 표시
      for (const c of Object.values(companyMap)) {
        for (const emp of Object.values(c.employees)) {
          if (emp.wageType !== "hourly") continue;
          if (emp.hourlyWageIncludesHolidayPay) continue;
          const hourly = Number(emp.wageAmount);
          if (!isFinite(hourly) || hourly <= 0) continue;
          const weekMap = groupHoursByWeek(emp.shiftsForWeek);
          const bonus = computeWeeklyHolidayPay(weekMap, hourly);
          emp.totalWage += bonus;
          emp.weeklyHolidayBonus = bonus;
          c.totalWage += bonus;
        }
      }

      // ── 5인 이상 사업장 직원의 대체휴무/연차 잔여 조회 ──
      const allUserIds = new Set<number>();
      for (const c of Object.values(companyMap)) {
        for (const emp of Object.values(c.employees)) {
          if (emp.userId) allUserIds.add(emp.userId);
        }
      }
      // 대체휴무 잔여: earn - use (해당 연도)
      const leaveTxRows = allUserIds.size > 0
        ? await db.select({
            userId: leaveTransactions.userId,
            leaveType: leaveTransactions.leaveType,
            txType: leaveTransactions.txType,
            days: leaveTransactions.days,
          })
          .from(leaveTransactions)
          .where(and(
            eq(leaveTransactions.restaurantId, input.restaurantId),
            eq(leaveTransactions.year, input.year),
          ))
        : [];
      // 유저별 { substitute: {earned, used}, annual: {earned, used} }
      const leaveMap: Record<number, { substitute: { earned: number; used: number }; annual: { earned: number; used: number } }> = {};
      for (const tx of leaveTxRows) {
        if (!tx.userId) continue;
        if (!leaveMap[tx.userId]) {
          leaveMap[tx.userId] = { substitute: { earned: 0, used: 0 }, annual: { earned: 0, used: 0 } };
        }
        const lt = tx.leaveType === "substitute" ? "substitute" : "annual";
        const d = parseFloat(String(tx.days));
        if (tx.txType === "earn") leaveMap[tx.userId][lt].earned += d;
        else leaveMap[tx.userId][lt].used += d;
      }

      // 등록 임금값 → 가이드(시급/일급/월급) 환산 (server/helpers/wage.ts:computeGuideWage)
      // 직원의 weeklyHours + noWeeklyHolidayPay 기준으로 분모 동적 산출

      return Object.values(companyMap).map(c => ({
        ...c,
        employees: Object.entries(c.employees).map(([empKey, emp]) => {
          const uid = emp.userId;
          const lb = uid ? leaveMap[uid] : null;
          const isTemp = empKey.startsWith("temp_");

          // 0원 이유 판별
          let zeroWageReason: string | null = null;
          if (emp.totalWage === 0 && emp.shifts > 0) {
            if (isTemp) {
              if (!emp.wageType && !emp.wageAmount) {
                zeroWageReason = "임시근로자 급여 미설정";
              } else if (emp.wageAmount && Number(emp.wageAmount) === 0) {
                zeroWageReason = "급여액이 0원으로 설정됨";
              }
            } else {
              if (!emp.wageType && !emp.wageAmount) {
                // Phase 2: wage_history row 부재 = 전자계약서 미서명
                zeroWageReason = "전자계약서 미서명 (급여이력 없음)";
              } else if (emp.wageAmount && Number(emp.wageAmount) === 0) {
                zeroWageReason = "계약서 급여액이 0원으로 설정됨";
              }
            }
          }

          // 재설계 2026-05-02: noWeeklyHolidayPay 분리 폐기. 정규직은 항상 isNoHolidayPayWorker=false.
          const isNoHolidayPayWorker = false;

          // 가이드 환산: 시급제는 가이드 비표시(클라이언트 측 분기). 월급제는 5인 여부 기준 분모.
          const empStdHours = computeMonthlyStandardHours(emp.weeklyHours, emp.over5Employees);
          const guide = computeGuideWage({
            wageType: emp.wageType as WageType,
            wageAmount: emp.wageAmount,
            monthlyStandardHours: empStdHours,
          });
          const workedDays = emp.dateSet.size;
          const effectiveHourly = emp.totalHours > 0 ? emp.totalWage / emp.totalHours : null;
          const effectiveDaily = workedDays > 0 ? emp.totalWage / workedDays : null;
          const effectiveMonthly = emp.totalWage;

          // 4대보험·원천세는 시스템 미계산 (별도 계산 안내만 표기)
          const totalWageR = Math.round(emp.totalWage);
          const weeklyHolidayR = Math.round(emp.weeklyHolidayBonus || 0);
          const wageBreakdown = {
            base: totalWageR - weeklyHolidayR,
            weeklyHoliday: weeklyHolidayR,
            overtime: 0,
            night: 0,
          };

          // 정산월 활성 계약 (2026-05-03)
          const monthlyEntry = uid ? monthlyContractMap.get(uid) : undefined;
          const history = uid ? historyMap.get(uid) ?? [] : [];

          return {
            ...emp,
            isTemp,
            isNoHolidayPayWorker,
            zeroWageReason,
            daysOff: Math.max(0, operatingDays - emp.shifts),
            workedDays,
            guideHourly: guide.hourly,
            guideDaily: guide.daily,
            guideMonthly: guide.monthly,
            effectiveHourly,
            effectiveDaily,
            effectiveMonthly,
            wageBreakdown,
            // 휴가 정보 — 5인이상 사업장 직원에게만 의미 있음 (5인미만은 법적 의무 없음)
            substituteLeave: emp.over5Employees && lb ? { earned: lb.substitute.earned, used: lb.substitute.used, remaining: lb.substitute.earned - lb.substitute.used } : null,
            annualLeave: emp.over5Employees && lb ? { earned: lb.annual.earned, used: lb.annual.used, remaining: lb.annual.earned - lb.annual.used } : null,
            // 입사일 기준 연차 발생 일정 (5인이상만)
            annualAccrual: emp.over5Employees ? computeAnnualAccrual(emp.hireDate) : null,
            over5Employees: emp.over5Employees,
            hourlyWageIncludesHolidayPay: emp.hourlyWageIncludesHolidayPay,
            taxMode: emp.taxMode,
            // 정산월 활성 계약 — 카드 표시용. 없으면 fallback(직전/직후) + missing=true
            monthlyContractStart: monthlyEntry?.record.contractStart ?? null,
            monthlyContractEnd: monthlyEntry?.record.contractEnd ?? null,
            monthlyContractMissing: monthlyEntry ? monthlyEntry.missing : (history.length > 0),
            contractHistory: history.map(r => ({
              contractStart: r.contractStart,
              contractEnd: r.contractEnd,
              signedAt: r.signedAt,
            })),
            userId: undefined, // 클라이언트에 노출하지 않음
            dateSet: undefined, // 내부 집계용
            shiftsForWeek: undefined, // 내부 집계용
          };
        }),
      }));
    }),

  /** 인건비 재확인 경고 해소 — 해당 월의 특정 직원 또는 전체 */
  clearPayrollRecheck: ownerProcedure
    .input(z.object({
      restaurantId: z.number(),
      year: z.number(),
      month: z.number(),
      userId: z.number().optional(), // 미지정 시 해당 월 전체
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      const monthStr = String(input.month).padStart(2, "0");
      const kstFrom = new Date(`${input.year}-${monthStr}-01T00:00:00+09:00`);
      const nm = input.month === 12 ? 1 : input.month + 1;
      const ny = input.month === 12 ? input.year + 1 : input.year;
      const kstTo = new Date(`${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+09:00`);
      const fromStr = kstFrom.toISOString().slice(0, 19).replace("T", " ");
      const toStr = kstTo.toISOString().slice(0, 19).replace("T", " ");

      const conditions = [
        eq(schedules.restaurantId, input.restaurantId),
        sql`${schedules.startTime} >= ${fromStr}`,
        sql`${schedules.startTime} < ${toStr}`,
        eq(schedules.payrollRecheckRequired, true),
      ];
      if (input.userId) conditions.push(eq(schedules.userId, input.userId));

      await db.update(schedules)
        .set({ payrollRecheckRequired: false })
        .where(and(...conditions));
      return { ok: true };
    }),

  /** 기존 스케줄을 프리셋 시간 기준으로 일괄 업데이트 */
  applyPresetsToSchedules: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      weekStart: z.string().optional(), // 미지정 시 전체
      weekEnd: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      // 1) 매장 프리셋 조회
      const presetRows = await db.select().from(restaurantShiftPresets)
        .where(and(
          eq(restaurantShiftPresets.restaurantId, input.restaurantId),
          eq(restaurantShiftPresets.isActive, true),
        ));

      if (presetRows.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "저장된 근무유형 프리셋이 없습니다" });
      }

      // presetType+dayType → { startTime, endTime, breakMinutes }
      const presetMap = new Map<string, { startTime: string; endTime: string; breakMinutes: number }>();
      for (const p of presetRows) {
        presetMap.set(`${p.presetType}_${p.dayType}`, {
          startTime: p.startTime,
          endTime: p.endTime,
          breakMinutes: p.breakMinutes ?? 0,
        });
      }

      // 2) 해당 매장의 스케줄 조회 (custom 제외, shiftPreset이 있는 것만)
      const conditions: any[] = [
        eq(schedules.restaurantId, input.restaurantId),
        sql`${schedules.shiftPreset} IS NOT NULL`,
        sql`${schedules.shiftPreset} != 'custom'`,
      ];
      if (input.weekStart) {
        conditions.push(sql`${schedules.startTime} >= ${input.weekStart}`);
      }
      if (input.weekEnd) {
        conditions.push(sql`${schedules.startTime} < ${input.weekEnd}`);
      }

      const rows = await db.select({
        id: schedules.id,
        startTime: schedules.startTime,
        endTime: schedules.endTime,
        shiftPreset: schedules.shiftPreset,
        breakMinutes: schedules.breakMinutes,
      }).from(schedules).where(and(...conditions));

      let updated = 0;
      for (const row of rows) {
        if (!row.shiftPreset) continue;

        // 날짜에서 평일/주말 판별 (KST 기준)
        const kstDate = new Date(row.startTime.getTime() + 9 * 60 * 60 * 1000);
        const dayOfWeek = kstDate.getUTCDay(); // 0=일, 6=토
        const dayType = (dayOfWeek === 0 || dayOfWeek === 6) ? "weekend" : "weekday";

        // 프리셋 찾기 (해당 dayType → fallback 반대 dayType)
        let preset = presetMap.get(`${row.shiftPreset}_${dayType}`);
        if (!preset) preset = presetMap.get(`${row.shiftPreset}_${dayType === "weekday" ? "weekend" : "weekday"}`);
        if (!preset) continue; // 프리셋 없으면 스킵

        // 기존 날짜 유지하면서 시간만 변경
        const dateStr = toKSTDateString(row.startTime);
        const [sh, sm] = preset.startTime.split(":").map(Number);
        const [eh, em] = preset.endTime.split(":").map(Number);

        const newStart = new Date(`${dateStr}T${preset.startTime}:00+09:00`);
        let newEnd = new Date(`${dateStr}T${preset.endTime}:00+09:00`);
        // 야간 근무: 종료시간이 시작시간보다 작으면 다음날
        if (eh * 60 + em <= sh * 60 + sm) {
          newEnd = new Date(newEnd.getTime() + 24 * 60 * 60 * 1000);
        }

        await db.update(schedules).set({
          startTime: newStart,
          endTime: newEnd,
          breakMinutes: preset.breakMinutes,
        }).where(eq(schedules.id, row.id));
        updated++;
      }

      return { ok: true, updated, total: rows.length };
    }),

  /** 임시근로자 계좌/연락처 업데이트 — 같은 이름의 모든 스케줄에 일괄 반영 */
  updateTempWorkerInfo: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      tempWorkerName: z.string().min(1),
      bankAccount: z.string().optional(),
      phone: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const updates: Record<string, any> = {};
      if (input.bankAccount !== undefined) updates.tempBankAccount = input.bankAccount || null;
      if (input.phone !== undefined) updates.tempPhone = input.phone || null;
      if (Object.keys(updates).length === 0) return { ok: true, updated: 0 };
      const result = await db.update(schedules)
        .set(updates)
        .where(and(
          eq(schedules.restaurantId, input.restaurantId),
          sql`${schedules.tempWorkerName} = ${input.tempWorkerName}`,
        ));
      return { ok: true };
    }),

  /** 월간 요약 — 미니맵용 (날짜별 headcount + 초안 유무) */
  monthlySummary: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      year: z.number(),
      month: z.number().min(1).max(12),
    }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const { restaurantId, year, month } = input;

      const [store] = await db
        .select({
          openTime: restaurants.openTime,
          closeTime: restaurants.closeTime,
          halfShiftThreshold: restaurants.halfShiftThreshold,
        })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

      const toMinutes = (t: string | null | undefined) => {
        if (!t) return 0;
        const [h, m] = t.split(":").map(Number);
        return h * 60 + (m || 0);
      };
      const openMin = toMinutes(store?.openTime) || 0;
      const closeMin = store?.closeTime ? toMinutes(store.closeTime) : 1440;
      const storeMinutes = closeMin > openMin ? closeMin - openMin : 1440 - openMin + closeMin;
      const threshold = store?.halfShiftThreshold ?? 60;

      const rows = await db.execute(sql`
        SELECT
          DATE(CONVERT_TZ(startTime, '+00:00', '+09:00')) as date,
          SUM(CASE
            WHEN TIMESTAMPDIFF(MINUTE, startTime, endTime) <= 0 THEN 1
            WHEN (TIMESTAMPDIFF(MINUTE, startTime, endTime) / ${storeMinutes}) * 100 < ${threshold} THEN 0.5
            ELSE 1
          END) as headcount,
          MAX(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as hasUnconfirmed
        FROM schedules
        WHERE restaurantId = ${restaurantId}
          AND YEAR(CONVERT_TZ(startTime, '+00:00', '+09:00')) = ${year}
          AND MONTH(CONVERT_TZ(startTime, '+00:00', '+09:00')) = ${month}
          AND status != 'canceled'
        GROUP BY DATE(CONVERT_TZ(startTime, '+00:00', '+09:00'))
      `);
      return ((rows as any)[0] as any[]).map((r: any) => ({
        date: typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().split('T')[0],
        headcount: Number(r.headcount) || 0,
        hasUnconfirmed: !!r.hasUnconfirmed,
      }));
    }),

  /**
   * 소속회사별 근무 요약 — 매니져+점장 공통 (급여/계좌/주민번호 등 민감정보 제외)
   * laborCostByCompany에서 급여 관련 필드/계산을 빼고 근무/휴무 집계만 반환.
   */
  workSummaryByEmployee: managerProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);

      const monthStr = String(input.month).padStart(2, "0");
      const kstFrom = new Date(`${input.year}-${monthStr}-01T00:00:00+09:00`);
      const nm = input.month === 12 ? 1 : input.month + 1;
      const ny = input.month === 12 ? input.year + 1 : input.year;
      const kstTo = new Date(`${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+09:00`);
      const fromStr = kstFrom.toISOString().slice(0, 19).replace("T", " ");
      const toStr = kstTo.toISOString().slice(0, 19).replace("T", " ");

      // Phase E (2026-05-02): position 출처를 restaurant_users로 변경.
      const rows = await db
        .select({
          scheduleId: schedules.id,
          userId: schedules.userId,
          userName: users.name,
          startTime: schedules.startTime,
          endTime: schedules.endTime,
          breakMinutes: schedules.breakMinutes,
          status: schedules.status,
          tempWorkerName: schedules.tempWorkerName,
          affiliatedCompany: restaurantUsers.affiliatedCompany,
          hireDate: restaurantUsers.hireDate,
          weeklyOffDays: restaurantUsers.weeklyOffDays,
          contractOffDays: restaurantUsers.contractOffDays,
          position: restaurantUsers.position,
          payrollRecheckRequired: schedules.payrollRecheckRequired,
        })
        .from(schedules)
        .leftJoin(users, eq(schedules.userId, users.id))
        .leftJoin(restaurantUsers, and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, schedules.userId),
        ))
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            sql`${schedules.startTime} >= ${fromStr}`,
            sql`${schedules.startTime} < ${toStr}`,
            sql`${schedules.status} = 'completed'`,
          ),
        )
        .orderBy(schedules.startTime);

      // 재설계 2026-05-02: noWeeklyHolidayPay 폐기. 정규직은 항상 정규직 카드.

      // 영업일수 계산
      const weeklyClosureRows = await db.select().from(storeWeeklyClosures)
        .where(and(
          eq(storeWeeklyClosures.restaurantId, input.restaurantId),
          eq(storeWeeklyClosures.isClosed, true),
        ));
      const closedWeekdays = new Set(weeklyClosureRows.map(r => r.weekday));
      const closedDayRows = await db.select().from(storeClosedDays)
        .where(and(
          eq(storeClosedDays.restaurantId, input.restaurantId),
          sql`${storeClosedDays.closedDate} >= ${`${input.year}-${monthStr}-01`}`,
          sql`${storeClosedDays.closedDate} < ${`${ny}-${String(nm).padStart(2, "0")}-01`}`,
        ));
      const closedDateSet = new Set(closedDayRows.map(r => String(r.closedDate)));
      const daysInMonth = new Date(input.year, input.month, 0).getDate();
      let operatingDays = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(input.year, input.month - 1, d);
        const jsDay = dt.getDay();
        const dateStr = `${input.year}-${monthStr}-${String(d).padStart(2, "0")}`;
        if (closedWeekdays.has(jsDay) || closedDateSet.has(dateStr)) continue;
        operatingDays++;
      }
      // 계약휴무: contractOffDays 직접 사용 (2026-07-02)

      // 소속회사별 그룹핑 (급여 없음)
      const companyMap: Record<string, {
        company: string;
        operatingDays: number;
        totalHours: number;
        employees: Record<string, {
          name: string;
          position: string | null;
          hireDate: string | null;
          userId: number | null;
          shifts: number;
          totalHours: number;
          daysOff: number;
          contractDaysOff: number;
          recheckRequired: boolean;
          isNoHolidayPayWorker: boolean;
          dailyMap: Map<string, { hours: number; shifts: number }>;
        }>;
      }> = {};

      for (const r of rows) {
        const company = (r.affiliatedCompany ?? "미지정").trim() || "미지정";
        const name = r.userName ?? r.tempWorkerName ?? "미지정";
        // 재설계 2026-05-02: treatAsTemp 폐기
        const empKey = !r.userId ? `temp_${name}` : String(r.userId);

        if (!companyMap[company]) {
          companyMap[company] = { company, operatingDays, totalHours: 0, employees: {} };
        }
        if (!companyMap[company].employees[empKey]) {
          companyMap[company].employees[empKey] = {
            name,
            position: r.position ?? null,
            hireDate: r.hireDate ? String(r.hireDate) : null,
            userId: r.userId ? Number(r.userId) : null,
            shifts: 0,
            totalHours: 0,
            daysOff: 0,
            contractDaysOff: r.contractOffDays ?? 4,
            recheckRequired: false,
            isNoHolidayPayWorker: false,
            dailyMap: new Map<string, { hours: number; shifts: number }>(),
          };
        }

        const startDt = new Date(r.startTime);
        const endDt = new Date(r.endTime);
        const grossMin = (endDt.getTime() - startDt.getTime()) / 60000;
        const netMin = Math.max(0, grossMin - (r.breakMinutes ?? 0));
        const hours = netMin / 60;

        // KST 날짜 기준 일자별 집계
        const kstStartDt = new Date(startDt.getTime() + 9 * 60 * 60 * 1000);
        const dateStr = kstStartDt.toISOString().slice(0, 10);
        const cur = companyMap[company].employees[empKey].dailyMap.get(dateStr) ?? { hours: 0, shifts: 0 };
        cur.hours += hours;
        cur.shifts += 1;
        companyMap[company].employees[empKey].dailyMap.set(dateStr, cur);

        companyMap[company].employees[empKey].totalHours += hours;
        companyMap[company].employees[empKey].shifts += 1;
        if (r.payrollRecheckRequired) companyMap[company].employees[empKey].recheckRequired = true;
        companyMap[company].totalHours += hours;
      }

      // 대체휴무/연차 잔여 (5인 이상 사업장)
      const allUserIds = new Set<number>();
      for (const c of Object.values(companyMap)) {
        for (const emp of Object.values(c.employees)) {
          if (emp.userId) allUserIds.add(emp.userId);
        }
      }
      const leaveTxRows = allUserIds.size > 0
        ? await db.select({
            userId: leaveTransactions.userId,
            leaveType: leaveTransactions.leaveType,
            txType: leaveTransactions.txType,
            days: leaveTransactions.days,
          })
          .from(leaveTransactions)
          .where(and(
            eq(leaveTransactions.restaurantId, input.restaurantId),
            eq(leaveTransactions.year, input.year),
          ))
        : [];
      const leaveMap: Record<number, { substitute: { earned: number; used: number }; annual: { earned: number; used: number } }> = {};
      for (const tx of leaveTxRows) {
        if (!tx.userId) continue;
        if (!leaveMap[tx.userId]) leaveMap[tx.userId] = { substitute: { earned: 0, used: 0 }, annual: { earned: 0, used: 0 } };
        const lt = tx.leaveType === "substitute" ? "substitute" : "annual";
        const d = parseFloat(String(tx.days));
        if (tx.txType === "earn") leaveMap[tx.userId][lt].earned += d;
        else leaveMap[tx.userId][lt].used += d;
      }

      const companies = Object.values(companyMap).map(c => ({
        company: c.company,
        operatingDays: c.operatingDays,
        totalHours: c.totalHours,
        totalShifts: Object.values(c.employees).reduce((s, e) => s + e.shifts, 0),
        employees: Object.entries(c.employees).map(([empKey, emp]) => {
          const uid = emp.userId;
          const lb = uid ? leaveMap[uid] : null;
          const isTemp = empKey.startsWith("temp_");
          const daily = Array.from(emp.dailyMap.entries())
            .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
            .map(([date, v]) => ({ date, hours: v.hours, shifts: v.shifts }));
          return {
            name: emp.name,
            position: emp.position,
            hireDate: emp.hireDate,
            userId: uid,
            tempWorkerName: isTemp && !emp.isNoHolidayPayWorker ? emp.name : null,
            shifts: emp.shifts,
            totalHours: emp.totalHours,
            daysOff: Math.max(0, operatingDays - emp.shifts),
            contractDaysOff: emp.contractDaysOff,
            isTemp,
            isNoHolidayPayWorker: emp.isNoHolidayPayWorker,
            recheckRequired: emp.recheckRequired,
            daily,
            substituteLeave: lb ? {
              earned: lb.substitute.earned,
              used: lb.substitute.used,
              remaining: lb.substitute.earned - lb.substitute.used,
            } : null,
            annualLeave: lb ? {
              earned: lb.annual.earned,
              used: lb.annual.used,
              remaining: lb.annual.earned - lb.annual.used,
            } : null,
          };
        }),
      }));

      return {
        companies,
        operatingDays,
        closedDates: Array.from(closedDateSet).sort(),
        closedWeekdays: Array.from(closedWeekdays).sort(),
      };
    }),

  /**
   * 직원별 월 시프트 상세 (L2) — 일별 근무내역 드릴다운
   * userId가 있으면 정규직원, 없으면 tempWorkerName으로 필터.
   */
  employeeMonthlyShifts: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      year: z.number(),
      month: z.number(),
      userId: z.number().nullable().optional(),
      tempWorkerName: z.string().nullable().optional(),
    }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      if (!input.userId && !input.tempWorkerName) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "userId 또는 tempWorkerName 필요" });
      }

      const monthStr = String(input.month).padStart(2, "0");
      const kstFrom = new Date(`${input.year}-${monthStr}-01T00:00:00+09:00`);
      const nm = input.month === 12 ? 1 : input.month + 1;
      const ny = input.month === 12 ? input.year + 1 : input.year;
      const kstTo = new Date(`${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+09:00`);
      const fromStr = kstFrom.toISOString().slice(0, 19).replace("T", " ");
      const toStr = kstTo.toISOString().slice(0, 19).replace("T", " ");

      const conds: any[] = [
        eq(schedules.restaurantId, input.restaurantId),
        sql`${schedules.startTime} >= ${fromStr}`,
        sql`${schedules.startTime} < ${toStr}`,
        sql`${schedules.status} != 'canceled'`,
      ];
      if (input.userId) {
        conds.push(eq(schedules.userId, input.userId));
      } else if (input.tempWorkerName) {
        conds.push(sql`${schedules.userId} IS NULL`);
        conds.push(sql`${schedules.tempWorkerName} = ${input.tempWorkerName}`);
      }

      const rows = await db.select({
        id: schedules.id,
        startTime: schedules.startTime,
        endTime: schedules.endTime,
        breakMinutes: schedules.breakMinutes,
        status: schedules.status,
        shiftPreset: schedules.shiftPreset,
        payrollRecheckRequired: schedules.payrollRecheckRequired,
      }).from(schedules).where(and(...conds)).orderBy(schedules.startTime);

      // 매장 휴무일/정기휴무 정보
      const weeklyClosureRows = await db.select().from(storeWeeklyClosures)
        .where(and(
          eq(storeWeeklyClosures.restaurantId, input.restaurantId),
          eq(storeWeeklyClosures.isClosed, true),
        ));
      const closedWeekdays = new Set(weeklyClosureRows.map(r => r.weekday));
      const closedDayRows = await db.select().from(storeClosedDays)
        .where(and(
          eq(storeClosedDays.restaurantId, input.restaurantId),
          sql`${storeClosedDays.closedDate} >= ${`${input.year}-${monthStr}-01`}`,
          sql`${storeClosedDays.closedDate} < ${`${ny}-${String(nm).padStart(2, "0")}-01`}`,
        ));
      const closedDateSet = new Set(closedDayRows.map(r => String(r.closedDate)));

      const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

      return rows.map(r => {
        const kstStart = new Date(r.startTime.getTime() + 9 * 60 * 60 * 1000);
        const dateStr = kstStart.toISOString().slice(0, 10);
        const weekday = kstStart.getUTCDay();
        const grossMin = (r.endTime.getTime() - r.startTime.getTime()) / 60000;
        const netMin = Math.max(0, grossMin - (r.breakMinutes ?? 0));

        // KST HH:mm 포맷
        const kstEnd = new Date(r.endTime.getTime() + 9 * 60 * 60 * 1000);
        const fmtHM = (d: Date) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

        return {
          id: r.id,
          date: dateStr,
          weekday,
          weekdayLabel: WEEKDAY_LABEL[weekday],
          startTime: fmtHM(kstStart),
          endTime: fmtHM(kstEnd),
          breakMinutes: r.breakMinutes ?? 0,
          netHours: netMin / 60,
          netMinutes: netMin,
          shiftPreset: r.shiftPreset ?? "custom",
          status: r.status,
          payrollRecheckRequired: r.payrollRecheckRequired,
          holidayName: getHolidayName(dateStr),
          isStoreClosed: closedDateSet.has(dateStr) || closedWeekdays.has(weekday),
        };
      });
    }),
});
