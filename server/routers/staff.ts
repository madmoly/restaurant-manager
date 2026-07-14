/**
 * staff 라우터 — 점장(owner) 중심 직원 생명주기
 *
 * 모든 mutation은 ownerProcedure + verifyStoreAccess(write) 조합으로 이중 보호.
 * 매니져(supervisor)는 listActive 등 읽기만 가능.
 *
 * 주요 흐름:
 *  - quickAdd: 신규/재입사/겸직 3분기 원클릭 등록 + 초대코드 선택 발급
 *  - resign/reinstate: 소프트 퇴사/복귀 (users row는 유지 — 타 매장 겸직 대비)
 *  - resetPassword: 임시 비밀번호 재발급 + mustChangePassword
 *  - changeRole: supervisor ↔ staff 상호 전환 (owner 임명은 별도)
 *  - listActive: 현직 직원 + 계약서 mismatchedFields 계산 동봉
 *  - listRecentlyResigned: 최근 90일 내 퇴사자 (재입사 원클릭 UI)
 */

import { z } from "zod";
import { and, desc, eq, isNull, sql, inArray } from "drizzle-orm";
import crypto from "crypto";
import { router, managerProcedure, ownerProcedure } from "../trpc";
import { db } from "../db";
import {
  users,
  restaurantUsers,
  employmentElectronicContracts,
  employeeWageHistory,
  auditLogs,
  restaurantInvites,
  affiliatedCompanies,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { verifyStoreAccess } from "../middleware/storeAuth";
import { hashPassword } from "../auth";
import { getLatestWage } from "../helpers/labor";

// ─── 헬퍼 ───────────────────────────────────────────────────────────────────
function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/[^0-9]/g, "");
}

