import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, and, sql, desc, isNotNull, gte, lte } from "drizzle-orm";
import { restaurantContracts as restaurantContractsTable, restaurants as restaurantsTable, purchases as purchasesTable } from "../drizzle/schema";
import { getDb } from "./db";
import bcrypt from "bcryptjs";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { electronicContractsRouter } from "./routers/electronicContracts";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { notifyOwner } from "./_core/notification";
import { storagePut } from "./storage";
import { sdk } from "./_core/sdk";
import { getHolidaysByMonth, getHolidaysByYear } from "../shared/holidays";
import { ROLE_LEVEL as SHARED_ROLE_LEVEL, getEffectiveRole } from "../shared/permissions";
import { todayKST, toKSTDateString, kstDayStartUTC, kstDayEndUTC, addDays as addDaysKST } from "../shared/dateKST";
import {
  upsertUser, getUserByOpenId, getUserById, getUserByUsername, getAllUsers, updateUser, createUser,
  getAllRestaurants, getRestaurantById, createRestaurant, updateRestaurant,
  getRestaurantsByUserId, getUsersByRestaurantId, addUserToRestaurant, removeUserFromRestaurant,
  getContractByUserAndRestaurant, upsertContract, getContractsByRestaurant,
  getSchedulesByRestaurantAndRange, getSchedulesByUserAndRange, createSchedule, updateSchedule, deleteSchedule, getPendingScheduleRequests,
  getSalesByRestaurantAndMonth, getSalesByRestaurantAndDate, createSale, updateSale, deleteSale, getMonthlySalesTotal, getDailySalesTotal,
  getPurchasesByRestaurantAndMonth, createPurchase, updatePurchase, deletePurchase, getMonthlyPurchasesTotal,
  getFixedCostsByMonth, createFixedCost, updateFixedCost, deleteFixedCost, getMonthlyFixedCostsTotal,
  createNotification, getNotificationsByRecipient, getMasterNotifications, markNotificationRead,
  calculateMonthlyLaborCost, calculateDailyLaborCost,
  calculateMonthlyLaborCostByUser, getFixedCostsByCategory,
  getRestaurantContractsByRestaurant, createRestaurantContract, updateRestaurantContract, deleteRestaurantContract,
  applyContractsToFixedCosts, syncContractToFixedCosts,
  getDailyClosing, getDailyClosingsByMonth, upsertDailyClosing, getDailyClosingDetail, getMonthlyAttendanceCounts,
  getDailyClosingSalesTypes, addDailyClosingSalesType,
  getDailyClosingSpecialTypes, addDailyClosingSpecialType,
  getMonthlyClosing, getMonthlyClosingsByYear, upsertMonthlyClosing,
  getChecklistTemplates, getAllChecklistTemplates, createChecklistTemplate, updateChecklistTemplate, deleteChecklistTemplate,
  getDailyChecklistLog, upsertDailyChecklistLog,
} from "./db";

// ─── Role helpers ─────────────────────────────────────────────────────────────
// shared/permissions.ts의 ROLE_LEVEL을 서버에서도 동일하게 사용
const ROLE_LEVEL = SHARED_ROLE_LEVEL;
function requireRole(userRole: string, minRole: string) {
  if ((ROLE_LEVEL[userRole] ?? 0) < (ROLE_LEVEL[minRole] ?? 99)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "권한이 부족합니다." });
  }
}

// 매장 내 역할을 조회하는 헬퍼
async function getStoreRole(userId: number, restaurantId: number | undefined): Promise<string | null> {
  if (!restaurantId) return null;
  const db = await getDb();
  if (!db) return null;
  const { restaurantUsers } = await import("../drizzle/schema");
  const rows = await db.select({ role: restaurantUsers.role })
    .from(restaurantUsers)
    .where(and(eq(restaurantUsers.restaurantId, restaurantId), eq(restaurantUsers.userId, userId)))
    .limit(1);
  return rows[0]?.role ?? null;
}

// 매장 내 역할이 store_manager/manager이면 true
async function checkStoreManagerRole(userId: number, restaurantId: number | undefined): Promise<boolean> {
  const role = await getStoreRole(userId, restaurantId);
  return role === "store_manager" || role === "manager";
}

// 매장 내 역할이 store_manager이면 true
async function checkStoreLeaderRole(userId: number, restaurantId: number | undefined): Promise<boolean> {
  const role = await getStoreRole(userId, restaurantId);
  return role === "store_manager";
}

// users.role이 manager 이상이거나 매장 내 역할이 store_manager/manager이면 통과
async function requireManagerOrStoreRole(userId: number, userRole: string, restaurantId: number | undefined): Promise<void> {
  if ((ROLE_LEVEL[userRole] ?? 0) >= ROLE_LEVEL["manager"]) return;
  const hasStoreRole = await checkStoreManagerRole(userId, restaurantId);
  if (!hasStoreRole) {
    throw new TRPCError({ code: "FORBIDDEN", message: "권한이 부족합니다." });
  }
}

// 매장 소속 검증 헬퍼 — admin/master는 통과, 그 외는 restaurant_users 소속 확인
async function assertRestaurantAccess(userId: number, userRole: string, restaurantId: number): Promise<void> {
  if ((ROLE_LEVEL[userRole] ?? 0) >= ROLE_LEVEL["admin"]) return; // admin/master 통과
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  const { restaurantUsers } = await import("../drizzle/schema");
  const rows = await db.select({ id: restaurantUsers.userId })
    .from(restaurantUsers)
    .where(and(eq(restaurantUsers.restaurantId, restaurantId), eq(restaurantUsers.userId, userId)))
    .limit(1);
  if (rows.length === 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "해당 매장에 접근 권한이 없습니다." });
  }
}

// 점장(store_manager) 또는 admin 이상만 통과
async function requireStoreLeaderOrAdmin(userId: number, userRole: string, restaurantId: number | undefined): Promise<void> {
  if ((ROLE_LEVEL[userRole] ?? 0) >= ROLE_LEVEL["admin"]) return;
  const isLeader = await checkStoreLeaderRole(userId, restaurantId);
  if (!isLeader) {
    throw new TRPCError({ code: "FORBIDDEN", message: "점장 권한이 필요합니다." });
  }
}

// 휴무일 여부 확인 헬퍼 (특정 날짜 + 정기 요일 모두 체크)
async function isClosedDay(restaurantId: number, dateStr: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const { storeClosedDays, storeWeeklyClosures } = await import("../drizzle/schema");
  // 특정 날짜 휴무 확인
  const specialRows = await db.select({ id: storeClosedDays.id })
    .from(storeClosedDays)
    .where(and(
      eq(storeClosedDays.restaurantId, restaurantId),
      sql`DATE(${storeClosedDays.closedDate}) = ${dateStr}`,
    ))
    .limit(1);
  if (specialRows.length > 0) return true;
  // 정기 요일 휴무 확인
  const weekday = new Date(dateStr).getDay(); // 0=일, 6=토
  const weeklyRows = await db.select({ id: storeWeeklyClosures.id })
    .from(storeWeeklyClosures)
    .where(and(
      eq(storeWeeklyClosures.restaurantId, restaurantId),
      eq(storeWeeklyClosures.weekday, weekday),
      eq(storeWeeklyClosures.isClosed, true),
    ))
    .limit(1);
  return weeklyRows.length > 0;
}

const managerProcedure = protectedProcedure.use(async ({ ctx, getRawInput, next }) => {
  // users.role이 manager 이상이면 통과
  const sysLevel = ROLE_LEVEL[ctx.user.role] ?? 0;
  if (sysLevel >= ROLE_LEVEL["manager"]) return next({ ctx });
  // 시스템 역할이 부족하면 매장 내 역할 확인
  const raw = await getRawInput() as any;
  const inp = raw?.json ?? raw;
  // restaurantId가 직접 있으면 사용, 없으면 id로 레코드를 조회해 restaurantId 추적
  let restaurantId: number | undefined = inp?.restaurantId ?? undefined;
  if (!restaurantId && inp?.id) {
    // id만 있는 경우: 여러 테이블에서 restaurantId 추적 시도
    const db = await getDb();
    if (db) {
      const m = await import("../drizzle/schema");
      const tryTables = [
        db.select({ restaurantId: m.sales.restaurantId }).from(m.sales).where(eq(m.sales.id, inp.id)).limit(1),
        db.select({ restaurantId: m.purchases.restaurantId }).from(m.purchases).where(eq(m.purchases.id, inp.id)).limit(1),
        db.select({ restaurantId: m.monthlyFixedCosts.restaurantId }).from(m.monthlyFixedCosts).where(eq(m.monthlyFixedCosts.id, inp.id)).limit(1),
        db.select({ restaurantId: m.schedules.restaurantId }).from(m.schedules).where(eq(m.schedules.id, inp.id)).limit(1),
      ];
      for (const q of tryTables) {
        const rows = await q;
        if (rows[0]?.restaurantId) { restaurantId = rows[0].restaurantId; break; }
      }
    }
  }
  const hasStoreRole = await checkStoreManagerRole(ctx.user.id, restaurantId);
  if (!hasStoreRole) {
    throw new TRPCError({ code: "FORBIDDEN", message: "권한이 부족합니다." });
  }
  return next({ ctx });
});
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  requireRole(ctx.user.role, "admin");
  return next({ ctx });
});
// 점장도 직원 생성 가능
// manager 역할은 점장과 동일 권한을 가짐

