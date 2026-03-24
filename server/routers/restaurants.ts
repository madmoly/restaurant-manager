import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { router, protectedProcedure, adminProcedure } from "../trpc";
import { db } from "../db";
import { restaurants, restaurantUsers, users } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export const restaurantsRouter = router({
  /** 전체 매장 목록 (master/admin: 전체) */
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.select().from(restaurants).where(eq(restaurants.isActive, true));
  }),

  /** 내 매장 + 역할 (admin 미만) */
  listMine: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({ restaurant: restaurants, storeRole: restaurantUsers.role })
      .from(restaurantUsers)
      .innerJoin(restaurants, eq(restaurants.id, restaurantUsers.restaurantId))
      .where(and(eq(restaurantUsers.userId, ctx.user.userId), eq(restaurants.isActive, true)));
  }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [r] = await db.select().from(restaurants).where(eq(restaurants.id, input.id)).limit(1);
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "매장을 찾을 수 없습니다" });
      return r;
    }),

  /** 매장 내 나의 역할 조회 */
  getMyStoreRole: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      const [ru] = await db
        .select()
        .from(restaurantUsers)
        .where(and(eq(restaurantUsers.restaurantId, input.restaurantId), eq(restaurantUsers.userId, ctx.user.userId)))
        .limit(1);
      return { storeRole: ru?.role ?? null, systemRole: ctx.user.role };
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      address: z.string().optional(),
      phone: z.string().optional(),
      openTime: z.string().optional(),
      closeTime: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [result] = await db.insert(restaurants).values(input).$returningId();
      return { id: result.id };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      address: z.string().optional(),
      phone: z.string().optional(),
      monthlyTargetSales: z.string().optional(),
      targetLaborRatio: z.string().optional(),
      targetCostRatio: z.string().optional(),
      openTime: z.string().optional(),
      closeTime: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(restaurants).set(data).where(eq(restaurants.id, id));
      return { ok: true };
    }),

  /** 매장 직원 목록 */
  getStaff: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input }) => {
      return db
        .select({
          id: restaurantUsers.id,
          userId: users.id,
          username: users.username,
          name: users.name,
          phone: users.phone,
          storeRole: restaurantUsers.role,
          healthCertUrl: users.healthCertUrl,
          healthCertExpiry: users.healthCertExpiry,
          affiliatedCompany: restaurantUsers.affiliatedCompany,
          createdAt: restaurantUsers.createdAt,
        })
        .from(restaurantUsers)
        .innerJoin(users, eq(users.id, restaurantUsers.userId))
        .where(eq(restaurantUsers.restaurantId, input.restaurantId));
    }),

  /** 직원 매장 배정 */
  addStaff: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      userId: z.number(),
      role: z.enum(["store_manager", "manager", "employee"]).default("employee"),
    }))
    .mutation(async ({ input }) => {
      await db.insert(restaurantUsers).values(input).onDuplicateKeyUpdate({
        set: { role: input.role },
      });
      return { ok: true };
    }),

  /** 직원 소속회사 변경 */
  updateStaffCompany: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      userId: z.number(),
      affiliatedCompany: z.string().nullable(),
    }))
    .mutation(async ({ input }) => {
      await db
        .update(restaurantUsers)
        .set({ affiliatedCompany: input.affiliatedCompany })
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId)
        ));
      return { ok: true };
    }),

  /** 직원 역할 변경 (승격/강등) — admin/master만 가능 */
  updateStaffRole: adminProcedure
    .input(z.object({
      restaurantId: z.number(),
      userId: z.number(),
      role: z.enum(["store_manager", "manager", "employee"]),
    }))
    .mutation(async ({ input }) => {
      await db
        .update(restaurantUsers)
        .set({ role: input.role })
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId)
        ));
      return { ok: true };
    }),

  /** 직원 매장에서 제거 */
  removeStaff: protectedProcedure
    .input(z.object({ restaurantId: z.number(), userId: z.number() }))
    .mutation(async ({ input }) => {
      await db
        .delete(restaurantUsers)
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId)
        ));
      return { ok: true };
    }),
});
