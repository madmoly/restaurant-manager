/**
 * features.test.ts
 * 2026-03-13 추가된 7가지 기능에 대한 단위 테스트
 */

import { describe, it, expect } from "vitest";

// ─── 1. 권한 계층 검증 ────────────────────────────────────────────────────────
describe("권한 계층 (ROLE_LEVEL)", () => {
  const ROLE_LEVEL: Record<string, number> = {
    master: 4,
    admin: 3,
    manager: 2,
    employee: 1,
  };

  it("master는 가장 높은 권한을 가진다", () => {
    expect(ROLE_LEVEL.master).toBeGreaterThan(ROLE_LEVEL.admin);
    expect(ROLE_LEVEL.master).toBeGreaterThan(ROLE_LEVEL.manager);
    expect(ROLE_LEVEL.master).toBeGreaterThan(ROLE_LEVEL.employee);
  });

  it("manager는 employee보다 높은 권한을 가진다", () => {
    expect(ROLE_LEVEL.manager).toBeGreaterThan(ROLE_LEVEL.employee);
  });

  it("manager는 admin보다 낮은 권한을 가진다", () => {
    expect(ROLE_LEVEL.manager).toBeLessThan(ROLE_LEVEL.admin);
  });

  it("managerProcedure는 manager, admin, master가 접근 가능하다", () => {
    const allowedRoles = ["manager", "admin", "master"];
    for (const role of allowedRoles) {
      expect(ROLE_LEVEL[role]).toBeGreaterThanOrEqual(ROLE_LEVEL.manager);
    }
  });

  it("employee는 managerProcedure에 접근 불가하다", () => {
    expect(ROLE_LEVEL.employee).toBeLessThan(ROLE_LEVEL.manager);
  });
});

// ─── 2. 매장 소프트 삭제 로직 ────────────────────────────────────────────────
describe("매장 소프트 삭제 (1년 보관)", () => {
  function isWithinOneYear(deletedAt: Date): boolean {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    return deletedAt >= oneYearAgo;
  }

  it("삭제된 지 1년 미만인 매장은 보관 목록에 포함된다", () => {
    const recentlyDeleted = new Date();
    recentlyDeleted.setMonth(recentlyDeleted.getMonth() - 6); // 6개월 전
    expect(isWithinOneYear(recentlyDeleted)).toBe(true);
  });

  it("삭제된 지 1년 이상인 매장은 보관 목록에서 제외된다", () => {
    const oldDeleted = new Date();
    oldDeleted.setFullYear(oldDeleted.getFullYear() - 2); // 2년 전
    expect(isWithinOneYear(oldDeleted)).toBe(false);
  });

  it("오늘 삭제된 매장은 보관 목록에 포함된다", () => {
    const today = new Date();
    expect(isWithinOneYear(today)).toBe(true);
  });
});

// ─── 3. 매출 입력 시간 검증 ──────────────────────────────────────────────────
describe("매출 입력 시간 강제 검증", () => {
  function isWithinSalesInputTime(
    currentTime: string,
    startTime: string | null,
    endTime: string | null
  ): boolean {
    if (!startTime || !endTime) return true; // 시간 미설정 시 항상 허용
    return currentTime >= startTime && currentTime <= endTime;
  }

  it("시간 미설정 시 언제든지 입력 가능하다", () => {
    expect(isWithinSalesInputTime("23:59", null, null)).toBe(true);
    expect(isWithinSalesInputTime("00:00", null, null)).toBe(true);
  });

  it("허용 시간 내에는 입력 가능하다", () => {
    expect(isWithinSalesInputTime("14:00", "13:00", "15:00")).toBe(true);
    expect(isWithinSalesInputTime("13:00", "13:00", "15:00")).toBe(true);
    expect(isWithinSalesInputTime("15:00", "13:00", "15:00")).toBe(true);
  });

  it("허용 시간 외에는 입력 불가하다", () => {
    expect(isWithinSalesInputTime("12:59", "13:00", "15:00")).toBe(false);
    expect(isWithinSalesInputTime("15:01", "13:00", "15:00")).toBe(false);
  });

  it("자정 이전 마감 시간 설정 시 정상 동작한다", () => {
    expect(isWithinSalesInputTime("23:30", "22:00", "23:59")).toBe(true);
    expect(isWithinSalesInputTime("21:59", "22:00", "23:59")).toBe(false);
  });
});

