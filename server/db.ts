import { and, eq, gte, lte, desc, sql, inArray } from "drizzle-orm";
import { toKSTDateString } from "../shared/dateKST";
import { drizzle } from "drizzle-orm/mysql2";
import {
  users, restaurants, restaurantUsers, employeeContracts,
  schedules, sales, purchases, monthlyFixedCosts, notifications, restaurantContracts,
  InsertUser, InsertRestaurant, InsertRestaurantUser, InsertEmployeeContract,
  InsertSchedule, InsertSale, InsertPurchase, InsertMonthlyFixedCost, InsertNotification,
} from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ───────────────────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const fields = ["name", "email", "loginMethod", "role", "username", "passwordHash", "phone", "isActive"] as const;
  for (const f of fields) {
    if (user[f] !== undefined) { values[f] = user[f] as never; updateSet[f] = user[f]; }
  }
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const r = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return r[0];
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const r = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return r[0];
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const r = await db.select().from(users).where(and(eq(users.username, username), eq(users.isActive, true))).limit(1);
  return r[0];
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(eq(users.isActive, true)).orderBy(users.createdAt);
}

export async function updateUser(id: number, data: Partial<InsertUser>) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set(data).where(eq(users.id, id));
}

export async function createUser(data: InsertUser) {
  const db = await getDb();
  if (!db) return;
  await db.insert(users).values(data);
  const r = await db.select().from(users).where(eq(users.openId, data.openId)).limit(1);
  return r[0];
}

// ─── Restaurants ─────────────────────────────────────────────────────────────
export async function getAllRestaurants() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(restaurants).where(eq(restaurants.isActive, true)).orderBy(restaurants.name);
}

export async function getRestaurantById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const r = await db.select().from(restaurants).where(eq(restaurants.id, id)).limit(1);
  return r[0];
}

export async function createRestaurant(data: InsertRestaurant) {
  const db = await getDb();
  if (!db) return;
  await db.insert(restaurants).values(data);
  const r = await db.select().from(restaurants).orderBy(desc(restaurants.id)).limit(1);
  return r[0];
}

export async function updateRestaurant(id: number, data: Partial<InsertRestaurant>) {
  const db = await getDb();
  if (!db) return;
  await db.update(restaurants).set(data).where(eq(restaurants.id, id));
}

// ─── Restaurant Users ─────────────────────────────────────────────────────────
export async function getRestaurantsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ restaurantId: restaurantUsers.restaurantId, role: restaurantUsers.role })
    .from(restaurantUsers).where(eq(restaurantUsers.userId, userId));
  if (!rows.length) return [];
  const ids = rows.map(r => r.restaurantId);
  const rest = await db.select().from(restaurants).where(and(inArray(restaurants.id, ids), eq(restaurants.isActive, true)));
  return rest.map(r => ({ ...r, userRole: rows.find(x => x.restaurantId === r.id)?.role }));
}

export async function getUsersByRestaurantId(restaurantId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ userId: restaurantUsers.userId, role: restaurantUsers.role })
    .from(restaurantUsers).where(eq(restaurantUsers.restaurantId, restaurantId));
  if (!rows.length) return [];
  const ids = rows.map(r => r.userId);
  const us = await db.select().from(users).where(and(inArray(users.id, ids), eq(users.isActive, true)));
  return us.map(u => ({ ...u, restaurantRole: rows.find(x => x.userId === u.id)?.role }));
}

export async function addUserToRestaurant(data: InsertRestaurantUser) {
  const db = await getDb();
  if (!db) return;
  await db.insert(restaurantUsers).values(data).onDuplicateKeyUpdate({ set: { role: data.role } });
}

export async function removeUserFromRestaurant(userId: number, restaurantId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(restaurantUsers).where(and(eq(restaurantUsers.userId, userId), eq(restaurantUsers.restaurantId, restaurantId)));
}

// ─── Employee Contracts ───────────────────────────────────────────────────────
export async function getContractByUserAndRestaurant(userId: number, restaurantId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const r = await db.select().from(employeeContracts)
    .where(and(eq(employeeContracts.userId, userId), eq(employeeContracts.restaurantId, restaurantId), eq(employeeContracts.isActive, true)))
    .limit(1);
  return r[0];
}

export async function upsertContract(data: InsertEmployeeContract) {
  const db = await getDb();
  if (!db) return;
  const existing = await getContractByUserAndRestaurant(data.userId!, data.restaurantId!);
  if (existing) {
    await db.update(employeeContracts).set(data).where(eq(employeeContracts.id, existing.id));
  } else {
    await db.insert(employeeContracts).values(data);
  }
}

export async function getContractsByRestaurant(restaurantId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(employeeContracts)
    .where(and(eq(employeeContracts.restaurantId, restaurantId), eq(employeeContracts.isActive, true)));
}

// ─── Schedules ────────────────────────────────────────────────────────────────
export async function getSchedulesByRestaurantAndRange(restaurantId: number, from: Date, to: Date) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: schedules.id,
    userId: schedules.userId,
    tempWorkerName: schedules.tempWorkerName,
    tempWageType: schedules.tempWageType,
    tempWageAmount: schedules.tempWageAmount,
    restaurantId: schedules.restaurantId,
    startTime: schedules.startTime,
    endTime: schedules.endTime,
    status: schedules.status,
    editReason: schedules.editReason,
    note: schedules.note,
    createdBy: schedules.createdBy,
    createdAt: schedules.createdAt,
    updatedAt: schedules.updatedAt,
    userName: users.name,
    username: users.username,
  }).from(schedules)
    .leftJoin(users, eq(schedules.userId, users.id))
    .where(and(eq(schedules.restaurantId, restaurantId), gte(schedules.startTime, from), lte(schedules.startTime, to)))
    .orderBy(schedules.startTime);
  return rows.map(r => ({
    ...r,
    userName: r.tempWorkerName ? `[임시] ${r.tempWorkerName}` : (r.userName ?? r.username ?? "알수없음"),
    workDate: toKSTDateString(r.startTime),
    startTimeStr: r.startTime.toTimeString().slice(0, 5),
    endTimeStr: r.endTime.toTimeString().slice(0, 5),
  }));
}

