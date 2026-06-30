import { z } from "zod";
import { eq, and, gte, sql, sum, count, between } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { verifyStoreAccess } from "../middleware/storeAuth";
import { computeWageForShift, computeMonthlyOnlyWage, type WageType } from "../helpers/wage";
import { computeMonthlyStandardHours } from "../helpers/labor";
import {
  monthlyClosings,
  purchaseOrdersV2,
  schedules,
  restaurants,
  users,
  restaurantUsers,
  employeeWageHistory,
  dailyClosings,
  dailySalesDetail,
  counterparties,
  storeClosedDays,
  storeWeeklyClosures,
  settlementImages,
  dailyExpenses,
  expenseCategories,
  affiliatedCompanies,
} from "../../drizzle/schema";
import { calcMonthlyFixedCosts } from "../helpers/fixedCostCalc";

// ── 유틸 ────────────────────────────────────────────────────────────────────
function toDateStr(v: unknown): string {
  if (typeof v === "string") return v.slice(0, 10);
  return new Date(v as Date).toISOString().slice(0, 10);
}

/** KST "오늘" 날짜 문자열 (YYYY-MM-DD) */
function kstToday(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600000);
  return kst.toISOString().slice(0, 10);
}

// ── 결제수단별 매출 합산 (일마감 완료 날짜 기준) ──────────────────────────
export async function sumSalesByMethod(
  restaurantId: number,
  closedDateStrs: string[],
  startDate: string,
  endDate: string,
) {
  if (closedDateStrs.length === 0) {
    return { salesTotal: 0, card: 0, cash: 0, giftCard: 0, transfer: 0, other: 0 };
  }
  const rows = await db.select({
    cashAmount: dailySalesDetail.cashAmount,
    cardAmount: dailySalesDetail.cardAmount,
    giftCardAmount: dailySalesDetail.giftCardAmount,
    transferAmount: dailySalesDetail.transferAmount,
    otherAmount: dailySalesDetail.otherAmount,
    totalAmount: dailySalesDetail.totalAmount,
  }).from(dailySalesDetail).where(and(
    eq(dailySalesDetail.restaurantId, restaurantId),
    sql`${dailySalesDetail.saleDate} IN (
      SELECT closingDate FROM daily_closings
      WHERE restaurantId = ${restaurantId}
      AND closingDate >= ${startDate} AND closingDate <= ${endDate}
    )`,
  ));

  let salesTotal = 0, card = 0, cash = 0, giftCard = 0, transfer = 0, other = 0;
  for (const r of rows) {
    salesTotal += Number(r.totalAmount ?? 0);
    card += Number(r.cardAmount ?? 0);
    cash += Number(r.cashAmount ?? 0);
    giftCard += Number(r.giftCardAmount ?? 0);
    transfer += Number(r.transferAmount ?? 0);
    other += Number(r.otherAmount ?? 0);
  }
  return { salesTotal, card, cash, giftCard, transfer, other };
}

// ── 미마감일 매출 합산 (참고용) ──────────────────────────────────────────
async function sumUnconfirmedSales(
  restaurantId: number,
  unclosedDates: string[],
) {
  if (unclosedDates.length === 0) return 0;
  const [row] = await db.select({
    total: sql<string>`COALESCE(SUM(${dailySalesDetail.totalAmount}), 0)`,
  }).from(dailySalesDetail).where(and(
    eq(dailySalesDetail.restaurantId, restaurantId),
    sql`${dailySalesDetail.saleDate} IN (${sql.join(unclosedDates.map(d => sql`${d}`), sql`, `)})`,
  ));
  return Number(row?.total ?? 0);
}

