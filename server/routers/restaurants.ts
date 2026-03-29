import { z } from "zod";
import { eq, and, sql, count } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure, adminProcedure, ownerProcedure } from "../trpc";
import { db } from "../db";
import { restaurants, restaurantUsers, users, sales, apiUsageLogs } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

/** 주소 → 좌표 자동 변환 (Nominatim / OpenStreetMap) + API 사용량 로깅 */
async function geocodeAddress(address: string, userId?: number, restaurantId?: number): Promise<{ latitude: string; longitude: string } | null> {
  const startTime = Date.now();
  try {
    const url = `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=kr`;
    const res = await fetch(url, {
      headers: { "User-Agent": "331RestaurantManager/1.0" },
    });
    const responseTimeMs = Date.now() - startTime;
    const success = res.ok;
    const data = success ? await res.json() : [];
    const result = data.length > 0 && data[0].lat && data[0].lon
      ? { latitude: String(data[0].lat), longitude: String(data[0].lon) }
      : null;

    // API 사용량 로깅 (비동기, 실패해도 무시)
    db.insert(apiUsageLogs).values({
      apiType: "geocoding",
      endpoint: "nominatim",
      userId: userId ?? null,
      restaurantId: restaurantId ?? null,
      responseTimeMs,
      success: !!result,
      errorMessage: result ? null : "주소 변환 실패: " + address,
    }).catch(() => {});

    return result;
  } catch (e: any) {
    db.insert(apiUsageLogs).values({
      apiType: "geocoding",
      endpoint: "nominatim",
      userId: userId ?? null,
      restaurantId: restaurantId ?? null,
      responseTimeMs: Date.now() - startTime,
      success: false,
      errorMessage: e.message,
    }).catch(() => {});
    return null;
  }
}

export const restaurantsRouter = router({
  /** 전체 매장 목록 (master/admin: 전체) */
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.select().from(restaurants).where(eq(restaurants.isActive, true));
  }),

  /** 소유 매장 + 직원수 + 당월 매출 요약 (admin 이상) */
  listWithSummary: adminProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

    // 소유 매장 필터 (master=전체, admin/sub-admin=소유분만)
    let allRestaurants;
    if (ctx.user.role === "master") {
      allRestaurants = await db.select().from(restaurants).where(and(eq(restaurants.isActive, true), eq(restaurants.isTutorial, false)));
    } else {
      const [me] = await db.select({ parentId: users.parentId }).from(users).where(eq(users.id, ctx.user.userId)).limit(1);
      const ownerAdminId = me?.parentId ?? ctx.user.userId;
      allRestaurants = await db.select().from(restaurants).where(and(
        eq(restaurants.isActive, true), eq(restaurants.isTutorial, false), eq(restaurants.ownerAdminId, ownerAdminId),
      ));
    }

    const staffCounts = await db
      .select({
        restaurantId: restaurantUsers.restaurantId,
        staffCount: count(restaurantUsers.id),
      })
      .from(restaurantUsers)
      .groupBy(restaurantUsers.restaurantId);

    const monthlySales = await db
      .select({
        restaurantId: sales.restaurantId,
        total: sql<string>`COALESCE(SUM(${sales.amount}), 0)`,
      })
      .from(sales)
      .where(
        and(
          sql`${sales.saleDate} >= ${monthStart}`,
          sql`${sales.saleDate} < ${nextMonth}`,
        )
      )
      .groupBy(sales.restaurantId);

    const staffMap = new Map(staffCounts.map(s => [s.restaurantId, Number(s.staffCount)]));
    const salesMap = new Map(monthlySales.map(s => [s.restaurantId, Number(s.total)]));

    return allRestaurants.map(r => ({
      ...r,
      staffCount: staffMap.get(r.id) ?? 0,
      monthlySales: salesMap.get(r.id) ?? 0,
    }));
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
    .mutation(async ({ input, ctx }) => {
      // 주소가 있으면 좌표 자동 설정
      let insertData: any = { ...input };
      if (input.address) {
        const coords = await geocodeAddress(input.address);
        if (coords) {
          insertData.latitude = coords.latitude;
          insertData.longitude = coords.longitude;
        }
      }
      // 소유 대표 자동 설정: admin이면 본인, sub-admin이면 parentId, master면 null
      if (ctx.user.role === "admin") {
        const [me] = await db.select({ parentId: users.parentId }).from(users).where(eq(users.id, ctx.user.userId)).limit(1);
        insertData.ownerAdminId = me?.parentId ?? ctx.user.userId;
      }
      const [result] = await db.insert(restaurants).values(insertData).$returningId();
      return { id: result.id };
    }),

  update: managerProcedure
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
      // 주소가 변경되었으면 좌표 자동 갱신
      let updateData: any = { ...data };
      if (data.address) {
        const coords = await geocodeAddress(data.address);
        if (coords) {
          updateData.latitude = coords.latitude;
          updateData.longitude = coords.longitude;
        }
      }
      await db.update(restaurants).set(updateData).where(eq(restaurants.id, id));
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
  addStaff: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      userId: z.number(),
      role: z.enum(["owner", "supervisor", "staff", "store_manager", "manager", "employee"]).default("staff"),
    }))
    .mutation(async ({ input }) => {
      await db.insert(restaurantUsers).values(input).onDuplicateKeyUpdate({
        set: { role: input.role },
      });
      return { ok: true };
    }),

  /** 직원 소속회사 변경 */
  updateStaffCompany: ownerProcedure
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

  /** 직원 역할 변경 (승격/강등) — master 또는 해당 매장 점장(owner)만 가능 */
  updateStaffRole: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      userId: z.number(),
      role: z.enum(["owner", "supervisor", "staff", "store_manager", "manager", "employee"]),
    }))
    .mutation(async ({ input, ctx }) => {
      // master(개발자)는 항상 가능
      if (ctx.user.role !== "master") {
        // 해당 매장의 owner(점장)인지 확인
        const [ru] = await db
          .select({ role: restaurantUsers.role })
          .from(restaurantUsers)
          .where(and(
            eq(restaurantUsers.restaurantId, input.restaurantId),
            eq(restaurantUsers.userId, ctx.user.userId)
          ))
          .limit(1);
        if (!ru || (ru.role !== "owner" && ru.role !== "store_manager")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "점장 권한이 필요합니다" });
        }
      }
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
  removeStaff: managerProcedure
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
