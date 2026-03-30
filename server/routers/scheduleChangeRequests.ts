import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import {
  scheduleChangeRequests,
  schedules,
  users,
} from "../../drizzle/schema";

export const scheduleChangeRequestsRouter = router({
  /** 변경 요청 목록 (점장/매니저용) */
  list: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        status: z.enum(["pending", "approved", "rejected"]).optional(),
      })
    )
    .query(async ({ input }) => {
      const conditions = [eq(scheduleChangeRequests.restaurantId, input.restaurantId)];
      if (input.status) conditions.push(eq(scheduleChangeRequests.status, input.status) as any);

      return db
        .select({
          id: scheduleChangeRequests.id,
          scheduleId: scheduleChangeRequests.scheduleId,
          requestedBy: scheduleChangeRequests.requestedBy,
          requestType: scheduleChangeRequests.requestType,
          reason: scheduleChangeRequests.reason,
          requestedStartTime: scheduleChangeRequests.requestedStartTime,
          requestedEndTime: scheduleChangeRequests.requestedEndTime,
          status: scheduleChangeRequests.status,
          reviewNote: scheduleChangeRequests.reviewNote,
          createdAt: scheduleChangeRequests.createdAt,
          requesterName: users.name,
        })
        .from(scheduleChangeRequests)
        .leftJoin(users, eq(scheduleChangeRequests.requestedBy, users.id))
        .where(and(...conditions))
        .orderBy(desc(scheduleChangeRequests.createdAt));
    }),

  /** 내 변경 요청 목록 (직원용) */
  listMine: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      return db
        .select({
          id: scheduleChangeRequests.id,
          scheduleId: scheduleChangeRequests.scheduleId,
          requestType: scheduleChangeRequests.requestType,
          reason: scheduleChangeRequests.reason,
          status: scheduleChangeRequests.status,
          reviewNote: scheduleChangeRequests.reviewNote,
          createdAt: scheduleChangeRequests.createdAt,
        })
        .from(scheduleChangeRequests)
        .where(
          and(
            eq(scheduleChangeRequests.restaurantId, input.restaurantId),
            eq(scheduleChangeRequests.requestedBy, ctx.user.userId)
          )
        )
        .orderBy(desc(scheduleChangeRequests.createdAt));
    }),

  /** 변경 요청 생성 (직원) */
  create: protectedProcedure
    .input(
      z.object({
        scheduleId: z.number(),
        restaurantId: z.number(),
        requestType: z.enum(["swap", "change", "off"]),
        reason: z.string().optional(),
        requestedStartTime: z.string().optional(),
        requestedEndTime: z.string().optional(),
        swapTargetScheduleId: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [result] = await db.insert(scheduleChangeRequests).values({
        scheduleId: input.scheduleId,
        requestedBy: ctx.user.userId,
        restaurantId: input.restaurantId,
        requestType: input.requestType,
        reason: input.reason,
        requestedStartTime: input.requestedStartTime ? new Date(input.requestedStartTime) : null,
        requestedEndTime: input.requestedEndTime ? new Date(input.requestedEndTime) : null,
        swapTargetScheduleId: input.swapTargetScheduleId,
      } as any);
      return { id: (result as any).insertId };
    }),

  /** 승인/거절 (매니저) */
  review: managerProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["approved", "rejected"]),
        reviewNote: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await db
        .update(scheduleChangeRequests)
        .set({
          status: input.status,
          reviewedBy: ctx.user.userId,
          reviewNote: input.reviewNote,
          reviewedAt: new Date(),
        })
        .where(eq(scheduleChangeRequests.id, input.id));

      // 승인 시 스케줄 반영
      if (input.status === "approved") {
        const [req] = await db
          .select()
          .from(scheduleChangeRequests)
          .where(eq(scheduleChangeRequests.id, input.id))
          .limit(1);

        if (req) {
          // 해당 스케줄 현재 상태 조회 (정산 영향 판단)
          const [currentSchedule] = await db
            .select({ status: schedules.status })
            .from(schedules)
            .where(eq(schedules.id, req.scheduleId))
            .limit(1);
          const isCompleted = currentSchedule?.status === "completed";
          const editReason = `변경요청 승인: ${req.reason ?? req.requestType}`;

          if (req.requestType === "off") {
            await db
              .update(schedules)
              .set({
                status: "canceled",
                editReason,
                ...(isCompleted ? { payrollRecheckRequired: true } : {}),
              } as any)
              .where(eq(schedules.id, req.scheduleId));
          } else if (req.requestType === "change" && req.requestedStartTime && req.requestedEndTime) {
            await db
              .update(schedules)
              .set({
                startTime: req.requestedStartTime,
                endTime: req.requestedEndTime,
                editReason,
                ...(isCompleted ? { payrollRecheckRequired: true } : {}),
              } as any)
              .where(eq(schedules.id, req.scheduleId));
          }
        }
      }

      return { success: true };
    }),
});
