/**
 * POS 라벨 매핑 — 시스템 내부 코드(enum/API path)는 영어 유지,
 * 사용자 노출 텍스트는 한글.
 */

export const STYLE_PRESET_LABEL: Record<string, string> = {
  DEPT_PICKUP: "백화점 선불 셀프픽업",
  SHOP_PICKUP: "로드샵 선불 셀프픽업",
  SHOP_TABLE: "로드샵 후불 테이블",
  COURT_PICKUP: "푸드코트 선불 테이블",
  KIOSK_PICKUP: "키오스크 무인 선불",
};

export const STYLE_PRESET_SHORT: Record<string, string> = {
  DEPT_PICKUP: "백화점 픽업",
  SHOP_PICKUP: "로드샵 픽업",
  SHOP_TABLE: "로드샵 테이블",
  COURT_PICKUP: "푸드코트",
  KIOSK_PICKUP: "키오스크",
};

export const ORDER_MODE_LABEL: Record<string, string> = {
  prepaid_pickup: "선불 셀프픽업",
  prepaid_table: "선불 테이블",
  postpaid_table: "후불 테이블",
};

export const PAYMENT_PROVIDER_LABEL: Record<string, string> = {
  external_dept_store: "외부 결제 (백화점 단말)",
  terminal_bridge: "카드단말기 연동",
  van_direct: "VAN 직연동",
  manual: "수동 입력",
};

export const KITCHEN_ROUTER_LABEL: Record<string, string> = {
  kds: "주방 화면 (KDS)",
  printer: "주방 프린터",
  none: "사용 안 함",
};

export const DEVICE_TYPE_LABEL: Record<string, string> = {
  staff_counter: "스태프 카운터",
  staff_table: "스태프 테이블",
  kiosk: "키오스크",
  kds: "주방 화면 (KDS)",
};

export function labelOf(
  map: Record<string, string>,
  value: string | null | undefined
): string {
  if (!value) return "-";
  return map[value] ?? value;
}
