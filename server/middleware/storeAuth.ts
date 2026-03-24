import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { restaurantUsers } from "../../drizzle/schema";

/**
 * 매장 접근 권한 검증
 * - admin: 매장 배정 무관하게 읽기 가능, 쓰기는 배정된 경우만
 * - user: 배정된 매장만 접근 가능
 */
export async function verifyStoreAccess(
  userId: number,
  systemRole: string,
  restaurantId: number,
  requireWrite: boolean = false
): Promise<{ storeRole: string | null }> {
  const [ru] = await db
    .select()
    .from(restaurantUsers)
    .where(and(eq(restaurantUsers.restaurantId, restaurantId), eq(restaurantUsers.userId, userId)))
    .limit(1);

  const storeRole = ru?.role ?? null;

  // master/admin은 읽기 항상 가능, 쓰기는 배정된 경우만 (master는 항상 허용)
  if (systemRole === "master") return { storeRole };
  if (systemRole === "admin") {
    if (requireWrite && !storeRole) {
      throw new TRPCError({ code: "FORBIDDEN", message: "이 매장에 배정되지 않아 수정할 수 없습니다" });
    }
    return { storeRole };
  }

  // 일반 유저는 배정 필수
  if (!storeRole) {
    throw new TRPCError({ code: "FORBIDDEN", message: "이 매장에 접근 권한이 없습니다" });
  }

  return { storeRole };
}

/** 매장 내 매니저급 이상 (store_manager/manager) 검증 */
export async function requireStoreManager(
  userId: number,
  systemRole: string,
  restaurantId: number
): Promise<{ storeRole: string }> {
  // master/admin은 시스템 권한으로 통과
  if (systemRole === "master" || systemRole === "admin") {
    const { storeRole } = await verifyStoreAccess(userId, systemRole, restaurantId, true);
    return { storeRole: storeRole ?? "admin" };
  }

  const { storeRole } = await verifyStoreAccess(userId, systemRole, restaurantId, true);

  if (storeRole !== "owner" && storeRole !== "supervisor" && storeRole !== "store_manager" && storeRole !== "manager") {
    throw new TRPCError({ code: "FORBIDDEN", message: "점장/부점장 이상의 권한이 필요합니다" });
  }

  return { storeRole };
}
