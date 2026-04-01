import { z } from "zod";
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { dailyExpenses, expenseCategories } from "../../drizzle/schema";

export const dailyExpensesRouter = router({
  // ═══ 카테고리 관리 ═══

  /** 매장별 지출 카테고리 목록 */
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
        .orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.id));
    }),

  /** 카테고리 추가 */
  createCategory: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      name: z.string().min(1).max(100),
    }))
    .mutation(async ({ input }) => {
      // sortOrder를 기존 최대값 + 1로 설정
      const [maxRow] = await db
        .select({ maxSort: sql<number>`COALESCE(MAX(sortOrder), 0)` })
        .from(expenseCategories)
        .where(eq(expenseCategories.restaurantId, input.restaurantId));
      const nextSort = (maxRow?.maxSort ?? 0) + 1;

      const [result] = await db.insert(expenseCategories).values({
        restaurantId: input.restaurantId,
        name: input.name,
        sortOrder: nextSort,
      });
      return { id: result.insertId };
    }),

  /** 카테고리 수정 */
  updateCategory: managerProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      sortOrder: z.number().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...rest } = input;
      await db.update(expenseCategories).set(rest).where(eq(expenseCategories.id, id));
      return { ok: true };
    }),

  /** 카테고리 비활성화 (삭제 대신) */
  deactivateCategory: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.update(expenseCategories).set({ isActive: false }).where(eq(expenseCategories.id, input.id));
      return { ok: true };
    }),

  /** 카테고리 초기 시드 (매장 첫 사용 시 기본 카테고리 생성) */
  seedDefaultCategories: managerProcedure
    .input(z.object({ restaurantId: z.number() }))
    .mutation(async ({ input }) => {
      // 이미 카테고리가 있으면 스킵
      const [existing] = await db
        .select({ cnt: sql<number>`COUNT(*)` })
        .from(expenseCategories)
        .where(eq(expenseCategories.restaurantId, input.restaurantId));
      if (Number(existing?.cnt) > 0) return { seeded: false };

      const defaults = [
        { name: "인터넷발주", sortOrder: 1 },
        { name: "수리/AS", sortOrder: 2 },
        { name: "소모품", sortOrder: 3 },
        { name: "배달비", sortOrder: 4 },
        { name: "기타", sortOrder: 5 },
      ];
      await db.insert(expenseCategories).values(
        defaults.map((d) => ({ ...d, restaurantId: input.restaurantId })),
      );
      return { seeded: true };
    }),

  // ═══ 즉시지출 CRUD ═══

  /** 일별 즉시지출 목록 (카테고리 JOIN) */
  listByDate: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      return db
        .select({
          id: dailyExpenses.id,
          restaurantId: dailyExpenses.restaurantId,
          expenseDate: dailyExpenses.expenseDate,
          category: dailyExpenses.category,
          categoryId: dailyExpenses.categoryId,
          categoryName: expenseCategories.name,
          title: dailyExpenses.title,
          amount: dailyExpenses.amount,
          note: dailyExpenses.note,
          attachmentUrl: dailyExpenses.attachmentUrl,
          createdBy: dailyExpenses.createdBy,
          createdAt: dailyExpenses.createdAt,
        })
        .from(dailyExpenses)
        .leftJoin(expenseCategories, eq(dailyExpenses.categoryId, expenseCategories.id))
        .where(
          and(
            eq(dailyExpenses.restaurantId, input.restaurantId),
            eq(dailyExpenses.expenseDate, input.date),
          ),
        )
        .orderBy(dailyExpenses.createdAt);
    }),

  /** 월별 즉시지출 목록 */
  listByMonth: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input }) => {
      const monthStr = String(input.month).padStart(2, "0");
      const startDate = `${input.year}-${monthStr}-01`;
      const nm = input.month === 12 ? 1 : input.month + 1;
      const ny = input.month === 12 ? input.year + 1 : input.year;
      const endDate = `${ny}-${String(nm).padStart(2, "0")}-01`;

      return db
        .select({
          id: dailyExpenses.id,
          restaurantId: dailyExpenses.restaurantId,
          expenseDate: dailyExpenses.expenseDate,
          category: dailyExpenses.category,
          categoryId: dailyExpenses.categoryId,
          categoryName: expenseCategories.name,
          title: dailyExpenses.title,
          amount: dailyExpenses.amount,
          note: dailyExpenses.note,
          attachmentUrl: dailyExpenses.attachmentUrl,
          createdBy: dailyExpenses.createdBy,
          createdAt: dailyExpenses.createdAt,
        })
        .from(dailyExpenses)
        .leftJoin(expenseCategories, eq(dailyExpenses.categoryId, expenseCategories.id))
        .where(
          and(
            eq(dailyExpenses.restaurantId, input.restaurantId),
            sql`${dailyExpenses.expenseDate} >= ${startDate}`,
            sql`${dailyExpenses.expenseDate} < ${endDate}`,
          ),
        )
        .orderBy(dailyExpenses.expenseDate);
    }),

  /** 즉시지출 등록 (커스텀 카테고리 지원) */
  create: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        expenseDate: z.string(),
        categoryId: z.number(),
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
        category: "other",  // 레거시 필드: 기본값
        categoryId: input.categoryId,
        title: input.title,
        amount: String(input.amount),
        note: input.note || null,
        attachmentUrl: input.attachmentUrl || null,
        createdBy: ctx.user.userId,
      });
      return { id: result.insertId };
    }),

  /** 즉시지출 수정 */
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      restaurantId: z.number(),
      categoryId: z.number().optional(),
      title: z.string().min(1).optional(),
      amount: z.number().min(0).optional(),
      note: z.string().nullable().optional(),
      attachmentUrl: z.string().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, restaurantId, ...rest } = input;
      const updateData: Record<string, any> = {};
      if (rest.categoryId !== undefined) updateData.categoryId = rest.categoryId;
      if (rest.title !== undefined) updateData.title = rest.title;
      if (rest.amount !== undefined) updateData.amount = String(rest.amount);
      if (rest.note !== undefined) updateData.note = rest.note;
      if (rest.attachmentUrl !== undefined) updateData.attachmentUrl = rest.attachmentUrl;

      await db.update(dailyExpenses).set(updateData).where(
        and(eq(dailyExpenses.id, id), eq(dailyExpenses.restaurantId, restaurantId)),
      );
      return { ok: true };
    }),

  /** 즉시지출 삭제 */
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

  /** 월별 카테고리별 지출 합계 (수익분석용) */
  monthlySummary: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input }) => {
      const monthStr = String(input.month).padStart(2, "0");
      const startDate = `${input.year}-${monthStr}-01`;
      const nm = input.month === 12 ? 1 : input.month + 1;
      const ny = input.month === 12 ? input.year + 1 : input.year;
      const endDate = `${ny}-${String(nm).padStart(2, "0")}-01`;

      const rows = await db.execute(sql`
        SELECT
          COALESCE(ec.name, de.category) AS categoryName,
          de.categoryId,
          COUNT(*) AS cnt,
          SUM(CAST(de.amount AS DECIMAL(14,2))) AS total
        FROM daily_expenses de
        LEFT JOIN expense_categories ec ON de.categoryId = ec.id
        WHERE de.restaurantId = ${input.restaurantId}
          AND de.expenseDate >= ${startDate}
          AND de.expenseDate < ${endDate}
        GROUP BY COALESCE(ec.name, de.category), de.categoryId
        ORDER BY total DESC
      `);

      return (rows[0] as unknown as any[]).map((r: any) => ({
        categoryName: r.categoryName,
        categoryId: r.categoryId,
        count: Number(r.cnt),
        total: Number(r.total),
      }));
    }),
});
