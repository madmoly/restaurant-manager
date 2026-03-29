import { z } from "zod";
import { eq, and, between, sql, desc, inArray } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { dailyClosings, dailyClosingSalesTypes, sales, purchaseOrders, storeClosedDays, storeWeeklyClosures } from "../../drizzle/schema";
import { verifyStoreAccess, requireStoreManager } from "../middleware/storeAuth";

export const dailyClosingsRouter = router({
  // ─── Sales Types (매출 항목 유형 관리) ──────────────────────────────────────
  listSalesTypes: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db.select().from(dailyClosingSalesTypes)
        .where(and(eq(dailyClosingSalesTypes.restaurantId, input.restaurantId), eq(dailyClosingSalesTypes.isActive, true)))
        .orderBy(dailyClosingSalesTypes.sortOrder);
    }),

  createSalesType: protectedProcedure
    .input(z.object({ restaurantId: z.number(), typeName: z.string().min(1), sortOrder: z.number().optional() }))
    .mutation(async ({ input, ctx }) => {
      await requireStoreManager(ctx.user.userId, ctx.user.role, input.restaurantId);
      const [result] = await db.insert(dailyClosingSalesTypes).values(input).$returningId();
      return { id: result.id };
    }),

  // ─── Daily Closings ───────────────────────────────────────────────────────
  /** 특정 날짜의 일마감 조회 */
  getByDate: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const [closing] = await db.select().from(dailyClosings)
        .where(and(eq(dailyClosings.restaurantId, input.restaurantId), eq(dailyClosings.closingDate, new Date(input.date))))
        .limit(1);
      return closing ?? null;
    }),

  /** 월별 일마감 목록 */
  listByMonth: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const start = new Date(input.year, input.month - 1, 1);
      const end = new Date(input.year, input.month, 0);
      return db.select().from(dailyClosings)
        .where(and(eq(dailyClosings.restaurantId, input.restaurantId), between(dailyClosings.closingDate, start, end)))
        .orderBy(desc(dailyClosings.closingDate));
    }),

  /** 일마감 데이터 자동 계산 (해당 날짜의 매출/매입 합산) */
  calculateDay: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const dateObj = new Date(input.date);

      // 당일 매출 합계
      const [salesRow] = await db
        .select({ total: sql<string>`COALESCE(SUM(${sales.amount}), 0)` })
        .from(sales)
        .where(and(eq(sales.restaurantId, input.restaurantId), eq(sales.saleDate, dateObj)));

      // 당일 매입 합계
      const [purchaseRow] = await db
        .select({ total: sql<string>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)` })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.restaurantId, input.restaurantId), eq(purchaseOrders.purchaseDate, dateObj)));

      return {
        salesTotal: salesRow?.total ?? "0",
        purchasesTotal: purchaseRow?.total ?? "0",
      };
    }),

  /** 일마감 저장/수정 (upsert) */
  save: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      closingDate: z.string(),
      salesTotal: z.string(),
      purchasesTotal: z.string(),
      laborCost: z.string().default("0"),
      fixedCostShare: z.string().default("0"),
      profit: z.string().default("0"),
      salesBreakdown: z.array(z.object({ typeName: z.string(), amount: z.number() })).optional(),
      note: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireStoreManager(ctx.user.userId, ctx.user.role, input.restaurantId);

      // profit 자동 계산
      const salesNum = Number(input.salesTotal);
      const purchasesNum = Number(input.purchasesTotal);
      const laborNum = Number(input.laborCost);
      const fixedNum = Number(input.fixedCostShare);
      const profit = (salesNum - purchasesNum - laborNum - fixedNum).toString();

      const existing = await db.select().from(dailyClosings)
        .where(and(
          eq(dailyClosings.restaurantId, input.restaurantId),
          eq(dailyClosings.closingDate, new Date(input.closingDate))
        )).limit(1);

      const values = {
        restaurantId: input.restaurantId,
        closingDate: new Date(input.closingDate),
        salesTotal: input.salesTotal,
        purchasesTotal: input.purchasesTotal,
        laborCost: input.laborCost,
        fixedCostShare: input.fixedCostShare,
        profit,
        salesBreakdown: input.salesBreakdown,
        note: input.note,
        closedBy: ctx.user.userId,
        closedAt: new Date(),
      };

      if (existing.length > 0) {
        await db.update(dailyClosings).set(values).where(eq(dailyClosings.id, existing[0].id));
        return { id: existing[0].id, updated: true };
      } else {
        const [result] = await db.insert(dailyClosings).values(values).$returningId();
        return { id: result.id, updated: false };
      }
    }),

  /** 월간 수익성 요약 */
  monthlySummary: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const start = new Date(input.year, input.month - 1, 1);
      const end = new Date(input.year, input.month, 0);

      const [row] = await db
        .select({
          salesTotal: sql<string>`COALESCE(SUM(${dailyClosings.salesTotal}), 0)`,
          purchasesTotal: sql<string>`COALESCE(SUM(${dailyClosings.purchasesTotal}), 0)`,
          laborCost: sql<string>`COALESCE(SUM(${dailyClosings.laborCost}), 0)`,
          fixedCostShare: sql<string>`COALESCE(SUM(${dailyClosings.fixedCostShare}), 0)`,
          profit: sql<string>`COALESCE(SUM(${dailyClosings.profit}), 0)`,
          closedDays: sql<number>`COUNT(*)`,
        })
        .from(dailyClosings)
        .where(and(
          eq(dailyClosings.restaurantId, input.restaurantId),
          between(dailyClosings.closingDate, start, end)
        ));

      // 마감된 날짜 목록 + 인건비 0인 마감일
      const closedRows = await db
        .select({
          closingDate: dailyClosings.closingDate,
          laborCost: dailyClosings.laborCost,
        })
        .from(dailyClosings)
        .where(and(
          eq(dailyClosings.restaurantId, input.restaurantId),
          between(dailyClosings.closingDate, start, end)
        ));

      const closedDateSet = new Set(
        closedRows.map(r => {
          const d = r.closingDate;
          return typeof d === "string" ? d : new Date(d).toISOString().slice(0, 10);
        })
      );
      const zeroLaborDates = closedRows
        .filter(r => Number(r.laborCost) === 0)
        .map(r => {
          const d = r.closingDate;
          return typeof d === "string" ? d : new Date(d).toISOString().slice(0, 10);
        });

      // 매장 휴무일 (임시휴무 + 정기휴무)
      const closedDayRows = await db.select({ closedDate: storeClosedDays.closedDate })
        .from(storeClosedDays)
        .where(and(
          eq(storeClosedDays.restaurantId, input.restaurantId),
          between(storeClosedDays.closedDate, start, end)
        ));
      const storeClosedSet = new Set(
        closedDayRows.map(r => {
          const d = r.closedDate;
          return typeof d === "string" ? d : new Date(d).toISOString().slice(0, 10);
        })
      );

      const weeklyClosureRows = await db.select({ weekday: storeWeeklyClosures.weekday })
        .from(storeWeeklyClosures)
        .where(and(
          eq(storeWeeklyClosures.restaurantId, input.restaurantId),
          eq(storeWeeklyClosures.isClosed, true)
        ));
      const closedWeekdays = new Set(weeklyClosureRows.map(r => r.weekday));

      // 1일~오늘(또는 월말) 중 미마감 영업일 계산
      const today = new Date();
      const lastDay = today.getFullYear() === input.year && today.getMonth() + 1 === input.month
        ? today.getDate()
        : end.getDate();

      const unclosedDates: string[] = [];
      for (let d = 1; d <= lastDay; d++) {
        const dt = new Date(input.year, input.month - 1, d);
        const dateStr = `${input.year}-${String(input.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        // 정기 휴무요일 스킵
        if (closedWeekdays.has(dt.getDay())) continue;
        // 임시 휴무 스킵
        if (storeClosedSet.has(dateStr)) continue;
        // 마감 안 된 날
        if (!closedDateSet.has(dateStr)) {
          unclosedDates.push(dateStr);
        }
      }

      return {
        salesTotal: row?.salesTotal ?? "0",
        purchasesTotal: row?.purchasesTotal ?? "0",
        laborCost: row?.laborCost ?? "0",
        fixedCostShare: row?.fixedCostShare ?? "0",
        profit: row?.profit ?? "0",
        closedDays: row?.closedDays ?? 0,
        daysInMonth: end.getDate(),
        unclosedDates,            // 미마감 영업일
        zeroLaborDates,           // 인건비 미확정 마감일
      };
    }),
});
