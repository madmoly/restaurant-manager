import { z } from "zod";
import { eq, and, sql, count } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure, adminProcedure, ownerProcedure, masterProcedure } from "../trpc";
import { db } from "../db";
import { restaurants, restaurantUsers, users, sales, apiUsageLogs, restaurantShiftPresets } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { activeRealStoreCondition, getOwnedRestaurants } from "../helpers/restaurantScope";

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
  /** 전체 활성 매장 목록 — tutorial 사용자는 tutorial 매장, 실사용자는 실매장 */
  list: protectedProcedure.query(async ({ ctx }) => {
    const [me] = await db.select({ isTutorial: users.isTutorial }).from(users).where(eq(users.id, ctx.user.userId)).limit(1);
    return db.select().from(restaurants).where(activeRealStoreCondition(me?.isTutorial ?? false));
  }),

  /** 소유 매장 + 직원수 + 당월 매출 요약 (admin 이상) */
  listWithSummary: adminProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

    // 소유 매장 필터 — 중앙 스코핑 헬퍼 사용
    const allRestaurantsRaw = await getOwnedRestaurants(ctx.user.userId, ctx.user.role);
    const allRestaurants = allRestaurantsRaw.filter((r) => r.isActive);

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

  /** 내 매장 + 역할 — tutorial 사용자는 tutorial 매장, 실사용자는 실매장 */
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const [me] = await db.select({ isTutorial: users.isTutorial }).from(users).where(eq(users.id, ctx.user.userId)).limit(1);
    return db
      .select({ restaurant: restaurants, storeRole: restaurantUsers.role })
      .from(restaurantUsers)
      .innerJoin(restaurants, eq(restaurants.id, restaurantUsers.restaurantId))
      .where(and(
        eq(restaurantUsers.userId, ctx.user.userId),
        activeRealStoreCondition(me?.isTutorial ?? false),
      ));
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
      salesInputStartTime: z.string().nullable().optional(),
      salesInputEndTime: z.string().nullable().optional(),
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

  /** 매장 소프트 삭제 (admin 이상) */
  softDelete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      // admin인 경우 자기 소유 매장만 삭제 가능
      if (ctx.user.role === "admin") {
        const [store] = await db.select({ ownerAdminId: restaurants.ownerAdminId })
          .from(restaurants).where(eq(restaurants.id, input.id)).limit(1);
        if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "매장을 찾을 수 없습니다" });
        if (store.ownerAdminId !== ctx.user.userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "본인 소유 매장만 삭제할 수 있습니다" });
        }
      }
      await db.update(restaurants).set({ deletedAt: new Date() }).where(eq(restaurants.id, input.id));
      return { ok: true };
    }),

  /** 매장 복구 (master 전용) */
  restore: masterProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.update(restaurants).set({ deletedAt: null }).where(eq(restaurants.id, input.id));
      return { ok: true };
    }),

  /** [master] 전체 매장 + 소유 대표 조회 */
  listAllWithOwner: masterProcedure.query(async () => {
    const allStores = await db.select({
      id: restaurants.id,
      name: restaurants.name,
      isTutorial: restaurants.isTutorial,
      ownerAdminId: restaurants.ownerAdminId,
      isActive: restaurants.isActive,
    }).from(restaurants).where(sql`${restaurants.deletedAt} IS NULL`);

    // admin 목록 (대표 + SUB대표)
    const admins = await db.select({
      id: users.id, name: users.name, parentId: users.parentId,
    }).from(users).where(eq(users.role, "admin"));

    return { stores: allStores, admins };
  }),

  /** [master] 매장 소유 대표 변경 */
  updateOwner: masterProcedure
    .input(z.object({ restaurantId: z.number(), ownerAdminId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      await db.update(restaurants).set({ ownerAdminId: input.ownerAdminId }).where(eq(restaurants.id, input.restaurantId));
      return { ok: true };
    }),

  // ─── 매장별 근무 프리셋 시간 ─────────────────────────────────────────────

  /** 매장 프리셋 조회 (활성만 or 전체) */
  getShiftPresets: protectedProcedure
    .input(z.object({ restaurantId: z.number(), includeInactive: z.boolean().optional() }))
    .query(async ({ input }) => {
      const conditions = [eq(restaurantShiftPresets.restaurantId, input.restaurantId)];
      if (!input.includeInactive) {
        conditions.push(eq(restaurantShiftPresets.isActive, true));
      }
      return db.select().from(restaurantShiftPresets)
        .where(and(...conditions))
        .orderBy(restaurantShiftPresets.sortOrder, restaurantShiftPresets.presetType);
    }),

  /** 매장 프리셋 일괄 저장 (upsert) — Phase 2: label/isCustom/sortOrder/isActive 지원 */
  saveShiftPresets: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      presets: z.array(z.object({
        presetType: z.string().min(1).max(30),
        dayType: z.enum(["weekday", "weekend"]),
        label: z.string().max(30).optional(),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
        breakMinutes: z.number().min(0).default(0),
        isCustom: z.boolean().optional(),
        sortOrder: z.number().optional(),
        isActive: z.boolean().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      for (const p of input.presets) {
        const label = p.label ?? "";
        const isCustom = p.isCustom ?? false;
        const sortOrder = p.sortOrder ?? 0;
        const isActive = p.isActive ?? true;
        await db.execute(sql`
          INSERT INTO restaurant_shift_presets (restaurantId, presetType, dayType, label, startTime, endTime, breakMinutes, isCustom, sortOrder, isActive)
          VALUES (${input.restaurantId}, ${p.presetType}, ${p.dayType}, ${label}, ${p.startTime}, ${p.endTime}, ${p.breakMinutes}, ${isCustom}, ${sortOrder}, ${isActive})
          ON DUPLICATE KEY UPDATE
            label = VALUES(label),
            startTime = VALUES(startTime),
            endTime = VALUES(endTime),
            breakMinutes = VALUES(breakMinutes),
            isCustom = VALUES(isCustom),
            sortOrder = VALUES(sortOrder),
            isActive = VALUES(isActive)
        `);
      }
      return { ok: true };
    }),

  /** 커스텀 근무유형 생성 */
  createShiftPresetType: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      presetType: z.string().min(1).max(30),
      label: z.string().min(1).max(30),
      weekday: z.object({
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
        breakMinutes: z.number().min(0).default(0),
      }),
      weekend: z.object({
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
        breakMinutes: z.number().min(0).default(0),
      }).optional(),
      sortOrder: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      // presetType 중복 체크
      const [existing] = await db.select({ id: restaurantShiftPresets.id })
        .from(restaurantShiftPresets)
        .where(and(
          eq(restaurantShiftPresets.restaurantId, input.restaurantId),
          eq(restaurantShiftPresets.presetType, input.presetType),
        ))
        .limit(1);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: `근무유형 "${input.presetType}"이(가) 이미 존재합니다.` });
      }

      const sortOrder = input.sortOrder ?? 10;
      // 평일 프리셋 생성
      await db.insert(restaurantShiftPresets).values({
        restaurantId: input.restaurantId,
        presetType: input.presetType,
        dayType: "weekday",
        label: input.label,
        startTime: input.weekday.startTime,
        endTime: input.weekday.endTime,
        breakMinutes: input.weekday.breakMinutes,
        isCustom: true,
        sortOrder,
        isActive: true,
      });
      // 주말 프리셋 생성 (없으면 평일과 동일)
      const wknd = input.weekend ?? input.weekday;
      await db.insert(restaurantShiftPresets).values({
        restaurantId: input.restaurantId,
        presetType: input.presetType,
        dayType: "weekend",
        label: input.label,
        startTime: wknd.startTime,
        endTime: wknd.endTime,
        breakMinutes: wknd.breakMinutes,
        isCustom: true,
        sortOrder,
        isActive: true,
      });
      return { ok: true };
    }),

  /** 매장 프리셋 삭제 (커스텀만 삭제 가능) */
  deleteShiftPreset: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const [preset] = await db.select({ isCustom: restaurantShiftPresets.isCustom, presetType: restaurantShiftPresets.presetType, restaurantId: restaurantShiftPresets.restaurantId })
        .from(restaurantShiftPresets)
        .where(eq(restaurantShiftPresets.id, input.id))
        .limit(1);
      if (!preset) throw new TRPCError({ code: "NOT_FOUND", message: "프리셋을 찾을 수 없습니다." });
      if (!preset.isCustom) throw new TRPCError({ code: "BAD_REQUEST", message: "기본 근무유형(오픈/풀/마감)은 삭제할 수 없습니다." });
      // 해당 타입의 모든 dayType 레코드 삭제
      await db.delete(restaurantShiftPresets).where(and(
        eq(restaurantShiftPresets.restaurantId, preset.restaurantId),
        eq(restaurantShiftPresets.presetType, preset.presetType),
      ));
      return { ok: true };
    }),

  /** 프리셋 활성/비활성 토글 */
  toggleShiftPreset: managerProcedure
    .input(z.object({ restaurantId: z.number(), presetType: z.string(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      await db.update(restaurantShiftPresets)
        .set({ isActive: input.isActive })
        .where(and(
          eq(restaurantShiftPresets.restaurantId, input.restaurantId),
          eq(restaurantShiftPresets.presetType, input.presetType),
        ));
      return { ok: true };
    }),
});
