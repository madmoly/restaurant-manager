import { z } from "zod";
import { desc, eq, and, gte, lte, sql, inArray, or, isNull } from "drizzle-orm";
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
            ? or(inArray(errorLogs.restaurantId, realIds), isNull(errorLogs.restaurantId))
            : isNull(errorLogs.restaurantId),
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
});
