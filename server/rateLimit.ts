import type { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * 간단한 인메모리 Rate Limiter.
 * @param windowMs  윈도우 크기 (밀리초)
 * @param maxRequests  윈도우 내 최대 요청 수
 */
export function rateLimit(windowMs: number, maxRequests: number) {
  const store = new Map<string, RateLimitEntry>();

  // 5분마다 만료된 엔트리 정리
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }, 5 * 60 * 1000);

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count++;
    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({
        ok: false,
        message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
      });
    }

    next();
  };
}

/** 로그인: 15분에 20회 */
export const loginLimiter = rateLimit(15 * 60 * 1000, 20);

/** OCR: 1분에 10회 */
export const ocrLimiter = rateLimit(60 * 1000, 10);

/** 에러 리포트: 1분에 30회 */
export const errorReportLimiter = rateLimit(60 * 1000, 30);
