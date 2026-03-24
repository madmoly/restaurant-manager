import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { randomBytes } from "crypto";
import { router, publicProcedure, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { employmentElectronicContracts, restaurantContracts, restaurants } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export const electronicContractsRouter = router({
  // ═══ 매장 계약 조건 (임대/수수료/로열티 등) ═══

  /** 매장 계약 조건 목록 */
  listRestaurantContracts: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input }) => {
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
    .query(async ({ input }) => {
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

  /** 근로계약서 생성 (초안) */
  createEmploymentContract: managerProcedure
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
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
          status: "draft",
          createdBy: ctx.user.userId,
        })
        .$returningId();
      return { id: result.id, token };
    }),

  /** 계약서 발송 (상태 → sent) */
  sendContract: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const [contract] = await db
        .select({ token: employmentElectronicContracts.token })
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.id, input.id))
        .limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND" });
      await db
        .update(employmentElectronicContracts)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(employmentElectronicContracts.id, input.id));
      return { ok: true, token: contract.token };
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
      return { ok: true };
    }),
});
