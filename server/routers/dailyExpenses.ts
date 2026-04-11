import { z } from "zod";
import { eq, and, sql, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { dailyExpenses, expenseCategories } from "../../drizzle/schema";
import { verifyStoreAccess } from "../middleware/storeAuth";

/** Drizzle/mysql2 에러의 실제 MySQL 원인(sqlMessage/code)을 surface. */
function unwrapDbError(err: any, context: string): TRPCError {
  const cause: any = err?.cause ?? err;
  const sqlMessage: string | undefined = cause?.sqlMessage;
  const code: string | undefined = cause?.code;
  const errno: number | undefined = cause?.errno;
  const parts = [context];
  if (code) parts.push(`[${code}${errno ? `/${errno}` : ""}]`);
  if (sqlMessage) parts.push(sqlMessage);
  else if (err?.message) parts.push(String(err.message).split("\n")[0]);
  console.error(`[dailyExpenses] ${context}`, {
    code,
    errno,
    sqlMessage,
    message: err?.message,
  });
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: parts.join(" "),
    cause: err,
  });
}

export const dailyExpensesRouter = router({
  /** 카테고리 목록 */
  listCategories: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db
        .select()
        .from(expenseCategories)
        .where(and(eq(expenseCategories.restaurantId, input.restaurantId), eq(expenseCategories.isActive, true)))
        .orderBy(expenseCategories.sortOrder);
    }),

  /** 기본 카테고리 시드 (최초 1회) */
  seedDefaultCategories: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const existing = await db
        .select({ id: expenseCategories.id })
        .from(expenseCategories)
        .where(eq(expenseCategories.restaurantId, input.restaurantId))
        .limit(1);
      if (existing.length > 0) return { seeded: false };

      const defaults = ["인터넷발주", "수리/보수", "소모품", "배달비", "기타"];
      for (let i = 0; i < defaults.length; i++) {
        await db.insert(expenseCategories).values({
          restaurantId: input.restaurantId,
          name: defaults[i],
          sortOrder: i,
        });
      }
      return { seeded: true };
    }),

  /** 일별 즉시지출 목록 (카테고리명 JOIN) */
  listByDate: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db
        .select({
          id: dailyExpenses.id,
          date: dailyExpenses.date,
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
            eq(dailyExpenses.date, input.date),
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
        amount: z.string(),
        note: z.string().optional(),
        attachmentUrl: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      try {
        // 카테고리명도 같이 저장 (비정규화) — 카테고리 매장 소유 검증
        let catName: string | null = null;
        if (input.categoryId) {
          const [cat] = await db
            .select({ name: expenseCategories.name, restaurantId: expenseCategories.restaurantId })
            .from(expenseCategories)
            .where(eq(expenseCategories.id, input.categoryId));
          if (!cat) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "존재하지 않는 지출 분류입니다." });
          }
          if (cat.restaurantId !== input.restaurantId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "다른 매장의 지출 분류입니다." });
          }
          catName = cat.name;
        }
        const [result] = await db.insert(dailyExpenses).values({
          restaurantId: input.restaurantId,
          date: input.date,
          categoryId: input.categoryId ?? null,
          category: catName,
          title: input.title,
          amount: input.amount,
          note: input.note && input.note.length > 0 ? input.note : null,
          attachmentUrl: input.attachmentUrl && input.attachmentUrl.length > 0 ? input.attachmentUrl : null,
          createdBy: ctx.user.userId,
        });
        return { id: result.insertId };
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        throw unwrapDbError(err, "즉시지출 등록 실패");
      }
    }),

  /** 즉시지출 삭제 */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // 1) 매장 소유 확인
      const [row] = await db
        .select({ restaurantId: dailyExpenses.restaurantId })
        .from(dailyExpenses)
        .where(eq(dailyExpenses.id, input.id));
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "존재하지 않는 지출입니다." });
      }
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, row.restaurantId);
      try {
        await db.delete(dailyExpenses).where(eq(dailyExpenses.id, input.id));
        return { ok: true };
      } catch (err: any) {
        throw unwrapDbError(err, "즉시지출 삭제 실패");
      }
    }),

  /** 월별 즉시지출 합계 */
  monthlyTotal: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const mm = String(input.month).padStart(2, "0");
      const startDate = `${input.year}-${mm}-01`;
      const nm = input.month === 12 ? 1 : input.month + 1;
      const ny = input.month === 12 ? input.year + 1 : input.year;
      const endDate = `${ny}-${String(nm).padStart(2, "0")}-01`;

      const [row] = await db
        .select({ total: sql<string>`COALESCE(SUM(CAST(${dailyExpenses.amount} AS DECIMAL(14,2))), 0)` })
        .from(dailyExpenses)
        .where(
          and(
            eq(dailyExpenses.restaurantId, input.restaurantId),
            sql`${dailyExpenses.date} >= ${startDate}`,
            sql`${dailyExpenses.date} < ${endDate}`,
          ),
        );
      return { total: row?.total ?? "0" };
    }),

  /** 월별 즉시지출 카테고리별 집계 */
  monthlySummary: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const mm = String(input.month).padStart(2, "0");
      const startDate = `${input.year}-${mm}-01`;
      const nm = input.month === 12 ? 1 : input.month + 1;
      const ny = input.month === 12 ? input.year + 1 : input.year;
      const endDate = `${ny}-${String(nm).padStart(2, "0")}-01`;

      const rows = await db
        .select({
          categoryId: dailyExpenses.categoryId,
          categoryName: sql<string>`COALESCE(${expenseCategories.name}, ${dailyExpenses.category}, '미분류')`,
          amount: sql<string>`SUM(CAST(${dailyExpenses.amount} AS DECIMAL(14,2)))`,
        })
        .from(dailyExpenses)
        .leftJoin(expenseCategories, eq(dailyExpenses.categoryId, expenseCategories.id))
        .where(
          and(
            eq(dailyExpenses.restaurantId, input.restaurantId),
            sql`${dailyExpenses.date} >= ${startDate}`,
            sql`${dailyExpenses.date} < ${endDate}`,
          ),
        )
        .groupBy(dailyExpenses.categoryId, expenseCategories.name, dailyExpenses.category);

      const breakdown = rows.map(r => ({
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        amount: Math.round(Number(r.amount ?? 0)),
      }));
      const total = breakdown.reduce((s, b) => s + b.amount, 0);
      return { total, breakdown };
    }),
});
