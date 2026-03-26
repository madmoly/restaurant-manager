import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { notifications } from "../../drizzle/schema";

export const notificationsRouter = router({
  /** 내 알림 목록 (최신 50개) */
  listMine: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(async ({ ctx, input }) => {
      return db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, ctx.user.userId))
        .orderBy(desc(notifications.createdAt))
        .limit(input.limit);
    }),

  /** 읽지 않은 알림 수 */
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, ctx.user.userId),
          eq(notifications.isRead, false),
        ),
      );
    return { count: rows.length };
  }),

  /** 알림 읽음 처리 */
  markRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(
            eq(notifications.id, input.id),
            eq(notifications.recipientId, ctx.user.userId),
          ),
        );
      return { ok: true };
    }),

  /** 전체 읽음 처리 */
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(notifications.recipientId, ctx.user.userId),
          eq(notifications.isRead, false),
        ),
      );
    return { ok: true };
  }),

  /** 알림 생성 (시스템 내부 호출용) */
  create: protectedProcedure
    .input(
      z.object({
        recipientId: z.number(),
        type: z.enum([
          "schedule_change",
          "cost_exceeded",
          "target_achieved",
          "general",
          "schedule_assigned",
          "schedule_updated",
          "schedule_deleted",
          "health_cert_expiry",
          "system_announcement",
        ]),
        title: z.string(),
        content: z.string().optional(),
        restaurantId: z.number().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const [result] = await db
        .insert(notifications)
        .values({
          recipientId: input.recipientId,
          type: input.type,
          title: input.title,
          content: input.content,
          restaurantId: input.restaurantId,
        })
        .$returningId();
      return { id: result.id };
    }),
});
