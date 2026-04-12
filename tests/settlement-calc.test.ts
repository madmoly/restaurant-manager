/**
 * 매출/정산 계산 로직 단위 테스트
 *
 * 테스트 대상: 순수 계산 함수 (DB 비의존)
 * - profit 계산: 매출 - 매입 - 인건비 - 고정비 - 즉시지출
 * - 비율 지표: costRatio, laborRatio, profitRatio
 * - 시급 변환: 월급 ÷ 209시간
 * - 근무시간 계산: (종료 - 시작 - 휴식) 분 기반
 * - 일당 계산: 시급 × 근무시간
 *
 * 현재 이 로직들은 dailyClosings.ts, monthlyClosings.ts의 라우터 내부에
 * 인라인으로 존재하므로 순수 함수로 추출하여 테스트한다.
 * → TODO: server/lib/settlement.ts로 추출 후 직접 import 전환
 */
import { describe, it, expect } from "vitest";

// ─── 추출 대상 순수 함수들 ─────────────────────────────────────────────────────

/** 이익 계산 */
function calcProfit(
  salesTotal: number,
  purchasesTotal: number,
  laborCost: number,
  fixedCostsTotal: number,
  expensesTotal: number = 0,
): number {
  return salesTotal - purchasesTotal - laborCost - fixedCostsTotal - expensesTotal;
}

