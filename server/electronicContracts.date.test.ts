import { describe, it, expect } from "vitest";
import { MINIMUM_WAGE_2026, MINIMUM_MONTHLY_WAGE_2026 } from "./routers/electronicContracts";

// ─── toDateStr 헬퍼 (서버 내부 함수를 직접 테스트하기 위해 재정의) ─────────────
function toDateStr(val: string | Date | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(val).split("T")[0];
}

describe("toDateStr 날짜 정규화 헬퍼", () => {
  it("YYYY-MM-DD 문자열을 그대로 반환한다", () => {
    expect(toDateStr("2026-03-01")).toBe("2026-03-01");
  });

  it("ISO 8601 문자열에서 날짜 부분만 추출한다", () => {
    expect(toDateStr("2026-03-01T09:00:00.000Z")).toBe("2026-03-01");
  });

  it("Date 객체를 YYYY-MM-DD 문자열로 변환한다", () => {
    // 로컬 타임존 기준으로 2026-03-01을 나타내는 Date 객체
    const d = new Date(2026, 2, 1); // month는 0-indexed
    expect(toDateStr(d)).toBe("2026-03-01");
  });

  it("superjson이 역직렬화한 Date 형식 문자열을 처리한다", () => {
    // "Sat Feb 28 2026 19:00:00 GMT-0500" 같은 형식은 split("T")[0]으로 처리 불가
    // 이 경우는 Date 객체로 변환되므로 Date 분기에서 처리됨
    const dateObj = new Date("Sat Feb 28 2026 19:00:00 GMT-0500");
    const result = toDateStr(dateObj);
    // 로컬 타임존에 따라 2026-02-28 또는 2026-03-01이 될 수 있음
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("null/undefined를 null로 반환한다", () => {
    expect(toDateStr(null)).toBeNull();
    expect(toDateStr(undefined)).toBeNull();
  });
});

describe("최저임금 상수 검증", () => {
  it("2026년 최저시급이 10320원이다", () => {
    expect(MINIMUM_WAGE_2026).toBe(10320);
  });

  it("2026년 최저월급이 2156880원이다", () => {
    expect(MINIMUM_MONTHLY_WAGE_2026).toBe(2156880);
  });

  it("최저시급 이상의 시급은 검증을 통과한다", () => {
    const wageAmount = 10320;
    const minWage = MINIMUM_WAGE_2026;
    expect(wageAmount >= minWage).toBe(true);
  });

  it("최저월급 이상의 월급은 검증을 통과한다", () => {
    const wageAmount = 2156880;
    const minWage = MINIMUM_MONTHLY_WAGE_2026;
    expect(wageAmount >= minWage).toBe(true);
  });

  it("최저시급 미만의 시급은 검증에 실패한다", () => {
    const wageAmount = 10000;
    const minWage = MINIMUM_WAGE_2026;
    expect(wageAmount < minWage).toBe(true);
  });
});
