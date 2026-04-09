import { z } from "zod";
import { desc, eq, and, gte, lte, sql, inArray } from "drizzle-orm";
import { router, publicProcedure, adminProcedure, masterProcedure } from "../trpc";
import { db } from "../db";
import { errorLogs, users, restaurants } from "../../drizzle/schema";
import { getOwnedRestaurantIds } from "../helpers/restaurantScope";

export const errorLogsRouter = router({
  /** 에러 기록 — 비로그인도 가능 (앱 크래시 시) */
  report: publicProcedure
    .input(z.object({
      errorType: z.enum(["client", "api", "render", "network"]).default("client"),
      message: z.string().max(2000),
      stack: z.string().max(5000).optional(),
      url: z.string().max(500).optional(),
      userAgent: z.string().max(500).optional(),
      metadata: z.record(z.any()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.insert(errorLogs).values({
        userId: ctx.user?.userId ?? null,
        errorType: input.errorType,
        message: input.message,
        stack: input.stack,
        url: input.url,
        userAgent: input.userAgent,
        metadata: input.metadata,
      });
      return { ok: true };
    }),

  /** 에러 목록 조회 — admin 전용 */
  list: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
      errorType: z.enum(["client", "api", "render", "network"]).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const conditions = [];
      if (input.errorType) conditions.push(eq(errorLogs.errorType, input.errorType));
      if (input.from) conditions.push(gte(errorLogs.createdAt, new Date(input.from)));
      if (input.to) conditions.push(lte(errorLogs.createdAt, new Date(input.to)));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, countResult] = await Promise.all([
        db.select().from(errorLogs)
          .where(where)
          .orderBy(desc(errorLogs.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ count: sql<number>`COUNT(*)` }).from(errorLogs).where(where),
      ]);

      return { rows, total: countResult[0]?.count ?? 0 };
    }),

  /** 최근 에러 요약 — admin 대시보드용 */
  recentSummary: adminProcedure.query(async () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [day, week] = await Promise.all([
      db.select({ count: sql<number>`COUNT(*)` }).from(errorLogs)
        .where(gte(errorLogs.createdAt, oneDayAgo)),
      db.select({ count: sql<number>`COUNT(*)` }).from(errorLogs)
        .where(gte(errorLogs.createdAt, oneWeekAgo)),
    ]);

    // 타입별 분포 (최근 7일)
    const byType = await db
      .select({
        errorType: errorLogs.errorType,
        count: sql<number>`COUNT(*)`,
      })
      .from(errorLogs)
      .where(gte(errorLogs.createdAt, oneWeekAgo))
      .groupBy(errorLogs.errorType);

    return {
      last24h: day[0]?.count ?? 0,
      last7d: week[0]?.count ?? 0,
      byType,
    };
  }),

  /** 매장별 에러 집계 — master 전용, 중앙 스코핑으로 tutorial 제외 */
  summaryByRestaurant: masterProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(7) }))
    .query(async ({ input, ctx }) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const realIds = await getOwnedRestaurantIds(ctx.user.userId, ctx.user.role);
      const rows = await db
        .select({
          restaurantId: errorLogs.restaurantId,
          restaurantName: restaurants.name,
          count: sql<number>`COUNT(*)`,
          lastError: sql<string>`MAX(${errorLogs.createdAt})`,
        })
        .from(errorLogs)
        .leftJoin(restaurants, eq(errorLogs.restaurantId, restaurants.id))
        .where(and(
          gte(errorLogs.createdAt, since),
          realIds.length > 0
            ? sql`(${errorLogs.restaurantId} IN (${sql.raw(realIds.join(","))}) OR ${errorLogs.restaurantId} IS NULL)`
            : sql`${errorLogs.restaurantId} IS NULL`,
        ))
        .groupBy(errorLogs.restaurantId, restaurants.name)
        .orderBy(desc(sql`COUNT(*)`));
      return rows;
    }),

  /** 사용자별 에러 집계 — master 전용 */
  summaryByUser: masterProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(7) }))
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const rows = await db
        .select({
          userId: errorLogs.userId,
          userName: users.name,
          username: users.username,
          count: sql<number>`COUNT(*)`,
          lastError: sql<string>`MAX(${errorLogs.createdAt})`,
        })
        .from(errorLogs)
        .leftJoin(users, eq(errorLogs.userId, users.id))
        .where(gte(errorLogs.createdAt, since))
        .groupBy(errorLogs.userId, users.name, users.username)
        .orderBy(desc(sql`COUNT(*)`));
      return rows;
    }),

  /** 일별 에러 추이 — master 전용 */
  dailyTrend: masterProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(14) }))
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const rows = await db
        .select({
          date: sql<string>`DATE(${errorLogs.createdAt})`,
          count: sql<number>`COUNT(*)`,
        })
        .from(errorLogs)
        .where(gte(errorLogs.createdAt, since))
        .groupBy(sql`DATE(${errorLogs.createdAt})`)
        .orderBy(sql`DATE(${errorLogs.createdAt})`);
      return rows;
    }),

  // ═══════════════════════════════════════════════════════════════════════
  //  v2: fingerprint 그룹 기반 조회 · 상태 관리 (2026-04-09 추가)
  // ═══════════════════════════════════════════════════════════════════════

  /** severity별 활성(미해결) 에러 요약 — master 대시보드 상단 */
  severitySummary: masterProcedure.query(async () => {
    const rows = await db
      .select({
        severity: errorLogs.severity,
        count: sql<number>`COUNT(*)`,
        totalOccurrences: sql<number>`COALESCE(SUM(${errorLogs.occurrenceCount}),0)`,
      })
      .from(errorLogs)
      .where(sql`${errorLogs.status} IN ('new','acknowledged')`)
      .groupBy(errorLogs.severity);
    const result = { P0: 0, P1: 0, P2: 0, P3: 0, totalP0: 0, totalP1: 0, totalP2: 0, totalP3: 0 };
    for (const r of rows) {
      const k = (r.severity || "P3") as "P0" | "P1" | "P2" | "P3";
      result[k] = Number(r.count) || 0;
      (result as any)[`total${k}`] = Number(r.totalOccurrences) || 0;
    }
    return result;
  }),

  /** fingerprint 그룹 리스트 — 같은 에러는 1행으로 집계 */
  groupList: masterProcedure
    .input(z.object({
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
      status: z.enum(["new", "acknowledged", "auto_mitigated", "resolved", "ignored", "all", "active"]).default("active"),
      severity: z.enum(["P0", "P1", "P2", "P3", "all"]).default("all"),
      category: z.string().optional(),
      days: z.number().min(1).max(90).default(7),
    }))
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const conds: any[] = [gte(errorLogs.lastSeenAt, since)];
      if (input.status === "active") {
        conds.push(sql`${errorLogs.status} IN ('new','acknowledged')`);
      } else if (input.status !== "all") {
        conds.push(eq(errorLogs.status, input.status));
      }
      if (input.severity !== "all") conds.push(eq(errorLogs.severity, input.severity));
      if (input.category) conds.push(eq(errorLogs.category, input.category));

      // fingerprint당 최신 row (id MAX) 선택 후 조인
      const latestIds = db
        .select({ maxId: sql<number>`MAX(id)`.as("maxId") })
        .from(errorLogs)
        .where(and(...conds))
        .groupBy(errorLogs.fingerprint)
        .as("latest");

      const rows = await db
        .select({
          id: errorLogs.id,
          fingerprint: errorLogs.fingerprint,
          severity: errorLogs.severity,
          category: errorLogs.category,
          errorType: errorLogs.errorType,
          message: errorLogs.message,
          url: errorLogs.url,
          status: errorLogs.status,
          occurrenceCount: errorLogs.occurrenceCount,
          affectedUserCount: errorLogs.affectedUserCount,
          affectedRestaurantCount: errorLogs.affectedRestaurantCount,
          firstSeenAt: errorLogs.firstSeenAt,
          lastSeenAt: errorLogs.lastSeenAt,
          autoAction: errorLogs.autoAction,
          notifiedAt: errorLogs.notifiedAt,
        })
        .from(errorLogs)
        .innerJoin(latestIds, eq(errorLogs.id, latestIds.maxId))
        .orderBy(
          sql`CASE ${errorLogs.severity} WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END`,
          desc(errorLogs.lastSeenAt),
        )
        .limit(input.limit)
        .offset(input.offset);

      const totalResult = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${errorLogs.fingerprint})` })
        .from(errorLogs)
        .where(and(...conds));

      return { rows, total: Number(totalResult[0]?.count) || 0 };
    }),

  /** 특정 fingerprint의 상세 발생 이력 (최근 N건) */
  groupDetail: masterProcedure
    .input(z.object({
      fingerprint: z.string().min(1).max(64),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          id: errorLogs.id,
          userId: errorLogs.userId,
          restaurantId: errorLogs.restaurantId,
          message: errorLogs.message,
          stack: errorLogs.stack,
          url: errorLogs.url,
          userAgent: errorLogs.userAgent,
          metadata: errorLogs.metadata,
          createdAt: errorLogs.createdAt,
          lastSeenAt: errorLogs.lastSeenAt,
          occurrenceCount: errorLogs.occurrenceCount,
        })
        .from(errorLogs)
        .where(eq(errorLogs.fingerprint, input.fingerprint))
        .orderBy(desc(errorLogs.lastSeenAt))
        .limit(input.limit);
      return rows;
    }),

  /** 상태 변경 (acknowledge / resolve / ignore) */
  setStatus: masterProcedure
    .input(z.object({
      fingerprint: z.string().min(1).max(64),
      status: z.enum(["new", "acknowledged", "resolved", "ignored"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const resolvedAt = (input.status === "resolved") ? new Date() : null;
      const resolvedBy = (input.status === "resolved") ? ctx.user.userId : null;
      await db
        .update(errorLogs)
        .set({
          status: input.status,
          resolvedAt,
          resolvedBy,
        })
        .where(eq(errorLogs.fingerprint, input.fingerprint));
      return { ok: true };
    }),

  /** 벌크 상태 변경 (여러 fingerprint 한 번에) */
  bulkSetStatus: masterProcedure
    .input(z.object({
      fingerprints: z.array(z.string().min(1).max(64)).min(1).max(100),
      status: z.enum(["acknowledged", "resolved", "ignored"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const resolvedAt = (input.status === "resolved") ? new Date() : null;
      const resolvedBy = (input.status === "resolved") ? ctx.user.userId : null;
      await db
        .update(errorLogs)
        .set({ status: input.status, resolvedAt, resolvedBy })
        .where(inArray(errorLogs.fingerprint, input.fingerprints));
      return { ok: true, count: input.fingerprints.length };
    }),
});
