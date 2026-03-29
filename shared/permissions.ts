/**
 * shared/permissions.ts
 *
 * 공통 권한 모델 — 서버와 클라이언트 모두 이 파일을 참조한다.
 *
 * 역할 계층:
 *   master(4) > admin(3) > manager(2) > staff(1)
 *
 * 두 가지 역할 개념:
 *   - users.role (시스템 전역 역할): master | admin | user
 *     ※ 시스템 레벨 'manager'는 폐지 (매장 역할로 대체)
 *   - restaurant_users.role (매장 내 역할): 매장별로 부여
 *     가능한 값: "owner" | "supervisor" | "staff"
 *     - owner = 점장 (매장 전권: 재무+인사+운영)
 *     - supervisor = 매니져 (운영 실행권, 인사 일부 제한)
 *     - staff = 직원 (실행만)
 *
 * effectiveRole 계산 규칙:
 *   1. users.role이 master/admin이면 → 그대로 (전역 우선)
 *   2. 아니면 해당 매장의 restaurant_users.role을 확인:
 *      - "owner" 또는 "supervisor" → "manager"로 상향
 *      - "staff" 또는 null → "staff"
 *
 * 점장(owner) vs 매니져(supervisor) 권한 차이 (3개만):
 *   - 근로계약서 생성/발송: owner만
 *   - 인건비 정산 조회: owner만
 *   - 소속회사 변경: owner만
 */

export const ROLE_LEVEL: Record<string, number> = {
  master: 4,
  admin: 3,
  manager: 2,
  employee: 1, // 레거시 호환
  staff: 1,
  user: 1,
};

export type SystemRole = "master" | "admin" | "user";
export type StoreRole = "owner" | "supervisor" | "staff";
export type EffectiveRole = "master" | "admin" | "manager" | "staff";

/**
 * 유효 역할(effectiveRole) 계산
 */
export function getEffectiveRole(
  systemRole: string,
  storeRole: string | null | undefined,
): EffectiveRole {
  // 시스템 전역 역할이 admin 이상이면 storeRole 무시
  if (systemRole === "master" || systemRole === "admin") {
    return systemRole as EffectiveRole;
  }
  // 매장 내 역할이 점장/매니져이면 manager로 상향
  // 레거시 호환: store_manager, manager도 인식
  if (storeRole === "owner" || storeRole === "supervisor" ||
      storeRole === "store_manager" || storeRole === "manager") {
    return "manager";
  }
  // 나머지는 staff
  return "staff";
}

/** 최소 역할 레벨 충족 여부 확인 */
export function hasMinRole(effectiveRole: string, minRole: string): boolean {
  return (ROLE_LEVEL[effectiveRole] ?? 0) >= (ROLE_LEVEL[minRole] ?? 99);
}

/** 매장 관리자(점장/매니져 이상) 여부 */
export function isManagerLevel(effectiveRole: string): boolean {
  return hasMinRole(effectiveRole, "manager");
}

/** 관리자(admin 이상) 여부 */
export function isAdminLevel(effectiveRole: string): boolean {
  return hasMinRole(effectiveRole, "admin");
}

/** 점장(owner) 전용 기능 접근 가능 여부 (인건비, 계약서, 소속회사) */
export function isOwnerLevel(effectiveRole: string, storeRole?: string | null): boolean {
  if (hasMinRole(effectiveRole, "admin")) return true;
  return storeRole === "owner" || storeRole === "store_manager"; // 레거시 호환
}

/** master 전용 권한 체크 */
export function isMasterLevel(role: EffectiveRole): boolean {
  return role === "master";
}


/** 급여/인건비 접근 가능 (owner만, 또는 admin 이상) */
export function canAccessPayroll(effectiveRole: string, storeRole?: string | null): boolean {
  return isOwnerLevel(effectiveRole, storeRole);
}

/** 직원 관리 가능 (owner/supervisor 모두 가능) */
export function canManageStaff(effectiveRole: string, storeRole?: string | null): boolean {
  return isManagerLevel(effectiveRole);
}

/** 역할 표시 라벨 */
export const ROLE_LABELS: Record<string, string> = {
  master: "개발자",
  admin: "대표", // parentId가 있으면 "SUB대표"로 표시 (UI에서 분기)
  manager: "매장관리자",
  owner: "점장",
  supervisor: "매니져",
  staff: "직원",
  // 레거시 호환
  store_manager: "점장",
  employee: "직원",
  user: "사용자",
};

/** 매장 내 역할 라벨 */
export const STORE_ROLE_LABELS: Record<string, string> = {
  owner: "점장",
  supervisor: "매니져",
  staff: "직원",
  // 레거시 호환
  store_manager: "점장",
  manager: "매니저",
  employee: "직원",
};
