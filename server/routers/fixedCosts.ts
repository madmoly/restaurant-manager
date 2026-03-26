import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { fixedCosts } from "../../drizzle/schema";
import { verifyStoreAccess, requireStoreManager } from "../middleware/storeAuth";

const costTypeEnum = z.enum(["monthly", "yearly", "quarterly", "sales_ratio"]);

export const fixedCostsRouter = router({
  list: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db.select().from(fixedCosts)
        .where(and(eq(fixedCosts.restaurantId, input.restaurantId), eq(fixedCosts.isActive, true)))
        .orderBy(fixedCosts.costName);
    }),

  /** 특정 월의 고정비 총액 계산
   * - monthly: 그대로
   * - yearly: /12
   * - quarterly: /3
   * - sales_ratio: 매출 기반이므로 별도 표시 (total에 미포함, ratioItems로 반환)
   */
  monthlyTotal: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);

      const active = await db.select().from(fixedCosts)
        .where(and(eq(fixedCosts.restaurantId, input.restaurantId), eq(fixedCosts.isActive, true)));

      let total = 0;
      const breakdown: Array<{ name: string; amount: number; type: string }> = [];
      const ratioItems: Array<{ name: string; ratio: number }> = [];

      for (const fc of active) {
        if (fc.costType === "sales_ratio") {
          ratioItems.push({ name: fc.costName, ratio: Number(fc.amount) });
          continue;
        }

        let monthlyAmt = 0;
        if (fc.costType === "monthly") {
          monthlyAmt = Number(fc.amount);
        } else if (fc.costType === "yearly") {
          monthlyAmt = Math.round(Number(fc.amount) / 12);
        } else if (fc.costType === "quarterly") {
          monthlyAmt = Math.round(Number(fc.amount) / 3);
        } else if (fc.costType === "one_time") {
          // 레거시: effectiveMonth 매칭
          const yearMonth = `${input.year}-${String(input.month).padStart(2, "0")}`;
          if (fc.effectiveMonth === yearMonth) {
            monthlyAmt = Number(fc.amount);
          }
        }
        if (monthlyAmt > 0) {
          total += monthlyAmt;
          breakdown.push({ name: fc.costName, amount: monthlyAmt, type: fc.costType });
        }
      }

      return { total: total.toString(), breakdown, ratioItems };
    }),

  create: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      costName: z.string().min(1),
      costType: costTypeEnum.default("monthly"),
      amount: z.string(),
      attachmentUrl: z.string().optional(),
      note: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireStoreManager(ctx.user.userId, ctx.user.role, input.restaurantId);
      const [result] = await db.insert(fixedCosts).values({
        restaurantId: input.restaurantId,
        costName: input.costName,
        costType: input.costType as any,
        amount: input.amount,
        attachmentUrl: input.attachmentUrl ?? null,
        note: input.note ?? null,
        createdBy: ctx.user.userId,
      } as any).$returningId();
      return { id: result.id };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      restaurantId: z.number(),
      costName: z.string().optional(),
      costType: costTypeEnum.optional(),
      amount: z.string().optional(),
      attachmentUrl: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireStoreManager(ctx.user.userId, ctx.user.role, input.restaurantId);
      const { id, restaurantId, ...data } = input;
      await db.update(fixedCosts).set(data as any).where(eq(fixedCosts.id, id));
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
