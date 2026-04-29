import { initTRPC, TRPCError } from "@trpc/server";
import type { Request } from "express";
import { parse as parseCookie } from "cookie";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { verifyToken, type TokenPayload } from "./auth";
import { ROLE_LEVEL } from "@shared/permissions";
import { db } from "./db";
import { restaurantUsers } from "../drizzle/schema";
import { verifyStoreAccess, requireStoreManager } from "./middleware/storeAuth";

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

/**
 * ─── 매장 단위 격리 procedure (PR1 도입 — 2026-04-09) ────────────────────────
 *
 * 매장 자원 라우터의 cross-store 누수 방지를 위한 표준 게이트.
 * 하위 라우터는 본인 input 스키마를 추가로 `.input()`으로 merge 하면 됨
 * (v11에서 .input() 연쇄는 자동 머지).
 *
 * 사용 예:
 *   listOrdersByMonth: storeReadProcedure
 *     .input(z.object({ year: z.number(), month: z.number() }))
 *     .query(async ({ input, ctx }) => {
 *       // input: { restaurantId, year, month }
 *       // ctx.restaurantId / ctx.storeRole 사용 가능
 *     });
 *
 * 가드 체인:
 *   - storeReadProcedure   = 로그인 + restaurantId 접근 가능 (read)
 *   - storeWriteProcedure  = 로그인 + restaurantId 쓰기 가능 (admin은 본인 매장 배정 필요)
 *   - storeManagerProcedure = 위 + 매장 역할 owner/supervisor/store_manager/manager
 *
 * 모든 미들웨어가 ctx에 { restaurantId, storeRole } 주입.
 */

const storeBaseInput = z.object({ restaurantId: z.number() });

export const storeReadProcedure = protectedProcedure
  .input(storeBaseInput)
  .use(async ({ ctx, input, next }) => {
    const { storeRole } = await verifyStoreAccess(
      ctx.user.userId,
      ctx.user.role,
      input.restaurantId,
      false,
    );
    return next({
      ctx: { ...ctx, restaurantId: input.restaurantId, storeRole },
    });
  });

export const storeWriteProcedure = protectedProcedure
  .input(storeBaseInput)
  .use(async ({ ctx, input, next }) => {
    const { storeRole } = await verifyStoreAccess(
      ctx.user.userId,
      ctx.user.role,
      input.restaurantId,
      true,
    );
    return next({
      ctx: { ...ctx, restaurantId: input.restaurantId, storeRole },
    });
  });

export const storeManagerProcedure = protectedProcedure
  .input(storeBaseInput)
  .use(async ({ ctx, input, next }) => {
    const { storeRole } = await requireStoreManager(
      ctx.user.userId,
      ctx.user.role,
      input.restaurantId,
    );
    return next({
      ctx: { ...ctx, restaurantId: input.restaurantId, storeRole },
    });
  });

/**
 * 매장 owner(점장) 전용 + 매장 격리.
 * master/admin은 시스템 권한으로 통과(admin은 매장 배정 시 쓰기 가능 — verifyStoreAccess 정책 따름).
 * supervisor(매니져)는 거부. POS 설정/디바이스 등록 등 점장 전용 영역에 사용.
 */
export const storeOwnerProcedure = protectedProcedure
  .input(storeBaseInput)
  .use(async ({ ctx, input, next }) => {
    const { storeRole } = await verifyStoreAccess(
      ctx.user.userId,
      ctx.user.role,
      input.restaurantId,
      true,
    );
    const level = ROLE_LEVEL[ctx.user.role] ?? 0;
    if (level < ROLE_LEVEL.admin) {
      // user 레벨은 매장 owner만 통과 (레거시 store_manager 호환)
      if (storeRole !== "owner" && storeRole !== "store_manager") {
        throw new TRPCError({ code: "FORBIDDEN", message: "점장 권한이 필요합니다" });
      }
    }
    return next({
      ctx: { ...ctx, restaurantId: input.restaurantId, storeRole },
    });
  });
