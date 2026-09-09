import type { NextFunction, Request, Response } from "express";
import { parse as parseCookie } from "cookie";
import { verifyToken, type TokenPayload } from "../auth";
import { verifyStoreAccess } from "./storeAuth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/** 쿠키 세션에서 사용자 payload 추출 (실패 시 null) */
export async function readSession(req: Request): Promise<TokenPayload | null> {
  try {
    const cookies = parseCookie(req.headers.cookie || "");
    const token = cookies["session"];
    if (!token) return null;
    return (await verifyToken(token)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Express 라우트 인증 게이트.
 * tRPC 밖의 REST 엔드포인트(/api/upload, /api/ocr, /uploads)에 적용.
 * 성공 시 req.user 주입, 실패 시 401 JSON.
 */
export async function requireSession(req: Request, res: Response, next: NextFunction) {
  const payload = await readSession(req);
  if (!payload) {
    res.status(401).json({ error: "로그인이 필요합니다" });
    return;
  }
  req.user = payload;
  next();
}

/** master 전용 게이트 (requireSession 뒤에 배치) */
export function requireMaster(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "master") {
    res.status(403).json({ error: "개발자 권한이 필요합니다" });
    return;
  }
  next();
}

/**
 * REST 엔드포인트용 매장 스코프 게이트 (requireSession 뒤에 배치).
 * body 또는 query에서 restaurantId를 읽어 verifyStoreAccess 수행.
 * multipart 요청은 multer가 body를 채운 뒤에 실행되어야 하므로
 * `upload.single(...)` **뒤에** 배치할 것.
 *
 * masterBypass=true면 master가 restaurantId 없이 전체 조회하는 것을 허용
 * (시스템 관리 화면 전용).
 */
export function requireStore(requireWrite: boolean, masterBypass = false) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const raw = (req.body as Record<string, unknown> | undefined)?.restaurantId
      ?? (req.query as Record<string, unknown> | undefined)?.restaurantId;
    const restaurantId = Number(raw);
    if (!raw || !Number.isFinite(restaurantId) || restaurantId <= 0) {
      if (masterBypass && req.user?.role === "master") { next(); return; }
      res.status(400).json({ error: "restaurantId가 필요합니다" });
      return;
    }
    try {
      await verifyStoreAccess(req.user!.userId, req.user!.role, restaurantId, requireWrite);
    } catch (err: any) {
      const code = err?.code === "NOT_FOUND" ? 404 : 403;
      res.status(code).json({ error: err?.message ?? "매장 접근 권한이 없습니다" });
      return;
    }
    next();
  };
}