// ── 매입 합산 (거래처별, 날짜 필터) ─────────────────────────────────────
export async function sumPurchasesByCP(
  restaurantId: number,
  startDate: string,
  endDate: string,
  closedDatesOnly: boolean,
) {
  const dateFilter = closedDatesOnly
    ? sql`${purchaseOrdersV2.purchaseDate} IN (
        SELECT closingDate FROM daily_closings
        WHERE restaurantId = ${restaurantId}
        AND closingDate >= ${startDate} AND closingDate <= ${endDate}
      )`
    : sql`${purchaseOrdersV2.purchaseDate} >= ${startDate} AND ${purchaseOrdersV2.purchaseDate} <= ${endDate}`;

  const rows = await db.select({
    counterpartyId: purchaseOrdersV2.counterpartyId,
    totalAmount: purchaseOrdersV2.totalAmount,
  }).from(purchaseOrdersV2).where(and(
    eq(purchaseOrdersV2.restaurantId, restaurantId),
    dateFilter,
    eq(purchaseOrdersV2.status, "received"),
  ));

  // 거래처 이름 조회
  const cpIds = [...new Set(rows.map(r => r.counterpartyId).filter(Boolean))] as number[];
  const cpMap = new Map<number, string>();
  if (cpIds.length > 0) {
    const cpRows = await db.select({ id: counterparties.id, name: counterparties.name })
      .from(counterparties).where(sql`${counterparties.id} IN (${sql.join(cpIds.map(id => sql`${id}`), sql`, `)})`);
    for (const c of cpRows) cpMap.set(c.id, c.name);
  }

  const byCP = new Map<number, { name: string; count: number; amount: number }>();
  let total = 0;
  for (const r of rows) {
    const amt = Number(r.totalAmount ?? 0);
    total += amt;
    const cpId = r.counterpartyId ?? 0;
    const existing = byCP.get(cpId);
    if (existing) { existing.count++; existing.amount += amt; }
    else { byCP.set(cpId, { name: cpMap.get(cpId) ?? "기타", count: 1, amount: amt }); }
  }

  return {
    total,
    byCounterparty: Array.from(byCP.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.amount - a.amount),
  };
}

