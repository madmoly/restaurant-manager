/**
 * shared/contractFields.ts
 *
 * 계약서 ↔ 직원정보 필드 분류
 *
 * A군: 계약서 전용 (서명 후 불변). 직원정보 화면에 노출하지 않음.
 * B군: 직원정보 전용 (계약서와 무관).
 * C군: 직원정보 SSOT + 계약서 시점 박제 대상.
 *
 * SSOT 역전 규칙 (재설계 2026-05-02):
 *  - 직원정보(restaurant_users / users)가 권위(SSOT)
 *  - 계약서 서명 시 C군 필드를 employment_electronic_contracts.snapshot* 컬럼에 시점 박제
 *  - 단방향 sync (계약서→직원정보 자동 갱신) 폐지
 *  - 직원정보 변경이 최신 서명 스냅샷과 어긋나면 "계약서 갱신 필요" 배너 1개로 안내 (차단·경고 배지 없음)
 *  - 근본 해결: 신규 전자계약서 작성·서명 → 신규 박제 갱신
 *  - C군 필드 목록은 스냅샷 비교(갱신 필요 판정)용으로 유지
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
