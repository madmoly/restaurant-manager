/**
 * 권한/인증 모델 단위 테스트
 *
 * 테스트 대상: shared/permissions.ts
 * - getEffectiveRole: 시스템역할 + 매장역할 → 유효역할 계산
 * - hasMinRole: 최소 역할 레벨 충족 여부
 * - isOwnerLevel: 점장 전용 기능 접근 (인건비/계약서/소속회사)
 * - canAccessPayroll: 급여/인건비 접근
 * - 레거시 역할명 호환 (store_manager, manager, employee)
 */
import { describe, it, expect } from "vitest";
import {
  getEffectiveRole,
  hasMinRole,
  isManagerLevel,
  isAdminLevel,
  isOwnerLevel,
  isMasterLevel,
  canAccessPayroll,
  canManageStaff,
  ROLE_LEVEL,
} from "../shared/permissions.js";

// ─── getEffectiveRole ────────────────────────────────────────────────────────

describe("getEffectiveRole", () => {
  it("master는 매장역할 무관하게 master 반환", () => {
    expect(getEffectiveRole("master", null)).toBe("master");
    expect(getEffectiveRole("master", "staff")).toBe("master");
    expect(getEffectiveRole("master", "owner")).toBe("master");
  });

  it("admin은 매장역할 무관하게 admin 반환", () => {
    expect(getEffectiveRole("admin", null)).toBe("admin");
    expect(getEffectiveRole("admin", "staff")).toBe("admin");
    expect(getEffectiveRole("admin", "owner")).toBe("admin");
  });

  it("user + owner/supervisor → manager로 상향", () => {
    expect(getEffectiveRole("user", "owner")).toBe("manager");
    expect(getEffectiveRole("user", "supervisor")).toBe("manager");
  });

  it("user + staff/null/undefined → staff", () => {
    expect(getEffectiveRole("user", "staff")).toBe("staff");
    expect(getEffectiveRole("user", null)).toBe("staff");
    expect(getEffectiveRole("user", undefined)).toBe("staff");
  });

  // 레거시 호환
  it("레거시 store_manager → manager로 인식", () => {
    expect(getEffectiveRole("user", "store_manager")).toBe("manager");
  });

  it("레거시 manager(매장역할) → manager로 인식", () => {
    expect(getEffectiveRole("user", "manager")).toBe("manager");
  });

  // 엣지 케이스: 잘못된 역할값
  it("알 수 없는 매장역할 → staff으로 폴백", () => {
    expect(getEffectiveRole("user", "unknown_role")).toBe("staff");
    expect(getEffectiveRole("user", "")).toBe("staff");
  });
});

// ─── hasMinRole ──────────────────────────────────────────────────────────────

describe("hasMinRole", () => {
  it("동일 레벨은 통과", () => {
    expect(hasMinRole("master", "master")).toBe(true);
    expect(hasMinRole("admin", "admin")).toBe(true);
    expect(hasMinRole("manager", "manager")).toBe(true);
    expect(hasMinRole("staff", "staff")).toBe(true);
  });

  it("상위 레벨은 하위 레벨 통과", () => {
    expect(hasMinRole("master", "admin")).toBe(true);
    expect(hasMinRole("master", "staff")).toBe(true);
    expect(hasMinRole("admin", "manager")).toBe(true);
    expect(hasMinRole("manager", "staff")).toBe(true);
  });

  it("하위 레벨은 상위 레벨 불통과", () => {
    expect(hasMinRole("staff", "master")).toBe(false);
    expect(hasMinRole("staff", "admin")).toBe(false);
    expect(hasMinRole("manager", "admin")).toBe(false);
    expect(hasMinRole("admin", "master")).toBe(false);
  });

  it("employee 레거시 호환: staff과 동일 레벨", () => {
    expect(hasMinRole("employee", "staff")).toBe(true);
    expect(hasMinRole("staff", "employee")).toBe(true);
  });

  it("알 수 없는 역할은 레벨 0 → 모든 것보다 낮음", () => {
    expect(hasMinRole("unknown", "staff")).toBe(false);
  });

  it("알 수 없는 minRole은 레벨 99 → 아무도 통과 못함", () => {
    expect(hasMinRole("master", "superadmin")).toBe(false);
  });
});

