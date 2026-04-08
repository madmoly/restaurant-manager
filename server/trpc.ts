import { initTRPC, TRPCError } from "@trpc/server";
import type { Request } from "express";
import { parse as parseCookie } from "cookie";
import { and, eq, isNull } from "drizzle-orm";
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
 * manager 이상 (master/admin + 매장 owner/supervisor)
 * 점장·매니져 공통 권한
 *
 * 분기: master(4)/admin(3) → 시스템 레벨로 즉시 통과
 *       user(1) → DB에서 매장 역할 확인 (owner/supervisor면 통과)
 */
export const managerProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const level = ROLE_LEVEL[ctx.user.role] ?? 0;
  if (level >= ROLE_LEVEL.manager) {
    // master(4)/admin(3) >= manager(2) → 시스템 권한으로 즉시 통과
    return next({ ctx });
  }
  // user(1) → 매장 역할로 판단 (퇴사자 제외)
  const storeRoles = await db
    .select({ role: restaurantUsers.role })
    .from(restaurantUsers)
    .where(and(
      eq(restaurantUsers.userId, ctx.user.userId),
      isNull(restaurantUsers.resignedAt),
    ));
  const hasStoreAuth = storeRoles.some(
    (r) => r.role === "owner" || r.role === "supervisor" ||
           r.role === "store_manager" || r.role === "manager" // 레거시 호환
  );
  if (!hasStoreAuth) {
    throw new TRPCError({ code: "FORBIDDEN", message: "점장/매니져 이상 권한이 필요합니다" });
  }
  return next({ ctx });
});

/**
 * owner 이상 (master/admin + 매장 owner만)
 * 점장 전용 권한: 인건비 정산, 근로계약서, 소속회사 변경
 */
export const ownerProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const level = ROLE_LEVEL[ctx.user.role] ?? 0;
  if (level >= ROLE_LEVEL.admin) {
    return next({ ctx });
  }
  const storeRoles = await db
    .select({ role: restaurantUsers.role })
    .from(restaurantUsers)
    .where(and(
      eq(restaurantUsers.userId, ctx.user.userId),
      isNull(restaurantUsers.resignedAt),
    ));
  const isOwner = storeRoles.some(
    (r) => r.role === "owner" || r.role === "store_manager" // 레거시 호환
  );
  if (!isOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "점장 이상 권한이 필요합니다" });
  }
  return next({ ctx });
});

/** admin 이상 (master/admin) */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  const level = ROLE_LEVEL[ctx.user.role] ?? 0;
  if (level < ROLE_LEVEL.admin) {
    throw new TRPCError({ code: "FORBIDDEN", message: "대표 이상 권한이 필요합니다" });
  }
  return next({ ctx });
});

/** master 전용 */
export const masterProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "master") {
    throw new TRPCError({ code: "FORBIDDEN", message: "개발자 권한이 필요합니다" });
  }
  return next({ ctx });
});
