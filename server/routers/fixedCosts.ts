import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { fixedCosts } from "../../drizzle/schema";
import { verifyStoreAccess, requireStoreManager } from "../middleware/storeAuth";

export const fixedCostsRouter = router({
  list: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db.select().from(fixedCosts)
        .where(and(eq(fixedCosts.restaurantId, input.restaurantId), eq(fixedCosts.isActive, true)))
        .orderBy(fixedCosts.costName);
    }),

  /** 특정 월의 고정비 총액 계산 (monthly + yearly/12 + one_time 해당월) */
  monthlyTotal: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const yearMonth = `${input.year}-${String(input.month).padStart(2, "0")}`;

      const active = await db.select().from(fixedCosts)
        .where(and(eq(fixedCosts.restaurantId, input.restaurantId), eq(fixedCosts.isActive, true)));

      let total = 0;
      const breakdown: Array<{ name: string; amount: number; type: string }> = [];

      for (const fc of active) {
        let monthlyAmt = 0;
        if (fc.costType === "monthly") {
          monthlyAmt = Number(fc.amount);
        } else if (fc.costType === "yearly") {
          monthlyAmt = Math.round(Number(fc.amount) / 12);
        } else if (fc.costType === "one_time" && fc.effectiveMonth === yearMonth) {
          monthlyAmt = Number(fc.amount);
        }
        if (monthlyAmt > 0) {
          total += monthlyAmt;
          breakdown.push({ name: fc.costName, amount: monthlyAmt, type: fc.costType });
        }
      }

      return { total: total.toString(), breakdown };
    }),

  create: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      costName: z.string().min(1),
      costType: z.enum(["monthly", "yearly", "one_time"]).default("monthly"),
      amount: z.string(),
      effectiveMonth: z.string().optional(),
      note: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireStoreManager(ctx.user.userId, ctx.user.role, input.restaurantId);
      const [result] = await db.insert(fixedCosts).values({
        ...input,
        createdBy: ctx.user.userId,
      }).$returningId();
      return { id: result.id };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      restaurantId: z.number(),
      costName: z.string().optional(),
      costType: z.enum(["monthly", "yearly", "one_time"]).optional(),
      amount: z.string().optional(),
      effectiveMonth: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireStoreManager(ctx.user.userId, ctx.user.role, input.restaurantId);
      const { id, restaurantId, ...data } = input;
      await db.update(fixedCosts).set(data).where(eq(fixedCosts.id, id));
      return { ok: true };
    }),

  deactivate: protectedProcedure
    .input(z.object({ id: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await requireStoreManager(ctx.user.userId, ctx.user.role, input.restaurantId);
      await db.update(fixedCosts).set({ isActive: false }).where(eq(fixedCosts.id, input.id));
      return { ok: true };
    }),
});
