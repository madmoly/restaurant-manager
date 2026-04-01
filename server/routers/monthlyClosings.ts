import { z } from "zod";
import { eq, and, gte, sql, sum, count } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { verifyStoreAccess } from "../middleware/storeAuth";
import {
  monthlyClosings,
  sales,
  purchaseOrdersV2,
  schedules,
  restaurants,
  users,
  restaurantUsers,
  employeeContracts,
  dailyClosings,
  dailySalesDetail,
  counterparties,
  storeClosedDays,
  storeWeeklyClosures,
  settlementImages,
} from "../../drizzle/schema";
import { calcMonthlyFixedCosts } from "../helpers/fixedCostCalc";

export const monthlyClosingsRouter = router({
  /** 통합 월정산 데이터 조회 */
  settlementData: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const { restaurantId, year, month } = input;
      const mm = String(month).padStart(2, "0");
      const startDate = `${year}-${mm}-01`;
      const daysInMonth = new Date(year, month, 0).getDate();
      const endDate = `${year}-${mm}-${String(daysInMonth).padStart(2, "0")}`;

      // ── 매장 정보 ──
      const [rest] = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);

      // ── 휴무일 계산 (영업일 산출용) ──
      // 정기 휴무 요일
      const weeklyClosed = await db.select().from(storeWeeklyClosures)
        .where(and(eq(storeWeeklyClosures.restaurantId, restaurantId), eq(storeWeeklyClosures.isClosed, true)));
      const closedWeekdays = new Set(weeklyClosed.map(w => w.weekday));
      // 지정 휴무일
      const closedDays = await db.select().from(storeClosedDays)
        .where(and(
          eq(storeClosedDays.restaurantId, restaurantId),
          gte(storeClosedDays.closedDate, new Date(startDate)),
          sql`${storeClosedDays.closedDate} <= ${endDate}`,
        ));
      const closedDateSet = new Set(closedDays.map(d => {
        const v = d.closedDate;
        return typeof v === "string" ? v : new Date(v).toISOString().slice(0, 10);
      }));
      // 영업일 계산
      let operatingDays = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(year, month - 1, d);
        const dateStr = `${year}-${mm}-${String(d).padStart(2, "0")}`;
        if (closedWeekdays.has(dt.getDay())) continue;
        if (closedDateSet.has(dateStr)) continue;
        operatingDays++;
      }

      // ── 1. COLLECTION (데이터 수집 현황) ──

      // 일마감 현황
      const dcRows = await db.select({ closingDate: dailyClosings.closingDate })
        .from(dailyClosings)
        .where(and(
          eq(dailyClosings.restaurantId, restaurantId),
          gte(dailyClosings.closingDate, new Date(startDate)),
          sql`${dailyClosings.closingDate} <= ${endDate}`,
        ));
      const closedDateStrs = dcRows.map(r => {
        const v = r.closingDate;
        return typeof v === "string" ? v : new Date(v).toISOString().slice(0, 10);
      });
      const closedDaysCount = closedDateStrs.length;

      // 영업일 중 미마감 날짜
      const unclosedDates: string[] = [];
      const closedDateLookup = new Set(closedDateStrs);
      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(year, month - 1, d);
        const dateStr = `${year}-${mm}-${String(d).padStart(2, "0")}`;
        if (closedWeekdays.has(dt.getDay())) continue;
        if (closedDateSet.has(dateStr)) continue;
        // 미래 날짜 제외
        if (dt > new Date()) continue;
        if (!closedDateLookup.has(dateStr)) unclosedDates.push(dateStr);
      }

      // 매출 입력 현황
      const salesRows = await db.select({ saleDate: dailySalesDetail.saleDate })
        .from(dailySalesDetail)
        .where(and(
          eq(dailySalesDetail.restaurantId, restaurantId),
          gte(dailySalesDetail.saleDate, new Date(startDate)),
          sql`${dailySalesDetail.saleDate} <= ${endDate}`,
        ));
      const salesDateStrs = salesRows.map(r => {
        const v = r.saleDate;
        return typeof v === "string" ? v : new Date(v).toISOString().slice(0, 10);
      });
      const salesDateSet = new Set(salesDateStrs);
      const salesMissingDates: string[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(year, month - 1, d);
        const dateStr = `${year}-${mm}-${String(d).padStart(2, "0")}`;
        if (closedWeekdays.has(dt.getDay())) continue;
        if (closedDateSet.has(dateStr)) continue;
        if (dt > new Date()) continue;
        if (!salesDateSet.has(dateStr)) salesMissingDates.push(dateStr);
      }

      // 매입 현황
      const purchaseRows = await db.select({
        status: purchaseOrdersV2.status,
      }).from(purchaseOrdersV2).where(and(
        eq(purchaseOrdersV2.restaurantId, restaurantId),
        gte(purchaseOrdersV2.purchaseDate, new Date(startDate)),
        sql`${purchaseOrdersV2.purchaseDate} <= ${endDate}`,
      ));
      const purchaseCount = purchaseRows.length;
      const purchasePendingCount = purchaseRows.filter(r => r.status === "ordered").length;

      // 스케줄 미확정 건수
      const kstFrom = new Date(`${year}-${mm}-01T00:00:00+09:00`);
      const nm = month === 12 ? 1 : month + 1;
      const ny = month === 12 ? year + 1 : year;
      const kstTo = new Date(`${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+09:00`);
      const fromUtc = kstFrom.toISOString().slice(0, 19).replace("T", " ");
      const toUtc = kstTo.toISOString().slice(0, 19).replace("T", " ");

      const [draftRow] = await db.select({ cnt: count() }).from(schedules).where(and(
        eq(schedules.restaurantId, restaurantId),
        sql`${schedules.startTime} >= ${fromUtc}`,
        sql`${schedules.startTime} < ${toUtc}`,
        eq(schedules.status, "draft"),
      ));
      const draftScheduleCount = Number(draftRow?.cnt ?? 0);

      // 고정비 건수
      const fixedResult = await calcMonthlyFixedCosts(restaurantId, year, month);
      const fixedCostCount = fixedResult.breakdown.length + fixedResult.ratioItems.length;

      // ── 2. INCOME (손익 상세) ──

      // 매출 합계 (결제수단별)
      const salesDetailRows = await db.select({
        cashAmount: dailySalesDetail.cashAmount,
        cardAmount: dailySalesDetail.cardAmount,
        giftCardAmount: dailySalesDetail.giftCardAmount,
        transferAmount: dailySalesDetail.transferAmount,
        otherAmount: dailySalesDetail.otherAmount,
        totalAmount: dailySalesDetail.totalAmount,
      }).from(dailySalesDetail).where(and(
        eq(dailySalesDetail.restaurantId, restaurantId),
        gte(dailySalesDetail.saleDate, new Date(startDate)),
        sql`${dailySalesDetail.saleDate} <= ${endDate}`,
      ));

      let salesTotal = 0, cardTotal = 0, cashTotal = 0, giftCardTotal = 0, transferTotal = 0, otherTotal = 0;
      for (const r of salesDetailRows) {
        salesTotal += Number(r.totalAmount ?? 0);
        cardTotal += Number(r.cardAmount ?? 0);
        cashTotal += Number(r.cashAmount ?? 0);
        giftCardTotal += Number(r.giftCardAmount ?? 0);
        transferTotal += Number(r.transferAmount ?? 0);
        otherTotal += Number(r.otherAmount ?? 0);
      }

      // 매입 합계 (거래처별)
      const purchDetailRows = await db.select({
        counterpartyId: purchaseOrdersV2.counterpartyId,
        totalAmount: purchaseOrdersV2.totalAmount,
      }).from(purchaseOrdersV2).where(and(
        eq(purchaseOrdersV2.restaurantId, restaurantId),
        gte(purchaseOrdersV2.purchaseDate, new Date(startDate)),
        sql`${purchaseOrdersV2.purchaseDate} <= ${endDate}`,
        eq(purchaseOrdersV2.status, "received"),
      ));

      // 거래처 이름 조회
      const cpIds = [...new Set(purchDetailRows.map(r => r.counterpartyId).filter(Boolean))] as number[];
      const cpMap = new Map<number, string>();
      if (cpIds.length > 0) {
        const cpRows = await db.select({ id: counterparties.id, name: counterparties.name })
          .from(counterparties).where(sql`${counterparties.id} IN (${sql.join(cpIds.map(id => sql`${id}`), sql`, `)})`);
        for (const c of cpRows) cpMap.set(c.id, c.name);
      }

      const purchByCP = new Map<number, { name: string; count: number; amount: number }>();
      let purchasesTotal = 0;
      for (const r of purchDetailRows) {
        const amt = Number(r.totalAmount ?? 0);
        purchasesTotal += amt;
        const cpId = r.counterpartyId ?? 0;
        const existing = purchByCP.get(cpId);
        if (existing) {
          existing.count++;
          existing.amount += amt;
        } else {
          purchByCP.set(cpId, { name: cpMap.get(cpId) ?? "기타", count: 1, amount: amt });
        }
      }
      const purchasesByCounterparty = Array.from(purchByCP.entries())
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.amount - a.amount);

      // 고정비 상세 (매출 반영)
      const fixedWithSales = await calcMonthlyFixedCosts(restaurantId, year, month, salesTotal);
      const fixedCostsTotal = fixedWithSales.totalWithRatio;
      const fixedBreakdown = [
        ...fixedWithSales.breakdown.map(f => ({ name: f.name, type: f.type, amount: f.amount })),
        ...fixedWithSales.ratioItems.map(r => ({
          name: r.name,
          type: "sales_ratio",
          amount: Math.round(salesTotal * r.ratio / 100),
        })),
      ];

      // 인건비 (소속회사별)
      const rawSchedRows = await db.select({
        scheduleId: schedules.id,
        userId: schedules.userId,
        startTime: schedules.startTime,
        endTime: schedules.endTime,
        breakMinutes: schedules.breakMinutes,
        tempWorkerName: schedules.tempWorkerName,
        tempWageType: schedules.tempWageType,
        tempWageAmount: schedules.tempWageAmount,
        wageType: employeeContracts.wageType,
        wageAmount: employeeContracts.wageAmount,
        contractIsActive: employeeContracts.isActive,
      }).from(schedules)
        .leftJoin(employeeContracts, and(
          eq(employeeContracts.userId, schedules.userId),
          eq(employeeContracts.restaurantId, restaurantId),
        ))
        .where(and(
          eq(schedules.restaurantId, restaurantId),
          sql`${schedules.startTime} >= ${fromUtc}`,
          sql`${schedules.startTime} < ${toUtc}`,
          sql`${schedules.status} IN ('confirmed','completed')`,
        ));

      // 복수 계약 중복 제거
      const schedDedup = new Map<number, typeof rawSchedRows[0]>();
      for (const r of rawSchedRows) {
        const existing = schedDedup.get(r.scheduleId);
        if (!existing) { schedDedup.set(r.scheduleId, r); }
        else if (!existing.contractIsActive && r.contractIsActive) { schedDedup.set(r.scheduleId, r); }
      }
      const schedRows = Array.from(schedDedup.values());

      // 소속회사 조회
      const userIds = [...new Set(schedRows.map(r => r.userId).filter(Boolean))] as number[];
      const affMap = new Map<number, string>();
      if (userIds.length > 0) {
        const ruRows = await db.select({
          userId: restaurantUsers.userId,
          affiliatedCompany: restaurantUsers.affiliatedCompany,
        }).from(restaurantUsers).where(and(
          eq(restaurantUsers.restaurantId, restaurantId),
          sql`${restaurantUsers.userId} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`,
        ));
        for (const r of ruRows) affMap.set(r.userId, r.affiliatedCompany ?? "기본");
      }

      const laborByCompanyMap = new Map<string, { headcount: Set<number | string>; hours: number; amount: number }>();
      let laborCost = 0;

      for (const r of schedRows) {
        const startDt = new Date(r.startTime);
        const endDt = new Date(r.endTime);
        const grossMin = (endDt.getTime() - startDt.getTime()) / 60000;
        const netMin = Math.max(0, grossMin - (r.breakMinutes ?? 0));
        const hours = netMin / 60;

        let pay = 0;
        if (r.tempWageType === "daily" && r.tempWageAmount) {
          pay = Number(r.tempWageAmount);
        } else if (r.tempWageType === "hourly" && r.tempWageAmount) {
          pay = hours * Number(r.tempWageAmount);
        } else if (r.wageType === "hourly" && r.wageAmount) {
          pay = hours * Number(r.wageAmount);
        } else if (r.wageType === "monthly" && r.wageAmount) {
          pay = hours * (Number(r.wageAmount) / 209);
        }
        laborCost += pay;

        const company = r.tempWorkerName ? "임시근로" : (r.userId ? affMap.get(r.userId) ?? "기본" : "기본");
        const key = r.tempWorkerName ? `임시-${r.tempWorkerName}` : (r.userId ? String(r.userId) : "unknown");
        const existing = laborByCompanyMap.get(company);
        if (existing) {
          existing.headcount.add(key);
          existing.hours += hours;
          existing.amount += pay;
        } else {
          laborByCompanyMap.set(company, { headcount: new Set([key]), hours, amount: pay });
        }
      }
      laborCost = Math.round(laborCost);

      const laborByCompany = Array.from(laborByCompanyMap.entries())
        .map(([company, v]) => ({
          company,
          headcount: v.headcount.size,
          hours: Math.round(v.hours * 10) / 10,
          amount: Math.round(v.amount),
        }))
        .sort((a, b) => b.amount - a.amount);

      const profit = salesTotal - purchasesTotal - laborCost - fixedCostsTotal;

      // ── 3. METRICS (운영 지표) ──
      const dailyAvgSales = operatingDays > 0 ? Math.round(salesTotal / operatingDays) : 0;
      const costRatio = salesTotal > 0 ? Math.round(purchasesTotal / salesTotal * 1000) / 10 : 0;
      const laborRatio = salesTotal > 0 ? Math.round(laborCost / salesTotal * 1000) / 10 : 0;
      const profitRatio = salesTotal > 0 ? Math.round(profit / salesTotal * 1000) / 10 : 0;

      // ── 4. PREV MONTH ──
      const pm = month === 1 ? 12 : month - 1;
      const py = month === 1 ? year - 1 : year;
      const [prevClosing] = await db.select().from(monthlyClosings).where(and(
        eq(monthlyClosings.restaurantId, restaurantId),
        eq(monthlyClosings.year, py),
        eq(monthlyClosings.month, pm),
      )).limit(1);
      const prevMonth = prevClosing ? {
        salesTotal: Number(prevClosing.salesTotal),
        purchasesTotal: Number(prevClosing.purchasesTotal),
        laborCost: Number(prevClosing.laborCost),
        fixedCostsTotal: Number(prevClosing.fixedCostsTotal),
        profit: Number(prevClosing.profit),
      } : null;

      // ── 5. CLOSING STATUS ──
      const [currentClosing] = await db.select().from(monthlyClosings).where(and(
        eq(monthlyClosings.restaurantId, restaurantId),
        eq(monthlyClosings.year, year),
        eq(monthlyClosings.month, month),
      )).limit(1);

      let closedByName: string | null = null;
      if (currentClosing?.closedBy) {
        const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, currentClosing.closedBy)).limit(1);
        closedByName = u?.name ?? null;
      }

      return {
        collection: {
          operatingDays,
          daysInMonth,
          closedDays: closedDaysCount,
          unclosedDates,
          salesInputDays: salesDateStrs.length,
          salesMissingDates,
          purchaseCount,
          purchasePendingCount,
          draftScheduleCount,
          fixedCostCount,
        },
        income: {
          salesTotal,
          purchasesTotal,
          laborCost,
          fixedCostsTotal,
          profit,
          salesByMethod: {
            card: cardTotal,
            cash: cashTotal,
            giftCard: giftCardTotal,
            transfer: transferTotal,
            other: otherTotal,
          },
          purchasesByCounterparty,
          laborByCompany,
          fixedBreakdown,
        },
        metrics: {
          dailyAvgSales,
          costRatio,
          laborRatio,
          profitRatio,
          targetSales: Number(rest?.monthlyTargetSales ?? 0),
          targetCostRatio: Number(rest?.targetCostRatio ?? 0),
          targetLaborRatio: Number(rest?.targetLaborRatio ?? 0),
        },
        prevMonth,
        closing: {
          isClosed: !!currentClosing,
          closedByName,
          closedAt: currentClosing?.closedAt ?? null,
        },
      };
    }),

  /** 증빙 이미지 목록 조회 */
  getImages: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db.select().from(settlementImages).where(and(
        eq(settlementImages.restaurantId, input.restaurantId),
        eq(settlementImages.year, input.year),
        eq(settlementImages.month, input.month),
      ));
    }),

  /** 증빙 이미지 추가 */
  addImage: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      year: z.number(),
      month: z.number(),
      counterpartyId: z.number().nullable(),
      imageUrl: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.insert(settlementImages).values({
        restaurantId: input.restaurantId,
        year: input.year,
        month: input.month,
        counterpartyId: input.counterpartyId,
        imageUrl: input.imageUrl,
        uploadedBy: ctx.user.userId,
      });
      return { success: true };
    }),

  /** 증빙 이미지 삭제 */
  deleteImage: managerProcedure
    .input(z.object({ id: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(settlementImages).where(
        and(eq(settlementImages.id, input.id), eq(settlementImages.restaurantId, input.restaurantId)),
      );
      return { success: true };
    }),

  /** 증빙 이미지 정산서 금액 업데이트 */
  updateImageAmount: managerProcedure
    .input(z.object({ id: z.number(), restaurantId: z.number(), claimedAmount: z.number().nullable() }))
    .mutation(async ({ input }) => {
      await db.update(settlementImages)
        .set({ claimedAmount: input.claimedAmount })
        .where(and(eq(settlementImages.id, input.id), eq(settlementImages.restaurantId, input.restaurantId)));
      return { success: true };
    }),

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

      // 3. 고정비 합계 (공통 함수 — costType별 월할 + 기간 필터 + sales_ratio 포함)
      const fixedResult = await calcMonthlyFixedCosts(input.restaurantId, input.year, input.month, salesTotal);
      const fixedCostsTotal = fixedResult.totalWithRatio;

      // 4. 인건비: 확정/완료 스케줄 × 계약 시급/월급 기반 자동 계산
      const monthStr2 = String(input.month).padStart(2, "0");
      const kstFrom = new Date(`${input.year}-${monthStr2}-01T00:00:00+09:00`);
      const nm2 = input.month === 12 ? 1 : input.month + 1;
      const ny2 = input.month === 12 ? input.year + 1 : input.year;
      const kstTo = new Date(`${ny2}-${String(nm2).padStart(2, "0")}-01T00:00:00+09:00`);
      const fromUtc = kstFrom.toISOString().slice(0, 19).replace("T", " ");
      const toUtc = kstTo.toISOString().slice(0, 19).replace("T", " ");

      // 계약서 isActive 필터 제거 → 초안(비활성) 계약도 급여 반영
      const rawSchedRows = await db
        .select({
          scheduleId: schedules.id,
          startTime: schedules.startTime,
          endTime: schedules.endTime,
          breakMinutes: schedules.breakMinutes,
          tempWageType: schedules.tempWageType,
          tempWageAmount: schedules.tempWageAmount,
          wageType: employeeContracts.wageType,
          wageAmount: employeeContracts.wageAmount,
          weeklyOffDays: employeeContracts.weeklyOffDays,
          contractIsActive: employeeContracts.isActive,
        })
        .from(schedules)
        .leftJoin(employeeContracts, and(
          eq(employeeContracts.userId, schedules.userId),
          eq(employeeContracts.restaurantId, input.restaurantId),
        ))
        .where(and(
          eq(schedules.restaurantId, input.restaurantId),
          sql`${schedules.startTime} >= ${fromUtc}`,
          sql`${schedules.startTime} < ${toUtc}`,
          sql`${schedules.status} IN ('confirmed','completed')`,
        ));

      // 복수 계약 중복 제거: active 우선
      const schedDedup = new Map<number, typeof rawSchedRows[0]>();
      for (const r of rawSchedRows) {
        const existing = schedDedup.get(r.scheduleId);
        if (!existing) {
          schedDedup.set(r.scheduleId, r);
        } else if (!existing.contractIsActive && r.contractIsActive) {
          schedDedup.set(r.scheduleId, r);
        }
      }
      const schedRows = Array.from(schedDedup.values());

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
});
