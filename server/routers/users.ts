import { z } from "zod";
import { eq, and, sql, isNull } from "drizzle-orm";
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
      // 레거시 manager/employee는 신규 생성 금지 — 직원은 /staff.quickAdd로 일원화
      role: z.enum(["master", "admin", "user"]).default("user"),
      email: z.string().email().optional(),
      phone: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // 권한 상승 방지: master/admin 역할은 master만 생성 가능
      if ((input.role === "master" || input.role === "admin") && ctx.user.role !== "master") {
        throw new Error("master/admin 역할 사용자는 개발자만 생성할 수 있습니다");
      }

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
    .mutation(async ({ input, ctx }) => {
      // 권한 상승 방지: admin 역할 부여는 master만 가능
      if (input.role === "admin" && ctx.user.role !== "master") {
        throw new Error("admin 역할 변경은 개발자만 가능합니다");
      }
      // master 계정은 수정 불가 (자기 자신 제외)
      if (input.id !== ctx.user.userId) {
        const [target] = await db.select({ role: users.role }).from(users).where(eq(users.id, input.id)).limit(1);
        if (target?.role === "master" && ctx.user.role !== "master") {
          throw new Error("개발자 계정은 수정할 수 없습니다");
        }
      }

      const { id, password, ...data } = input;
      const update: Record<string, unknown> = { ...data };
      if (password) update.passwordHash = await hashPassword(password);
      await db.update(users).set(update).where(eq(users.id, id));
      return { ok: true };
    }),

  /**
   * 사용자 계정 삭제 (대표/개발자 전용)
   * - 본인 삭제 금지
   * - master/admin 계정 삭제는 master만 가능
   * - restaurant_users 배정이 남아있으면 삭제 거부 (FK 없는 고아 레퍼런스 방지)
   *
   * 주의: schedules, audit_logs 등 FK 없는 테이블에는 고아 userId가 남을 수 있음.
   * 추후 cascade 또는 soft-delete 전환 검토 필요.
   */
  delete: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      // 1. 본인 삭제 금지
      if (input.userId === ctx.user.userId) {
        throw new Error("본인 계정은 삭제할 수 없습니다");
      }

      // 2. 대상 사용자 조회
      const [target] = await db
        .select({ id: users.id, role: users.role, username: users.username })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!target) throw new Error("사용자를 찾을 수 없습니다");

      // 3. master/admin 계정 삭제는 master만 가능 (권한 상승 방지와 대칭)
      if ((target.role === "master" || target.role === "admin") && ctx.user.role !== "master") {
        throw new Error("대표/개발자 계정은 개발자만 삭제할 수 있습니다");
      }

      // 4. 활성 매장 배정 잔존 시 삭제 거부
      //    - restaurant_users.resignedAt IS NULL (퇴사 안 한 배정)
      //    - restaurants.deletedAt IS NULL (archive 안 된 매장)
      //    위 두 조건 모두 만족하는 row만 "활성 배정"으로 카운트.
      //    퇴사 처리되었거나 매장이 archive 된 ru row는 논리적으로 정리됨 → user 삭제 허용.
      //    (해당 ru row 자체는 user 삭제 후에도 잔존 가능 — orphan은 별도 cleanup 대상)
      const activeAssignments = await db
        .select({ restaurantId: restaurantUsers.restaurantId })
        .from(restaurantUsers)
        .innerJoin(restaurants, eq(restaurants.id, restaurantUsers.restaurantId))
        .where(and(
          eq(restaurantUsers.userId, input.userId),
          isNull(restaurantUsers.resignedAt),
          isNull(restaurants.deletedAt),
        ));
      if (activeAssignments.length > 0) {
        throw new Error(
          `활성 매장 배정이 ${activeAssignments.length}건 남아있습니다. 먼저 퇴사 처리하거나 매장을 archive 해 주세요`
        );
      }

      // 5. 실제 삭제 (물리 삭제)
      await db.delete(users).where(eq(users.id, input.userId));
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

  updateBankBook: managerProcedure
    .input(z.object({
      userId: z.number(),
      bankBookUrl: z.string(),
    }))
    .mutation(async ({ input }) => {
      await db.update(users).set({ bankBookUrl: input.bankBookUrl }).where(eq(users.id, input.userId));
      return { ok: true };
    }),
});
