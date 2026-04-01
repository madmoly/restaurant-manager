import { z } from "zod";
import { eq, and, gte, lte, sql, sum, between, desc } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { verifyStoreAccess } from "../middleware/storeAuth";
import {
  monthlyClosings,
  sales,
  purchaseOrdersV2,
  schedules,
  fixedCosts,
  restaurants,
  users,
  restaurantUsers,
  employeeContracts,
  dailySalesDetail,
  dailyClosings,
  storeClosedDays,
  storeWeeklyClosures,
  counterparties,
  settlementImages,
} from "../../drizzle/schema";

export const monthlyClosingsRouter = router({
  /** 특정 월 마감 조회 */
  get: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const [row] = await db
        .select()
        .from(monthlyClosings)
        .where(
          and(
            eq(monthlyClosings.restaurantId, input.restaurantId),
            eq(monthlyClosings.year, input.year),
            eq(monthlyClosings.month, input.month),
          ),
        )
        .limit(1);
      return row ?? null;
    }),

  /** 연간 월마감 목록 */
  listByYear: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db
        .select()
        .from(monthlyClosings)
        .where(
          and(
            eq(monthlyClosings.restaurantId, input.restaurantId),
            eq(monthlyClosings.year, input.year),
          ),
        )
        .orderBy(monthlyClosings.month);
    }),

  /** 월마감 확정 — 매출/매입/인건비/고정비 자동 집계 */
  close: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        year: z.number(),
        month: z.number(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const mm = String(input.month).padStart(2, "0");
      const startDate = `${input.year}-${mm}-01`;
      const daysInMonth = new Date(input.year, input.month, 0).getDate();
      const endDate = `${input.year}-${mm}-${daysInMonth}`;
      const monthStr = `${input.year}-${mm}`;

      // 1. 매출 합계
      const [salesRow] = await db
        .select({ total: sum(sales.amount) })
        .from(sales)
        .where(
          and(
            eq(sales.restaurantId, input.restaurantId),
            gte(sales.saleDate, new Date(startDate)),
            sql`${sales.saleDate} <= ${endDate}`,
          ),
        );
      const salesTotal = Number(salesRow?.total ?? 0);

      // 2. 매입 합계 (V2)
      const [purchRow] = await db
        .select({ total: sum(purchaseOrdersV2.totalAmount) })
        .from(purchaseOrdersV2)
        .where(
          and(
            eq(purchaseOrdersV2.restaurantId, input.restaurantId),
            gte(purchaseOrdersV2.purchaseDate, new Date(startDate)),
            sql`${purchaseOrdersV2.purchaseDate} <= ${endDate}`,
          ),
        );
      const purchasesTotal = Number(purchRow?.total ?? 0);

      // 3. 고정비 합계
      const [fixedRow] = await db
        .select({ total: sum(fixedCosts.amount) })
        .from(fixedCosts)
        .where(
          and(
            eq(fixedCosts.restaurantId, input.restaurantId),
            eq(fixedCosts.effectiveMonth, monthStr),
          ),
        );
      const fixedCostsTotal = Number(fixedRow?.total ?? 0);

      // 4. 인건비: 확정/완료 스케줄 × 계약 시급/월급 기반 자동 계산
      const monthStr2 = String(input.month).padStart(2, "0");
      const kstFrom = new Date(`${input.year}-${monthStr2}-01T00:00:00+09:00`);
      const nm2 = input.month === 12 ? 1 : input.month + 1;
      const ny2 = input.month === 12 ? input.year + 1 : input.year;
      const kstTo = new Date(`${ny2}-${String(nm2).padStart(2, "0")}-01T00:00:00+09:00`);
      const fromUtc = kstFrom.toISOString().slice(0, 19).replace("T", " ");
      const toUtc = kstTo.toISOString().slice(0, 19).replace("T", " ");

      const schedRows = await db
        .select({
          startTime: schedules.startTime,
          endTime: schedules.endTime,
          breakMinutes: schedules.breakMinutes,
          tempWageType: schedules.tempWageType,
          tempWageAmount: schedules.tempWageAmount,
          wageType: employeeContracts.wageType,
          wageAmount: employeeContracts.wageAmount,
          weeklyOffDays: employeeContracts.weeklyOffDays,
        })
        .from(schedules)
        .leftJoin(employeeContracts, and(
          eq(employeeContracts.userId, schedules.userId),
          eq(employeeContracts.restaurantId, input.restaurantId),
          eq(employeeContracts.isActive, true),
        ))
        .where(and(
          eq(schedules.restaurantId, input.restaurantId),
          sql`${schedules.startTime} >= ${fromUtc}`,
          sql`${schedules.startTime} < ${toUtc}`,
          sql`${schedules.status} IN ('confirmed','completed')`,
        ));

      let laborCost = 0;
      for (const r of schedRows) {
        const startDt = new Date(r.startTime);
        const endDt = new Date(r.endTime);
        const grossMin = (endDt.getTime() - startDt.getTime()) / 60000;
        const netMin = Math.max(0, grossMin - (r.breakMinutes ?? 0));
        const hours = netMin / 60;

        let baseRate = 0;
        if (r.tempWageType === "daily" && r.tempWageAmount) {
          laborCost += Number(r.tempWageAmount);
          continue;
        } else if (r.tempWageType === "hourly" && r.tempWageAmount) {
          baseRate = Number(r.tempWageAmount);
        } else if (r.wageType === "hourly" && r.wageAmount) {
          baseRate = Number(r.wageAmount);
        } else if (r.wageType === "monthly" && r.wageAmount) {
          baseRate = Number(r.wageAmount) / 209;
        }
        if (baseRate > 0) {
          laborCost += hours * baseRate;
        }
      }
      laborCost = Math.round(laborCost);

      const profit = salesTotal - purchasesTotal - laborCost - fixedCostsTotal;

      // upsert
      const [existing] = await db
        .select()
        .from(monthlyClosings)
        .where(
          and(
            eq(monthlyClosings.restaurantId, input.restaurantId),
            eq(monthlyClosings.year, input.year),
            eq(monthlyClosings.month, input.month),
          ),
        )
        .limit(1);

      if (existing) {
        await db
          .update(monthlyClosings)
          .set({
            salesTotal: String(salesTotal),
            purchasesTotal: String(purchasesTotal),
            laborCost: String(laborCost),
            fixedCostsTotal: String(fixedCostsTotal),
            profit: String(profit),
            note: input.note,
            closedBy: ctx.user.userId,
            closedAt: new Date(),
          })
          .where(eq(monthlyClosings.id, existing.id));
      } else {
        await db.insert(monthlyClosings).values({
          restaurantId: input.restaurantId,
          year: input.year,
          month: input.month,
          salesTotal: String(salesTotal),
          purchasesTotal: String(purchasesTotal),
          laborCost: String(laborCost),
          fixedCostsTotal: String(fixedCostsTotal),
          profit: String(profit),
          note: input.note,
          closedBy: ctx.user.userId,
        });
      }

      return { salesTotal, purchasesTotal, laborCost, fixedCostsTotal, profit };
    }),

  /** 월정산 통합 데이터 — 수집현황 + 손익 + 지표 + 전월비교 + 마감상태 */
  settlementData: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const { restaurantId, year, month } = input;
      const mm = String(month).padStart(2, "0");
      const startDate = new Date(`${year}-${mm}-01`);
      const daysInMonth = new Date(year, month, 0).getDate();
      const endDate = new Date(year, month - 1, daysInMonth);
      const monthStr = `${year}-${mm}`;

      const toDateStr = (d: any): string => {
        if (typeof d === "string") return d.slice(0, 10);
        return new Date(d).toISOString().slice(0, 10);
      };

      // ── 1. 일마감 현황 ──────────────────────────────────────────
      const closedRows = await db
        .select({
          closingDate: dailyClosings.closingDate,
          laborCost: dailyClosings.laborCost,
        })
        .from(dailyClosings)
        .where(and(
          eq(dailyClosings.restaurantId, restaurantId),
          between(dailyClosings.closingDate, startDate, endDate),
        ));
      const closedDateSet = new Set(closedRows.map(r => toDateStr(r.closingDate)));
      const zeroLaborDates = closedRows
        .filter(r => Number(r.laborCost) === 0)
        .map(r => toDateStr(r.closingDate));

      // 휴무일
      const storeClosedSet = new Set<string>();
      const closedWeekdays = new Set<number>();
      try {
        const closedDayRows = await db.select({ closedDate: storeClosedDays.closedDate })
          .from(storeClosedDays)
          .where(and(eq(storeClosedDays.restaurantId, restaurantId), between(storeClosedDays.closedDate, startDate, endDate)));
        closedDayRows.forEach(r => storeClosedSet.add(toDateStr(r.closedDate)));
      } catch {}
      try {
        const weeklyRows = await db.select({ weekday: storeWeeklyClosures.weekday })
          .from(storeWeeklyClosures)
          .where(and(eq(storeWeeklyClosures.restaurantId, restaurantId), eq(storeWeeklyClosures.isClosed, true)));
        weeklyRows.forEach(r => closedWeekdays.add(r.weekday));
      } catch {}

      // 영업일 계산 + 미마감일
      const now = new Date();
      const lastDay = now.getFullYear() === year && now.getMonth() + 1 === month
        ? now.getDate() : daysInMonth;
      const unclosedDates: string[] = [];
      let operatingDays = 0;
      for (let d = 1; d <= lastDay; d++) {
        const dt = new Date(year, month - 1, d);
        const dateStr = `${year}-${mm}-${String(d).padStart(2, "0")}`;
        if (closedWeekdays.has(dt.getDay())) continue;
        if (storeClosedSet.has(dateStr)) continue;
        operatingDays++;
        if (!closedDateSet.has(dateStr)) unclosedDates.push(dateStr);
      }

      // ── 2. 매출 상세 (결제수단별) ──────────────────────────────
      const salesRows = await db
        .select({
          saleDate: dailySalesDetail.saleDate,
          totalAmount: dailySalesDetail.totalAmount,
          cashAmount: dailySalesDetail.cashAmount,
          cardAmount: dailySalesDetail.cardAmount,
          giftCardAmount: dailySalesDetail.giftCardAmount,
          transferAmount: dailySalesDetail.transferAmount,
          otherAmount: dailySalesDetail.otherAmount,
        })
        .from(dailySalesDetail)
        .where(and(
          eq(dailySalesDetail.restaurantId, restaurantId),
          between(dailySalesDetail.saleDate, startDate, endDate),
        ));

      const salesByDate = salesRows.map(r => ({
        date: toDateStr(r.saleDate),
        total: Number(r.totalAmount ?? 0),
        cash: Number(r.cashAmount ?? 0),
        card: Number(r.cardAmount ?? 0),
        giftCard: Number(r.giftCardAmount ?? 0),
        transfer: Number(r.transferAmount ?? 0),
        other: Number(r.otherAmount ?? 0),
      }));
      const salesInputDays = salesRows.length;
      const salesMissingDates: string[] = [];
      for (let d = 1; d <= lastDay; d++) {
        const dt = new Date(year, month - 1, d);
        const dateStr = `${year}-${mm}-${String(d).padStart(2, "0")}`;
        if (closedWeekdays.has(dt.getDay()) || storeClosedSet.has(dateStr)) continue;
        if (!salesRows.some(r => toDateStr(r.saleDate) === dateStr)) salesMissingDates.push(dateStr);
      }

      const salesTotal = salesByDate.reduce((s, r) => s + r.total, 0);
      const salesByMethod = {
        cash: salesByDate.reduce((s, r) => s + r.cash, 0),
        card: salesByDate.reduce((s, r) => s + r.card, 0),
        giftCard: salesByDate.reduce((s, r) => s + r.giftCard, 0),
        transfer: salesByDate.reduce((s, r) => s + r.transfer, 0),
        other: salesByDate.reduce((s, r) => s + r.other, 0),
      };

      // ── 3. 매입 (거래처별 그룹핑) ──────────────────────────────
      const purchaseRows = await db
        .select({
          id: purchaseOrdersV2.id,
          totalAmount: purchaseOrdersV2.totalAmount,
          counterpartyId: purchaseOrdersV2.counterpartyId,
          purchaseDate: purchaseOrdersV2.purchaseDate,
          status: purchaseOrdersV2.status,
        })
        .from(purchaseOrdersV2)
        .where(and(
          eq(purchaseOrdersV2.restaurantId, restaurantId),
          between(purchaseOrdersV2.purchaseDate, startDate, endDate),
        ));

      // 거래처명 조회
      const cpIds = [...new Set(purchaseRows.filter(r => r.counterpartyId).map(r => r.counterpartyId!))];
      let cpNameMap: Record<number, string> = {};
      if (cpIds.length > 0) {
        const cpRows = await db.select({ id: counterparties.id, name: counterparties.name })
          .from(counterparties)
          .where(sql`${counterparties.id} IN (${sql.join(cpIds.map(id => sql`${id}`), sql`, `)})`);
        cpRows.forEach(r => { cpNameMap[r.id] = r.name; });
      }

      const purchasesTotal = purchaseRows.reduce((s, r) => s + Number(r.totalAmount ?? 0), 0);
      const purchaseCount = purchaseRows.filter(r => r.status === "received").length;

      // 거래처별 그룹핑
      const cpMap: Record<number, { name: string; amount: number; count: number }> = {};
      for (const r of purchaseRows) {
        const cpId = r.counterpartyId ?? 0;
        if (!cpMap[cpId]) cpMap[cpId] = { name: cpNameMap[cpId] || "미지정", amount: 0, count: 0 };
        cpMap[cpId].amount += Number(r.totalAmount ?? 0);
        cpMap[cpId].count++;
      }
      const purchasesByCounterparty = Object.entries(cpMap)
        .map(([id, v]) => ({ id: Number(id), name: v.name, amount: v.amount, count: v.count }))
        .sort((a, b) => b.amount - a.amount);

      // ── 4. 인건비 (소속회사별) ─────────────────────────────────
      const kstFrom = new Date(`${year}-${mm}-01T00:00:00+09:00`);
      const nm = month === 12 ? 1 : month + 1;
      const ny = month === 12 ? year + 1 : year;
      const kstTo = new Date(`${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+09:00`);
      const fromUtc = kstFrom.toISOString().slice(0, 19).replace("T", " ");
      const toUtc = kstTo.toISOString().slice(0, 19).replace("T", " ");

      const laborRows = await db
        .select({
          userId: schedules.userId,
          startTime: schedules.startTime,
          endTime: schedules.endTime,
          breakMinutes: schedules.breakMinutes,
          status: schedules.status,
          tempWageType: schedules.tempWageType,
          tempWageAmount: schedules.tempWageAmount,
          tempWorkerName: schedules.tempWorkerName,
          wageType: employeeContracts.wageType,
          wageAmount: employeeContracts.wageAmount,
          userName: users.name,
          affiliatedCompany: restaurantUsers.affiliatedCompany,
        })
        .from(schedules)
        .leftJoin(employeeContracts, and(
          eq(employeeContracts.userId, schedules.userId),
          eq(employeeContracts.restaurantId, restaurantId),
          eq(employeeContracts.isActive, true),
        ))
        .leftJoin(users, eq(users.id, schedules.userId))
        .leftJoin(restaurantUsers, and(
          eq(restaurantUsers.userId, schedules.userId),
          eq(restaurantUsers.restaurantId, restaurantId),
        ))
        .where(and(
          eq(schedules.restaurantId, restaurantId),
          sql`${schedules.startTime} >= ${fromUtc}`,
          sql`${schedules.startTime} < ${toUtc}`,
        ));

      // confirmed+completed만 인건비 계산, draft는 미확정 건수
      let laborCost = 0;
      let draftScheduleCount = 0;
      const companyMap: Record<string, { amount: number; headcount: Set<number | string>; hours: number }> = {};

      for (const r of laborRows) {
        if (r.status === "draft") { draftScheduleCount++; continue; }
        if (r.status !== "confirmed" && r.status !== "completed") continue;

        const startDt = new Date(r.startTime);
        const endDt = new Date(r.endTime);
        const grossMin = (endDt.getTime() - startDt.getTime()) / 60000;
        const netMin = Math.max(0, grossMin - (r.breakMinutes ?? 0));
        const hours = netMin / 60;

        let wage = 0;
        if (r.tempWageType === "daily" && r.tempWageAmount) {
          wage = Number(r.tempWageAmount);
        } else if (r.tempWageType === "hourly" && r.tempWageAmount) {
          wage = hours * Number(r.tempWageAmount);
        } else if (r.wageType === "hourly" && r.wageAmount) {
          wage = hours * Number(r.wageAmount);
        } else if (r.wageType === "monthly" && r.wageAmount) {
          wage = hours * (Number(r.wageAmount) / 209);
        }
        laborCost += wage;

        const company = r.affiliatedCompany || "소속 미지정";
        if (!companyMap[company]) companyMap[company] = { amount: 0, headcount: new Set(), hours: 0 };
        companyMap[company].amount += wage;
        companyMap[company].hours += hours;
        const key = r.userId ?? r.tempWorkerName ?? "unknown";
        companyMap[company].headcount.add(key);
      }
      laborCost = Math.round(laborCost);

      const laborByCompany = Object.entries(companyMap)
        .map(([company, v]) => ({
          company,
          amount: Math.round(v.amount),
          headcount: v.headcount.size,
          hours: Math.round(v.hours * 10) / 10,
        }))
        .sort((a, b) => b.amount - a.amount);

      // ── 5. 고정비 ─────────────────────────────────────────────
      const fixedRows = await db
        .select({
          costName: fixedCosts.costName,
          costType: fixedCosts.costType,
          amount: fixedCosts.amount,
        })
        .from(fixedCosts)
        .where(and(
          eq(fixedCosts.restaurantId, restaurantId),
          eq(fixedCosts.isActive, true),
        ));

      let fixedTotal = 0;
      const fixedBreakdown: { name: string; amount: number; type: string }[] = [];
      const ratioItems: { name: string; ratio: number; amount: number }[] = [];

      for (const f of fixedRows) {
        const amt = Number(f.amount ?? 0);
        if (f.costType === "monthly") {
          fixedTotal += amt; fixedBreakdown.push({ name: f.costName, amount: amt, type: "monthly" });
        } else if (f.costType === "yearly") {
          const m = Math.round(amt / 12); fixedTotal += m; fixedBreakdown.push({ name: f.costName, amount: m, type: "yearly" });
        } else if (f.costType === "quarterly") {
          const m = Math.round(amt / 3); fixedTotal += m; fixedBreakdown.push({ name: f.costName, amount: m, type: "quarterly" });
        } else if (f.costType === "sales_ratio") {
          const ratioAmt = Math.round(salesTotal * amt / 100);
          ratioItems.push({ name: f.costName, ratio: amt, amount: ratioAmt });
        } else if (f.costType === "one_time") {
          // effectiveMonth 체크
          fixedBreakdown.push({ name: f.costName, amount: amt, type: "one_time" });
          fixedTotal += amt;
        }
      }
      const ratioTotal = ratioItems.reduce((s, r) => s + r.amount, 0);
      const totalFixed = fixedTotal + ratioTotal;

      // ── 6. 전월 비교 ──────────────────────────────────────────
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      const prevMm = String(prevMonth).padStart(2, "0");
      const prevStart = new Date(`${prevYear}-${prevMm}-01`);
      const prevDays = new Date(prevYear, prevMonth, 0).getDate();
      const prevEnd = new Date(prevYear, prevMonth - 1, prevDays);
      const prevMonthStr = `${prevYear}-${prevMm}`;

      const [prevSalesAgg] = await db
        .select({ total: sql<string>`COALESCE(SUM(${dailySalesDetail.totalAmount}), 0)` })
        .from(dailySalesDetail)
        .where(and(eq(dailySalesDetail.restaurantId, restaurantId), between(dailySalesDetail.saleDate, prevStart, prevEnd)));
      const [prevPurchAgg] = await db
        .select({ total: sql<string>`COALESCE(SUM(${purchaseOrdersV2.totalAmount}), 0)` })
        .from(purchaseOrdersV2)
        .where(and(eq(purchaseOrdersV2.restaurantId, restaurantId), between(purchaseOrdersV2.purchaseDate, prevStart, prevEnd)));

      // 전월 인건비 — monthly_closings에서 가져오기 (없으면 null)
      const [prevClosing] = await db.select().from(monthlyClosings)
        .where(and(eq(monthlyClosings.restaurantId, restaurantId), eq(monthlyClosings.year, prevYear), eq(monthlyClosings.month, prevMonth)))
        .limit(1);

      const prevData = {
        salesTotal: Number(prevSalesAgg?.total ?? 0),
        purchasesTotal: Number(prevPurchAgg?.total ?? 0),
        laborCost: Number(prevClosing?.laborCost ?? 0),
        fixedCostsTotal: Number(prevClosing?.fixedCostsTotal ?? 0),
        profit: Number(prevClosing?.profit ?? 0),
      };

      // ── 7. 매장 목표 ──────────────────────────────────────────
      const [rest] = await db.select({
        monthlyTargetSales: restaurants.monthlyTargetSales,
        targetCostRatio: restaurants.targetCostRatio,
        targetLaborRatio: restaurants.targetLaborRatio,
      }).from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);

      // ── 8. 월마감 상태 ────────────────────────────────────────
      const [closingRecord] = await db.select().from(monthlyClosings)
        .where(and(eq(monthlyClosings.restaurantId, restaurantId), eq(monthlyClosings.year, year), eq(monthlyClosings.month, month)))
        .limit(1);

      // 확정자 이름
      let closedByName: string | null = null;
      if (closingRecord?.closedBy) {
        const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, closingRecord.closedBy)).limit(1);
        closedByName = u?.name ?? null;
      }

      // ── 결과 조합 ────────────────────────────────────────────
      const profit = salesTotal - purchasesTotal - laborCost - totalFixed;

      return {
        collection: {
          closedDays: closedDateSet.size,
          operatingDays,
          daysInMonth,
          unclosedDates,
          salesInputDays,
          salesMissingDates,
          purchaseCount,
          purchaseTotal: purchaseRows.length,
          zeroLaborDates,
          fixedCostCount: fixedBreakdown.length + ratioItems.length,
          draftScheduleCount,
        },
        income: {
          salesTotal,
          salesByMethod,
          salesByDate: salesByDate.sort((a, b) => a.date.localeCompare(b.date)),
          purchasesTotal,
          purchasesByCounterparty,
          laborCost,
          laborByCompany,
          fixedCostsTotal: totalFixed,
          fixedBreakdown: [...fixedBreakdown, ...ratioItems.map(r => ({
            name: `${r.name} (매출${r.ratio}%)`,
            amount: r.amount,
            type: "sales_ratio",
          }))],
          profit,
        },
        metrics: {
          dailyAvgSales: operatingDays > 0 ? Math.round(salesTotal / operatingDays) : 0,
          costRatio: salesTotal > 0 ? Math.round(purchasesTotal / salesTotal * 1000) / 10 : 0,
          laborRatio: salesTotal > 0 ? Math.round(laborCost / salesTotal * 1000) / 10 : 0,
          profitRatio: salesTotal > 0 ? Math.round(profit / salesTotal * 1000) / 10 : 0,
          targetSales: Number(rest?.monthlyTargetSales ?? 0),
          targetCostRatio: Number(rest?.targetCostRatio ?? 0),
          targetLaborRatio: Number(rest?.targetLaborRatio ?? 0),
        },
        prevMonth: prevData.salesTotal > 0 || prevData.laborCost > 0 ? prevData : null,
        closing: {
          isClosed: !!closingRecord,
          closedAt: closingRecord?.closedAt?.toISOString() ?? null,
          closedByName,
        },
      };
    }),

  /** 월정산 증빙 이미지 목록 조회 */
  getImages: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const rows = await db
        .select({
          id: settlementImages.id,
          counterpartyId: settlementImages.counterpartyId,
          imageUrl: settlementImages.imageUrl,
          note: settlementImages.note,
          uploadedBy: settlementImages.uploadedBy,
          uploaderName: users.name,
          createdAt: settlementImages.createdAt,
        })
        .from(settlementImages)
        .leftJoin(users, eq(settlementImages.uploadedBy, users.id))
        .where(and(
          eq(settlementImages.restaurantId, input.restaurantId),
          eq(settlementImages.year, input.year),
          eq(settlementImages.month, input.month),
        ))
        .orderBy(settlementImages.createdAt);
      return rows;
    }),

  /** 월정산 증빙 이미지 등록 */
  addImage: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      year: z.number(),
      month: z.number(),
      counterpartyId: z.number().nullable(),
      imageUrl: z.string(),
      note: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const [result] = await db.insert(settlementImages).values({
        restaurantId: input.restaurantId,
        year: input.year,
        month: input.month,
        counterpartyId: input.counterpartyId,
        imageUrl: input.imageUrl,
        note: input.note ?? null,
        uploadedBy: ctx.user.userId,
      });
      return { id: result.insertId };
    }),

  /** 월정산 증빙 이미지 삭제 */
  deleteImage: managerProcedure
    .input(z.object({ id: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      await db.delete(settlementImages).where(
        and(eq(settlementImages.id, input.id), eq(settlementImages.restaurantId, input.restaurantId))
      );
      return { success: true };
    }),
});
