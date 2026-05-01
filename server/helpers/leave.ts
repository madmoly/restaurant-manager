/**
 * 연차 발생 일정 계산 (입사일 기준)
 *
 * 정책 (근로기준법 단순화):
 * - 입사 후 1년 미만: 매월 입사일 같은 일에 1일씩 발생 (최대 11일)
 * - 입사 후 1년 이상: 매년 입사일에 15일 발생
 *
 * 본 헬퍼는 표시용 계산만 한다. 실제 leave_transactions earn row를
 * 자동 INSERT하지는 않음 (수동 등록 흐름 유지).
 */

const MS_PER_DAY = 86400 * 1000;

export type AnnualAccrual = {
  yearsServed: number;
  totalAccruedToDate: number; // 입사 후 현재까지 누적 발생량
  nextAccrualDate: string;    // YYYY-MM-DD
  nextAccrualAmount: number;  // 다음 발생 일수
  policy: "monthly_first_year" | "yearly_after";
};

export function computeAnnualAccrual(
  hireDate: Date | string | null | undefined,
  asOf: Date = new Date(),
): AnnualAccrual | null {
  if (!hireDate) return null;
  const hire = hireDate instanceof Date ? hireDate : new Date(hireDate);
  if (isNaN(hire.getTime())) return null;
  if (asOf.getTime() < hire.getTime()) return null;

  const daysServed = Math.floor((asOf.getTime() - hire.getTime()) / MS_PER_DAY);
  const yearsServed = Math.floor(daysServed / 365);

  if (yearsServed < 1) {
    // 1년 미만: 매월 입사일에 1일 발생, 최대 11일
    const monthsServed = monthsBetween(hire, asOf);
    const totalAccruedToDate = Math.min(monthsServed, 11);
    const nextDate = addMonths(hire, monthsServed + 1);
    return {
      yearsServed: 0,
      totalAccruedToDate,
      nextAccrualDate: toISODate(nextDate),
      nextAccrualAmount: 1,
      policy: "monthly_first_year",
    };
  }

  // 1년 이상: 매년 입사일에 15일
  const totalAccruedToDate = 15 * yearsServed;
  const nextDate = new Date(hire);
  nextDate.setFullYear(hire.getFullYear() + yearsServed + 1);
  return {
    yearsServed,
    totalAccruedToDate,
    nextAccrualDate: toISODate(nextDate),
    nextAccrualAmount: 15,
    policy: "yearly_after",
  };
}

function monthsBetween(a: Date, b: Date): number {
  const m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  return b.getDate() < a.getDate() ? m - 1 : m;
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  const day = x.getDate();
  x.setMonth(x.getMonth() + n);
  // setMonth가 일자가 더 적은 달로 이동 시 다음달로 넘어가는 보정
  if (x.getDate() !== day) x.setDate(0);
  return x;
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
