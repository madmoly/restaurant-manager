import { z } from "zod";
import { eq, and, sql, desc, gte } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { storeChecklistTemplates, dailyChecklistLogs, users } from "../../drizzle/schema";
import type { CheckedItemData } from "../../drizzle/schema";

const checkedItemSchema = z.object({
  itemId: z.number(),
  answer: z.string().optional(),
  photoUrl: z.string().optional(),
});

export const storeChecklistsRouter = router({
  // ── 템플릿 관리 ──────────────────────────────────────────────────────────

  /** 체크리스트 템플릿 조회 */
  listTemplates: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        checkType: z.enum(["open", "order", "cleaning"]).optional(),
      })
    )
    .query(async ({ input }) => {
      const conditions = [
        eq(storeChecklistTemplates.restaurantId, input.restaurantId),
        eq(storeChecklistTemplates.isActive, true),
      ];
      if (input.checkType) conditions.push(eq(storeChecklistTemplates.checkType, input.checkType) as any);
      return db
        .select()
        .from(storeChecklistTemplates)
        .where(and(...conditions))
        .orderBy(storeChecklistTemplates.sortOrder);
    }),

  /** 모든 템플릿 조회 (비활성 포함 — 관리용) */
  listAllTemplates: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        checkType: z.enum(["open", "order", "cleaning"]).optional(),
      })
    )
    .query(async ({ input }) => {
      const conditions = [
        eq(storeChecklistTemplates.restaurantId, input.restaurantId),
      ];
      if (input.checkType) conditions.push(eq(storeChecklistTemplates.checkType, input.checkType) as any);
      return db
        .select()
        .from(storeChecklistTemplates)
        .where(and(...conditions))
        .orderBy(storeChecklistTemplates.sortOrder);
    }),

  /** 템플릿 항목 추가 */
  createTemplate: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        checkType: z.enum(["open", "order", "cleaning"]),
        itemText: z.string().min(1),
        requirementType: z.enum(["none", "text_input", "camera_photo"]).default("none"),
        sortOrder: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [result] = await db.insert(storeChecklistTemplates).values({
        restaurantId: input.restaurantId,
        checkType: input.checkType,
        itemText: input.itemText,
        requirementType: input.requirementType,
        sortOrder: input.sortOrder ?? 0,
        createdBy: ctx.user.userId,
      });
      return { id: (result as any).insertId };
    }),

  /** 템플릿 항목 수정 */
  updateTemplate: managerProcedure
    .input(
      z.object({
        id: z.number(),
        itemText: z.string().optional(),
        requirementType: z.enum(["none", "text_input", "camera_photo"]).optional(),
        sortOrder: z.number().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db
        .update(storeChecklistTemplates)
        .set(data as any)
        .where(eq(storeChecklistTemplates.id, id));
      return { success: true };
    }),

  /** 템플릿 항목 삭제 (soft) */
  deleteTemplate: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db
        .update(storeChecklistTemplates)
        .set({ isActive: false })
        .where(eq(storeChecklistTemplates.id, input.id));
      return { success: true };
    }),

  // ── 일별 체크 기록 ──────────────────────────────────────────────────────

  /** 특정 날짜 체크 기록 조회 */
  getLog: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        logDate: z.string(),
        checkType: z.enum(["open", "order", "cleaning"]),
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
            eq(dailyChecklistLogs.checkType, input.checkType)
          )
        )
        .limit(1);
      return row ?? null;
    }),

  /** 체크리스트 완료 저장 (upsert) — 요구사항 데이터 포함 */
  saveLog: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        logDate: z.string(),
        checkType: z.enum(["open", "order", "cleaning"]),
        checkedItemIds: z.array(z.number()),
        checkedItems: z.array(checkedItemSchema).optional(),
        noOrderToday: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const checkedItems: CheckedItemData[] = input.checkedItems ?? input.checkedItemIds.map((id) => ({ itemId: id }));

      const [existing] = await db
        .select()
        .from(dailyChecklistLogs)
        .where(
          and(
            eq(dailyChecklistLogs.restaurantId, input.restaurantId),
            sql`${dailyChecklistLogs.logDate} = ${input.logDate}`,
            eq(dailyChecklistLogs.checkType, input.checkType)
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
        checkType: input.checkType,
        checkedItemIds: input.checkedItemIds,
        checkedItems,
        noOrderToday: input.noOrderToday ?? false,
        completedBy: ctx.user.userId,
      } as any);
      return { id: (result as any).insertId };
    }),

  /** 날짜 범위별 체크 기록 조회 (점장 이력 확인용) */
  listLogs: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        startDate: z.string(),
        endDate: z.string(),
        checkType: z.enum(["open", "order", "cleaning"]).optional(),
      })
    )
    .query(async ({ input }) => {
      const conditions = [
        eq(dailyChecklistLogs.restaurantId, input.restaurantId),
        gte(dailyChecklistLogs.logDate, new Date(input.startDate)),
        sql`${dailyChecklistLogs.logDate} <= ${input.endDate}`,
      ];
      if (input.checkType) conditions.push(eq(dailyChecklistLogs.checkType, input.checkType) as any);

      return db
        .select({
          id: dailyChecklistLogs.id,
          logDate: dailyChecklistLogs.logDate,
          checkType: dailyChecklistLogs.checkType,
          checkedItemIds: dailyChecklistLogs.checkedItemIds,
          checkedItems: dailyChecklistLogs.checkedItems,
          noOrderToday: dailyChecklistLogs.noOrderToday,
          completedBy: dailyChecklistLogs.completedBy,
          completedByName: users.name,
          completedAt: dailyChecklistLogs.completedAt,
        })
        .from(dailyChecklistLogs)
        .leftJoin(users, eq(dailyChecklistLogs.completedBy, users.id))
        .where(and(...conditions))
        .orderBy(desc(dailyChecklistLogs.logDate));
    }),
});
