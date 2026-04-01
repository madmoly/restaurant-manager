import { z } from "zod";
import { eq, and, gte, sql, sum } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { verifyStoreAccess } from "../middleware/storeAuth";
import {
  monthlyClosings,
  sales,
  purchaseOrdersV2,
  schedules,
  restaurants,
  users,
  restaurantUsers,
  employeeContracts,
} from "../../drizzle/schema";
import { calcMonthlyFixedCosts } from "../helpers/fixedCostCalc";

export const monthlyClosingsRouter = router({
  /** 특정 월 마감 조회 */
  get: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
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
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
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

      // 3. 고정비 합계 (공통 함수 — costType별 월할 + 기간 필터 + sales_ratio 포함)
      const fixedResult = await calcMonthlyFixedCosts(input.restaurantId, input.year, input.month, salesTotal);
      const fixedCostsTotal = fixedResult.totalWithRatio;

      // 4. 인건비: 확정/완료 스케줄 × 계약 시급/월급 기반 자동 계산
      const monthStr2 = String(input.month).padStart(2, "0");
      const kstFrom = new Date(`${input.year}-${monthStr2}-01T00:00:00+09:00`);
      const nm2 = input.month === 12 ? 1 : input.month + 1;
      const ny2 = input.month === 12 ? input.year + 1 : input.year;
      const kstTo = new Date(`${ny2}-${String(nm2).padStart(2, "0")}-01T00:00:00+09:00`);
      const fromUtc = kstFrom.toISOString().slice(0, 19).replace("T", " ");
      const toUtc = kstTo.toISOString().slice(0, 19).replace("T", " ");

      const schedRows = await db
        .select({
          startTime: schedules.startTime,
          endTime: schedules.endTime,
          breakMinutes: schedules.breakMinutes,
          tempWageType: schedules.tempWageType,
          tempWageAmount: schedules.tempWageAmount,
          wageType: employeeContracts.wageType,
          wageAmount: employeeContracts.wageAmount,
          weeklyOffDays: employeeContracts.weeklyOffDays,
        })
        .from(schedules)
        .leftJoin(employeeContracts, and(
          eq(employeeContracts.userId, schedules.userId),
          eq(employeeContracts.restaurantId, input.restaurantId),
          eq(employeeContracts.isActive, true),
        ))
        .where(and(
          eq(schedules.restaurantId, input.restaurantId),
          sql`${schedules.startTime} >= ${fromUtc}`,
          sql`${schedules.startTime} < ${toUtc}`,
          sql`${schedules.status} IN ('confirmed','completed')`,
        ));

      let laborCost = 0;
      for (const r of schedRows) {
        const startDt = new Date(r.startTime);
        const endDt = new Date(r.endTime);
        const grossMin = (endDt.getTime() - startDt.getTime()) / 60000;
        const netMin = Math.max(0, grossMin - (r.breakMinutes ?? 0));
        const hours = netMin / 60;

        let baseRate = 0;
        if (r.tempWageType === "daily" && r.tempWageAmount) {
          laborCost += Number(r.tempWageAmount);
          continue;
        } else if (r.tempWageType === "hourly" && r.tempWageAmount) {
          baseRate = Number(r.tempWageAmount);
        } else if (r.wageType === "hourly" && r.wageAmount) {
          baseRate = Number(r.wageAmount);
        } else if (r.wageType === "monthly" && r.wageAmount) {
          baseRate = Number(r.wageAmount) / 209;
        }
        if (baseRate > 0) {
          laborCost += hours * baseRate;
        }
      }
      laborCost = Math.round(laborCost);

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
