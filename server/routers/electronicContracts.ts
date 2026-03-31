import { z } from "zod";
import { eq, and, desc, sql, isNotNull, ne } from "drizzle-orm";
import { randomBytes } from "crypto";
import { router, publicProcedure, protectedProcedure, managerProcedure, ownerProcedure } from "../trpc";
import { db } from "../db";
import { employmentElectronicContracts, employeeContracts, restaurantContracts, restaurants } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { verifyStoreAccess } from "../middleware/storeAuth";

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

  /** 근로계약서 목록 */
  listEmploymentContracts: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db
        .select()
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.restaurantId, input.restaurantId))
        .orderBy(desc(employmentElectronicContracts.createdAt));
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
      return { ...rows[0].contract, restaurantName: rows[0].restaurantName };
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

  /** 매장의 가장 최근 계약서 내용 반환 (새 계약서 작성 시 기본값으로 사용) */
  getLatestTemplate: managerProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const [latest] = await db
        .select({
          position: employmentElectronicContracts.position,
          contractType: employmentElectronicContracts.contractType,
          wageType: employmentElectronicContracts.wageType,
          wageAmount: employmentElectronicContracts.wageAmount,
          weeklyHours: employmentElectronicContracts.weeklyHours,
          workStartTime: employmentElectronicContracts.workStartTime,
          workEndTime: employmentElectronicContracts.workEndTime,
          breakMinutes: employmentElectronicContracts.breakMinutes,
          weeklyHoliday: employmentElectronicContracts.weeklyHoliday,
          payDay: employmentElectronicContracts.payDay,
          payMethod: employmentElectronicContracts.payMethod,
          socialInsurance: employmentElectronicContracts.socialInsurance,
          over5Employees: employmentElectronicContracts.over5Employees,
          hasProbation: employmentElectronicContracts.hasProbation,
          probationMonths: employmentElectronicContracts.probationMonths,
          mealProvided: employmentElectronicContracts.mealProvided,
          mealAllowance: employmentElectronicContracts.mealAllowance,
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
          includeNda: employmentElectronicContracts.includeNda,
          includePrivacyConsent: employmentElectronicContracts.includePrivacyConsent,
        })
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
        position: z.string().default("직원"),
        contractType: z.enum(["permanent", "fixed_term", "part_time", "daily"]).default("part_time"),
        contractStart: z.string(),
        contractEnd: z.string().optional(),
        wageType: z.enum(["hourly", "monthly"]).default("hourly"),
        wageAmount: z.string(),
        weeklyHours: z.string().default("40"),
        workStartTime: z.string().default("09:00"),
        workEndTime: z.string().default("18:00"),
        breakMinutes: z.number().default(60),
        weeklyHoliday: z.string().default("일요일"),
        payDay: z.number().default(25),
        socialInsurance: z.boolean().default(true),
        over5Employees: z.boolean().default(false),
        hasProbation: z.boolean().default(false),
        probationMonths: z.number().default(0),
        mealProvided: z.boolean().default(false),
        mealAllowance: z.string().optional(),
        nightShiftConsent: z.boolean().default(false),
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
        includeNda: z.boolean().optional(),
        includePrivacyConsent: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 매장 접근권 검증
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

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
          position: input.position,
          contractType: input.contractType,
          contractStart: new Date(input.contractStart),
          contractEnd: input.contractEnd ? new Date(input.contractEnd) : undefined,
          wageType: input.wageType,
          wageAmount: input.wageAmount,
          weeklyHours: input.weeklyHours,
          workStartTime: input.workStartTime,
          workEndTime: input.workEndTime,
          breakMinutes: input.breakMinutes,
          weeklyHoliday: input.weeklyHoliday,
          payDay: input.payDay,
          socialInsurance: input.socialInsurance,
          over5Employees: input.over5Employees,
          hasProbation: input.hasProbation,
          probationMonths: input.probationMonths,
          mealProvided: input.mealProvided,
          mealAllowance: input.mealAllowance,
          nightShiftConsent: input.nightShiftConsent,
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
          includeNda: input.includeNda ?? false,
          includePrivacyConsent: input.includePrivacyConsent ?? false,
          status: "draft",
          createdBy: ctx.user.userId,
        })
        .$returningId();
      return { id: result.id, token };
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

  /** 초안 계약서 삭제 (draft 상태만) */
  deleteContract: ownerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [contract] = await db
        .select({
          status: employmentElectronicContracts.status,
          restaurantId: employmentElectronicContracts.restaurantId,
        })
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.id, input.id))
        .limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND" });
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, contract.restaurantId, true);
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

  /** 계약서 서명 (상태 → signed, 비로그인 접근 가능) */
  signContract: publicProcedure
    .input(
      z.object({
        token: z.string(),
        signature: z.string(), // base64 서명 이미지
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

      await db
        .update(employmentElectronicContracts)
        .set({
          status: "signed",
          signedAt: new Date(),
          employeeSignature: input.signature,
        })
        .where(eq(employmentElectronicContracts.id, contract.id));

      // ── 서명 완료 시 employeeContracts 자동 동기화 (upsert) ──
      if (contract.employeeId && contract.restaurantId) {
        try {
          // 기존 활성 계약 비활성화
          await db.update(employeeContracts)
            .set({ isActive: false })
            .where(and(
              eq(employeeContracts.userId, contract.employeeId),
              eq(employeeContracts.restaurantId, contract.restaurantId),
              eq(employeeContracts.isActive, true),
            ));
          // 새 계약 정보 삽입
          await db.insert(employeeContracts).values({
            userId: contract.employeeId,
            restaurantId: contract.restaurantId,
            wageType: (contract.wageType as "hourly" | "monthly") ?? "hourly",
            wageAmount: contract.wageAmount ?? "0",
            position: contract.position ?? null,
            contractStart: contract.contractStart ? new Date(contract.contractStart) : null,
            contractEnd: contract.contractEnd ? new Date(contract.contractEnd) : null,
            weeklyHours: contract.weeklyHours ?? null,
            weeklyOffDays: 1,
            isActive: true,
          } as any);
          console.log(`[signContract] synced employeeContracts for userId=${contract.employeeId} restaurantId=${contract.restaurantId}`);
        } catch (e: any) {
          console.error(`[signContract] employeeContracts sync error:`, e.message);
          // 동기화 실패해도 서명 자체는 성공으로 처리
        }
      }

      return { ok: true };
    }),
});
