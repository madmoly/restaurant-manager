/**
 * 인건비/노무 공통 헬퍼 (재설계 2026-05-02)
 *
 * 역할 분담:
 * - helpers/wage.ts: 시급/일급/월급 환산, 시프트별 임금 합산 (순수 함수)
 * - helpers/labor.ts: 5인 미만/이상 분기, 소속회사 마스터 조회, 세무모드 조회 (DB 의존)
 *
 * 사용처:
 * - server/routers/leaveBalance.ts: 5인 이상에서만 연차/대체휴무 발생
 * - server/routers/schedules.ts:laborCostByCompany / workSummaryByEmployee
 * - server/routers/staff.ts: 직원 응답에 effectiveOver5 포함
 */

import { and, eq, desc, sql, isNull, or } from "drizzle-orm";
import { db } from "../db";
import {
  affiliatedCompanies,
  restaurantUsers,
  employmentElectronicContracts,
  employeeWageHistory,
} from "../../drizzle/schema";

const WEEKS_PER_MONTH = 365 / 12 / 7; // ≈ 4.345
const FULLTIME_STANDARD_HOURS = 209; // 5인 이상 풀타임 표준 분모

/**
 * 소속회사 마스터에서 5인 이상 여부 조회.
 * 매장 + 회사명 매칭. 매칭 없거나 회사명 비어있으면 false (보수적 기본).
 */
export async function getOver5FromCompany(
  restaurantId: number,
  companyName: string | null | undefined,
): Promise<boolean> {
  if (!companyName) return false;
  const rows = await db
    .select({ over5: affiliatedCompanies.over5Employees })
    .from(affiliatedCompanies)
    .where(
      and(
        eq(affiliatedCompanies.restaurantId, restaurantId),
        eq(affiliatedCompanies.companyName, companyName),
      ),
    )
    .limit(1);
  return rows.length > 0 ? Boolean(rows[0].over5) : false;
}

/**
 * 직원의 SSOT 소속회사를 읽어 5인 여부 자동 결정.
 * restaurant_users.affiliatedCompany → affiliated_companies.over5Employees 매칭.
 */
export async function getOver5ForEmployee(
  restaurantId: number,
  userId: number,
): Promise<boolean> {
  const rows = await db
    .select({ company: restaurantUsers.affiliatedCompany })
    .from(restaurantUsers)
    .where(
      and(
        eq(restaurantUsers.restaurantId, restaurantId),
        eq(restaurantUsers.userId, userId),
      ),
    )
    .limit(1);
  if (rows.length === 0) return false;
  return getOver5FromCompany(restaurantId, rows[0].company);
}

/**
 * 월 통상임금 산정시간.
 * 사양 §2.4:
 * - 5인 이상: 209h 고정 (풀타임 표준)
 * - 5인 미만: 직원의 weeklyHours 비례 (월소정 + 주휴, 연차 8h 제외)
 *
 * weeklyHours 결측·0 이하 → 209h 폴백 (분모 0 방지).
 */
export function computeMonthlyStandardHours(
  weeklyHours: number | string | null | undefined,
  over5: boolean,
): number {
  if (over5) return FULLTIME_STANDARD_HOURS;
  const wh = Number(weeklyHours);
  if (!isFinite(wh) || wh <= 0) return FULLTIME_STANDARD_HOURS;
  const weeklyHoliday = wh / 5; // 주휴 = 주근로 / 5 (주5일 환산)
  return (wh + weeklyHoliday) * WEEKS_PER_MONTH;
}

/**
 * 직원의 가장 최근 서명 계약서에서 taxMode 박제값 조회.
 * 미서명/미존재 시 null.
 *
 * 표시 분기 (4대보험 / 3.3% 사업소득) 결정에 사용.
 */
