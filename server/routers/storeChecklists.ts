import { z } from "zod";
import { eq, and, sql, gte, lte, count } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { storeChecklistTemplates, dailyChecklistLogs, users } from "../../drizzle/schema";
import { verifyStoreAccess } from "../middleware/storeAuth";
import type { CheckedItemData } from "../../drizzle/schema";

const checkedItemSchema = z.object({
  itemId: z.number(),
  answer: z.string().optional(),
  photoUrl: z.string().optional(),
});

const targetTabEnum = z.enum(["open", "purchase", "midday", "close"]);

/**
 * 반복 필터: 해당 날짜에 보여야 하는 템플릿만 반환
 * - repeatType = "daily" (또는 "none"/null) → 항상 표시
 * - repeatType = "weekly" + repeatDays(0~6 요일) → 해당 요일만 표시
 * - repeatType = "monthly" + repeatDays(1~31 일자) → 해당 날짜만 표시
 */
function shouldShowOnDate(
  template: {
    repeatType: string | null;
    repeatDays: number[] | null;
    specificDate?: string | Date | null; // 레거시 호환
    effectiveFrom?: string | Date | null;
    effectiveTo?: string | Date | null;
  },
  dateStr: string,
): boolean {
  // 적용 기간 필터: effectiveFrom 이전 / effectiveTo 이후면 미표시
  if (template.effectiveFrom) {
    const from = typeof template.effectiveFrom === "string"
      ? template.effectiveFrom : template.effectiveFrom.toISOString().slice(0, 10);
    if (dateStr < from) return false;
  }
  if (template.effectiveTo) {
    const to = typeof template.effectiveTo === "string"
      ? template.effectiveTo : template.effectiveTo.toISOString().slice(0, 10);
    if (dateStr > to) return false;
  }

  const d = new Date(dateStr);
  const repeatType = template.repeatType ?? "daily";

  if (repeatType === "daily" || repeatType === "none") return true;

  if (repeatType === "weekly") {
    const days = template.repeatDays ?? [];
    return days.includes(d.getDay()); // 0=일~6=토
  }

  if (repeatType === "monthly") {
    const days = template.repeatDays ?? [];
    return days.includes(d.getDate()); // 1~31
  }

  // 레거시 fallback: specificDate 1회성
  if (template.specificDate) {
    const specific = typeof template.specificDate === "string"
      ? template.specificDate
      : template.specificDate.toISOString().slice(0, 10);
    return specific === dateStr;
  }

  return true;
}