/** 비율 계산 (% 단위, 소수 1자리) */
function calcRatio(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/** 월급→시급 변환 (209시간 기준) */
function monthlyToHourly(monthlySalary: number): number {
  return Math.round(monthlySalary / 209);
}

/** 근무시간 계산 (분 단위 → 시간) */
function calcWorkHours(
  startMinutes: number,
  endMinutes: number,
  breakMinutes: number = 0,
): number {
  let diff = endMinutes - startMinutes;
  // 자정 넘김 처리
  if (diff < 0) diff += 24 * 60;
  return Math.max(0, (diff - breakMinutes) / 60);
}

/** 일급 계산 */
function calcDailyPay(
  hourlyWage: number,
  workHours: number,
): number {
  return Math.round(hourlyWage * workHours);
}

/** 시간 문자열 → 분 변환 ("HH:MM" → minutes) */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

// ─── 테스트 ───────────────────────────────────────────────────────────────────

describe("이익 계산 (calcProfit)", () => {
  it("기본 케이스: 매출 - 매입 - 인건비 - 고정비", () => {
    expect(calcProfit(1_000_000, 300_000, 200_000, 100_000)).toBe(400_000);
  });

  it("즉시지출 포함", () => {
    expect(calcProfit(1_000_000, 300_000, 200_000, 100_000, 50_000)).toBe(350_000);
  });

  it("적자 (음수 이익)", () => {
    expect(calcProfit(500_000, 300_000, 200_000, 100_000)).toBe(-100_000);
  });

  it("매출 0일 때", () => {
    expect(calcProfit(0, 100_000, 50_000, 30_000)).toBe(-180_000);
  });

  it("모든 비용 0이면 매출 = 이익", () => {
    expect(calcProfit(1_000_000, 0, 0, 0)).toBe(1_000_000);
  });
});

describe("비율 계산 (calcRatio)", () => {
  it("기본 비율 계산", () => {
    expect(calcRatio(300_000, 1_000_000)).toBe(30.0);
  });

  it("매출 0이면 비율 0 (ZeroDivision 방지)", () => {
    expect(calcRatio(300_000, 0)).toBe(0);
  });

  it("100% 케이스", () => {
    expect(calcRatio(1_000_000, 1_000_000)).toBe(100.0);
  });

  it("소수점 반올림", () => {
    // 333333 / 1000000 = 33.3333% → 33.3
    expect(calcRatio(333_333, 1_000_000)).toBe(33.3);
  });
});

describe("월급→시급 변환", () => {
  it("최저임금 기준 (2026년 예상 약 220만원 기준)", () => {
    const hourly = monthlyToHourly(2_200_000);
    // 2200000 / 209 ≈ 10526
    expect(hourly).toBe(10526);
  });

  it("300만원 월급", () => {
    expect(monthlyToHourly(3_000_000)).toBe(14354); // 3000000/209 ≈ 14354.07
  });

  it("0원 → 시급 0", () => {
    expect(monthlyToHourly(0)).toBe(0);
  });
});

describe("근무시간 계산 (calcWorkHours)", () => {
  it("9시~18시, 휴식 60분 = 8시간", () => {
    expect(calcWorkHours(9 * 60, 18 * 60, 60)).toBe(8);
  });

  it("10시~22시, 휴식 30분 = 11.5시간", () => {
    expect(calcWorkHours(10 * 60, 22 * 60, 30)).toBe(11.5);
  });

  it("자정 넘김: 22시~06시, 휴식 0분 = 8시간", () => {
    expect(calcWorkHours(22 * 60, 6 * 60, 0)).toBe(8);
  });

  it("자정 넘김: 20시~02시, 휴식 30분 = 5.5시간", () => {
    expect(calcWorkHours(20 * 60, 2 * 60, 30)).toBe(5.5);
  });

  it("휴식이 근무시간 초과 시 0 반환", () => {
    expect(calcWorkHours(10 * 60, 14 * 60, 300)).toBe(0);
  });

  it("시작=종료 → 0시간 (0분)", () => {
    expect(calcWorkHours(10 * 60, 10 * 60, 0)).toBe(0);
  });
});

describe("일급 계산 (calcDailyPay)", () => {
  it("시급 10000 × 8시간 = 80000", () => {
    expect(calcDailyPay(10_000, 8)).toBe(80_000);
  });

  it("소수점 시간: 시급 12000 × 5.5시간 = 66000", () => {
    expect(calcDailyPay(12_000, 5.5)).toBe(66_000);
  });

  it("0시간 → 0원", () => {
    expect(calcDailyPay(10_000, 0)).toBe(0);
  });
});

describe("timeToMinutes", () => {
  it("09:00 → 540", () => {
    expect(timeToMinutes("09:00")).toBe(540);
  });

  it("22:30 → 1350", () => {
    expect(timeToMinutes("22:30")).toBe(1350);
  });

  it("00:00 → 0", () => {
    expect(timeToMinutes("00:00")).toBe(0);
  });

  it("23:59 → 1439", () => {
    expect(timeToMinutes("23:59")).toBe(1439);
  });
});

// ─── 통합 시나리오 ────────────────────────────────────────────────────────────

describe("일마감 시나리오", () => {
  it("시급직 3명 + 월급직 1명의 일일 인건비 계산", () => {
    // 시급직 A: 10000원/시 × 8시간
    const payA = calcDailyPay(10_000, calcWorkHours(timeToMinutes("09:00"), timeToMinutes("18:00"), 60));
    // 시급직 B: 11000원/시 × 6시간
    const payB = calcDailyPay(11_000, calcWorkHours(timeToMinutes("10:00"), timeToMinutes("16:30"), 30));
    // 시급직 C: 10000원/시 × 4시간 (반일)
    const payC = calcDailyPay(10_000, calcWorkHours(timeToMinutes("14:00"), timeToMinutes("18:00"), 0));
    // 월급직 D: 월 280만원 → 일급 = 시급(13397) × 8시간
    const hourlyD = monthlyToHourly(2_800_000);
    const payD = calcDailyPay(hourlyD, 8);

    const totalLabor = payA + payB + payC + payD;

    expect(payA).toBe(80_000);
    expect(payB).toBe(66_000);
    expect(payC).toBe(40_000);
    expect(hourlyD).toBe(13397); // 2800000/209 반올림
    expect(payD).toBe(107_176);
    expect(totalLabor).toBe(293_176);
  });

  it("일일 수익성 전체 계산", () => {
    const sales = 1_500_000;
    const purchases = 450_000;
    const labor = 293_176;
    const fixedCostDaily = Math.round(3_000_000 / 30); // 월 고정비 300만 / 30일

    const profit = calcProfit(sales, purchases, labor, fixedCostDaily);
    const costRatio = calcRatio(purchases, sales);
    const laborRatio = calcRatio(labor, sales);
    const profitRatio = calcRatio(profit, sales);

    expect(costRatio).toBe(30.0);
    expect(laborRatio).toBe(19.5); // 293176/1500000 ≈ 19.5%
    expect(profit).toBe(656_824);
    expect(profitRatio).toBe(43.8); // 656824/1500000 ≈ 43.8%
  });
});

describe("월정산 시나리오", () => {
  it("30일 데이터 합산 후 비율 계산", () => {
    const monthlySales = 45_000_000;
    const monthlyPurchases = 13_500_000;
    const monthlyLabor = 8_800_000;
    const monthlyFixed = 3_000_000;
    const monthlyExpenses = 500_000;

    const profit = calcProfit(monthlySales, monthlyPurchases, monthlyLabor, monthlyFixed, monthlyExpenses);
    const costRatio = calcRatio(monthlyPurchases, monthlySales);
    const laborRatio = calcRatio(monthlyLabor, monthlySales);
    const profitRatio = calcRatio(profit, monthlySales);

    expect(profit).toBe(19_200_000);
    expect(costRatio).toBe(30.0);
    expect(laborRatio).toBe(19.6); // 8800000/45000000
    expect(profitRatio).toBe(42.7); // 19200000/45000000
  });
});
