/**
 * 고정비 월간 집계 공통 함수
 * - monthlyClosings.close, admin.ts, fixedCosts.monthlyTotal 모두 이 함수 사용
 * - costType별 월할 계산 + startMonth/endMonth 기간 필터링
 * - sales_ratio 타입은 매출액 필요 시 별도 반환
 */
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { fixedCosts } from "../../drizzle/schema";

export interface FixedCostBreakdown {
  id: number;
  name: string;
  amount: number;       // 월환산 금액
  rawAmount: number;    // 원본 금액
  type: string;
  category: string | null;
}

export interface RatioItem {
  id: number;
  name: string;
  ratio: number;        // % 값 (예: 5.5)
  category: string | null;
}

export interface MonthlyFixedCostResult {
  /** 고정금액 합계 (sales_ratio 제외) */
  fixedTotal: number;
  /** 매출비율형 항목 적용 후 합계 (salesAmount 제공 시) */
  totalWithRatio: number;
  /** 고정금액 항목 상세 */
  breakdown: FixedCostBreakdown[];
  /** 매출비율형 항목 */
  ratioItems: RatioItem[];
  /** 매출비율형 금액 합계 (salesAmount 제공 시 계산) */
  ratioTotal: number;
}

/**
 * 특정 매장의 특정 월 고정비를 계산한다.
 * @param restaurantId 매장 ID
 * @param year 연도
 * @param month 월 (1~12)
 * @param salesAmount 해당 월 매출액 (sales_ratio 계산용, 없으면 ratioTotal=0)
 */
export async function calcMonthlyFixedCosts(
  restaurantId: number,
  year: number,
  month: number,
  salesAmount?: number,
): Promise<MonthlyFixedCostResult> {
  const active = await db
    .select()
    .from(fixedCosts)
    .where(
      and(
        eq(fixedCosts.restaurantId, restaurantId),
        eq(fixedCosts.isActive, true),
      ),
    );

  const targetMonth = `${year}-${String(month).padStart(2, "0")}`;
  let fixedTotal = 0;
  const breakdown: FixedCostBreakdown[] = [];
  const ratioItems: RatioItem[] = [];

  for (const fc of active) {
    // 기간 필터: startMonth ~ endMonth 범위 체크
    if (fc.startMonth && targetMonth < fc.startMonth) continue;
    if (fc.endMonth && targetMonth > fc.endMonth) continue;

    if (fc.costType === "sales_ratio") {
      ratioItems.push({
        id: fc.id,
        name: fc.costName,
        ratio: Number(fc.amount),
        category: fc.category,
      });
      continue;
    }

    let monthlyAmt = 0;
    const rawAmt = Number(fc.amount);

    if (fc.costType === "monthly") {
      monthlyAmt = rawAmt;
    } else if (fc.costType === "yearly") {
      monthlyAmt = Math.round(rawAmt / 12);
    } else if (fc.costType === "quarterly") {
      monthlyAmt = Math.round(rawAmt / 3);
    } else if (fc.costType === "one_time") {
      // 레거시: effectiveMonth 매칭 또는 startMonth 매칭
      if (fc.effectiveMonth === targetMonth || fc.startMonth === targetMonth) {
        monthlyAmt = rawAmt;
      }
    }

    if (monthlyAmt > 0) {
      fixedTotal += monthlyAmt;
      breakdown.push({
        id: fc.id,
        name: fc.costName,
        amount: monthlyAmt,
        rawAmount: rawAmt,
        type: fc.costType,
        category: fc.category,
      });
    }
  }

  // 매출비율형 계산
  const sales = salesAmount ?? 0;
  const ratioTotal = ratioItems.reduce(
    (sum, r) => sum + Math.round(sales * r.ratio / 100),
    0,
  );

  return {
    fixedTotal,
    totalWithRatio: fixedTotal + ratioTotal,
    breakdown,
    ratioItems,
    ratioTotal,
  };
}
