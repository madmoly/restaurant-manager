import { z } from "zod";
import { eq, and, between, sql, desc, inArray } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { dailyClosings, dailyClosingSalesTypes, sales, purchaseOrders, dailySalesDetail, purchaseOrdersV2, storeClosedDays, storeWeeklyClosures, schedules, employeeContracts, employeeWageHistory, restaurantUsers, affiliatedCompanies } from "../../drizzle/schema";
import { verifyStoreAccess, requireStoreManager } from "../middleware/storeAuth";
import { verifyOperatingDay } from "../middleware/operatingDayGuard";
import { computeWageForShift, type WageType } from "../helpers/wage";
import { computeMonthlyStandardHours } from "../helpers/labor";

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

      // 당일 매출: dailySalesDetail (현행) → 없으면 sales (레거시) 폴백
      const [detailRow] = await db
        .select({ total: sql<string>`COALESCE(${dailySalesDetail.totalAmount}, '0')` })
        .from(dailySalesDetail)
        .where(and(
          eq(dailySalesDetail.restaurantId, input.restaurantId),
          sql`${dailySalesDetail.saleDate} = ${input.date}`
        ))
        .limit(1);

      let salesTotalStr = detailRow?.total ?? "0";
      // dailySalesDetail에 없으면 레거시 sales 테이블 폴백
      if (Number(salesTotalStr) === 0) {
        const [salesRow] = await db
          .select({ total: sql<string>`COALESCE(SUM(${sales.amount}), 0)` })
          .from(sales)
          .where(and(eq(sales.restaurantId, input.restaurantId), sql`${sales.saleDate} = ${input.date}`));
        if (Number(salesRow?.total ?? 0) > 0) salesTotalStr = salesRow!.total;
      }

      // 당일 매입: purchaseOrdersV2 (입고 완료분만) → 없으면 purchaseOrders (레거시) 폴백
      const [purchaseV2Row] = await db
        .select({ total: sql<string>`COALESCE(SUM(${purchaseOrdersV2.totalAmount}), 0)` })
        .from(purchaseOrdersV2)
        .where(and(
          eq(purchaseOrdersV2.restaurantId, input.restaurantId),
          sql`${purchaseOrdersV2.purchaseDate} = ${input.date}`,
          eq(purchaseOrdersV2.status, "received"),
        ));

      let purchasesTotalStr = purchaseV2Row?.total ?? "0";
      // v2에 없으면 레거시 폴백
      if (Number(purchasesTotalStr) === 0) {
        const [purchaseRow] = await db
          .select({ total: sql<string>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)` })
          .from(purchaseOrders)
          .where(and(eq(purchaseOrders.restaurantId, input.restaurantId), sql`${purchaseOrders.purchaseDate} = ${input.date}`));
        if (Number(purchaseRow?.total ?? 0) > 0) purchasesTotalStr = purchaseRow!.total;
      }

      // 당일 인건비: 스케줄 × 계약 시급/월급 자동 계산
      const kstDate = new Date(`${input.date}T00:00:00+09:00`);
      const kstNext = new Date(kstDate.getTime() + 86400000);
      const fromUtc = kstDate.toISOString().slice(0, 19).replace("T", " ");
      const toUtc = kstNext.toISOString().slice(0, 19).replace("T", " ");

      // wage_history 시점 매칭으로 정합성 확보 (월정산과 동일 출처)
      // 재설계 2026-05-02: 5인 여부는 직원의 affiliated_companies 마스터 매칭 결정
      const schedRows = await db
        .select({
          userId: schedules.userId,
          startTime: schedules.startTime,
          endTime: schedules.endTime,
          breakMinutes: schedules.breakMinutes,
          tempWageType: schedules.tempWageType,
          tempWageAmount: schedules.tempWageAmount,
          wageType: employeeWageHistory.wageType,
          wageAmount: employeeWageHistory.wageAmount,
          weeklyHours: employeeContracts.weeklyHours,
          affiliatedCompany: restaurantUsers.affiliatedCompany,
        })
        .from(schedules)
        .leftJoin(restaurantUsers, and(
          eq(restaurantUsers.userId, schedules.userId),
          eq(restaurantUsers.restaurantId, input.restaurantId),
        ))
        .leftJoin(employeeContracts, and(
          eq(employeeContracts.userId, schedules.userId),
          eq(employeeContracts.restaurantId, input.restaurantId),
          eq(employeeContracts.isActive, true),
        ))
        .leftJoin(employeeWageHistory, and(
          eq(employeeWageHistory.userId, schedules.userId),
          eq(employeeWageHistory.restaurantId, input.restaurantId),
          sql`DATE_FORMAT(CONVERT_TZ(${schedules.startTime}, '+00:00', '+09:00'), '%Y-%m-01') >= ${employeeWageHistory.effectiveFrom}`,
          sql`(${employeeWageHistory.effectiveTo} IS NULL OR DATE_FORMAT(CONVERT_TZ(${schedules.startTime}, '+00:00', '+09:00'), '%Y-%m-01') < ${employeeWageHistory.effectiveTo})`,
        ))
        .where(and(
          eq(schedules.restaurantId, input.restaurantId),
          sql`${schedules.startTime} >= ${fromUtc}`,
          sql`${schedules.startTime} < ${toUtc}`,
          sql`${schedules.status} = 'completed'`,
        ));

      // 회사명별 5인 여부 batch lookup
      const acRows = await db.select({
        companyName: affiliatedCompanies.companyName,
        over5Employees: affiliatedCompanies.over5Employees,
      }).from(affiliatedCompanies).where(eq(affiliatedCompanies.restaurantId, input.restaurantId));
      const over5ByCompany = new Map<string, boolean>();
      for (const c of acRows) over5ByCompany.set(c.companyName, Boolean(c.over5Employees));

      let laborCostCalc = 0;
      for (const r of schedRows) {
        const sDt = new Date(r.startTime);
        const eDt = new Date(r.endTime);
        const gMin = (eDt.getTime() - sDt.getTime()) / 60000;
        const nMin = Math.max(0, gMin - (r.breakMinutes ?? 0));
        const hrs = nMin / 60;
        const over5 = r.affiliatedCompany ? over5ByCompany.get(r.affiliatedCompany) ?? false : false;

        let wt: WageType = null;
        let wa: number | null = null;
        let stdHours = computeMonthlyStandardHours(null, true); // 폴백 209h
        if (r.tempWageType && r.tempWageAmount) {
          wt = r.tempWageType as WageType;
          wa = Number(r.tempWageAmount);
        } else if (r.wageType && r.wageAmount) {
          wt = r.wageType as WageType;
          wa = Number(r.wageAmount);
          stdHours = computeMonthlyStandardHours(r.weeklyHours, over5);
        }
        laborCostCalc += computeWageForShift({ wageType: wt, wageAmount: wa, hoursWorked: hrs, monthlyStandardHours: stdHours });
      }

      return {
        salesTotal: salesTotalStr,
        purchasesTotal: purchasesTotalStr,
        laborCost: String(Math.round(laborCostCalc)),
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
      override: z.object({ reason: z.string().min(1) }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireStoreManager(ctx.user.userId, ctx.user.role, input.restaurantId);
      await verifyOperatingDay({
        restaurantId: input.restaurantId,
        dateStr: input.closingDate,
        override: input.override,
        userId: ctx.user.userId,
        userRole: ctx.user.role,
      });

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

      // 마감된 날짜 수 + 인건비/고정비 합계 (dailyClosings 자체)
      const [closingAgg] = await db
        .select({
          laborCost: sql<string>`COALESCE(SUM(${dailyClosings.laborCost}), 0)`,
          fixedCostShare: sql<string>`COALESCE(SUM(${dailyClosings.fixedCostShare}), 0)`,
          closedDays: sql<number>`COUNT(*)`,
        })
        .from(dailyClosings)
        .where(and(
          eq(dailyClosings.restaurantId, input.restaurantId),
          between(dailyClosings.closingDate, start, end)
        ));

      // 마감된 날짜 목록 (매출/매입을 실제 상세 테이블에서 합산하기 위해)
      const closedDateRows = await db
        .select({ closingDate: dailyClosings.closingDate })
        .from(dailyClosings)
        .where(and(
          eq(dailyClosings.restaurantId, input.restaurantId),
          between(dailyClosings.closingDate, start, end)
        ));

      // 마감된 날짜의 매출 합계 (dailySalesDetail에서 직접 조회)
      let closedSalesTotal = 0;
      let closedPurchasesTotal = 0;
      if (closedDateRows.length > 0) {
        const [salesAgg] = await db
          .select({ total: sql<string>`COALESCE(SUM(${dailySalesDetail.totalAmount}), 0)` })
          .from(dailySalesDetail)
          .where(and(
            eq(dailySalesDetail.restaurantId, input.restaurantId),
            sql`${dailySalesDetail.saleDate} IN (
              SELECT closingDate FROM daily_closings
              WHERE restaurantId = ${input.restaurantId}
              AND closingDate BETWEEN ${start} AND ${end}
            )`
          ));
        closedSalesTotal = Number(salesAgg?.total ?? 0);

        const [purchaseAgg] = await db
          .select({ total: sql<string>`COALESCE(SUM(${purchaseOrdersV2.totalAmount}), 0)` })
          .from(purchaseOrdersV2)
          .where(and(
            eq(purchaseOrdersV2.restaurantId, input.restaurantId),
            sql`${purchaseOrdersV2.purchaseDate} IN (
              SELECT closingDate FROM daily_closings
              WHERE restaurantId = ${input.restaurantId}
              AND closingDate BETWEEN ${start} AND ${end}
            )`
          ));
        closedPurchasesTotal = Number(purchaseAgg?.total ?? 0);
      }

      const laborCostNum = Number(closingAgg?.laborCost ?? 0);
      const fixedShareNum = Number(closingAgg?.fixedCostShare ?? 0);
      const profitNum = closedSalesTotal - closedPurchasesTotal - laborCostNum - fixedShareNum;

      const row = {
        salesTotal: String(closedSalesTotal),
        purchasesTotal: String(closedPurchasesTotal),
        laborCost: closingAgg?.laborCost ?? "0",
        fixedCostShare: closingAgg?.fixedCostShare ?? "0",
        profit: String(profitNum),
        closedDays: closingAgg?.closedDays ?? 0,
      };

      // 미마감/인건비 미확정 분석 (실패해도 기본 합산은 반환)
      let unclosedDates: string[] = [];
      let zeroLaborDates: string[] = [];

      try {
        // 마감된 날짜 + 인건비 (closedDateRows는 위에서 이미 조회됨)
        const closedWithLabor = await db
          .select({
            closingDate: dailyClosings.closingDate,
            laborCost: dailyClosings.laborCost,
          })
          .from(dailyClosings)
          .where(and(
            eq(dailyClosings.restaurantId, input.restaurantId),
            between(dailyClosings.closingDate, start, end)
          ));

        const toDateStr = (d: any): string => {
          if (typeof d === "string") return d.slice(0, 10);
          return new Date(d).toISOString().slice(0, 10);
        };

        const closedDateSet = new Set(closedWithLabor.map(r => toDateStr(r.closingDate)));
        zeroLaborDates = closedWithLabor
          .filter(r => Number(r.laborCost) === 0)
          .map(r => toDateStr(r.closingDate));

        // 매장 휴무일 (임시휴무 + 정기휴무)
        const storeClosedSet = new Set<string>();
        const closedWeekdays = new Set<number>();

        try {
          const closedDayRows = await db.select({ closedDate: storeClosedDays.closedDate })
            .from(storeClosedDays)
            .where(and(
              eq(storeClosedDays.restaurantId, input.restaurantId),
              between(storeClosedDays.closedDate, start, end)
            ));
          closedDayRows.forEach(r => storeClosedSet.add(toDateStr(r.closedDate)));
        } catch { /* 테이블 미존재 무시 */ }

        try {
          const weeklyClosureRows = await db.select({ weekday: storeWeeklyClosures.weekday })
            .from(storeWeeklyClosures)
            .where(and(
              eq(storeWeeklyClosures.restaurantId, input.restaurantId),
              eq(storeWeeklyClosures.isClosed, true)
            ));
          weeklyClosureRows.forEach(r => closedWeekdays.add(r.weekday));
        } catch { /* 테이블 미존재 무시 */ }

        // 1일~오늘(또는 월말) 중 미마감 영업일 계산
        const now = new Date();
        const lastDay = now.getFullYear() === input.year && now.getMonth() + 1 === input.month
          ? now.getDate()
          : end.getDate();

        for (let d = 1; d <= lastDay; d++) {
          const dt = new Date(input.year, input.month - 1, d);
          const dateStr = `${input.year}-${String(input.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          if (closedWeekdays.has(dt.getDay())) continue;
          if (storeClosedSet.has(dateStr)) continue;
          if (!closedDateSet.has(dateStr)) {
            unclosedDates.push(dateStr);
          }
        }
      } catch (e) {
        console.error("monthlySummary 미마감 분석 오류:", e);
      }

      return {
        salesTotal: row?.salesTotal ?? "0",
        purchasesTotal: row?.purchasesTotal ?? "0",
        laborCost: row?.laborCost ?? "0",
        fixedCostShare: row?.fixedCostShare ?? "0",
        profit: row?.profit ?? "0",
        closedDays: row?.closedDays ?? 0,
        daysInMonth: end.getDate(),
        unclosedDates,
        zeroLaborDates,
      };
    }),
});