export const appRouter = router({
  system: systemRouter,

  // ── Auth ──────────────────────────────────────────────────────────────────
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    loginWithPassword: publicProcedure
      .input(z.object({ username: z.string(), password: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const user = await getUserByUsername(input.username);
        if (!user || !user.passwordHash) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "아이디 또는 비밀번호가 올바르지 않습니다." });
        }
        const ok = await bcrypt.compare(input.password, user.passwordHash);
        if (!ok) throw new TRPCError({ code: "UNAUTHORIZED", message: "아이디 또는 비밀번호가 올바르지 않습니다." });
        await updateUser(user.id, { lastSignedIn: new Date() });
        // sdk.createSessionToken은 appId, name 필드를 포함한 올바른 JWT를 생성합니다
        const token = await sdk.createSessionToken(user.openId, {
          name: user.name ?? user.username ?? "",
          expiresInMs: 7 * 24 * 3600 * 1000,
        });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: 7 * 24 * 3600 });
        return { success: true, user };
      }),
  }),

  // ── Users ─────────────────────────────────────────────────────────────────
  users: router({
    list: adminProcedure.query(() => getAllUsers()),
    get: protectedProcedure.input(z.object({ id: z.number() })).query(({ input }) => getUserById(input.id)),
    create: managerProcedure
      .input(z.object({
        username: z.string().min(2),
        password: z.string().min(4),
        name: z.string().min(1),
        role: z.enum(["master", "admin", "manager", "employee"]),
        phone: z.string().optional(),
        restaurantId: z.number().optional(), // 점장이 생성 시 자동 소속 매장
        restaurantRole: z.enum(["store_manager", "manager", "employee"]).optional(), // 매장 내 역할 (기본값: role 기반)
      }))
      .mutation(async ({ input, ctx }) => {
        // 점장(manager)는 employee만 생성 가능, admin/master는 모든 역할 생성 가능
        const callerRole = ctx.user.role;
        if (callerRole === "manager" && !(["employee", "manager"] as string[]).includes(input.role)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "점장은 직원 또는 매니저 계정만 생성할 수 있습니다." });
        }
        const existing = await getUserByUsername(input.username);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "이미 사용 중인 아이디입니다." });
        const passwordHash = await bcrypt.hash(input.password, 10);
        const openId = `local_${input.username}_${Date.now()}`;
        const newUser = await createUser({ openId, username: input.username, passwordHash, name: input.name, role: input.role, phone: input.phone, loginMethod: "password" });
        // 점장이 생성하면 현재 매장에 자동 소속
        if (newUser && input.restaurantId) {
          const storeRole = input.restaurantRole ?? (input.role === "manager" ? "manager" : "employee");
          await addUserToRestaurant({ restaurantId: input.restaurantId, userId: newUser.id, role: storeRole as "store_manager" | "manager" | "employee" });
        }
        return newUser;
      }),
    listByRestaurant: managerProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(({ input }) => getUsersByRestaurantId(input.restaurantId)),
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        username: z.string().min(2).optional(),
        role: z.enum(["master", "admin", "manager", "employee"]).optional(),
        phone: z.string().optional(),
        isActive: z.boolean().optional(),
        password: z.string().min(4).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, password, username, ...rest } = input;
        const data: Record<string, unknown> = { ...rest };
        if (password) data.passwordHash = await bcrypt.hash(password, 10);
        if (username) {
          const existing = await getUserByUsername(username);
          if (existing && existing.id !== id) throw new TRPCError({ code: "CONFLICT", message: "이미 사용 중인 아이디입니다." });
          data.username = username;
        }
        await updateUser(id, data as never);
        return { success: true };
      }),
    // 점장: 자신의 매장 직원의 아이디/비밀번호만 수정 가능
    updateCredentials: managerProcedure
      .input(z.object({
        userId: z.number(),
        restaurantId: z.number(),
        username: z.string().min(2).optional(),
        password: z.string().min(4).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // 해당 직원이 실제로 이 매장 소속인지 확인
        const staffList = await getUsersByRestaurantId(input.restaurantId);
        const isStaff = staffList.some((s: { id: number }) => s.id === input.userId);
        if (!isStaff) throw new TRPCError({ code: "FORBIDDEN", message: "해당 매장의 직원이 아닙니다." });
        // 점장은 자신보다 높은 권한(admin/master) 계정은 수정 불가
        const target = await getUserById(input.userId);
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "사용자를 찾을 수 없습니다." });
        const levelMap: Record<string, number> = { master: 4, admin: 3, manager: 2, employee: 1, user: 0 };
        const callerLevel = levelMap[ctx.user.role] ?? 0;
        const targetLevel = levelMap[target.role] ?? 0;
        if (targetLevel >= callerLevel) throw new TRPCError({ code: "FORBIDDEN", message: "동등 또는 상위 권한 계정은 수정할 수 없습니다." });
        const data: Record<string, unknown> = {};
        if (input.username) {
          const existing = await getUserByUsername(input.username);
          if (existing && existing.id !== input.userId) throw new TRPCError({ code: "CONFLICT", message: "이미 사용 중인 아이디입니다." });
          data.username = input.username;
        }
        if (input.password) data.passwordHash = await bcrypt.hash(input.password, 10);
        if (Object.keys(data).length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "수정할 내용이 없습니다." });
        await updateUser(input.userId, data as never);
        return { success: true };
      }),
    delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      await updateUser(input.id, { isActive: false });
      return { success: true };
    }),
  }),

  // ── Restaurants ───────────────────────────────────────────────────────────
  restaurants: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const role = ctx.user.role;
      if (role === "master" || role === "admin") return getAllRestaurants();
      return getRestaurantsByUserId(ctx.user.id);
    }),
    listAll: adminProcedure
      .input(z.object({ withStats: z.boolean().optional() }).optional())
      .query(async ({ input }) => {
        const rests = await getAllRestaurants();
        if (!input?.withStats) return rests.map(r => ({ ...r, stats: null }));
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const monthStr = `${year}-${String(month).padStart(2, "0")}`;
        return Promise.all(rests.map(async (r) => {
          const [salesTotal, purchasesTotal, fixedCostsTotal, laborCost, contractCount] = await Promise.all([
            getMonthlySalesTotal(r.id, year, month),
            getMonthlyPurchasesTotal(r.id, year, month),
            getMonthlyFixedCostsTotal(r.id, monthStr),
            calculateMonthlyLaborCost(r.id, year, month),
            (async () => { const db = await getDb(); if (!db) return 0; const rows = await db.select().from(restaurantContractsTable).where(and(eq(restaurantContractsTable.restaurantId, r.id), eq(restaurantContractsTable.isActive, true))); return rows.length; })(),
          ]);
          const totalCost = purchasesTotal + fixedCostsTotal + laborCost;
          const profit = salesTotal - totalCost;
          const costRatio = salesTotal > 0 ? (totalCost / salesTotal) * 100 : 0;
          const targetSales = parseFloat(r.monthlyTargetSales ?? "0");
          const salesAchievement = targetSales > 0 ? (salesTotal / targetSales) * 100 : 0;
          return { ...r, stats: { salesTotal, purchasesTotal, fixedCostsTotal, laborCost, totalCost, profit, costRatio, salesAchievement, contractCount, year, month } };
        }));
      }),
    listMine: protectedProcedure.query(({ ctx }) => getRestaurantsByUserId(ctx.user.id)),
    get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx.user.id, ctx.user.role, input.id);
      return getRestaurantById(input.id);
    }),
    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        address: z.string().optional(),
        phone: z.string().optional(),
        monthlyTargetSales: z.number().optional(),
        targetLaborRatio: z.number().optional(),
        targetCostRatio: z.number().optional(),
      }))
      .mutation(({ input }) => createRestaurant({
        ...input,
        monthlyTargetSales: input.monthlyTargetSales?.toString(),
        targetLaborRatio: input.targetLaborRatio?.toString(),
        targetCostRatio: input.targetCostRatio?.toString(),
      })),
    update: managerProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
        monthlyTargetSales: z.number().optional(),
        targetLaborRatio: z.number().optional(),
        targetCostRatio: z.number().optional(),
      }))
      .mutation(({ input }) => {
        const { id, ...rest } = input;
        return updateRestaurant(id, {
          ...rest,
          monthlyTargetSales: rest.monthlyTargetSales?.toString(),
          targetLaborRatio: rest.targetLaborRatio?.toString(),
          targetCostRatio: rest.targetCostRatio?.toString(),
        });
      }),
    getStaff: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ input, ctx }) => {
        await assertRestaurantAccess(ctx.user.id, ctx.user.role, input.restaurantId);
        return getUsersByRestaurantId(input.restaurantId);
      }),
    addStaff: managerProcedure
      .input(z.object({ restaurantId: z.number(), userId: z.number(), role: z.enum(["store_manager", "manager", "employee"]) }))
      .mutation(({ input }) => addUserToRestaurant(input)),
    // 매장 내 역할 변경 (store_manager만 가능: manager ↔ employee)
    updateStaffRole: managerProcedure
      .input(z.object({
        restaurantId: z.number(),
        userId: z.number(),
        role: z.enum(["store_manager", "manager", "employee"]),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { restaurantUsers, users: usersTable } = await import("../drizzle/schema");
        // restaurant_users.role만 업데이트 (시스템 전역 역할 users.role은 절대 덮어쓰지 않음)
        // 이유: 한 사용자가 여러 매장에 소속될 수 있으므로,
        //       A매장 역할 변경이 B매장 권한에 영향을 주면 안 됨
        await db.update(restaurantUsers)
          .set({ role: input.role, roleChangedAt: new Date(), roleChangedBy: ctx.user.id })
          .where(and(eq(restaurantUsers.restaurantId, input.restaurantId), eq(restaurantUsers.userId, input.userId)));
        return { success: true };
      }),
    // 매장 내 역할 조회 (effectiveStoreRole 용)
    getMyStoreRole: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) return null;
        const { restaurantUsers } = await import("../drizzle/schema");
        const rows = await db.select({ role: restaurantUsers.role })
          .from(restaurantUsers)
          .where(and(eq(restaurantUsers.restaurantId, input.restaurantId), eq(restaurantUsers.userId, ctx.user.id)))
          .limit(1);
        return rows[0]?.role ?? null;
      }),
    removeStaff: managerProcedure
      .input(z.object({ restaurantId: z.number(), userId: z.number() }))
      .mutation(({ input }) => removeUserFromRestaurant(input.userId, input.restaurantId)),
    // 매장 소프트 삭제 (어드민 이상)
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await db.update(restaurantsTable).set({ deletedAt: new Date(), isActive: false }).where(eq(restaurantsTable.id, input.id));
        return { success: true };
      }),
    // 삭제된 매장 복원
    restore: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await db.update(restaurantsTable).set({ deletedAt: null, isActive: true }).where(eq(restaurantsTable.id, input.id));
        return { success: true };
      }),
    // 삭제된 매장 목록 (어드민 이상, 1년 이내)
    listDeleted: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      return db.select().from(restaurantsTable)
        .where(and(isNotNull(restaurantsTable.deletedAt), gte(restaurantsTable.deletedAt, oneYearAgo)))
        .orderBy(desc(restaurantsTable.deletedAt));
    }),
    // 매출 입력 시간 설정
    setSalesInputTime: managerProcedure
      .input(z.object({
        restaurantId: z.number(),
        salesInputStartTime: z.string().nullable(), // "HH:MM" or null
        salesInputEndTime: z.string().nullable(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await db.update(restaurantsTable)
          .set({ salesInputStartTime: input.salesInputStartTime, salesInputEndTime: input.salesInputEndTime })
          .where(eq(restaurantsTable.id, input.restaurantId));
        return { success: true };
      }),
    // 매장 운영시간 설정 (오픈/마감 시각) — 스케줄 프리셋 기준
    setOperatingHours: managerProcedure
      .input(z.object({
        restaurantId: z.number(),
        openTime: z.string().regex(/^\d{2}:\d{2}$/), // "HH:MM"
        closeTime: z.string().regex(/^\d{2}:\d{2}$/), // "HH:MM"
        halfShiftThreshold: z.number().int().min(10).max(90).optional(), // 반차 판별 기준 (%)
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const updateData: Record<string, any> = {
          openTime: input.openTime,
          closeTime: input.closeTime,
        };
        if (input.halfShiftThreshold !== undefined) {
          updateData.halfShiftThreshold = input.halfShiftThreshold;
        }
        await db.update(restaurantsTable)
          .set(updateData)
          .where(eq(restaurantsTable.id, input.restaurantId));
        return { success: true };
      }),
  }),

  // ── Contracts ─────────────────────────────────────────────────────────────
  contracts: router({
    get: managerProcedure
      .input(z.object({ userId: z.number(), restaurantId: z.number() }))
      .query(({ input }) => getContractByUserAndRestaurant(input.userId, input.restaurantId)),
    listByRestaurant: managerProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(({ input }) => getContractsByRestaurant(input.restaurantId)),
    upsert: managerProcedure
      .input(z.object({
        userId: z.number(),
        restaurantId: z.number(),
        wageType: z.enum(["hourly", "monthly"]),
        wageAmount: z.number(),
        position: z.string().optional(),
        contractStart: z.string().optional(),
        contractEnd: z.string().optional(),
        contractNote: z.string().optional(),
        weeklyHours: z.number().optional(),
      }))
      .mutation(({ input }) => upsertContract({
        ...input,
        wageAmount: input.wageAmount.toString(),
        weeklyHours: input.weeklyHours?.toString(),
        contractStart: input.contractStart ? (input.contractStart as unknown as Date) : undefined,
        contractEnd: input.contractEnd ? (input.contractEnd as unknown as Date) : undefined,
      })),
  }),

  // ── Schedules ─────────────────────────────────────────────────────────────
  schedules: router({
    listByRestaurant: protectedProcedure
      .input(z.object({ restaurantId: z.number(), from: z.string(), to: z.string() }))
      .query(({ input }) => getSchedulesByRestaurantAndRange(input.restaurantId, new Date(input.from), new Date(input.to))),
    // Alias with date range params for frontend convenience
    listByRestaurantAndRange: protectedProcedure
      .input(z.object({ restaurantId: z.number(), startDate: z.string(), endDate: z.string() }))
      .query(({ input }) => getSchedulesByRestaurantAndRange(input.restaurantId, new Date(input.startDate), new Date(input.endDate))),
    listByUser: protectedProcedure
      .input(z.object({ userId: z.number(), from: z.string(), to: z.string() }))
      .query(({ input }) => getSchedulesByUserAndRange(input.userId, new Date(input.from), new Date(input.to))),
    pendingRequests: managerProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(({ input }) => getPendingScheduleRequests(input.restaurantId)),
    // 스케줄 생성 (배정 시 자동 고지)
    create: managerProcedure
      .input(z.object({
        userId: z.number(),
        restaurantId: z.number(),
        workDate: z.string(),
        startTime: z.string(),
        endTime: z.string(),
        note: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // 휴무일 차단
        if (await isClosedDay(input.restaurantId, input.workDate)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "해당 날짜는 휴무일입니다." });
        }
        const now = new Date();
        const result = await createSchedule({
          userId: input.userId,
          restaurantId: input.restaurantId,
          startTime: new Date(`${input.workDate}T${input.startTime}:00+09:00`),
          endTime: new Date(`${input.workDate}T${input.endTime}:00+09:00`),
          note: input.note,
          createdBy: ctx.user.id,
          status: "published",
          publishedAt: now,
        });
        // 배정 시 자동 고지: 해당 직원에게 스케줄 배정 알림 전송
        await createNotification({
          recipientId: input.userId,
          type: "schedule_assigned",
          title: "스케줄이 배정되었습니다",
          content: `${input.workDate} ${input.startTime}~${input.endTime} 스케줄이 배정되었습니다.`,
          restaurantId: input.restaurantId,
        });
        return result;
      }),
    // 스케줄 수정 (draft/published 상태)
    update: managerProcedure
      .input(z.object({
        id: z.number(),
        restaurantId: z.number(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        workDate: z.string().optional(), // YYYY-MM-DD 형식으로 날짜 변경
        userId: z.number().optional(), // 담당 직원 변경
        status: z.enum(["draft", "published", "completed", "confirmed", "canceled"]).optional(),
        note: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, startTime, endTime, workDate, userId, ...rest } = input;
        const data: Record<string, unknown> = { ...rest };
        if (userId !== undefined) data.userId = userId;
        // workDate + startTime/endTime 조합으로 날짜 변경 처리
        if (workDate && startTime) data.startTime = new Date(`${workDate}T${startTime}:00+09:00`);
        else if (startTime) data.startTime = new Date(startTime);
        if (workDate && endTime) data.endTime = new Date(`${workDate}T${endTime}:00+09:00`);
        else if (endTime) data.endTime = new Date(endTime);
        // 날짜 변경 시 휴무일 차단
        if (workDate) {
          if (await isClosedDay(input.restaurantId, workDate)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "해당 날짜는 휴무일입니다." });
          }
        }
        // workDate만 변경된 경우 (시간 유지)
        if (workDate && !startTime && !endTime) {
          const db = await getDb();
          if (db) {
            const { schedules: schedulesTable } = await import("../drizzle/schema");
            const rows = await db.select().from(schedulesTable).where(eq(schedulesTable.id, id)).limit(1);
            if (rows[0]) {
              const oldStart = rows[0].startTime as Date;
              const oldEnd = rows[0].endTime as Date;
              const oldStartTime = `${String(oldStart.getHours()).padStart(2,'0')}:${String(oldStart.getMinutes()).padStart(2,'0')}`;
              const oldEndTime = `${String(oldEnd.getHours()).padStart(2,'0')}:${String(oldEnd.getMinutes()).padStart(2,'0')}`;
              data.startTime = new Date(`${workDate}T${oldStartTime}:00+09:00`);
              data.endTime = new Date(`${workDate}T${oldEndTime}:00+09:00`);
            }
          }
        }
        // 수정 전 스케줄 조회
        const db = await getDb();
        let scheduleRow: any = null;
        if (db) {
          const { schedules: schedulesTable } = await import("../drizzle/schema");
          const rows = await db.select().from(schedulesTable).where(eq(schedulesTable.id, id)).limit(1);
          scheduleRow = rows[0];
        }
        await updateSchedule(id, data as never);
        // 알림: 해당 직원에게 스케줄 변경 알림
        if (scheduleRow?.userId && (startTime || endTime)) {
          const workDateStr = scheduleRow.startTime instanceof Date
            ? toKSTDateString(scheduleRow.startTime)
            : String(scheduleRow.startTime).split("T")[0];
          await createNotification({
            recipientId: scheduleRow.userId,
            type: "schedule_updated",
            title: "스케줄이 변경되었습니다",
            content: `${workDateStr} 스케줄이 변경되었습니다.`,
            restaurantId: scheduleRow.restaurantId,
          });
        }
        return { success: true };
      }),
    // 확정된 스케줄 수정 (인건비 재검토 플래그 + 사유 기록)
    updateConfirmedSchedule: managerProcedure
      .input(z.object({
        id: z.number(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        note: z.string().optional(),
        editReason: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { id, startTime, endTime, editReason, note } = input;
        const data: Record<string, unknown> = { editReason, payrollRecheckRequired: true };
        if (note !== undefined) data.note = note;
        if (startTime) data.startTime = new Date(startTime);
        if (endTime) data.endTime = new Date(endTime);
        await updateSchedule(id, data as never);
        return { success: true };
      }),
    delete: managerProcedure
      .input(z.object({ id: z.number(), restaurantId: z.number().optional() }))
      .mutation(async ({ input, ctx }) => {
        // 삭제 전 스케줄 조회
        const db = await getDb();
        let scheduleRow: any = null;
        if (db) {
          const { schedules: schedulesTable } = await import("../drizzle/schema");
          const rows = await db.select().from(schedulesTable).where(eq(schedulesTable.id, input.id)).limit(1);
          scheduleRow = rows[0];
          // 소속 매장 검증
          if (scheduleRow?.restaurantId) {
            await requireManagerOrStoreRole(ctx.user.id, ctx.user.role, scheduleRow.restaurantId);
          }
        }
        await deleteSchedule(input.id);
        // 알림: 해당 직원에게 스케줄 삭제 알림
        if (scheduleRow?.userId) {
          const workDateStr = scheduleRow.startTime instanceof Date
            ? toKSTDateString(scheduleRow.startTime)
            : String(scheduleRow.startTime).split("T")[0];
          await createNotification({
            recipientId: scheduleRow.userId,
            type: "schedule_deleted",
            title: "스케줄이 취소되었습니다",
            content: `${workDateStr} 스케줄이 취소되었습니다.`,
            restaurantId: scheduleRow.restaurantId,
          });
        }
        return { success: true };
      }),
    // 지난주 복사
    copyPreviousWeek: managerProcedure
      .input(z.object({ restaurantId: z.number(), targetWeekStart: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { schedules: schedulesTable } = await import("../drizzle/schema");
        const targetStart = new Date(input.targetWeekStart);
        const prevStart = new Date(targetStart);
        prevStart.setDate(prevStart.getDate() - 7);
        const prevEnd = new Date(prevStart);
        prevEnd.setDate(prevEnd.getDate() + 6);
        prevEnd.setHours(23, 59, 59);
        const prevSchedules = await db.select().from(schedulesTable)
          .where(and(
            eq(schedulesTable.restaurantId, input.restaurantId),
            gte(schedulesTable.startTime, prevStart),
            sql`${schedulesTable.startTime} <= ${prevEnd}`,
            sql`${schedulesTable.status} IN ('draft','published')`
          ));
        const diff = 7 * 24 * 3600 * 1000;
        const inserts = prevSchedules.map(s => ({
          userId: s.userId,
          restaurantId: s.restaurantId,
          startTime: new Date(s.startTime.getTime() + diff),
          endTime: new Date(s.endTime.getTime() + diff),
          note: s.note,
          createdBy: ctx.user.id,
          status: "draft" as const,
        }));
        if (inserts.length > 0) await db.insert(schedulesTable).values(inserts);
        return { copied: inserts.length };
      }),
    // 빠른 할당 (프리셋: open/fullday/close)
    quickAssign: managerProcedure
      .input(z.object({
        restaurantId: z.number(),
        userId: z.number(),
        workDate: z.string(),
        preset: z.enum(["open", "fullday", "close"]),
        note: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // 매장 운영시간 조회
        const db = await getDb();
        const { restaurants: restaurantsTable } = await import("../drizzle/schema");
        let openTime = "09:00";
        let closeTime = "22:00";
        if (db) {
          const rRows = await db.select({ openTime: restaurantsTable.openTime, closeTime: restaurantsTable.closeTime })
            .from(restaurantsTable).where(eq(restaurantsTable.id, input.restaurantId)).limit(1);
          if (rRows[0]?.openTime) openTime = rRows[0].openTime;
          if (rRows[0]?.closeTime) closeTime = rRows[0].closeTime;
        }
        // 반나절 시각 계산
        const [oh, om] = openTime.split(":").map(Number);
        const [ch, cm] = closeTime.split(":").map(Number);
        const midMins = Math.round((oh * 60 + om + ch * 60 + cm) / 2);
        const midTime = `${String(Math.floor(midMins / 60)).padStart(2, "0")}:${String(midMins % 60).padStart(2, "0")}`;
        const PRESETS = {
          open:    { start: openTime, end: midTime },
          fullday: { start: openTime, end: closeTime },
          close:   { start: midTime,  end: closeTime },
        };
        const p = PRESETS[input.preset];
        // 휴무일 차단
        if (await isClosedDay(input.restaurantId, input.workDate)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "해당 날짜는 휴무일입니다." });
        }
        const now = new Date();
        const result = await createSchedule({
          userId: input.userId,
          restaurantId: input.restaurantId,
          startTime: new Date(`${input.workDate}T${p.start}:00+09:00`),
          endTime: new Date(`${input.workDate}T${p.end}:00+09:00`),
          note: input.note,
          createdBy: ctx.user.id,
          status: "published",
          publishedAt: now,
        });
        // 배정 시 자동 고지: 해당 직원에게 스케줄 배정 알림 전송
        await createNotification({
          recipientId: input.userId,
          type: "schedule_assigned",
          title: "스케줄이 배정되었습니다",
          content: `${input.workDate} ${p.start}~${p.end} 스케줄이 배정되었습니다.`,
          restaurantId: input.restaurantId,
        });
        return result;
      }),
    // 범위 고지 (draft → published)
    publishRange: managerProcedure
      .input(z.object({ restaurantId: z.number(), from: z.string(), to: z.string() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { schedules: schedulesTable } = await import("../drizzle/schema");
        const now = new Date();
        await db.update(schedulesTable)
          .set({ status: "published", publishedAt: now })
          .where(and(
            eq(schedulesTable.restaurantId, input.restaurantId),
            gte(schedulesTable.startTime, new Date(input.from)),
            sql`${schedulesTable.startTime} <= ${new Date(input.to)}`,
            eq(schedulesTable.status, "draft")
          ));
        return { success: true };
      }),
    // 범위 완료 (published → completed)
    completeRange: managerProcedure
      .input(z.object({ restaurantId: z.number(), from: z.string(), to: z.string() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { schedules: schedulesTable } = await import("../drizzle/schema");
        const now = new Date();
        await db.update(schedulesTable)
          .set({ status: "completed", completedAt: now })
          .where(and(
            eq(schedulesTable.restaurantId, input.restaurantId),
            gte(schedulesTable.startTime, new Date(input.from)),
            sql`${schedulesTable.startTime} <= ${new Date(input.to)}`,
            eq(schedulesTable.status, "published")
          ));
        return { success: true };
      }),
    // 범위 인건비 확정 (completed → confirmed)
    confirmRange: managerProcedure
      .input(z.object({ restaurantId: z.number(), from: z.string(), to: z.string() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { schedules: schedulesTable } = await import("../drizzle/schema");
        const now = new Date();
        await db.update(schedulesTable)
          .set({ status: "confirmed", confirmedAt: now })
          .where(and(
            eq(schedulesTable.restaurantId, input.restaurantId),
            gte(schedulesTable.startTime, new Date(input.from)),
            sql`${schedulesTable.startTime} <= ${new Date(input.to)}`,
            eq(schedulesTable.status, "completed")
          ));
        return { success: true };
      }),
    // 향후 7일 스케줄 (대시보드 카드용)
    getUpcoming7Days: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const { schedules: schedulesTable, users: usersTable } = await import("../drizzle/schema");
        const now = new Date();
        const end = new Date(now);
        end.setDate(end.getDate() + 7);
        const rows = await db.select({
          id: schedulesTable.id,
          userId: schedulesTable.userId,
          userName: usersTable.name,
          startTime: schedulesTable.startTime,
          endTime: schedulesTable.endTime,
          status: schedulesTable.status,
          note: schedulesTable.note,
        }).from(schedulesTable)
          .leftJoin(usersTable, eq(schedulesTable.userId, usersTable.id))
          .where(and(
            eq(schedulesTable.restaurantId, input.restaurantId),
            gte(schedulesTable.startTime, now),
            sql`${schedulesTable.startTime} <= ${end}`,
            sql`${schedulesTable.status} IN ('published','confirmed')`
          ))
          .orderBy(schedulesTable.startTime);
        return rows;
      }),
    // 내일 스케줄 점검 (대시보드 카드용)
    getTomorrowCheck: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const { schedules: schedulesTable, users: usersTable } = await import("../drizzle/schema");
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tStart = new Date(toKSTDateString(tomorrow) + "T00:00:00");
        const tEnd = new Date(toKSTDateString(tomorrow) + "T23:59:59");
        const rows = await db.select({
          id: schedulesTable.id,
          userId: schedulesTable.userId,
          userName: usersTable.name,
          startTime: schedulesTable.startTime,
          endTime: schedulesTable.endTime,
          status: schedulesTable.status,
          note: schedulesTable.note,
        }).from(schedulesTable)
          .leftJoin(usersTable, eq(schedulesTable.userId, usersTable.id))
          .where(and(
            eq(schedulesTable.restaurantId, input.restaurantId),
            gte(schedulesTable.startTime, tStart),
            sql`${schedulesTable.startTime} <= ${tEnd}`
          ))
          .orderBy(schedulesTable.startTime);
        return rows;
      }),
    // 당일 종료된 스케줄만 완료 처리 (published → completed)
    // 마감 업무 시 사용: 오늘 날짜의 published 스케줄만 대상
    completeToday: managerProcedure
      .input(z.object({ restaurantId: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { schedules: schedulesTable } = await import("../drizzle/schema");
        // KST(UTC+9) 기준 오늘 날짜 계산
        const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
        const todayStr = nowKST.toISOString().split("T")[0]; // KST 날짜
        const dayStart = new Date(todayStr + "T00:00:00");
        const dayEnd = new Date(todayStr + "T23:59:59");
        const now = new Date();
        // 임시 근로자(userId IS NULL) 포함하여 published 상태 전체 완료 처리
        const result = await db.update(schedulesTable)
          .set({ status: "completed", completedAt: now })
          .where(and(
            eq(schedulesTable.restaurantId, input.restaurantId),
            gte(schedulesTable.startTime, dayStart),
            sql`${schedulesTable.startTime} <= ${dayEnd}`,
            eq(schedulesTable.status, "published")
          ));
        return { success: true, affected: (result as any)[0]?.affectedRows ?? 0 };
      }),
    // 지난 스케줄 조회 (completed/confirmed 상태, 월별)
    listPast: managerProcedure
      .input(z.object({
        restaurantId: z.number(),
        year: z.number(),
        month: z.number(), // 1-12
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const { schedules: schedulesTable, users: usersTable } = await import("../drizzle/schema");
        const monthStr = String(input.month).padStart(2, "0");
        const from = new Date(`${input.year}-${monthStr}-01T00:00:00`);
        const toDate = new Date(input.year, input.month, 1); // 다음달 1일
        const rows = await db.select({
          id: schedulesTable.id,
          userId: schedulesTable.userId,
          tempWorkerName: schedulesTable.tempWorkerName,
          tempWageType: schedulesTable.tempWageType,
          tempWageAmount: schedulesTable.tempWageAmount,
          userName: usersTable.name,
          startTime: schedulesTable.startTime,
          endTime: schedulesTable.endTime,
          status: schedulesTable.status,
          note: schedulesTable.note,
          editReason: schedulesTable.editReason,
          payrollRecheckRequired: schedulesTable.payrollRecheckRequired,
          confirmedAt: schedulesTable.confirmedAt,
          completedAt: schedulesTable.completedAt,
        }).from(schedulesTable)
          .leftJoin(usersTable, eq(schedulesTable.userId, usersTable.id))
          .where(and(
            eq(schedulesTable.restaurantId, input.restaurantId),
            gte(schedulesTable.startTime, from),
            sql`${schedulesTable.startTime} < ${toDate}`,
            sql`${schedulesTable.status} IN ('completed','confirmed')`
          ))
          .orderBy(schedulesTable.startTime);
        // 날짜/시간 문자열 변환 + 완료 시각 기준 급여 계산
        return rows.map(r => {
          const startTime = r.startTime instanceof Date ? r.startTime : new Date(r.startTime);
          const endTime = r.endTime instanceof Date ? r.endTime : new Date(r.endTime);
          const completedAt = r.completedAt instanceof Date ? r.completedAt : (r.completedAt ? new Date(r.completedAt as any) : null);

          // 실제 근무 종료 시각: completedAt이 있으면 사용, 없으면 endTime 사용
          const actualEndTime = completedAt ?? endTime;

          // 실제 근무시간 (시간 단위, 소수점 허용)
          const actualHours = Math.max(0, (actualEndTime.getTime() - startTime.getTime()) / (1000 * 60 * 60));

          // 임시 근로자 급여 계산
          let calculatedWage: number | null = null;
          if (r.tempWageAmount) {
            const wageAmount = parseFloat(String(r.tempWageAmount));
            if (r.tempWageType === "daily") {
              calculatedWage = wageAmount; // 일당: 고정
            } else {
              // 시급: completedAt 기준 실제 근무시간 × 시급
              calculatedWage = Math.round(actualHours * wageAmount);
            }
          }

          return {
            ...r,
            startTimeStr: startTime.toTimeString().slice(0,5),
            endTimeStr: endTime.toTimeString().slice(0,5),
            completedAtStr: completedAt ? completedAt.toTimeString().slice(0,5) : null,
            workDateStr: toKSTDateString(startTime),
            actualHours: Math.round(actualHours * 100) / 100, // 소수점 2자리
            calculatedWage, // 임시 근로자 급여 (원)
          };
        });
      }),
    // 지난 스케줄 수정 (완료/확정 상태, 인건비 정산 목적)
    updatePast: managerProcedure
      .input(z.object({
        id: z.number(),
        startTime: z.string(),  // "YYYY-MM-DDTHH:MM"
        endTime: z.string(),    // "YYYY-MM-DDTHH:MM"
        note: z.string().optional(),
        tempWorkerName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { schedules: schedulesTable } = await import("../drizzle/schema");
        const updateData: Record<string, any> = {
          startTime: new Date(input.startTime),
          endTime: new Date(input.endTime),
          payrollRecheckRequired: true,
        };
        if (input.note !== undefined) updateData.note = input.note;
        if (input.tempWorkerName !== undefined) updateData.tempWorkerName = input.tempWorkerName;
        await db.update(schedulesTable)
          .set(updateData)
          .where(and(
            eq(schedulesTable.id, input.id),
            sql`${schedulesTable.status} IN ('completed','confirmed')`
          ));
        return { success: true };
      }),
    // 임시/급구 근로자 스케줄 생성 (등록된 직원 아님)
    createTempWorker: managerProcedure
      .input(z.object({
        restaurantId: z.number(),
        tempWorkerName: z.string().min(1),
        workDate: z.string(),   // "YYYY-MM-DD"
        startTime: z.string(),  // "HH:MM"
        endTime: z.string(),    // "HH:MM"
        wageType: z.enum(["hourly", "daily"]).optional(),  // 시급 또는 일당
        wageAmount: z.number().optional(),  // 시급(원/시간) 또는 일당(원/일)
        note: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // 휴무일 차단
        if (await isClosedDay(input.restaurantId, input.workDate)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "해당 날짜는 휴무일입니다." });
        }
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { schedules: schedulesTable } = await import("../drizzle/schema");
        const startTime = new Date(`${input.workDate}T${input.startTime}:00+09:00`);
        const endTime = new Date(`${input.workDate}T${input.endTime}:00+09:00`);
        const [result] = await db.insert(schedulesTable).values({
          userId: null as any,
          tempWorkerName: input.tempWorkerName,
          tempWageType: input.wageType ?? null,
          tempWageAmount: input.wageAmount ? String(input.wageAmount) : null,
          restaurantId: input.restaurantId,
          startTime,
          endTime,
          status: "published",
          note: input.note,
          createdBy: ctx.user.id,
          publishedAt: new Date(),
        } as any);
        return { success: true, id: (result as any).insertId };
      }),
  }),
  // ── Schedule Change Requests ───────────────────────────────────────────────────
  scheduleChangeRequests: router({
    // 변경 요청 목록 (점장/매니저용)
    list: managerProcedure
      .input(z.object({ restaurantId: z.number(), status: z.enum(["pending", "approved", "rejected"]).optional() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const { scheduleChangeRequests, users: usersTable, schedules: schedulesTable } = await import("../drizzle/schema");
        const conditions = [eq(scheduleChangeRequests.restaurantId, input.restaurantId)];
        if (input.status) conditions.push(eq(scheduleChangeRequests.status, input.status));
        const rows = await db.select({
          id: scheduleChangeRequests.id,
          scheduleId: scheduleChangeRequests.scheduleId,
          requestedBy: scheduleChangeRequests.requestedBy,
          requestType: scheduleChangeRequests.requestType,
          reason: scheduleChangeRequests.reason,
          requestedStartTime: scheduleChangeRequests.requestedStartTime,
          requestedEndTime: scheduleChangeRequests.requestedEndTime,
          status: scheduleChangeRequests.status,
          reviewNote: scheduleChangeRequests.reviewNote,
          createdAt: scheduleChangeRequests.createdAt,
          requesterName: usersTable.name,
          scheduleStart: schedulesTable.startTime,
          scheduleEnd: schedulesTable.endTime,
        }).from(scheduleChangeRequests)
          .leftJoin(usersTable, eq(scheduleChangeRequests.requestedBy, usersTable.id))
          .leftJoin(schedulesTable, eq(scheduleChangeRequests.scheduleId, schedulesTable.id))
          .where(and(...conditions))
          .orderBy(desc(scheduleChangeRequests.createdAt));
        return rows;
      }),
    // 렬인 변경 요청 목록 (직원용)
    myRequests: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) return [];
        const { scheduleChangeRequests, schedules: schedulesTable } = await import("../drizzle/schema");
        return db.select().from(scheduleChangeRequests)
          .leftJoin(schedulesTable, eq(scheduleChangeRequests.scheduleId, schedulesTable.id))
          .where(and(
            eq(scheduleChangeRequests.restaurantId, input.restaurantId),
            eq(scheduleChangeRequests.requestedBy, ctx.user.id)
          ))
          .orderBy(desc(scheduleChangeRequests.createdAt));
      }),
    // 변경 요청 생성 (직원용)
    create: protectedProcedure
      .input(z.object({
        scheduleId: z.number(),
        restaurantId: z.number(),
        requestType: z.enum(["swap", "change", "off"]),
        reason: z.string().optional(),
        requestedStartTime: z.string().optional(),
        requestedEndTime: z.string().optional(),
        swapTargetScheduleId: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { scheduleChangeRequests } = await import("../drizzle/schema");
        const [result] = await db.insert(scheduleChangeRequests).values({
          scheduleId: input.scheduleId,
          requestedBy: ctx.user.id,
          restaurantId: input.restaurantId,
          requestType: input.requestType,
          reason: input.reason,
          requestedStartTime: input.requestedStartTime ? new Date(input.requestedStartTime) : undefined,
          requestedEndTime: input.requestedEndTime ? new Date(input.requestedEndTime) : undefined,
          swapTargetScheduleId: input.swapTargetScheduleId,
          status: "pending",
        });
        await createNotification({ type: "schedule_change", title: "스케줄 변경 요청", content: `${ctx.user.name ?? ctx.user.username}이(가) 스케줄 변경을 요청했습니다.`, restaurantId: input.restaurantId });
        await notifyOwner({ title: "스케줄 변경 요청", content: `${ctx.user.name ?? ctx.user.username}이(가) 스케줄 변경을 요청했습니다.` });
        return result;
      }),
    // 승인
    approve: managerProcedure
      .input(z.object({ id: z.number(), reviewNote: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { scheduleChangeRequests } = await import("../drizzle/schema");
        await db.update(scheduleChangeRequests)
          .set({ status: "approved", reviewedBy: ctx.user.id, reviewNote: input.reviewNote, reviewedAt: new Date() })
          .where(eq(scheduleChangeRequests.id, input.id));
        return { success: true };
      }),
    // 거절
    reject: managerProcedure
      .input(z.object({ id: z.number(), reviewNote: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { scheduleChangeRequests } = await import("../drizzle/schema");
        await db.update(scheduleChangeRequests)
          .set({ status: "rejected", reviewedBy: ctx.user.id, reviewNote: input.reviewNote, reviewedAt: new Date() })
          .where(eq(scheduleChangeRequests.id, input.id));
        return { success: true };
      }),
  }),

  // ── Employee Leavess (연차/대체휴무 관리) ──────────────────────────────────────────────────────────────────────────────────
  leaves: router({
    // 직원별 연차/휴무 조회
    list: managerProcedure
      .input(z.object({ restaurantId: z.number(), year: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const { employeeLeaves, users } = await import("../drizzle/schema");
        return db.select({
          id: employeeLeaves.id,
          userId: employeeLeaves.userId,
          userName: users.name,
          year: employeeLeaves.year,
          leaveType: employeeLeaves.leaveType,
          totalDays: employeeLeaves.totalDays,
          usedDays: employeeLeaves.usedDays,
          note: employeeLeaves.note,
        }).from(employeeLeaves)
          .leftJoin(users, eq(employeeLeaves.userId, users.id))
          .where(and(
            eq(employeeLeaves.restaurantId, input.restaurantId),
            eq(employeeLeaves.year, input.year)
          ));
      }),
    // 연차/휴무 저장 (upsert)
    upsert: managerProcedure
      .input(z.object({
        restaurantId: z.number(),
        userId: z.number(),
        year: z.number(),
        leaveType: z.enum(["annual", "substitute", "sick", "other"]),
        totalDays: z.number(),
        usedDays: z.number(),
        note: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { employeeLeaves } = await import("../drizzle/schema");
        const existing = await db.select({ id: employeeLeaves.id })
          .from(employeeLeaves)
          .where(and(
            eq(employeeLeaves.userId, input.userId),
            eq(employeeLeaves.restaurantId, input.restaurantId),
            eq(employeeLeaves.year, input.year),
            eq(employeeLeaves.leaveType, input.leaveType)
          ))
          .limit(1);
        if (existing.length > 0) {
          await db.update(employeeLeaves)
            .set({ totalDays: String(input.totalDays), usedDays: String(input.usedDays), note: input.note })
            .where(eq(employeeLeaves.id, existing[0].id));
        } else {
          await db.insert(employeeLeaves).values({
            userId: input.userId,
            restaurantId: input.restaurantId,
            year: input.year,
            leaveType: input.leaveType,
            totalDays: String(input.totalDays),
            usedDays: String(input.usedDays),
            note: input.note,
          });
        }
        return { success: true };
      }),
    // 직원별 월별 근무 요약 (휴무횟수, 총근무시간, 연차/대체휴무 현황)
    getStaffMonthlySummary: managerProcedure
      .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const { schedules: schedulesTable, users, employeeContracts, employeeLeaves, restaurantUsers } = await import("../drizzle/schema");
        const monthStr = String(input.month).padStart(2, "0");
        const from = new Date(`${input.year}-${monthStr}-01T00:00:00`);
        const toDate = new Date(input.year, input.month, 1);

        // 이번달 completed/confirmed 스케줄 전체 조회
        const rows = await db.select({
          userId: schedulesTable.userId,
          userName: users.name,
          startTime: schedulesTable.startTime,
          endTime: schedulesTable.endTime,
          completedAt: schedulesTable.completedAt,
          status: schedulesTable.status,
        }).from(schedulesTable)
          .leftJoin(users, eq(schedulesTable.userId, users.id))
          .where(and(
            eq(schedulesTable.restaurantId, input.restaurantId),
            gte(schedulesTable.startTime, from),
            sql`${schedulesTable.startTime} < ${toDate}`,
            sql`${schedulesTable.status} IN ('completed','confirmed')`
          ));

        // 이 매장 소속 직원 계약 조회
        const contracts = await db.select({
          userId: employeeContracts.userId,
          wageType: employeeContracts.wageType,
          wageAmount: employeeContracts.wageAmount,
          weeklyHours: employeeContracts.weeklyHours,
          position: employeeContracts.position,
        }).from(employeeContracts)
          .where(and(
            eq(employeeContracts.restaurantId, input.restaurantId),
            eq(employeeContracts.isActive, true)
          ));

        // 이 매장 소속 직원 목록
        const staffList = await db.select({
          userId: restaurantUsers.userId,
          userName: users.name,
        }).from(restaurantUsers)
          .leftJoin(users, eq(restaurantUsers.userId, users.id))
          .where(eq(restaurantUsers.restaurantId, input.restaurantId));

        // 연차/대체휴무 현황 조회
        const leaves = await db.select()
          .from(employeeLeaves)
          .where(and(
            eq(employeeLeaves.restaurantId, input.restaurantId),
            eq(employeeLeaves.year, input.year)
          ));

        // 직원별 집계
        const summaryMap = new Map<number, {
          userId: number;
          userName: string;
          totalWorkHours: number;
          workDays: number;
          offDays: number;
          contractWeeklyHours: number | null;
          wageType: string | null;
          wageAmount: number | null;
          position: string | null;
          annualLeaveTotal: number;
          annualLeaveUsed: number;
          substituteLeaveTotal: number;
          substituteLeaveUsed: number;
          estimatedWage: number;
        }>();

        // 직원 목록으로 초기화
        for (const staff of staffList) {
          if (!staff.userId) continue;
          const contract = contracts.find(c => c.userId === staff.userId);
          const annualLeave = leaves.find(l => l.userId === staff.userId && l.leaveType === "annual");
          const substituteLeave = leaves.find(l => l.userId === staff.userId && l.leaveType === "substitute");
          summaryMap.set(staff.userId, {
            userId: staff.userId,
            userName: staff.userName ?? `직원 ${staff.userId}`,
            totalWorkHours: 0,
            workDays: 0,
            offDays: 0,
            contractWeeklyHours: contract?.weeklyHours ? parseFloat(String(contract.weeklyHours)) : null,
            wageType: contract?.wageType ?? null,
            wageAmount: contract?.wageAmount ? parseFloat(String(contract.wageAmount)) : null,
            position: contract?.position ?? null,
            annualLeaveTotal: annualLeave ? parseFloat(String(annualLeave.totalDays)) : 0,
            annualLeaveUsed: annualLeave ? parseFloat(String(annualLeave.usedDays)) : 0,
            substituteLeaveTotal: substituteLeave ? parseFloat(String(substituteLeave.totalDays)) : 0,
            substituteLeaveUsed: substituteLeave ? parseFloat(String(substituteLeave.usedDays)) : 0,
            estimatedWage: 0,
          });
        }

        // 스케줄 기반 근무시간/근무일 집계
        for (const r of rows) {
          if (!r.userId) continue;
          const start = r.startTime instanceof Date ? r.startTime : new Date(r.startTime);
          const end = r.completedAt instanceof Date ? r.completedAt : (r.endTime instanceof Date ? r.endTime : new Date(r.endTime));
          const hours = Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60));
          const entry = summaryMap.get(r.userId);
          if (entry) {
            entry.totalWorkHours += hours;
            entry.workDays += 1;
          } else {
            summaryMap.set(r.userId, {
              userId: r.userId,
              userName: r.userName ?? `직원 ${r.userId}`,
              totalWorkHours: hours,
              workDays: 1,
              offDays: 0,
              contractWeeklyHours: null,
              wageType: null,
              wageAmount: null,
              position: null,
              annualLeaveTotal: 0,
              annualLeaveUsed: 0,
              substituteLeaveTotal: 0,
              substituteLeaveUsed: 0,
              estimatedWage: 0,
            });
          }
        }

        // 이번달 총 영업일 계산 (주휴일 제외 기준)
        const daysInMonth = new Date(input.year, input.month, 0).getDate();

        // 예상 인건비 계산 및 휴무일 계산
        const result = [];
        for (const entry of Array.from(summaryMap.values())) {
          // 계약 주간 근무일 기준으로 이번달 예상 근무일 계산
          const expectedWorkDaysPerWeek = entry.contractWeeklyHours ? Math.ceil(entry.contractWeeklyHours / 8) : 5;
          const weeksInMonth = daysInMonth / 7;
          const expectedWorkDays = Math.round(weeksInMonth * expectedWorkDaysPerWeek);
          entry.offDays = Math.max(0, expectedWorkDays - entry.workDays);

          // 예상 인건비
          if (entry.wageType === "hourly" && entry.wageAmount) {
            entry.estimatedWage = Math.round(entry.totalWorkHours * entry.wageAmount);
          } else if (entry.wageType === "monthly" && entry.wageAmount) {
            entry.estimatedWage = entry.wageAmount;
          }

          result.push(entry);
        }

        return result.sort((a, b) => a.userName.localeCompare(b.userName));
      }),
  }),

  // ── Holidays (대한민국 공휴일) ─────────────────────────────────────────────────────────────────
  holidays: router({
    getByMonth: protectedProcedure
      .input(z.object({ year: z.number(), month: z.number() }))
      .query(({ input }) => {
        return getHolidaysByMonth(input.year, input.month) as Array<{ date: string; name: string; isSubstitute?: boolean }>;
      }),
    getByYear: protectedProcedure
      .input(z.object({ year: z.number() }))
      .query(({ input }) => {
        return getHolidaysByYear(input.year) as Array<{ date: string; name: string; isSubstitute?: boolean }>;
      }),
  }),
  // ── Sales ──────────────────────────────────────────────────────────────────────────────────
  sales: router({   listByMonth: protectedProcedure
      .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
      .query(async ({ input, ctx }) => {
        await assertRestaurantAccess(ctx.user.id, ctx.user.role, input.restaurantId);
        return getSalesByRestaurantAndMonth(input.restaurantId, input.year, input.month);
      }),
    listByDate: protectedProcedure
      .input(z.object({ restaurantId: z.number(), date: z.string() }))
      .query(({ input }) => getSalesByRestaurantAndDate(input.restaurantId, input.date)),
    create: protectedProcedure
      .input(z.object({
        restaurantId: z.number(),
        saleDate: z.string(),
        amount: z.number(),
        note: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // 휴무일 차단
        if (await isClosedDay(input.restaurantId, input.saleDate)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "휴무일에는 매출을 입력할 수 없습니다." });
        }
        const restaurant = await getRestaurantById(input.restaurantId);
        // 시간 제한: 점장 이상은 우회, 과거 날짜 입력은 면제
        const isManagerOrAbove = ctx.user.role === "master" || ctx.user.role === "admin" || ctx.user.role === "manager";
        const todayForCheck = todayKST();
        const isPastDate = input.saleDate < todayForCheck;
        if (restaurant?.salesInputStartTime && restaurant?.salesInputEndTime && !isManagerOrAbove && !isPastDate) {
          const now = new Date();
          const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
          if (hhmm < restaurant.salesInputStartTime || hhmm > restaurant.salesInputEndTime) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `매출 입력 가능 시간은 ${restaurant.salesInputStartTime} ~ ${restaurant.salesInputEndTime} 입니다.`,
            });
          }
        }
        const sale = await createSale({
          ...input,
          saleDate: input.saleDate as unknown as Date,
          amount: input.amount.toString(),
          recordedBy: ctx.user.id,
        });
        const d = new Date(input.saleDate);
        const total = await getMonthlySalesTotal(input.restaurantId, d.getFullYear(), d.getMonth() + 1);
        const target = parseFloat(restaurant?.monthlyTargetSales ?? "0");
        if (target > 0 && total >= target) {
          await notifyOwner({ title: "🎉 매출 목표 달성!", content: `${restaurant?.name} 매장이 이번 달 매출 목표(${target.toLocaleString()}원)를 달성했습니다.` });
          await createNotification({ type: "target_achieved", title: "매출 목표 달성!", content: `${restaurant?.name} 매장이 이번 달 매출 목표를 달성했습니다.`, restaurantId: input.restaurantId });
        }
        return sale;
      }),
    update: protectedProcedure
      .input(z.object({ id: z.number(), amount: z.number().optional(), note: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        // 소속 매장 검증: 이 매출 레코드가 사용자의 매장에 속하는지 확인
        const db = await getDb();
        if (db) {
          const { sales: salesTable } = await import("../drizzle/schema");
          const [row] = await db.select({ restaurantId: salesTable.restaurantId }).from(salesTable).where(eq(salesTable.id, input.id)).limit(1);
          if (row?.restaurantId) {
            await requireManagerOrStoreRole(ctx.user.id, ctx.user.role, row.restaurantId);
          }
        }
        const { id, amount, ...rest } = input;
        return updateSale(id, { ...rest, ...(amount !== undefined ? { amount: amount.toString() } : {}) });
      }),
    delete: managerProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        // 소속 매장 검증
        const db = await getDb();
        if (db) {
          const { sales: salesTable } = await import("../drizzle/schema");
          const [row] = await db.select({ restaurantId: salesTable.restaurantId }).from(salesTable).where(eq(salesTable.id, input.id)).limit(1);
          if (row?.restaurantId) await requireManagerOrStoreRole(ctx.user.id, ctx.user.role, row.restaurantId);
        }
        return deleteSale(input.id);
      }),
    latestMonth: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;
        const { sales: salesTable } = await import("../drizzle/schema");
        const rows = await db
          .select({ saleDate: salesTable.saleDate })
          .from(salesTable)
          .where(eq(salesTable.restaurantId, input.restaurantId))
          .orderBy(desc(salesTable.saleDate))
          .limit(1);
        if (rows.length === 0) return null;
        const d = new Date(rows[0].saleDate);
        return { year: d.getFullYear(), month: d.getMonth() + 1 };
      }),
  }),

  // ── Purchases ─────────────────────────────────────────────────────────────
  purchases: router({
    listByMonth: protectedProcedure
      .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
      .query(async ({ input, ctx }) => {
        await assertRestaurantAccess(ctx.user.id, ctx.user.role, input.restaurantId);
        return getPurchasesByRestaurantAndMonth(input.restaurantId, input.year, input.month);
      }),
    // 거래처별 최근 매입 항목 자동완성용
    listVendorItems: protectedProcedure
      .input(z.object({ restaurantId: z.number(), vendorName: z.string() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        // 해당 거래처의 최근 매입 항목 목록 (중복 제거, 최근 30개)
        const rows = await db.select({
          itemName: purchasesTable.itemName,
          cost: purchasesTable.cost,
          category: purchasesTable.category,
        }).from(purchasesTable)
          .where(and(eq(purchasesTable.restaurantId, input.restaurantId), eq(purchasesTable.vendorName, input.vendorName)))
          .orderBy(desc(purchasesTable.createdAt))
          .limit(100);
        // 품목명 기준 중복 제거 (가장 최근 가격 유지)
        const seen = new Set<string>();
        return rows.filter(r => { if (seen.has(r.itemName)) return false; seen.add(r.itemName); return true; }).slice(0, 30);
      }),
    // 거래처 목록 조회 (자동완성용)
    listVendors: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const rows = await db.select({ vendorName: purchasesTable.vendorName })
          .from(purchasesTable)
          .where(and(eq(purchasesTable.restaurantId, input.restaurantId), sql`${purchasesTable.vendorName} IS NOT NULL`))
          .orderBy(desc(purchasesTable.createdAt))
          .limit(200);
        const seen = new Set<string>();
        return rows.filter(r => r.vendorName && !seen.has(r.vendorName!) && seen.add(r.vendorName!)).map(r => r.vendorName!);
      }),
    // 발주 중인 항목 목록 (입고 확인 대기)
    listOrdered: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        return db.select().from(purchasesTable)
          .where(and(eq(purchasesTable.restaurantId, input.restaurantId), eq(purchasesTable.purchaseStatus, "ordered")))
          .orderBy(purchasesTable.expectedArrivalDate);
      }),
    // 입고 확인 처리
    confirmArrival: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        // 소속 매장 검증: 로그인만 하면 다른 매장 입고 확인이 가능한 문제 방지
        const [pRow] = await db.select({ restaurantId: purchasesTable.restaurantId }).from(purchasesTable).where(eq(purchasesTable.id, input.id)).limit(1);
        if (pRow?.restaurantId) {
          await requireManagerOrStoreRole(ctx.user.id, ctx.user.role, pRow.restaurantId);
        }
        await db.update(purchasesTable)
          .set({ purchaseStatus: "received", arrivedAt: new Date(), arrivedBy: ctx.user.id })
          .where(eq(purchasesTable.id, input.id));
        return { success: true };
      }),
    create: protectedProcedure
      .input(z.object({
        restaurantId: z.number(),
        purchaseDate: z.string(),
        vendorName: z.string().optional(),
        itemName: z.string(),
        cost: z.number(),
        category: z.enum(["food", "supply", "utility", "other"]).optional(),
        note: z.string().optional(),
        receiptImageUrl: z.string().optional(),
        receiptImageKey: z.string().optional(),
        purchaseStatus: z.enum(["received", "ordered"]).optional(),
        expectedArrivalDate: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // 휴무일 차단
        if (await isClosedDay(input.restaurantId, input.purchaseDate)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "휴무일에는 매입을 입력할 수 없습니다." });
        }
        const purchase = await createPurchase({
          ...input,
          purchaseDate: input.purchaseDate as unknown as Date,
          expectedArrivalDate: input.expectedArrivalDate as unknown as Date | undefined,
          cost: input.cost.toString(),
          recordedBy: ctx.user.id,
          purchaseStatus: input.purchaseStatus ?? "received",
        });
        const d = new Date(input.purchaseDate);
        const [purchTotal, fixedTotal, laborTotal] = await Promise.all([
          getMonthlyPurchasesTotal(input.restaurantId, d.getFullYear(), d.getMonth() + 1),
          getMonthlyFixedCostsTotal(input.restaurantId, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`),
          calculateMonthlyLaborCost(input.restaurantId, d.getFullYear(), d.getMonth() + 1),
        ]);
        const salesTotal = await getMonthlySalesTotal(input.restaurantId, d.getFullYear(), d.getMonth() + 1);
        const restaurant = await getRestaurantById(input.restaurantId);
        const targetRatio = parseFloat(restaurant?.targetCostRatio ?? "80");
        if (salesTotal > 0) {
          const totalCost = purchTotal + fixedTotal + laborTotal;
          const ratio = (totalCost / salesTotal) * 100;
          if (ratio > targetRatio) {
            await notifyOwner({ title: "⚠️ 비용 초과 경고", content: `${restaurant?.name} 매장의 총 비용 비율이 ${ratio.toFixed(1)}%로 목표(${targetRatio}%)를 초과했습니다.` });
            await createNotification({ type: "cost_exceeded", title: "비용 초과 경고", content: `${restaurant?.name} 총 비용 비율 ${ratio.toFixed(1)}% (목표: ${targetRatio}%)`, restaurantId: input.restaurantId });
          }
        }
        return purchase;
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        vendorName: z.string().optional(),
        itemName: z.string().optional(),
        cost: z.number().optional(),
        category: z.enum(["food", "supply", "utility", "other"]).optional(),
        note: z.string().optional(),
        receiptImageUrl: z.string().optional(),
      }))
      .mutation(({ input }) => {
        const { id, cost, ...rest } = input;
        return updatePurchase(id, { ...rest, ...(cost !== undefined ? { cost: cost.toString() } : {}) });
      }),
    delete: managerProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (db) {
          const [row] = await db.select({ restaurantId: purchasesTable.restaurantId }).from(purchasesTable).where(eq(purchasesTable.id, input.id)).limit(1);
          if (row?.restaurantId) await requireManagerOrStoreRole(ctx.user.id, ctx.user.role, row.restaurantId);
        }
        return deletePurchase(input.id);
      }),
    uploadReceipt: protectedProcedure
      .input(z.object({ base64: z.string(), filename: z.string(), mimeType: z.string() }))
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.base64, "base64");
        const key = `receipts/${Date.now()}_${input.filename}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        return { url, key };
      }),
  }),

  // ── Fixed Costs ───────────────────────────────────────────────────────────
  fixedCosts: router({
    listByMonth: protectedProcedure
      .input(z.object({ restaurantId: z.number(), effectiveMonth: z.string() }))
      .query(({ input }) => getFixedCostsByMonth(input.restaurantId, input.effectiveMonth)),
    create: managerProcedure
      .input(z.object({
        restaurantId: z.number(),
        effectiveMonth: z.string(),
        costCategory: z.string(),
        categoryType: z.enum(["rent", "utility", "fee", "labor_fixed", "other"]).optional(),
        amount: z.number(),
        note: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }))
      .mutation(({ input, ctx }) => createFixedCost({
        ...input,
        amount: input.amount.toString(),
        createdBy: ctx.user.id,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      })),
    update: managerProcedure
      .input(z.object({
        id: z.number(),
        costCategory: z.string().optional(),
        amount: z.number().optional(),
        note: z.string().optional(),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (db) {
          const { monthlyFixedCosts } = await import("../drizzle/schema");
          const [row] = await db.select({ restaurantId: monthlyFixedCosts.restaurantId }).from(monthlyFixedCosts).where(eq(monthlyFixedCosts.id, input.id)).limit(1);
          if (row?.restaurantId) await requireManagerOrStoreRole(ctx.user.id, ctx.user.role, row.restaurantId);
        }
        const { id, amount, startDate, endDate, ...rest } = input;
        return updateFixedCost(id, {
          ...rest,
          ...(amount !== undefined ? { amount: amount.toString() } : {}),
          ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
          ...(endDate !== undefined ? { endDate: endDate ? new Date(endDate) : null } : {}),
        });
      }),
    delete: managerProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (db) {
          const { monthlyFixedCosts } = await import("../drizzle/schema");
          const [row] = await db.select({ restaurantId: monthlyFixedCosts.restaurantId }).from(monthlyFixedCosts).where(eq(monthlyFixedCosts.id, input.id)).limit(1);
          if (row?.restaurantId) await requireManagerOrStoreRole(ctx.user.id, ctx.user.role, row.restaurantId);
        }
        return deleteFixedCost(input.id);
      }),
    // 고정비 만료 임박 항목 조회 (30일 이내 종료 예정)
    getExpiringSoon: managerProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        const { monthlyFixedCosts } = await import("../drizzle/schema");
        const today = new Date();
        const in30days = new Date(today);
        in30days.setDate(in30days.getDate() + 30);
        const todayStr = toKSTDateString(today);
        const in30Str = toKSTDateString(in30days);
        if (!db) return [];
        const rows = await db.select().from(monthlyFixedCosts)
          .where(
            and(
              eq(monthlyFixedCosts.restaurantId, input.restaurantId),
              isNotNull(monthlyFixedCosts.endDate),
              sql`${monthlyFixedCosts.endDate} >= ${todayStr}`,
              sql`${monthlyFixedCosts.endDate} <= ${in30Str}`
            )
          );
        return rows;
      }),
  }),

  // ── Profitability ─────────────────────────────────────────────────────────
  profitability: router({
    monthly: protectedProcedure
      .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
      .query(async ({ input, ctx }) => {
        await assertRestaurantAccess(ctx.user.id, ctx.user.role, input.restaurantId);
        const { restaurantId, year, month } = input;
        const monthStr = `${year}-${String(month).padStart(2, "0")}`;
        const [salesTotal, purchasesTotal, fixedCostsTotal, laborCost, restaurant, laborByUser, fixedByCategory] = await Promise.all([
          getMonthlySalesTotal(restaurantId, year, month),
          getMonthlyPurchasesTotal(restaurantId, year, month),
          getMonthlyFixedCostsTotal(restaurantId, monthStr),
          calculateMonthlyLaborCost(restaurantId, year, month),
          getRestaurantById(restaurantId),
          calculateMonthlyLaborCostByUser(restaurantId, year, month),
          getFixedCostsByCategory(restaurantId, monthStr),
        ]);
        const totalCost = purchasesTotal + fixedCostsTotal + laborCost;
        const profit = salesTotal - totalCost;
        const costRatio = salesTotal > 0 ? (totalCost / salesTotal) * 100 : 0;
        const laborRatio = salesTotal > 0 ? (laborCost / salesTotal) * 100 : 0;
        const purchaseRatio = salesTotal > 0 ? (purchasesTotal / salesTotal) * 100 : 0;
        const fixedRatio = salesTotal > 0 ? (fixedCostsTotal / salesTotal) * 100 : 0;
        // 고정비 카테고리별 비율
        const fixedBycat = fixedByCategory.map(c => ({
          ...c,
          ratio: salesTotal > 0 ? (c.total / salesTotal) * 100 : 0,
        }));
        // 매니저(storeRole=manager) 역할 확인: 인건비 상세 비공개
        const sysLevel = ROLE_LEVEL[ctx.user.role] ?? 0;
        let isStoreManager = false;
        if (sysLevel < ROLE_LEVEL["manager"]) {
          // 시스템 역할이 manager 미만이면 매장 내 역할 확인
          const db = await getDb();
          if (db) {
            const { restaurantUsers } = await import("../drizzle/schema");
            const rows = await db.select({ role: restaurantUsers.role })
              .from(restaurantUsers)
              .where(and(eq(restaurantUsers.restaurantId, restaurantId), eq(restaurantUsers.userId, ctx.user.id)))
              .limit(1);
            isStoreManager = rows[0]?.role === "manager";
          }
        }
        // 점장(leader) 또는 admin 이상이면 전체 데이터 반환, 매니저는 laborByUser 제외
        const canSeeLaborDetail = sysLevel >= ROLE_LEVEL["admin"] || (!isStoreManager && await checkStoreLeaderRole(ctx.user.id, restaurantId));
        return {
          salesTotal, purchasesTotal, fixedCostsTotal, laborCost, totalCost, profit,
          costRatio, laborRatio, purchaseRatio, fixedRatio,
          targetCostRatio: parseFloat(restaurant?.targetCostRatio ?? "80"),
          targetLaborRatio: parseFloat(restaurant?.targetLaborRatio ?? "30"),
          monthlyTargetSales: parseFloat(restaurant?.monthlyTargetSales ?? "0"),
          // 매니저는 인건비 상세(직원별 인건비) 비공개
          laborByUser: canSeeLaborDetail ? laborByUser : null,
          fixedByCategory: fixedBycat,
        };
      }),
    daily: protectedProcedure
      .input(z.object({ restaurantId: z.number(), date: z.string() }))
      .query(async ({ input, ctx }) => {
        await assertRestaurantAccess(ctx.user.id, ctx.user.role, input.restaurantId);
        const [salesTotal, laborCost] = await Promise.all([
          getDailySalesTotal(input.restaurantId, input.date),
          calculateDailyLaborCost(input.restaurantId, input.date),
        ]);
        const laborRatio = salesTotal > 0 ? (laborCost / salesTotal) * 100 : 0;
        // 매니저(storeRole=manager) 역할 확인: 인건비 숨김
        const sysLevel = ROLE_LEVEL[ctx.user.role] ?? 0;
        let isStoreManagerOnly = false;
        if (sysLevel < ROLE_LEVEL["admin"]) {
          const storeRole = await getStoreRole(ctx.user.id, input.restaurantId);
          isStoreManagerOnly = storeRole === "manager";
        }
        return {
          salesTotal,
          laborCost: isStoreManagerOnly ? null : laborCost,
          laborRatio,
        };
      }),
    allRestaurants: adminProcedure
      .input(z.object({ year: z.number(), month: z.number() }))
      .query(async ({ input }) => {
        const rests = await getAllRestaurants();
        const results = await Promise.all(rests.map(async (r) => {
          const { year, month } = input;
          const monthStr = `${year}-${String(month).padStart(2, "0")}`;
          const [salesTotal, purchasesTotal, fixedCostsTotal, laborCost] = await Promise.all([
            getMonthlySalesTotal(r.id, year, month),
            getMonthlyPurchasesTotal(r.id, year, month),
            getMonthlyFixedCostsTotal(r.id, monthStr),
            calculateMonthlyLaborCost(r.id, year, month),
          ]);
          const totalCost = purchasesTotal + fixedCostsTotal + laborCost;
          const profit = salesTotal - totalCost;
          const costRatio = salesTotal > 0 ? (totalCost / salesTotal) * 100 : 0;
          return { ...r, salesTotal, purchasesTotal, fixedCostsTotal, laborCost, totalCost, profit, costRatio };
        }));
        return results;
      }),
  }),

  // ── Notifications ─────────────────────────────────────────────────────────
  notifications: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role === "master" || ctx.user.role === "admin") return getMasterNotifications();
      return getNotificationsByRecipient(ctx.user.id);
    }),
    markRead: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ input }) => markNotificationRead(input.id)),
     create: adminProcedure
      .input(z.object({
        type: z.enum(["schedule_change", "cost_exceeded", "target_achieved", "general"]),
        title: z.string(),
        content: z.string().optional(),
        restaurantId: z.number().optional(),
        recipientId: z.number().optional(),
      }))
      .mutation(({ input }) => createNotification(input)),
  }),

  restaurantContracts: router({
    // 매장의 계약 조건 목록 조회
    list: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ ctx, input }) => {
        await requireManagerOrStoreRole(ctx.user.id, ctx.user.role, input.restaurantId);
        return getRestaurantContractsByRestaurant(input.restaurantId);
      }),
    // 계약 조건 생성
    create: protectedProcedure
      .input(z.object({
        restaurantId: z.number(),
        contractType: z.enum(["rent", "commission", "royalty", "investor", "other"]),
        name: z.string().min(1),
        calcType: z.enum(["fixed", "ratio"]),
        fixedAmount: z.number().optional(),
        ratioPercent: z.number().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        note: z.string().optional(),
        autoApplyToFixedCost: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "manager");
        await createRestaurantContract({ ...input, createdBy: ctx.user.id });
        // 자동 반영 설정 시 현재 월 고정비 동기화
        if (input.autoApplyToFixedCost !== false) {
          const now = new Date();
          const effectiveMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          const [yr, mo] = effectiveMonth.split("-").map(Number);
          const monthlySales = await getMonthlySalesTotal(input.restaurantId, yr, mo);
          await syncContractToFixedCosts(input.restaurantId, effectiveMonth, monthlySales, ctx.user.id);
        }
        return { success: true };
      }),
    // 계약 조건 수정
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        contractType: z.enum(["rent", "commission", "royalty", "investor", "other"]).optional(),
        name: z.string().optional(),
        calcType: z.enum(["fixed", "ratio"]).optional(),
        fixedAmount: z.number().optional(),
        ratioPercent: z.number().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        note: z.string().optional(),
        autoApplyToFixedCost: z.boolean().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "manager");
        const { id, ...data } = input;
        await updateRestaurantContract(id, data);
        // 수정 후 현재 월 고정비 동기화
        const _db1 = await getDb();
        const updatedContract = _db1
          ? (await _db1.select().from(restaurantContractsTable).where(eq(restaurantContractsTable.id, id)).limit(1))[0] ?? null
          : null;
        if (updatedContract) {
          const now = new Date();
          const effectiveMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          const [yr, mo] = effectiveMonth.split("-").map(Number);
          const monthlySales = await getMonthlySalesTotal(updatedContract.restaurantId, yr, mo);
          await syncContractToFixedCosts(updatedContract.restaurantId, effectiveMonth, monthlySales, ctx.user.id);
        }
        return { success: true };
      }),
    // 계약 조건 삭제 (soft delete)
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "manager");
        // 삭제 전 restaurantId 저장
        const _db2 = await getDb();
        const contractToDelete = _db2
          ? (await _db2.select().from(restaurantContractsTable).where(eq(restaurantContractsTable.id, input.id)).limit(1))[0] ?? null
          : null;
        await deleteRestaurantContract(input.id);
        // 삭제 후 현재 월 고정비 동기화 (삭제된 계약 관련 항목 제거)
        if (contractToDelete) {
          const now = new Date();
          const effectiveMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          const [yr, mo] = effectiveMonth.split("-").map(Number);
          const monthlySales = await getMonthlySalesTotal(contractToDelete.restaurantId, yr, mo);
          await syncContractToFixedCosts(contractToDelete.restaurantId, effectiveMonth, monthlySales, ctx.user.id);
        }
        return { success: true };
      }),
    // 계약 조건 기반 고정비 자동 계산 (해당 월 매출 기준)
    applyToFixedCosts: protectedProcedure
      .input(z.object({ restaurantId: z.number(), effectiveMonth: z.string() }))
      .query(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "manager");
        const [yr, mo] = input.effectiveMonth.split("-").map(Number);
        const monthlySales = await getMonthlySalesTotal(input.restaurantId, yr, mo);
        return applyContractsToFixedCosts(input.restaurantId, input.effectiveMonth, monthlySales);
      }),
    // 수동 동기화: 선택한 월의 고정비를 계약 조건 기준으로 동기화
    syncToFixedCosts: protectedProcedure
      .input(z.object({ restaurantId: z.number(), effectiveMonth: z.string() }))
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "manager");
        const [yr, mo] = input.effectiveMonth.split("-").map(Number);
        const monthlySales = await getMonthlySalesTotal(input.restaurantId, yr, mo);
        await syncContractToFixedCosts(input.restaurantId, input.effectiveMonth, monthlySales, ctx.user.id);
        return { success: true, message: `${input.effectiveMonth} 고정비가 계약 조건 기준으로 동기화되었습니다.` };
      }),
  }),
  electronicContracts: electronicContractsRouter,

  // ─── Daily Operations (오픈/마감 체크) ──────────────────────────────────────────
  dailyOps: router({
    // 오늘 오픈/마감 레코드 조회
    getToday: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;
        const { dailyOperations } = await import("../drizzle/schema");
        const today = todayKST();
        const [row] = await db.select().from(dailyOperations)
          .where(and(eq(dailyOperations.restaurantId, input.restaurantId), sql`${dailyOperations.operationDate} = ${today}`));
        return row ?? null;
      }),
    // 오픈 체크: 당일 출근 인원 확인 + 인건비 반영
    openCheck: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await requireManagerOrStoreRole(ctx.user.id, ctx.user.role, input.restaurantId);
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { dailyOperations } = await import("../drizzle/schema");
        const today = todayKST();
        // 당일 출근 인원 및 인건비 계산 (KST 기준)
        const laborCost = await calculateDailyLaborCost(input.restaurantId, today);
        const { schedules: schedulesTable } = await import("../drizzle/schema");
        // KST 기준 오늘의 UTC 시작/종료 시각
        const dayStart = kstDayStartUTC(today);
        const dayEnd = kstDayEndUTC(today);
        const todaySchedules = await db.select().from(schedulesTable)
          .where(and(
            eq(schedulesTable.restaurantId, input.restaurantId),
            gte(schedulesTable.startTime, dayStart),
            sql`${schedulesTable.startTime} <= ${dayEnd}`,
            sql`${schedulesTable.status} IN ('published', 'confirmed')`
          ));
        const headcount = todaySchedules.length;
        // upsert
        const [existing] = await db.select().from(dailyOperations)
          .where(and(eq(dailyOperations.restaurantId, input.restaurantId), sql`${dailyOperations.operationDate} = ${today}`));
        if (existing) {
          await db.update(dailyOperations)
            .set({ openCheckedAt: new Date(), openCheckedBy: ctx.user.id, openHeadcount: headcount, openLaborCost: String(laborCost) })
            .where(eq(dailyOperations.id, existing.id));
        } else {
          await db.insert(dailyOperations).values({
            restaurantId: input.restaurantId, operationDate: sql`${today}`,
            openCheckedAt: new Date(), openCheckedBy: ctx.user.id,
            openHeadcount: headcount, openLaborCost: String(laborCost),
          });
        }
        return { headcount, laborCost };
      }),
     // 마감 체크: 마감 시간 기록
    closeCheck: protectedProcedure
      .input(z.object({ restaurantId: z.number(), closeNote: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        await requireManagerOrStoreRole(ctx.user.id, ctx.user.role, input.restaurantId);
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { dailyOperations, dailySalesDetail } = await import("../drizzle/schema");
        const today = todayKST();
        // 매입 입력 여부 확인 (미제출이어도 마감은 허용, 경고만 반환)
        const [salesRow] = await db.select().from(dailySalesDetail)
          .where(and(eq(dailySalesDetail.restaurantId, input.restaurantId), sql`${dailySalesDetail.saleDate} = ${today}`));
        const salesWarning = (!salesRow || salesRow.status === "draft") ? "매입이 아직 제출되지 않았습니다. 마감 후 매입을 제출해 주세요." : undefined;
        // 마감 시 인건비 재계산 (KST 기준)
        const laborCost = await calculateDailyLaborCost(input.restaurantId, today);
        const { schedules: schedulesTable } = await import("../drizzle/schema");
        const dayStart = kstDayStartUTC(today);
        const dayEnd = kstDayEndUTC(today);
        const todaySchedules = await db.select().from(schedulesTable)
          .where(and(
            eq(schedulesTable.restaurantId, input.restaurantId),
            gte(schedulesTable.startTime, dayStart),
            sql`${schedulesTable.startTime} <= ${dayEnd}`,
            sql`${schedulesTable.status} IN ('published', 'confirmed')`
          ));
        const headcount = todaySchedules.length;
        const [existingClose] = await db.select().from(dailyOperations)
          .where(and(eq(dailyOperations.restaurantId, input.restaurantId), sql`${dailyOperations.operationDate} = ${today}`));
        if (existingClose) {
          await db.update(dailyOperations)
            .set({ closeCheckedAt: new Date(), closeCheckedBy: ctx.user.id, closeHeadcount: headcount, closeLaborCost: String(laborCost), closeNote: input.closeNote })
            .where(eq(dailyOperations.id, existingClose.id));
        } else {
          await db.insert(dailyOperations).values({
            restaurantId: input.restaurantId, operationDate: sql`${today}`,
            closeCheckedAt: new Date(), closeCheckedBy: ctx.user.id,
            closeHeadcount: headcount, closeLaborCost: String(laborCost), closeNote: input.closeNote,
          });
        }
        return { headcount, laborCost, salesWarning };
      }),
    // 오픈/마감 이력 조회
    list: protectedProcedure
      .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const { dailyOperations } = await import("../drizzle/schema");
        const monthStr = `${input.year}-${String(input.month).padStart(2, "0")}`;
        return db.select().from(dailyOperations)
          .where(and(
            eq(dailyOperations.restaurantId, input.restaurantId),
            sql`DATE_FORMAT(${dailyOperations.operationDate}, '%Y-%m') = ${monthStr}`
          ))

          .orderBy(desc(dailyOperations.operationDate));
      }),
  }),

  // ─── Daily Sales Detail (일 매출 상세) ──────────────────────────────────────────
  dailySales: router({
    // 특정 날짜 매출 상세 조회
    getByDate: protectedProcedure
      .input(z.object({ restaurantId: z.number(), saleDate: z.string() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;
        const { dailySalesDetail, salesOtherItems } = await import("../drizzle/schema");
        const [detail] = await db.select().from(dailySalesDetail)
          .where(and(eq(dailySalesDetail.restaurantId, input.restaurantId), sql`${dailySalesDetail.saleDate} = ${input.saleDate}`));
        if (!detail) return null;
        const otherItems = await db.select().from(salesOtherItems)
          .where(eq(salesOtherItems.dailySalesDetailId, detail.id));
        return { ...detail, otherItems };
      }),
    // 월별 매출 상세 조회
    listByMonth: protectedProcedure
      .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const { dailySalesDetail } = await import("../drizzle/schema");
        const monthStr = `${input.year}-${String(input.month).padStart(2, "0")}`;
        return db.select().from(dailySalesDetail)
          .where(and(
            eq(dailySalesDetail.restaurantId, input.restaurantId),
            sql`DATE_FORMAT(${dailySalesDetail.saleDate}, '%Y-%m') = ${monthStr}`
          ))

          .orderBy(desc(dailySalesDetail.saleDate));
      }),
    // 매출 상세 저장/수정 (draft 또는 submitted)
    upsert: protectedProcedure
      .input(z.object({
        restaurantId: z.number(),
        saleDate: z.string(),
        cashAmount: z.number().min(0),
        cardAmount: z.number().min(0),
        receiptCount: z.number().min(0),
        discountAmount: z.number().min(0),
        otherItems: z.array(z.object({ itemName: z.string().min(1), amount: z.number().min(0) })),
        note: z.string().optional(),
        submit: z.boolean().default(false), // true면 submitted 상태
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { dailySalesDetail, salesOtherItems, salesOtherItemTemplates } = await import("../drizzle/schema");
        const otherAmount = input.otherItems.reduce((s, i) => s + i.amount, 0);
        const totalAmount = input.cashAmount + input.cardAmount + otherAmount - input.discountAmount;
        const status = input.submit ? "submitted" : "draft";
        // 기존 레코드 확인
        const [existing] = await db.select().from(dailySalesDetail)
          .where(and(eq(dailySalesDetail.restaurantId, input.restaurantId), sql`${dailySalesDetail.saleDate} = ${input.saleDate}`));
        // confirmed 상태면 수정 불가 (점장/매니저만 가능)
        if (existing?.status === "confirmed") {
          await requireManagerOrStoreRole(ctx.user.id, ctx.user.role, input.restaurantId);
        }
        let detailId: number;
        if (existing) {
          await db.update(dailySalesDetail)
            .set({ cashAmount: String(input.cashAmount), cardAmount: String(input.cardAmount), receiptCount: input.receiptCount, discountAmount: String(input.discountAmount), otherAmount: String(otherAmount), totalAmount: String(totalAmount), status, recordedBy: ctx.user.id, note: input.note ?? null })
            .where(eq(dailySalesDetail.id, existing.id));
          detailId = existing.id;
          // 기존 기타 항목 삭제 후 재삽입
          await db.delete(salesOtherItems).where(eq(salesOtherItems.dailySalesDetailId, detailId));
        } else {
          const [inserted] = await db.insert(dailySalesDetail).values({
            restaurantId: input.restaurantId, saleDate: sql`${input.saleDate}`,
            cashAmount: String(input.cashAmount), cardAmount: String(input.cardAmount),
            receiptCount: input.receiptCount, discountAmount: String(input.discountAmount),
            otherAmount: String(otherAmount), totalAmount: String(totalAmount),
            status, recordedBy: ctx.user.id, note: input.note ?? null,
          });
          detailId = (inserted as any).insertId;
        }
        // 기타 항목 삽입
        if (input.otherItems.length > 0) {
          await db.insert(salesOtherItems).values(
            input.otherItems.map(i => ({ dailySalesDetailId: detailId, restaurantId: input.restaurantId, itemName: i.itemName, amount: String(i.amount) }))
          );
          // 템플릿 저장 (중복 제외)
          const existingTemplates = await db.select().from(salesOtherItemTemplates)
            .where(eq(salesOtherItemTemplates.restaurantId, input.restaurantId));
          const existingNames = new Set(existingTemplates.map(t => t.itemName));
          const newNames = input.otherItems.map(i => i.itemName).filter(n => !existingNames.has(n));
          if (newNames.length > 0) {
            await db.insert(salesOtherItemTemplates).values(
              newNames.map(n => ({ restaurantId: input.restaurantId, itemName: n }))
            );
          }
        }
        // sales 테이블에도 동기화 (submitted 이상일 때)
        if (input.submit) {
          const { sales: salesTable } = await import("../drizzle/schema");
          const [existingSale] = await db.select().from(salesTable)
            .where(and(eq(salesTable.restaurantId, input.restaurantId), sql`${salesTable.saleDate} = ${input.saleDate}`));
          if (existingSale) {
            await db.update(salesTable).set({ amount: String(totalAmount), recordedBy: ctx.user.id }).where(eq(salesTable.id, existingSale.id));
          } else {
            await db.insert(salesTable).values({ restaurantId: input.restaurantId, saleDate: sql`${input.saleDate}`, amount: String(totalAmount), recordedBy: ctx.user.id, source: "manual" });
          }
        }
        return { success: true, totalAmount, status };
      }),
    // 점장/매니저 확인 (승인)
    confirm: protectedProcedure
      .input(z.object({ restaurantId: z.number(), saleDate: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await requireManagerOrStoreRole(ctx.user.id, ctx.user.role, input.restaurantId);
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { dailySalesDetail, sales: salesTable } = await import("../drizzle/schema");
        const [detail] = await db.select().from(dailySalesDetail)
          .where(and(eq(dailySalesDetail.restaurantId, input.restaurantId), sql`${dailySalesDetail.saleDate} = ${input.saleDate}`));
        if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "매출 데이터가 없습니다." });
        if (detail.status === "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "제출되지 않은 매출은 확인할 수 없습니다." });
        await db.update(dailySalesDetail)
          .set({ status: "confirmed", confirmedBy: ctx.user.id, confirmedAt: new Date() })
          .where(eq(dailySalesDetail.id, detail.id));
        // sales 테이블에도 동기화
        const [existingSale] = await db.select().from(salesTable)
          .where(and(eq(salesTable.restaurantId, input.restaurantId), sql`${salesTable.saleDate} = ${input.saleDate}`));
        if (existingSale) {
          await db.update(salesTable).set({ amount: detail.totalAmount, recordedBy: ctx.user.id }).where(eq(salesTable.id, existingSale.id));
        } else {
          await db.insert(salesTable).values({ restaurantId: input.restaurantId, saleDate: sql`${input.saleDate}`, amount: detail.totalAmount, recordedBy: ctx.user.id, source: "manual" });
        }
        return { success: true };
      }),
    // 기타 매출 항목 템플릿 조회
    getOtherItemTemplates: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const { salesOtherItemTemplates } = await import("../drizzle/schema");
        return db.select().from(salesOtherItemTemplates)
          .where(eq(salesOtherItemTemplates.restaurantId, input.restaurantId))
          .orderBy(salesOtherItemTemplates.itemName);
      }),
  }),

  // ─── Intermediate Sales (중간 매출) ──────────────────────────────────────────
  intermediateSales: router({
    // 특정 날짜 중간 매출 조회
    listByDate: protectedProcedure
      .input(z.object({ restaurantId: z.number(), saleDate: z.string() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const { intermediateSales } = await import("../drizzle/schema");
        return db.select().from(intermediateSales)
          .where(and(eq(intermediateSales.restaurantId, input.restaurantId), sql`${intermediateSales.saleDate} = ${input.saleDate}`))
          .orderBy(intermediateSales.recordedAt);
      }),
    // 중간 매출 입력
    create: protectedProcedure
      .input(z.object({ restaurantId: z.number(), saleDate: z.string(), amount: z.number().min(0), note: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { intermediateSales } = await import("../drizzle/schema");
        await db.insert(intermediateSales).values({
          restaurantId: input.restaurantId, saleDate: sql`${input.saleDate}`,
          amount: String(input.amount), recordedBy: ctx.user.id, note: input.note,
        });
        return { success: true };
      }),
    // 중간 매출 수정
    update: protectedProcedure
      .input(z.object({ id: z.number(), amount: z.number().min(0), note: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { intermediateSales } = await import("../drizzle/schema");
        await db.update(intermediateSales).set({ amount: String(input.amount), note: input.note, recordedBy: ctx.user.id }).where(eq(intermediateSales.id, input.id));
        return { success: true };
      }),
    // 중간 매출 삭제
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "manager");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { intermediateSales } = await import("../drizzle/schema");
        await db.delete(intermediateSales).where(eq(intermediateSales.id, input.id));
        return { success: true };
      }),
  }),

  // ─── Counterparties (거래처 통합 관리) ────────────────────────────────────────
  counterparties: router({
    list: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "employee");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { counterparties } = await import("../drizzle/schema");
        return db.select().from(counterparties)
          .where(and(eq(counterparties.restaurantId, input.restaurantId), eq(counterparties.isActive, true)))
          .orderBy(counterparties.name);
      }),
    create: protectedProcedure
      .input(z.object({
        restaurantId: z.number(),
        name: z.string().min(1),
        counterpartyType: z.enum(["supplier", "online", "mart", "repair", "other"]).default("supplier"),
        note: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "employee");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { counterparties } = await import("../drizzle/schema");
        const [result] = await db.insert(counterparties).values({
          restaurantId: input.restaurantId,
          name: input.name,
          counterpartyType: input.counterpartyType,
          note: input.note,
        });
        return { id: (result as any).insertId, success: true };
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        counterpartyType: z.enum(["supplier", "online", "mart", "repair", "other"]).optional(),
        note: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "manager");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { counterparties } = await import("../drizzle/schema");
        const { id, ...rest } = input;
        await db.update(counterparties).set(rest).where(eq(counterparties.id, id));
        return { success: true };
      }),
  }),

  // ─── Items (공통 품목 마스터) ─────────────────────────────────────────────────
  items: router({
    list: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "employee");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { items } = await import("../drizzle/schema");
        return db.select().from(items)
          .where(and(eq(items.restaurantId, input.restaurantId), eq(items.isActive, true)))
          .orderBy(items.name);
      }),
    create: protectedProcedure
      .input(z.object({
        restaurantId: z.number(),
        name: z.string().min(1),
        itemType: z.enum(["product", "service", "misc"]).default("product"),
        costingCategory: z.string().optional(),
        baseUnit: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "employee");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { items } = await import("../drizzle/schema");
        const [result] = await db.insert(items).values({
          restaurantId: input.restaurantId,
          name: input.name,
          itemType: input.itemType,
          costingCategory: input.costingCategory,
          baseUnit: input.baseUnit,
        });
        return { id: (result as any).insertId, success: true };
      }),
    searchSimilar: protectedProcedure
      .input(z.object({ restaurantId: z.number(), query: z.string() }))
      .query(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "employee");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { items } = await import("../drizzle/schema");
        return db.select().from(items)
          .where(and(
            eq(items.restaurantId, input.restaurantId),
            eq(items.isActive, true),
            sql`${items.name} LIKE ${`%${input.query}%`}`
          ))
          .limit(10);
      }),
  }),

  // ─── CounterpartyItems (거래처-품목 매핑) ────────────────────────────────────
  counterpartyItems: router({
    listByCounterparty: protectedProcedure
      .input(z.object({ counterpartyId: z.number() }))
      .query(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "employee");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { counterpartyItems, items } = await import("../drizzle/schema");
        return db.select({
          id: counterpartyItems.id,
          counterpartyId: counterpartyItems.counterpartyId,
          itemId: counterpartyItems.itemId,
          itemName: items.name,
          itemType: items.itemType,
          supplierItemName: counterpartyItems.supplierItemName,
          purchaseUnit: counterpartyItems.purchaseUnit,
          conversionToBase: counterpartyItems.conversionToBase,
          decimalAllowed: counterpartyItems.decimalAllowed,
          quantityStep: counterpartyItems.quantityStep,
          defaultPrice: counterpartyItems.defaultPrice,
          lastPrice: counterpartyItems.lastPrice,
          isPreferred: counterpartyItems.isPreferred,
          costingCategory: items.costingCategory,
          baseUnit: items.baseUnit,
        })
        .from(counterpartyItems)
        .innerJoin(items, eq(counterpartyItems.itemId, items.id))
        .where(eq(counterpartyItems.counterpartyId, input.counterpartyId))
        .orderBy(counterpartyItems.isPreferred, items.name);
      }),
    create: protectedProcedure
      .input(z.object({
        restaurantId: z.number(),
        counterpartyId: z.number(),
        itemId: z.number(),
        supplierItemName: z.string().optional(),
        purchaseUnit: z.string().optional(),
        conversionToBase: z.string().optional(),
        decimalAllowed: z.boolean().default(false),
        quantityStep: z.string().optional(),
        defaultPrice: z.string().optional(),
        isPreferred: z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "employee");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { counterpartyItems } = await import("../drizzle/schema");
        const [result] = await db.insert(counterpartyItems).values({
          restaurantId: input.restaurantId,
          counterpartyId: input.counterpartyId,
          itemId: input.itemId,
          supplierItemName: input.supplierItemName,
          purchaseUnit: input.purchaseUnit,
          conversionToBase: input.conversionToBase,
          decimalAllowed: input.decimalAllowed,
          quantityStep: input.quantityStep,
          defaultPrice: input.defaultPrice,
          isPreferred: input.isPreferred,
        });
        return { id: (result as any).insertId, success: true };
      }),
    linkToExistingItem: protectedProcedure
      .input(z.object({
        counterpartyItemId: z.number(),
        itemId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "employee");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { counterpartyItems } = await import("../drizzle/schema");
        await db.update(counterpartyItems)
          .set({ itemId: input.itemId })
          .where(eq(counterpartyItems.id, input.counterpartyItemId));
        return { success: true };
      }),
  }),

  // ─── PurchasesV2 (매입 전표 v2) ───────────────────────────────────────────────
  purchasesV2: router({
    listOrdersByMonth: protectedProcedure
      .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
      .query(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "employee");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { purchaseOrdersV2, counterparties, users } = await import("../drizzle/schema");
        const startDate = new Date(`${input.year}-${String(input.month).padStart(2, "0")}-01`);
        const endDate = new Date(`${input.year}-${String(input.month).padStart(2, "0")}-31`);
        return db.select({
          id: purchaseOrdersV2.id,
          restaurantId: purchaseOrdersV2.restaurantId,
          counterpartyId: purchaseOrdersV2.counterpartyId,
          counterpartyName: counterparties.name,
          purchaseDate: purchaseOrdersV2.purchaseDate,
          status: purchaseOrdersV2.status,
          note: purchaseOrdersV2.note,
          attachmentUrl: purchaseOrdersV2.attachmentUrl,
          totalAmount: purchaseOrdersV2.totalAmount,
          createdBy: purchaseOrdersV2.createdBy,
          createdByName: users.name,
          createdAt: purchaseOrdersV2.createdAt,
          editHistory: purchaseOrdersV2.editHistory,
        })
        .from(purchaseOrdersV2)
        .leftJoin(counterparties, eq(purchaseOrdersV2.counterpartyId, counterparties.id))
        .leftJoin(users, eq(purchaseOrdersV2.createdBy, users.id))
        .where(and(
          eq(purchaseOrdersV2.restaurantId, input.restaurantId),
          gte(purchaseOrdersV2.purchaseDate, startDate),
          sql`${purchaseOrdersV2.purchaseDate} <= ${endDate}`
        ))
        .orderBy(desc(purchaseOrdersV2.purchaseDate));
      }),
    getOrderItems: protectedProcedure
      .input(z.object({ orderId: z.number() }))
      .query(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "employee");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { purchaseOrderItemsV2, items } = await import("../drizzle/schema");
        return db.select({
          id: purchaseOrderItemsV2.id,
          purchaseOrderId: purchaseOrderItemsV2.purchaseOrderId,
          itemId: purchaseOrderItemsV2.itemId,
          counterpartyItemId: purchaseOrderItemsV2.counterpartyItemId,
          rawItemName: purchaseOrderItemsV2.rawItemName,
          itemName: items.name,
          itemType: purchaseOrderItemsV2.itemType,
          quantity: purchaseOrderItemsV2.quantity,
          unitName: purchaseOrderItemsV2.unitName,
          unitPrice: purchaseOrderItemsV2.unitPrice,
          lineTotal: purchaseOrderItemsV2.lineTotal,
          costingCategory: purchaseOrderItemsV2.costingCategory,
          note: purchaseOrderItemsV2.note,
        })
        .from(purchaseOrderItemsV2)
        .leftJoin(items, eq(purchaseOrderItemsV2.itemId, items.id))
        .where(eq(purchaseOrderItemsV2.purchaseOrderId, input.orderId));
      }),
    getRecentOrdersByCounterparty: protectedProcedure
      .input(z.object({ restaurantId: z.number(), counterpartyId: z.number(), limit: z.number().default(5) }))
      .query(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "employee");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { purchaseOrdersV2 } = await import("../drizzle/schema");
        return db.select()
          .from(purchaseOrdersV2)
          .where(and(
            eq(purchaseOrdersV2.restaurantId, input.restaurantId),
            eq(purchaseOrdersV2.counterpartyId, input.counterpartyId)
          ))
          .orderBy(desc(purchaseOrdersV2.purchaseDate))
          .limit(input.limit);
      }),
    createOrder: protectedProcedure
      .input(z.object({
        restaurantId: z.number(),
        counterpartyId: z.number().optional(),
        purchaseDate: z.string(),
        status: z.enum(["received", "ordered"]).default("received"),
        note: z.string().optional(),
        attachmentUrl: z.string().optional(),
        items: z.array(z.object({
          itemId: z.number().optional(),
          counterpartyItemId: z.number().optional(),
          rawItemName: z.string().optional(),
          itemType: z.enum(["product", "service", "misc"]).default("product"),
          quantity: z.string().optional(),
          unitName: z.string().optional(),
          unitPrice: z.string().optional(),
          lineTotal: z.string(),
          costingCategory: z.string().optional(),
          note: z.string().optional(),
        })),
      }))
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "employee");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { purchaseOrdersV2, purchaseOrderItemsV2, counterpartyItems } = await import("../drizzle/schema");
        // 합계 계산
        const totalAmount = input.items.reduce((sum, item) => sum + parseFloat(item.lineTotal || "0"), 0);
        // 헤더 삽입
        const [orderResult] = await db.insert(purchaseOrdersV2).values({
          restaurantId: input.restaurantId,
          counterpartyId: input.counterpartyId,
          purchaseDate: new Date(input.purchaseDate),
          status: input.status,
          note: input.note,
          attachmentUrl: input.attachmentUrl,
          totalAmount: String(totalAmount),
          createdBy: ctx.user.id,
        });
        const orderId = (orderResult as any).insertId;
        // 항목 삽입
        if (input.items.length > 0) {
          await db.insert(purchaseOrderItemsV2).values(
            input.items.map(item => ({
              purchaseOrderId: orderId,
              itemId: item.itemId,
              counterpartyItemId: item.counterpartyItemId,
              rawItemName: item.rawItemName,
              itemType: item.itemType,
              quantity: item.quantity,
              unitName: item.unitName,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
              costingCategory: item.costingCategory,
              note: item.note,
            }))
          );
          // counterparty_items의 lastPrice 업데이트
          for (const item of input.items) {
            if (item.counterpartyItemId && item.unitPrice) {
              await db.update(counterpartyItems)
                .set({ lastPrice: item.unitPrice })
                .where(eq(counterpartyItems.id, item.counterpartyItemId));
            }
          }
        }
        return { id: orderId, success: true };
      }),
    updateOrder: protectedProcedure
      .input(z.object({
        id: z.number(),
        counterpartyId: z.number().nullable().optional(),
        counterpartyName: z.string().optional(),
        purchaseDate: z.string().optional(),
        note: z.string().nullable().optional(),
        status: z.enum(["received", "ordered"]).optional(),
        attachmentUrl: z.string().nullable().optional(),
        totalAmount: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "employee");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { purchaseOrdersV2 } = await import("../drizzle/schema");
        const { id, counterpartyName, ...rest } = input;
        // 기존 전표 조회
        const [existing] = await db.select().from(purchaseOrdersV2).where(eq(purchaseOrdersV2.id, id)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "전표를 찾을 수 없습니다" });
        // editHistory 업데이트
        const prevHistory: Array<{userId: number; userName: string; at: string; summary: string}> = (existing.editHistory as any) ?? [];
        const changes: string[] = [];
        if (rest.status && rest.status !== existing.status) changes.push(`상태: ${existing.status === 'received' ? '입고' : '발주'} → ${rest.status === 'received' ? '입고' : '발주'}`);
        const existingDateStr = existing.purchaseDate instanceof Date ? existing.purchaseDate.toISOString().split('T')[0] : String(existing.purchaseDate ?? '');
        if (rest.purchaseDate && rest.purchaseDate !== existingDateStr) changes.push(`날짜: ${existingDateStr} → ${rest.purchaseDate}`);
        if (counterpartyName !== undefined) changes.push(`거래체 수정`);
        if (rest.note !== undefined && rest.note !== existing.note) changes.push(`메모 수정`);
        if (rest.attachmentUrl !== undefined && rest.attachmentUrl !== existing.attachmentUrl) changes.push(`영수증 ${rest.attachmentUrl ? '체인지' : '삭제'}`);
        if (rest.totalAmount !== undefined && rest.totalAmount !== existing.totalAmount) changes.push(`금액: ${Number(existing.totalAmount).toLocaleString()}원 → ${Number(rest.totalAmount).toLocaleString()}원`);
        const newHistoryEntry = {
          userId: ctx.user.id,
          userName: ctx.user.name ?? ctx.user.username ?? String(ctx.user.id),
          at: new Date().toISOString(),
          summary: changes.length > 0 ? changes.join(', ') : '수정',
        };
        const updatePayload: Record<string, any> = {
          ...rest,
          lastModifiedBy: ctx.user.id,
          lastModifiedAt: new Date(),
          editHistory: [...prevHistory, newHistoryEntry],
        };
        // counterpartyName은 직접 커럼이 없으므로 counterparties 테이블에서 조회되는 것을 사용
        // counterpartyId가 있는 경우 해당 ID로 업데이트
        if (rest.purchaseDate) {
          updatePayload.purchaseDate = new Date(rest.purchaseDate + 'T00:00:00');
        }
        await db.update(purchaseOrdersV2).set(updatePayload).where(eq(purchaseOrdersV2.id, id));
        return { success: true };
      }),
    deleteOrder: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "manager");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { purchaseOrdersV2, purchaseOrderItemsV2 } = await import("../drizzle/schema");
        await db.delete(purchaseOrderItemsV2).where(eq(purchaseOrderItemsV2.purchaseOrderId, input.id));
        await db.delete(purchaseOrdersV2).where(eq(purchaseOrdersV2.id, input.id));
        return { success: true };
      }),
  }),

  // ─── Pricing (가격 비교) ───────────────────────────────────────────────────────
  pricing: router({
    getLastPriceByCounterpartyItem: protectedProcedure
      .input(z.object({ counterpartyItemId: z.number() }))
      .query(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "employee");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { counterpartyItems } = await import("../drizzle/schema");
        const [row] = await db.select({ lastPrice: counterpartyItems.lastPrice, defaultPrice: counterpartyItems.defaultPrice })
          .from(counterpartyItems)
          .where(eq(counterpartyItems.id, input.counterpartyItemId));
        return row ?? null;
      }),
    getRecentComparisonByItem: protectedProcedure
      .input(z.object({ restaurantId: z.number(), itemId: z.number() }))
      .query(async ({ ctx, input }) => {
        requireRole(ctx.user.role, "employee");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
        const { counterpartyItems, counterparties } = await import("../drizzle/schema");
        // 같은 품목을 취급하는 모든 거래처의 최근 단가 비교
        return db.select({
          counterpartyId: counterpartyItems.counterpartyId,
          counterpartyName: counterparties.name,
          counterpartyType: counterparties.counterpartyType,
          purchaseUnit: counterpartyItems.purchaseUnit,
          lastPrice: counterpartyItems.lastPrice,
          defaultPrice: counterpartyItems.defaultPrice,
          isPreferred: counterpartyItems.isPreferred,
        })
        .from(counterpartyItems)
        .innerJoin(counterparties, eq(counterpartyItems.counterpartyId, counterparties.id))
        .where(and(
          eq(counterpartyItems.restaurantId, input.restaurantId),
          eq(counterpartyItems.itemId, input.itemId),
          eq(counterparties.isActive, true)
        ))
        .orderBy(counterpartyItems.lastPrice);
      }),
  }),
  // ── Store Closures (휴무일 관리) ───────────────────────────────────────────────────────
  storeClosures: router({
    // 정기 휴무 요일 조회
    getWeekly: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const { storeWeeklyClosures } = await import("../drizzle/schema");
        return db.select().from(storeWeeklyClosures)
          .where(eq(storeWeeklyClosures.restaurantId, input.restaurantId));
      }),
    // 정기 휴무 요일 저장 (upsert) — 점장(leader) 전용
    setWeekly: managerProcedure
      .input(z.object({
        restaurantId: z.number(),
        weekdays: z.array(z.number().min(0).max(6)), // 휴무인 요일들
      }))
      .mutation(async ({ input, ctx }) => {
        await requireStoreLeaderOrAdmin(ctx.user.id, ctx.user.role, input.restaurantId);
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { storeWeeklyClosures } = await import("../drizzle/schema");
        // 해당 매장의 기존 정기 휴무 삭제
        await db.delete(storeWeeklyClosures)
          .where(eq(storeWeeklyClosures.restaurantId, input.restaurantId));
        // 새 휴무 요일 삽입
        if (input.weekdays.length > 0) {
          await db.insert(storeWeeklyClosures).values(
            input.weekdays.map(w => ({
              restaurantId: input.restaurantId,
              weekday: w,
              isClosed: true,
            }))
          );
        }
        return { success: true };
      }),
    // 특정 휴무일 목록 조회
    getSpecial: protectedProcedure
      .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const { storeClosedDays } = await import("../drizzle/schema");
        // 해당 월의 특정 휴무일 조회
        const startDate = new Date(`${input.year}-${String(input.month).padStart(2,'0')}-01`);
        const endDate = new Date(`${input.year}-${String(input.month).padStart(2,'0')}-31`);
        return db.select().from(storeClosedDays)
          .where(and(
            eq(storeClosedDays.restaurantId, input.restaurantId),
            gte(storeClosedDays.closedDate as any, startDate as any),
            lte(storeClosedDays.closedDate as any, endDate as any),
          ))
          .orderBy(storeClosedDays.closedDate);
      }),
    // 특정 휴무일 추가 — 점장(leader) 전용
    addSpecial: managerProcedure
      .input(z.object({
        restaurantId: z.number(),
        closedDate: z.string(), // YYYY-MM-DD
        reason: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        await requireStoreLeaderOrAdmin(ctx.user.id, ctx.user.role, input.restaurantId);
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { storeClosedDays } = await import("../drizzle/schema");
        await db.insert(storeClosedDays).values({
          restaurantId: input.restaurantId,
          closedDate: new Date(input.closedDate) as any,
          reason: input.reason,
          createdBy: ctx.user.id,
        } as any);
        return { success: true };
      }),
    // 특정 휴무일 삭제 — 점장(leader) 전용
    removeSpecial: managerProcedure
      .input(z.object({ id: z.number(), restaurantId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await requireStoreLeaderOrAdmin(ctx.user.id, ctx.user.role, input.restaurantId);
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { storeClosedDays } = await import("../drizzle/schema");
        await db.delete(storeClosedDays)
          .where(and(
            eq(storeClosedDays.id, input.id),
            eq(storeClosedDays.restaurantId, input.restaurantId),
          ));
        return { success: true };
      }),
  }),

  // ── Daily Closings (일마감) ────────────────────────────────────────────────
  dailyClosings: router({
    // 특정 날짜 일마감 조회
    get: protectedProcedure
      .input(z.object({ restaurantId: z.number(), date: z.string() }))
      .query(async ({ input, ctx }) => {
        await assertRestaurantAccess(ctx.user.id, ctx.user.role, input.restaurantId);
        return getDailyClosing(input.restaurantId, input.date);
      }),
    // 월별 일마감 목록 (캘린더용)
    listByMonth: protectedProcedure
      .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
      .query(async ({ input, ctx }) => {
        await assertRestaurantAccess(ctx.user.id, ctx.user.role, input.restaurantId);
        return getDailyClosingsByMonth(input.restaurantId, input.year, input.month);
      }),
    // 월별 날짜별 출근인원 집계
    getAttendanceCounts: protectedProcedure
      .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
      .query(async ({ input, ctx }) => {
        await assertRestaurantAccess(ctx.user.id, ctx.user.role, input.restaurantId);
        return getMonthlyAttendanceCounts(input.restaurantId, input.year, input.month);
      }),
    // 일마감 상세 조회 (slice panel용)
    getDetail: protectedProcedure
      .input(z.object({ restaurantId: z.number(), date: z.string() }))
      .query(async ({ input, ctx }) => {
        await assertRestaurantAccess(ctx.user.id, ctx.user.role, input.restaurantId);
        return getDailyClosingDetail(input.restaurantId, input.date);
      }),
    // 매출 항목 유형 목록
    getSalesTypes: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ input }) => {
        return getDailyClosingSalesTypes(input.restaurantId);
      }),
    // 매출 항목 유형 추가
    addSalesType: managerProcedure
      .input(z.object({ restaurantId: z.number(), typeName: z.string().min(1).max(50) }))
      .mutation(async ({ input }) => {
        await addDailyClosingSalesType(input.restaurantId, input.typeName);
        return { success: true };
      }),
    // 매출 특이사항 유형 목록
    getSpecialTypes: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ input }) => {
        return getDailyClosingSpecialTypes(input.restaurantId);
      }),
    // 매출 특이사항 유형 추가
    addSpecialType: managerProcedure
      .input(z.object({ restaurantId: z.number(), typeName: z.string().min(1).max(50) }))
      .mutation(async ({ input }) => {
        await addDailyClosingSpecialType(input.restaurantId, input.typeName);
        return { success: true };
      }),
    // 일마감 확정 (점장/매니저 이상)
    close: managerProcedure
      .input(z.object({
        restaurantId: z.number(),
        date: z.string(),
        note: z.string().optional(),
        salesBreakdown: z.array(z.object({ typeName: z.string(), amount: z.number() })).optional(),
        salesSpecials: z.array(z.object({ typeName: z.string(), amount: z.number(), note: z.string().optional() })).optional(),
        tomorrowScheduleConfirmed: z.boolean().optional(),
        scheduleNote: z.string().optional(),
        purchaseNote: z.string().optional(),
        orderCheckPhotoUrl: z.string().optional(),
        orderCheckNoOrder: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // 당일 집계 계산
        const year = parseInt(input.date.split("-")[0]);
        const month = parseInt(input.date.split("-")[1]);
        const monthStr = `${year}-${String(month).padStart(2, "0")}`;
        // 매출: salesBreakdown 합산 또는 DB 집계
        let salesTotal: number;
        if (input.salesBreakdown && input.salesBreakdown.length > 0) {
          salesTotal = input.salesBreakdown.reduce((s, i) => s + i.amount, 0);
          // sales 테이블에도 동기화
          const db = await (await import("./db")).getDb();
          if (db) {
            const { sales: salesTable } = await import("../drizzle/schema");
            const [existingSale] = await db.select().from(salesTable)
              .where(and(eq(salesTable.restaurantId, input.restaurantId), sql`${salesTable.saleDate} = ${input.date}`));
            if (existingSale) {
              await db.update(salesTable).set({ amount: String(salesTotal), recordedBy: ctx.user.id }).where(eq(salesTable.id, existingSale.id));
            } else {
              await db.insert(salesTable).values({ restaurantId: input.restaurantId, saleDate: new Date(input.date + 'T00:00:00'), amount: String(salesTotal), recordedBy: ctx.user.id, source: "manual" });
            }
          }
        } else {
          salesTotal = await getDailySalesTotal(input.restaurantId, input.date);
        }
        const [purchasesTotal, laborCost, fixedCostsTotal] = await Promise.all([
          getMonthlyPurchasesTotal(input.restaurantId, year, month),
          calculateDailyLaborCost(input.restaurantId, input.date),
          getMonthlyFixedCostsTotal(input.restaurantId, monthStr),
        ]);
        // 고정비는 월 전체를 일 단위로 배분 (해당 월 일수로 나눠)
        const daysInMonth = new Date(year, month, 0).getDate();
        const fixedCostShare = fixedCostsTotal / daysInMonth;
        const profit = salesTotal - (purchasesTotal / daysInMonth) - laborCost - fixedCostShare;
        // 기존 마감 레코드가 있는지 확인 (수정 vs 신규)
        const existingClosing = await getDailyClosing(input.restaurantId, input.date);
        const isEdit = !!existingClosing;
        const editHistoryEntry = isEdit ? {
          userId: ctx.user.id,
          userName: ctx.user.name ?? ctx.user.username ?? String(ctx.user.id),
          at: new Date().toISOString(),
          summary: `매출 ${salesTotal.toLocaleString()}원, 인건비 ${laborCost.toLocaleString()}원, 순이익 ${profit.toLocaleString()}원`,
        } : undefined;
        await upsertDailyClosing({
          restaurantId: input.restaurantId,
          closingDate: input.date,
          salesTotal,
          purchasesTotal: purchasesTotal / daysInMonth,
          laborCost,
          fixedCostShare,
          profit,
          note: input.note,
          closedBy: ctx.user.id,
          salesBreakdown: input.salesBreakdown,
          salesSpecials: input.salesSpecials,
          tomorrowScheduleConfirmed: input.tomorrowScheduleConfirmed,
          scheduleNote: input.scheduleNote,
          purchaseNote: input.purchaseNote,
          orderCheckPhotoUrl: input.orderCheckPhotoUrl,
          orderCheckNoOrder: input.orderCheckNoOrder,
          editHistoryEntry,
        });
        return { success: true, salesTotal, purchasesTotal: purchasesTotal / daysInMonth, laborCost, fixedCostShare, profit, isEdit };
      }),
  }),

  // ── Store Checklist Templates (매장별 체크리스트 템플릿) ──────────────────────
  storeChecklists: router({
    // 특정 유형 템플릿 목록 조회
    list: protectedProcedure
      .input(z.object({ restaurantId: z.number(), checkType: z.enum(["open", "order", "cleaning"]) }))
      .query(async ({ input }) => {
        return getChecklistTemplates(input.restaurantId, input.checkType);
      }),
    // 매장 전체 템플릿 목록 (관리 페이지용)
    listAll: protectedProcedure
      .input(z.object({ restaurantId: z.number() }))
      .query(async ({ input }) => {
        return getAllChecklistTemplates(input.restaurantId);
      }),
    // 템플릿 항목 추가 (점장 이상)
    create: managerProcedure
      .input(z.object({
        restaurantId: z.number(),
        checkType: z.enum(["open", "order", "cleaning"]),
        itemText: z.string().min(1).max(200),
        sortOrder: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        await createChecklistTemplate({
          restaurantId: input.restaurantId,
          checkType: input.checkType,
          itemText: input.itemText,
          sortOrder: input.sortOrder ?? 0,
          createdBy: ctx.user.id,
        });
        return { success: true };
      }),
    // 템플릿 항목 수정 (점장 이상)
    update: managerProcedure
      .input(z.object({
        id: z.number(),
        itemText: z.string().min(1).max(200).optional(),
        sortOrder: z.number().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateChecklistTemplate(id, data);
        return { success: true };
      }),
    // 템플릿 항목 삭제(비활성화) (점장 이상)
    delete: managerProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteChecklistTemplate(input.id);
        return { success: true };
      }),
    // 일별 체크 기록 조회
    getDailyLog: protectedProcedure
      .input(z.object({
        restaurantId: z.number(),
        logDate: z.string(),
        checkType: z.enum(["open", "order", "cleaning"]),
      }))
      .query(async ({ input }) => {
        return getDailyChecklistLog(input.restaurantId, input.logDate, input.checkType);
      }),
    // 오늘 체크리스트 완료 요약 (대시보드용)
    getDailySummary: protectedProcedure
      .input(z.object({ restaurantId: z.number(), logDate: z.string() }))
      .query(async ({ input }) => {
        const { getDailyChecklistSummary } = await import("./db");
        return getDailyChecklistSummary(input.restaurantId, input.logDate);
      }),
    // 일별 체크 기록 저장 (직원 이상)
    saveDailyLog: protectedProcedure
      .input(z.object({
        restaurantId: z.number(),
        logDate: z.string(),
        checkType: z.enum(["open", "order", "cleaning"]),
        checkedItemIds: z.array(z.number()),
        noOrderToday: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        await upsertDailyChecklistLog({
          restaurantId: input.restaurantId,
          logDate: input.logDate,
          checkType: input.checkType,
          checkedItemIds: input.checkedItemIds,
          noOrderToday: input.noOrderToday ?? false,
          completedBy: ctx.user.id,
        });
        return { success: true };
      }),
  }),
  // ── Monthly Closings (월마감) ──────────────────────────────────────────────
  monthlyClosings: router({
    // 특정 월 월마감 조회
    get: protectedProcedure
      .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
      .query(async ({ input }) => {
        return getMonthlyClosing(input.restaurantId, input.year, input.month);
      }),
    // 연간 월마감 목록
    listByYear: protectedProcedure
      .input(z.object({ restaurantId: z.number(), year: z.number() }))
      .query(async ({ input }) => {
        return getMonthlyClosingsByYear(input.restaurantId, input.year);
      }),
    // 월마감 확정 (점장 이상)
    close: managerProcedure
      .input(z.object({
        restaurantId: z.number(),
        year: z.number(),
        month: z.number(),
        note: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const monthStr = `${input.year}-${String(input.month).padStart(2, "0")}`;
        const [salesTotal, purchasesTotal, laborCost, fixedCostsTotal] = await Promise.all([
          getMonthlySalesTotal(input.restaurantId, input.year, input.month),
          getMonthlyPurchasesTotal(input.restaurantId, input.year, input.month),
          calculateMonthlyLaborCost(input.restaurantId, input.year, input.month),
          getMonthlyFixedCostsTotal(input.restaurantId, monthStr),
        ]);
        const profit = salesTotal - purchasesTotal - laborCost - fixedCostsTotal;
        await upsertMonthlyClosing({
          restaurantId: input.restaurantId,
          year: input.year,
          month: input.month,
          salesTotal,
          purchasesTotal,
          laborCost,
          fixedCostsTotal,
          profit,
          note: input.note,
          closedBy: ctx.user.id,
        });
        return { success: true, salesTotal, purchasesTotal, laborCost, fixedCostsTotal, profit };
      }),
  }),
});
export type AppRouter = typeof appRouter;