export async function getSchedulesByUserAndRange(userId: number, from: Date, to: Date) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(schedules)
    .where(and(eq(schedules.userId, userId), gte(schedules.startTime, from), lte(schedules.startTime, to)))
    .orderBy(schedules.startTime);
  return rows.map(r => ({
    ...r,
     workDate: r.startTime instanceof Date ? toKSTDateString(r.startTime) : String(r.startTime).slice(0, 10),
    startTimeStr: r.startTime instanceof Date ? r.startTime.toTimeString().slice(0, 5) : String(r.startTime).slice(11, 16),
    endTimeStr: r.endTime instanceof Date ? r.endTime.toTimeString().slice(0, 5) : String(r.endTime).slice(11, 16),
  }));
}
export async function createSchedule(data: InsertSchedule) {
  const db = await getDb();
  if (!db) return;
  await db.insert(schedules).values(data);
  const r = await db.select().from(schedules).orderBy(desc(schedules.id)).limit(1);
  return r[0];
}

export async function updateSchedule(id: number, data: Partial<InsertSchedule>) {
  const db = await getDb();
  if (!db) return;
  await db.update(schedules).set(data).where(eq(schedules.id, id));
}

export async function deleteSchedule(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(schedules).where(eq(schedules.id, id));
}

export async function getPendingScheduleRequests(restaurantId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: schedules.id,
    userId: schedules.userId,
    restaurantId: schedules.restaurantId,
    startTime: schedules.startTime,
    endTime: schedules.endTime,
    status: schedules.status,
    editReason: schedules.editReason,
    note: schedules.note,
    createdBy: schedules.createdBy,
    createdAt: schedules.createdAt,
    updatedAt: schedules.updatedAt,
    userName: users.name,
    username: users.username,
  }).from(schedules)
    .leftJoin(users, eq(schedules.userId, users.id))
    // schedule_change_requests 테이블로 분리됨 - pending 상태 조회는 별도 테이블 사용
    .where(and(eq(schedules.restaurantId, restaurantId), eq(schedules.status, "published")))
    .orderBy(desc(schedules.updatedAt));
  return rows.map(r => ({
    ...r,
    userName: r.userName ?? r.username ?? "알수없음",
    workDate: r.startTime instanceof Date ? toKSTDateString(r.startTime) : String(r.startTime).slice(0, 10),
    startTimeStr: r.startTime instanceof Date ? r.startTime.toTimeString().slice(0, 5) : String(r.startTime).slice(11, 16),
    endTimeStr: r.endTime instanceof Date ? r.endTime.toTimeString().slice(0, 5) : String(r.endTime).slice(11, 16),
  }));
}

// ─── Sales ────────────────────────────────────────────────────────────────────
export async function getSalesByRestaurantAndMonth(restaurantId: number, year: number, month: number) {
  const db = await getDb();
  if (!db) return [];
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = `${year}-${String(month).padStart(2, "0")}-31`;
  return db.select().from(sales)
    .where(and(eq(sales.restaurantId, restaurantId), sql`${sales.saleDate} >= ${from}`, sql`${sales.saleDate} <= ${to}`))
    .orderBy(desc(sales.saleDate));
}

export async function getSalesByRestaurantAndDate(restaurantId: number, dateStr: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sales)
    .where(and(eq(sales.restaurantId, restaurantId), sql`${sales.saleDate} = ${dateStr}`));
}

export async function createSale(data: InsertSale) {
  const db = await getDb();
  if (!db) return;
  await db.insert(sales).values(data);
  const r = await db.select().from(sales).orderBy(desc(sales.id)).limit(1);
  return r[0];
}

export async function updateSale(id: number, data: Partial<InsertSale>) {
  const db = await getDb();
  if (!db) return;
  await db.update(sales).set(data).where(eq(sales.id, id));
}

export async function deleteSale(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(sales).where(eq(sales.id, id));
}

// 월 매출 합계
export async function getMonthlySalesTotal(restaurantId: number, year: number, month: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = `${year}-${String(month).padStart(2, "0")}-31`;
  const r = await db.select({ total: sql<string>`COALESCE(SUM(amount), 0)` }).from(sales)
    .where(and(eq(sales.restaurantId, restaurantId), sql`${sales.saleDate} >= ${from}`, sql`${sales.saleDate} <= ${to}`));
  return parseFloat(r[0]?.total ?? "0");
}

// 일 매출 합계
export async function getDailySalesTotal(restaurantId: number, dateStr: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const r = await db.select({ total: sql<string>`COALESCE(SUM(amount), 0)` }).from(sales)
    .where(and(eq(sales.restaurantId, restaurantId), sql`${sales.saleDate} = ${dateStr}`));
  return parseFloat(r[0]?.total ?? "0");
}

// ─── Purchases ────────────────────────────────────────────────────────────────
export async function getPurchasesByRestaurantAndMonth(restaurantId: number, year: number, month: number) {
  const db = await getDb();
  if (!db) return [];
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = `${year}-${String(month).padStart(2, "0")}-31`;
  return db.select().from(purchases)
    .where(and(eq(purchases.restaurantId, restaurantId), sql`${purchases.purchaseDate} >= ${from}`, sql`${purchases.purchaseDate} <= ${to}`))
    .orderBy(desc(purchases.purchaseDate));
}

export async function createPurchase(data: InsertPurchase) {
  const db = await getDb();
  if (!db) return;
  await db.insert(purchases).values(data);
  const r = await db.select().from(purchases).orderBy(desc(purchases.id)).limit(1);
  return r[0];
}

export async function updatePurchase(id: number, data: Partial<InsertPurchase>) {
  const db = await getDb();
  if (!db) return;
  await db.update(purchases).set(data).where(eq(purchases.id, id));
}

export async function deletePurchase(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(purchases).where(eq(purchases.id, id));
}

export async function getMonthlyPurchasesTotal(restaurantId: number, year: number, month: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = `${year}-${String(month).padStart(2, "0")}-31`;
  const r = await db.select({ total: sql<string>`COALESCE(SUM(cost), 0)` }).from(purchases)
    .where(and(eq(purchases.restaurantId, restaurantId), sql`${purchases.purchaseDate} >= ${from}`, sql`${purchases.purchaseDate} <= ${to}`));
  return parseFloat(r[0]?.total ?? "0");
}

// ─── Monthly Fixed Costs ──────────────────────────────────────────────────────
export async function getFixedCostsByMonth(restaurantId: number, effectiveMonth: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(monthlyFixedCosts)
    .where(and(eq(monthlyFixedCosts.restaurantId, restaurantId), eq(monthlyFixedCosts.effectiveMonth, effectiveMonth)))
    .orderBy(monthlyFixedCosts.categoryType);
}

