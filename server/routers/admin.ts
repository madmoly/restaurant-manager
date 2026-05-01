import { z } from "zod";
import { eq, and, between, sql, isNull, isNotNull, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure, protectedProcedure, masterProcedure } from "../trpc";
import { db } from "../db";
import {
  restaurants, restaurantUsers, users, sales, purchaseOrders,
  dailyClosings, dailyOperations, intermediateSales,
  schedules, dailySalesDetail, businessGroups, dailyExpenses,
  employeeWageHistory, auditLogs, notifications,
} from "../../drizzle/schema";
import { ROLE_LEVEL } from "@shared/permissions";
import { getOwnedRestaurants, getOwnedRestaurantIds, realStoreCondition } from "../helpers/restaurantScope";
import { calcMonthlyFixedCosts } from "../helpers/fixedCostCalc";

export const adminRouter = router({
  /**
   * 소유 매장 월간 집계 — 대표(admin) 대시보드용
   * 대표별 소유 매장만 합산 (master는 전체)
   */
  multiStoreMonthlySummary: adminProcedure
    .input(z.object({ year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      const start = new Date(input.year, input.month - 1, 1);
      const end = new Date(input.year, input.month, 0);

      // 소유 매장 목록
      const realStores = await getOwnedRestaurants(ctx.user.userId, ctx.user.role);

      // master: Tutorial 매장도 별도 그룹으로 포함
      let tutorialStores: typeof realStores = [];
      if (ctx.user.role === "master") {
        tutorialStores = await db.select().from(restaurants).where(
          and(isNull(restaurants.deletedAt), eq(restaurants.isTutorial, true))
        );
      }
      const allRestaurants = [...realStores, ...tutorialStores];

      // 사업그룹명 매핑 (master용)
      const groupMap = new Map<number, string>();
      if (ctx.user.role === "master") {
        const groups = await db.select({ adminId: businessGroups.adminId, name: businessGroups.name }).from(businessGroups);
        for (const g of groups) groupMap.set(g.adminId, g.name);
      }

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

          const salesTotal = Number(salesRow?.total ?? 0);
          const purchasesTotal = Number(purchaseRow?.total ?? 0);
          const laborCost = Number(closingRow?.laborCost ?? 0);

          // 즉시 지출 (profit_ratio 정확 계산용)
          const [expRow] = await db
            .select({ total: sql<string>`COALESCE(SUM(CAST(${dailyExpenses.amount} AS DECIMAL(14,2))), 0)` })
            .from(dailyExpenses)
            .where(and(eq(dailyExpenses.restaurantId, r.id), between(dailyExpenses.date, start, end)));
          const expensesTotal = Math.round(Number(expRow?.total ?? 0));

          // 고정비 합계 (sales_ratio + profit_ratio closed-form 적용)
          const fixedResult = await calcMonthlyFixedCosts(
            r.id, input.year, input.month, salesTotal,
            { purchases: purchasesTotal, labor: laborCost, expenses: expensesTotal },
          );
          const fixedCostTotal = fixedResult.totalWithRatio;
          const profit = salesTotal - purchasesTotal - laborCost - fixedCostTotal - expensesTotal;

          return {
            restaurantId: r.id,
            restaurantName: r.name,
            address: r.address,
            isActive: r.isActive,
            ownerAdminId: r.ownerAdminId,
            groupName: r.isTutorial ? "Tutorial" : (r.ownerAdminId ? (groupMap.get(r.ownerAdminId) ?? null) : null),
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
    .query(async ({ input, ctx }) => {
      const realStores = await getOwnedRestaurants(ctx.user.userId, ctx.user.role);

      // master: Tutorial 매장도 별도 그룹으로 포함
      let tutorialStores: typeof realStores = [];
      if (ctx.user.role === "master") {
        tutorialStores = await db.select().from(restaurants).where(
          and(isNull(restaurants.deletedAt), eq(restaurants.isTutorial, true))
        );
      }
      const allRestaurants = [...realStores, ...tutorialStores];

      // 사업그룹명 매핑 (master용)
      const groupMap = new Map<number, string>();
      if (ctx.user.role === "master") {
        const groups = await db.select({ adminId: businessGroups.adminId, name: businessGroups.name }).from(businessGroups);
        for (const g of groups) groupMap.set(g.adminId, g.name);
      }

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
            groupName: r.isTutorial ? "Tutorial" : (r.ownerAdminId ? (groupMap.get(r.ownerAdminId) ?? null) : null),
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

      // 매장 통계 (tutorial 제외 — active+archived 모두 포함하므로 deletedAt 필터 없음)
      const storeStats = await db
        .select({
          total: sql<number>`COUNT(*)`,
          active: sql<number>`SUM(CASE WHEN ${restaurants.deletedAt} IS NULL THEN 1 ELSE 0 END)`,
          archived: sql<number>`SUM(CASE WHEN ${restaurants.deletedAt} IS NOT NULL THEN 1 ELSE 0 END)`,
        })
        .from(restaurants)
        .where(eq(restaurants.isTutorial, false));

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

      // 매장별 직원 수 — 중앙 스코핑 헬퍼로 실매장만
      const realIds = await getOwnedRestaurantIds(ctx.user.userId, ctx.user.role);
      const storeStaffCounts = realIds.length > 0
        ? await db
            .select({
              restaurantId: restaurantUsers.restaurantId,
              count: sql<number>`COUNT(*)`,
            })
            .from(restaurantUsers)
            .where(sql`${restaurantUsers.restaurantId} IN (${sql.raw(realIds.join(","))})`)
            .groupBy(restaurantUsers.restaurantId)
        : [];

      return {
        users: userStats[0],
        stores: storeStats[0],
        recentLogins,
        storeStaffCounts,
      };
    }),

  /**
   * 급여 긴급 정정 (master 전용 — Phase 2.4)
   * 현재 open `employee_wage_history` row의 wageAmount를 덮어쓴다.
   * - audit_logs에 before/after/reason 필수 기록 (트랜잭션 내 강제)
   * - 해당 매장 owner에게 알림 발송
   * - 정상 경로(전자계약서 재서명)가 막힌 예외 상황 전용
   */
  emergencyWageCorrection: masterProcedure
    .input(z.object({
      userId: z.number(),
      restaurantId: z.number(),
      newWageAmount: z.string(),
      reason: z.string().min(5, "정정 사유는 5자 이상 필수"),
    }))
    .mutation(async ({ input, ctx }) => {
      const { userId, restaurantId, newWageAmount, reason } = input;

      // 1) 현재 open wage_history row 조회
      const [openRow] = await db.select()
        .from(employeeWageHistory)
        .where(and(
          eq(employeeWageHistory.userId, userId),
          eq(employeeWageHistory.restaurantId, restaurantId),
          isNull(employeeWageHistory.effectiveTo),
        ))
        .limit(1);

      if (!openRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "현재 유효한 급여이력이 없습니다 — 전자계약서 서명 또는 백필 후 재시도",
        });
      }

      const before = { wageAmount: openRow.wageAmount, wageType: openRow.wageType };
      const after = { wageAmount: newWageAmount, wageType: openRow.wageType };

      // 2) 트랜잭션: wage 갱신 + audit (필수) + 매장 owner 알림
      await db.transaction(async (tx) => {
        await tx.update(employeeWageHistory)
          .set({ wageAmount: newWageAmount })
          .where(eq(employeeWageHistory.id, openRow.id));

        await tx.insert(auditLogs).values({
          userId: ctx.user.userId,
          userName: ctx.user.name || ctx.user.username,
          restaurantId,
          action: "update",
          target: "employee_wage_history",
          targetId: openRow.id,
          details: {
            kind: "emergency_wage_correction",
            targetUserId: userId,
            before,
            after,
            reason,
          },
        });

        const owners = await tx.select({ userId: restaurantUsers.userId })
          .from(restaurantUsers)
          .where(and(
            eq(restaurantUsers.restaurantId, restaurantId),
            eq(restaurantUsers.role, "owner"),
            isNull(restaurantUsers.resignedAt),
          ));

        for (const o of owners) {
          if (!o.userId) continue;
          await tx.insert(notifications).values({
            recipientId: o.userId,
            type: "general",
            title: "급여 긴급 정정 알림",
            content: `master가 직원 #${userId} 의 급여를 ₩${before.wageAmount} → ₩${after.wageAmount} 로 정정했습니다. 사유: ${reason}`,
            restaurantId,
          });
        }
      });

      return { ok: true, before, after };
    }),
});