export async function getEffectiveTaxMode(
  userId: number,
  restaurantId: number,
): Promise<"social_insurance" | "biz_income_3_3" | null> {
  const rows = await db
    .select({
      taxMode: employmentElectronicContracts.taxMode,
      snapshotTaxMode: employmentElectronicContracts.snapshotTaxMode,
    })
    .from(employmentElectronicContracts)
    .where(
      and(
        eq(employmentElectronicContracts.employeeId, userId),
        eq(employmentElectronicContracts.restaurantId, restaurantId),
        eq(employmentElectronicContracts.status, "signed"),
      ),
    )
    .orderBy(desc(employmentElectronicContracts.signedAt))
    .limit(1);
  if (rows.length === 0) return null;
  // 박제값 우선, fallback로 계약서 본 컬럼
  const v = rows[0].snapshotTaxMode || rows[0].taxMode;
  if (v === "social_insurance" || v === "biz_income_3_3") return v;
  return null;
}

/**
 * 주별 시프트 총 시간 그룹핑 (월~일 기준).
 * 시급제 + 주휴별도 + 주15h 이상 → 주당 8h × 시급 가산용.
 *
 * shifts: [{ startDate: 'YYYY-MM-DD', hours: number }, ...]
 * 반환: Map<weekStartISO, totalHours>
 */
