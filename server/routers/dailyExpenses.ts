import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { dailyExpenses } from "../../drizzle/schema";

export const dailyExpensesRouter = router({
  // 일별 즉시지출 목록
  listByDate: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(dailyExpenses)
        .where(
          and(
            eq(dailyExpenses.restaurantId, input.restaurantId),
            eq(dailyExpenses.expenseDate, input.date),
          ),
        )
        .orderBy(dailyExpenses.createdAt);
    }),

  // 월별 즉시지출 목록
  listByMonth: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input }) => {
      const monthStr = String(input.month).padStart(2, "0");
      const startDate = `${input.year}-${monthStr}-01`;
      const nm = input.month === 12 ? 1 : input.month + 1;
      const ny = input.month === 12 ? input.year + 1 : input.year;
      const endDate = `${ny}-${String(nm).padStart(2, "0")}-01`;

      return db
        .select()
        .from(dailyExpenses)
        .where(
          and(
            eq(dailyExpenses.restaurantId, input.restaurantId),
            sql`${dailyExpenses.expenseDate} >= ${startDate}`,
            sql`${dailyExpenses.expenseDate} < ${endDate}`,
          ),
        )
        .orderBy(dailyExpenses.expenseDate);
    }),

  // 즉시지출 등록
  create: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        expenseDate: z.string(),
        category: z.enum(["internet", "repair", "supply", "delivery", "other"]),
        title: z.string().min(1),
        amount: z.number().min(0),
        note: z.string().optional(),
        attachmentUrl: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const [result] = await db.insert(dailyExpenses).values({
        restaurantId: input.restaurantId,
        expenseDate: input.expenseDate,
        category: input.category,
        title: input.title,
        amount: String(input.amount),
        note: input.note || null,
        attachmentUrl: input.attachmentUrl || null,
        createdBy: ctx.user.userId,
      });
      return { id: result.insertId };
    }),

  // 즉시지출 삭제
  delete: managerProcedure
    .input(z.object({ id: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input }) => {
      await db
        .delete(dailyExpenses)
        .where(
          and(
            eq(dailyExpenses.id, input.id),
            eq(dailyExpenses.restaurantId, input.restaurantId),
          ),
        );
      return { success: true };
    }),
});
