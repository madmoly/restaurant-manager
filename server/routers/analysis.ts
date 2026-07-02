import { z } from "zod";
import { and, eq, inArray, isNull, between, sql } from "drizzle-orm";
import { router, adminProcedure } from "../trpc";
import { db } from "../db";
import {
  restaurants, businessGroups, monthlyClosings,
  storeClosedDays, storeWeeklyClosures, dailyClosings,
  dailyChecklistLogs, storeChecklistTemplates, schedules,
} from "../../drizzle/schema";
import { getOwnedRestaurants } from "../helpers/restaurantScope";
import { computeStoreMonthlyAggregate } from "../helpers/monthlyAggregate";

// ─── 매장 스코핑 + 사업그룹명 + 목표 필드 (analysis 전용 조회) ─────────────
interface ScopedStore {
  id: number;
  name: string;
  ownerAdminId: number | null;
  groupName: string | null;
  monthlyTargetSales: number;
  targetLaborRatio: number;
  targetCostRatio: number;
}

async function getScopedStores(userId: number, role: string): Promise<ScopedStore[]> {
  const realStores = await getOwnedRestaurants(userId, role);

  let tutorialStores: typeof realStores = [];
  if (role === "master") {
    tutorialStores = await db.select().from(restaurants).where(
      and(isNull(restaurants.deletedAt), eq(restaurants.isTutorial, true)),
    );
  }
  const all = [...realStores, ...tutorialStores];

  const groupMap = new Map<number, string>();
  if (role === "master") {
    const groups = await db.select({ adminId: businessGroups.adminId, name: businessGroups.name }).from(businessGroups);
    for (const g of groups) groupMap.set(g.adminId, g.name);
  }

  return all.map((r) => ({
    id: r.id,
    name: r.name,
    ownerAdminId: r.ownerAdminId,
    groupName: r.isTutorial ? "Tutorial" : (r.ownerAdminId ? (groupMap.get(r.ownerAdminId) ?? null) : null),
    monthlyTargetSales: Number(r.monthlyTargetSales ?? 0),
    targetLaborRatio: Number(r.targetLaborRatio ?? 0),
    targetCostRatio: Number(r.targetCostRatio ?? 0),
  }));
}