export function groupHoursByWeek(
  shifts: Array<{ startDate: string; hours: number }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of shifts) {
    const d = new Date(s.startDate + "T00:00:00");
    if (isNaN(d.getTime())) continue;
    // 월요일 기준 주 시작일
    const dow = d.getDay(); // 일=0
    const offsetToMonday = dow === 0 ? -6 : 1 - dow;
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() + offsetToMonday);
    const wk = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}-${String(weekStart.getDate()).padStart(2, "0")}`;
    map.set(wk, (map.get(wk) ?? 0) + s.hours);
  }
  return map;
}

/**
 * 시급제 + 주휴별도 직원의 월 주휴수당 가산.
 * 주15h 이상인 주에 한해 8h × 시급 추가.
 */
export function computeWeeklyHolidayPay(
  weeklyHoursMap: Map<string, number>,
  hourlyWage: number,
): number {
  let bonus = 0;
  for (const hours of weeklyHoursMap.values()) {
    if (hours >= 15) bonus += 8 * hourlyWage;
  }
  return bonus;
}

/**
 * Phase E (2026-05-02): 운영 SSOT 통합 조회
 *
 * 직원의 운영 데이터(restaurant_users)를 일괄 fetch.
 * 정산·UI·계약서 폼 기본값 등에 공통 사용.
 *
 * 반환: restaurant_users row 또는 null (매칭 없음).
 */
export async function getEffectiveOperationalData(
  userId: number,
  restaurantId: number,
): Promise<{
  position: string | null;
  contractType: string | null;
  contractStart: string | null;
  contractEnd: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
  breakMinutes: number | null;
  weeklyHoliday: string | null;
  weeklyHours: string | null;
  taxMode: string;
  hourlyWageIncludesHolidayPay: boolean;
  mealProvided: boolean;
  mealAllowance: string | null;
  nightShiftConsent: boolean;
  specialTerms: string | null;
  affiliatedCompany: string | null;
  hireDate: string | null;
  weeklyOffDays: number;
} | null> {
  const rows = await db
    .select({
      position: restaurantUsers.position,
      contractType: restaurantUsers.contractType,
      contractStart: restaurantUsers.contractStart,
      contractEnd: restaurantUsers.contractEnd,
      workStartTime: restaurantUsers.workStartTime,
      workEndTime: restaurantUsers.workEndTime,
      breakMinutes: restaurantUsers.breakMinutes,
      weeklyHoliday: restaurantUsers.weeklyHoliday,
      weeklyHours: restaurantUsers.weeklyHours,
      taxMode: restaurantUsers.taxMode,
      hourlyWageIncludesHolidayPay: restaurantUsers.hourlyWageIncludesHolidayPay,
      mealProvided: restaurantUsers.mealProvided,
      mealAllowance: restaurantUsers.mealAllowance,
      nightShiftConsent: restaurantUsers.nightShiftConsent,
      specialTerms: restaurantUsers.specialTerms,
      affiliatedCompany: restaurantUsers.affiliatedCompany,
      hireDate: restaurantUsers.hireDate,
      weeklyOffDays: restaurantUsers.weeklyOffDays,
    })
    .from(restaurantUsers)
    .where(
      and(
        eq(restaurantUsers.userId, userId),
        eq(restaurantUsers.restaurantId, restaurantId),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0] as any;
  return {
    position: r.position ?? null,
    contractType: r.contractType ?? null,
    contractStart: r.contractStart ?? null,
    contractEnd: r.contractEnd ?? null,
    workStartTime: r.workStartTime ?? null,
    workEndTime: r.workEndTime ?? null,
    breakMinutes: r.breakMinutes ?? null,
    weeklyHoliday: r.weeklyHoliday ?? null,
    weeklyHours: r.weeklyHours ?? null,
    taxMode: r.taxMode ?? "social_insurance",
    hourlyWageIncludesHolidayPay: Boolean(r.hourlyWageIncludesHolidayPay),
    mealProvided: Boolean(r.mealProvided),
    mealAllowance: r.mealAllowance ?? null,
    nightShiftConsent: Boolean(r.nightShiftConsent),
    specialTerms: r.specialTerms ?? null,
    affiliatedCompany: r.affiliatedCompany ?? null,
    hireDate: r.hireDate ?? null,
    weeklyOffDays: r.weeklyOffDays ?? 1,
  };
}

/**
 * Phase E (2026-05-02): 시점별 임금 조회
 *
 * employee_wage_history에서 지정 시점에 유효한 wage row 조회.
 * asOf default = 오늘. effectiveFrom <= asOf < effectiveTo (또는 effectiveTo NULL).
 */
export async function getEffectiveWage(
  userId: number,
  restaurantId: number,
  asOf?: string, // YYYY-MM-DD
): Promise<{
  wageType: "hourly" | "monthly";
  wageAmount: string;
  effectiveFrom: string;
  effectiveTo: string | null;
} | null> {
  const targetDate = asOf || new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({
      wageType: employeeWageHistory.wageType,
      wageAmount: employeeWageHistory.wageAmount,
      effectiveFrom: employeeWageHistory.effectiveFrom,
      effectiveTo: employeeWageHistory.effectiveTo,
    })
    .from(employeeWageHistory)
    .where(
      and(
        eq(employeeWageHistory.userId, userId),
        eq(employeeWageHistory.restaurantId, restaurantId),
        sql`${employeeWageHistory.effectiveFrom} <= ${targetDate}`,
        or(
          isNull(employeeWageHistory.effectiveTo),
          sql`${targetDate} < ${employeeWageHistory.effectiveTo}`,
        ),
      ),
    )
    .orderBy(desc(employeeWageHistory.effectiveFrom))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0] as any;
  return {
    wageType: r.wageType,
    wageAmount: String(r.wageAmount),
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo ?? null,
  };
}

/**
 * Phase E (2026-05-02): 가장 최근 wage_history row 조회 (effectiveTo NULL이거나 가장 최신).
 * 직원 카드 표시용. wage_history 부재 시 null.
 */
export async function getLatestWage(
  userId: number,
  restaurantId: number,
): Promise<{
  wageType: "hourly" | "monthly";
  wageAmount: string;
  effectiveFrom: string;
  effectiveTo: string | null;
} | null> {
  const rows = await db
    .select({
      wageType: employeeWageHistory.wageType,
      wageAmount: employeeWageHistory.wageAmount,
      effectiveFrom: employeeWageHistory.effectiveFrom,
      effectiveTo: employeeWageHistory.effectiveTo,
    })
    .from(employeeWageHistory)
    .where(
      and(
        eq(employeeWageHistory.userId, userId),
        eq(employeeWageHistory.restaurantId, restaurantId),
      ),
    )
    .orderBy(desc(employeeWageHistory.effectiveFrom))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0] as any;
  return {
    wageType: r.wageType,
    wageAmount: String(r.wageAmount),
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo ?? null,
  };
}
