import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { router, publicProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { restaurantInvites, users, restaurantUsers, restaurants } from "../../drizzle/schema";
import { hashPassword, createToken } from "../auth";
import crypto from "crypto";

/** 6자리 영숫자 초대코드 생성 */
function generateInviteCode(): string {
  return crypto.randomBytes(4).toString("base64url").slice(0, 6).toUpperCase();
}

export const invitesRouter = router({
  /** 초대코드 생성 (점장/매니져 이상) */
  generate: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      role: z.enum(["staff", "supervisor"]).default("staff"),
      expiresInHours: z.number().min(1).max(168).default(48), // 최대 7일
    }))
    .mutation(async ({ input, ctx }) => {
      const code = generateInviteCode();
      const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000);

      await db.insert(restaurantInvites).values({
        restaurantId: input.restaurantId,
        code,
        role: input.role,
        createdBy: ctx.user.userId,
        expiresAt,
      });

      // 매장 이름 조회
      const [restaurant] = await db.select({ name: restaurants.name })
        .from(restaurants).where(eq(restaurants.id, input.restaurantId)).limit(1);

      return {
        code,
        restaurantName: restaurant?.name ?? "",
        role: input.role,
        expiresAt: expiresAt.toISOString(),
      };
    }),

  /** 초대코드 유효성 검증 (비로그인 접근 가능) */
  validate: publicProcedure
    .input(z.object({ code: z.string().min(1) }))
    .query(async ({ input }) => {
      const [invite] = await db.select({
        id: restaurantInvites.id,
        restaurantId: restaurantInvites.restaurantId,
        role: restaurantInvites.role,
        expiresAt: restaurantInvites.expiresAt,
        usedBy: restaurantInvites.usedBy,
      })
        .from(restaurantInvites)
        .where(eq(restaurantInvites.code, input.code.toUpperCase()))
        .limit(1);

      if (!invite) return { valid: false as const, reason: "존재하지 않는 초대코드입니다" };
      if (invite.usedBy) return { valid: false as const, reason: "이미 사용된 초대코드입니다" };
      if (new Date(invite.expiresAt) < new Date()) return { valid: false as const, reason: "만료된 초대코드입니다" };

      // 매장 정보
      const [restaurant] = await db.select({ name: restaurants.name })
        .from(restaurants).where(eq(restaurants.id, invite.restaurantId)).limit(1);

      const roleLabel = invite.role === "supervisor" ? "매니져" : "직원";

      return {
        valid: true as const,
        restaurantName: restaurant?.name ?? "",
        role: invite.role,
        roleLabel,
      };
    }),

  /** 초대코드로 자가등록 (비로그인 접근 가능) */
  register: publicProcedure
    .input(z.object({
      code: z.string().min(1),
      name: z.string().min(1).max(50),
      username: z.string().min(3).max(50),
      password: z.string().min(4).max(100),
      phone: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const code = input.code.toUpperCase();

      // 1. 초대코드 재검증
      const [invite] = await db.select()
        .from(restaurantInvites)
        .where(and(
          eq(restaurantInvites.code, code),
          isNull(restaurantInvites.usedBy),
        ))
        .limit(1);

      if (!invite) throw new Error("유효하지 않은 초대코드입니다");
      if (new Date(invite.expiresAt) < new Date()) throw new Error("만료된 초대코드입니다");

      // 2. 아이디 중복 체크
      const [existing] = await db.select({ id: users.id })
        .from(users).where(eq(users.username, input.username)).limit(1);
      if (existing) throw new Error("이미 사용 중인 아이디입니다");

      // 3. 사용자 생성
      const passwordHash = await hashPassword(input.password);
      const [result] = await db.insert(users).values({
        username: input.username,
        passwordHash,
        name: input.name,
        phone: input.phone || null,
        role: "user",
        mustChangePassword: false, // 본인이 직접 설정한 비번이므로 변경 불필요
      } as any);
      const userId = (result as any).insertId;

      // 4. 매장 배정
      await db.insert(restaurantUsers).values({
        restaurantId: invite.restaurantId,
        userId,
        role: invite.role,
      } as any);

      // 5. 초대코드 사용 처리
      await db.update(restaurantInvites)
        .set({ usedBy: userId, usedAt: new Date() })
        .where(eq(restaurantInvites.id, invite.id));

      // 6. 토큰 발급 → 바로 로그인
      const token = await createToken({ userId, username: input.username, role: "user" });

      return {
        token,
        user: { id: userId, username: input.username, name: input.name, role: "user" },
      };
    }),

  /** 매장의 초대코드 목록 조회 (점장/매니져 이상) */
  list: managerProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input }) => {
      const invites = await db.select({
        id: restaurantInvites.id,
        code: restaurantInvites.code,
        role: restaurantInvites.role,
        createdBy: restaurantInvites.createdBy,
        usedBy: restaurantInvites.usedBy,
        expiresAt: restaurantInvites.expiresAt,
        usedAt: restaurantInvites.usedAt,
        createdAt: restaurantInvites.createdAt,
      })
        .from(restaurantInvites)
        .where(eq(restaurantInvites.restaurantId, input.restaurantId))
        .orderBy(restaurantInvites.createdAt);

      // 사용자 이름 매핑
      const allUserIds = [
        ...invites.map(i => i.createdBy),
        ...invites.filter(i => i.usedBy).map(i => i.usedBy!),
      ].filter(Boolean);

      let userMap: Record<number, string> = {};
      if (allUserIds.length > 0) {
        const userRows = await db.select({ id: users.id, name: users.name })
          .from(users);
        userMap = Object.fromEntries(userRows.map(u => [u.id, u.name]));
      }

      return invites.map(inv => ({
        ...inv,
        createdByName: userMap[inv.createdBy] ?? "?",
        usedByName: inv.usedBy ? (userMap[inv.usedBy] ?? "?") : null,
        isExpired: new Date(inv.expiresAt) < new Date(),
        isUsed: !!inv.usedBy,
      }));
    }),

  /** 초대코드 삭제 (미사용만) */
  delete: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const [invite] = await db.select()
        .from(restaurantInvites)
        .where(eq(restaurantInvites.id, input.id))
        .limit(1);

      if (!invite) throw new Error("초대코드를 찾을 수 없습니다");
      if (invite.usedBy) throw new Error("이미 사용된 초대코드는 삭제할 수 없습니다");

      await db.delete(restaurantInvites).where(eq(restaurantInvites.id, input.id));
      return { ok: true };
    }),
});
