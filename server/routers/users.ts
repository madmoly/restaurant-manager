import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { router, protectedProcedure, adminProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { users, restaurantUsers, restaurants } from "../../drizzle/schema";
import { hashPassword } from "../auth";
import { activeRealStoreCondition } from "../helpers/restaurantScope";

export const usersRouter = router({
  list: adminProcedure.query(() =>
    db.select({
      id: users.id, username: users.username, name: users.name,
      email: users.email, phone: users.phone, role: users.role,
      isActive: users.isActive, createdAt: users.createdAt,
    }).from(users).where(eq(users.isTutorial, false))
  ),

  /** 사용자 목록 + 매장 배정 현황 */
  listWithAssignments: adminProcedure.query(async () => {
    const allUsers = await db.select({
      id: users.id, username: users.username, name: users.name,
      email: users.email, phone: users.phone, role: users.role,
      isActive: users.isActive, createdAt: users.createdAt,
    }).from(users).where(eq(users.isTutorial, false));

    // 중앙 스코핑 — tutorial 매장 자동 제외
    const assignments = await db.select({
      userId: restaurantUsers.userId,
      restaurantId: restaurantUsers.restaurantId,
      restaurantName: restaurants.name,
      storeRole: restaurantUsers.role,
    })
      .from(restaurantUsers)
      .innerJoin(restaurants, eq(restaurants.id, restaurantUsers.restaurantId))
      .where(activeRealStoreCondition());

    const assignmentMap: Record<number, Array<{ restaurantId: number; restaurantName: string; storeRole: string }>> = {};
    for (const a of assignments) {
      if (!assignmentMap[a.userId]) assignmentMap[a.userId] = [];
      assignmentMap[a.userId].push({ restaurantId: a.restaurantId, restaurantName: a.restaurantName, storeRole: a.storeRole });
    }

    return allUsers.map((u) => ({
      ...u,
      assignments: assignmentMap[u.id] ?? [],
    }));
  }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [user] = await db.select().from(users).where(eq(users.id, input.id)).limit(1);
      if (!user) throw new Error("사용자를 찾을 수 없습니다");
      const { passwordHash, ...safe } = user;
      return safe;
    }),

  create: adminProcedure
    .input(z.object({
      username: z.string().min(2),
      password: z.string().min(4),
      name: z.string().min(1),
      role: z.enum(["master", "admin", "manager", "employee"]).default("employee"),
      email: z.string().email().optional(),
      phone: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const existing = await db.select().from(users).where(eq(users.username, input.username)).limit(1);
      if (existing.length > 0) throw new Error("이미 존재하는 아이디입니다");

      const hash = await hashPassword(input.password);
      const [result] = await db.insert(users).values({
        username: input.username,
        passwordHash: hash,
        name: input.name,
        role: input.role,
        email: input.email,
        phone: input.phone,
      }).$returningId();
      return { id: result.id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      role: z.enum(["admin", "user"]).optional(),
      isActive: z.boolean().optional(),
      password: z.string().min(4).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, password, ...data } = input;
      const update: Record<string, unknown> = { ...data };
      if (password) update.passwordHash = await hashPassword(password);
      await db.update(users).set(update).where(eq(users.id, id));
      return { ok: true };
    }),

  /** 점장/매니저가 직원 ID/비밀번호 수정 (자기 매장 직원만) */
  updateStaffCredentials: managerProcedure
    .input(z.object({
      userId: z.number(),
      restaurantId: z.number(),
      username: z.string().min(2).optional(),
      password: z.string().min(4).optional(),
      name: z.string().min(1).optional(),
      phone: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // 자기 매장 직원인지 확인
      const [staffLink] = await db
        .select()
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId)
        ))
        .limit(1);
      if (!staffLink) throw new Error("해당 매장의 직원이 아닙니다");

      const update: Record<string, unknown> = {};
      if (input.username) {
        // 중복 확인
        const existing = await db.select({ id: users.id }).from(users)
          .where(eq(users.username, input.username)).limit(1);
        if (existing.length > 0 && existing[0].id !== input.userId) {
          throw new Error("이미 존재하는 아이디입니다");
        }
        update.username = input.username;
      }
      if (input.password) update.passwordHash = await hashPassword(input.password);
      if (input.name) update.name = input.name;
      if (input.phone !== undefined) update.phone = input.phone;

      if (Object.keys(update).length > 0) {
        await db.update(users).set(update).where(eq(users.id, input.userId));
      }
      return { ok: true };
    }),

  /** SUB대표 생성 — admin만 가능 (자기 하위에 admin 권한 사용자 추가) */
  createSubAdmin: adminProcedure
    .input(z.object({
      username: z.string().min(2),
      password: z.string().min(4),
      name: z.string().min(1),
      email: z.string().email().optional(),
      phone: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // master는 parentId 없이 admin 생성 (기존 create로 처리)
      // admin(대표)만 SUB대표 생성 가능
      if (ctx.user.role !== "admin" && ctx.user.role !== "master") {
        throw new Error("대표 이상만 SUB대표를 생성할 수 있습니다");
      }
      const existing = await db.select().from(users).where(eq(users.username, input.username)).limit(1);
      if (existing.length > 0) throw new Error("이미 존재하는 아이디입니다");

      const hash = await hashPassword(input.password);
      // SUB대표의 parentId = 생성한 admin의 userId
      // master가 생성하면 parentId = null (독립 admin)
      const parentId = ctx.user.role === "admin" ? ctx.user.userId : null;
      const [result] = await db.insert(users).values({
        username: input.username,
        passwordHash: hash,
        name: input.name,
        role: "admin",
        email: input.email,
        phone: input.phone,
        parentId,
      }).$returningId();
      return { id: result.id };
    }),

  /** SUB대표 목록 — 자기 하위 SUB대표만 조회 */
  listSubAdmins: adminProcedure.query(async ({ ctx }) => {
    if (ctx.user.role === "master") {
      // master: parentId가 있는 모든 admin (전체 SUB대표)
      return db.select({
        id: users.id, username: users.username, name: users.name,
        email: users.email, phone: users.phone, isActive: users.isActive,
        parentId: users.parentId, createdAt: users.createdAt,
      }).from(users).where(and(eq(users.role, "admin"), sql`${users.parentId} IS NOT NULL`));
    }
    // admin: 자기 하위 SUB대표만
    return db.select({
      id: users.id, username: users.username, name: users.name,
      email: users.email, phone: users.phone, isActive: users.isActive,
      parentId: users.parentId, createdAt: users.createdAt,
    }).from(users).where(and(eq(users.role, "admin"), eq(users.parentId, ctx.user.userId)));
  }),

  /** 보건증 정보 업데이트 */
  updateHealthCert: managerProcedure
    .input(z.object({
      userId: z.number(),
      healthCertUrl: z.string(),
      healthCertExpiry: z.string().optional(), // "YYYY-MM-DD"
    }))
    .mutation(async ({ input }) => {
      const update: Record<string, unknown> = { healthCertUrl: input.healthCertUrl };
      if (input.healthCertExpiry) update.healthCertExpiry = input.healthCertExpiry;
      await db.update(users).set(update).where(eq(users.id, input.userId));
      return { ok: true };
    }),
});