export async function createFixedCost(data: InsertMonthlyFixedCost) {
  const db = await getDb();
  if (!db) return;
  await db.insert(monthlyFixedCosts).values(data);
  const r = await db.select().from(monthlyFixedCosts).orderBy(desc(monthlyFixedCosts.id)).limit(1);
  return r[0];
}

export async function updateFixedCost(id: number, data: Partial<InsertMonthlyFixedCost>) {
  const db = await getDb();
  if (!db) return;
  await db.update(monthlyFixedCosts).set(data).where(eq(monthlyFixedCosts.id, id));
}

export async function deleteFixedCost(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(monthlyFixedCosts).where(eq(monthlyFixedCosts.id, id));
}

export async function getMonthlyFixedCostsTotal(restaurantId: number, effectiveMonth: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const r = await db.select({ total: sql<string>`COALESCE(SUM(amount), 0)` }).from(monthlyFixedCosts)
    .where(and(eq(monthlyFixedCosts.restaurantId, restaurantId), eq(monthlyFixedCosts.effectiveMonth, effectiveMonth)));
  return parseFloat(r[0]?.total ?? "0");
}

// ─── Notifications ────────────────────────────────────────────────────────────
export async function createNotification(data: InsertNotification) {
  const db = await getDb();
  if (!db) return;
  await db.insert(notifications).values(data);
}

export async function getNotificationsByRecipient(recipientId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notifications)
    .where(eq(notifications.recipientId, recipientId))
    .orderBy(desc(notifications.createdAt))
    .limit(50);
}

export async function getMasterNotifications() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notifications)
    .orderBy(desc(notifications.createdAt))
    .limit(100);
}

export async function markNotificationRead(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
}

// ─── Profitability Calculation ────────────────────────────────────────────────
export async function calculateMonthlyLaborCost(restaurantId: number, year: number, month: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const from = new Date(`${monthStr}-01T00:00:00Z`);
  const daysInMonth = new Date(year, month, 0).getDate();
  const to = new Date(`${monthStr}-${String(daysInMonth).padStart(2, "0")}T23:59:59Z`);

  // 해당 월 확정/승인 스케줄 조회
  const monthSchedules = await db.select().from(schedules)
    .where(and(
      eq(schedules.restaurantId, restaurantId),
      gte(schedules.startTime, from),
      lte(schedules.startTime, to),
      inArray(schedules.status, ["confirmed", "completed"])
    ));

  if (!monthSchedules.length) return 0;

   const userIds = Array.from(new Set(monthSchedules.map(s => s.userId).filter((id): id is number => id !== null)));
  const contracts = userIds.length > 0 ? await db.select().from(employeeContracts)
    .where(and(eq(employeeContracts.restaurantId, restaurantId), inArray(employeeContracts.userId, userIds), eq(employeeContracts.isActive, true))) : [];
  let totalLaborCost = 0;
  for (const schedule of monthSchedules) {
    if (!schedule.userId) continue;  // 임시 근로자는 별도 처리
    const contract = contracts.find(c => c.userId === schedule.userId);
    if (!contract) continue;
    const hours = (schedule.endTime.getTime() - schedule.startTime.getTime()) / 3600000;
    if (contract.wageType === "hourly") {
      totalLaborCost += hours * parseFloat(contract.wageAmount ?? "0");
    } else {
      // 월급제: 일급 = 월급 / 해당 월 일수
      totalLaborCost += parseFloat(contract.wageAmount ?? "0") / daysInMonth;
    }
  }
  return Math.round(totalLaborCost);
}

export async function calculateDailyLaborCost(restaurantId: number, dateStr: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const dayStart = new Date(`${dateStr}T00:00:00Z`);
  const dayEnd = new Date(`${dateStr}T23:59:59Z`);
  const now = new Date();

  const daySchedules = await db.select().from(schedules)
    .where(and(
      eq(schedules.restaurantId, restaurantId),
      gte(schedules.startTime, dayStart),
      lte(schedules.startTime, dayEnd),
      inArray(schedules.status, ["confirmed", "completed", "published"])
    ));

  if (!daySchedules.length) return 0;

   const userIds = Array.from(new Set(daySchedules.map(s => s.userId).filter((id): id is number => id !== null)));
  const contracts = userIds.length > 0 ? await db.select().from(employeeContracts)
    .where(and(eq(employeeContracts.restaurantId, restaurantId), inArray(employeeContracts.userId, userIds), eq(employeeContracts.isActive, true))) : [];
  const year = dayStart.getFullYear();
  const month = dayStart.getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  let totalLaborCost = 0;
  for (const schedule of daySchedules) {
    if (!schedule.userId) continue;  // 임시 근로자는 별도 처리
    const contract = contracts.find(c => c.userId === schedule.userId);
    if (!contract) continue;;
    if (contract.wageType === "hourly") {
      const effectiveEnd = now < schedule.endTime ? now : schedule.endTime;
      const hours = Math.max(0, (effectiveEnd.getTime() - schedule.startTime.getTime()) / 3600000);
      totalLaborCost += hours * parseFloat(contract.wageAmount ?? "0");
    } else {
      totalLaborCost += parseFloat(contract.wageAmount ?? "0") / daysInMonth;
    }
  }
  return Math.round(totalLaborCost);
}

