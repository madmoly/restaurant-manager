/**
 * 인건비 계산 공통 헬퍼
 *
 * 통일 원칙:
 * - 월급제 시급 환산은 직원의 weeklyHours 기준으로 분모 자동 산출
 * - noWeeklyHolidayPay=true 시 주휴 미포함 분모, false 시 주휴 포함 분모
 * - weeklyHours 결측 시 209h 풀타임 표준으로 폴백
 *
 * 사용처:
 * - server/routers/schedules.ts:laborCostByCompany (월 인건비 집계)
 * - server/routers/dailyClosings.ts:estimate (일마감 자동계산)
 * - server/routers/monthlyClosings.ts:sumLaborByCompany (월정산 합계)
 */

const WEEKS_PER_MONTH = 365 / 12 / 7; // ≈ 4.345
const FULLTIME_STANDARD_HOURS = 209;   // 주40h × 4.345 + 주휴8h × 4.345 ≈ 209

/**
 * 월 통상임금 산정시간 (직원별).
 * @param weeklyHours 주 소정근로시간 (단시간근로자 기준 실 근무시간)
 * @param noWeeklyHolidayPay true면 주휴 미포함 분모, false면 주휴 포함
 * @returns 월 통상임금 산정시간 (시간 단위)
 */
export function computeMonthlyStandardHours(
  weeklyHours: number | string | null | undefined,
  noWeeklyHolidayPay: boolean = false,
): number {
  const wh = Number(weeklyHours);
  if (!isFinite(wh) || wh <= 0) return FULLTIME_STANDARD_HOURS;
  const weeklyHoliday = noWeeklyHolidayPay ? 0 : wh / 5; // 주휴 = 주근로/5 (주5일 환산)
  return (wh + weeklyHoliday) * WEEKS_PER_MONTH;
}

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
