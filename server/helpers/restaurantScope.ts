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
import { TRPCError } from "@trpc/server";
import { db } from "../db";
import { restaurants, restaurantUsers, users } from "../../drizzle/schema";

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

// ─── 사용자 스코핑 ───

/**
 * 호출자가 볼 수 있는 userId 집합.
 * - master → null (무제한)
 * - admin  → 자기 사업그룹 매장의 배정자(퇴사자 포함 — 퇴사해도 그룹 소속) + 본인
 *            + effectiveOwnerId(상위 대표) + 자기 하위 SUB대표
 * - user   → 본인이 재직 중인 매장의 배정자 + 본인
 *
 * PR2에서 `users.ownerAdminId` 컬럼 도입 시 admin 분기를 컬럼 조회로 교체 예정.
 */
export async function getScopedUserIds(userId: number, role: string): Promise<number[] | null> {
  if (role === "master") return null;

  const ids = new Set<number>([userId]);

  if (role === "admin") {
    const [me] = await db
      .select({ parentId: users.parentId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const effectiveOwnerId = me?.parentId ?? userId;
    ids.add(effectiveOwnerId);

    // 같은 대표 아래 SUB대표 전원
    const subs = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.parentId, effectiveOwnerId));
    for (const s of subs) ids.add(s.id);

    // 소유 매장 배정자 (퇴사 여부 무관)
    const restaurantIds = await getOwnedRestaurantIds(userId, role);
    if (restaurantIds.length > 0) {
      const rows = await db
        .selectDistinct({ userId: restaurantUsers.userId })
        .from(restaurantUsers)
        .where(inArray(restaurantUsers.restaurantId, restaurantIds));
      for (const r of rows) ids.add(r.userId);
    }
    return Array.from(ids);
  }

  // user 레벨: 본인이 재직 중인 매장의 동료
  const mine = await db
    .select({ restaurantId: restaurantUsers.restaurantId })
    .from(restaurantUsers)
    .where(and(eq(restaurantUsers.userId, userId), isNull(restaurantUsers.resignedAt)));
  const myRestaurantIds = mine.map((r) => r.restaurantId);
  if (myRestaurantIds.length > 0) {
    const rows = await db
      .selectDistinct({ userId: restaurantUsers.userId })
      .from(restaurantUsers)
      .where(inArray(restaurantUsers.restaurantId, myRestaurantIds));
    for (const r of rows) ids.add(r.userId);
  }
  return Array.from(ids);
}

/** 대상 userId가 호출자 스코프 밖이면 FORBIDDEN. master는 통과. */
export async function assertUserInScope(
  callerId: number,
  role: string,
  targetUserId: number,
): Promise<void> {
  if (callerId === targetUserId) return;
  const scoped = await getScopedUserIds(callerId, role);
  if (scoped === null) return;
  if (!scoped.includes(targetUserId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "다른 사업그룹의 사용자입니다" });
  }
}