// ─── 직원별 인건비 세부 내역 ─────────────────────────────────────────────────
export async function calculateMonthlyLaborCostByUser(restaurantId: number, year: number, month: number): Promise<Array<{
  userId: number;
  userName: string;
  wageType: string;
  wageAmount: number;
  totalHours: number;
  laborCost: number;
}>> {
  const db = await getDb();
  if (!db) return [];
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const from = new Date(`${monthStr}-01T00:00:00Z`);
  const daysInMonth = new Date(year, month, 0).getDate();
  const to = new Date(`${monthStr}-${String(daysInMonth).padStart(2, "0")}T23:59:59Z`);
  const monthSchedules = await db.select().from(schedules)
    .where(and(
      eq(schedules.restaurantId, restaurantId),
      gte(schedules.startTime, from),
      lte(schedules.startTime, to),
      inArray(schedules.status, ["confirmed", "completed"])
    ));
  if (!monthSchedules.length) return [];
  const userIds = Array.from(new Set(monthSchedules.map(s => s.userId).filter((id): id is number => id !== null)));
  const contracts = userIds.length > 0 ? await db.select().from(employeeContracts)
    .where(and(eq(employeeContracts.restaurantId, restaurantId), inArray(employeeContracts.userId, userIds), eq(employeeContracts.isActive, true))) : [];
  const userList = userIds.length > 0 ? await db.select({ id: users.id, name: users.name }).from(users)
    .where(inArray(users.id, userIds)) : [];
  const result: Array<{ userId: number; userName: string; wageType: string; wageAmount: number; totalHours: number; laborCost: number }> = [];
  for (const uid of userIds) {
    const contract = contracts.find(c => c.userId === uid);
    if (!contract) continue;
    const userSchedules = monthSchedules.filter(s => s.userId === uid);
    const totalHours = userSchedules.reduce((acc, s) => acc + (s.endTime.getTime() - s.startTime.getTime()) / 3600000, 0);
    let laborCost = 0;
    if (contract.wageType === "hourly") {
      laborCost = totalHours * parseFloat(contract.wageAmount ?? "0");
    } else {
      laborCost = parseFloat(contract.wageAmount ?? "0");
    }
    const userInfo = userList.find(u => u.id === uid);
    result.push({
      userId: uid,
      userName: userInfo?.name ?? "알 수 없음",
      wageType: contract.wageType ?? "hourly",
      wageAmount: parseFloat(contract.wageAmount ?? "0"),
      totalHours: Math.round(totalHours * 10) / 10,
      laborCost: Math.round(laborCost),
    });
  }
  return result.sort((a, b) => b.laborCost - a.laborCost);
}

// ─── 고정비 카테고리별 합계 ───────────────────────────────────────────────────
export async function getFixedCostsByCategory(restaurantId: number, effectiveMonth: string): Promise<Array<{
  categoryType: string;
  label: string;
  total: number;
}>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(monthlyFixedCosts)
    .where(and(eq(monthlyFixedCosts.restaurantId, restaurantId), eq(monthlyFixedCosts.effectiveMonth, effectiveMonth)));
  const LABELS: Record<string, string> = { rent: "임대료", utility: "공과금", fee: "수수료", labor_fixed: "고정 인건비", other: "잡비" };
  const map: Record<string, number> = {};
  for (const row of rows) {
    const cat = row.categoryType ?? "other";
    map[cat] = (map[cat] ?? 0) + parseFloat(row.amount?.toString() ?? "0");
  }
  return Object.entries(map).map(([cat, total]) => ({ categoryType: cat, label: LABELS[cat] ?? cat, total: Math.round(total) }));
}

// ─── 매장 계약 조건 (Restaurant Contracts) ────────────────────────────────────
export async function getRestaurantContractsByRestaurant(restaurantId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(restaurantContracts)
    .where(and(eq(restaurantContracts.restaurantId, restaurantId), eq(restaurantContracts.isActive, true)))
    .orderBy(restaurantContracts.contractType);
}