// ── 인건비 합산 (소속회사별) ─────────────────────────────────────────────
//
// 월급제 정산 정책 재설계 2026-05-02 §3.4 (Phase 5) + §3.7 (Phase 8):
//   1. 시프트 누적: 시급/일급/임시근로자만. 정규 월급제 시프트는 임금 누적 제외.
//   2. 정규 월급제 직원: 월말 일괄 합산 (computeMonthlyOnlyWage). 분모 209h 통일,
//      입퇴사월 일할 보정, 미근무차감 적용.
//   3. 산식: totalCost = shiftTotalCost + monthlyTotalCost
//      (시프트 실시간 합산 + 월말 일괄 합산 — 항상 동일 산식, daily_closings.laborCost
//      SUM 안 함).
//   4. closedDateStrs는 schedules JOIN 날짜 필터로만 사용 (해당 일자 시프트만 합산).
//
// 이력 노트 — Phase E 박제 안전망(ratio 보정)은 §3.7 (Phase 8)에서 폐기:
//   ratio = snapshotTotal / shiftTotalCost 보정이 cda02e6 이전 옛 박제(월급제 시간
//   비례 포함)와 신 산식(월급제 제외)을 동시에 합산해 월급제 이중 계산 발생.
//   천호점 4월 미확정 정산 인건비가 17.56M(정상치 11~12M, +590만 부풀림)으로 표시.
//   → daily_closings.laborCost는 일마감 화면 표시용으로 격하. 월정산은 시프트 + 월말
//   일괄로만 산출. Phase 5.5에서 5월 1건 박제값을 신 산식으로 재산출했으므로 일마감
//   화면도 정합. 과거 박제(2025~2026-04)는 옛 산식 그대로 일마감 화면에 잔존.
export async function sumLaborByCompany(
  restaurantId: number,
  year: number,
  month: number,
  closedDateStrs?: string[],
) {
  const mm = String(month).padStart(2, "0");
  const kstFrom = new Date(`${year}-${mm}-01T00:00:00+09:00`);
  const nm = month === 12 ? 1 : month + 1;
  const ny = month === 12 ? year + 1 : year;
  const kstTo = new Date(`${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+09:00`);
  const fromUtc = kstFrom.toISOString().slice(0, 19).replace("T", " ");
  const toUtc = kstTo.toISOString().slice(0, 19).replace("T", " ");

  // 일마감 날짜 필터 추가
  const dateCondition = closedDateStrs && closedDateStrs.length > 0
    ? sql`DATE(CONVERT_TZ(${schedules.startTime}, '+00:00', '+09:00')) IN (${sql.join(closedDateStrs.map(d => sql`${d}`), sql`, `)})`
    : undefined;

  // Phase 5 (2026-05-02): hireDate, contractEnd 추가 — 월급제 일괄 일할 보정용.
  // Phase E (2026-05-02): weeklyHours 출처를 restaurant_users로 변경.
  const rows = await db.select({
    scheduleId: schedules.id,
    userId: schedules.userId,
    startTime: schedules.startTime,
    endTime: schedules.endTime,
    breakMinutes: schedules.breakMinutes,
    tempWorkerName: schedules.tempWorkerName,
    tempWageType: schedules.tempWageType,
    tempWageAmount: schedules.tempWageAmount,
    wageType: employeeWageHistory.wageType,
    wageAmount: employeeWageHistory.wageAmount,
    weeklyHours: restaurantUsers.weeklyHours,
    hireDate: restaurantUsers.hireDate,
    contractEnd: restaurantUsers.contractEnd,
  }).from(schedules)
    .leftJoin(restaurantUsers, and(
      eq(restaurantUsers.restaurantId, restaurantId),
      eq(restaurantUsers.userId, schedules.userId),
    ))
    .leftJoin(employeeWageHistory, and(
      eq(employeeWageHistory.userId, schedules.userId),
      eq(employeeWageHistory.restaurantId, restaurantId),
      sql`DATE_FORMAT(CONVERT_TZ(${schedules.startTime}, '+00:00', '+09:00'), '%Y-%m-01') >= ${employeeWageHistory.effectiveFrom}`,
      sql`(${employeeWageHistory.effectiveTo} IS NULL OR DATE_FORMAT(CONVERT_TZ(${schedules.startTime}, '+00:00', '+09:00'), '%Y-%m-01') < ${employeeWageHistory.effectiveTo})`,
    ))
    .where(and(
      eq(schedules.restaurantId, restaurantId),
      sql`${schedules.startTime} >= ${fromUtc}`,
      sql`${schedules.startTime} < ${toUtc}`,
      sql`${schedules.status} = 'completed'`,
      ...(dateCondition ? [dateCondition] : []),
    ));

  // 소속회사 조회 + 회사명별 5인 여부 (재설계 2026-05-02)
  const userIds = [...new Set(rows.map(r => r.userId).filter(Boolean))] as number[];
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
  const acRows = await db.select({
    companyName: affiliatedCompanies.companyName,
    over5Employees: affiliatedCompanies.over5Employees,
  }).from(affiliatedCompanies).where(eq(affiliatedCompanies.restaurantId, restaurantId));
  const over5ByCompany = new Map<string, boolean>();
  for (const c of acRows) over5ByCompany.set(c.companyName, Boolean(c.over5Employees));

  // amountShifts: 시급/일급/임시 시프트 누적, amountMonthly: 월급제 일괄 (분리 보관 → 박제 보정 분리)
  const byCompanyMap = new Map<string, {
    headcount: Set<number | string>;
    hours: number;
    amountShifts: number;
    amountMonthly: number;
  }>();
  let shiftTotalCost = 0;

  // 월급제 정규직 직원별 actualHours 누적 (월말 일괄 합산용)
  const monthlyEmpMap = new Map<number, {
    actualHours: number;
    wageAmount: string;
    hireDate: string | null;
    contractEnd: string | null;
    company: string;
  }>();

  for (const r of rows) {
    const startDt = new Date(r.startTime);
    const endDt = new Date(r.endTime);
    const grossMin = (endDt.getTime() - startDt.getTime()) / 60000;
    const netMin = Math.max(0, grossMin - (r.breakMinutes ?? 0));
    const hours = netMin / 60;

    const empCompany = r.userId ? affMap.get(r.userId) ?? null : null;
    const over5 = empCompany ? over5ByCompany.get(empCompany) ?? false : false;

    // 시급 결정 (재설계 2026-05-02 §2.4)
    const isRegularMonthly = !r.tempWageType && r.wageType === "monthly";
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

    const company = r.tempWorkerName ? "임시근로" : (empCompany ?? "기본");
    const key = r.tempWorkerName ? `임시-${r.tempWorkerName}` : (r.userId ? String(r.userId) : "unknown");

    if (isRegularMonthly && r.userId) {
      // 월급제 정규직: 시프트 임금 누적 X. 직원별 actualHours만 모아 월말 일괄 합산.
      if (!monthlyEmpMap.has(r.userId)) {
        monthlyEmpMap.set(r.userId, {
          actualHours: 0,
          wageAmount: String(r.wageAmount ?? "0"),
          hireDate: r.hireDate ? String(r.hireDate) : null,
          contractEnd: r.contractEnd ? String(r.contractEnd) : null,
          company,
        });
      }
      monthlyEmpMap.get(r.userId)!.actualHours += hours;
      // headcount/hours는 누적 (amountShifts는 0)
      const existing = byCompanyMap.get(company);
      if (existing) { existing.headcount.add(key); existing.hours += hours; }
      else { byCompanyMap.set(company, { headcount: new Set([key]), hours, amountShifts: 0, amountMonthly: 0 }); }
      continue;
    }

    const pay = computeWageForShift({ wageType: wt, wageAmount: wa, hoursWorked: hours, monthlyStandardHours: stdHours });
    shiftTotalCost += pay;

    const existing = byCompanyMap.get(company);
    if (existing) { existing.headcount.add(key); existing.hours += hours; existing.amountShifts += pay; }
    else { byCompanyMap.set(company, { headcount: new Set([key]), hours, amountShifts: pay, amountMonthly: 0 }); }
  }

  // 월급제 정규직 월말 일괄 합산 (정책 §2.2 / §3.4)
  let monthlyTotalCost = 0;
  for (const [_userId, data] of monthlyEmpMap) {
    const result = computeMonthlyOnlyWage({
      monthlyWage: data.wageAmount,
      actualHours: data.actualHours,
      hireDate: data.hireDate,
      resignDate: data.contractEnd,
      year,
      month,
      stdHours: 209,
    });
    monthlyTotalCost += result.finalWage;
    const c = byCompanyMap.get(data.company);
    if (c) c.amountMonthly += result.finalWage;
  }

  // §3.7 (Phase 8): 박제 안전망 폐기. 항상 시프트 실시간 + 월말 일괄로만 산출.
  //   daily_closings.laborCost SUM 조회 + ratio 보정 블록 제거.
  const totalCost = Math.round(shiftTotalCost + monthlyTotalCost);

  return {
    totalCost,
    byCompany: Array.from(byCompanyMap.entries())
      .map(([company, v]) => ({
        company,
        headcount: v.headcount.size,
        hours: Math.round(v.hours * 10) / 10,
        amount: Math.round(v.amountShifts + v.amountMonthly),
      }))
      .sort((a, b) => b.amount - a.amount),
  };
}


