/**
 * 기본 체크리스트 시드 — 단일 원본.
 *
 * 용도:
 *  1) `restaurants.create` 성공 직후 신규 매장에 즉시 시드
 *  2) 서버 부팅 시 기존 매장의 누락분 동기화 (최초 1회, system_settings 플래그로 가드)
 *
 * 이전 문제점:
 *  - 시드 로직이 server/index.ts 내부에만 있었고, 매 부팅 시 모든 매장 풀스캔 실행
 *  - 신규 매장 생성 시점엔 시드가 돌지 않아 사용자에게 빈 체크리스트가 보임
 *  - effectiveFrom 미설정으로 과거 날짜에도 표시되어 달성률 왜곡
 */

import type { Connection, Pool } from "mysql2/promise";

export type DefaultChecklistItem = {
  targetTab: "open" | "purchase" | "midday" | "close";
  checkType: "open" | "order" | "other" | "cleaning";
  itemText: string;
  sortOrder: number;
};

export const DEFAULT_CHECKLIST_TEMPLATES: DefaultChecklistItem[] = [
  // 오픈 체크리스트
  { targetTab: "open", checkType: "open", itemText: "매장 조명 및 간판 점등", sortOrder: 1 },
  { targetTab: "open", checkType: "open", itemText: "에어컨/난방 및 환기 시스템 가동", sortOrder: 2 },
  { targetTab: "open", checkType: "open", itemText: "홀 테이블/의자 정리 및 세팅", sortOrder: 3 },
  { targetTab: "open", checkType: "open", itemText: "화장실 청소 및 비품(휴지/비누) 확인", sortOrder: 4 },
  { targetTab: "open", checkType: "open", itemText: "식재료 유통기한 및 상태 확인", sortOrder: 5 },
  { targetTab: "open", checkType: "open", itemText: "POS 시스템 정상 작동 확인", sortOrder: 6 },
  { targetTab: "open", checkType: "open", itemText: "전일 마감 사항 인수인계 확인", sortOrder: 7 },
  // 매입 체크리스트
  { targetTab: "purchase", checkType: "order", itemText: "금일 발주서/입고 예정 확인", sortOrder: 1 },
  { targetTab: "purchase", checkType: "order", itemText: "입고 식재료 수량 검수", sortOrder: 2 },
  { targetTab: "purchase", checkType: "order", itemText: "유통기한 및 신선도 확인", sortOrder: 3 },
  { targetTab: "purchase", checkType: "order", itemText: "냉장/냉동 보관 온도 확인", sortOrder: 4 },
  { targetTab: "purchase", checkType: "order", itemText: "전표/명세서 대조 및 보관", sortOrder: 5 },
  // 일간보고 체크리스트
  { targetTab: "midday", checkType: "other", itemText: "중간 매출 현황 기록", sortOrder: 1 },
  { targetTab: "midday", checkType: "other", itemText: "주요 식재료 재고 현황 확인", sortOrder: 2 },
  { targetTab: "midday", checkType: "other", itemText: "피크타임 인원 배치 확인", sortOrder: 3 },
  { targetTab: "midday", checkType: "other", itemText: "고객 클레임/특이사항 기록", sortOrder: 4 },
  // 마감 체크리스트
  { targetTab: "close", checkType: "cleaning", itemText: "당일 매출 정산 (현금/카드/이체 확인)", sortOrder: 1 },
  { targetTab: "close", checkType: "cleaning", itemText: "냉장/냉동고 온도 기록 확인", sortOrder: 2 },
  { targetTab: "close", checkType: "cleaning", itemText: "주방 청소 및 정리 완료", sortOrder: 3 },
  { targetTab: "close", checkType: "cleaning", itemText: "홀 청소 및 테이블 정리", sortOrder: 4 },
  { targetTab: "close", checkType: "cleaning", itemText: "쓰레기 분리수거 및 반출", sortOrder: 5 },
  { targetTab: "close", checkType: "cleaning", itemText: "가스 밸브 차단 확인", sortOrder: 6 },
  { targetTab: "close", checkType: "cleaning", itemText: "전기 점검 (불필요 기기 OFF)", sortOrder: 7 },
  { targetTab: "close", checkType: "cleaning", itemText: "문단속 및 보안 확인", sortOrder: 8 },
];

/**
 * KST 오늘 날짜 문자열 (yyyy-MM-dd) — effectiveFrom 기본값
 */
function todayKST(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * 매장에 기본 체크리스트를 시드.
 *  - (restaurantId, targetTab, itemText) 중복 시 skip (멱등)
 *  - effectiveFrom = 옵션 또는 오늘(KST)
 *
 * @returns 신규로 삽입된 항목 수
 */
export async function seedDefaultChecklistsForRestaurant(
  conn: Connection | Pool,
  restaurantId: number,
  effectiveFrom: string = todayKST(),
): Promise<number> {
  let added = 0;
  for (const t of DEFAULT_CHECKLIST_TEMPLATES) {
    const [dup] = await conn.query(
      `SELECT COUNT(*) as cnt FROM store_checklist_templates
       WHERE restaurantId = ? AND targetTab = ? AND itemText = ?`,
      [restaurantId, t.targetTab, t.itemText],
    ) as any[];
    if (dup[0]?.cnt > 0) continue;

    await conn.query(
      `INSERT INTO store_checklist_templates
       (restaurantId, targetTab, checkType, itemText, requirementType, sortOrder,
        repeatType, isActive, effectiveFrom)
       VALUES (?, ?, ?, ?, 'none', ?, 'daily', 1, ?)`,
      [restaurantId, t.targetTab, t.checkType, t.itemText, t.sortOrder, effectiveFrom],
    );
    added++;
  }
  return added;
}
