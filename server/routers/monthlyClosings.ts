import { z } from "zod";
import { eq, and, gte, lte, sql, sum } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import {
  monthlyClosings,
  sales,
  purchaseOrdersV2,
  schedules,
  fixedCosts,
  restaurants,
} from "../../drizzle/schema";

export const monthlyClosingsRouter = router({
  /** 특정 월 마감 조회 */
  get: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input }) => {
      const [row] = await db
        .select()
        .from(monthlyClosings)
        .where(
          and(
            eq(monthlyClosings.restaurantId, input.restaurantId),
            eq(monthlyClosings.year, input.year),
            eq(monthlyClosings.month, input.month),
          ),
        )
        .limit(1);
      return row ?? null;
    }),

  /** 연간 월마감 목록 */
  listByYear: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(monthlyClosings)
        .where(
          and(
            eq(monthlyClosings.restaurantId, input.restaurantId),
            eq(monthlyClosings.year, input.year),
          ),
        )
        .orderBy(monthlyClosings.month);
    }),

  /** 월마감 확정 — 매출/매입/인건비/고정비 자동 집계 */
  close: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        year: z.number(),
        month: z.number(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const mm = String(input.month).padStart(2, "0");
      const startDate = `${input.year}-${mm}-01`;
      const daysInMonth = new Date(input.year, input.month, 0).getDate();
      const endDate = `${input.year}-${mm}-${daysInMonth}`;
      const monthStr = `${input.year}-${mm}`;

      // 1. 매출 합계
      const [salesRow] = await db
        .select({ total: sum(sales.amount) })
        .from(sales)
        .where(
          and(
            eq(sales.restaurantId, input.restaurantId),
            gte(sales.saleDate, new Date(startDate)),
            sql`${sales.saleDate} <= ${endDate}`,
          ),
        );
      const salesTotal = Number(salesRow?.total ?? 0);

      // 2. 매입 합계 (V2)
      const [purchRow] = await db
        .select({ total: sum(purchaseOrdersV2.totalAmount) })
        .from(purchaseOrdersV2)
        .where(
          and(
            eq(purchaseOrdersV2.restaurantId, input.restaurantId),
            gte(purchaseOrdersV2.purchaseDate, new Date(startDate)),
            sql`${purchaseOrdersV2.purchaseDate} <= ${endDate}`,
          ),
        );
      const purchasesTotal = Number(purchRow?.total ?? 0);

      // 3. 고정비 합계
      const [fixedRow] = await db
        .select({ total: sum(fixedCosts.amount) })
        .from(fixedCosts)
        .where(
          and(
            eq(fixedCosts.restaurantId, input.restaurantId),
            eq(fixedCosts.effectiveMonth, monthStr),
          ),
        );
      const fixedCostsTotal = Number(fixedRow?.total ?? 0);

      // 4. 인건비: confirmed 스케줄 기반 간이 계산
      // (실제 운영시 employeeContracts의 시급 × 근무시간으로 계산)
      // 여기서는 placeholder로 0 — 추후 employeeContracts 연동 시 구현
      const laborCost = 0;

      const profit = salesTotal - purchasesTotal - laborCost - fixedCostsTotal;

      // upsert
      const [existing] = await db
        .select()
        .from(monthlyClosings)
        .where(
          and(
            eq(monthlyClosings.restaurantId, input.restaurantId),
            eq(monthlyClosings.year, input.year),
            eq(monthlyClosings.month, input.month),
          ),
        )
        .limit(1);

      if (existing) {
        await db
          .update(monthlyClosings)
          .set({
            salesTotal: String(salesTotal),
            purchasesTotal: String(purchasesTotal),
            laborCost: String(laborCost),
            fixedCostsTotal: String(fixedCostsTotal),
            profit: String(profit),
            note: input.note,
            closedBy: ctx.user.userId,
            closedAt: new Date(),
          })
          .where(eq(monthlyClosings.id, existing.id));
      } else {
        await db.insert(monthlyClosings).values({
          restaurantId: input.restaurantId,
          year: input.year,
          month: input.month,
          salesTotal: String(salesTotal),
          purchasesTotal: String(purchasesTotal),
          laborCost: String(laborCost),
          fixedCostsTotal: String(fixedCostsTotal),
          profit: String(profit),
          note: input.note,
          closedBy: ctx.user.userId,
        });
      }

      return { salesTotal, purchasesTotal, laborCost, fixedCostsTotal, profit };
    }),
});
