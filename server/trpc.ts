import { initTRPC, TRPCError } from "@trpc/server";
import type { Request } from "express";
import { parse as parseCookie } from "cookie";
import { eq } from "drizzle-orm";
import { verifyToken, type TokenPayload } from "./auth";
import { ROLE_LEVEL } from "@shared/permissions";
import { db } from "./db";
import { restaurantUsers } from "../drizzle/schema";

export type Context = {
  user: TokenPayload | null;
};

export async function createContext(opts: { req: Request }): Promise<Context> {
  const cookies = parseCookie(opts.req.headers.cookie || "");
  const token = cookies["session"];
  if (!token) return { user: null };
  const payload = await verifyToken(token);
  return { user: payload };
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/** 로그인 필요 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "로그인이 필요합니다" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * manager 이상 (master/admin/manager + 매장 store_manager/manager)
 *
 * 시스템 역할이 manager 미만이더라도, restaurant_users 테이블에서
 * store_manager 또는 manager 역할을 보유하고 있으면 통과시킨다.
 */
export const managerProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const level = ROLE_LEVEL[ctx.user.role] ?? 0;
  if (level >= ROLE_LEVEL.manager) {
    return next({ ctx });
  }
  // 시스템 역할이 부족하면 매장 역할 확인
  const storeRoles = await db
    .select({ role: restaurantUsers.role })
    .from(restaurantUsers)
    .where(eq(restaurantUsers.userId, ctx.user.userId));
  const isStoreManager = storeRoles.some(
    (r) => r.role === "store_manager" || r.role === "manager"
  );
  if (!isStoreManager) {
    throw new TRPCError({ code: "FORBIDDEN", message: "매니저 이상 권한이 필요합니다" });
  }
  return next({ ctx });
});

/** admin 이상 (master/admin) */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  const level = ROLE_LEVEL[ctx.user.role] ?? 0;
  if (level < ROLE_LEVEL.admin) {
    throw new TRPCError({ code: "FORBIDDEN", message: "관리자 권한이 필요합니다" });
  }
  return next({ ctx });
});
