/**
 * refactoring.test.ts
 *
 * 구조 정합성 리팩터링 검증 테스트
 * 1. KST 날짜 유틸 정확성
 * 2. 권한 모델 (ROLE_LEVEL, getEffectiveRole)
 * 3. users.role 덮어쓰기 방지 (updateStaffRole 코드 패턴 검증)
 * 4. 오픈 체크 status 조건 ('published','confirmed' 사용)
 */

import { describe, it, expect } from "vitest";
import { todayKST, toKSTDateString, kstDayStartUTC, kstDayEndUTC, addDays, daysBetween } from "../shared/dateKST";
import { ROLE_LEVEL, getEffectiveRole } from "../shared/permissions";
import * as fs from "fs";
import * as path from "path";

// ─── 1. KST 날짜 유틸 ────────────────────────────────────────────────────────

describe("KST 날짜 유틸", () => {
  it("todayKST()는 YYYY-MM-DD 형식을 반환한다", () => {
    const today = todayKST();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("toKSTDateString()은 UTC+9 기준 날짜를 반환한다", () => {
    // UTC 2026-03-18 23:00:00 → KST 2026-03-19 08:00:00
    const utcDate = new Date("2026-03-18T23:00:00Z");
    expect(toKSTDateString(utcDate)).toBe("2026-03-19");
  });

  it("toKSTDateString()은 UTC 자정 직전에도 KST 날짜를 정확히 반환한다", () => {
    // UTC 2026-03-18 15:00:00 → KST 2026-03-19 00:00:00 (자정)
    const utcDate = new Date("2026-03-18T15:00:00Z");
    expect(toKSTDateString(utcDate)).toBe("2026-03-19");
  });

  it("kstDayStartUTC()는 KST 00:00:00에 해당하는 UTC 시각을 반환한다", () => {
    const start = kstDayStartUTC("2026-03-19");
    // KST 00:00:00 = UTC 전날 15:00:00
    expect(start.toISOString()).toBe("2026-03-18T15:00:00.000Z");
  });

  it("kstDayEndUTC()는 KST 23:59:59에 해당하는 UTC 시각을 반환한다", () => {
    const end = kstDayEndUTC("2026-03-19");
    // KST 23:59:59 = UTC 14:59:59
    expect(end.toISOString()).toBe("2026-03-19T14:59:59.000Z");
  });

  it("addDays()는 날짜 문자열에 N일을 더한다", () => {
    expect(addDays("2026-03-19", 1)).toBe("2026-03-20");
    expect(addDays("2026-03-19", -1)).toBe("2026-03-18");
    expect(addDays("2026-03-31", 1)).toBe("2026-04-01");
  });

  it("daysBetween()은 두 날짜 사이의 일수를 반환한다", () => {
    expect(daysBetween("2026-03-19", "2026-03-20")).toBe(1);
    expect(daysBetween("2026-03-20", "2026-03-19")).toBe(-1);
    expect(daysBetween("2026-03-01", "2026-04-01")).toBe(31);
  });
});

// ─── 2. 권한 모델 ─────────────────────────────────────────────────────────────

describe("권한 모델 (ROLE_LEVEL)", () => {
  it("역할 레벨이 올바른 순서로 정의되어 있다", () => {
    expect(ROLE_LEVEL["master"]).toBeGreaterThan(ROLE_LEVEL["admin"]);
    expect(ROLE_LEVEL["admin"]).toBeGreaterThan(ROLE_LEVEL["manager"]);
    expect(ROLE_LEVEL["manager"]).toBeGreaterThan(ROLE_LEVEL["employee"]);
  });

  it("getEffectiveRole()은 store_manager storeRole을 manager로 상향한다", () => {
    expect(getEffectiveRole("employee", "store_manager")).toBe("manager");
    expect(getEffectiveRole("employee", "manager")).toBe("manager");
  });

  it("getEffectiveRole()은 admin/master는 storeRole과 무관하게 유지한다", () => {
    expect(getEffectiveRole("admin", "employee")).toBe("admin");
    expect(getEffectiveRole("master", "store_manager")).toBe("master");
  });

  it("getEffectiveRole()은 storeRole이 없으면 users.role을 그대로 반환한다", () => {
    expect(getEffectiveRole("manager", null)).toBe("manager");
    expect(getEffectiveRole("employee", null)).toBe("employee");
    expect(getEffectiveRole("employee", undefined)).toBe("employee");
  });
});

// ─── 3. users.role 덮어쓰기 방지 ─────────────────────────────────────────────

describe("updateStaffRole — users.role 덮어쓰기 방지", () => {
  it("routers.ts의 updateStaffRole에 users 테이블 role 업데이트 코드가 없다", () => {
    const routersPath = path.join(__dirname, "routers.ts");
    const content = fs.readFileSync(routersPath, "utf-8");

    // updateStaffRole 섹션 추출 (managerProcedure 다음 종료 패턴)
    const startIdx = content.indexOf("updateStaffRole: managerProcedure");
    const endIdx = content.indexOf("getMyStoreRole:", startIdx);
    const section = content.slice(startIdx, endIdx);

    // users 테이블에 role을 직접 업데이트하는 코드가 없어야 한다
    expect(section).not.toMatch(/usersTable.*role.*newRole/);
    expect(section).not.toMatch(/updateUser.*role.*newRole/);
    // restaurant_users 테이블 업데이트는 있어야 한다
    expect(section).toMatch(/restaurant_users|restaurantUsers/i);
  });
});

// ─── 4. 오픈/마감 체크 status 조건 ───────────────────────────────────────────

describe("오픈/마감 체크 — schedule status 조건", () => {
  it("routers.ts의 openCheck/closeCheck에서 'approved' status를 사용하지 않는다", () => {
    const routersPath = path.join(__dirname, "routers.ts");
    const content = fs.readFileSync(routersPath, "utf-8");

    // openCheck 섹션 (protectedProcedure 기준으로 추출)
    const openStart = content.indexOf("openCheck: protectedProcedure");
    const openEnd = content.indexOf("closeCheck: protectedProcedure", openStart);
    const openSection = content.slice(openStart, openEnd);

    // closeCheck 섹션
    const closeStart = content.indexOf("closeCheck: protectedProcedure");
    const closeEnd = content.indexOf("  }),", closeStart + 100) + 5;
    const closeSection = content.slice(closeStart, closeEnd);

    // 'approved' status는 사용하지 않아야 한다
    expect(openSection).not.toContain("'approved'");
    expect(closeSection).not.toContain("'approved'");

    // 'published' 또는 'confirmed' status를 사용해야 한다
    expect(openSection).toMatch(/'published'|'confirmed'/);
    expect(closeSection).toMatch(/'published'|'confirmed'/);
  });
});

// ─── 5. 리소스 스코프 검증 ────────────────────────────────────────────────────

describe("리소스 스코프 검증", () => {
  it("purchases.delete에 requireManagerOrStoreRole 호출이 있다", () => {
    const routersPath = path.join(__dirname, "routers.ts");
    const content = fs.readFileSync(routersPath, "utf-8");

    // purchases.delete 섹션 추출
    const purchasesStart = content.indexOf("purchases: router({");
    const deleteStart = content.indexOf("delete: managerProcedure", purchasesStart);
    const deleteEnd = content.indexOf("\n    }),", deleteStart) + 7;
    const deleteSection = content.slice(deleteStart, deleteEnd);

    expect(deleteSection).toContain("requireManagerOrStoreRole");
  });

  it("schedules.delete에 requireManagerOrStoreRole 호출이 있다", () => {
    const routersPath = path.join(__dirname, "routers.ts");
    const content = fs.readFileSync(routersPath, "utf-8");

    // schedules.delete 섹션 추출
    const schedulesStart = content.indexOf("schedules: router({");
    const deleteStart = content.indexOf("delete: managerProcedure", schedulesStart);
    const deleteEnd = content.indexOf("\n    }),", deleteStart) + 7;
    const deleteSection = content.slice(deleteStart, deleteEnd);

    expect(deleteSection).toContain("requireManagerOrStoreRole");
  });
});
