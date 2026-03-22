import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure, adminProcedure } from "../trpc";
import { db } from "../db";
import { users } from "../../drizzle/schema";
import { hashPassword } from "../auth";

export const usersRouter = router({
  list: adminProcedure.query(() =>
    db.select({
      id: users.id, username: users.username, name: users.name,
      email: users.email, phone: users.phone, role: users.role,
      isActive: users.isActive, createdAt: users.createdAt,
    }).from(users)
  ),

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
      role: z.enum(["admin", "user"]).default("user"),
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
});
