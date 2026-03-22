import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { dailyOperations } from "../../drizzle/schema";

export const dailyOpsRouter = router({
  /** 오늘 운영 현황 조회 (없으면 null) */
  getByDate: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      const [row] = await db
        .select()
        .from(dailyOperations)
        .where(
          and(
            eq(dailyOperations.restaurantId, input.restaurantId),
            sql`${dailyOperations.operationDate} = ${input.date}`
          )
        )
        .limit(1);
      return row ?? null;
    }),

  /** 오픈 체크 */
  checkOpen: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        date: z.string(),
        headcount: z.number().optional(),
        laborCost: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // upsert: 있으면 업데이트, 없으면 생성
      const [existing] = await db
        .select()
        .from(dailyOperations)
        .where(
          and(
            eq(dailyOperations.restaurantId, input.restaurantId),
            sql`${dailyOperations.operationDate} = ${input.date}`
          )
        )
        .limit(1);

      if (existing) {
        await db
          .update(dailyOperations)
          .set({
            openCheckedAt: new Date(),
            openCheckedBy: ctx.user.userId,
            openHeadcount: input.headcount ?? 0,
            openLaborCost: input.laborCost ? String(input.laborCost) : "0",
          })
          .where(eq(dailyOperations.id, existing.id));
        return { id: existing.id };
      }

      const [result] = await db.insert(dailyOperations).values({
        restaurantId: input.restaurantId,
        operationDate: input.date,
        openCheckedAt: new Date(),
        openCheckedBy: ctx.user.userId,
        openHeadcount: input.headcount ?? 0,
        openLaborCost: input.laborCost ? String(input.laborCost) : "0",
      } as any);
      return { id: (result as any).insertId };
    }),

  /** 마감 체크 */
  checkClose: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        date: z.string(),
        headcount: z.number().optional(),
        laborCost: z.number().optional(),
        closeNote: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [existing] = await db
        .select()
        .from(dailyOperations)
        .where(
          and(
            eq(dailyOperations.restaurantId, input.restaurantId),
            sql`${dailyOperations.operationDate} = ${input.date}`
          )
        )
        .limit(1);

      if (existing) {
        await db
          .update(dailyOperations)
          .set({
            closeCheckedAt: new Date(),
            closeCheckedBy: ctx.user.userId,
            closeHeadcount: input.headcount ?? 0,
            closeLaborCost: input.laborCost ? String(input.laborCost) : "0",
            closeNote: input.closeNote,
          })
          .where(eq(dailyOperations.id, existing.id));
        return { id: existing.id };
      }

      const [result] = await db.insert(dailyOperations).values({
        restaurantId: input.restaurantId,
        operationDate: input.date,
        closeCheckedAt: new Date(),
        closeCheckedBy: ctx.user.userId,
        closeHeadcount: input.headcount ?? 0,
        closeLaborCost: input.laborCost ? String(input.laborCost) : "0",
        closeNote: input.closeNote,
      } as any);
      return { id: (result as any).insertId };
    }),
});
