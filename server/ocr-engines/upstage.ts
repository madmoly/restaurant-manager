/**
 * Upstage Document Parse 어댑터
 *
 * 용도: Upstage Document Parse API 호출 → 정규화된 구조화 텍스트 반환
 * 연결 지점: hybrid.ts의 runHybridOcr에서 호출.
 *
 * 환경변수: UPSTAGE_API_KEY
 * 공식 문서: https://console.upstage.ai/api/document-digitization/document-parse
 */

import fs from "fs";
import path from "path";

// ────────────────────────────────────────────────────────────────────────────
// 타입
// ────────────────────────────────────────────────────────────────────────────

export type UpstageCategory =
  | "paragraph"
  | "table"
  | "figure"
  | "heading1"
  | "list"
  | "footer"
  | "header";

export interface UpstageCoordinate {
  x: number; // 0~1 정규화
  y: number;
}

export interface UpstageElement {
  id: number;
  category: UpstageCategory;
  content: {
    text?: string;
    html?: string;
    markdown?: string;
  };
  coordinates?: UpstageCoordinate[];
  page?: number;
}

export interface UpstageResponse {
  api: string;
  model: string;
  usage: { pages: number; standard?: number[] };
  content: {
    text?: string;
    html?: string;
    markdown?: string;
  };
  elements: UpstageElement[];
  ocr?: Record<string, unknown>;
}

export interface UpstageParseResult {
  ok: true;
  raw: UpstageResponse;
  markdown: string;                  // 전체 문서 markdown (Claude 입력용 메인)
  tablesHtml: string[];              // 표 단위 HTML (구조 보존)
  paragraphs: string[];              // 낙서/메모/본문 paragraph
  pages: number;
  elapsedMs: number;
}

export interface UpstageParseError {
  ok: false;
  status: number;
  error: string;
  elapsedMs: number;
}

// ────────────────────────────────────────────────────────────────────────────
// 공개 함수
// ────────────────────────────────────────────────────────────────────────────

/**
 * Upstage Document Parse 호출
 *
 * @param filePath 로컬 이미지/PDF 절대경로
 * @param opts 옵션
 * @returns 파싱된 결과 or 에러
 */
export async function extractWithUpstage(
  filePath: string,
  opts: { ocrMode?: "auto" | "force"; timeoutMs?: number } = {}
): Promise<UpstageParseResult | UpstageParseError> {
  const apiKey = process.env.UPSTAGE_API_KEY;
  const started = Date.now();

  if (!apiKey) {
    return { ok: false, status: 0, error: "UPSTAGE_API_KEY 미설정", elapsedMs: 0 };
  }
  if (!fs.existsSync(filePath)) {
    return { ok: false, status: 0, error: `파일 없음: ${filePath}`, elapsedMs: 0 };
  }

  const ocrMode = opts.ocrMode ?? "auto"; // auto가 비용 효율 (인쇄 텍스트는 OCR 스킵)
  const timeoutMs = opts.timeoutMs ?? 10_000;

  // FormData 구성 (재시도 시에도 재사용 — Blob은 불변이라 재전송 안전)
  const form = new FormData();
  const fileBuf = fs.readFileSync(filePath);
  const blob = new Blob([fileBuf]);
  form.append("document", blob, path.basename(filePath));
  form.append("model", "document-parse");
  form.append("output_formats", JSON.stringify(["markdown", "html", "text"]));
  form.append("ocr", ocrMode);
  form.append("coordinates", "true");
  form.append("base64_encoding", "[]"); // 이미지 base64 반환 안 받음 (페이로드 축소)

  const maxAttempts = 2; // 1차 + 429 전용 재시도 1회

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch("https://api.upstage.ai/v1/document-digitization", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });

      const elapsedMs = Date.now() - started;

      if (res.status === 429) {
        if (attempt < maxAttempts) {
          const retryAfterHeader = res.headers.get("Retry-After");
          const retryAfterSec = retryAfterHeader ? parseFloat(retryAfterHeader) : NaN;
          const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec >= 0 ? retryAfterSec * 1000 : 2000;
          console.log(`[upstage] 429 rate limited — ${waitMs}ms 대기 후 재시도 (${attempt}/${maxAttempts})`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        const errText = await res.text().catch(() => "");
        return { ok: false, status: 429, error: errText || res.statusText, elapsedMs };
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return { ok: false, status: res.status, error: errText || res.statusText, elapsedMs };
      }

      const raw = (await res.json()) as UpstageResponse;

      const markdown =
        raw.content?.markdown ??
        raw.content?.text ??
        raw.elements
          .map((e) => e.content?.markdown ?? e.content?.text ?? "")
          .filter(Boolean)
          .join("\n\n");

      const tablesHtml = raw.elements
        .filter((e) => e.category === "table")
        .map((e) => e.content?.html ?? "")
        .filter(Boolean);

      const paragraphs = raw.elements
        .filter((e) => e.category === "paragraph")
        .map((e) => e.content?.text ?? "")
        .filter(Boolean);

      return {
        ok: true,
        raw,
        markdown,
        tablesHtml,
        paragraphs,
        pages: raw.usage?.pages ?? 1,
        elapsedMs,
      };
    } catch (err: any) {
      const elapsedMs = Date.now() - started;
      return {
        ok: false,
        status: 0,
        error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err),
        elapsedMs,
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  // 도달 불가 (루프는 항상 return/continue로 종료) — TS 타입 충족용
  return { ok: false, status: 429, error: "rate_limited_exhausted", elapsedMs: Date.now() - started };
}

// ────────────────────────────────────────────────────────────────────────────
// Claude 입력용 구성 함수
// ────────────────────────────────────────────────────────────────────────────

/**
 * Claude 해석 단계에 넣을 텍스트 컨텍스트를 구성.
 * markdown은 전체 맥락, tablesHtml은 셀 경계 정확도 보강용으로 함께 제공.
 */
export function buildClaudeContext(parsed: UpstageParseResult): string {
  const parts: string[] = [];

  // 표 HTML을 먼저 배치 — 행/열 경계 판정의 1차 근거. markdown은 보조 문맥.
  if (parsed.tablesHtml.length > 0) {
    parts.push("## 표 원본 HTML (셀 경계 기준 — 행/열 판정은 반드시 이 HTML을 우선)");
    parsed.tablesHtml.forEach((html, i) => {
      parts.push(`### Table ${i + 1}\n${html}`);
    });
  }

  parts.push("\n## 문서 전체 (Upstage markdown — 보조 문맥용. 행 경계 판정에는 사용 금지)");
  parts.push(parsed.markdown);

  if (parsed.paragraphs.length > 0) {
    parts.push("\n## 비표 텍스트 블록 (낙서/메모 가능성 있음 — 품목으로 오인 금지)");
    parsed.paragraphs.forEach((p, i) => parts.push(`- [P${i}] ${p}`));
  }

  return parts.join("\n\n");
}