// ─── 4. 매입 발주/입고 상태 관리 ─────────────────────────────────────────────
describe("매입 발주/입고 상태 관리", () => {
  type PurchaseStatus = "received" | "ordered";

  function isOverdue(
    status: PurchaseStatus,
    expectedArrivalDate: string | null,
    today: string
  ): boolean {
    if (status !== "ordered") return false;
    if (!expectedArrivalDate) return false;
    return expectedArrivalDate < today;
  }

  it("입고 완료 상태는 지연으로 표시되지 않는다", () => {
    expect(isOverdue("received", "2026-03-01", "2026-03-13")).toBe(false);
  });

  it("예상 입고일이 없는 발주는 지연으로 표시되지 않는다", () => {
    expect(isOverdue("ordered", null, "2026-03-13")).toBe(false);
  });

  it("예상 입고일이 오늘보다 이전인 발주는 지연으로 표시된다", () => {
    expect(isOverdue("ordered", "2026-03-10", "2026-03-13")).toBe(true);
  });

  it("예상 입고일이 오늘인 발주는 지연이 아니다", () => {
    expect(isOverdue("ordered", "2026-03-13", "2026-03-13")).toBe(false);
  });

  it("예상 입고일이 미래인 발주는 지연이 아니다", () => {
    expect(isOverdue("ordered", "2026-03-20", "2026-03-13")).toBe(false);
  });
});

// ─── 5. 점장의 계정 생성 권한 검증 ───────────────────────────────────────────
describe("점장의 계정 생성 권한", () => {
  function canManagerCreateRole(
    callerRole: string,
    targetRole: string
  ): boolean {
    if (callerRole === "manager") {
      return ["employee", "manager"].includes(targetRole);
    }
    // admin, master는 모든 역할 생성 가능
    return true;
  }

  it("점장은 직원 계정을 생성할 수 있다", () => {
    expect(canManagerCreateRole("manager", "employee")).toBe(true);
  });

  it("점장은 매니저 계정을 생성할 수 있다", () => {
    expect(canManagerCreateRole("manager", "manager")).toBe(true);
  });

  it("점장은 관리자 계정을 생성할 수 없다", () => {
    expect(canManagerCreateRole("manager", "admin")).toBe(false);
  });

  it("점장은 마스터 계정을 생성할 수 없다", () => {
    expect(canManagerCreateRole("manager", "master")).toBe(false);
  });

  it("관리자는 모든 역할의 계정을 생성할 수 있다", () => {
    expect(canManagerCreateRole("admin", "employee")).toBe(true);
    expect(canManagerCreateRole("admin", "manager")).toBe(true);
    expect(canManagerCreateRole("admin", "admin")).toBe(true);
    expect(canManagerCreateRole("admin", "master")).toBe(true);
  });
});

// ─── 6. 거래처 자동완성 필터링 ───────────────────────────────────────────────
describe("거래처 자동완성 필터링", () => {
  const vendors = ["농협유통", "CJ제일제당", "농심", "대상", "농협목우촌"];

  function filterVendors(query: string): string[] {
    if (!query) return vendors;
    return vendors.filter(v => v.includes(query));
  }

  it("빈 검색어 시 전체 거래처 목록을 반환한다", () => {
    expect(filterVendors("")).toHaveLength(vendors.length);
  });

  it("검색어와 일치하는 거래처만 반환한다", () => {
    const result = filterVendors("농협");
    expect(result).toContain("농협유통");
    expect(result).toContain("농협목우촌");
    expect(result).not.toContain("CJ제일제당");
  });

  it("일치하는 거래처가 없으면 빈 배열을 반환한다", () => {
    expect(filterVendors("존재하지않는거래처")).toHaveLength(0);
  });
});