// ─── 편의 함수들 ─────────────────────────────────────────────────────────────

describe("isManagerLevel", () => {
  it("manager 이상만 true", () => {
    expect(isManagerLevel("master")).toBe(true);
    expect(isManagerLevel("admin")).toBe(true);
    expect(isManagerLevel("manager")).toBe(true);
    expect(isManagerLevel("staff")).toBe(false);
  });
});

describe("isAdminLevel", () => {
  it("admin 이상만 true", () => {
    expect(isAdminLevel("master")).toBe(true);
    expect(isAdminLevel("admin")).toBe(true);
    expect(isAdminLevel("manager")).toBe(false);
    expect(isAdminLevel("staff")).toBe(false);
  });
});

describe("isMasterLevel", () => {
  it("master만 true", () => {
    expect(isMasterLevel("master")).toBe(true);
    expect(isMasterLevel("admin")).toBe(false);
    expect(isMasterLevel("manager")).toBe(false);
  });
});

// ─── isOwnerLevel (점장 전용: 인건비/계약서/소속회사) ─────────────────────────

describe("isOwnerLevel", () => {
  it("admin 이상은 storeRole 무관하게 true", () => {
    expect(isOwnerLevel("master")).toBe(true);
    expect(isOwnerLevel("admin")).toBe(true);
    expect(isOwnerLevel("admin", null)).toBe(true);
    expect(isOwnerLevel("admin", "staff")).toBe(true);
  });

  it("매장 owner → true", () => {
    expect(isOwnerLevel("manager", "owner")).toBe(true);
  });

  it("레거시 store_manager → true", () => {
    expect(isOwnerLevel("manager", "store_manager")).toBe(true);
  });

  it("supervisor(매니져)는 false — 핵심 권한 차이", () => {
    expect(isOwnerLevel("manager", "supervisor")).toBe(false);
  });

  it("staff → false", () => {
    expect(isOwnerLevel("staff", "staff")).toBe(false);
    expect(isOwnerLevel("staff", null)).toBe(false);
  });
});

// ─── canAccessPayroll ────────────────────────────────────────────────────────

describe("canAccessPayroll", () => {
  it("isOwnerLevel과 동일하게 동작", () => {
    expect(canAccessPayroll("admin")).toBe(true);
    expect(canAccessPayroll("manager", "owner")).toBe(true);
    expect(canAccessPayroll("manager", "supervisor")).toBe(false);
    expect(canAccessPayroll("staff")).toBe(false);
  });
});

// ─── canManageStaff ──────────────────────────────────────────────────────────

describe("canManageStaff", () => {
  it("manager 이상이면 true (supervisor 포함)", () => {
    expect(canManageStaff("master")).toBe(true);
    expect(canManageStaff("admin")).toBe(true);
    expect(canManageStaff("manager")).toBe(true);
    expect(canManageStaff("manager", "supervisor")).toBe(true);
    expect(canManageStaff("staff")).toBe(false);
  });
});

// ─── ROLE_LEVEL 무결성 ───────────────────────────────────────────────────────

describe("ROLE_LEVEL 계층 무결성", () => {
  it("master(4) > admin(3) > manager(2) > staff(1)", () => {
    expect(ROLE_LEVEL.master).toBeGreaterThan(ROLE_LEVEL.admin);
    expect(ROLE_LEVEL.admin).toBeGreaterThan(ROLE_LEVEL.manager);
    expect(ROLE_LEVEL.manager).toBeGreaterThan(ROLE_LEVEL.staff);
  });

  it("레거시 employee === staff", () => {
    expect(ROLE_LEVEL.employee).toBe(ROLE_LEVEL.staff);
  });

  it("user === staff (시스템 역할 user는 레벨 1)", () => {
    expect(ROLE_LEVEL.user).toBe(ROLE_LEVEL.staff);
  });
});
