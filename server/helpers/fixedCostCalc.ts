/**
 * 고정비 월간 집계 공통 함수
 * - monthlyClosings.close, admin.ts, fixedCosts.monthlyTotal 모두 이 함수 사용
 * - costType별 월할 계산 + startMonth/endMonth 기간 필터링
 * - sales_ratio: 매출 × 비율
 * - profit_ratio: 월순이익 × 비율 (closed-form, 적자월 0원)
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

export interface ProfitRatioItemWithAmount extends RatioItem {
  amount: number;       // 안분된 금액
}

export interface MonthlyFixedCostResult {
  /** 고정금액 합계 (sales_ratio, profit_ratio 제외) */
  fixedTotal: number;
  /** 매출비율형 적용 후 + 월순이익비율형 적용 후 합계 */
  totalWithRatio: number;
  /** 고정금액 항목 상세 */
  breakdown: FixedCostBreakdown[];

  /** 매출비율형 항목 (메타) */
  salesRatioItems: RatioItem[];
  /** 매출비율형 금액 합계 (S × R_s / 100) */
  salesRatioTotal: number;

  /** 월순이익비율형 항목 (안분된 금액 포함) */
  profitRatioItems: ProfitRatioItemWithAmount[];
  /** 월순이익비율형 금액 합계 */
  profitRatioTotal: number;

  /** closed-form 결과 (적자면 음수, profit_ratio 없으면 preProfit과 동일) */
  monthlyProfit: number;
  /** 디버그/표시용: S − P − L − F − salesRatioAmt − E */
  preProfit: number;

  // 하위호환 deprecated alias (점진 제거)
  /** @deprecated salesRatioItems 사용 권장 */
  ratioItems: RatioItem[];
  /** @deprecated salesRatioTotal 사용 권장 */
  ratioTotal: number;
}

/**
 * 특정 매장의 특정 월 고정비를 계산한다.
 * @param restaurantId 매장 ID
 * @param year 연도
 * @param month 월 (1~12)
 * @param salesAmount 해당 월 매출액 (sales_ratio/profit_ratio 계산용)
 * @param externalCosts profit_ratio 정확 계산용. 매입+인건비+즉시지출. 없으면 0 처리 → profitRatioTotal=0 (각 항목 amount=0)
 */
export async function calcMonthlyFixedCosts(
  restaurantId: number,
  year: number,
  month: number,
  salesAmount?: number,
  externalCosts?: { purchases: number; labor: number; expenses: number },
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
  const salesRatioItems: RatioItem[] = [];
  const profitRatioItemsRaw: RatioItem[] = [];

  for (const fc of active) {
    // 기간 필터: startMonth ~ endMonth 범위 체크
    if (fc.startMonth && targetMonth < fc.startMonth) continue;
    if (fc.endMonth && targetMonth > fc.endMonth) continue;

    if (fc.costType === "sales_ratio") {
      salesRatioItems.push({
        id: fc.id,
        name: fc.costName,
        ratio: Number(fc.amount),
        category: fc.category,
      });
      continue;
    }

    if (fc.costType === "profit_ratio") {
      profitRatioItemsRaw.push({
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

  // 매출비율형 금액 계산
  const sales = salesAmount ?? 0;
  const salesRatioTotal = salesRatioItems.reduce(
    (sum, r) => sum + Math.round(sales * r.ratio / 100),
    0,
  );

  // 월순이익비율형 closed-form 계산
  const ext = externalCosts ?? { purchases: 0, labor: 0, expenses: 0 };
  const hasExternalCosts = !!externalCosts;
  const preProfit = sales - ext.purchases - ext.labor - fixedTotal - salesRatioTotal - ext.expenses;

  let monthlyProfit: number;
  let profitRatioTotal = 0;
  const profitRatioItems: ProfitRatioItemWithAmount[] = [];

  if (hasExternalCosts && preProfit > 0 && profitRatioItemsRaw.length > 0) {
    const Rp = profitRatioItemsRaw.reduce((s, r) => s + r.ratio, 0);
    monthlyProfit = Math.round(preProfit * 100 / (100 + Rp));
    profitRatioTotal = preProfit - monthlyProfit;

    let acc = 0;
    profitRatioItemsRaw.forEach((r, idx) => {
      const isLast = idx === profitRatioItemsRaw.length - 1;
      const amt = isLast
        ? profitRatioTotal - acc
        : Math.round(monthlyProfit * r.ratio / 100);
      acc += amt;
      profitRatioItems.push({ ...r, amount: amt });
    });
  } else {
    // externalCosts 없음 / 적자월 / profit_ratio 항목 없음 → 0원 안분
    monthlyProfit = preProfit;
    profitRatioItemsRaw.forEach(r => profitRatioItems.push({ ...r, amount: 0 }));
  }

  const totalWithRatio = fixedTotal + salesRatioTotal + profitRatioTotal;

  return {
    fixedTotal,
    totalWithRatio,
    breakdown,
    salesRatioItems,
    salesRatioTotal,
    profitRatioItems,
    profitRatioTotal,
    monthlyProfit,
    preProfit,
    // deprecated aliases
    ratioItems: salesRatioItems,
    ratioTotal: salesRatioTotal,
  };
}