export const monthlyClosingsRouter = router({
  /** 통합 월정산 데이터 조회 — 일마감 기준 confirmed/unconfirmed 분리 */
  settlementData: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const { restaurantId, year, month } = input;
      const mm = String(month).padStart(2, "0");
      const startDate = `${year}-${mm}-01`;
      const daysInMonth = new Date(year, month, 0).getDate();
      const endDate = `${year}-${mm}-${String(daysInMonth).padStart(2, "0")}`;
      const todayStr = kstToday();

      // ── 매장 정보 ──
      const [rest] = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);

      // ── 휴무일 (영업일 산출용) ──
      const weeklyClosed = await db.select().from(storeWeeklyClosures)
        .where(and(eq(storeWeeklyClosures.restaurantId, restaurantId), eq(storeWeeklyClosures.isClosed, true)));
      const closedWeekdays = new Set(weeklyClosed.map(w => w.weekday));

      const closedDayRows = await db.select().from(storeClosedDays)
        .where(and(
          eq(storeClosedDays.restaurantId, restaurantId),
          gte(storeClosedDays.closedDate, new Date(startDate)),
          sql`${storeClosedDays.closedDate} <= ${endDate}`,
        ));
      const closedDateSet = new Set(closedDayRows.map(d => toDateStr(d.closedDate)));

      // 영업일 계산
      let operatingDays = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(year, month - 1, d);
        const dateStr = `${year}-${mm}-${String(d).padStart(2, "0")}`;
        if (closedWeekdays.has(dt.getDay())) continue;
        if (closedDateSet.has(dateStr)) continue;
        operatingDays++;
      }

      // ── 일마감 현황 ──
      const dcRows = await db.select({
        closingDate: dailyClosings.closingDate,
        salesTotal: dailyClosings.salesTotal,
        purchasesTotal: dailyClosings.purchasesTotal,
        laborCost: dailyClosings.laborCost,
      }).from(dailyClosings).where(and(
        eq(dailyClosings.restaurantId, restaurantId),
        gte(dailyClosings.closingDate, new Date(startDate)),
        sql`${dailyClosings.closingDate} <= ${endDate}`,
      ));
      const closedDateStrs = dcRows.map(r => toDateStr(r.closingDate));
      const closedDaysCount = closedDateStrs.length;
      const closedDateLookup = new Set(closedDateStrs);

      // 영업일 중 미마감 날짜 (오늘까지만)
      const unclosedDates: string[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(year, month - 1, d);
        const dateStr = `${year}-${mm}-${String(d).padStart(2, "0")}`;
        if (closedWeekdays.has(dt.getDay())) continue;
        if (closedDateSet.has(dateStr)) continue;
        if (dateStr > todayStr) continue;
        if (!closedDateLookup.has(dateStr)) unclosedDates.push(dateStr);
      }

      // ── 매출 입력 현황 ──
      const salesRows = await db.select({ saleDate: dailySalesDetail.saleDate })
        .from(dailySalesDetail)
        .where(and(
          eq(dailySalesDetail.restaurantId, restaurantId),
          gte(dailySalesDetail.saleDate, new Date(startDate)),
          sql`${dailySalesDetail.saleDate} <= ${endDate}`,
        ));
      const salesDateSet = new Set(salesRows.map(r => toDateStr(r.saleDate)));
      const salesMissingDates: string[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(year, month - 1, d);
        const dateStr = `${year}-${mm}-${String(d).padStart(2, "0")}`;
        if (closedWeekdays.has(dt.getDay())) continue;
        if (closedDateSet.has(dateStr)) continue;
        if (dateStr > todayStr) continue;
        if (!salesDateSet.has(dateStr)) salesMissingDates.push(dateStr);
      }

      // ── 매입 현황 ──
      const purchaseStatusRows = await db.select({
        status: purchaseOrdersV2.status,
      }).from(purchaseOrdersV2).where(and(
        eq(purchaseOrdersV2.restaurantId, restaurantId),
        gte(purchaseOrdersV2.purchaseDate, new Date(startDate)),
        sql`${purchaseOrdersV2.purchaseDate} <= ${endDate}`,
      ));
      const purchaseCount = purchaseStatusRows.length;
      const purchasePendingCount = purchaseStatusRows.filter(r => r.status === "ordered").length;

      // ── 스케줄 미확정 건수 ──
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

      // ── 매출 (일마감 기준) ──
      const confirmedSales = await sumSalesByMethod(restaurantId, closedDateStrs, startDate, endDate);
      const unconfirmedSalesTotal = await sumUnconfirmedSales(restaurantId, unclosedDates);

      // ── 매입 (일마감 기준) ──
      const confirmedPurchases = await sumPurchasesByCP(restaurantId, startDate, endDate, true);
      // 미반영 매입 = 전체 입고 확정 - 일마감 확정분
      const allPurchases = await sumPurchasesByCP(restaurantId, startDate, endDate, false);
      const unconfirmedPurchasesTotal = allPurchases.total - confirmedPurchases.total;

      // ── 인건비 (일마감 기준) ──
      const confirmedLabor = await sumLaborByCompany(restaurantId, year, month, closedDateStrs);
      // 미반영 인건비 = 전체 - 확정분
      const allLabor = await sumLaborByCompany(restaurantId, year, month);
      const unconfirmedLaborCost = allLabor.totalCost - confirmedLabor.totalCost;

      // ── 즉시 지출 (날짜 기반, 일마감 무관) ──
      // 분류별 합산 (categoryId → expense_categories 이름, 폴백 legacy category 컬럼)
      const expByCatRows = await db
        .select({
          categoryId: dailyExpenses.categoryId,
          categoryName: expenseCategories.name,
          legacyCategory: dailyExpenses.category,
          amount: sql<string>`COALESCE(SUM(CAST(${dailyExpenses.amount} AS DECIMAL(14,2))), 0)`,
          count: sql<number>`COUNT(*)`,
        })
        .from(dailyExpenses)
        .leftJoin(expenseCategories, eq(expenseCategories.id, dailyExpenses.categoryId))
        .where(and(
          eq(dailyExpenses.restaurantId, restaurantId),
          sql`${dailyExpenses.date} >= ${startDate}`,
          sql`${dailyExpenses.date} <= ${endDate}`,
        ))
        .groupBy(dailyExpenses.categoryId, expenseCategories.name, dailyExpenses.category);

      // 같은 분류명이 categoryId/legacy 양쪽으로 분산될 수 있어 동일 키로 한 번 더 합산
      const expCatMap = new Map<string, { category: string; amount: number; count: number }>();
      for (const r of expByCatRows) {
        const key = r.categoryName ?? r.legacyCategory ?? "미분류";
        const existing = expCatMap.get(key);
        const amt = Math.round(Number(r.amount));
        const cnt = Number(r.count);
        if (existing) { existing.amount += amt; existing.count += cnt; }
        else { expCatMap.set(key, { category: key, amount: amt, count: cnt }); }
      }
      const expensesByCategory = Array.from(expCatMap.values()).sort((a, b) => b.amount - a.amount);
      const expensesTotal = expensesByCategory.reduce((s, e) => s + e.amount, 0);

      // ── 고정비 (profit_ratio 정확 계산을 위해 매입/인건비/즉시지출 이후 호출) ──
      const fixedResult = await calcMonthlyFixedCosts(
        restaurantId, year, month, confirmedSales.salesTotal,
        { purchases: confirmedPurchases.total, labor: confirmedLabor.totalCost, expenses: expensesTotal },
      );
      const fixedCostCount = fixedResult.breakdown.length + fixedResult.salesRatioItems.length + fixedResult.profitRatioItems.length;
      const fixedCostsTotal = fixedResult.totalWithRatio;
      const fixedBreakdown = [
        ...fixedResult.breakdown.map(f => ({ name: f.name, type: f.type, amount: f.amount, ratio: null as number | null })),
        ...fixedResult.salesRatioItems.map(r => ({
          name: r.name,
          type: "sales_ratio" as const,
          amount: Math.round(confirmedSales.salesTotal * r.ratio / 100),
          ratio: r.ratio,
        })),
        ...fixedResult.profitRatioItems.map(r => ({
          name: r.name,
          type: "profit_ratio" as const,
          amount: r.amount,
          ratio: r.ratio,
        })),
      ];

      // ── 손익 (확정분 기준) ──
      const profit = confirmedSales.salesTotal - confirmedPurchases.total - confirmedLabor.totalCost - fixedCostsTotal - expensesTotal;

      // ── 운영 지표 (확정분 기준) ──
      const closedOperatingDays = closedDaysCount; // 일마감 완료 영업일
      const dailyAvgSales = closedOperatingDays > 0 ? Math.round(confirmedSales.salesTotal / closedOperatingDays) : 0;
      const costRatio = confirmedSales.salesTotal > 0 ? Math.round(confirmedPurchases.total / confirmedSales.salesTotal * 1000) / 10 : 0;
      const laborRatio = confirmedSales.salesTotal > 0 ? Math.round(confirmedLabor.totalCost / confirmedSales.salesTotal * 1000) / 10 : 0;
      const profitRatio = confirmedSales.salesTotal > 0 ? Math.round(profit / confirmedSales.salesTotal * 1000) / 10 : 0;

      // ── 전월 비교 ──
      const pm = month === 1 ? 12 : month - 1;
      const py = month === 1 ? year - 1 : year;
      const [prevClosing] = await db.select().from(monthlyClosings).where(and(
        eq(monthlyClosings.restaurantId, restaurantId),
        eq(monthlyClosings.year, py),
        eq(monthlyClosings.month, pm),
      )).limit(1);
      const prevMonthData = prevClosing ? {
        salesTotal: Number(prevClosing.salesTotal),
        purchasesTotal: Number(prevClosing.purchasesTotal),
        laborCost: Number(prevClosing.laborCost),
        fixedCostsTotal: Number(prevClosing.fixedCostsTotal),
        expensesTotal: Number((prevClosing as any).expensesTotal ?? 0),
        profit: Number(prevClosing.profit),
      } : null;

      // ── 마감 상태 ──
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
          salesInputDays: salesDateSet.size,
          salesMissingDates,
          purchaseCount,
          purchasePendingCount,
          draftScheduleCount,
          fixedCostCount,
        },
        // 확정분 (일마감 완료 기준)
        income: {
          salesTotal: confirmedSales.salesTotal,
          purchasesTotal: confirmedPurchases.total,
          laborCost: confirmedLabor.totalCost,
          fixedCostsTotal,
          expensesTotal,
          profit,
          salesByMethod: {
            card: confirmedSales.card,
            cash: confirmedSales.cash,
            giftCard: confirmedSales.giftCard,
            transfer: confirmedSales.transfer,
            other: confirmedSales.other,
          },
          purchasesByCounterparty: confirmedPurchases.byCounterparty,
          laborByCompany: confirmedLabor.byCompany,
          fixedBreakdown,
          expensesByCategory,
        },
        // 미반영분 (일마감 미완료)
        unconfirmed: {
          salesTotal: unconfirmedSalesTotal,
          purchasesTotal: unconfirmedPurchasesTotal,
          laborCost: unconfirmedLaborCost,
          unclosedDays: unclosedDates.length,
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
        prevMonth: prevMonthData,
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
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
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

  /** 월마감 확정 — 일마감 기준 합산 + 고정비 */
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
      const endDate = `${input.year}-${mm}-${String(daysInMonth).padStart(2, "0")}`;

      // 일마감 완료 날짜
      const dcRows = await db.select({ closingDate: dailyClosings.closingDate })
        .from(dailyClosings).where(and(
          eq(dailyClosings.restaurantId, input.restaurantId),
          gte(dailyClosings.closingDate, new Date(startDate)),
          sql`${dailyClosings.closingDate} <= ${endDate}`,
        ));
      const closedDateStrs = dcRows.map(r => toDateStr(r.closingDate));

      // 1. 매출 합계 (일마감 기준)
      const salesResult = await sumSalesByMethod(input.restaurantId, closedDateStrs, startDate, endDate);
      const salesTotal = salesResult.salesTotal;

      // 2. 매입 합계 (일마감 기준, 입고 확정만)
      const purchResult = await sumPurchasesByCP(input.restaurantId, startDate, endDate, true);
      const purchasesTotal = purchResult.total;

      // 3. 인건비 (일마감 기준)
      const laborResult = await sumLaborByCompany(input.restaurantId, input.year, input.month, closedDateStrs);
      const laborCost = laborResult.totalCost;

      // 4. 즉시 지출
      const [expRow] = await db
        .select({ total: sql<string>`COALESCE(SUM(CAST(${dailyExpenses.amount} AS DECIMAL(14,2))), 0)` })
        .from(dailyExpenses)
        .where(and(
          eq(dailyExpenses.restaurantId, input.restaurantId),
          sql`${dailyExpenses.date} >= ${startDate}`,
          sql`${dailyExpenses.date} <= ${endDate}`,
        ));
      const expensesTotalClose = Math.round(Number(expRow?.total ?? 0));

      // 5. 고정비 합계 (profit_ratio 정확 계산을 위해 위 항목 이후 호출)
      const fixedResult = await calcMonthlyFixedCosts(
        input.restaurantId, input.year, input.month, salesTotal,
        { purchases: purchasesTotal, labor: laborCost, expenses: expensesTotalClose },
      );
      const fixedCostsTotal = fixedResult.totalWithRatio;

      const profit = salesTotal - purchasesTotal - laborCost - fixedCostsTotal - expensesTotalClose;

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
            expensesTotal: String(expensesTotalClose),
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
          expensesTotal: String(expensesTotalClose),
          profit: String(profit),
          note: input.note,
          closedBy: ctx.user.userId,
        });
      }

      return { salesTotal, purchasesTotal, laborCost, fixedCostsTotal, expensesTotal: expensesTotalClose, profit, closedDays: closedDateStrs.length };
    }),
});