export const storeChecklistsRouter = router({
  // ── 템플릿 관리 ──────────────────────────────────────────────────────────

  /**
   * 탭별 활성 템플릿 조회 (날짜 반복 필터 적용)
   * - targetTab 기준으로 필터
   * - 해당 날짜에 보여야 하는 항목만 반환
   */
  listTemplates: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        targetTab: targetTabEnum,
        date: z.string().optional(), // 반복 필터용 날짜
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const templates = await db
        .select()
        .from(storeChecklistTemplates)
        .where(
          and(
            eq(storeChecklistTemplates.restaurantId, input.restaurantId),
            eq(storeChecklistTemplates.targetTab, input.targetTab),
            eq(storeChecklistTemplates.isActive, true),
          )
        )
        .orderBy(storeChecklistTemplates.sortOrder);

      // 날짜가 지정되면 반복 필터 적용
      if (input.date) {
        return templates.filter((t) => shouldShowOnDate(t, input.date!));
      }
      return templates;
    }),

  /** 모든 활성 템플릿 조회 (업무관리 페이지용) */
  listAllTemplates: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        targetTab: targetTabEnum.optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const conditions: any[] = [
        eq(storeChecklistTemplates.restaurantId, input.restaurantId),
        eq(storeChecklistTemplates.isActive, true),
      ];
      if (input.targetTab) {
        conditions.push(eq(storeChecklistTemplates.targetTab, input.targetTab));
      }
      return db
        .select()
        .from(storeChecklistTemplates)
        .where(and(...conditions))
        .orderBy(storeChecklistTemplates.targetTab, storeChecklistTemplates.sortOrder);
    }),

  /** 템플릿 항목 추가 */
  createTemplate: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        targetTab: targetTabEnum,
        itemText: z.string().min(1),
        requirementType: z.enum(["none", "text_input", "camera_photo"]).default("none"),
        sortOrder: z.number().optional(),
        repeatType: z.enum(["daily", "weekly", "monthly"]).optional(),
        repeatDays: z.array(z.number()).optional(),
        isHighlight: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // checkType은 레거시 호환을 위해 targetTab에서 파생
      const checkTypeMap: Record<string, string> = {
        open: "open",
        purchase: "order",
        midday: "other",
        close: "cleaning",
      };
      const checkType = checkTypeMap[input.targetTab] ?? "other";

      // effectiveFrom: 오늘 날짜 (KST) — 생성일 이후의 일일운영에만 표시
      const now = new Date();
      const kstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const todayStr = kstDate.toISOString().slice(0, 10);

      const [result] = await db.insert(storeChecklistTemplates).values({
        restaurantId: input.restaurantId,
        checkType: checkType as any,
        targetTab: input.targetTab,
        itemText: input.itemText,
        requirementType: input.requirementType,
        sortOrder: input.sortOrder ?? 0,
        repeatType: (input.repeatType ?? "daily") as any,
        repeatDays: input.repeatDays ?? [],
        isHighlight: input.isHighlight ?? false,
        effectiveFrom: todayStr,
        createdBy: ctx.user.userId,
      });
      return { id: (result as any).insertId };
    }),

  /** 템플릿 항목 수정 */
  updateTemplate: managerProcedure
    .input(
      z.object({
        id: z.number(),
        restaurantId: z.number(),
        targetTab: targetTabEnum.optional(),
        itemText: z.string().optional(),
        requirementType: z.enum(["none", "text_input", "camera_photo"]).optional(),
        sortOrder: z.number().optional(),
        isActive: z.boolean().optional(),
        repeatType: z.enum(["daily", "weekly", "monthly"]).optional(),
        repeatDays: z.array(z.number()).optional(),
        isHighlight: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const { id, restaurantId, ...data } = input;
      await db
        .update(storeChecklistTemplates)
        .set(data as any)
        .where(
          and(
            eq(storeChecklistTemplates.id, id),
            eq(storeChecklistTemplates.restaurantId, restaurantId),
          )
        );
      return { success: true };
    }),

  /** 템플릿 항목 비활성화 (소프트 삭제 — effectiveTo 설정 + isActive=false) */
  deleteTemplate: managerProcedure
    .input(z.object({ id: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const now = new Date();
      const kstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const todayStr = kstDate.toISOString().slice(0, 10);

      await db
        .update(storeChecklistTemplates)
        .set({
          isActive: false,
          effectiveTo: todayStr,
          deactivatedBy: ctx.user.userId,
        })
        .where(
          and(
            eq(storeChecklistTemplates.id, input.id),
            eq(storeChecklistTemplates.restaurantId, input.restaurantId),
          )
        );
      return { success: true };
    }),

  // ── 일별 체크 기록 ──────────────────────────────────────────────────────

  /** 특정 날짜+탭 체크 기록 조회 */
  getLog: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        logDate: z.string(),
        targetTab: targetTabEnum,
      })
    )
    .query(async ({ input }) => {
      const [row] = await db
        .select()
        .from(dailyChecklistLogs)
        .where(
          and(
            eq(dailyChecklistLogs.restaurantId, input.restaurantId),
            sql`${dailyChecklistLogs.logDate} = ${input.logDate}`,
            eq(dailyChecklistLogs.targetTab, input.targetTab),
          )
        )
        .limit(1);
      return row ?? null;
    }),

  /** 체크리스트 완료 저장 (upsert) — targetTab 기준 */
  saveLog: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        logDate: z.string(),
        targetTab: targetTabEnum,
        checkedItemIds: z.array(z.number()),
        checkedItems: z.array(checkedItemSchema).optional(),
        noOrderToday: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const checkedItems: CheckedItemData[] =
        input.checkedItems ?? input.checkedItemIds.map((id) => ({ itemId: id }));

      // checkType 레거시 호환: targetTab에서 파생
      const checkTypeMap: Record<string, string> = {
        open: "open",
        purchase: "order",
        midday: "other",
        close: "cleaning",
      };
      const checkType = checkTypeMap[input.targetTab] ?? "other";

      // targetTab 기준으로 기존 로그 검색
      const [existing] = await db
        .select()
        .from(dailyChecklistLogs)
        .where(
          and(
            eq(dailyChecklistLogs.restaurantId, input.restaurantId),
            sql`${dailyChecklistLogs.logDate} = ${input.logDate}`,
            eq(dailyChecklistLogs.targetTab, input.targetTab),
          )
        )
        .limit(1);

      if (existing) {
        await db
          .update(dailyChecklistLogs)
          .set({
            checkedItemIds: input.checkedItemIds,
            checkedItems,
            noOrderToday: input.noOrderToday ?? false,
            completedBy: ctx.user.userId,
            completedAt: new Date(),
          })
          .where(eq(dailyChecklistLogs.id, existing.id));
        return { id: existing.id };
      }

      const [result] = await db.insert(dailyChecklistLogs).values({
        restaurantId: input.restaurantId,
        logDate: input.logDate,
        checkType: checkType as any,
        targetTab: input.targetTab,
        checkedItemIds: input.checkedItemIds,
        checkedItems,
        noOrderToday: input.noOrderToday ?? false,
        completedBy: ctx.user.userId,
      } as any);
      return { id: (result as any).insertId };
    }),

  /** 날짜 범위별 체크 기록 조회 */
  listLogs: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        startDate: z.string(),
        endDate: z.string(),
        targetTab: targetTabEnum.optional(),
      })
    )
    .query(async ({ input }) => {
      const conditions = [
        eq(dailyChecklistLogs.restaurantId, input.restaurantId),
        gte(dailyChecklistLogs.logDate, new Date(input.startDate)),
        lte(dailyChecklistLogs.logDate, new Date(input.endDate)),
      ];
      if (input.targetTab) {
        conditions.push(eq(dailyChecklistLogs.targetTab, input.targetTab) as any);
      }
      return db
        .select()
        .from(dailyChecklistLogs)
        .where(and(...conditions))
        .orderBy(dailyChecklistLogs.logDate);
    }),
});
