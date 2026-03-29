import { z } from "zod";
import { eq, and, between, sql, isNull, isNotNull, desc } from "drizzle-orm";
import { router, adminProcedure, protectedProcedure } from "../trpc";
import { db } from "../db";
import {
  restaurants, restaurantUsers, users, sales, purchaseOrders,
  dailyClosings, fixedCosts, dailyOperations, intermediateSales,
  schedules, dailySalesDetail,
} from "../../drizzle/schema";
import { ROLE_LEVEL } from "@shared/permissions";

export const adminRouter = router({
  /**
   * 전체 매장 월간 집계 — 대표(admin) 대시보드용
   * 한 번의 호출로 모든 매장의 매출/매입/인건비/고정비를 반환
   */
  multiStoreMonthlySummary: adminProcedure
    .input(z.object({ year: z.number(), month: z.number() }))
    .query(async ({ input }) => {
      const start = new Date(input.year, input.month - 1, 1);
      const end = new Date(input.year, input.month, 0);

      // 활성 매장 목록
      const allRestaurants = await db.select()
        .from(restaurants)
        .where(and(isNull(restaurants.deletedAt), eq(restaurants.isTutorial, false)));

      const storeData = await Promise.all(
        allRestaurants.map(async (r) => {          // 매출 합계
          const [salesRow] = await db
            .select({ total: sql<string>`COALESCE(SUM(${sales.amount}), 0)` })
            .from(sales)
            .where(and(eq(sales.restaurantId, r.id), between(sales.saleDate, start, end)));

          // 매입 합계
          const [purchaseRow] = await db
            .select({ total: sql<string>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)` })
            .from(purchaseOrders)
            .where(and(eq(purchaseOrders.restaurantId, r.id), between(purchaseOrders.purchaseDate, start, end)));

          // 일마감 데이터 (인건비 포함)
          const [closingRow] = await db
            .select({
              laborCost: sql<string>`COALESCE(SUM(${dailyClosings.laborCost}), 0)`,
              closedDays: sql<number>`COUNT(*)`,
            })
            .from(dailyClosings)
            .where(and(eq(dailyClosings.restaurantId, r.id), between(dailyClosings.closingDate, start, end)));

          // 고정비 합계 (effectiveMonth는 'YYYY-MM' 문자열)
          const monthStr = `${input.year}-${String(input.month).padStart(2, "0")}`;
          const [fixedRow] = await db
            .select({ total: sql<string>`COALESCE(SUM(${fixedCosts.amount}), 0)` })
            .from(fixedCosts)
            .where(and(eq(fixedCosts.restaurantId, r.id), eq(fixedCosts.effectiveMonth, monthStr)));

          const salesTotal = Number(salesRow?.total ?? 0);
          const purchasesTotal = Number(purchaseRow?.total ?? 0);          const laborCost = Number(closingRow?.laborCost ?? 0);
          const fixedCostTotal = Number(fixedRow?.total ?? 0);
          const profit = salesTotal - purchasesTotal - laborCost - fixedCostTotal;

          return {
            restaurantId: r.id,
            restaurantName: r.name,
            address: r.address,
            isActive: r.isActive,
            salesTotal,
            purchasesTotal,
            laborCost,
            fixedCostTotal,
            profit,
            profitRate: salesTotal > 0 ? (profit / salesTotal * 100) : 0,
            closedDays: closingRow?.closedDays ?? 0,
            daysInMonth: end.getDate(),
          };
        })
      );

      // 전체 합산
      const totals = storeData.reduce(
        (acc, s) => ({
          salesTotal: acc.salesTotal + s.salesTotal,
          purchasesTotal: acc.purchasesTotal + s.purchasesTotal,
          laborCost: acc.laborCost + s.laborCost,
          fixedCostTotal: acc.fixedCostTotal + s.fixedCostTotal,
          profit: acc.profit + s.profit,
        }),        { salesTotal: 0, purchasesTotal: 0, laborCost: 0, fixedCostTotal: 0, profit: 0 }
      );

      return {
        stores: storeData,
        totals: {
          ...totals,
          profitRate: totals.salesTotal > 0 ? (totals.profit / totals.salesTotal * 100) : 0,
          storeCount: storeData.length,
        },
      };
    }),

  /**
   * 전체 매장 금일 운영 현황
   */
  allStoresTodayStatus: adminProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input }) => {
      const allRestaurants = await db.select()
        .from(restaurants)
        .where(and(isNull(restaurants.deletedAt), eq(restaurants.isTutorial, false)));

      const storeStatuses = await Promise.all(
        allRestaurants.map(async (r) => {
          // 오픈 체크
          const [ops] = await db.select({ openCheckedAt: dailyOperations.openCheckedAt, closeCheckedAt: dailyOperations.closeCheckedAt })
            .from(dailyOperations)
            .where(and(eq(dailyOperations.restaurantId, r.id), sql`${dailyOperations.operationDate} = ${input.date}`))
            .limit(1);

          // 중간매출
          const midSales = await db.select({ amount: intermediateSales.amount, receiptCount: intermediateSales.receiptCount, recordedAt: intermediateSales.recordedAt })
            .from(intermediateSales)
            .where(and(eq(intermediateSales.restaurantId, r.id), sql`${intermediateSales.saleDate} = ${input.date}`));

          const midTotal = midSales.reduce((s, m) => s + Number(m.amount), 0);
          const midReceipts = midSales.reduce((s, m) => s + (m.receiptCount || 0), 0);

          // 마감 여부
          const [closing] = await db.select({ id: dailySalesDetail.id, totalAmount: dailySalesDetail.totalAmount })
            .from(dailySalesDetail)
            .where(and(eq(dailySalesDetail.restaurantId, r.id), sql`${dailySalesDetail.saleDate} = ${input.date}`))
            .limit(1);

          // 출근 인원
          const [staffRow] = await db.select({ count: sql<number>`COUNT(*)` })
            .from(schedules)
            .where(and(eq(schedules.restaurantId, r.id), sql`DATE(${schedules.startTime}) = ${input.date}`, sql`${schedules.status} != 'canceled'`));

          return {
            restaurantId: r.id,
            name: r.name,
            isOpenChecked: !!ops?.openCheckedAt,
            isCloseDone: !!closing,
            closingTotal: closing ? Number(closing.totalAmount) : null,
            midSalesTotal: midTotal,
            midSalesReceipts: midReceipts,
            midSalesCount: midSales.length,
            lastMidSalesTime: midSales.length > 0 ? midSales[midSales.length - 1].recordedAt : null,
            staffCount: staffRow?.count ?? 0,
          };
        })
      );

      return storeStatuses;
    }),

  /**
   * 시스템 현황 — 개발자(master) 대시보드용
   */
  systemStatus: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== "master") {
        return null;
      }

      // 사용자 통계
      const userStats = await db
        .select({
          total: sql<number>`COUNT(*)`,
          active: sql<number>`SUM(CASE WHEN ${users.isActive} = true THEN 1 ELSE 0 END)`,
          admins: sql<number>`SUM(CASE WHEN ${users.role} = 'admin' THEN 1 ELSE 0 END)`,
          managers: sql<number>`SUM(CASE WHEN ${users.role} = 'manager' THEN 1 ELSE 0 END)`,
          employees: sql<number>`SUM(CASE WHEN ${users.role} = 'staff' THEN 1 ELSE 0 END)`,        })
        .from(users);

      // 매장 통계
      const storeStats = await db
        .select({
          total: sql<number>`COUNT(*)`,
          active: sql<number>`SUM(CASE WHEN ${restaurants.deletedAt} IS NULL THEN 1 ELSE 0 END)`,
          archived: sql<number>`SUM(CASE WHEN ${restaurants.deletedAt} IS NOT NULL THEN 1 ELSE 0 END)`,
        })
        .from(restaurants);

      // 최근 로그인한 사용자 5명
      const recentLogins = await db
        .select({
          id: users.id,
          name: users.name,
          role: users.role,
          lastSignedIn: users.lastSignedIn,
        })
        .from(users)
        .where(isNotNull(users.lastSignedIn))
        .orderBy(desc(users.lastSignedIn))
        .limit(5);

      // 매장별 직원 수
      const storeStaffCounts = await db
        .select({
          restaurantId: restaurantUsers.restaurantId,          count: sql<number>`COUNT(*)`,
        })
        .from(restaurantUsers)
        .groupBy(restaurantUsers.restaurantId);

      return {
        users: userStats[0],
        stores: storeStats[0],
        recentLogins,
        storeStaffCounts,
      };
    }),
});
