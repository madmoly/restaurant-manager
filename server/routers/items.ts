import { z } from "zod";
import { eq, and, like } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { items } from "../../drizzle/schema";

export const itemsRouter = router({
  /** 매장 품목 목록 */
  list: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(items)
        .where(and(eq(items.restaurantId, input.restaurantId), eq(items.isActive, true)))
        .orderBy(items.name);
    }),

  /** 품목 생성 */
  create: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        name: z.string().min(1),
        itemType: z.enum(["product", "service", "misc"]).default("product"),
        costingCategory: z.string().optional(),
        baseUnit: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const [result] = await db.insert(items).values({
        restaurantId: input.restaurantId,
        name: input.name,
        itemType: input.itemType,
        costingCategory: input.costingCategory,
        baseUnit: input.baseUnit,
      }).$returningId();
      return { id: result.id };
    }),

  /** 품목명 유사 검색 */
  searchSimilar: protectedProcedure
    .input(z.object({ restaurantId: z.number(), query: z.string() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(items)
        .where(
          and(
            eq(items.restaurantId, input.restaurantId),
            eq(items.isActive, true),
            like(items.name, `%${input.query}%`),
          ),
        )
        .limit(10);
    }),

  /** 품목 수정 */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        itemType: z.enum(["product", "service", "misc"]).optional(),
        costingCategory: z.string().optional(),
        baseUnit: z.string().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(items).set(data).where(eq(items.id, id));
      return { ok: true };
    }),
});
