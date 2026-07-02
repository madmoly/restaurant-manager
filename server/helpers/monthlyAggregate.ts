/**
 * 매장 월간 손익 라이브 집계 — 단일 매장/단일 월 기준.
 *
 * admin.multiStoreMonthlySummary, analysis.storeTrends/targetAttainment 등
 * 여러 라우터가 공유하는 단일 진실 원천. 매장당 5쿼리(일마감 목록·매출·매입·
 * 인건비·경비) + 인건비 시프트 재계산이 발생하므로, 다수 매장×다수 월을
 * 한 번에 라이브 계산하지 말 것 — 12개월 등 장기 추이는 monthly_closings
 * 확정치를 우선 사용하고, 이 함수는 당월(미확정) 라이브 계산에만 쓴다.
 */

import { and, eq, between, sql } from "drizzle-orm";
import { db } from "../db";
import { dailyClosings, dailyExpenses } from "../../drizzle/schema";
import { calcMonthlyFixedCosts } from "./fixedCostCalc";
import { sumLaborByCompany, sumSalesByMethod, sumPurchasesByCP } from "../routers/monthlyClosings";

export interface StoreMonthlyAggregate {
  salesTotal: number;
  purchasesTotal: number;
  laborCost: number;
  fixedCostTotal: number;
  expensesTotal: number;
  profit: number;
  profitRate: number;
  closedDays: number;
  daysInMonth: number;
}

export async function computeStoreMonthlyAggregate(
  restaurantId: number,
  year: number,
  month: number,
): Promise<StoreMonthlyAggregate> {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);

  // 일마감 날짜 목록 (마감 기준 집계용)
  const closingRows = await db
    .select({ closingDate: dailyClosings.closingDate })
    .from(dailyClosings)
    .where(and(eq(dailyClosings.restaurantId, restaurantId), between(dailyClosings.closingDate, start, end)));
  const closedDateStrs = closingRows.map((c) => {
    const d = new Date(c.closingDate);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  const startDateStr = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDateStr = `${year}-${String(month).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;

  // 매출 (일마감 기준 — 수익분석과 동일)
  const confirmedSales = await sumSalesByMethod(restaurantId, closedDateStrs, startDateStr, endDateStr);
  const salesTotal = confirmedSales.salesTotal;

  // 매입 (일마감 기준 — 수익분석과 동일)
  const confirmedPurchases = await sumPurchasesByCP(restaurantId, startDateStr, endDateStr, true);
  const purchasesTotal = confirmedPurchases.total;

  // 인건비: 시프트 재계산 (수익분석과 동일 산식)
  const laborResult = await sumLaborByCompany(restaurantId, year, month, closedDateStrs);
  const laborCost = laborResult.totalCost;

  // 즉시 지출 (날짜 기반, 일마감 무관 — 수익분석과 동일)
  const [expRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(CAST(${dailyExpenses.amount} AS DECIMAL(14,2))), 0)` })
    .from(dailyExpenses)
    .where(and(eq(dailyExpenses.restaurantId, restaurantId), between(dailyExpenses.date, start, end)));
  const expensesTotal = Math.round(Number(expRow?.total ?? 0));

  // 고정비 합계 (sales_ratio + profit_ratio closed-form 적용)
  const fixedResult = await calcMonthlyFixedCosts(
    restaurantId, year, month, salesTotal,
    { purchases: purchasesTotal, labor: laborCost, expenses: expensesTotal },
  );
  const fixedCostTotal = fixedResult.totalWithRatio;
  const profit = salesTotal - purchasesTotal - laborCost - fixedCostTotal - expensesTotal;

  return {
    salesTotal,
    purchasesTotal,
    laborCost,
    fixedCostTotal,
    expensesTotal,
    profit,
    profitRate: salesTotal > 0 ? (profit / salesTotal * 100) : 0,
    closedDays: closingRows.length,
    daysInMonth: end.getDate(),
  };
}
