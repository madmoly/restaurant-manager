import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { leaveRequests, schedules } from "../../drizzle/schema";

// schedules 라우터와 leaveRequests 라우터가 공유하는 헬퍼.
// 라우터 간 직접 import는 순환 참조가 되므로 이 파일로 분리 (db/schema만 의존).

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbExecutor = typeof db | Tx;

/** 동일 매장·날짜에 해당 직원(또는 임시직원)의 active 스케줄이 이미 있는지 검사 */
export async function hasDuplicateSchedule(
  restaurantId: number,
  dateStr: string,
  opts: { userId?: number | null; tempWorkerName?: string | null; tempWorkerTag?: string | null; excludeId?: number },
  dbx: DbExecutor = db
): Promise<boolean> {
  const dayStart = new Date(`${dateStr}T00:00:00+09:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59+09:00`);

  const conditions = [
    eq(schedules.restaurantId, restaurantId),
    gte(schedules.startTime, dayStart),
    sql`${schedules.startTime} <= ${dayEnd}`,
    sql`${schedules.status} != 'canceled'`,
  ];

  if (opts.userId) {
    conditions.push(eq(schedules.userId, opts.userId));
  } else if (opts.tempWorkerName) {
    // 동명이인은 꼬리표까지 같아야 같은 사람 (꼬리표 없음끼리도 동일 취급)
    conditions.push(sql`${schedules.tempWorkerName} = ${opts.tempWorkerName}`);
    conditions.push(
      opts.tempWorkerTag
        ? sql`${schedules.tempWorkerTag} = ${opts.tempWorkerTag}`
        : sql`(${schedules.tempWorkerTag} IS NULL OR ${schedules.tempWorkerTag} = '')`,
    );
  }

  if (opts.excludeId) {
    conditions.push(sql`${schedules.id} != ${opts.excludeId}`);
  }

  const [existing] = await dbx
    .select({ id: schedules.id })
    .from(schedules)
    .where(and(...conditions))
    .limit(1);
  return !!existing;
}

/**
 * 매니저 지정 휴무 일괄 기록 — status='approved', source='manager' 즉시 삽입.
 * 같은 날짜에 pending/approved 건이 있거나 active 스케줄이 있는 유저는 skip + 사유 반환.
 */
export async function insertManagerLeaves(
  dbx: DbExecutor,
  opts: {
    restaurantId: number;
    userIds: number[];
    leaveDate: string; // YYYY-MM-DD
    leaveType?: "dayoff";
    reviewerId: number;
  }
): Promise<{ recorded: number[]; skipped: { userId: number; reason: string }[] }> {
  const recorded: number[] = [];
  const skipped: { userId: number; reason: string }[] = [];

  for (const userId of opts.userIds) {
    const [existing] = await dbx
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.userId, userId),
          eq(leaveRequests.restaurantId, opts.restaurantId),
          sql`${leaveRequests.leaveDate} = ${opts.leaveDate}`,
          sql`${leaveRequests.status} IN ('pending','approved')`
        )
      )
      .limit(1);
    if (existing) {
      skipped.push({ userId, reason: "이미 휴무 신청/승인 있음" });
      continue;
    }
    if (await hasDuplicateSchedule(opts.restaurantId, opts.leaveDate, { userId }, dbx)) {
      skipped.push({ userId, reason: "해당 날짜에 스케줄이 이미 있음" });
      continue;
    }
    await dbx.insert(leaveRequests).values({
      userId,
      restaurantId: opts.restaurantId,
      leaveDate: opts.leaveDate,
      leaveType: opts.leaveType ?? "dayoff",
      status: "approved",
      source: "manager",
      reviewedBy: opts.reviewerId,
      reviewedAt: new Date(),
    } as any);
    recorded.push(userId);
  }

  return { recorded, skipped };
}
