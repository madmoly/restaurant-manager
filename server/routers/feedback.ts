import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { router, protectedProcedure, masterProcedure } from "../trpc";
import { db } from "../db";
import { userFeedbacks, users, restaurants } from "../../drizzle/schema";

export const feedbackRouter = router({
  /** 피드백 제출 — 로그인 필요 */
  submit: protectedProcedure
    .input(z.object({
      restaurantId: z.number().int().positive().optional(),
      type: z.enum(["bug", "suggestion"]),
      title: z.string().min(1).max(200),
      content: z.string().min(1),
      screenshotBase64: z.string().max(5_000_000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.insert(userFeedbacks).values({
        userId: ctx.user.userId,
        restaurantId: input.restaurantId ?? null,
        type: input.type,
        title: input.title,
        content: input.content,
        screenshotBase64: input.screenshotBase64 ?? null,
      });
      return { ok: true };
    }),

  /** 전체 목록 — master 전용 */
  list: masterProcedure
    .input(z.object({
      status: z.enum(["pending", "reviewed", "resolved", "all"]).default("all"),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          id: userFeedbacks.id,
          userId: userFeedbacks.userId,
          userName: users.name,
          username: users.username,
          restaurantId: userFeedbacks.restaurantId,
          restaurantName: restaurants.name,
          type: userFeedbacks.type,
          title: userFeedbacks.title,
          content: userFeedbacks.content,
          screenshotBase64: userFeedbacks.screenshotBase64,
          status: userFeedbacks.status,
          createdAt: userFeedbacks.createdAt,
          updatedAt: userFeedbacks.updatedAt,
        })
        .from(userFeedbacks)
        .leftJoin(users, eq(userFeedbacks.userId, users.id))
        .leftJoin(restaurants, eq(userFeedbacks.restaurantId, restaurants.id))
        .where(input.status !== "all" ? eq(userFeedbacks.status, input.status) : undefined)
        .orderBy(desc(userFeedbacks.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows;
    }),

  /** 상태 변경 — master 전용 */
  updateStatus: masterProcedure
    .input(z.object({
      id: z.number().int().positive(),
      status: z.enum(["pending", "reviewed", "resolved"]),
    }))
    .mutation(async ({ input }) => {
      await db
        .update(userFeedbacks)
        .set({ status: input.status })
        .where(eq(userFeedbacks.id, input.id));
      return { ok: true };
    }),
});
