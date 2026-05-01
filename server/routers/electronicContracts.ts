import { z } from "zod";
import { eq, and, desc, sql, isNotNull, isNull, ne } from "drizzle-orm";
import { randomBytes } from "crypto";
import { router, publicProcedure, protectedProcedure, managerProcedure, ownerProcedure } from "../trpc";
import { db } from "../db";
import { employmentElectronicContracts, employeeContracts, employeeWageHistory, restaurantContracts, restaurants, restaurantUsers, users } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { verifyStoreAccess } from "../middleware/storeAuth";

function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/[^0-9]/g, "");
}

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
          noWeeklyHolidayPay: employmentElectronicContracts.noWeeklyHolidayPay,
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
        noWeeklyHolidayPay: z.boolean().default(false),
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
          noWeeklyHolidayPay: input.noWeeklyHolidayPay,
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

      // ── 초안 생성 시 employee_contracts에 비활성 레코드 생성 (인건비 정산 반영용) ──
      if (input.employeeId) {
        try {
          // 기존 비활성(초안) 계약 정리: 같은 직원의 기존 비활성 레코드 삭제 후 재생성
          await db.delete(employeeContracts).where(and(
            eq(employeeContracts.userId, input.employeeId),
            eq(employeeContracts.restaurantId, input.restaurantId),
            eq(employeeContracts.isActive, false),
          ));
          await db.insert(employeeContracts).values({
            userId: input.employeeId,
            restaurantId: input.restaurantId,
            wageType: input.wageType,
            wageAmount: input.wageAmount,
            position: input.position ?? null,
            contractStart: input.contractStart ? new Date(input.contractStart) : null,
            contractEnd: input.contractEnd ? new Date(input.contractEnd) : null,
            weeklyHours: input.weeklyHours ?? null,
            weeklyOffDays: 1,
            socialInsurance: input.socialInsurance ?? true,
            noWeeklyHolidayPay: input.noWeeklyHolidayPay ?? false,
            isActive: false, // 초안 상태 → 서명 완료 시 active로 전환
          } as any);
          console.log(`[createContract] draft employee_contracts created for userId=${input.employeeId}`);
        } catch (e: any) {
          console.error(`[createContract] employee_contracts draft sync error:`, e.message);
        }
      }

      return { id: result.id, token };
    }),

  /** 초안 계약서 수정 (draft 상태만) */
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
        wageAmount: z.string().optional(),
        weeklyHours: z.string().optional(),
        workStartTime: z.string().optional(),
        workEndTime: z.string().optional(),
        breakMinutes: z.number().optional(),
        weeklyHoliday: z.string().optional(),
        payDay: z.number().optional(),
        socialInsurance: z.boolean().optional(),
        noWeeklyHolidayPay: z.boolean().optional(),
        over5Employees: z.boolean().optional(),
        mealProvided: z.boolean().optional(),
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
        includeNda: z.boolean().optional(),
        includePrivacyConsent: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      const [contract] = await db
        .select({ status: employmentElectronicContracts.status, restaurantId: employmentElectronicContracts.restaurantId })
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.id, id))
        .limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "계약서를 찾을 수 없습니다" });
      if (contract.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "초안 상태에서만 수정할 수 있습니다" });
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, contract.restaurantId, true);

      // 날짜 필드 변환
      const setData: any = {};
      for (const [k, v] of Object.entries(updates)) {
        if (v === undefined) continue;
        if (k === "contractStart" && v) setData[k] = new Date(v as string);
        else if (k === "contractEnd") setData[k] = v ? new Date(v as string) : null;
        else setData[k] = v;
      }
      if (Object.keys(setData).length > 0) {
        await db.update(employmentElectronicContracts).set(setData).where(eq(employmentElectronicContracts.id, id));
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
   * 트랜잭션으로 다음을 한 번에 처리:
   *  1) 계약서 status='signed' + signedAt + employeeSignature + 12개 snapshot 필드 박제
   *  2) 같은 (employeeId, restaurantId)의 이전 active 계약서(signed/sent/draft) → status='superseded'
   *  3) C군 필드를 적재 대상 테이블로 분배:
   *     - users: name, phone, phoneNormalized, address, (email은 제외)
   *     - restaurant_users: affiliatedCompany, hireDate, weeklyOffDays
   *     - employee_contracts: 기존 active 비활성화 + 새 active INSERT
   *       (wage/wageType/weeklyHours + bankAccount + residentNumber + weeklyOffDays 포함)
   */
  signContract: publicProcedure
    .input(
      z.object({
        token: z.string(),
        signature: z.string(), // base64 서명 이미지
        bankAccount: z.string().optional(), // 계좌번호 (직원 입력)
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
              employeeBankAccount: finalBankAccount,
              employeeResidentNumber: finalResidentNumber,
              // 서명 시점 스냅샷
              snapshotName: finalName,
              snapshotPhone: finalPhone,
              snapshotAddress: finalAddress,
              snapshotResidentNumber: finalResidentNumber,
              snapshotBankAccount: finalBankAccount,
              snapshotWage: contract.wageAmount ?? null,
              snapshotWageType: contract.wageType ?? null,
              snapshotWeeklyHours: contract.weeklyHours ?? null,
              snapshotWeeklyOffDays: contract.weeklyOffDays ?? 1,
              snapshotContractStart: toDateString(contract.contractStart),
              snapshotContractEnd: toDateString(contract.contractEnd),
              snapshotAffiliatedCompany: finalAffiliatedCompany,
            } as any)
            .where(eq(employmentElectronicContracts.id, contract.id));

          // ── 2. 이전 active 계약서 supersede ──
          if (contract.employeeId && contract.restaurantId) {
            await tx.update(employmentElectronicContracts)
              .set({ status: "superseded" })
              .where(and(
                eq(employmentElectronicContracts.employeeId, contract.employeeId),
                eq(employmentElectronicContracts.restaurantId, contract.restaurantId),
                ne(employmentElectronicContracts.id, contract.id),
                sql`${employmentElectronicContracts.status} IN ('draft','sent','signed')`,
              ));

            // ── 3. C군 단방향 sync ──

            // 3-1. users (name / phone / phoneNormalized / address)
            const usersUpdate: Record<string, any> = {};
            if (finalName) usersUpdate.name = finalName;
            if (finalPhone) {
              usersUpdate.phone = finalPhone;
              usersUpdate.phoneNormalized = normalizePhone(finalPhone);
            }
            if (finalAddress) usersUpdate.address = finalAddress;
            if (Object.keys(usersUpdate).length > 0) {
              await tx.update(users).set(usersUpdate).where(eq(users.id, contract.employeeId));
            }

            // 3-2. restaurant_users (affiliatedCompany — hireDate는 기존 유지)
            const ruUpdate: Record<string, any> = {};
            if (finalAffiliatedCompany !== null) ruUpdate.affiliatedCompany = finalAffiliatedCompany;
            if (Object.keys(ruUpdate).length > 0) {
              await tx.update(restaurantUsers)
                .set(ruUpdate)
                .where(and(
                  eq(restaurantUsers.userId, contract.employeeId),
                  eq(restaurantUsers.restaurantId, contract.restaurantId),
                ));
            }

            // 3-3. employee_contracts (민감영역 현재상태)
            //      기존 active 비활성 → 새 active INSERT
            await tx.update(employeeContracts)
              .set({ isActive: false })
              .where(and(
                eq(employeeContracts.userId, contract.employeeId),
                eq(employeeContracts.restaurantId, contract.restaurantId),
                eq(employeeContracts.isActive, true),
              ));

            await tx.insert(employeeContracts).values({
              userId: contract.employeeId,
              restaurantId: contract.restaurantId,
              wageType: (contract.wageType as "hourly" | "monthly") ?? "hourly",
              wageAmount: contract.wageAmount ?? "0",
              position: contract.position ?? null,
              contractStart: contract.contractStart ? new Date(contract.contractStart) : null,
              contractEnd: contract.contractEnd ? new Date(contract.contractEnd) : null,
              weeklyHours: contract.weeklyHours ?? null,
              weeklyOffDays: contract.weeklyOffDays ?? 1,
              socialInsurance: contract.socialInsurance ?? true,
              noWeeklyHolidayPay: contract.noWeeklyHolidayPay ?? false,
              bankAccount: finalBankAccount,
              residentNumber: finalResidentNumber,
              isActive: true,
            } as any);

            // ── 4. employee_wage_history (Phase 2 — 급여이력 단일 경로) ──
            // 신 계약서 contractStart의 월 1일을 effectiveFrom 으로 사용.
            // 월 중 시작이어도 해당 월 1일로 잘라 저장 → 전월 급여 소급 효과 (의도된 동작).
            const csDate = contract.contractStart
              ? (contract.contractStart instanceof Date
                  ? contract.contractStart
                  : new Date(contract.contractStart as any))
              : new Date();
            const ymFirst = `${csDate.getFullYear()}-${String(csDate.getMonth() + 1).padStart(2, "0")}-01`;

            // 4-1. 기존 open row 닫기 (effectiveTo = 신 계약 시작 월 1일)
            await tx.update(employeeWageHistory)
              .set({ effectiveTo: ymFirst })
              .where(and(
                eq(employeeWageHistory.userId, contract.employeeId),
                eq(employeeWageHistory.restaurantId, contract.restaurantId),
                isNull(employeeWageHistory.effectiveTo),
              ));

            // 4-2. 신 row 생성 — 같은 월 재서명 시 (uniq 충돌) update로 갱신
            await tx.insert(employeeWageHistory).values({
              userId: contract.employeeId,
              restaurantId: contract.restaurantId,
              wageType: (contract.wageType as "hourly" | "monthly") ?? "hourly",
              wageAmount: contract.wageAmount ?? "0",
              effectiveFrom: ymFirst,
              effectiveTo: null,
              sourceContractId: contract.id,
            } as any).onDuplicateKeyUpdate({
              set: {
                wageType: (contract.wageType as "hourly" | "monthly") ?? "hourly",
                wageAmount: contract.wageAmount ?? "0",
                sourceContractId: contract.id,
                effectiveTo: null,
              },
            });

            // 4-3. restaurant_users.contractMigrated = true (Phase 2 전환 플래그)
            await tx.update(restaurantUsers)
              .set({ contractMigrated: true } as any)
              .where(and(
                eq(restaurantUsers.userId, contract.employeeId),
                eq(restaurantUsers.restaurantId, contract.restaurantId),
              ));
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
