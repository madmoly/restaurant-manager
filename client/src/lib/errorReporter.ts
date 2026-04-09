/**
 * 글로벌 에러 수집기 (클라이언트)
 * - window.onerror (일반 JS 에러)
 * - window.onunhandledrejection (Promise 에러)
 * - React Error Boundary 연동
 * - tRPC 에러 수동 보고 (reportApiError)
 *
 * 전송 경로: REST POST /api/error-report (tRPC 의존 없음 — 앱 크래시 중에도 동작)
 *
 * 보호 장치:
 * - PII 마스킹 (email/phone/주민번호/token/password 키)
 * - fingerprint 기반 로컬 dedupe (5분, localStorage)
 * - 루프 가드 (reporter 내부에서 throw 나도 재귀 금지)
 * - flush 실패 시 무시 (무한 재시도 방지)
 */

type ErrorEntry = {
  errorType: "client" | "api" | "render" | "network";
  message: string;
  stack?: string;
  url?: string;
  metadata?: Record<string, any>;
};

const QUEUE: ErrorEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_QUEUE = 20;
const FLUSH_DELAY = 2000;
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const DEDUPE_KEY = "__err_dedupe_v2";

// 루프 가드: reporter 내부에서 새 에러가 나면 수집 중단
let INSIDE_REPORTER = false;

// ─── PII 마스킹 ──────────────────────────────────────────────────────────────
function maskPii(s: string | undefined): string | undefined {
  if (!s) return s;
  return s
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>")
    .replace(/\b01[016789]-?\d{3,4}-?\d{4}\b/g, "<phone>")
    .replace(/\b\d{6}-?[1-4]\d{6}\b/g, "<rrn>")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <token>")
    .replace(/"password"\s*:\s*"[^"]*"/g, '"password":"<masked>"')
    .replace(/"passwordHash"\s*:\s*"[^"]*"/g, '"passwordHash":"<masked>"');
}

function maskMetadata(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  try {
    const json = JSON.stringify(obj);
    const masked = maskPii(json);
    return masked ? JSON.parse(masked) : obj;
  } catch {
    return obj;
  }
}

// ─── Fingerprint (클라 dedupe용) ─────────────────────────────────────────────
function fingerprintKey(e: ErrorEntry): string {
  const msg = (e.message || "").slice(0, 120)
    .replace(/\d+/g, "#").replace(/\s+/g, " ").toLowerCase();
  const frame = (e.stack || "").split("\n")[1]?.slice(0, 80) || "";
  return `${e.errorType}|${msg}|${frame}`;
}

function shouldSkipDedupe(key: string): boolean {
  try {
    const raw = localStorage.getItem(DEDUPE_KEY);
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    // 만료 청소
    for (const k of Object.keys(map)) {
      if (now - map[k] > DEDUPE_WINDOW_MS) delete map[k];
    }
    if (map[key] && now - map[key] < DEDUPE_WINDOW_MS) {
      return true;
    }
    map[key] = now;
    localStorage.setItem(DEDUPE_KEY, JSON.stringify(map));
    return false;
  } catch {
    return false; // localStorage 실패 시 dedupe 포기
  }
}

// ─── 큐 관리 ─────────────────────────────────────────────────────────────────
function enqueue(entry: ErrorEntry) {
  if (INSIDE_REPORTER) return; // 루프 가드
  INSIDE_REPORTER = true;
  try {
    const sanitized: ErrorEntry = {
      errorType: entry.errorType,
      message: maskPii(entry.message) || "unknown",
      stack: maskPii(entry.stack),
      url: entry.url,
      metadata: maskMetadata(entry.metadata),
    };
    const key = fingerprintKey(sanitized);
    if (shouldSkipDedupe(key)) return;

    if (QUEUE.length >= MAX_QUEUE) return;
    QUEUE.push(sanitized);

    if (!flushTimer) {
      flushTimer = setTimeout(flush, FLUSH_DELAY);
    }
  } catch {
    // 수집 실패는 조용히 무시
  } finally {
    INSIDE_REPORTER = false;
  }
}

async function flush() {
  flushTimer = null;
  if (QUEUE.length === 0) return;
  const batch = QUEUE.splice(0, MAX_QUEUE);
  try {
    await fetch("/api/error-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ errors: batch }),
      credentials: "include",
    });
  } catch {
    // 전송 실패 시 무시 (무한 재시도 방지)
  }
}

// ─── 공개 API ────────────────────────────────────────────────────────────────
/** React Error Boundary에서 호출 */
export function reportRenderError(error: Error, componentStack?: string) {
  enqueue({
    errorType: "render",
    message: error.message,
    stack: error.stack,
    url: window.location.href,
    metadata: { componentStack: componentStack?.slice(0, 1000) },
  });
}

/** tRPC/API 에러 수동 보고 */
export function reportApiError(message: string, metadata?: Record<string, any>) {
  enqueue({
    errorType: "api",
    message,
    url: window.location.href,
    metadata,
  });
}

/** 글로벌 핸들러 등록 — 앱 진입점에서 1회 호출 */
export function initErrorReporter() {
  // JS 런타임 에러
  window.onerror = (message, source, lineno, colno, error) => {
    enqueue({
      errorType: "client",
      message: String(message),
      stack: error?.stack,
      url: window.location.href,
      metadata: { source, lineno, colno },
    });
  };

  // Promise 미처리 거부
  window.onunhandledrejection = (event) => {
    const err = event.reason;
    enqueue({
      errorType: "client",
      message: err?.message || String(err),
      stack: err?.stack,
      url: window.location.href,
      metadata: { type: "unhandledrejection" },
    });
  };
}
