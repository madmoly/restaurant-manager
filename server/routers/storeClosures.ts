import { z } from "zod";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { router, managerProcedure, protectedProcedure } from "../trpc";
import { db } from "../db";
import { storeClosedDays, storeWeeklyClosures } from "../../drizzle/schema";
import { verifyStoreAccess } from "../middleware/storeAuth";

export const storeClosuresRouter = router({
  /** 특정 월의 휴무일 조회 */
  listByMonth: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const monthStr = String(input.month).padStart(2, "0");
      const from = `${input.year}-${monthStr}-01`;
      const toDate = new Date(input.year, input.month, 1);
      const to = toDate.toISOString().split("T")[0];
      return db
        .select()
        .from(storeClosedDays)
        .where(
          and(
            eq(storeClosedDays.restaurantId, input.restaurantId),
            sql`${storeClosedDays.closedDate} >= ${from}`,
            sql`${storeClosedDays.closedDate} < ${to}`
          )
        )
        .orderBy(storeClosedDays.closedDate);
    }),

  /** 기간 휴무일 조회 — 스케줄 주간 스트림처럼 월 경계를 걸치는 화면용 */
  listByRange: protectedProcedure
    .input(z.object({ restaurantId: z.number(), from: z.string(), to: z.string() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db
        .select()
        .from(storeClosedDays)
        .where(
          and(
            eq(storeClosedDays.restaurantId, input.restaurantId),
            sql`${storeClosedDays.closedDate} >= ${input.from}`,
            sql`${storeClosedDays.closedDate} <= ${input.to}`
          )
        )
        .orderBy(storeClosedDays.closedDate);
    }),

  /** 휴무일 추가 */
  create: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        closedDate: z.string(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      const [result] = await db.insert(storeClosedDays).values({
        restaurantId: input.restaurantId,
        closedDate: input.closedDate,
        reason: input.reason,
        createdBy: ctx.user.userId,
      } as any);
      return { id: (result as any).insertId };
    }),

  /** 휴무일 삭제 */
  delete: managerProcedure
    .input(z.object({ id: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      // 타 매장 행이 지워지지 않도록 restaurantId를 삭제 조건에 함께 건다
      await db
        .delete(storeClosedDays)
        .where(
          and(
            eq(storeClosedDays.id, input.id),
            eq(storeClosedDays.restaurantId, input.restaurantId)
          )
        );
      return { success: true };
    }),

  /** 정기 휴무 요일 조회 */
  getWeeklyClosures: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db
        .select()
        .from(storeWeeklyClosures)
        .where(eq(storeWeeklyClosures.restaurantId, input.restaurantId))
        .orderBy(storeWeeklyClosures.weekday);
    }),

  /** 정기 휴무 요일 설정 (전체 교체) */
  setWeeklyClosures: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        closedDays: z.array(z.number().min(0).max(6)), // [0,6] = 일,토
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      // 기존 삭제 후 재삽입
      await db
        .delete(storeWeeklyClosures)
        .where(eq(storeWeeklyClosures.restaurantId, input.restaurantId));
      if (input.closedDays.length > 0) {
        await db.insert(storeWeeklyClosures).values(
          input.closedDays.map((wd) => ({
            restaurantId: input.restaurantId,
            weekday: wd,
            isClosed: true,
          }))
        );
      }
      return { success: true };
    }),
});