function monthsRange(endYear: number, endMonth: number, count: number) {
  const out: { year: number; month: number }[] = [];
  let y = endYear, m = endMonth;
  for (let i = 0; i < count; i++) {
    out.unshift({ year: y, month: m });
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

function isCurrentMonth(year: number, month: number) {
  const now = new Date();
  return year === now.getFullYear() && month === now.getMonth() + 1;
}

function dateStr(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export const analysisRouter = router({
  /**
   * 월별 추이 — monthly_closings 확정치 우선, 현재 월만 라이브 재계산.
   * 12개월 전체 라이브 재집계 금지 (성능).
   */
  storeTrends: adminProcedure
    .input(z.object({
      endYear: z.number(),
      endMonth: z.number().min(1).max(12),
      months: z.union([z.literal(6), z.literal(12)]),
    }))
    .query(async ({ input, ctx }) => {
      const stores = await getScopedStores(ctx.user.userId, ctx.user.role);
      const storeIds = stores.map((s) => s.id);
      const monthList = monthsRange(input.endYear, input.endMonth, input.months);

      const closedRowsByKey = new Map<string, typeof monthlyClosings.$inferSelect>();
      if (storeIds.length > 0) {
        const first = monthList[0];
        const last = monthList[monthList.length - 1];
        const startCode = first.year * 100 + first.month;
        const endCode = last.year * 100 + last.month;
        const rows = await db
          .select()
          .from(monthlyClosings)
          .where(and(
            inArray(monthlyClosings.restaurantId, storeIds),
            sql`(${monthlyClosings.year} * 100 + ${monthlyClosings.month}) BETWEEN ${startCode} AND ${endCode}`,
          ));
        for (const row of rows) {
          closedRowsByKey.set(`${row.restaurantId}-${row.year}-${row.month}`, row);
        }
      }

      const months = await Promise.all(monthList.map(async ({ year, month }) => {
        const live = isCurrentMonth(year, month);
        const storeResults = await Promise.all(stores.map(async (s) => {
          if (live) {
            const agg = await computeStoreMonthlyAggregate(s.id, year, month);
            return {
              restaurantId: s.id,
              groupName: s.groupName,
              salesTotal: agg.salesTotal,
              purchasesTotal: agg.purchasesTotal,
              laborCost: agg.laborCost,
              fixedCostTotal: agg.fixedCostTotal,
              expensesTotal: agg.expensesTotal,
              profit: agg.profit,
              profitRate: agg.profitRate,
              confirmed: true,
            };
          }
          const row = closedRowsByKey.get(`${s.id}-${year}-${month}`);
          if (!row) {
            return {
              restaurantId: s.id,
              groupName: s.groupName,
              salesTotal: 0, purchasesTotal: 0, laborCost: 0,
              fixedCostTotal: 0, expensesTotal: 0, profit: 0, profitRate: 0,
              confirmed: false,
            };
          }
          const salesTotal = Number(row.salesTotal);
          const profit = Number(row.profit);
          return {
            restaurantId: s.id,
            groupName: s.groupName,
            salesTotal,
            purchasesTotal: Number(row.purchasesTotal),
            laborCost: Number(row.laborCost),
            fixedCostTotal: Number(row.fixedCostsTotal),
            expensesTotal: Number(row.expensesTotal),
            profit,
            profitRate: salesTotal > 0 ? (profit / salesTotal * 100) : 0,
            confirmed: true,
          };
        }));
        return { year, month, stores: storeResults };
      }));

      return { months };
    }),

  /**
   * 목표 대비 달성률 — 선택 월 기준 (당월은 라이브, 과거월은 monthly_closings).
   */
  targetAttainment: adminProcedure
    .input(z.object({ year: z.number(), month: z.number().min(1).max(12) }))
    .query(async ({ input, ctx }) => {
      const stores = await getScopedStores(ctx.user.userId, ctx.user.role);
      const live = isCurrentMonth(input.year, input.month);

      const closedRowsByStore = new Map<number, typeof monthlyClosings.$inferSelect>();
      if (!live && stores.length > 0) {
        const rows = await db.select().from(monthlyClosings).where(and(
          inArray(monthlyClosings.restaurantId, stores.map((s) => s.id)),
          eq(monthlyClosings.year, input.year),
          eq(monthlyClosings.month, input.month),
        ));
        for (const row of rows) closedRowsByStore.set(row.restaurantId, row);
      }

      const results = await Promise.all(stores.map(async (s) => {
        let salesTotal = 0, laborCost = 0, purchasesTotal = 0, confirmed = true;
        if (live) {
          const agg = await computeStoreMonthlyAggregate(s.id, input.year, input.month);
          salesTotal = agg.salesTotal;
          laborCost = agg.laborCost;
          purchasesTotal = agg.purchasesTotal;
        } else {
          const row = closedRowsByStore.get(s.id);
          if (row) {
            salesTotal = Number(row.salesTotal);
            laborCost = Number(row.laborCost);
            purchasesTotal = Number(row.purchasesTotal);
          } else {
            confirmed = false;
          }
        }
        const targetSet = s.monthlyTargetSales > 0;
        return {
          restaurantId: s.id,
          restaurantName: s.name,
          groupName: s.groupName,
          targetSet,
          confirmed,
          salesAttainment: targetSet ? (salesTotal / s.monthlyTargetSales * 100) : null,
          laborRatio: salesTotal > 0 ? (laborCost / salesTotal * 100) : 0,
          targetLaborRatio: s.targetLaborRatio,
          costRatio: salesTotal > 0 ? (purchasesTotal / salesTotal * 100) : 0,
          targetCostRatio: s.targetCostRatio,
        };
      }));

      return results;
    }),

  /**
   * 운영 건전성 — 일마감 이행률 / 체크리스트 완료율 / 스케줄 커버리지.
   * 매장당 쿼리 반복 없이 IN 조회 + 메모리 집계.
   */
  operationalHealth: adminProcedure
    .input(z.object({ year: z.number(), month: z.number().min(1).max(12) }))
    .query(async ({ input, ctx }) => {
      const stores = await getScopedStores(ctx.user.userId, ctx.user.role);
      const storeIds = stores.map((s) => s.id);
      if (storeIds.length === 0) return [];

      const start = new Date(input.year, input.month - 1, 1);
      const end = new Date(input.year, input.month, 0);
      const daysInMonth = end.getDate();
      const startStr = dateStr(input.year, input.month, 1);
      const endStr = dateStr(input.year, input.month, daysInMonth);

      // 매장별 특정일 휴무
      const closedDayRows = await db
        .select({ restaurantId: storeClosedDays.restaurantId, closedDate: storeClosedDays.closedDate })
        .from(storeClosedDays)
        .where(and(inArray(storeClosedDays.restaurantId, storeIds), between(storeClosedDays.closedDate, start, end)));
      const closedDatesByStore = new Map<number, Set<string>>();
      for (const row of closedDayRows) {
        const d = new Date(row.closedDate);
        const ds = dateStr(d.getFullYear(), d.getMonth() + 1, d.getDate());
        if (!closedDatesByStore.has(row.restaurantId)) closedDatesByStore.set(row.restaurantId, new Set());
        closedDatesByStore.get(row.restaurantId)!.add(ds);
      }

      // 매장별 정기휴무 요일
      const weeklyRows = await db
        .select({ restaurantId: storeWeeklyClosures.restaurantId, weekday: storeWeeklyClosures.weekday })
        .from(storeWeeklyClosures)
        .where(and(inArray(storeWeeklyClosures.restaurantId, storeIds), eq(storeWeeklyClosures.isClosed, true)));
      const weeklyByStore = new Map<number, Set<number>>();
      for (const row of weeklyRows) {
        if (!weeklyByStore.has(row.restaurantId)) weeklyByStore.set(row.restaurantId, new Set());
        weeklyByStore.get(row.restaurantId)!.add(row.weekday);
      }

      // 영업일수 (달력일수 − 특정일휴무 − 정기휴무)
      const bizDaysByStore = new Map<number, number>();
      for (const s of stores) {
        const closedSet = closedDatesByStore.get(s.id) ?? new Set();
        const weeklySet = weeklyByStore.get(s.id) ?? new Set();
        let bizDays = 0;
        for (let d = 1; d <= daysInMonth; d++) {
          const ds = dateStr(input.year, input.month, d);
          const weekday = new Date(input.year, input.month - 1, d).getDay();
          if (closedSet.has(ds) || weeklySet.has(weekday)) continue;
          bizDays++;
        }
        bizDaysByStore.set(s.id, bizDays);
      }

      // 일마감 이행 건수
      const closingCountRows = await db
        .select({ restaurantId: dailyClosings.restaurantId, cnt: sql<number>`COUNT(*)` })
        .from(dailyClosings)
        .where(and(inArray(dailyClosings.restaurantId, storeIds), between(dailyClosings.closingDate, start, end)))
        .groupBy(dailyClosings.restaurantId);
      const closingCountByStore = new Map(closingCountRows.map((r) => [r.restaurantId, Number(r.cnt)]));

      // 체크리스트 완료 로그 수
      const checklistLogRows = await db
        .select({ restaurantId: dailyChecklistLogs.restaurantId, cnt: sql<number>`COUNT(*)` })
        .from(dailyChecklistLogs)
        .where(and(inArray(dailyChecklistLogs.restaurantId, storeIds), between(dailyChecklistLogs.logDate, start, end)))
        .groupBy(dailyChecklistLogs.restaurantId);
      const checklistLogByStore = new Map(checklistLogRows.map((r) => [r.restaurantId, Number(r.cnt)]));

      // 유효 템플릿 수 (effectiveFrom/To가 해당 월과 겹침)
      const templateRows = await db
        .select({ restaurantId: storeChecklistTemplates.restaurantId, cnt: sql<number>`COUNT(*)` })
        .from(storeChecklistTemplates)
        .where(and(
          inArray(storeChecklistTemplates.restaurantId, storeIds),
          eq(storeChecklistTemplates.isActive, true),
          sql`(${storeChecklistTemplates.effectiveFrom} IS NULL OR ${storeChecklistTemplates.effectiveFrom} <= ${endStr})`,
          sql`(${storeChecklistTemplates.effectiveTo} IS NULL OR ${storeChecklistTemplates.effectiveTo} >= ${startStr})`,
        ))
        .groupBy(storeChecklistTemplates.restaurantId);
      const templateCountByStore = new Map(templateRows.map((r) => [r.restaurantId, Number(r.cnt)]));

      // 스케줄 존재 영업일 수 (매장×일자 distinct)
      const scheduleRows = await db
        .select({ restaurantId: schedules.restaurantId, day: sql<string>`DATE(${schedules.startTime})` })
        .from(schedules)
        .where(and(
          inArray(schedules.restaurantId, storeIds),
          sql`DATE(${schedules.startTime}) BETWEEN ${startStr} AND ${endStr}`,
          sql`${schedules.status} != 'canceled'`,
        ))
        .groupBy(schedules.restaurantId, sql`DATE(${schedules.startTime})`);
      const scheduleDaysByStore = new Map<number, number>();
      for (const row of scheduleRows) {
        scheduleDaysByStore.set(row.restaurantId, (scheduleDaysByStore.get(row.restaurantId) ?? 0) + 1);
      }

      return stores.map((s) => {
        const bizDays = bizDaysByStore.get(s.id) ?? 0;
        const closingCount = closingCountByStore.get(s.id) ?? 0;
        const checklistLogCount = checklistLogByStore.get(s.id) ?? 0;
        const templateCount = templateCountByStore.get(s.id) ?? 0;
        const scheduleDays = scheduleDaysByStore.get(s.id) ?? 0;

        return {
          restaurantId: s.id,
          restaurantName: s.name,
          groupName: s.groupName,
          bizDays,
          closingRate: bizDays > 0 ? (closingCount / bizDays * 100) : 0,
          checklistRate: (templateCount > 0 && bizDays > 0) ? (checklistLogCount / (templateCount * bizDays) * 100) : null,
          scheduleCoverage: bizDays > 0 ? (scheduleDays / bizDays * 100) : 0,
        };
      });
    }),
});
