import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { fixedCosts } from "../../drizzle/schema";
import { verifyStoreAccess, requireStoreManager } from "../middleware/storeAuth";
import { calcMonthlyFixedCosts } from "../helpers/fixedCostCalc";

const costTypeEnum = z.enum(["monthly", "yearly", "quarterly", "sales_ratio", "profit_ratio"]);
const categoryEnum = z.enum(["임대료", "관리비", "보험", "로열티/수수료", "유틸리티", "기타"]);

/** 비율형(sales_ratio/profit_ratio) amount 검증: 0 초과 100 이하 */
function validateRatioAmount(costType: string, amountStr: string) {
  if (costType !== "sales_ratio" && costType !== "profit_ratio") return;
  const ratio = Number(amountStr);
  if (!isFinite(ratio) || ratio <= 0 || ratio > 100) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: costType === "profit_ratio"
        ? "월순이익 비율은 0 초과 100 이하여야 합니다."
        : "매출 비율은 0 초과 100 이하여야 합니다.",
    });
  }
}

export const fixedCostsRouter = router({
  list: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db.select().from(fixedCosts)
        .where(and(eq(fixedCosts.restaurantId, input.restaurantId), eq(fixedCosts.isActive, true)))
        .orderBy(fixedCosts.costName);
    }),

  /** 특정 월의 고정비 총액 계산 (공통 함수 사용) */
  monthlyTotal: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      year: z.number(),
      month: z.number(),
      salesAmount: z.number().optional(),
      // profit_ratio 정확 계산용 (셋 다 전달된 경우에만 적용)
      purchasesAmount: z.number().optional(),
      laborAmount: z.number().optional(),
      expensesAmount: z.number().optional(),
    }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const externalCosts = (
        input.purchasesAmount !== undefined &&
        input.laborAmount !== undefined &&
        input.expensesAmount !== undefined
      )
        ? {
            purchases: input.purchasesAmount,
            labor: input.laborAmount,
            expenses: input.expensesAmount,
          }
        : undefined;

      const result = await calcMonthlyFixedCosts(
        input.restaurantId, input.year, input.month, input.salesAmount, externalCosts,
      );
      return {
        total: result.fixedTotal.toString(),
        totalWithRatio: result.totalWithRatio.toString(),
        breakdown: result.breakdown.map(b => ({
          name: b.name, amount: b.amount, type: b.type, category: b.category,
        })),
        // 하위호환 alias
        ratioItems: result.salesRatioItems.map(r => ({
          name: r.name, ratio: r.ratio, category: r.category,
        })),
        ratioTotal: result.salesRatioTotal,
        // 신규
        salesRatioItems: result.salesRatioItems.map(r => ({
          name: r.name, ratio: r.ratio, category: r.category,
        })),
        salesRatioTotal: result.salesRatioTotal,
        profitRatioItems: result.profitRatioItems.map(r => ({
          name: r.name, ratio: r.ratio, category: r.category, amount: r.amount,
        })),
        profitRatioTotal: result.profitRatioTotal,
        monthlyProfit: result.monthlyProfit,
        preProfit: result.preProfit,
      };
    }),

  create: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      costName: z.string().min(1),
      costType: costTypeEnum.default("monthly"),
      category: categoryEnum.default("기타"),
      amount: z.string(),
      startMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      endMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
      attachmentUrl: z.string().optional(),
      note: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireStoreManager(ctx.user.userId, ctx.user.role, input.restaurantId);
      validateRatioAmount(input.costType, input.amount);
      // 기본 startMonth: 이번 달
      const now = new Date();
      const defaultStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const [result] = await db.insert(fixedCosts).values({
        restaurantId: input.restaurantId,
        costName: input.costName,
        costType: input.costType as any,
        category: input.category,
        amount: input.amount,
        startMonth: input.startMonth ?? defaultStart,
        endMonth: input.endMonth ?? null,
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
      category: categoryEnum.optional(),
      amount: z.string().optional(),
      startMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      endMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
      attachmentUrl: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireStoreManager(ctx.user.userId, ctx.user.role, input.restaurantId);
      if (input.costType !== undefined && input.amount !== undefined) {
        validateRatioAmount(input.costType, input.amount);
      }
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
