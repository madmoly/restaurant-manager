import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  auditLogs,
  restaurantUsers,
  storeClosedDays,
  storeWeeklyClosures,
} from "../../drizzle/schema";

const OVERRIDE_ALLOWED_SYSTEM_ROLES = new Set(["master", "admin"]);
// 점장(owner)만 매장 차원 예외 허용. supervisor/매니져는 불가.
const OVERRIDE_ALLOWED_STORE_ROLES = new Set(["owner", "store_manager"]);

/**
 * 휴무일(개별/주간)에 매출·매입·일마감 등이 저장되지 않도록 입력을 차단.
 *
 * - `dateStr`이 해당 매장의 `store_closed_days` 또는 `store_weekly_closures`에 걸리면 기본 차단.
 * - `override.reason`이 있고 호출자가 master/admin/owner(점장)이면 통과 + `audit_logs`에 기록.
 * - dateStr이 비었거나 형식이 "YYYY-MM-DD"가 아니면 아무것도 하지 않음(상위 zod 검증 책임).
 */
export async function verifyOperatingDay(params: {
  restaurantId: number;
  dateStr: string;
  override?: { reason: string } | null;
  userId: number;
  userRole: string;
}): Promise<void> {
  const { restaurantId, dateStr, override, userId, userRole } = params;

  if (!dateStr) return;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const dow = new Date(`${iso}T00:00:00`).getDay();

  const [weekly] = await db
    .select({ id: storeWeeklyClosures.id })
    .from(storeWeeklyClosures)
    .where(and(
      eq(storeWeeklyClosures.restaurantId, restaurantId),
      eq(storeWeeklyClosures.weekday, dow),
      eq(storeWeeklyClosures.isClosed, true),
    ))
    .limit(1);

  const [daily] = await db
    .select({ id: storeClosedDays.id })
    .from(storeClosedDays)
    .where(and(
      eq(storeClosedDays.restaurantId, restaurantId),
      sql`DATE(${storeClosedDays.closedDate}) = ${iso}`,
    ))
    .limit(1);

  if (!weekly && !daily) return;

  if (!override?.reason) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "해당일은 휴무일입니다. 휴무 해제 후 입력하거나 예외 입력을 사용하세요.",
    });
  }

  let allowed = OVERRIDE_ALLOWED_SYSTEM_ROLES.has(userRole);
  if (!allowed) {
    const [ru] = await db
      .select({ role: restaurantUsers.role })
      .from(restaurantUsers)
      .where(and(
        eq(restaurantUsers.restaurantId, restaurantId),
        eq(restaurantUsers.userId, userId),
      ))
      .limit(1);
    allowed = !!ru?.role && OVERRIDE_ALLOWED_STORE_ROLES.has(ru.role);
  }
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "휴무일 예외 입력 권한이 없습니다.",
    });
  }

  await db.insert(auditLogs).values({
    userId,
    action: "holiday_override",
    target: "operating_day",
    targetId: 0,
    restaurantId,
    details: { date: iso, reason: override.reason },
  });
}
