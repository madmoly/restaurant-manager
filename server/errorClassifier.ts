/**
 * 에러 분류기 (server)
 * - fingerprint: 동일 에러 그룹핑 키 (sha1)
 * - severity: P0 ~ P3
 * - category: auth|db|ocr|trpc|ui|network|permission|unknown
 *
 * 규칙은 보수적으로: 빈도/범위는 DB 집계로 올리고, 여기서는 "본질적 심각도"만.
 * 서버 수신 시 1회 호출, 이후 upsert는 fingerprint 기반.
 */
import crypto from "crypto";

// ─── Fingerprint ─────────────────────────────────────────────────────────────
/** stack의 1~2번째 프레임 + 정규화 메시지로 안정적 키 생성 */
export function computeFingerprint(params: {
  errorType: string;
  message: string;
  stack?: string | null;
}): string {
  const normMsg = normalizeMessage(params.message);
  const topFrame = extractTopFrame(params.stack);
  const raw = `${params.errorType}|${normMsg}|${topFrame}`;
  return crypto.createHash("sha1").update(raw).digest("hex");
}

/** 숫자·UUID·경로·ID 제거해서 메시지를 그룹 가능하게 정규화 */
function normalizeMessage(msg: string): string {
  return (msg || "")
    .slice(0, 500)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b\d{7,}\b/g, "<longnum>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/0x[0-9a-f]+/gi, "<hex>")
    .replace(/"[^"]*"/g, '"<str>"')
    .replace(/'[^']*'/g, "'<str>'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** stack top frame — 파일:라인 수준 */
function extractTopFrame(stack?: string | null): string {
  if (!stack) return "";
  const lines = stack.split("\n").map((l) => l.trim()).filter(Boolean);
  // "at xxx (file.js:123:45)" → "file.js:123"
  for (const line of lines.slice(0, 3)) {
    const m = line.match(/\(([^)]+)\)/) || line.match(/at\s+(\S+)$/);
    if (m) {
      return m[1].replace(/:\d+$/, "").slice(-80);
    }
  }
  return lines[0]?.slice(0, 80) || "";
}

// ─── Category ────────────────────────────────────────────────────────────────
export type Category =
  | "auth" | "db" | "ocr" | "trpc" | "ui" | "network" | "permission" | "unknown";

export function detectCategory(params: {
  errorType: string;
  message: string;
  url?: string | null;
}): Category {
  const m = (params.message || "").toLowerCase();
  const u = (params.url || "").toLowerCase();

  if (/unauthori[sz]ed|jwt|token|session|login|passwordhash/.test(m)) return "auth";
  if (/forbidden|permission|role|verifystoreaccess/.test(m)) return "permission";
  if (/er_|mysql|drizzle|deadlock|connection pool|econnrefused/.test(m)) return "db";
  if (/ocr|claude vision|anthropic|rate.?limit/.test(m) || u.includes("/api/ocr")) return "ocr";
  if (/trpc|procedure|input validation|zod/.test(m) || u.includes("/trpc")) return "trpc";
  if (params.errorType === "network" || /failed to fetch|networkerror|timeout|aborted/.test(m)) return "network";
  if (params.errorType === "render" || /react|hydrat|chunk|lazy|undefined is not a function/.test(m)) return "ui";
  return "unknown";
}

// ─── Severity ────────────────────────────────────────────────────────────────
export type Severity = "P0" | "P1" | "P2" | "P3";

/**
 * 본질적 심각도 판정 — 빈도/범위는 포함 안 함 (DB 집계 후 별도 업그레이드).
 *
 * P0: 결제·매출 입력·로그인 전체 차단 가능
 * P1: 주요 CRUD 실패, 권한 오류, DB 에러
 * P2: 특정 화면/기능 부분 실패, UI 렌더 에러
 * P3: 로그성·과거 데이터·사소한 undefined
 */
export function detectSeverity(params: {
  category: Category;
  message: string;
  url?: string | null;
}): Severity {
  const m = (params.message || "").toLowerCase();
  const u = (params.url || "").toLowerCase();

  // P0: 로그인·매출·결제
  if (params.category === "auth") return "P0";
  if (/\/sales|\/daily-closing|\/monthly-settlement/.test(u) && /failed|error|500/.test(m)) return "P0";

  // P1: DB, 권한, OCR 실패, tRPC mutation 실패
  if (params.category === "db") return "P1";
  if (params.category === "permission") return "P1";
  if (params.category === "ocr") return "P1";
  if (params.category === "trpc" && /mutation|insert|update|delete/.test(m)) return "P1";

  // P2: UI 렌더, 네트워크 간헐
  if (params.category === "ui") return "P2";
  if (params.category === "network") return "P2";

  // P3: 기타
  return "P3";
}

// ─── 임계치 승급 규칙 ────────────────────────────────────────────────────────
/**
 * DB 집계 후 호출: 빈도/범위가 임계치 넘으면 severity를 한 단계 올림.
 * - P3 → P2: 1h 내 50건 이상
 * - P2 → P1: 5m 내 20건 이상 OR 2매장 이상
 * - P1 유지: 1건이라도 즉시 알림 대상
 * - P0 유지: 1건이라도 즉시 알림 대상
 */
export function escalateIfNeeded(base: Severity, agg: {
  count5m: number;
  count1h: number;
  affectedRestaurants: number;
}): Severity {
  if (base === "P3" && agg.count1h >= 50) return "P2";
  if (base === "P2" && (agg.count5m >= 20 || agg.affectedRestaurants >= 2)) return "P1";
  return base;
}

/** 알림 발송 기준: P0/P1은 1건부터, P2는 승급된 경우만 */
export function shouldNotify(sev: Severity, isFirstTime: boolean): boolean {
  if (sev === "P0") return true;
  if (sev === "P1") return true;
  return false;
}
