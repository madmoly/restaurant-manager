/**
 * 인건비 계산 공통 헬퍼 (시프트 임금 / 가이드 환산만 담당)
 *
 * 재설계 2026-05-02:
 * - computeMonthlyStandardHours는 helpers/labor.ts로 이동 (5인 미만/이상 분기 위해 DB 의존)
 * - 본 파일은 순수 함수만 유지 (시프트 임금 합산, 가이드 시급 환산)
 *
 * 월급제 정산 정책 재설계 2026-05-02:
 * - computeProration 추가 (입사·퇴사 월 일할 보정, 달력일수 기준)
 * - computeMonthlyOnlyWage 추가 (월급제 직원 월말 일괄 합산: 일할 × 월급 - 미근무차감)
 *
 * 사용처:
 * - server/routers/schedules.ts:laborCostByCompany / workSummaryByEmployee
 * - server/routers/dailyClosings.ts:calculateDay (월급제 시프트 wage=0)
 * - server/routers/monthlyClosings.ts:sumLaborByCompany (일별 박제 SUM + 월말 월급제 일괄)
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

/**
 * 입사·퇴사 월 일할(prorate) 비율과 그에 따른 월급/소정근로시간 계산.
 *
 * 사양 §2.2 (a):
 *  - 입사 월: (입사일 ~ 월말 일수) / 월간 달력일수
 *  - 퇴사 월: (월초 ~ 퇴사일 일수) / 월간 달력일수
 *  - 동월 입·퇴사: 두 비율의 결합 (월 안에서 실재한 일수 / 달력일수)
 *  - 그 외 월: ratio = 1 (일할 미적용)
 *
 * 달력일수(28~31) 기준. 소정근로일 기반은 휴무일 정의 변동성이 있어 분쟁 소지.
 *
 * 입력 날짜는 'YYYY-MM-DD' (KST 기준 운영 SSOT). 잘못된 형식이거나 해당 월과 무관하면 ratio=1.
 */
export function computeProration(args: {
  hireDate: string | null | undefined;
  resignDate: string | null | undefined;
  year: number;
  month: number; // 1~12
  monthlyWage: number;
  stdHours?: number; // 기본 209
}): { ratio: number; proratedMonthlyWage: number; proratedStdHours: number } {
  const stdHours = args.stdHours && args.stdHours > 0 ? args.stdHours : FULLTIME_STANDARD_HOURS;
  const monthlyWage = Number(args.monthlyWage);
  const safeWage = isFinite(monthlyWage) && monthlyWage > 0 ? monthlyWage : 0;

  const daysInMonth = new Date(args.year, args.month, 0).getDate();
  // 월의 첫·마지막 일 (1-based)
  const monthStart = 1;
  const monthEnd = daysInMonth;

  let firstDay = monthStart;
  let lastDay = monthEnd;

  const parseYmd = (s: string): { y: number; m: number; d: number } | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  };

  if (args.hireDate) {
    const h = parseYmd(args.hireDate);
    if (h) {
      // 해당 월보다 이후 입사 → 본 함수는 미적용 시점이지만 안전하게 ratio=0 처리
      if (h.y > args.year || (h.y === args.year && h.m > args.month)) {
        return { ratio: 0, proratedMonthlyWage: 0, proratedStdHours: 0 };
      }
      // 같은 월 입사
      if (h.y === args.year && h.m === args.month) {
        firstDay = Math.max(monthStart, Math.min(monthEnd, h.d));
      }
      // 이전 월 입사 → firstDay 기본값 유지
    }
  }

  if (args.resignDate) {
    const r = parseYmd(args.resignDate);
    if (r) {
      // 해당 월보다 이전 퇴사 → ratio=0
      if (r.y < args.year || (r.y === args.year && r.m < args.month)) {
        return { ratio: 0, proratedMonthlyWage: 0, proratedStdHours: 0 };
      }
      // 같은 월 퇴사
      if (r.y === args.year && r.m === args.month) {
        lastDay = Math.max(monthStart, Math.min(monthEnd, r.d));
      }
      // 이후 월 퇴사 → lastDay 기본값 유지
    }
  }

  if (lastDay < firstDay) {
    return { ratio: 0, proratedMonthlyWage: 0, proratedStdHours: 0 };
  }

  const inMonthDays = lastDay - firstDay + 1;
  const ratio = daysInMonth > 0 ? inMonthDays / daysInMonth : 1;
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  return {
    ratio: clampedRatio,
    proratedMonthlyWage: safeWage * clampedRatio,
    proratedStdHours: stdHours * clampedRatio,
  };
}

