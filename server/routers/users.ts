import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { router, protectedProcedure, adminProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { users, restaurantUsers, restaurants } from "../../drizzle/schema";
import { hashPassword } from "../auth";

export const usersRouter = router({
  list: adminProcedure.query(() =>
    db.select({
      id: users.id, username: users.username, name: users.name,
      email: users.email, phone: users.phone, role: users.role,
      isActive: users.isActive, createdAt: users.createdAt,
    }).from(users)
  ),

  /** 사용자 목록 + 매장 배정 현황 */
  listWithAssignments: adminProcedure.query(async () => {
    const allUsers = await db.select({
      id: users.id, username: users.username, name: users.name,
      email: users.email, phone: users.phone, role: users.role,
      isActive: users.isActive, createdAt: users.createdAt,
    }).from(users);

    const assignments = await db.select({
      userId: restaurantUsers.userId,
      restaurantId: restaurantUsers.restaurantId,
      restaurantName: restaurants.name,
      storeRole: restaurantUsers.role,
    })
      .from(restaurantUsers)
      .innerJoin(restaurants, eq(restaurants.id, restaurantUsers.restaurantId));

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
