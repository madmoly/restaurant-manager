import { z } from "zod";
import { eq, and, asc, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { recipes } from "../../drizzle/schema";
import { verifyStoreAccess } from "../middleware/storeAuth";

export const recipesRouter = router({
  /** 매장 레시피 목록 조회 */
  list: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db
        .select()
        .from(recipes)
        .where(and(
          eq(recipes.restaurantId, input.restaurantId),
          eq(recipes.isPublished, true),
        ))
        .orderBy(asc(recipes.sortOrder), desc(recipes.createdAt));
    }),

  /** 레시피 상세 조회 */
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [row] = await db.select().from(recipes).where(and(eq(recipes.id, input.id), eq(recipes.isPublished, true)));
      return row ?? null;
    }),

  /** 레시피 등록 (매니져 이상) */
  create: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      title: z.string().min(1),
      category: z.string().optional(),
      imageUrl: z.string().optional(),
      content: z.string().optional(),
      servingYield: z.number().min(0.01).optional(),
      sellingPrice: z.number().nullable().optional(),
      lossRate: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      const [result] = await db.insert(recipes).values({
        restaurantId: input.restaurantId,
        title: input.title,
        category: input.category ?? null,
        imageUrl: input.imageUrl ?? null,
        content: input.content ?? null,
        servingYield: String(input.servingYield ?? 1),
        sellingPrice: input.sellingPrice != null ? String(input.sellingPrice) : null,
        lossRate: String(input.lossRate ?? 0),
        createdBy: ctx.user.userId,
      });
      return { id: result.insertId };
    }),

  /** 레시피 수정 */
  update: managerProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().min(1).optional(),
      category: z.string().optional(),
      imageUrl: z.string().optional(),
      content: z.string().optional(),
      sortOrder: z.number().optional(),
      servingYield: z.number().min(0.01).optional(),
      sellingPrice: z.number().nullable().optional(),
      lossRate: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [current] = await db.select({ restaurantId: recipes.restaurantId }).from(recipes).where(eq(recipes.id, input.id)).limit(1);
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "레시피를 찾을 수 없습니다" });
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, current.restaurantId, true);
      const { id, servingYield, sellingPrice, lossRate, ...rest } = input;
      const setData: Record<string, unknown> = { ...rest };
      if (servingYield !== undefined) setData.servingYield = String(servingYield);
      if (sellingPrice !== undefined) setData.sellingPrice = sellingPrice != null ? String(sellingPrice) : null;
      if (lossRate !== undefined) setData.lossRate = String(lossRate);
      await db.update(recipes).set(setData).where(eq(recipes.id, id));
      return { ok: true };
    }),

  /** 레시피 삭제 (soft: isPublished=false) */
  delete: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const [current] = await db.select({ restaurantId: recipes.restaurantId }).from(recipes).where(eq(recipes.id, input.id)).limit(1);
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "레시피를 찾을 수 없습니다" });
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, current.restaurantId, true);
      await db.update(recipes).set({ isPublished: false }).where(eq(recipes.id, input.id));
      return { ok: true };
    }),
});