/**
 * 월급제 직원의 월말 일괄 임금 합산 (정책 §2.2 / §2.3 / §3.4).
 *
 * 산식 (분모 209h 통일):
 *   expectedHours      = proratedStdHours = 209 × proration.ratio
 *   shortfall          = max(0, expectedHours - actualHours)
 *   shortfallDeduction = shortfall × (monthlyWage / 209)
 *   finalWage          = max(0, proratedMonthlyWage - shortfallDeduction)
 *
 * 입력:
 *   monthlyWage  계약월급 (원). 0 이하/유효하지 않으면 0 반환.
 *   actualHours  해당 월 실제 근무한 시프트 시간 합 (시급 환산용).
 *   hireDate     입사일 (YYYY-MM-DD). 일할 보정에 사용.
 *   resignDate   퇴사일 (YYYY-MM-DD). 일할 보정에 사용.
 *   year, month  대상 월.
 *   stdHours     기본 209. 계약서 박제값과 동일한 분모 사용.
 *
 * 반환:
 *   ratio                  proration 비율 (0~1)
 *   proratedMonthlyWage    일할 보정된 계약월급
 *   proratedStdHours       일할 보정된 소정근로시간 (= expectedHours)
 *   shortfallHours         미근무 시간 (max(0, expected - actual))
 *   shortfallDeduction     미근무 차감액
 *   finalWage              최종 월급 (0 이하 가드 적용)
 *
 * 사용처:
 * - server/routers/schedules.ts:laborCostByCompany (소속회사별 카드)
 * - server/routers/monthlyClosings.ts:sumLaborByCompany (월정산 합계)
 */
export function computeMonthlyOnlyWage(args: {
  monthlyWage: number | string | null | undefined;
  actualHours: number;
  hireDate: string | null | undefined;
  resignDate: string | null | undefined;
  year: number;
  month: number;
  stdHours?: number;
}): {
  ratio: number;
  proratedMonthlyWage: number;
  proratedStdHours: number;
  shortfallHours: number;
  shortfallDeduction: number;
  finalWage: number;
} {
  const stdHours = args.stdHours && args.stdHours > 0 ? args.stdHours : FULLTIME_STANDARD_HOURS;
  const monthlyWage = Number(args.monthlyWage);
  const safeWage = isFinite(monthlyWage) && monthlyWage > 0 ? monthlyWage : 0;
  const actualHours = Number(args.actualHours);
  const safeActual = isFinite(actualHours) && actualHours > 0 ? actualHours : 0;

  if (safeWage <= 0) {
    return {
      ratio: 0,
      proratedMonthlyWage: 0,
      proratedStdHours: 0,
      shortfallHours: 0,
      shortfallDeduction: 0,
      finalWage: 0,
    };
  }

  const proration = computeProration({
    hireDate: args.hireDate,
    resignDate: args.resignDate,
    year: args.year,
    month: args.month,
    monthlyWage: safeWage,
    stdHours,
  });

  const expectedHours = proration.proratedStdHours;
  const shortfallHours = Math.max(0, expectedHours - safeActual);
  const shortfallDeduction = shortfallHours * (safeWage / stdHours);
  const finalWage = Math.max(0, proration.proratedMonthlyWage - shortfallDeduction);

  return {
    ratio: proration.ratio,
    proratedMonthlyWage: proration.proratedMonthlyWage,
    proratedStdHours: expectedHours,
    shortfallHours,
    shortfallDeduction,
    finalWage,
  };
}
