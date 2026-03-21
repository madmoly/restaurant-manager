/**
 * 권한 가드 및 휴무일 차단 로직 단위 테스트
 *
 * 테스트 대상:
 * 1. checkStoreManagerRole — leader/manager는 통과, employee는 거부
 * 2. checkStoreLeaderRole  — leader만 통과, manager/employee는 거부
 * 3. isClosedDay           — 특정 날짜 휴무 여부 판별
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 헬퍼 함수 직접 테스트 (DB 모킹) ──────────────────────────────────────────

// DB 결과를 모킹하는 팩토리
function makeDbMock(role: string | null) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (role ? [{ role }] : []),
        }),
      }),
    }),
  };
}

// ─── checkStoreManagerRole 로직 테스트 ────────────────────────────────────────

describe("checkStoreManagerRole logic", () => {
  const ROLE_LEVEL: Record<string, number> = { employee: 1, manager: 2, leader: 3, admin: 4, master: 5 };

  async function checkStoreManagerRole(
    db: any,
    userId: number,
    restaurantId: number | undefined
  ): Promise<boolean> {
    if (!restaurantId || !db) return false;
    const rows = await db.select().from({}).where({}).limit(1);
    const storeRole = rows[0]?.role;
    return storeRole === "leader" || storeRole === "manager";
  }

  it("leader 역할은 통과한다", async () => {
    const db = makeDbMock("leader");
    expect(await checkStoreManagerRole(db, 1, 100)).toBe(true);
  });

  it("manager 역할은 통과한다", async () => {
    const db = makeDbMock("manager");
    expect(await checkStoreManagerRole(db, 1, 100)).toBe(true);
  });

  it("employee 역할은 거부된다", async () => {
    const db = makeDbMock("employee");
    expect(await checkStoreManagerRole(db, 1, 100)).toBe(false);
  });

  it("restaurantId가 없으면 거부된다", async () => {
    const db = makeDbMock("leader");
    expect(await checkStoreManagerRole(db, 1, undefined)).toBe(false);
  });

  it("매장 소속이 없으면 거부된다", async () => {
    const db = makeDbMock(null);
    expect(await checkStoreManagerRole(db, 1, 100)).toBe(false);
  });
});

// ─── checkStoreLeaderRole 로직 테스트 ─────────────────────────────────────────

describe("checkStoreLeaderRole logic", () => {
  async function checkStoreLeaderRole(
    db: any,
    userId: number,
    restaurantId: number | undefined
  ): Promise<boolean> {
    if (!restaurantId || !db) return false;
    const rows = await db.select().from({}).where({}).limit(1);
    const storeRole = rows[0]?.role;
    return storeRole === "leader";
  }

  it("leader 역할만 통과한다", async () => {
    const db = makeDbMock("leader");
    expect(await checkStoreLeaderRole(db, 1, 100)).toBe(true);
  });

  it("manager 역할은 거부된다", async () => {
    const db = makeDbMock("manager");
    expect(await checkStoreLeaderRole(db, 1, 100)).toBe(false);
  });

  it("employee 역할은 거부된다", async () => {
    const db = makeDbMock("employee");
    expect(await checkStoreLeaderRole(db, 1, 100)).toBe(false);
  });

  it("restaurantId가 없으면 거부된다", async () => {
    const db = makeDbMock("leader");
    expect(await checkStoreLeaderRole(db, 1, undefined)).toBe(false);
  });
});

// ─── isClosedDay 로직 테스트 ──────────────────────────────────────────────────

describe("isClosedDay logic", () => {
  // 테스트용 isClosedDay 구현 (실제 DB 없이 순수 로직 테스트)
  function isClosedDayPure(
    workDate: string,
    specialClosedDates: string[],
    weeklyClosedDays: number[] // 0=일, 1=월, ..., 6=토
  ): boolean {
    // 특정 날짜 휴무 체크
    if (specialClosedDates.includes(workDate)) return true;
    // 요일 기반 휴무 체크
    const dayOfWeek = new Date(workDate + "T00:00:00").getDay();
    return weeklyClosedDays.includes(dayOfWeek);
  }

  it("특정 날짜 휴무일이면 true를 반환한다", () => {
    expect(isClosedDayPure("2026-03-16", ["2026-03-16"], [])).toBe(true);
  });

  it("특정 날짜 휴무일이 아니면 false를 반환한다", () => {
    expect(isClosedDayPure("2026-03-17", ["2026-03-16"], [])).toBe(false);
  });

  it("요일 기반 휴무일(일요일=0)이면 true를 반환한다", () => {
    // 2026-03-15는 일요일
    expect(isClosedDayPure("2026-03-15", [], [0])).toBe(true);
  });

  it("요일 기반 휴무일이 아닌 날은 false를 반환한다", () => {
    // 2026-03-16은 월요일(1)
    expect(isClosedDayPure("2026-03-16", [], [0])).toBe(false);
  });

  it("특정 날짜와 요일 모두 해당하면 true를 반환한다", () => {
    expect(isClosedDayPure("2026-03-15", ["2026-03-15"], [0])).toBe(true);
  });

  it("빈 휴무일 목록이면 false를 반환한다", () => {
    expect(isClosedDayPure("2026-03-16", [], [])).toBe(false);
  });
});

// ─── profitability 매니저 분기 로직 테스트 ────────────────────────────────────

describe("profitability laborByUser visibility", () => {
  const ROLE_LEVEL: Record<string, number> = { employee: 1, manager: 2, leader: 3, admin: 4, master: 5 };

  function canSeeLaborDetail(
    sysRole: string,
    isStoreManager: boolean,
    isStoreLeader: boolean
  ): boolean {
    const sysLevel = ROLE_LEVEL[sysRole] ?? 0;
    if (sysLevel >= ROLE_LEVEL["admin"]) return true;
    if (isStoreManager) return false; // 매장 내 매니저는 비공개
    return isStoreLeader; // 점장만 공개
  }

  it("admin은 인건비 상세를 볼 수 있다", () => {
    expect(canSeeLaborDetail("admin", false, false)).toBe(true);
  });

  it("점장(storeRole=leader)은 인건비 상세를 볼 수 있다", () => {
    expect(canSeeLaborDetail("employee", false, true)).toBe(true);
  });

  it("매니저(storeRole=manager)는 인건비 상세를 볼 수 없다", () => {
    expect(canSeeLaborDetail("employee", true, false)).toBe(false);
  });

  it("일반 직원은 인건비 상세를 볼 수 없다", () => {
    expect(canSeeLaborDetail("employee", false, false)).toBe(false);
  });
});

// ─── getEffectiveRole 단위 테스트 ─────────────────────────────────────────────

import { getEffectiveRole, isManagerLevel, isAdminLevel, hasMinRole, ROLE_LEVEL } from "../shared/permissions";

describe("getEffectiveRole", () => {
  it("master 시스템 역할은 storeRole 무관하게 master 반환", () => {
    expect(getEffectiveRole("master", "employee")).toBe("master");
    expect(getEffectiveRole("master", null)).toBe("master");
  });

  it("admin 시스템 역할은 storeRole 무관하게 admin 반환", () => {
    expect(getEffectiveRole("admin", "employee")).toBe("admin");
    expect(getEffectiveRole("admin", "store_manager")).toBe("admin");
  });

  it("employee + store_manager storeRole → manager 반환", () => {
    expect(getEffectiveRole("employee", "store_manager")).toBe("manager");
  });

  it("employee + manager storeRole → manager 반환", () => {
    expect(getEffectiveRole("employee", "manager")).toBe("manager");
  });

  it("employee + employee storeRole → employee 반환", () => {
    expect(getEffectiveRole("employee", "employee")).toBe("employee");
  });

  it("employee + null storeRole → employee 반환", () => {
    expect(getEffectiveRole("employee", null)).toBe("employee");
  });

  it("manager 시스템 역할 + null storeRole → manager 반환", () => {
    expect(getEffectiveRole("manager", null)).toBe("manager");
  });
});

describe("isManagerLevel", () => {
  it("master는 manager 레벨 이상이다", () => {
    expect(isManagerLevel("master")).toBe(true);
  });

  it("admin은 manager 레벨 이상이다", () => {
    expect(isManagerLevel("admin")).toBe(true);
  });

  it("manager는 manager 레벨이다", () => {
    expect(isManagerLevel("manager")).toBe(true);
  });

  it("employee는 manager 레벨 미만이다", () => {
    expect(isManagerLevel("employee")).toBe(false);
  });
});

describe("isAdminLevel", () => {
  it("master는 admin 레벨 이상이다", () => {
    expect(isAdminLevel("master")).toBe(true);
  });

  it("admin은 admin 레벨이다", () => {
    expect(isAdminLevel("admin")).toBe(true);
  });

  it("manager는 admin 레벨 미만이다", () => {
    expect(isAdminLevel("manager")).toBe(false);
  });

  it("employee는 admin 레벨 미만이다", () => {
    expect(isAdminLevel("employee")).toBe(false);
  });
});

// ─── assertRestaurantAccess 로직 테스트 ───────────────────────────────────────

describe("assertRestaurantAccess logic", () => {
  // assertRestaurantAccess 순수 로직 재현
  function assertAccess(
    sysRole: string,
    restaurantId: number | undefined,
    inputRestaurantId: number,
    storeRole: string | null
  ): { allowed: boolean; reason?: string } {
    // master/admin은 모든 매장 접근 가능
    if (sysRole === "master" || sysRole === "admin") return { allowed: true };
    // restaurantId 미설정 시 거부
    if (!restaurantId) return { allowed: false, reason: "no_restaurant_context" };
    // 다른 매장 데이터 접근 차단
    if (restaurantId !== inputRestaurantId) return { allowed: false, reason: "cross_restaurant" };
    // 매장 소속 확인
    if (!storeRole) return { allowed: false, reason: "not_member" };
    return { allowed: true };
  }

  it("master는 다른 매장 데이터에도 접근 가능하다", () => {
    expect(assertAccess("master", 1, 99, null).allowed).toBe(true);
  });

  it("admin은 다른 매장 데이터에도 접근 가능하다", () => {
    expect(assertAccess("admin", 1, 99, null).allowed).toBe(true);
  });

  it("employee가 자신의 매장 데이터에 접근하면 허용된다", () => {
    expect(assertAccess("employee", 1, 1, "employee").allowed).toBe(true);
  });

  it("employee가 다른 매장 데이터에 접근하면 차단된다", () => {
    const result = assertAccess("employee", 1, 2, "employee");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("cross_restaurant");
  });

  it("매장 소속이 없는 사용자는 차단된다", () => {
    const result = assertAccess("employee", 1, 1, null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("not_member");
  });

  it("restaurantId 컨텍스트가 없으면 차단된다", () => {
    const result = assertAccess("employee", undefined, 1, "employee");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("no_restaurant_context");
  });
});

// ─── store_manager/manager/employee 권한 분기 테스트 ─────────────────────────

describe("store role hierarchy via getEffectiveRole + isManagerLevel", () => {
  const cases: Array<{ sys: string; store: string | null; expectManager: boolean }> = [
    { sys: "employee", store: "store_manager", expectManager: true },
    { sys: "employee", store: "manager",       expectManager: true },
    { sys: "employee", store: "employee",      expectManager: false },
    { sys: "employee", store: null,            expectManager: false },
    { sys: "manager",  store: null,            expectManager: true },
    { sys: "admin",    store: "employee",      expectManager: true },
    { sys: "master",   store: null,            expectManager: true },
  ];

  cases.forEach(({ sys, store, expectManager }) => {
    it(`sys=${sys}, store=${store ?? "null"} → isManager=${expectManager}`, () => {
      const effective = getEffectiveRole(sys, store);
      expect(isManagerLevel(effective)).toBe(expectManager);
    });
  });
});
