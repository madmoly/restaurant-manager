/**
 * 매장 스코핑 중앙 헬퍼
 *
 * 대표(admin) 기준 매장 물리적 분리의 단일 진실 원천(single source of truth).
 * 모든 매장 관련 쿼리는 이 헬퍼를 통해 스코핑 → tutorial/삭제 매장 격리가
 * 각 라우터에 산발적으로 퍼지지 않고 여기서만 관리됨.
 *
 * 구조:
 * - master: 전체 실매장 (isTutorial=false, deletedAt=null)
 * - admin (독립 대표): ownerAdminId = 본인
 * - admin (SUB대표): ownerAdminId = parentId (상위 대표)
 * - user/staff: restaurant_users 배정 기반 (별도 처리 — listMine 등)
 *
 * tutorial 데이터는 ownerAdminId 기반 분리 + isTutorial 플래그로 이중 격리.
 */

import { eq, and, isNull, inArray } from "drizzle-orm";
import { db } from "../db";
import { restaurants, users } from "../../drizzle/schema";

// ─── 공통 필터 조건 (WHERE절에 직접 사용 가능) ───

/** 실매장 조건: tutorial 제외 + 미삭제 */
export function realStoreCondition() {
  return and(
    isNull(restaurants.deletedAt),
    eq(restaurants.isTutorial, false),
  );
}

/** 활성 매장 조건: isActive + tutorial 분기
 *  - isTutorial 미지정(기본): 실매장만 (isTutorial=false)
 *  - isTutorial=true: Tutorial 매장만
 */
export function activeRealStoreCondition(isTutorial: boolean = false) {
  return and(
    eq(restaurants.isActive, true),
    eq(restaurants.isTutorial, isTutorial),
  );
}

// ─── 소유 매장 조회 ───

/**
 * 대표 기준 소유 매장 목록 조회 (전체 row)
 * - master → 전체 실매장
 * - admin/sub-admin → ownerAdminId 기반
 */
export async function getOwnedRestaurants(userId: number, role: string) {
  if (role === "master") {
    return db.select().from(restaurants).where(realStoreCondition());
  }
  // admin 또는 sub-admin: parentId 확인
  const [me] = await db
    .select({ parentId: users.parentId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const ownerAdminId = me?.parentId ?? userId;
  return db.select().from(restaurants).where(
    and(realStoreCondition(), eq(restaurants.ownerAdminId, ownerAdminId)),
  );
}

/**
 * 소유 매장 ID 목록만 (경량 — IN 절 용도)
 */
export async function getOwnedRestaurantIds(userId: number, role: string): Promise<number[]> {
  const rows = await getOwnedRestaurants(userId, role);
  return rows.map((r) => r.id);
}

/**
 * restaurantId 컬럼을 소유 매장으로 제한하는 WHERE 조건 생성
 * 범용: 어떤 테이블이든 restaurantId 컬럼 참조를 넘기면 IN 조건 반환
 */
export async function ownedRestaurantFilter(
  restaurantIdColumn: any,
  userId: number,
  role: string,
) {
  const ids = await getOwnedRestaurantIds(userId, role);
  if (ids.length === 0) return eq(restaurantIdColumn, -1); // 빈 결과 보장
  return inArray(restaurantIdColumn, ids);
}
