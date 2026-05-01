/**
 * 인건비 계산 공통 헬퍼 (시프트 임금 / 가이드 환산만 담당)
 *
 * 재설계 2026-05-02:
 * - computeMonthlyStandardHours는 helpers/labor.ts로 이동 (5인 미만/이상 분기 위해 DB 의존)
 * - 본 파일은 순수 함수만 유지 (시프트 임금 합산, 가이드 시급 환산)
 *
 * 사용처:
 * - server/routers/schedules.ts:laborCostByCompany / workSummaryByEmployee
 * - server/routers/dailyClosings.ts:estimate
 * - server/routers/monthlyClosings.ts:sumLaborByCompany
 */

const FULLTIME_STANDARD_HOURS = 209; // 풀타임 표준 분모 폴백

export type WageType = "hourly" | "monthly" | "daily" | null | undefined;

/**
 * 한 시프트의 임금 계산.
 * - hourly: hoursWorked × wageAmount
 * - monthly: hoursWorked × (wageAmount / monthlyStandardHours)
 * - daily: wageAmount (시간 무관, 1일 단위)
 */
export function computeWageForShift(args: {
  wageType: WageType;
  wageAmount: number | string | null | undefined;
  hoursWorked: number;
  monthlyStandardHours: number;
}): number {
  const amount = Number(args.wageAmount);
  if (!isFinite(amount) || amount <= 0) return 0;
  const hours = Number(args.hoursWorked);
  if (!isFinite(hours) || hours < 0) return 0;

  if (args.wageType === "daily") return amount;
  if (args.wageType === "hourly") return hours * amount;
  if (args.wageType === "monthly") {
    if (args.monthlyStandardHours <= 0) return 0;
    return hours * (amount / args.monthlyStandardHours);
  }
  return 0;
}

/**
 * 가이드 시급/일급/월급 환산 (UI 표시용).
 * 직원의 monthlyStandardHours 기준으로 통일.
 */
export function computeGuideWage(args: {
  wageType: WageType;
  wageAmount: number | string | null | undefined;
  monthlyStandardHours: number;
  dailyHours?: number; // 기본 8h
}): { hourly: number | null; daily: number | null; monthly: number | null } {
  const amount = Number(args.wageAmount);
  if (!isFinite(amount) || amount <= 0) {
    return { hourly: null, daily: null, monthly: null };
  }
  const dailyHours = args.dailyHours && args.dailyHours > 0 ? args.dailyHours : 8;
  const stdHours = args.monthlyStandardHours > 0 ? args.monthlyStandardHours : FULLTIME_STANDARD_HOURS;

  if (args.wageType === "hourly") {
    return { hourly: amount, daily: amount * dailyHours, monthly: amount * stdHours };
  }
  if (args.wageType === "monthly") {
    const h = amount / stdHours;
    return { hourly: h, daily: h * dailyHours, monthly: amount };
  }
  if (args.wageType === "daily") {
    const h = amount / dailyHours;
    return { hourly: h, daily: amount, monthly: h * stdHours };
  }
  return { hourly: null, daily: null, monthly: null };
}
