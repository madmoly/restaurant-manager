/**
 * 글로벌 에러 수집기
 * - window.onerror (일반 JS 에러)
 * - window.onunhandledrejection (Promise 에러)
 * - React Error Boundary 연동
 * 
 * REST /api/error-report 로 직접 전송 (tRPC 의존 없음)
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
const SEEN = new Set<string>(); // 중복 방지
const MAX_QUEUE = 20;
const FLUSH_DELAY = 2000; // 2초 배치

function enqueue(entry: ErrorEntry) {
  // 동일 메시지 중복 방지
  const key = entry.errorType + ":" + entry.message.slice(0, 100);
  if (SEEN.has(key)) return;
  SEEN.add(key);
  // 5분 후 중복 키 삭제 (같은 에러 다시 수집 가능)
  setTimeout(() => SEEN.delete(key), 5 * 60 * 1000);

  if (QUEUE.length >= MAX_QUEUE) return; // 큐 넘침 방지
  QUEUE.push(entry);

  if (!flushTimer) {
    flushTimer = setTimeout(flush, FLUSH_DELAY);
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
    });
  } catch {
    // 전송 실패 시 무시 (무한 재시도 방지)
  }
}

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

  // 네트워크 에러 감지 (fetch 래핑은 하지 않고 tRPC 레벨에서 처리)
}
