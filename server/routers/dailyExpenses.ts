import { z } from "zod";
import { eq, and, sql, desc } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { dailyExpenses, expenseCategories } from "../../drizzle/schema";

const DEFAULT_CATEGORIES = [
  "인터넷발주",
  "수리/보수",
  "소모품",
  "배달비",
  "기타",
];

export const dailyExpensesRouter = router({
  /** 카테고리 목록 (활성만) */
  listCategories: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(expenseCategories)
        .where(
          and(
            eq(expenseCategories.restaurantId, input.restaurantId),
            eq(expenseCategories.isActive, true),
          ),
        )
        .orderBy(expenseCategories.sortOrder);
    }),

  /** 기본 카테고리 시드 (카테고리 없을 때 1회 호출) */
  seedDefaultCategories: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .mutation(async ({ input }) => {
      const existing = await db
        .select()
        .from(expenseCategories)
        .where(eq(expenseCategories.restaurantId, input.restaurantId))
        .limit(1);
      if (existing.length > 0) return { seeded: false };

      await db.insert(expenseCategories).values(
        DEFAULT_CATEGORIES.map((name, i) => ({
          restaurantId: input.restaurantId,
          name,
          sortOrder: i,
        })),
      );
      return { seeded: true };
    }),

  /** 카테고리 추가 */
  createCategory: managerProcedure
    .input(z.object({ restaurantId: z.number(), name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const [result] = await db.insert(expenseCategories).values({
        restaurantId: input.restaurantId,
        name: input.name,
        sortOrder: 99,
      });
      return { id: result.insertId };
    }),

  /** 카테고리 비활성화 */
  deactivateCategory: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db
        .update(expenseCategories)
        .set({ isActive: false })
        .where(eq(expenseCategories.id, input.id));
      return { ok: true };
    }),

  /** 일별 즉시지출 목록 (카테고리명 JOIN) */
  listByDate: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      return db
        .select({
          id: dailyExpenses.id,
          restaurantId: dailyExpenses.restaurantId,
          date: dailyExpenses.date,
          categoryId: dailyExpenses.categoryId,
          categoryName: expenseCategories.name,
          category: dailyExpenses.category,
          title: dailyExpenses.title,
          amount: dailyExpenses.amount,
          note: dailyExpenses.note,
          attachmentUrl: dailyExpenses.attachmentUrl,
          createdAt: dailyExpenses.createdAt,
        })
        .from(dailyExpenses)
        .leftJoin(expenseCategories, eq(dailyExpenses.categoryId, expenseCategories.id))
        .where(
          and(
            eq(dailyExpenses.restaurantId, input.restaurantId),
            sql`${dailyExpenses.date} = ${input.date}`,
          ),
        )
        .orderBy(desc(dailyExpenses.createdAt));
    }),

  /** 즉시지출 등록 */
  create: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        date: z.string(),
        categoryId: z.number().optional(),
        title: z.string().min(1),
        amount: z.string().default("0"),
        note: z.string().optional(),
        attachmentUrl: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [result] = await db.insert(dailyExpenses).values({
        restaurantId: input.restaurantId,
        date: input.date,
        categoryId: input.categoryId || null,
        title: input.title,
        amount: input.amount,
        note: input.note || null,
        attachmentUrl: input.attachmentUrl || null,
        createdBy: ctx.user.userId,
      });
      return { id: result.insertId };
    }),

  /** 즉시지출 삭제 */
  delete: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(dailyExpenses).where(eq(dailyExpenses.id, input.id));
      return { ok: true };
    }),

  /** 월별 즉시지출 합계 (수익분석용) */
  monthlyTotal: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input }) => {
      const mm = String(input.month).padStart(2, "0");
      const startDate = `${input.year}-${mm}-01`;
      const nm = input.month === 12 ? 1 : input.month + 1;
      const ny = input.month === 12 ? input.year + 1 : input.year;
      const endDate = `${ny}-${String(nm).padStart(2, "0")}-01`;

      const [row] = await db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(amount AS DECIMAL(14,2))), 0)`,
          count: sql<number>`COUNT(*)`,
        })
        .from(dailyExpenses)
        .where(
          and(
            eq(dailyExpenses.restaurantId, input.restaurantId),
            sql`${dailyExpenses.date} >= ${startDate}`,
            sql`${dailyExpenses.date} < ${endDate}`,
          ),
        );
      return { total: Number(row?.total ?? 0), count: Number(row?.count ?? 0) };
    }),
});
