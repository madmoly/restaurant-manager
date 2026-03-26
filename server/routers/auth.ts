import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, publicProcedure, protectedProcedure } from "../trpc";
import { db } from "../db";
import { users } from "../../drizzle/schema";
import { createToken, comparePassword, hashPassword } from "../auth";

export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => ctx.user),

  login: publicProcedure
    .input(z.object({ username: z.string().min(1), password: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const [user] = await db.select().from(users).where(eq(users.username, input.username)).limit(1);
      if (!user || !user.passwordHash) throw new Error("아이디 또는 비밀번호가 올바르지 않습니다");

      const ok = await comparePassword(input.password, user.passwordHash);
      if (!ok) throw new Error("아이디 또는 비밀번호가 올바르지 않습니다");

      await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));

      const token = await createToken({ userId: user.id, username: user.username, role: user.role });
      return {
        token,
        user: { id: user.id, username: user.username, name: user.name, role: user.role },
        mustChangePassword: !!user.mustChangePassword,
      };
    }),

  logout: publicProcedure.mutation(() => ({ ok: true })),

  changePassword: protectedProcedure
    .input(z.object({ currentPassword: z.string(), newPassword: z.string().min(4) }))
    .mutation(async ({ input, ctx }) => {
      const [user] = await db.select().from(users).where(eq(users.id, ctx.user.userId)).limit(1);
      if (!user) throw new Error("사용자를 찾을 수 없습니다");

      const ok = await comparePassword(input.currentPassword, user.passwordHash);
      if (!ok) throw new Error("현재 비밀번호가 올바르지 않습니다");

      const hash = await hashPassword(input.newPassword);
      await db.update(users).set({ passwordHash: hash, mustChangePassword: false }).where(eq(users.id, user.id));
      return { ok: true };
    }),
});
