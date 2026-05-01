/**
 * 소속회사(affiliated_companies) 마스터 라우터.
 *
 * 사양: docs/redesign_2026-05-02_계약_직원_인건비.md §3.1, §5.1
 *
 * - 매장당 여러 소속회사 등록 가능 (UNIQUE: restaurantId + companyName)
 * - 회사별로 5인 미만/이상 토글 (over5Employees) — 계약서 작성 시 자동 박제
 * - 권한: 조회/생성/수정/삭제 모두 manager 이상
 * - employer_presets와 분리 운영. employer_presets는 장기적으로 deprecated.
 */

import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, managerProcedure } from "../trpc";
import { db } from "../db";
import { affiliatedCompanies, restaurantUsers } from "../../drizzle/schema";
import { verifyStoreAccess } from "../middleware/storeAuth";

export const affiliatedCompaniesRouter = router({
  /** 매장의 소속회사 목록 */
  list: managerProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db
        .select()
        .from(affiliatedCompanies)
        .where(eq(affiliatedCompanies.restaurantId, input.restaurantId))
        .orderBy(asc(affiliatedCompanies.companyName));
    }),

  /** 소속회사 추가 */
  create: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      companyName: z.string().trim().min(1, "회사명을 입력하세요").max(100),
      businessNumber: z.string().trim().max(20).optional().nullable(),
      over5Employees: z.boolean().default(false),
      isDefault: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      const [existing] = await db
        .select({ id: affiliatedCompanies.id })
        .from(affiliatedCompanies)
        .where(and(
          eq(affiliatedCompanies.restaurantId, input.restaurantId),
          eq(affiliatedCompanies.companyName, input.companyName),
        ))
        .limit(1);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "동일한 회사명이 이미 등록되어 있습니다" });
      }

      const [r] = await db.insert(affiliatedCompanies).values({
        restaurantId: input.restaurantId,
        companyName: input.companyName,
        businessNumber: input.businessNumber ?? null,
        over5Employees: input.over5Employees,
        isDefault: input.isDefault,
        createdBy: ctx.user.userId,
      });

      return { id: (r as any).insertId as number };
    }),

  /** 소속회사 수정 (회사명 변경 시 직원 SSOT도 함께 갱신) */
  update: managerProcedure
    .input(z.object({
      id: z.number(),
      restaurantId: z.number(),
      companyName: z.string().trim().min(1).max(100).optional(),
      businessNumber: z.string().trim().max(20).nullable().optional(),
      over5Employees: z.boolean().optional(),
      isDefault: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      const [target] = await db
        .select()
        .from(affiliatedCompanies)
        .where(and(
          eq(affiliatedCompanies.id, input.id),
          eq(affiliatedCompanies.restaurantId, input.restaurantId),
        ))
        .limit(1);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "소속회사를 찾을 수 없습니다" });
      }

      const renameTo =
        input.companyName && input.companyName !== target.companyName
          ? input.companyName
          : null;

      if (renameTo) {
        const [dup] = await db
          .select({ id: affiliatedCompanies.id })
          .from(affiliatedCompanies)
          .where(and(
            eq(affiliatedCompanies.restaurantId, input.restaurantId),
            eq(affiliatedCompanies.companyName, renameTo),
          ))
          .limit(1);
        if (dup) {
          throw new TRPCError({ code: "CONFLICT", message: "동일한 회사명이 이미 등록되어 있습니다" });
        }
      }

      const updates: Record<string, any> = {};
      if (input.companyName !== undefined) updates.companyName = input.companyName;
      if (input.businessNumber !== undefined) updates.businessNumber = input.businessNumber;
      if (input.over5Employees !== undefined) updates.over5Employees = input.over5Employees;
      if (input.isDefault !== undefined) updates.isDefault = input.isDefault;

      if (Object.keys(updates).length > 0) {
        await db.update(affiliatedCompanies).set(updates).where(eq(affiliatedCompanies.id, input.id));
      }

      // 회사명 변경 시 SSOT(restaurant_users.affiliatedCompany)도 일괄 갱신
      if (renameTo) {
        await db
          .update(restaurantUsers)
          .set({ affiliatedCompany: renameTo })
          .where(and(
            eq(restaurantUsers.restaurantId, input.restaurantId),
            eq(restaurantUsers.affiliatedCompany, target.companyName),
          ));
      }

      return { ok: true };
    }),

  /** 소속회사 삭제 (해당 회사 소속 직원이 있으면 차단) */
  delete: managerProcedure
    .input(z.object({ id: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      const [target] = await db
        .select()
        .from(affiliatedCompanies)
        .where(and(
          eq(affiliatedCompanies.id, input.id),
          eq(affiliatedCompanies.restaurantId, input.restaurantId),
        ))
        .limit(1);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "소속회사를 찾을 수 없습니다" });
      }

      const inUse = await db
        .select({ id: restaurantUsers.id })
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.affiliatedCompany, target.companyName),
        ))
        .limit(1);
      if (inUse.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "해당 회사를 소속으로 둔 직원이 있습니다. 직원 소속회사를 먼저 변경하세요.",
        });
      }

      await db.delete(affiliatedCompanies).where(eq(affiliatedCompanies.id, input.id));
      return { ok: true };
    }),
});
