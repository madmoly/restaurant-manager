import { z } from "zod";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { leaveRequests, users } from "../../drizzle/schema";
import { verifyStoreAccess } from "../middleware/storeAuth";

const LEAVE_TYPE_LABELS: Record<string, string> = {
  dayoff: "휴무",
  half_morning: "반차출근 (오전OFF)",
  half_evening: "반차퇴근 (오후OFF)",
};

export const leaveRequestsRouter = router({
  /** 내 신청 목록 (직원용) */
  listMine: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db
        .select({
          id: leaveRequests.id,
          leaveDate: leaveRequests.leaveDate,
          leaveType: leaveRequests.leaveType,
          reason: leaveRequests.reason,
          status: leaveRequests.status,
          reviewNote: leaveRequests.reviewNote,
          reviewedAt: leaveRequests.reviewedAt,
          createdAt: leaveRequests.createdAt,
        })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.restaurantId, input.restaurantId),
            eq(leaveRequests.userId, ctx.user.userId)
          )
        )
        .orderBy(desc(leaveRequests.createdAt))
        .limit(50);
    }),

  /** 매장별 신청 목록 (매니저용) */
  list: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      status: z.enum(["pending", "approved", "rejected"]).optional(),
    }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const conditions = [eq(leaveRequests.restaurantId, input.restaurantId)];
      if (input.status) conditions.push(eq(leaveRequests.status, input.status) as any);

      return db
        .select({
          id: leaveRequests.id,
          userId: leaveRequests.userId,
          leaveDate: leaveRequests.leaveDate,
          leaveType: leaveRequests.leaveType,
          reason: leaveRequests.reason,
          status: leaveRequests.status,
          reviewNote: leaveRequests.reviewNote,
          reviewedAt: leaveRequests.reviewedAt,
          createdAt: leaveRequests.createdAt,
          userName: users.name,
        })
        .from(leaveRequests)
        .leftJoin(users, eq(leaveRequests.userId, users.id))
        .where(and(...conditions))
        .orderBy(desc(leaveRequests.leaveDate))
        .limit(100);
    }),

  /** 신청 생성 (직원) — 최소 5일 전 */
  create: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      leaveDate: z.string(), // "YYYY-MM-DD"
      leaveType: z.enum(["dayoff", "half_morning", "half_evening"]),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      // 5일 전 제한 검증 (KST 기준)
      const target = new Date(input.leaveDate + "T00:00:00+09:00");
      const nowKST = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
      const todayKST = new Date(Date.UTC(nowKST.getUTCFullYear(), nowKST.getUTCMonth(), nowKST.getUTCDate()));
      const diffDays = Math.floor((target.getTime() - todayKST.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < 5) {
        throw new Error("휴무/반차 신청은 최소 5일 전에 해야 합니다");
      }

      // 중복 신청 방지
      const existing = await db
        .select({ id: leaveRequests.id })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.userId, ctx.user.userId),
            eq(leaveRequests.restaurantId, input.restaurantId),
            sql`${leaveRequests.leaveDate} = ${input.leaveDate}`,
            eq(leaveRequests.status, "pending")
          )
        )
        .limit(1);
      if (existing.length > 0) {
        throw new Error("해당 날짜에 이미 대기 중인 신청이 있습니다");
      }

      const [result] = await db.insert(leaveRequests).values({
        userId: ctx.user.userId,
        restaurantId: input.restaurantId,
        leaveDate: input.leaveDate,
        leaveType: input.leaveType,
        reason: input.reason,
      } as any);
      return { id: (result as any).insertId };
    }),

  /** 승인/거절 (매니저) */
  review: managerProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["approved", "rejected"]),
      reviewNote: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // PR2: id-only fetch → restaurantId 기반 매장 검증
      const [target] = await db.select({ restaurantId: leaveRequests.restaurantId })
        .from(leaveRequests).where(eq(leaveRequests.id, input.id)).limit(1);
      if (!target) throw new Error("휴무 신청을 찾을 수 없습니다");
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, target.restaurantId, true);

      await db
        .update(leaveRequests)
        .set({
          status: input.status,
          reviewedBy: ctx.user.userId,
          reviewNote: input.reviewNote,
          reviewedAt: new Date(),
        })
        .where(eq(leaveRequests.id, input.id));
      return { success: true };
    }),

  /** 신청 취소 (본인만) */
  cancel: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const [req] = await db
        .select()
        .from(leaveRequests)
        .where(eq(leaveRequests.id, input.id))
        .limit(1);
      if (!req) throw new Error("신청을 찾을 수 없습니다");
      if (req.userId !== ctx.user.userId) throw new Error("본인의 신청만 취소할 수 있습니다");
      if (req.status !== "pending") throw new Error("대기 중인 신청만 취소할 수 있습니다");

      await db.delete(leaveRequests).where(eq(leaveRequests.id, input.id));
      return { success: true };
    }),

  /** 대기 중인 신청 수 (매니저 대시보드용) */
  pendingCount: managerProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const [result] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.restaurantId, input.restaurantId),
            eq(leaveRequests.status, "pending")
          )
        );
      return { count: result?.count ?? 0 };
    }),
});