export async function createRestaurantContract(data: {
  restaurantId: number;
  contractType: "rent" | "commission" | "royalty" | "investor" | "other";
  name: string;
  calcType: "fixed" | "ratio";
  fixedAmount?: number;
  ratioPercent?: number;
  startDate?: string;
  endDate?: string;
  note?: string;
  autoApplyToFixedCost?: boolean;
  createdBy?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const insertData: Record<string, unknown> = {
    contractType: data.contractType,
    name: data.name,
    calcType: data.calcType,
    fixedAmount: data.fixedAmount?.toString() ?? "0",
    ratioPercent: data.ratioPercent?.toString() ?? "0",
    note: data.note,
    autoApplyToFixedCost: data.autoApplyToFixedCost ?? true,
    isActive: true,
    createdBy: data.createdBy,
  };
  if (data.startDate) insertData.startDate = new Date(data.startDate);
  if (data.endDate) insertData.endDate = new Date(data.endDate);
  // restaurantId 직접 SQL로 삽입
  await db.execute(
    sql`INSERT INTO restaurant_contracts (restaurantId, contractType, name, calcType, fixedAmount, ratioPercent, startDate, endDate, note, autoApplyToFixedCost, isActive, createdBy)
    VALUES (${data.restaurantId}, ${data.contractType}, ${data.name}, ${data.calcType},
      ${data.fixedAmount?.toString() ?? "0"}, ${data.ratioPercent?.toString() ?? "0"},
      ${data.startDate ? new Date(data.startDate) : null}, ${data.endDate ? new Date(data.endDate) : null},
      ${data.note ?? null}, ${data.autoApplyToFixedCost ?? true}, true, ${data.createdBy ?? null})`
  );
}

export async function updateRestaurantContract(id: number, data: Partial<{
  contractType: "rent" | "commission" | "royalty" | "investor" | "other";
  name: string;
  calcType: "fixed" | "ratio";
  fixedAmount: number;
  ratioPercent: number;
  startDate: string;
  endDate: string;
  note: string;
  autoApplyToFixedCost: boolean;
  isActive: boolean;
}>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const updateData: Record<string, unknown> = {};
  if (data.contractType !== undefined) updateData.contractType = data.contractType;
  if (data.name !== undefined) updateData.name = data.name;
  if (data.calcType !== undefined) updateData.calcType = data.calcType;
  if (data.fixedAmount !== undefined) updateData.fixedAmount = data.fixedAmount.toString();
  if (data.ratioPercent !== undefined) updateData.ratioPercent = data.ratioPercent.toString();
  if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
  if (data.endDate !== undefined) updateData.endDate = new Date(data.endDate);
  if (data.note !== undefined) updateData.note = data.note;
  if (data.autoApplyToFixedCost !== undefined) updateData.autoApplyToFixedCost = data.autoApplyToFixedCost;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  await db.update(restaurantContracts).set(updateData).where(eq(restaurantContracts.id, id));
}

export async function deleteRestaurantContract(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  // soft delete
  await db.update(restaurantContracts).set({ isActive: false }).where(eq(restaurantContracts.id, id));
}

// 계약 조건에서 해당 월 고정비 자동 계산 (매출 비율형은 해당 월 매출 기준)
export async function applyContractsToFixedCosts(restaurantId: number, effectiveMonth: string, monthlySales: number) {
  const db = await getDb();
  if (!db) return [];
  const contracts = await db.select().from(restaurantContracts)
    .where(and(
      eq(restaurantContracts.restaurantId, restaurantId),
      eq(restaurantContracts.isActive, true),
      eq(restaurantContracts.autoApplyToFixedCost, true),
    ));
  return contracts.map(c => {
    let amount = 0;
    if (c.calcType === "fixed") {
      amount = parseFloat(c.fixedAmount?.toString() ?? "0");
    } else {
      amount = monthlySales * parseFloat(c.ratioPercent?.toString() ?? "0") / 100;
    }
    return {
      id: c.id,
      name: c.name,
      contractType: c.contractType,
      calcType: c.calcType,
      fixedAmount: parseFloat(c.fixedAmount?.toString() ?? "0"),
      ratioPercent: parseFloat(c.ratioPercent?.toString() ?? "0"),
      calculatedAmount: Math.round(amount),
    };
  });
}

// ─── 계약 조건 → 월 고정비 자동 동기화 ──────────────────────────────────────
// 계약 유형별로 모든 활성 계약 항목을 합산하여 고정비에 upsert합니다.
// 예: 임대료 항목 2개 → 합산 후 단일 "임대료" 고정비 행으로 반영
// 단, 각 개별 항목도 contractId로 추적하여 삭제/비활성화 시 정리합니다.
export async function syncContractToFixedCosts(
  restaurantId: number,
  effectiveMonth: string,
  monthlySales: number,
  createdBy?: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // 자동 반영 대상 계약 조건 조회
  const contracts = await db.select().from(restaurantContracts)
    .where(and(
      eq(restaurantContracts.restaurantId, restaurantId),
      eq(restaurantContracts.isActive, true),
      eq(restaurantContracts.autoApplyToFixedCost, true),
    ));

  // 계약 유형 → 고정비 카테고리 매핑
  const categoryTypeMap: Record<string, "rent" | "utility" | "fee" | "labor_fixed" | "other"> = {
    rent: "rent",
    commission: "fee",
    royalty: "fee",
    investor: "other",
    other: "other",
  };
  const contractTypeLabels: Record<string, string> = {
    rent: "임대료",
    commission: "임대 수수료",
    royalty: "본사 로얄티",
    investor: "투자자 지분",
    other: "기타 계약",
  };

  // ── 1단계: 계약 유형별로 합산 ─────────────────────────────────────────
  // contractType별 { totalAmount, names[], categoryType, contractIds[] } 집계
  const typeGroups = new Map<string, {
    totalAmount: number;
    names: string[];
    categoryType: "rent" | "utility" | "fee" | "labor_fixed" | "other";
    contractIds: number[];
    details: string[];
  }>();

  for (const contract of contracts) {
    let amount = 0;
    if (contract.calcType === "fixed") {
      amount = parseFloat(contract.fixedAmount?.toString() ?? "0");
    } else {
      amount = monthlySales * parseFloat(contract.ratioPercent?.toString() ?? "0") / 100;
    }
    const roundedAmount = Math.round(amount);
    const categoryType = categoryTypeMap[contract.contractType] ?? "other";
    const detail = contract.calcType === "ratio"
      ? `${contract.name}(매출 ${contract.ratioPercent}%=${roundedAmount.toLocaleString()}원)`
      : `${contract.name}(${roundedAmount.toLocaleString()}원)`;

    const existing = typeGroups.get(contract.contractType);
    if (existing) {
      existing.totalAmount += roundedAmount;
      existing.names.push(contract.name);
      existing.contractIds.push(contract.id);
      existing.details.push(detail);
    } else {
      typeGroups.set(contract.contractType, {
        totalAmount: roundedAmount,
        names: [contract.name],
        categoryType,
        contractIds: [contract.id],
        details: [detail],
      });
    }
  }

  // ── 2단계: 해당 월 기존 계약 기반 고정비 조회 ─────────────────────────
  // contractId IS NOT NULL 인 기존 항목들을 모두 가져옴
  const existingContractCosts = await db.select().from(monthlyFixedCosts)
    .where(and(
      eq(monthlyFixedCosts.restaurantId, restaurantId),
      eq(monthlyFixedCosts.effectiveMonth, effectiveMonth),
      sql`${monthlyFixedCosts.contractId} IS NOT NULL`,
    ));

  // contractType별로 대표 행 하나만 남기고 나머지는 삭제 (중복 정리)
  // 대표 행: contractId가 가장 작은 것 (첫 번째 생성된 것)
  const representativeByType = new Map<string, typeof existingContractCosts[0]>();
  const toDelete: number[] = [];

  // 기존 행들을 contractId로 어떤 계약 유형인지 찾아 분류
  const contractIdToType = new Map<number, string>();
  for (const c of contracts) contractIdToType.set(c.id, c.contractType);
  // 기존 행 중 계약이 없어진 것도 처리
  for (const existing of existingContractCosts) {
    if (existing.contractId === null) continue;
    const ctype = contractIdToType.get(existing.contractId);
    if (!ctype) {
      // 계약이 삭제/비활성화됨 → 고정비 행도 삭제
      toDelete.push(existing.id);
      continue;
    }
    const rep = representativeByType.get(ctype);
    if (!rep) {
      representativeByType.set(ctype, existing);
    } else {
      // 중복 행 삭제 (대표 행만 남김)
      toDelete.push(existing.id);
    }
  }

  // 중복/불필요 행 삭제
  for (const id of toDelete) {
    await db.delete(monthlyFixedCosts).where(eq(monthlyFixedCosts.id, id));
  }

  // ── 3단계: 계약 유형별 합산 결과를 고정비에 upsert ────────────────────
  for (const [contractType, group] of Array.from(typeGroups.entries())) {
    const categoryLabel = contractTypeLabels[contractType] ?? "기타 계약";
    const noteText = group.details.length > 1
      ? `[계약 자동반영] ${group.details.join(" + ")} = 합계 ${group.totalAmount.toLocaleString()}원`
      : `[계약 자동반영] ${group.details[0]}`;
    // 대표 contractId: 해당 유형의 첫 번째 계약 ID
    const representativeContractId = group.contractIds[0];

    const rep = representativeByType.get(contractType);
    if (rep) {
      // 기존 대표 행 업데이트
      await db.update(monthlyFixedCosts)
        .set({
          costCategory: group.names.length > 1 ? `${categoryLabel} (${group.names.length}건 합산)` : group.names[0],
          categoryType: group.categoryType,
          amount: String(group.totalAmount),
          note: noteText,
          contractId: representativeContractId,
        })
        .where(eq(monthlyFixedCosts.id, rep.id));
    } else {
      // 새 행 생성
      await db.insert(monthlyFixedCosts).values({
        restaurantId,
        effectiveMonth,
        costCategory: group.names.length > 1 ? `${categoryLabel} (${group.names.length}건 합산)` : group.names[0],
        categoryType: group.categoryType,
        amount: String(group.totalAmount),
        note: noteText,
        contractId: representativeContractId,
        createdBy: createdBy ?? null,
      });
    }
  }

  // ── 4단계: 이번 동기화에서 처리되지 않은 기존 유형의 행 삭제 ──────────
  // (계약 조건이 모두 삭제된 유형의 고정비 행 제거)
  for (const [ctype, rep] of Array.from(representativeByType.entries())) {
    if (!typeGroups.has(ctype)) {
      await db.delete(monthlyFixedCosts).where(eq(monthlyFixedCosts.id, rep.id));
    }
  }
}

// ─── Daily Closings (일마감) ─────────────────────────────────────────────────

export async function getDailyClosing(restaurantId: number, dateStr: string) {
  const db = await getDb();
  if (!db) return null;
  const { dailyClosings } = await import("../drizzle/schema");
  const rows = await db.select().from(dailyClosings)
    .where(and(eq(dailyClosings.restaurantId, restaurantId), sql`${dailyClosings.closingDate} = ${dateStr}`))
    .limit(1);
  return rows[0] ?? null;
}

export async function getDailyClosingsByMonth(restaurantId: number, year: number, month: number) {
  const db = await getDb();
  if (!db) return [];
  const { dailyClosings } = await import("../drizzle/schema");
  const startStr = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endStr = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const rows = await db.select().from(dailyClosings)
    .where(and(
      eq(dailyClosings.restaurantId, restaurantId),
      sql`${dailyClosings.closingDate} >= ${startStr}`,
      sql`${dailyClosings.closingDate} <= ${endStr}`
    ))
    .orderBy(dailyClosings.closingDate);
  return rows;
}

export async function upsertDailyClosing(data: {
  restaurantId: number;
  closingDate: string;
  salesTotal: number;
  purchasesTotal: number;
  laborCost: number;
  fixedCostShare: number;
  profit: number;
  note?: string;
  closedBy: number;
  salesBreakdown?: Array<{typeName: string; amount: number}>;
  salesSpecials?: Array<{typeName: string; amount: number; note?: string}>;
  tomorrowScheduleConfirmed?: boolean;
  scheduleNote?: string;
  purchaseNote?: string;
  orderCheckPhotoUrl?: string;
  orderCheckNoOrder?: boolean;
  // 수정 이력 관련
  editHistoryEntry?: { userId: number; userName: string; at: string; summary: string };
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const { dailyClosings } = await import("../drizzle/schema");
  const existing = await getDailyClosing(data.restaurantId, data.closingDate);
  const now = new Date();
  // 수정 이력 배열 업데이트
  let updatedEditHistory: Array<{userId: number; userName: string; at: string; summary: string}> | null = null;
  if (existing && data.editHistoryEntry) {
    const prevHistory = (existing as any).editHistory ?? [];
    updatedEditHistory = [...prevHistory, data.editHistoryEntry];
  }
  const setData: Record<string, unknown> = {
    salesTotal: String(data.salesTotal),
    purchasesTotal: String(data.purchasesTotal),
    laborCost: String(data.laborCost),
    fixedCostShare: String(data.fixedCostShare),
    profit: String(data.profit),
    note: data.note,
    closedBy: data.closedBy,
    closedAt: now,
    salesBreakdown: data.salesBreakdown ?? null,
    salesSpecials: data.salesSpecials ?? null,
    tomorrowScheduleConfirmed: data.tomorrowScheduleConfirmed ?? false,
    scheduleNote: data.scheduleNote ?? null,
    purchaseNote: data.purchaseNote ?? null,
    orderCheckPhotoUrl: data.orderCheckPhotoUrl ?? null,
    orderCheckNoOrder: data.orderCheckNoOrder ?? false,
  };
  if (existing && data.editHistoryEntry) {
    setData.lastModifiedBy = data.editHistoryEntry.userId;
    setData.lastModifiedAt = now;
    setData.editHistory = updatedEditHistory;
  }
  if (existing) {
    await db.update(dailyClosings).set(setData as any).where(eq(dailyClosings.id, existing.id));
    return { ...existing, ...data };
  } else {
    const [result] = await db.insert(dailyClosings).values({
      restaurantId: data.restaurantId,
      closingDate: new Date(data.closingDate + 'T00:00:00'),
      ...setData,
    });
    return result;
  }
}

// 일마감 상세 조회 (매출 상세 + 매입 목록 + 스케줄 포함)
export async function getDailyClosingDetail(restaurantId: number, dateStr: string) {
  const db = await getDb();
  if (!db) return null;
  const { dailySalesDetail, salesOtherItems, purchases, purchaseOrdersV2, purchaseOrderItemsV2, schedules } = await import("../drizzle/schema");
  // 매출 상세
  const [salesDetail] = await db.select().from(dailySalesDetail)
    .where(and(eq(dailySalesDetail.restaurantId, restaurantId), sql`${dailySalesDetail.saleDate} = ${dateStr}`))
    .limit(1);
  let otherItems: any[] = [];
  if (salesDetail) {
    otherItems = await db.select().from(salesOtherItems)
      .where(eq(salesOtherItems.dailySalesDetailId, salesDetail.id));
  }
  // 매입 목록 (purchases 테이블)
  const purchaseList = await db.select().from(purchases)
    .where(and(eq(purchases.restaurantId, restaurantId), sql`${purchases.purchaseDate} = ${dateStr}`))
    .orderBy(purchases.createdAt);
  // 매입 전표 v2
  const purchaseOrderList = await db.select().from(purchaseOrdersV2)
    .where(and(eq(purchaseOrdersV2.restaurantId, restaurantId), sql`${purchaseOrdersV2.purchaseDate} = ${dateStr}`))
    .orderBy(purchaseOrdersV2.createdAt);
  // 전표 항목
  const orderIds = purchaseOrderList.map(o => o.id);
  let purchaseOrderItems: any[] = [];
  if (orderIds.length > 0) {
    purchaseOrderItems = await db.select().from(purchaseOrderItemsV2)
      .where(sql`${purchaseOrderItemsV2.purchaseOrderId} IN (${sql.join(orderIds.map(id => sql`${id}`), sql`, `)})`);
  }
  // 해당일 스케줄 (출근인원 및 인건비 계산)
  // dateStr은 KST 날짜 문자열 (YYYY-MM-DD). 해당 날짜 KST 00:00 ~ 23:59:59 범위의 스케줄 조회
  const dayStart = new Date(`${dateStr}T00:00:00+09:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59+09:00`);
  const daySchedules = await db.select().from(schedules)
    .where(and(
      eq(schedules.restaurantId, restaurantId),
      gte(schedules.startTime, dayStart),
      sql`${schedules.startTime} <= ${dayEnd}`,
      sql`${schedules.status} IN ('completed', 'confirmed')`
    ));
  // 출근인원: completed/confirmed 상태 스케줄 수
  const attendeeCount = daySchedules.length;
  // 인건비 합계: 근무시간 × 시급 (임시직 포함)
  let laborCostTotal = 0;
  for (const s of daySchedules) {
    const hours = (s.endTime.getTime() - s.startTime.getTime()) / 3600000;
    if (s.tempWageType === 'hourly' && s.tempWageAmount) {
      laborCostTotal += hours * Number(s.tempWageAmount);
    } else if (s.tempWageType === 'daily' && s.tempWageAmount) {
      laborCostTotal += Number(s.tempWageAmount);
    }
    // 정규직 인건비는 payroll 테이블에서 계산되므로 여기서는 임시직만 합산
  }
  // 일마감 기록
  const closing = await getDailyClosing(restaurantId, dateStr);
  return {
    date: dateStr,
    closing,
    salesDetail: salesDetail ?? null,
    otherItems,
    purchaseList,
    purchaseOrderList,
    purchaseOrderItems,
    attendeeCount,
    laborCostTotal: Math.round(laborCostTotal),
    scheduleList: daySchedules.map(s => ({
      id: s.id,
      userId: s.userId,
      tempWorkerName: s.tempWorkerName,
      status: s.status,
      startTime: s.startTime,
      endTime: s.endTime,
      shiftPreset: s.shiftPreset,
      note: s.note,
    })),
  };
}

// 월별 날짜별 출근인원 집계 (completed/confirmed 스케줄 수)
export async function getMonthlyAttendanceCounts(restaurantId: number, year: number, month: number): Promise<Record<string, number>> {
  const db = await getDb();
  if (!db) return {};
  const { schedules } = await import("../drizzle/schema");
  const monthStart = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+09:00`);
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = new Date(`${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}T23:59:59+09:00`);
  const rows = await db.select({
    startTime: schedules.startTime,
  }).from(schedules)
    .where(and(
      eq(schedules.restaurantId, restaurantId),
      gte(schedules.startTime, monthStart),
      sql`${schedules.startTime} <= ${monthEnd}`,
      sql`${schedules.status} IN ('completed', 'confirmed')`
    ));
  const counts: Record<string, number> = {};
  for (const row of rows) {
    // KST 날짜 문자열 추출
    const d = new Date(row.startTime.getTime() + 9 * 3600000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

// 매출 항목 유형 조회
export async function getDailyClosingSalesTypes(restaurantId: number) {
  const db = await getDb();
  if (!db) return [];
  const { dailyClosingSalesTypes } = await import("../drizzle/schema");
  return db.select().from(dailyClosingSalesTypes)
    .where(and(eq(dailyClosingSalesTypes.restaurantId, restaurantId), eq(dailyClosingSalesTypes.isActive, true)))
    .orderBy(dailyClosingSalesTypes.sortOrder);
}

// 매출 항목 유형 추가
export async function addDailyClosingSalesType(restaurantId: number, typeName: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const { dailyClosingSalesTypes } = await import("../drizzle/schema");
  // 최대 sortOrder 조회
  const existing = await getDailyClosingSalesTypes(restaurantId);
  const maxOrder = existing.reduce((m, r) => Math.max(m, r.sortOrder), 0);
  await db.insert(dailyClosingSalesTypes).values({ restaurantId, typeName, sortOrder: maxOrder + 1 });
}

// 매출 특이사항 유형 조회
export async function getDailyClosingSpecialTypes(restaurantId: number) {
  const db = await getDb();
  if (!db) return [];
  const { dailyClosingSpecialTypes } = await import("../drizzle/schema");
  return db.select().from(dailyClosingSpecialTypes)
    .where(and(eq(dailyClosingSpecialTypes.restaurantId, restaurantId), eq(dailyClosingSpecialTypes.isActive, true)))
    .orderBy(dailyClosingSpecialTypes.sortOrder);
}

// 매출 특이사항 유형 추가
export async function addDailyClosingSpecialType(restaurantId: number, typeName: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const { dailyClosingSpecialTypes } = await import("../drizzle/schema");
  const existing = await getDailyClosingSpecialTypes(restaurantId);
  const maxOrder = existing.reduce((m, r) => Math.max(m, r.sortOrder), 0);
  await db.insert(dailyClosingSpecialTypes).values({ restaurantId, typeName, sortOrder: maxOrder + 1 });
}

// ─── Monthly Closings (월마감) ───────────────────────────────────────────────

export async function getMonthlyClosing(restaurantId: number, year: number, month: number) {
  const db = await getDb();
  if (!db) return null;
  const { monthlyClosings } = await import("../drizzle/schema");
  const rows = await db.select().from(monthlyClosings)
    .where(and(
      eq(monthlyClosings.restaurantId, restaurantId),
      eq(monthlyClosings.year, year),
      eq(monthlyClosings.month, month)
    ))
    .limit(1);
  return rows[0] ?? null;
}

export async function getMonthlyClosingsByYear(restaurantId: number, year: number) {
  const db = await getDb();
  if (!db) return [];
  const { monthlyClosings } = await import("../drizzle/schema");
  const rows = await db.select().from(monthlyClosings)
    .where(and(eq(monthlyClosings.restaurantId, restaurantId), eq(monthlyClosings.year, year)))
    .orderBy(monthlyClosings.month);
  return rows;
}

export async function upsertMonthlyClosing(data: {
  restaurantId: number;
  year: number;
  month: number;
  salesTotal: number;
  purchasesTotal: number;
  laborCost: number;
  fixedCostsTotal: number;
  profit: number;
  note?: string;
  closedBy: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const { monthlyClosings } = await import("../drizzle/schema");
  const existing = await getMonthlyClosing(data.restaurantId, data.year, data.month);
  if (existing) {
    await db.update(monthlyClosings).set({
      salesTotal: String(data.salesTotal),
      purchasesTotal: String(data.purchasesTotal),
      laborCost: String(data.laborCost),
      fixedCostsTotal: String(data.fixedCostsTotal),
      profit: String(data.profit),
      note: data.note,
      closedBy: data.closedBy,
      closedAt: new Date(),
    }).where(eq(monthlyClosings.id, existing.id));
    return { ...existing, ...data };
  } else {
    const [result] = await db.insert(monthlyClosings).values({
      restaurantId: data.restaurantId,
      year: data.year,
      month: data.month,
      salesTotal: String(data.salesTotal),
      purchasesTotal: String(data.purchasesTotal),
      laborCost: String(data.laborCost),
      fixedCostsTotal: String(data.fixedCostsTotal),
      profit: String(data.profit),
      note: data.note,
      closedBy: data.closedBy,
    });
    return result;
  }
}

// ─── Store Checklist Templates (체크리스트 템플릿) ─────────────────────────────
export async function getChecklistTemplates(restaurantId: number, checkType: "open" | "order" | "cleaning") {
  const db = await getDb();
  if (!db) return [];
  const { storeChecklistTemplates } = await import("../drizzle/schema");
  return db.select().from(storeChecklistTemplates)
    .where(and(
      eq(storeChecklistTemplates.restaurantId, restaurantId),
      eq(storeChecklistTemplates.checkType, checkType),
      eq(storeChecklistTemplates.isActive, true),
    ))
    .orderBy(storeChecklistTemplates.sortOrder);
}

export async function getAllChecklistTemplates(restaurantId: number) {
  const db = await getDb();
  if (!db) return [];
  const { storeChecklistTemplates } = await import("../drizzle/schema");
  return db.select().from(storeChecklistTemplates)
    .where(eq(storeChecklistTemplates.restaurantId, restaurantId))
    .orderBy(storeChecklistTemplates.checkType, storeChecklistTemplates.sortOrder);
}

export async function createChecklistTemplate(data: {
  restaurantId: number;
  checkType: "open" | "order" | "cleaning";
  itemText: string;
  sortOrder?: number;
  createdBy: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const { storeChecklistTemplates } = await import("../drizzle/schema");
  const [result] = await db.insert(storeChecklistTemplates).values({
    restaurantId: data.restaurantId,
    checkType: data.checkType,
    itemText: data.itemText,
    sortOrder: data.sortOrder ?? 0,
    createdBy: data.createdBy,
  });
  return result;
}

export async function updateChecklistTemplate(id: number, data: {
  itemText?: string;
  sortOrder?: number;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const { storeChecklistTemplates } = await import("../drizzle/schema");
  await db.update(storeChecklistTemplates).set(data).where(eq(storeChecklistTemplates.id, id));
}

export async function deleteChecklistTemplate(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const { storeChecklistTemplates } = await import("../drizzle/schema");
  await db.update(storeChecklistTemplates).set({ isActive: false }).where(eq(storeChecklistTemplates.id, id));
}

// ─── Daily Checklist Logs (일별 체크 기록) ─────────────────────────────────────
export async function getDailyChecklistLog(restaurantId: number, logDate: string, checkType: "open" | "order" | "cleaning") {
  const db = await getDb();
  if (!db) return null;
  const { dailyChecklistLogs } = await import("../drizzle/schema");
  const rows = await db.select().from(dailyChecklistLogs)
    .where(and(
      eq(dailyChecklistLogs.restaurantId, restaurantId),
      eq(dailyChecklistLogs.logDate, logDate as unknown as Date),
      eq(dailyChecklistLogs.checkType, checkType),
    ))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertDailyChecklistLog(data: {
  restaurantId: number;
  logDate: string;
  checkType: "open" | "order" | "cleaning";
  checkedItemIds: number[];
  noOrderToday?: boolean;
  completedBy: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const { dailyChecklistLogs } = await import("../drizzle/schema");
  const existing = await getDailyChecklistLog(data.restaurantId, data.logDate, data.checkType);
  if (existing) {
    await db.update(dailyChecklistLogs).set({
      checkedItemIds: data.checkedItemIds,
      noOrderToday: data.noOrderToday ?? false,
      completedBy: data.completedBy,
      completedAt: new Date(),
    }).where(eq(dailyChecklistLogs.id, existing.id));
    return existing.id;
  } else {
    const [result] = await db.insert(dailyChecklistLogs).values({
      restaurantId: data.restaurantId,
      logDate: data.logDate as unknown as Date,
      checkType: data.checkType,
      checkedItemIds: data.checkedItemIds,
      noOrderToday: data.noOrderToday ?? false,
      completedBy: data.completedBy,
    });
    return result.insertId;
  }
}

// ─── Daily Checklist Summary (오늘 체크리스트 완료 요약) ────────────────────────
export async function getDailyChecklistSummary(restaurantId: number, logDate: string) {
  const db = await getDb();
  if (!db) return { open: null, order: null, cleaning: null };
  const { storeChecklistTemplates, dailyChecklistLogs } = await import("../drizzle/schema");

  const checkTypes = ["open", "order", "cleaning"] as const;
  const result: Record<string, { total: number; checked: number; completed: boolean } | null> = {};

  for (const checkType of checkTypes) {
    const templates = await db.select({ id: storeChecklistTemplates.id })
      .from(storeChecklistTemplates)
      .where(and(
        eq(storeChecklistTemplates.restaurantId, restaurantId),
        eq(storeChecklistTemplates.checkType, checkType),
        eq(storeChecklistTemplates.isActive, true),
      ));

    if (templates.length === 0) {
      result[checkType] = null; // 템플릿 없음
      continue;
    }

    const logs = await db.select().from(dailyChecklistLogs)
      .where(and(
        eq(dailyChecklistLogs.restaurantId, restaurantId),
        eq(dailyChecklistLogs.logDate, logDate as unknown as Date),
        eq(dailyChecklistLogs.checkType, checkType),
      ))
      .limit(1);

    const log = logs[0];
    if (!log) {
      result[checkType] = { total: templates.length, checked: 0, completed: false };
    } else {
      const checkedIds = (log.checkedItemIds as number[]) ?? [];
      const checked = templates.filter(t => checkedIds.includes(t.id)).length;
      result[checkType] = { total: templates.length, checked, completed: checked === templates.length };
    }
  }

  return result as {
    open: { total: number; checked: number; completed: boolean } | null;
    order: { total: number; checked: number; completed: boolean } | null;
    cleaning: { total: number; checked: number; completed: boolean } | null;
  };
}

