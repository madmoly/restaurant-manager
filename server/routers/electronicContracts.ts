import { z } from "zod";
import { eq, and, desc, sql, isNotNull, isNull, ne } from "drizzle-orm";
import { randomBytes } from "crypto";
import { router, publicProcedure, protectedProcedure, managerProcedure, ownerProcedure } from "../trpc";
import { db } from "../db";
import { affiliatedCompanies, employmentElectronicContracts, employeeWageHistory, employerPresets, restaurants, restaurantContracts, restaurantUsers } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { verifyStoreAccess } from "../middleware/storeAuth";
import { getOver5FromCompany } from "../helpers/labor";

const TAX_MODE_VALUES = ["social_insurance", "biz_income_3_3"] as const;

export const electronicContractsRouter = router({
  // ═══ 매장 계약 조건 (임대/수수료/로열티 등) ═══

  /** 매장 계약 조건 목록 */
  listRestaurantContracts: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db
        .select()
        .from(restaurantContracts)
        .where(
          and(
            eq(restaurantContracts.restaurantId, input.restaurantId),
            eq(restaurantContracts.isActive, true),
          ),
        )
        .orderBy(restaurantContracts.name);
    }),

  /** 매장 계약 조건 생성 */
  createRestaurantContract: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        contractType: z.enum(["rent", "commission", "royalty", "investor", "other"]),
        name: z.string().min(1),
        calcType: z.enum(["fixed", "ratio"]).default("fixed"),
        fixedAmount: z.string().optional(),
        ratioPercent: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        note: z.string().optional(),
        autoApplyToFixedCost: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [result] = await db
        .insert(restaurantContracts)
        .values({
          restaurantId: input.restaurantId,
          contractType: input.contractType,
          name: input.name,
          calcType: input.calcType,
          fixedAmount: input.fixedAmount,
          ratioPercent: input.ratioPercent,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          endDate: input.endDate ? new Date(input.endDate) : undefined,
          note: input.note,
          autoApplyToFixedCost: input.autoApplyToFixedCost,
          createdBy: ctx.user.userId,
        })
        .$returningId();
      return { id: result.id };
    }),

  /** 매장 계약 조건 수정 */
  updateRestaurantContract: managerProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        calcType: z.enum(["fixed", "ratio"]).optional(),
        fixedAmount: z.string().optional(),
        ratioPercent: z.string().optional(),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
        note: z.string().nullable().optional(),
        autoApplyToFixedCost: z.boolean().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, startDate, endDate, ...data } = input;
      const updatePayload: Record<string, any> = { ...data };
      if (startDate !== undefined)
        updatePayload.startDate = startDate ? new Date(startDate) : null;
      if (endDate !== undefined)
        updatePayload.endDate = endDate ? new Date(endDate) : null;
      await db.update(restaurantContracts).set(updatePayload).where(eq(restaurantContracts.id, id));
      return { ok: true };
    }),

  // ═══ 전자 근로계약서 ═══

  /** 근로계약서 목록 (퇴사자 resignedAt 포함) */
  listEmploymentContracts: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const rows = await db
        .select({
          contract: employmentElectronicContracts,
          resignedAt: restaurantUsers.resignedAt,
        })
        .from(employmentElectronicContracts)
        .leftJoin(
          restaurantUsers,
          and(
            eq(employmentElectronicContracts.employeeId, restaurantUsers.userId),
            eq(employmentElectronicContracts.restaurantId, restaurantUsers.restaurantId),
          ),
        )
        .where(eq(employmentElectronicContracts.restaurantId, input.restaurantId))
        .orderBy(desc(employmentElectronicContracts.createdAt));
      return rows.map((r) => ({
        ...r.contract,
        resignedAt: r.resignedAt ? String(r.resignedAt) : null,
      }));
    }),

  /** 근로계약서 상세 */
  getEmploymentContract: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [row] = await db
        .select()
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.id, input.id))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "계약서를 찾을 수 없습니다" });
      return row;
    }),

  /** 토큰으로 계약서 조회 (서명 페이지용 — 비로그인 접근 가능) */
  getByToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          contract: employmentElectronicContracts,
          restaurantName: restaurants.name,
        })
        .from(employmentElectronicContracts)
        .leftJoin(restaurants, eq(employmentElectronicContracts.restaurantId, restaurants.id))
        .where(eq(employmentElectronicContracts.token, input.token))
        .limit(1);
      if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "유효하지 않은 링크입니다" });
      const contract = rows[0].contract;

      // 갱신/재계약 자동완성: 아직 미서명(draft/sent) 계약이면, 같은 직원의 과거 서명 계약서에서
      // 주민번호·은행명·계좌번호를 prefill 값으로 반환 (서명 시 직원이 다시 입력할 필요 없음).
      // 주의: 갱신 계약 생성 시 직전 계약은 'signed'→'expired'로 만료되므로 status 조건을 걸지 않고,
      //       서명 이력(signedAt)이 있고 개인정보가 채워진 가장 최근 계약을 찾는다.
      let prefill: { residentNumber: string | null; bankName: string | null; bankAccount: string | null } | null = null;
      if (contract.employeeId && (contract.status === "draft" || contract.status === "sent")) {
        const [prev] = await db
          .select({
            residentNumber: employmentElectronicContracts.employeeResidentNumber,
            bankName: employmentElectronicContracts.bankName,
            bankAccount: employmentElectronicContracts.employeeBankAccount,
          })
          .from(employmentElectronicContracts)
          .where(and(
            eq(employmentElectronicContracts.employeeId, contract.employeeId),
            eq(employmentElectronicContracts.restaurantId, contract.restaurantId),
            ne(employmentElectronicContracts.id, contract.id),
            isNotNull(employmentElectronicContracts.signedAt),
          ))
          .orderBy(desc(employmentElectronicContracts.signedAt))
          .limit(1);
        if (prev && (prev.residentNumber || prev.bankName || prev.bankAccount)) {
          prefill = {
            residentNumber: prev.residentNumber ?? null,
            bankName: prev.bankName ?? null,
            bankAccount: prev.bankAccount ?? null,
          };
        }
      }

      return { ...contract, restaurantName: rows[0].restaurantName, prefill };
    }),

  /** 매장 내 기존 계약서의 소속회사 목록 (중복 제거) */
  listCompanies: managerProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      // 소속회사별 가장 최근 계약서의 사업자등록번호를 함께 반환
      const rows = await db
        .select({
          affiliatedCompany: employmentElectronicContracts.affiliatedCompany,
          employerBusinessNumber: sql<string>`(
            SELECT ec2.employerBusinessNumber
            FROM employment_electronic_contracts ec2
            WHERE ec2.restaurantId = ${input.restaurantId}
              AND ec2.affiliatedCompany = ${employmentElectronicContracts.affiliatedCompany}
              AND ec2.employerBusinessNumber IS NOT NULL
              AND ec2.employerBusinessNumber != ''
            ORDER BY ec2.createdAt DESC
            LIMIT 1
          )`.as("latestBizNumber"),
        })
        .from(employmentElectronicContracts)
        .where(and(
          eq(employmentElectronicContracts.restaurantId, input.restaurantId),
          isNotNull(employmentElectronicContracts.affiliatedCompany),
          ne(employmentElectronicContracts.affiliatedCompany, ""),
        ))
        .groupBy(employmentElectronicContracts.affiliatedCompany);
      return rows
        .filter((r) => r.affiliatedCompany)
        .map((r) => ({ name: r.affiliatedCompany!, businessNumber: r.employerBusinessNumber || "" }));
    }),

  /** 사업주 프리셋 목록 (계약서 사업주 태그) */
  listEmployerPresets: managerProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db
        .select()
        .from(employerPresets)
        .where(eq(employerPresets.restaurantId, input.restaurantId))
        .orderBy(desc(employerPresets.isDefault), employerPresets.companyName);
    }),

  /** 사업주 프리셋 추가 (동일 companyName 존재 시 사업자등록번호만 갱신) */
  addEmployerPreset: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        companyName: z.string().min(1),
        businessNumber: z.string().optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      const [existing] = await db
        .select()
        .from(employerPresets)
        .where(and(
          eq(employerPresets.restaurantId, input.restaurantId),
          eq(employerPresets.companyName, input.companyName),
        ))
        .limit(1);
      if (existing) {
        if (input.businessNumber && existing.businessNumber !== input.businessNumber) {
          await db.update(employerPresets)
            .set({ businessNumber: input.businessNumber })
            .where(eq(employerPresets.id, existing.id));
        }
        return { id: existing.id, ok: true };
      }
      const [result] = await db.insert(employerPresets).values({
        restaurantId: input.restaurantId,
        companyName: input.companyName,
        businessNumber: input.businessNumber || null,
        isDefault: input.isDefault ?? false,
        createdBy: ctx.user.userId,
      });
      return { id: (result as any).insertId as number, ok: true };
    }),

  /** 사업주 프리셋 삭제 */
  deleteEmployerPreset: managerProcedure
    .input(z.object({ restaurantId: z.number(), id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      await db.delete(employerPresets)
        .where(and(
          eq(employerPresets.id, input.id),
          eq(employerPresets.restaurantId, input.restaurantId),
        ));
      return { ok: true };
    }),

  /**
   * 가장 최근 계약서 내용 반환 (새 계약서 작성 / 갱신 시 기본값으로 사용)
   * employeeId 주어지면 해당 직원의 최신 계약서 우선. 없으면 매장 최근 계약서로 폴백.
   */
  getLatestTemplate: managerProcedure
    .input(z.object({ restaurantId: z.number(), employeeId: z.number().optional() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const cols = {
          employeePhone: employmentElectronicContracts.employeePhone,
          contractOffDays: employmentElectronicContracts.contractOffDays,
          contractType: employmentElectronicContracts.contractType,
          wageType: employmentElectronicContracts.wageType,
          wageAmount: employmentElectronicContracts.wageAmount,
          weeklyHours: employmentElectronicContracts.weeklyHours,
          workStartTime: employmentElectronicContracts.workStartTime,
          workEndTime: employmentElectronicContracts.workEndTime,
          breakMinutes: employmentElectronicContracts.breakMinutes,
          payDay: employmentElectronicContracts.payDay,
          payMethod: employmentElectronicContracts.payMethod,
          taxMode: employmentElectronicContracts.taxMode,
          hireDate: employmentElectronicContracts.hireDate,
          hourlyWageIncludesHolidayPay: employmentElectronicContracts.hourlyWageIncludesHolidayPay,
          over5Employees: employmentElectronicContracts.over5Employees,
          hasProbation: employmentElectronicContracts.hasProbation,
          probationMonths: employmentElectronicContracts.probationMonths,
          workPlace: employmentElectronicContracts.workPlace,
          jobDescription: employmentElectronicContracts.jobDescription,
          specialTerms: employmentElectronicContracts.specialTerms,
          affiliatedCompany: employmentElectronicContracts.affiliatedCompany,
          employerBusinessNumber: employmentElectronicContracts.employerBusinessNumber,
          workPlaceAddress: employmentElectronicContracts.workPlaceAddress,
          annualSalary: employmentElectronicContracts.annualSalary,
          basePay: employmentElectronicContracts.basePay,
          fixedOvertimeHours: employmentElectronicContracts.fixedOvertimeHours,
          fixedOvertimePay: employmentElectronicContracts.fixedOvertimePay,
          fixedHolidayHours: employmentElectronicContracts.fixedHolidayHours,
          fixedHolidayPay: employmentElectronicContracts.fixedHolidayPay,
          annualLeavePay: employmentElectronicContracts.annualLeavePay,
          hourlyWage: employmentElectronicContracts.hourlyWage,
          monthlyContractHours: employmentElectronicContracts.monthlyContractHours,
      };

      // 1) employeeId 우선 — 해당 직원의 최신 계약서 (signed/sent/draft 모두 포함)
      if (input.employeeId) {
        const [perEmp] = await db
          .select(cols)
          .from(employmentElectronicContracts)
          .where(and(
            eq(employmentElectronicContracts.restaurantId, input.restaurantId),
            eq(employmentElectronicContracts.employeeId, input.employeeId),
          ))
          .orderBy(desc(employmentElectronicContracts.createdAt))
          .limit(1);
        if (perEmp) return perEmp;
      }

      // 2) 폴백 — 매장의 가장 최근 계약서
      const [latest] = await db
        .select(cols)
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.restaurantId, input.restaurantId))
        .orderBy(desc(employmentElectronicContracts.createdAt))
        .limit(1);
      return latest ?? null;
    }),

  /** 근로계약서 생성 (초안) */
  createEmploymentContract: ownerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        employeeId: z.number().optional(),
        employeeName: z.string().min(1),
        employeePhone: z.string().optional(),
        contractType: z.enum(["permanent", "fixed_term", "part_time", "daily"]).default("part_time"),
        contractStart: z.string(),
        contractEnd: z.string().optional(),
        wageType: z.enum(["hourly", "monthly"]).default("hourly"),
        wageAmount: z.string().refine(
          (s) => { const n = Number(s); return isFinite(n) && n > 0; },
          { message: "임금 금액을 입력하세요 (1원 이상)" },
        ),
        weeklyHours: z.string().default("40"),
        workStartTime: z.string().default("09:00"),
        workEndTime: z.string().default("18:00"),
        breakMinutes: z.number().default(60),
        contractOffDays: z.number().int().min(4).max(15).default(4),
        payDay: z.number().default(20),
        // 4대보험 / 3.3% 사업소득 — 둘 중 하나 필수 (라디오)
        taxMode: z.enum(TAX_MODE_VALUES),
        // 시급제일 때만 의미. 월급제는 무시
        hourlyWageIncludesHolidayPay: z.boolean().default(true),
        // 입사일 (계약서 박제용)
        hireDate: z.string().optional(),
        hasProbation: z.boolean().default(false),
        probationMonths: z.number().default(0),
        payMethod: z.enum(["bank_transfer", "cash"]).default("bank_transfer"),
        workPlace: z.string().optional(),
        jobDescription: z.string().optional(),
        specialTerms: z.string().optional(),
        affiliatedCompany: z.string().optional(),
        employerBusinessNumber: z.string().optional(),
        workPlaceAddress: z.string().optional(),
        // 포괄임금 구성항목
        annualSalary: z.string().optional(),
        basePay: z.string().optional(),
        fixedOvertimeHours: z.string().optional(),
        fixedOvertimePay: z.string().optional(),
        fixedHolidayHours: z.string().optional(),
        fixedHolidayPay: z.string().optional(),
        annualLeavePay: z.string().optional(),
        hourlyWage: z.string().optional(),
        monthlyContractHours: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 매장 접근권 검증
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      // over5Employees 자동 결정 — 소속회사 마스터 매칭 (없으면 false 보수적 기본)
      const over5 = await getOver5FromCompany(input.restaurantId, input.affiliatedCompany);

      // 포괄연차수당 검증 (2026-05-02): 5인 이상 사업장 + 월급제 → annualLeavePay > 0 필수
      // 사업주 운영 정책: 모든 직원 급여를 포괄연차수당으로 지급. 0원 입력 시 본문이
      // "미사용 연차에 대해서는 관련 법령에 따라 수당으로 정산한다"로 출력되어 정책과 충돌.
      if (over5 && input.wageType === "monthly") {
        const alp = Number(input.annualLeavePay ?? 0);
        if (!isFinite(alp) || alp <= 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "5인 이상 사업장의 월급제 계약은 포괄연차수당이 0원일 수 없습니다.",
          });
        }
      }

      // 동일 직원의 기존 활성 계약서 자동 만료 처리 (직원 1명당 1계약)
      if (input.employeeId) {
        await db
          .update(employmentElectronicContracts)
          .set({ status: "expired" })
          .where(and(
            eq(employmentElectronicContracts.restaurantId, input.restaurantId),
            eq(employmentElectronicContracts.employeeId, input.employeeId),
            sql`${employmentElectronicContracts.status} IN ('draft', 'sent', 'signed')`,
          ));
      }

      const token = randomBytes(32).toString("hex");
      const [result] = await db
        .insert(employmentElectronicContracts)
        .values({
          token,
          restaurantId: input.restaurantId,
          employeeId: input.employeeId,
          employeeName: input.employeeName,
          employeePhone: input.employeePhone,
          contractType: input.contractType,
          contractStart: new Date(input.contractStart),
          contractEnd: input.contractEnd ? new Date(input.contractEnd) : undefined,
          wageType: input.wageType,
          wageAmount: input.wageAmount,
          weeklyHours: input.weeklyHours,
          workStartTime: input.workStartTime,
          workEndTime: input.workEndTime,
          breakMinutes: input.breakMinutes,
          // 시급제는 계약휴무일수 미적용 (2026-07-03) — 실근무 기준 정산이라 계약 휴무 개념 없음
          contractOffDays: input.wageType === "hourly" ? null : input.contractOffDays,
          payDay: input.payDay,
          taxMode: input.taxMode,
          hourlyWageIncludesHolidayPay: input.hourlyWageIncludesHolidayPay,
          hireDate: input.hireDate ? new Date(input.hireDate) : null,
          // 소속회사 마스터에서 자동 결정 (폼 입력 X)
          over5Employees: over5,
          hasProbation: input.hasProbation,
          probationMonths: input.probationMonths,
          payMethod: input.payMethod,
          workPlace: input.workPlace,
          jobDescription: input.jobDescription,
          specialTerms: input.specialTerms,
          affiliatedCompany: input.affiliatedCompany,
          employerBusinessNumber: input.employerBusinessNumber,
          workPlaceAddress: input.workPlaceAddress,
          annualSalary: input.annualSalary,
          basePay: input.basePay,
          fixedOvertimeHours: input.fixedOvertimeHours,
          fixedOvertimePay: input.fixedOvertimePay,
          fixedHolidayHours: input.fixedHolidayHours,
          fixedHolidayPay: input.fixedHolidayPay,
          annualLeavePay: input.annualLeavePay,
          hourlyWage: input.hourlyWage,
          monthlyContractHours: input.monthlyContractHours,
          status: "draft",
          createdBy: ctx.user.userId,
        })
        .$returningId();

      // Phase E (2026-05-02 — 사양 §3.7):
      // 계약서 작성 시 운영 SSOT(restaurant_users) 자동 갱신 안 함.
      // 운영 데이터는 점장이 직원 카드에서 직접 수정.
      // 박제와 어긋나면 갱신 필요 배너만 표시 (차단 없음).

      return { id: result.id, token };
    }),

  /** 계약서 수정 (draft / sent 상태 허용 — 서명 전이면 박제값에 반영됨) */
  updateEmploymentContract: ownerProcedure
    .input(
      z.object({
        id: z.number(),
        employeeName: z.string().min(1).optional(),
        employeePhone: z.string().optional(),
        position: z.string().optional(),
        contractType: z.enum(["permanent", "fixed_term", "part_time", "daily"]).optional(),
        contractStart: z.string().optional(),
        contractEnd: z.string().nullable().optional(),
        wageType: z.enum(["hourly", "monthly"]).optional(),
        wageAmount: z.string().refine(
          (s) => { const n = Number(s); return isFinite(n) && n > 0; },
          { message: "임금 금액을 입력하세요 (1원 이상)" },
        ).optional(),
        weeklyHours: z.string().optional(),
        workStartTime: z.string().optional(),
        workEndTime: z.string().optional(),
        breakMinutes: z.number().optional(),
        contractOffDays: z.number().int().min(4).max(15).optional(),
        payDay: z.number().optional(),
        taxMode: z.enum(TAX_MODE_VALUES).optional(),
        hourlyWageIncludesHolidayPay: z.boolean().optional(),
        hireDate: z.string().nullable().optional(),
        payMethod: z.enum(["bank_transfer", "cash"]).optional(),
        workPlace: z.string().optional(),
        jobDescription: z.string().optional(),
        specialTerms: z.string().optional(),
        affiliatedCompany: z.string().optional(),
        employerBusinessNumber: z.string().optional(),
        workPlaceAddress: z.string().optional(),
        annualSalary: z.string().optional(),
        basePay: z.string().optional(),
        annualLeavePay: z.string().optional(),
        hourlyWage: z.string().optional(),
        monthlyContractHours: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      const [contract] = await db
        .select({
          status: employmentElectronicContracts.status,
          restaurantId: employmentElectronicContracts.restaurantId,
          wageType: employmentElectronicContracts.wageType,
          over5Employees: employmentElectronicContracts.over5Employees,
          annualLeavePay: employmentElectronicContracts.annualLeavePay,
        })
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.id, id))
        .limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "계약서를 찾을 수 없습니다" });
      if (contract.status !== "draft" && contract.status !== "sent") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "초안 또는 서명 대기중인 계약서만 수정할 수 있습니다" });
      }
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, contract.restaurantId, true);

      // 시급제 계약은 계약휴무일수 미적용 (2026-07-03): null 고정 — 아래 SSOT 동기화에도 null 반영
      if ((updates.wageType ?? contract.wageType) === "hourly") {
        (updates as any).contractOffDays = null;
      }

      // 날짜 필드 변환
      const setData: any = {};
      for (const [k, v] of Object.entries(updates)) {
        if (v === undefined) continue;
        if (k === "contractStart" && v) setData[k] = new Date(v as string);
        else if (k === "contractEnd") setData[k] = v ? new Date(v as string) : null;
        else if (k === "hireDate") setData[k] = v ? new Date(v as string) : null;
        else setData[k] = v;
      }

      // affiliatedCompany 변경 시 over5Employees도 마스터 매칭으로 자동 갱신
      if (updates.affiliatedCompany !== undefined) {
        setData.over5Employees = await getOver5FromCompany(
          contract.restaurantId,
          updates.affiliatedCompany,
        );
      }

      // 포괄연차수당 검증 (2026-05-02): 업데이트 후 최종 상태 기준
      // 5인 이상 + 월급제 → annualLeavePay > 0 필수 (사업주 운영 정책: 전부 포괄로 지급)
      const finalOver5 = setData.over5Employees !== undefined
        ? Boolean(setData.over5Employees)
        : Boolean(contract.over5Employees);
      const finalWageType = updates.wageType ?? contract.wageType;
      const finalAnnualLeavePay = updates.annualLeavePay !== undefined
        ? updates.annualLeavePay
        : contract.annualLeavePay;
      if (finalOver5 && finalWageType === "monthly") {
        const alp = Number(finalAnnualLeavePay ?? 0);
        if (!isFinite(alp) || alp <= 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "5인 이상 사업장의 월급제 계약은 포괄연차수당이 0원일 수 없습니다.",
          });
        }
      }

      if (Object.keys(setData).length > 0) {
        await db.update(employmentElectronicContracts).set(setData).where(eq(employmentElectronicContracts.id, id));
      }

      // 사용자 요청 2026-05-02: 계약서 수정 시 SSOT(restaurant_users) 자동 동기화
      const [contractAfter] = await db
        .select({
          employeeId: employmentElectronicContracts.employeeId,
          restaurantId: employmentElectronicContracts.restaurantId,
        })
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.id, id))
        .limit(1);
      if (contractAfter?.employeeId) {
        const ruUpdate: Record<string, any> = {};
        if (updates.affiliatedCompany !== undefined) ruUpdate.affiliatedCompany = updates.affiliatedCompany || null;
        if (updates.hireDate) ruUpdate.hireDate = updates.hireDate;
        if (updates.contractOffDays !== undefined) ruUpdate.contractOffDays = updates.contractOffDays;
        if (Object.keys(ruUpdate).length > 0) {
          await db
            .update(restaurantUsers)
            .set(ruUpdate)
            .where(and(
              eq(restaurantUsers.userId, contractAfter.employeeId),
              eq(restaurantUsers.restaurantId, contractAfter.restaurantId),
            ));
        }
      }

      return { ok: true };
    }),

  /** 계약서 발송 (상태 → sent) */
  sendContract: ownerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [contract] = await db
        .select({ token: employmentElectronicContracts.token, restaurantId: employmentElectronicContracts.restaurantId })
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.id, input.id))
        .limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND" });
      // 매장 접근권 검증
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, contract.restaurantId, true);
      await db
        .update(employmentElectronicContracts)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(employmentElectronicContracts.id, input.id));
      return { ok: true, token: contract.token };
    }),

  /** 계약서 삭제 (초안/만료/퇴사자 계약서) */
  deleteContract: ownerProcedure
    .input(z.object({ id: z.number(), force: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [contract] = await db
        .select({
          status: employmentElectronicContracts.status,
          restaurantId: employmentElectronicContracts.restaurantId,
          employeeId: employmentElectronicContracts.employeeId,
        })
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.id, input.id))
        .limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND" });
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, contract.restaurantId, true);

      // 퇴사자 계약서는 force=true로 모든 상태 삭제 가능
      if (input.force && contract.employeeId) {
        const [ru] = await db
          .select({ resignedAt: restaurantUsers.resignedAt })
          .from(restaurantUsers)
          .where(and(
            eq(restaurantUsers.userId, contract.employeeId),
            eq(restaurantUsers.restaurantId, contract.restaurantId),
          ))
          .limit(1);
        if (ru?.resignedAt) {
          // 퇴사자 → 삭제 허용
          await db.delete(employmentElectronicContracts).where(eq(employmentElectronicContracts.id, input.id));
          return { ok: true };
        }
      }

      // 일반 삭제: draft/expired만 허용
      if (contract.status !== "draft" && contract.status !== "expired") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "초안 또는 만료된 계약서만 삭제할 수 있습니다" });
      }
      await db
        .delete(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.id, input.id));
      return { ok: true };
    }),

  /** 사업주(소속회사) 목록에서 제거 — 해당 회사의 모든 계약서 affiliatedCompany를 비움 */
  removeCompany: ownerProcedure
    .input(z.object({ restaurantId: z.number(), companyName: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      await db.update(employmentElectronicContracts)
        .set({ affiliatedCompany: "" })
        .where(and(
          eq(employmentElectronicContracts.restaurantId, input.restaurantId),
          eq(employmentElectronicContracts.affiliatedCompany, input.companyName),
        ));
      return { ok: true };
    }),

  /** 계약서 서명 (상태 → signed, 비로그인 접근 가능)
   *
   * 재설계 2026-05-02: SSOT 역전 — 계약서는 박제만, 운영 데이터(users/restaurant_users/employee_contracts)는 SSOT 직접 수정.
   *
   * 트랜잭션으로 다음을 한 번에 처리:
   *  1) 계약서 status='signed' + signedAt + employeeSignature + 스냅샷 박제 (snapshotName ~ snapshotTaxMode)
   *  2) 같은 (employeeId, restaurantId)의 이전 active 계약서(signed/sent/draft) → status='superseded'
   *  3) employee_wage_history 신규 row INSERT (Phase 2 단일 경로 — 인건비 정산용 급여 단가)
   *  4) restaurant_users.contractMigrated = true (Phase 2 전환 플래그)
   *
   * 폐기됨 (단방향 sync):
   *  - users.name/phone/address 자동 갱신
   *  - restaurant_users.affiliatedCompany 자동 갱신
   *  - employee_contracts INSERT
   *  → SSOT(직원정보)는 점장이 직접 수정. 어긋나면 "갱신 필요" 배너만 표시.
   */
  signContract: publicProcedure
    .input(
      z.object({
        token: z.string(),
        signature: z.string(), // base64 서명 이미지
        bankName: z.string().optional(), // 은행명 (직원 입력)
        bankAccount: z.string().optional(), // 계좌번호만 (직원 입력)
        residentNumber: z.string().optional(), // 주민번호 (직원 입력)
        employeeName: z.string().optional(),
        employeePhone: z.string().optional(),
        employeeAddress: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const [contract] = await db
        .select()
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.token, input.token))
        .limit(1);
      if (!contract)
        throw new TRPCError({ code: "NOT_FOUND", message: "유효하지 않은 링크입니다" });
      if (contract.status === "signed")
        throw new TRPCError({ code: "BAD_REQUEST", message: "이미 서명된 계약서입니다" });

      // 최종값: 직원이 서명 시 입력한 값 > 계약서 본문 값
      const finalName = input.employeeName ?? contract.employeeName;
      const finalPhone = input.employeePhone ?? contract.employeePhone ?? null;
      const finalAddress = input.employeeAddress ?? contract.employeeAddress ?? null;
      const finalBankName = input.bankName ?? null;
      const finalBankAccount = input.bankAccount ?? null;
      const finalResidentNumber = input.residentNumber ?? null;
      const finalAffiliatedCompany = contract.affiliatedCompany ?? null;

      // DATE 컬럼용 'YYYY-MM-DD' 문자열 변환 — select 결과가 Date 객체든 문자열이든 MySQL이 수용 가능한 포맷으로 정규화
      const toDateString = (d: unknown): string | null => {
        if (!d) return null;
        const date = d instanceof Date ? d : new Date(d as string);
        return Number.isNaN(date.getTime()) ? null : date.toISOString().substring(0, 10);
      };

      try {
        await db.transaction(async (tx) => {
          // ── 1. 현재 계약서 서명 처리 + 스냅샷 박제 ──
          await tx.update(employmentElectronicContracts)
            .set({
              status: "signed",
              signedAt: new Date(),
              employeeSignature: input.signature,
              bankName: finalBankName,
              employeeBankAccount: finalBankAccount,
              employeeResidentNumber: finalResidentNumber,
              // 서명 시점 스냅샷
              snapshotName: finalName,
              snapshotPhone: finalPhone,
              snapshotAddress: finalAddress,
              snapshotResidentNumber: finalResidentNumber,
              snapshotBankName: finalBankName,
              snapshotBankAccount: finalBankAccount,
              snapshotWage: contract.wageAmount ?? null,
              snapshotWageType: contract.wageType ?? null,
              snapshotWeeklyHours: contract.weeklyHours ?? null,
              snapshotWeeklyOffDays: contract.weeklyOffDays ?? 1,
              snapshotContractOffDays: contract.wageType === "hourly" ? null : (contract.contractOffDays ?? 4),
              snapshotContractStart: toDateString(contract.contractStart),
              snapshotContractEnd: toDateString(contract.contractEnd),
              snapshotAffiliatedCompany: finalAffiliatedCompany,
              // 재설계 2026-05-02 신규 박제
              snapshotHireDate: toDateString(contract.hireDate),
              snapshotOver5Employees: contract.over5Employees ?? false,
              snapshotTaxMode: contract.taxMode ?? "social_insurance",
              // Phase E 박제 (2026-05-02 폐기 3건 제외: snapshotPosition·snapshotWeeklyHoliday·snapshotNightShiftConsent)
              snapshotContractType: contract.contractType ?? null,
              snapshotWorkStartTime: contract.workStartTime ?? null,
              snapshotWorkEndTime: contract.workEndTime ?? null,
              snapshotBreakMinutes: contract.breakMinutes ?? null,
              snapshotSpecialTerms: contract.specialTerms ?? null,
              snapshotHourlyWageIncludesHolidayPay:
                contract.hourlyWageIncludesHolidayPay ?? null,
            } as any)
            .where(eq(employmentElectronicContracts.id, contract.id));

          // ── 2. 이전 active 계약서 supersede ──
          //   Phase E (2026-05-02): 운영 SSOT(restaurant_users) 자동 갱신 제거.
          //   사양 §3.7: 박제 후 운영 데이터는 점장이 직원 카드에서 직접 수정.
          //   wage_history는 첫 서명 시 한 번만 백필 (없으면 정산 불가). 이미 있으면 INSERT 안 함.
          if (contract.employeeId && contract.restaurantId) {
            await tx.update(employmentElectronicContracts)
              .set({ status: "superseded" })
              .where(and(
                eq(employmentElectronicContracts.employeeId, contract.employeeId),
                eq(employmentElectronicContracts.restaurantId, contract.restaurantId),
                ne(employmentElectronicContracts.id, contract.id),
                sql`${employmentElectronicContracts.status} IN ('draft','sent','signed')`,
              ));

            // wage_history 백필: 직원 카드(updateWage)에서 이미 입력했으면 그것 우선.
            //   여기서는 row 부재 시에만 contractStart 월 1일 기준으로 1회 INSERT.
            const [wageRow] = await tx
              .select({ id: employeeWageHistory.id })
              .from(employeeWageHistory)
              .where(and(
                eq(employeeWageHistory.userId, contract.employeeId),
                eq(employeeWageHistory.restaurantId, contract.restaurantId),
              ))
              .limit(1);

            if (!wageRow) {
              const csDate = contract.contractStart
                ? (contract.contractStart instanceof Date
                    ? contract.contractStart
                    : new Date(contract.contractStart as any))
                : new Date();
              const ymFirst = `${csDate.getFullYear()}-${String(csDate.getMonth() + 1).padStart(2, "0")}-01`;
              await tx.insert(employeeWageHistory).values({
                userId: contract.employeeId,
                restaurantId: contract.restaurantId,
                wageType: (contract.wageType as "hourly" | "monthly") ?? "hourly",
                wageAmount: contract.wageAmount ?? "0",
                effectiveFrom: ymFirst,
                effectiveTo: null,
                sourceContractId: contract.id,
              } as any);
              await tx
                .update(restaurantUsers)
                .set({ contractMigrated: true })
                .where(and(
                  eq(restaurantUsers.userId, contract.employeeId),
                  eq(restaurantUsers.restaurantId, contract.restaurantId),
                ));
            }
          }
        });
        console.log(`[signContract] tx complete for contract ${contract.id}`);
      } catch (e: any) {
        console.error(`[signContract] transaction failed:`, e.message);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "서명 처리 중 오류가 발생했습니다: " + e.message,
        });
      }

      return { ok: true };
    }),
});
