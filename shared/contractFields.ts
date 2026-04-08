/**
 * shared/contractFields.ts
 *
 * 계약서 ↔ 직원정보 필드 분류
 *
 * A군: 계약서 전용 (서명 후 불변). 직원정보 화면에 노출하지 않음.
 * B군: 직원정보 전용 (계약서와 무관).
 * C군: 계약서 → 직원정보 단방향 sync 대상.
 *
 * 단방향 동기화 규칙:
 *  - 계약서 서명 완료 시 C군 필드를 적재 대상 테이블로 분배
 *  - 직원정보 화면에서 C군 수동 편집은 허용 — 단, 최신 서명 계약서의 스냅샷과
 *    불일치 시 "⚠️ 계약서와 불일치" 경고 배지 표시 (차단 X)
 *  - 근본 해결: 재계약 작성 → 신규 전자계약서 서명 → 자동 sync
 */

export const A_FIELDS = [
  "wage",
  "wageType",
  "weeklyHours",
  "contractStart",
  "contractEnd",
] as const;

export const B_FIELDS = [
  "healthCertUrl",
  "healthCertExpiry",
  "bankbookUrl",
  "username",
  "passwordHash",
] as const;

export const C_FIELDS = [
  "name",
  "phone",
  "address",
  "residentNumber",
  "bankAccount",
  "affiliatedCompany",
  "hireDate",
  "weeklyOffDays",
] as const;

export type AField = (typeof A_FIELDS)[number];
export type BField = (typeof B_FIELDS)[number];
export type CField = (typeof C_FIELDS)[number];
