/**
 * fixed-costs.test.ts
 * 고정비 기간 관리 및 만료 알림 기능 단위 테스트
 */

import { describe, it, expect } from "vitest";

// ─── 유틸 함수 (FixedCostsPage.tsx와 동일한 로직) ────────────────────────────

/** YYYY-MM-DD 형식 날짜 문자열을 로컈 자정 Date로 변환 */
function localMidnight(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 로컈 오늘 YYYY-MM-DD 문자열 */
function localTodayStr(): string {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const target = localMidnight(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = target.getTime() - today.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

function isExpiringSoon(endDate: string | null | undefined): boolean {
  const days = daysUntil(endDate);
  return days !== null && days >= 0 && days <= 30;
}

function getExpiringSoonItems(items: Array<{ id: number; costCategory: string; endDate: string | null }>) {
  const today = new Date();
  const in30days = new Date(today);
  in30days.setDate(in30days.getDate() + 30);
  const todayStr = today.toISOString().slice(0, 10);
  const in30Str = in30days.toISOString().slice(0, 10);
  return items.filter(item => {
    if (!item.endDate) return false;
    return item.endDate >= todayStr && item.endDate <= in30Str;
  });
}

// ─── 1. daysUntil 함수 테스트 ────────────────────────────────────────────────

describe("daysUntil 함수", () => {
  it("null을 입력하면 null을 반환한다 (상시 고정비)", () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil(undefined)).toBeNull();
  });

  it("오늘 날짜를 입력하면 0을 반환한다", () => {
    expect(daysUntil(localTodayStr())).toBe(0);
  });

  it("내일 날짜를 입력하면 1을 반환한다", () => {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    const y = t.getFullYear(), mo = String(t.getMonth()+1).padStart(2,'0'), d = String(t.getDate()).padStart(2,'0');
    expect(daysUntil(`${y}-${mo}-${d}`)).toBe(1);
  });

  it("30일 후 날짜를 입력하면 30을 반환한다", () => {
    const t = new Date();
    t.setDate(t.getDate() + 30);
    const y = t.getFullYear(), mo = String(t.getMonth()+1).padStart(2,'0'), d = String(t.getDate()).padStart(2,'0');
    expect(daysUntil(`${y}-${mo}-${d}`)).toBe(30);
  });

  it("과거 날짜를 입력하면 음수를 반환한다", () => {
    const t = new Date();
    t.setDate(t.getDate() - 10);
    const y = t.getFullYear(), mo = String(t.getMonth()+1).padStart(2,'0'), d = String(t.getDate()).padStart(2,'0');
    const result = daysUntil(`${y}-${mo}-${d}`);
    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(0);
  });
});

// ─── 2. isExpiringSoon 함수 테스트 ───────────────────────────────────────────

describe("isExpiringSoon 함수 (30일 이내 만료 여부)", () => {
  it("endDate가 null이면 만료 임박이 아니다 (상시 고정비)", () => {
    expect(isExpiringSoon(null)).toBe(false);
    expect(isExpiringSoon(undefined)).toBe(false);
  });

  it("오늘 만료되는 항목은 만료 임박으로 표시된다", () => {
    expect(isExpiringSoon(localTodayStr())).toBe(true);
  });

  it("29일 후 만료되는 항목은 만료 임박으로 표시된다", () => {
    const t = new Date(); t.setDate(t.getDate() + 29);
    const y = t.getFullYear(), mo = String(t.getMonth()+1).padStart(2,'0'), d = String(t.getDate()).padStart(2,'0');
    expect(isExpiringSoon(`${y}-${mo}-${d}`)).toBe(true);
  });

  it("30일 후 만료되는 항목은 만료 임박으로 표시된다 (경계값)", () => {
    const t = new Date(); t.setDate(t.getDate() + 30);
    const y = t.getFullYear(), mo = String(t.getMonth()+1).padStart(2,'0'), d = String(t.getDate()).padStart(2,'0');
    expect(isExpiringSoon(`${y}-${mo}-${d}`)).toBe(true);
  });

  it("31일 후 만료되는 항목은 만료 임박이 아니다", () => {
    const t = new Date(); t.setDate(t.getDate() + 31);
    const y = t.getFullYear(), mo = String(t.getMonth()+1).padStart(2,'0'), d = String(t.getDate()).padStart(2,'0');
    expect(isExpiringSoon(`${y}-${mo}-${d}`)).toBe(false);
  });

  it("이미 만료된 항목은 만료 임박이 아니다", () => {
    const t = new Date(); t.setDate(t.getDate() - 1);
    const y = t.getFullYear(), mo = String(t.getMonth()+1).padStart(2,'0'), d = String(t.getDate()).padStart(2,'0');
    expect(isExpiringSoon(`${y}-${mo}-${d}`)).toBe(false);
  });
});

// ─── 3. getExpiringSoonItems 필터링 테스트 ───────────────────────────────────

describe("getExpiringSoonItems 필터링", () => {
  const today = new Date();
  const makeDate = (daysOffset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + daysOffset);
    return d.toISOString().slice(0, 10);
  };

  const items = [
    { id: 1, costCategory: "임대료", endDate: makeDate(10) },    // 10일 후 → 포함
    { id: 2, costCategory: "공과금", endDate: makeDate(30) },    // 30일 후 → 포함
    { id: 3, costCategory: "수수료", endDate: makeDate(31) },    // 31일 후 → 미포함
    { id: 4, costCategory: "인건비", endDate: null },             // 상시 → 미포함
    { id: 5, costCategory: "기타", endDate: makeDate(-1) },       // 이미 만료 → 미포함
    { id: 6, costCategory: "청소비", endDate: makeDate(0) },     // 오늘 만료 → 포함
  ];

  it("30일 이내 만료 항목만 반환한다", () => {
    const result = getExpiringSoonItems(items);
    const ids = result.map(r => r.id);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids).toContain(6);
    expect(ids).not.toContain(3);
    expect(ids).not.toContain(4);
    expect(ids).not.toContain(5);
  });

  it("만료 임박 항목이 없으면 빈 배열을 반환한다", () => {
    const noExpiring = [
      { id: 1, costCategory: "임대료", endDate: null },
      { id: 2, costCategory: "공과금", endDate: makeDate(60) },
    ];
    expect(getExpiringSoonItems(noExpiring)).toHaveLength(0);
  });
});