/** 임시 비밀번호 6자리 (숫자) */
function generateTempPassword(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** 사용자명 자동 생성 (전화번호 뒤 8자리 기반) */
function generateUsername(phoneNormalized: string): string {
  const base = phoneNormalized.slice(-8) || String(Date.now()).slice(-8);
  // 충돌 시 뒤에 난수 2자리
  return `u${base}`;
}

/** 6자리 초대코드 */
function generateInviteCode(): string {
  return crypto.randomBytes(4).toString("base64url").slice(0, 6).toUpperCase();
}

/**
 * 운영 SSOT vs 가장 최근 박제 비교 (Phase E, 2026-05-02; 2026-05-02 폐기 항목 반영).
 * 항목 (12):
 *  기본 4: affiliatedCompany, hireDate, contractOffDays, over5Employees
 *  계약 3: contractType, contractStart, contractEnd
 *  근무 4: workStartTime, workEndTime, breakMinutes, weeklyHours
 *  세무 2: taxMode, hourlyWageIncludesHolidayPay
 *  임금 1: wage (wageType + wageAmount 결합)
 *  기타 1: specialTerms
 *
 *  폐기 (양쪽): position(역할로 대체), weeklyHoliday, nightShiftConsent, mealProvided, mealAllowance.
 */
function computeNeedsRenewal(
  current: {
    affiliatedCompany?: string | null;
    hireDate?: string | Date | null;
    contractOffDays?: number | null;
    contractType?: string | null;
    contractStart?: string | Date | null;
    contractEnd?: string | Date | null;
    workStartTime?: string | null;
    workEndTime?: string | null;
    breakMinutes?: number | null;
    weeklyHours?: string | number | null;
    taxMode?: string | null;
    hourlyWageIncludesHolidayPay?: boolean | null;
    specialTerms?: string | null;
    wageType?: string | null;
    wageAmount?: string | number | null;
  },
  snapshot: {
    snapshotAffiliatedCompany?: string | null;
    snapshotHireDate?: string | Date | null;
    snapshotContractOffDays?: number | null;
    // 서명 계약서 본문의 계약휴무일수(폼 입력값). null = legacy 서명본(주당 시대) →
    // snapshotContractOffDays는 백필 환산값(주당×4.345)이므로 비교 대상 아님
    contractOffDays?: number | null;
    snapshotOver5Employees?: boolean | null;
    snapshotContractType?: string | null;
    snapshotContractStart?: string | Date | null;
    snapshotContractEnd?: string | Date | null;
    snapshotWorkStartTime?: string | null;
    snapshotWorkEndTime?: string | null;
    snapshotBreakMinutes?: number | null;
    snapshotWeeklyHours?: string | number | null;
    snapshotTaxMode?: string | null;
    snapshotHourlyWageIncludesHolidayPay?: boolean | null;
    snapshotSpecialTerms?: string | null;
    snapshotWageType?: string | null;
    snapshotWage?: string | number | null;
  } | null,
  effectiveOver5?: boolean | null,
): string[] {
  if (!snapshot) return [];
  const diff: string[] = [];
  const numEq = (a: any, b: any): boolean => {
    if ((a == null || a === "") && (b == null || b === "")) return true;
    return Number(a) === Number(b);
  };
  const dateEq = (a: any, b: any): boolean => {
    const toIso = (x: any) => {
      if (x == null || x === "") return "";
      const d = x instanceof Date ? x : new Date(x);
      return Number.isNaN(d.getTime()) ? "" : d.toISOString().substring(0, 10);
    };
    return toIso(a) === toIso(b);
  };
  const boolEq = (a: any, b: any): boolean => Boolean(a) === Boolean(b);
  const strEq = (a: any, b: any): boolean => {
    const sa = String(a ?? "").trim();
    const sb = String(b ?? "").trim();
    return sa === sb;
  };

  // 임금: wageType + wageAmount 결합 (한 쪽이라도 다르면 wage)
  const hasWage =
    current.wageType || snapshot.snapshotWageType || current.wageAmount || snapshot.snapshotWage;
  if (hasWage) {
    const wageMismatch =
      (current.wageType ?? "") !== (snapshot.snapshotWageType ?? "") ||
      !numEq(current.wageAmount, snapshot.snapshotWage);
    if (wageMismatch) diff.push("wage");
  }

  // 기본
  if (
    (current.affiliatedCompany ?? "") !== "" ||
    (snapshot.snapshotAffiliatedCompany ?? "") !== ""
  ) {
    if (!strEq(current.affiliatedCompany, snapshot.snapshotAffiliatedCompany))
      diff.push("affiliatedCompany");
  }
  if (current.hireDate != null || snapshot.snapshotHireDate != null) {
    if (!dateEq(current.hireDate, snapshot.snapshotHireDate)) diff.push("hireDate");
  }
  // 계약휴무일수: 서명 계약서가 이 필드를 실제로 계약한 경우에만 비교 (오탐 방지, TASK §QA)
  if (snapshot.contractOffDays != null) {
    if (!numEq(current.contractOffDays, snapshot.snapshotContractOffDays))
      diff.push("contractOffDays");
  }
  if (effectiveOver5 != null && snapshot.snapshotOver5Employees != null) {
    if (!boolEq(effectiveOver5, snapshot.snapshotOver5Employees)) diff.push("over5Employees");
  }

  // 계약
  if (current.contractType != null || snapshot.snapshotContractType != null) {
    if (!strEq(current.contractType, snapshot.snapshotContractType)) diff.push("contractType");
  }
  if (current.contractStart != null || snapshot.snapshotContractStart != null) {
    if (!dateEq(current.contractStart, snapshot.snapshotContractStart))
      diff.push("contractStart");
  }
  if (current.contractEnd != null || snapshot.snapshotContractEnd != null) {
    if (!dateEq(current.contractEnd, snapshot.snapshotContractEnd)) diff.push("contractEnd");
  }

  // 근무
  if (current.workStartTime != null || snapshot.snapshotWorkStartTime != null) {
    if (!strEq(current.workStartTime, snapshot.snapshotWorkStartTime))
      diff.push("workStartTime");
  }
  if (current.workEndTime != null || snapshot.snapshotWorkEndTime != null) {
    if (!strEq(current.workEndTime, snapshot.snapshotWorkEndTime)) diff.push("workEndTime");
  }
  if (current.breakMinutes != null || snapshot.snapshotBreakMinutes != null) {
    if (!numEq(current.breakMinutes, snapshot.snapshotBreakMinutes))
      diff.push("breakMinutes");
  }
  if (current.weeklyHours != null || snapshot.snapshotWeeklyHours != null) {
    if (!numEq(current.weeklyHours, snapshot.snapshotWeeklyHours)) diff.push("weeklyHours");
  }

  // 세무
  if (current.taxMode != null || snapshot.snapshotTaxMode != null) {
    if (!strEq(current.taxMode, snapshot.snapshotTaxMode)) diff.push("taxMode");
  }
  if (
    current.hourlyWageIncludesHolidayPay != null ||
    snapshot.snapshotHourlyWageIncludesHolidayPay != null
  ) {
    if (!boolEq(current.hourlyWageIncludesHolidayPay, snapshot.snapshotHourlyWageIncludesHolidayPay))
      diff.push("hourlyWageIncludesHolidayPay");
  }

  // 기타
  if (current.specialTerms != null || snapshot.snapshotSpecialTerms != null) {
    if (!strEq(current.specialTerms, snapshot.snapshotSpecialTerms)) diff.push("specialTerms");
  }

  return diff;
}

export const staffRouter = router({
  // ═══════════════════════════════════════════════════════════════════════
  // 읽기: listActive / listRecentlyResigned / checkPhone
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * 현직 직원 목록 (Phase E 확장: 운영 SSOT 17 항목 + 11 신규 박제 + 임금이력 동봉)
   * 매니져(supervisor) 이상 호출 가능. 매니져는 임금 필드 drop.
   */
  listActive: managerProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);

      const rows = await db
        .select({
          userId: users.id,
          username: users.username,
          name: users.name,
          phone: users.phone,
          email: users.email,
          address: users.address,
          healthCertUrl: users.healthCertUrl,
          healthCertExpiry: users.healthCertExpiry,
          bankBookUrl: users.bankBookUrl,
          mustChangePassword: users.mustChangePassword,
          // restaurant_users (운영 SSOT)
          storeRole: restaurantUsers.role,
          affiliatedCompany: restaurantUsers.affiliatedCompany,
          hireDate: restaurantUsers.hireDate,
          weeklyOffDays: restaurantUsers.weeklyOffDays,
          contractOffDays: restaurantUsers.contractOffDays,
          rehiredAt: restaurantUsers.rehiredAt,
          // Phase E 운영 데이터 (2026-05-02 폐기 5건 제외): contractType, contractStart, contractEnd, workStartTime, workEndTime, breakMinutes, weeklyHours, taxMode, hourlyWageIncludesHolidayPay, specialTerms
          contractType: restaurantUsers.contractType,
          contractStart: restaurantUsers.contractStart,
          contractEnd: restaurantUsers.contractEnd,
          workStartTime: restaurantUsers.workStartTime,
          workEndTime: restaurantUsers.workEndTime,
          breakMinutes: restaurantUsers.breakMinutes,
          weeklyHours: restaurantUsers.weeklyHours,
          taxMode: restaurantUsers.taxMode,
          hourlyWageIncludesHolidayPay: restaurantUsers.hourlyWageIncludesHolidayPay,
          specialTerms: restaurantUsers.specialTerms,
        })
        .from(restaurantUsers)
        .innerJoin(users, eq(users.id, restaurantUsers.userId))
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          isNull(restaurantUsers.resignedAt),
          eq(users.isActive, true),
        ));

      const userIds = rows.map((r) => r.userId);

      // 가장 최근 wage_history row (직원별)
      const wageMap = new Map<number, { wageType: string; wageAmount: string; effectiveFrom: string }>();
      if (userIds.length > 0) {
        const wages = await db
          .select({
            userId: employeeWageHistory.userId,
            wageType: employeeWageHistory.wageType,
            wageAmount: employeeWageHistory.wageAmount,
            effectiveFrom: employeeWageHistory.effectiveFrom,
          })
          .from(employeeWageHistory)
          .where(and(
            eq(employeeWageHistory.restaurantId, input.restaurantId),
            inArray(employeeWageHistory.userId, userIds),
          ))
          .orderBy(desc(employeeWageHistory.effectiveFrom));
        for (const w of wages) {
          if (!wageMap.has(w.userId)) {
            wageMap.set(w.userId, {
              wageType: w.wageType,
              wageAmount: String(w.wageAmount),
              effectiveFrom: w.effectiveFrom as any,
            });
          }
        }
      }

      // 가장 최근 signed 계약서 박제 (직원별)
      const snapshotsMap = new Map<number, any>();
      if (userIds.length > 0) {
        const snaps = await db
          .select({
            employeeId: employmentElectronicContracts.employeeId,
            signedAt: employmentElectronicContracts.signedAt,
            // 기존 박제
            snapshotName: employmentElectronicContracts.snapshotName,
            snapshotPhone: employmentElectronicContracts.snapshotPhone,
            snapshotAddress: employmentElectronicContracts.snapshotAddress,
            snapshotResidentNumber: employmentElectronicContracts.snapshotResidentNumber,
            snapshotBankAccount: employmentElectronicContracts.snapshotBankAccount,
            snapshotBankName: employmentElectronicContracts.snapshotBankName,
            snapshotAffiliatedCompany: employmentElectronicContracts.snapshotAffiliatedCompany,
            snapshotWeeklyOffDays: employmentElectronicContracts.snapshotWeeklyOffDays,
            snapshotContractOffDays: employmentElectronicContracts.snapshotContractOffDays,
            contractOffDays: employmentElectronicContracts.contractOffDays,
            snapshotWeeklyHours: employmentElectronicContracts.snapshotWeeklyHours,
            snapshotWageType: employmentElectronicContracts.snapshotWageType,
            snapshotWage: employmentElectronicContracts.snapshotWage,
            snapshotContractStart: employmentElectronicContracts.snapshotContractStart,
            snapshotContractEnd: employmentElectronicContracts.snapshotContractEnd,
            // Phase D 박제 (선행)
            snapshotHireDate: employmentElectronicContracts.snapshotHireDate,
            snapshotOver5Employees: employmentElectronicContracts.snapshotOver5Employees,
            snapshotTaxMode: employmentElectronicContracts.snapshotTaxMode,
            // Phase E 박제 (2026-05-02 폐기 3건 제외: snapshotPosition·snapshotWeeklyHoliday·snapshotNightShiftConsent)
            snapshotContractType: employmentElectronicContracts.snapshotContractType,
            snapshotWorkStartTime: employmentElectronicContracts.snapshotWorkStartTime,
            snapshotWorkEndTime: employmentElectronicContracts.snapshotWorkEndTime,
            snapshotBreakMinutes: employmentElectronicContracts.snapshotBreakMinutes,
            snapshotSpecialTerms: employmentElectronicContracts.snapshotSpecialTerms,
            snapshotHourlyWageIncludesHolidayPay:
              employmentElectronicContracts.snapshotHourlyWageIncludesHolidayPay,
          })
          .from(employmentElectronicContracts)
          .where(and(
            eq(employmentElectronicContracts.restaurantId, input.restaurantId),
            eq(employmentElectronicContracts.status, "signed"),
          ))
          .orderBy(desc(employmentElectronicContracts.signedAt));
        for (const s of snaps) {
          if (s.employeeId && !snapshotsMap.has(s.employeeId)) {
            snapshotsMap.set(s.employeeId, s);
          }
        }
      }

      // affiliated_companies 마스터 → 직원별 effectiveOver5 매핑
      const ac = await db
        .select({
          companyName: affiliatedCompanies.companyName,
          over5Employees: affiliatedCompanies.over5Employees,
        })
        .from(affiliatedCompanies)
        .where(eq(affiliatedCompanies.restaurantId, input.restaurantId));
      const over5Map = new Map<string, boolean>();
      for (const c of ac) over5Map.set(c.companyName, Boolean(c.over5Employees));

      // 매니져(supervisor) 호출 시 급여 필드 drop — 민감정보 방어
      const isOwnerLevel =
        ctx.user.role === "master" || ctx.user.role === "admin";

      let viewerStoreRole: string | null = null;
      if (!isOwnerLevel) {
        const [ru] = await db
          .select({ role: restaurantUsers.role })
          .from(restaurantUsers)
          .where(and(
            eq(restaurantUsers.userId, ctx.user.userId),
            eq(restaurantUsers.restaurantId, input.restaurantId),
            isNull(restaurantUsers.resignedAt),
          ))
          .limit(1);
        viewerStoreRole = ru?.role ?? null;
      }
      const canSeeWage =
        isOwnerLevel ||
        viewerStoreRole === "owner" ||
        viewerStoreRole === "store_manager";

      return rows.map((r) => {
        const snap = snapshotsMap.get(r.userId) ?? null;
        const wage = wageMap.get(r.userId) ?? null;
        const effectiveOver5 = r.affiliatedCompany
          ? over5Map.get(r.affiliatedCompany) ?? false
          : false;
        const needsRenewal = computeNeedsRenewal(
          {
            affiliatedCompany: r.affiliatedCompany,
            hireDate: r.hireDate,
            contractOffDays: r.contractOffDays,
            contractType: r.contractType,
            contractStart: r.contractStart,
            contractEnd: r.contractEnd,
            workStartTime: r.workStartTime,
            workEndTime: r.workEndTime,
            breakMinutes: r.breakMinutes,
            weeklyHours: r.weeklyHours,
            taxMode: r.taxMode,
            hourlyWageIncludesHolidayPay: r.hourlyWageIncludesHolidayPay,
            specialTerms: r.specialTerms,
            wageType: wage?.wageType ?? null,
            wageAmount: wage?.wageAmount ?? null,
          },
          snap,
          effectiveOver5,
        );
        const out: any = {
          ...r,
          effectiveOver5,
          // 임금 (wage_history 가장 최근)
          wageType: wage?.wageType ?? null,
          wageAmount: wage?.wageAmount ?? null,
          wageEffectiveFrom: wage?.effectiveFrom ?? null,
          // 박제(계좌·주민번호) 노출 — 직원 카드 표시용
          bankName: snap?.snapshotBankName ?? null,
          bankAccount: snap?.snapshotBankAccount ?? null,
          residentNumber: snap?.snapshotResidentNumber ?? null,
          // 갱신 필요 항목 + 박제 메타
          needsRenewal,
          mismatchedFields: needsRenewal, // 호환성 유지 (기존 클라이언트가 mismatchedFields 사용)
          hasActiveContract: !!snap,
          latestContractSignedAt: snap?.signedAt ?? null,
          snapshotHireDate: snap?.snapshotHireDate ?? null,
          snapshotOver5Employees: snap?.snapshotOver5Employees ?? null,
          snapshotTaxMode: snap?.snapshotTaxMode ?? null,
          snapshotAffiliatedCompany: snap?.snapshotAffiliatedCompany ?? null,
          snapshotWeeklyOffDays: snap?.snapshotWeeklyOffDays ?? null,
          snapshotContractOffDays: snap?.snapshotContractOffDays ?? null,
          latestSignedContractOffDays: snap?.contractOffDays ?? null,
          snapshotWageType: snap?.snapshotWageType ?? null,
          snapshotWage: snap?.snapshotWage ?? null,
          snapshotContractType: snap?.snapshotContractType ?? null,
          snapshotContractStart: snap?.snapshotContractStart ?? null,
          snapshotContractEnd: snap?.snapshotContractEnd ?? null,
          snapshotWorkStartTime: snap?.snapshotWorkStartTime ?? null,
          snapshotWorkEndTime: snap?.snapshotWorkEndTime ?? null,
          snapshotBreakMinutes: snap?.snapshotBreakMinutes ?? null,
          snapshotWeeklyHours: snap?.snapshotWeeklyHours ?? null,
          snapshotSpecialTerms: snap?.snapshotSpecialTerms ?? null,
          snapshotHourlyWageIncludesHolidayPay:
            snap?.snapshotHourlyWageIncludesHolidayPay ?? null,
        };
        if (!canSeeWage) {
          delete out.wageType;
          delete out.wageAmount;
          delete out.wageEffectiveFrom;
          delete out.weeklyHours;
          delete out.contractStart;
          delete out.contractEnd;
          delete out.snapshotWage;
          delete out.snapshotWageType;
        }
        return out;
      });
    }),

  /** 최근 90일 내 퇴사자 — 재입사 원클릭용 */
  listRecentlyResigned: ownerProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      const since = new Date();
      since.setDate(since.getDate() - 90);
      const sinceStr = since.toISOString().slice(0, 10);

      return db
        .select({
          userId: users.id,
          name: users.name,
          phone: users.phone,
          storeRole: restaurantUsers.role,
          resignedAt: restaurantUsers.resignedAt,
          resignReason: restaurantUsers.resignReason,
          hireDate: restaurantUsers.hireDate,
        })
        .from(restaurantUsers)
        .innerJoin(users, eq(users.id, restaurantUsers.userId))
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          sql`${restaurantUsers.resignedAt} IS NOT NULL`,
          sql`${restaurantUsers.resignedAt} >= ${sinceStr}`,
        ))
        .orderBy(desc(restaurantUsers.resignedAt));
    }),

  /** 전화번호 중복/재입사/겸직 사전 체크 (모달 실시간 조회용) */
  checkPhone: ownerProcedure
    .input(z.object({ restaurantId: z.number(), phone: z.string() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      const phoneN = normalizePhone(input.phone);
      if (!phoneN) return { status: "empty" as const };

      const [existingUser] = await db
        .select({
          id: users.id,
          name: users.name,
          phone: users.phone,
          isActive: users.isActive,
        })
        .from(users)
        .where(eq(users.phoneNormalized, phoneN))
        .limit(1);

      if (!existingUser) {
        return { status: "new" as const };
      }

      // 해당 user의 현재 매장 배정 확인
      const [currentAssign] = await db
        .select({
          role: restaurantUsers.role,
          resignedAt: restaurantUsers.resignedAt,
        })
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.userId, existingUser.id),
          eq(restaurantUsers.restaurantId, input.restaurantId),
        ))
        .limit(1);

      if (currentAssign && !currentAssign.resignedAt) {
        return {
          status: "duplicate" as const,
          userId: existingUser.id,
          name: existingUser.name,
        };
      }
      if (currentAssign && currentAssign.resignedAt) {
        return {
          status: "rehire" as const,
          userId: existingUser.id,
          name: existingUser.name,
          resignedAt: currentAssign.resignedAt,
        };
      }

      // 다른 매장 근무중 여부
      const others = await db
        .select({ restaurantId: restaurantUsers.restaurantId })
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.userId, existingUser.id),
          isNull(restaurantUsers.resignedAt),
        ));
      if (others.length > 0) {
        return {
          status: "concurrent" as const,
          userId: existingUser.id,
          name: existingUser.name,
          otherStoreCount: others.length,
        };
      }

      // 유저는 있지만 매장 배정 없음 → 그냥 재사용
      return {
        status: "existing" as const,
        userId: existingUser.id,
        name: existingUser.name,
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════
  // 쓰기: quickAdd / resign / reinstate / resetPassword / changeRole
  // ═══════════════════════════════════════════════════════════════════════

  /** 원스텝 직원 추가 — 신규/재입사/겸직 자동 분기 */
  quickAdd: ownerProcedure
    .input(z.object({
      restaurantId: z.number(),
      name: z.string().min(1),
      phone: z.string().min(1),
      role: z.enum(["supervisor", "staff"]).default("staff"),
      sendInvite: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      const phoneN = normalizePhone(input.phone);
      if (!phoneN) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "유효한 전화번호가 필요합니다" });
      }

      // 1. 동일 전화번호 사용자 조회
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.phoneNormalized, phoneN))
        .limit(1);

      let userId: number;
      let status: "new" | "rehire" | "concurrent" | "existing" = "new";
      let tempPassword: string | null = null;

      if (!existingUser) {
        // ── 신규 user 생성 ──
        tempPassword = generateTempPassword();
        const hash = await hashPassword(tempPassword);
        let username = generateUsername(phoneN);
        // username 충돌 처리 (최대 5회 재시도)
        for (let i = 0; i < 5; i++) {
          const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
          if (!dup) break;
          username = `${generateUsername(phoneN)}${Math.floor(Math.random() * 90 + 10)}`;
        }
        const [created] = await db.insert(users).values({
          username,
          passwordHash: hash,
          name: input.name,
          phone: input.phone,
          phoneNormalized: phoneN,
          role: "user",
          mustChangePassword: true,
        }).$returningId();
        userId = created.id;
      } else {
        userId = existingUser.id;
        // 이미 본 매장 배정 있는지
        const [currentAssign] = await db
          .select()
          .from(restaurantUsers)
          .where(and(
            eq(restaurantUsers.userId, userId),
            eq(restaurantUsers.restaurantId, input.restaurantId),
          ))
          .limit(1);

        if (currentAssign && !currentAssign.resignedAt) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "이미 이 매장에 등록된 직원입니다",
          });
        }

        if (currentAssign && currentAssign.resignedAt) {
          // ── 재입사 ──
          await db.update(restaurantUsers)
            .set({
              resignedAt: null,
              resignReason: null,
              role: input.role,
              rehiredAt: new Date(),
            })
            .where(eq(restaurantUsers.id, currentAssign.id));
          // audit
          await db.insert(auditLogs).values({
            userId: ctx.user.userId,
            userName: ctx.user.name || ctx.user.username,
            restaurantId: input.restaurantId,
            action: "update",
            target: "staff",
            targetId: userId,
            details: { kind: "rehire", role: input.role },
          });
          status = "rehire";
          return {
            userId,
            status,
            restaurantUserId: currentAssign.id,
            tempPassword: null,
            inviteCode: null,
          };
        }

        // 다른 매장 근무 중인지
        const others = await db
          .select({ id: restaurantUsers.id })
          .from(restaurantUsers)
          .where(and(
            eq(restaurantUsers.userId, userId),
            isNull(restaurantUsers.resignedAt),
          ));
        status = others.length > 0 ? "concurrent" : "existing";

        // phoneNormalized/name 보정 (없었으면 채움)
        const updates: any = {};
        if (!existingUser.phoneNormalized) updates.phoneNormalized = phoneN;
        if (existingUser.name !== input.name && !existingUser.name) updates.name = input.name;
        if (Object.keys(updates).length > 0) {
          await db.update(users).set(updates).where(eq(users.id, userId));
        }
      }

      // 2. restaurant_users 배정
      // Phase 2: 신규 직원은 contractMigrated=false 명시. 전자계약서 서명 시 true로 전환.
      const [created] = await db.insert(restaurantUsers).values({
        restaurantId: input.restaurantId,
        userId,
        role: input.role,
        contractMigrated: false,
        contractOffDays: 4, // 2026-07-02: 계약휴무일수 기본 4일 (이후 직원 카드/계약서에서 조정)
      } as any).$returningId();

      // audit
      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name || ctx.user.username,
        restaurantId: input.restaurantId,
        action: "create",
        target: "staff",
        targetId: userId,
        details: { kind: status, role: input.role },
      });

      // 3. 초대코드 발급 (옵션)
      let inviteCode: string | null = null;
      if (input.sendInvite) {
        const code = generateInviteCode();
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h
        await db.insert(restaurantInvites).values({
          restaurantId: input.restaurantId,
          code,
          role: input.role,
          createdBy: ctx.user.userId,
          expiresAt,
        });
        inviteCode = code;
      }

      return {
        userId,
        status,
        restaurantUserId: created.id,
        tempPassword,
        inviteCode,
      };
    }),

  /** 퇴사 처리 (소프트) */
  resign: ownerProcedure
    .input(z.object({
      restaurantId: z.number(),
      userId: z.number(),
      resignedAt: z.string().optional(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      const resignDate = input.resignedAt ?? new Date().toISOString().slice(0, 10);

      const [target] = await db
        .select({ id: restaurantUsers.id, resignedAt: restaurantUsers.resignedAt })
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId),
        ))
        .limit(1);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "해당 직원을 찾을 수 없습니다" });
      }
      if (target.resignedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "이미 퇴사 처리된 직원입니다" });
      }

      await db.update(restaurantUsers)
        .set({ resignedAt: resignDate, resignReason: input.reason ?? null })
        .where(eq(restaurantUsers.id, target.id));

      // 퇴사일 이후 draft 스케줄 자동 취소
      await db.execute(sql`
        UPDATE schedules
        SET status = 'canceled'
        WHERE restaurantId = ${input.restaurantId}
          AND userId = ${input.userId}
          AND status = 'draft'
          AND DATE(startTime) > ${resignDate}
      `);

      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name || ctx.user.username,
        restaurantId: input.restaurantId,
        action: "delete",
        target: "staff",
        targetId: input.userId,
        details: { kind: "resign", resignedAt: resignDate, reason: input.reason ?? null },
      });

      return { ok: true };
    }),

  /** 퇴사 취소 (명시적 복원 — 일반적으로는 quickAdd rehire 분기 사용 권장) */
  reinstate: ownerProcedure
    .input(z.object({ restaurantId: z.number(), userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      await db.update(restaurantUsers)
        .set({ resignedAt: null, resignReason: null, rehiredAt: new Date() })
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId),
        ));

      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name || ctx.user.username,
        restaurantId: input.restaurantId,
        action: "update",
        target: "staff",
        targetId: input.userId,
        details: { kind: "reinstate" },
      });

      return { ok: true };
    }),

  /** 임시 비밀번호 재발급 */
  resetPassword: ownerProcedure
    .input(z.object({ restaurantId: z.number(), userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      // 해당 직원이 본 매장 소속인지
      const [ru] = await db
        .select({ id: restaurantUsers.id })
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId),
        ))
        .limit(1);
      if (!ru) {
        throw new TRPCError({ code: "NOT_FOUND", message: "이 매장의 직원이 아닙니다" });
      }

      const tempPassword = generateTempPassword();
      const hash = await hashPassword(tempPassword);
      await db.update(users)
        .set({ passwordHash: hash, mustChangePassword: true })
        .where(eq(users.id, input.userId));

      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name || ctx.user.username,
        restaurantId: input.restaurantId,
        action: "update",
        target: "staff",
        targetId: input.userId,
        details: { kind: "reset_password" },
      });

      return { ok: true, tempPassword };
    }),

  /** 매장 역할 전환 (supervisor ↔ staff) */
  changeRole: ownerProcedure
    .input(z.object({
      restaurantId: z.number(),
      userId: z.number(),
      newRole: z.enum(["supervisor", "staff"]),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      const [target] = await db
        .select({ role: restaurantUsers.role, id: restaurantUsers.id })
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId),
        ))
        .limit(1);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "해당 직원을 찾을 수 없습니다" });
      }
      if (target.role === "owner" || target.role === "store_manager") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "점장의 역할 변경은 별도 플로우를 사용하세요",
        });
      }

      await db.update(restaurantUsers)
        .set({
          role: input.newRole,
          roleChangedAt: new Date(),
          roleChangedBy: ctx.user.userId,
        })
        .where(eq(restaurantUsers.id, target.id));

      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name || ctx.user.username,
        restaurantId: input.restaurantId,
        action: "update",
        target: "staff_role",
        targetId: input.userId,
        details: { before: { role: target.role }, after: { role: input.newRole } },
      });

      return { ok: true };
    }),

  /**
   * 기본 직원정보 편집 — Phase E (2026-05-02):
   * employee_contracts DROP되어 민감영역(bankName/bankAccount/residentNumber)은
   * 박제 계약서로만 갱신. 본 mutation은 user 기본정보 + restaurant_users SSOT 4개만.
   */
  updateInfo: ownerProcedure
    .input(z.object({
      restaurantId: z.number(),
      userId: z.number(),
      name: z.string().min(1).optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      email: z.string().email().optional().or(z.literal("")),
      affiliatedCompany: z.string().nullable().optional(),
      hireDate: z.string().nullable().optional(),
      contractOffDays: z.number().int().min(4).max(15).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      const [ru] = await db
        .select({ id: restaurantUsers.id })
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId),
        ))
        .limit(1);
      if (!ru) {
        throw new TRPCError({ code: "NOT_FOUND", message: "이 매장의 직원이 아닙니다" });
      }

      const usersUpdate: Record<string, any> = {};
      if (input.name !== undefined) usersUpdate.name = input.name;
      if (input.phone !== undefined) {
        usersUpdate.phone = input.phone;
        usersUpdate.phoneNormalized = normalizePhone(input.phone);
      }
      if (input.address !== undefined) usersUpdate.address = input.address;
      if (input.email !== undefined) usersUpdate.email = input.email || null;
      if (Object.keys(usersUpdate).length > 0) {
        await db.update(users).set(usersUpdate).where(eq(users.id, input.userId));
      }

      const ruUpdate: Record<string, any> = {};
      if (input.affiliatedCompany !== undefined) ruUpdate.affiliatedCompany = input.affiliatedCompany;
      if (input.hireDate !== undefined) ruUpdate.hireDate = input.hireDate;
      if (input.contractOffDays !== undefined) ruUpdate.contractOffDays = input.contractOffDays;
      if (Object.keys(ruUpdate).length > 0) {
        await db.update(restaurantUsers).set(ruUpdate).where(eq(restaurantUsers.id, ru.id));
      }

      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name || ctx.user.username,
        restaurantId: input.restaurantId,
        action: "update",
        target: "staff_info",
        targetId: input.userId,
        details: { kind: "manual_basic_edit", fields: Object.keys(input).filter((k) => !["restaurantId", "userId"].includes(k)) },
      });

      return { ok: true };
    }),

  /**
   * Phase E (2026-05-02): 운영 SSOT 통합 update.
   * 직원 카드에서 12 항목 직접 편집. wage_history는 별도(updateWage).
   */
  updateEmployment: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      userId: z.number(),
      contractType: z.enum(["permanent", "fixed_term", "part_time", "daily"]).optional(),
      contractStart: z.string().nullable().optional(),
      contractEnd: z.string().nullable().optional(),
      workStartTime: z.string().optional(),
      workEndTime: z.string().optional(),
      breakMinutes: z.number().int().min(0).max(240).optional(), // 상한 240 — schedules.update와 통일 (2026-07-14)
      weeklyHours: z.string().optional(),
      taxMode: z.enum(["social_insurance", "biz_income_3_3"]).optional(),
      hourlyWageIncludesHolidayPay: z.boolean().optional(),
      specialTerms: z.string().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      const [ru] = await db
        .select({ id: restaurantUsers.id })
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId),
        ))
        .limit(1);
      if (!ru) {
        throw new TRPCError({ code: "NOT_FOUND", message: "이 매장의 직원이 아닙니다" });
      }

      const ruUpdate: Record<string, any> = {};
      const fields = [
        "contractType",
        "contractStart",
        "contractEnd",
        "workStartTime",
        "workEndTime",
        "breakMinutes",
        "weeklyHours",
        "taxMode",
        "hourlyWageIncludesHolidayPay",
        "specialTerms",
      ] as const;
      for (const f of fields) {
        if ((input as any)[f] !== undefined) ruUpdate[f] = (input as any)[f];
      }
      if (Object.keys(ruUpdate).length === 0) return { ok: true };

      await db.update(restaurantUsers).set(ruUpdate).where(eq(restaurantUsers.id, ru.id));

      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name || ctx.user.username,
        restaurantId: input.restaurantId,
        action: "update",
        target: "staff_employment",
        targetId: input.userId,
        details: { fields: Object.keys(ruUpdate) },
      });

      return { ok: true };
    }),

  /**
   * Phase E (2026-05-02): 임금 SSOT 갱신.
   * wage_history에 새 row INSERT + 기존 open row(effectiveTo NULL)는 effectiveFrom으로 닫음.
   * 동일 effectiveFrom row 존재 시 덮어쓰기 (UPDATE).
   */
  updateWage: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      userId: z.number(),
      wageType: z.enum(["hourly", "monthly"]),
      wageAmount: z.string(),
      effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      const amt = Number(input.wageAmount);
      if (!isFinite(amt) || amt < 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "임금 금액이 올바르지 않습니다" });
      }

      const [ru] = await db
        .select({ id: restaurantUsers.id })
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId),
        ))
        .limit(1);
      if (!ru) {
        throw new TRPCError({ code: "NOT_FOUND", message: "이 매장의 직원이 아닙니다" });
      }

      // 동일 effectiveFrom row가 있으면 덮어쓰기. 없으면 INSERT + 기존 open row close.
      const [existing] = await db
        .select({ id: employeeWageHistory.id })
        .from(employeeWageHistory)
        .where(and(
          eq(employeeWageHistory.userId, input.userId),
          eq(employeeWageHistory.restaurantId, input.restaurantId),
          sql`${employeeWageHistory.effectiveFrom} = ${input.effectiveFrom}`,
        ))
        .limit(1);

      if (existing) {
        await db
          .update(employeeWageHistory)
          .set({
            wageType: input.wageType,
            wageAmount: input.wageAmount,
          })
          .where(eq(employeeWageHistory.id, existing.id));
      } else {
        // 가장 최근 open row 닫기 (effectiveTo = effectiveFrom)
        await db.execute(sql`
          UPDATE employee_wage_history
          SET effectiveTo = ${input.effectiveFrom}
          WHERE userId = ${input.userId}
            AND restaurantId = ${input.restaurantId}
            AND effectiveTo IS NULL
            AND effectiveFrom < ${input.effectiveFrom}
        `);
        await db.insert(employeeWageHistory).values({
          userId: input.userId,
          restaurantId: input.restaurantId,
          wageType: input.wageType,
          wageAmount: input.wageAmount,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: null,
          sourceContractId: null,
        } as any);
        // contractMigrated 플래그 → wage_history가 한 번이라도 생기면 true
        await db
          .update(restaurantUsers)
          .set({ contractMigrated: true })
          .where(eq(restaurantUsers.id, ru.id));
      }

      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name || ctx.user.username,
        restaurantId: input.restaurantId,
        action: "update",
        target: "staff_wage",
        targetId: input.userId,
        details: {
          wageType: input.wageType,
          wageAmount: input.wageAmount,
          effectiveFrom: input.effectiveFrom,
        },
      });

      return { ok: true };
    }),

  /**
   * Phase E (2026-05-02): 운영 SSOT 일괄 fetch.
   * 계약서 모달 폼 기본값(신규 모드) 또는 직원 카드 reload용.
   */
  getEmployment: managerProcedure
    .input(z.object({ restaurantId: z.number(), userId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);

      const [r] = await db
        .select({
          // restaurant_users
          affiliatedCompany: restaurantUsers.affiliatedCompany,
          hireDate: restaurantUsers.hireDate,
          weeklyOffDays: restaurantUsers.weeklyOffDays,
          contractOffDays: restaurantUsers.contractOffDays,
          contractType: restaurantUsers.contractType,
          contractStart: restaurantUsers.contractStart,
          contractEnd: restaurantUsers.contractEnd,
          workStartTime: restaurantUsers.workStartTime,
          workEndTime: restaurantUsers.workEndTime,
          breakMinutes: restaurantUsers.breakMinutes,
          weeklyHours: restaurantUsers.weeklyHours,
          taxMode: restaurantUsers.taxMode,
          hourlyWageIncludesHolidayPay: restaurantUsers.hourlyWageIncludesHolidayPay,
          specialTerms: restaurantUsers.specialTerms,
          storeRole: restaurantUsers.role,
          // user 기본정보
          name: users.name,
          phone: users.phone,
          address: users.address,
          email: users.email,
        })
        .from(restaurantUsers)
        .innerJoin(users, eq(users.id, restaurantUsers.userId))
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId),
        ))
        .limit(1);

      if (!r) {
        throw new TRPCError({ code: "NOT_FOUND", message: "이 매장의 직원이 아닙니다" });
      }

      const wage = await getLatestWage(input.userId, input.restaurantId);

      return {
        ...r,
        wageType: wage?.wageType ?? null,
        wageAmount: wage?.wageAmount ?? null,
        wageEffectiveFrom: wage?.effectiveFrom ?? null,
      };
    }),

  /**
   * 가장 최근 서명 계약서의 박제값으로 직원 SSOT 일괄 동기화 (점장 전용).
   * 폐기 항목(position·weeklyHoliday·nightShiftConsent·mealProvided·mealAllowance) 제외.
   * 임금: 박제값과 현재 wage_history 최신값이 다르면 박제 contractStart 월 1일로 새 row 추가.
   */
  applyContractSnapshot: ownerProcedure
    .input(z.object({ restaurantId: z.number(), userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      const [c] = await db
        .select()
        .from(employmentElectronicContracts)
        .where(and(
          eq(employmentElectronicContracts.employeeId, input.userId),
          eq(employmentElectronicContracts.restaurantId, input.restaurantId),
          eq(employmentElectronicContracts.status, "signed"),
        ))
        .orderBy(desc(employmentElectronicContracts.signedAt))
        .limit(1);

      if (!c) {
        throw new TRPCError({ code: "NOT_FOUND", message: "서명된 계약서가 없습니다" });
      }

      const ruUpdate: Record<string, any> = {};
      if (c.snapshotAffiliatedCompany != null) ruUpdate.affiliatedCompany = c.snapshotAffiliatedCompany;
      if (c.snapshotHireDate != null) ruUpdate.hireDate = c.snapshotHireDate;
      // 2026-07-02: 계약휴무일수 복원. 박제값 우선, 백필 이전 박제는 주당→계약휴무 환산 폴백
      if (c.snapshotContractOffDays != null) {
        ruUpdate.contractOffDays = c.snapshotContractOffDays;
      } else if (c.snapshotWeeklyOffDays != null) {
        ruUpdate.contractOffDays = Math.min(15, Math.max(4, Math.round(c.snapshotWeeklyOffDays * 4.345)));
      }
      if (c.snapshotContractType != null) ruUpdate.contractType = c.snapshotContractType;
      if (c.snapshotContractStart != null) ruUpdate.contractStart = c.snapshotContractStart;
      ruUpdate.contractEnd = c.snapshotContractEnd ?? null;
      if (c.snapshotWorkStartTime != null) ruUpdate.workStartTime = c.snapshotWorkStartTime;
      if (c.snapshotWorkEndTime != null) ruUpdate.workEndTime = c.snapshotWorkEndTime;
      if (c.snapshotBreakMinutes != null) ruUpdate.breakMinutes = c.snapshotBreakMinutes;
      if (c.snapshotWeeklyHours != null) ruUpdate.weeklyHours = c.snapshotWeeklyHours;
      if (c.snapshotTaxMode != null) ruUpdate.taxMode = c.snapshotTaxMode;
      if (c.snapshotHourlyWageIncludesHolidayPay != null)
        ruUpdate.hourlyWageIncludesHolidayPay = c.snapshotHourlyWageIncludesHolidayPay;
      if (c.snapshotSpecialTerms != null) ruUpdate.specialTerms = c.snapshotSpecialTerms;

      if (Object.keys(ruUpdate).length > 0) {
        await db
          .update(restaurantUsers)
          .set(ruUpdate)
          .where(and(
            eq(restaurantUsers.restaurantId, input.restaurantId),
            eq(restaurantUsers.userId, input.userId),
          ));
      }

      let wageUpdated = false;
      if (c.snapshotWage != null && c.snapshotWageType != null) {
        const [latest] = await db
          .select({
            wageType: employeeWageHistory.wageType,
            wageAmount: employeeWageHistory.wageAmount,
          })
          .from(employeeWageHistory)
          .where(and(
            eq(employeeWageHistory.userId, input.userId),
            eq(employeeWageHistory.restaurantId, input.restaurantId),
          ))
          .orderBy(desc(employeeWageHistory.effectiveFrom))
          .limit(1);

        const needs =
          !latest ||
          latest.wageType !== c.snapshotWageType ||
          Number(latest.wageAmount) !== Number(c.snapshotWage);

        if (needs) {
          const csDate = c.snapshotContractStart
            ? new Date(c.snapshotContractStart as any)
            : new Date();
          const ymFirst = `${csDate.getFullYear()}-${String(csDate.getMonth() + 1).padStart(2, "0")}-01`;
          await db.execute(sql`
            UPDATE employee_wage_history
            SET effectiveTo = ${ymFirst}
            WHERE userId = ${input.userId}
              AND restaurantId = ${input.restaurantId}
              AND effectiveTo IS NULL
              AND effectiveFrom < ${ymFirst}
          `);
          const [existing] = await db
            .select({ id: employeeWageHistory.id })
            .from(employeeWageHistory)
            .where(and(
              eq(employeeWageHistory.userId, input.userId),
              eq(employeeWageHistory.restaurantId, input.restaurantId),
              sql`${employeeWageHistory.effectiveFrom} = ${ymFirst}`,
            ))
            .limit(1);
          if (existing) {
            await db
              .update(employeeWageHistory)
              .set({
                wageType: c.snapshotWageType as any,
                wageAmount: c.snapshotWage,
                sourceContractId: c.id,
              })
              .where(eq(employeeWageHistory.id, existing.id));
          } else {
            await db.insert(employeeWageHistory).values({
              userId: input.userId,
              restaurantId: input.restaurantId,
              wageType: c.snapshotWageType as any,
              wageAmount: c.snapshotWage,
              effectiveFrom: ymFirst,
              effectiveTo: null,
              sourceContractId: c.id,
            } as any);
          }
          await db
            .update(restaurantUsers)
            .set({ contractMigrated: true })
            .where(and(
              eq(restaurantUsers.restaurantId, input.restaurantId),
              eq(restaurantUsers.userId, input.userId),
            ));
          wageUpdated = true;
        }
      }

      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name || ctx.user.username,
        restaurantId: input.restaurantId,
        action: "update",
        target: "staff_apply_contract_snapshot",
        targetId: input.userId,
        details: {
          contractId: c.id,
          fields: Object.keys(ruUpdate),
          wageUpdated,
        },
      });

      return {
        ok: true,
        fields: Object.keys(ruUpdate).length + (wageUpdated ? 1 : 0),
      };
    }),
});
