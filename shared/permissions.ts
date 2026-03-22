/**
 * shared/permissions.ts
 *
 * 공통 권한 모델 — 서버와 클라이언트 모두 이 파일을 참조한다.
 *
 * 역할 계층:
 *   master(4) > admin(3) > manager(2) > employee(1)
 *
 * 두 가지 역할 개념:
 *   - users.role (시스템 전역 역할): 계정 생성 시 부여, 시스템 전반에 적용
 *   - restaurant_users.role (매장 내 역할): 매장별로 부여, 해당 매장에서만 적용
 *     가능한 값: "store_manager" | "manager" | "employee"
 *
 * effectiveRole 계산 규칙:
 *   1. users.role이 master/admin이면 → 그대로 master/admin (전역 우선)
 *   2. 아니면 해당 매장의 restaurant_users.role을 확인:
 *      - "store_manager" 또는 "manager" → "manager"로 상향
 *      - "employee" 또는 null → users.role 그대로 반환
 */

export const ROLE_LEVEL: Record<string, number> = {
  master: 4,
  admin: 3,
  manager: 2,
  employee: 1,
  user: 1,
};

export type SystemRole = "master" | "admin" | "manager" | "employee";
export type StoreRole = "store_manager" | "manager" | "employee";
export type EffectiveRole = "master" | "admin" | "manager" | "employee";

/**
 * 유효 역할(effectiveRole) 계산
 *
 * @param systemRole  users.role 값
 * @param storeRole   restaurant_users.role 값 (null이면 매장 미소속)
 * @returns 실제 적용될 역할
 */
export function getEffectiveRole(
  systemRole: string,
  storeRole: string | null | undefined,
): EffectiveRole {
  // 시스템 전역 역할이 admin 이상이면 storeRole 무시
  if (systemRole === "master" || systemRole === "admin") {
    return systemRole as EffectiveRole;
  }
  // 매장 내 역할이 점장/매니저급이면 manager로 상향
  if (storeRole === "store_manager" || storeRole === "manager") {
    return "manager";
  }
  // 나머지는 시스템 역할 그대로
  return (systemRole as EffectiveRole) ?? "employee";
}

/** 최소 역할 레벨 충족 여부 확인 */
export function hasMinRole(effectiveRole: string, minRole: string): boolean {
  return (ROLE_LEVEL[effectiveRole] ?? 0) >= (ROLE_LEVEL[minRole] ?? 99);
}

/** 매장 관리자(점장/매니저 이상) 여부 */
export function isManagerLevel(effectiveRole: string): boolean {
  return hasMinRole(effectiveRole, "manager");
}

/** 관리자(admin 이상) 여부 */
export function isAdminLevel(effectiveRole: string): boolean {
  return hasMinRole(effectiveRole, "admin");
}

/** 급여/인건비 접근 가능 (store_manager만, 또는 admin 이상) */
export function canAccessPayroll(effectiveRole: string, storeRole?: string | null): boolean {
  if (hasMinRole(effectiveRole, "admin")) return true;
  return storeRole === "store_manager";
}

/** 직원 관리 가능 (store_manager만, 또는 admin 이상) */
export function canManageStaff(effectiveRole: string, storeRole?: string | null): boolean {
  if (hasMinRole(effectiveRole, "admin")) return true;
  return storeRole === "store_manager";
}

/** 역할 표시 라벨 */
export const ROLE_LABELS: Record<string, string> = {
  master: "마스터",
  admin: "관리자",
  manager: "점장",
  store_manager: "점장",
  employee: "직원",
  user: "사용자",
};

/** 매장 내 역할 라벨 */
export const STORE_ROLE_LABELS: Record<string, string> = {
  store_manager: "점장",
  manager: "매니저",
  employee: "직원",
};