// ─── 4. 고정비 기간 유효성 검사 ──────────────────────────────────────────────

describe("고정비 기간 유효성 검사", () => {
  function validateDateRange(startDate: string | undefined, endDate: string | undefined): { valid: boolean; error?: string } {
    if (!startDate && !endDate) return { valid: true }; // 둘 다 없으면 상시
    if (startDate && endDate && endDate < startDate) {
      return { valid: false, error: "종료일은 시작일 이후여야 합니다." };
    }
    return { valid: true };
  }

  it("시작일과 종료일이 모두 없으면 유효하다 (상시)", () => {
    expect(validateDateRange(undefined, undefined).valid).toBe(true);
  });

  it("시작일만 있으면 유효하다", () => {
    expect(validateDateRange("2026-01-01", undefined).valid).toBe(true);
  });

  it("종료일이 시작일보다 늦으면 유효하다", () => {
    expect(validateDateRange("2026-01-01", "2026-12-31").valid).toBe(true);
  });

  it("종료일이 시작일과 같으면 유효하다", () => {
    expect(validateDateRange("2026-06-01", "2026-06-01").valid).toBe(true);
  });

  it("종료일이 시작일보다 이르면 유효하지 않다", () => {
    const result = validateDateRange("2026-12-31", "2026-01-01");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─── 5. 고정비 표시 로직 ─────────────────────────────────────────────────────

describe("고정비 기간 표시 로직", () => {
  function getPeriodLabel(startDate: string | null, endDate: string | null): string {
    if (!endDate) return "상시";
    const start = startDate ?? "등록일";
    return `${start} ~ ${endDate}`;
  }

  it("endDate가 없으면 '상시'로 표시된다", () => {
    expect(getPeriodLabel(null, null)).toBe("상시");
    expect(getPeriodLabel("2026-01-01", null)).toBe("상시");
  });

  it("startDate와 endDate가 모두 있으면 기간을 표시한다", () => {
    expect(getPeriodLabel("2026-01-01", "2026-12-31")).toBe("2026-01-01 ~ 2026-12-31");
  });

  it("startDate가 없고 endDate만 있으면 '등록일 ~ endDate'로 표시된다", () => {
    expect(getPeriodLabel(null, "2026-12-31")).toBe("등록일 ~ 2026-12-31");
  });
});
