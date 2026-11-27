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
  // 10s → 25s: 전체 페이지 촬영(요소 多)은 10s를 넘겨 Vision 폴백으로 빠지는 사례 대응.
  // 예산: Upstage 25s + Vision 폴백 ~30s < 클라 OCR_ANALYZE_TIMEOUT_MS(70s).
  const timeoutMs = opts.timeoutMs ?? 25_000;

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

// ────────────────────────────────────────────────────────────────────────────
// 표 정규화 (헤더 열 기준 재정렬 + 빈 행 제거 + 하단 합계영역 분리)
// ────────────────────────────────────────────────────────────────────────────
//
// 배경: 전표를 "전체 페이지"로 찍으면 하단 합계/미수금/인계자/공지 영역이 품목 표와
// 같은 격자로 인식된다. 하단 영역의 칸 경계(①직전미수금 | ①+②합계 | ② | …)는
// 품목 열 경계(품목 | 단위 | 수량 | 단가 | …)와 어긋나므로, Upstage는 두 경계의
// 합집합으로 격자를 만들고 품목 행에 colspan을 붙인다. 이 상태에서 모델이 <td>
// 순서로 열을 세면 열이 밀린다. 표의 위쪽만 찍으면 하단 영역이 없어 격자가 깨끗하다.
// → 헤더 셀의 격자 범위를 기준으로 각 셀을 헤더 열에 재배정해 colspan 영향을 제거한다.

interface RawCell { text: string; colspan: number; rowspan: number }
interface PlacedCell { text: string; start: number; end: number } // [start, end) 격자 열

const HEADER_KW_RE = /(품\s*목|품\s*명|규\s*격|단\s*위|수\s*량|단\s*가|공\s*급\s*가\s*액|금\s*액|부\s*가\s*세|세\s*액|비\s*고)/g;
// 하단 영역 시작 신호(강) — 채권축·서명·공지. 이후 행은 전부 하단 영역.
const FOOTER_START_RE = /(미\s*수\s*금|전\s*월\s*이\s*월|잔\s*액|누\s*계|인\s*계\s*자|인\s*수\s*자|공\s*지\s*사\s*항|수\s*금\s*액|[①②③])/;
// 합계행 신호(약) — 해당 행만 하단 영역으로. 일자별 소계 뒤에 품목이 이어지는 양식 보호.
const SUBTOTAL_ROW_RE = /^(합\s*계|소\s*계|총\s*계|공\s*급\s*가\s*액\s*계|세\s*액\s*계)/;

function decodeCellText(inner: string): string {
  return inner
    .replace(/<br\s*\/?>/gi, "<br>")
    .replace(/<(?!br>)[^>]+>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t\r\n]+/g, " ")
    .replace(/^(\s|<br>)+|(\s|<br>)+$/g, "")
    .trim();
}

function parseRows(html: string): RawCell[][] {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  return rows.map((row) => {
    const cells: RawCell[] = [];
    const re = /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(row))) {
      const attrs = m[2] ?? "";
      const cs = parseInt(/colspan\s*=\s*['"]?(\d+)/i.exec(attrs)?.[1] ?? "1", 10);
      const rs = parseInt(/rowspan\s*=\s*['"]?(\d+)/i.exec(attrs)?.[1] ?? "1", 10);
      cells.push({ text: decodeCellText(m[3] ?? ""), colspan: Math.max(1, cs || 1), rowspan: Math.max(1, rs || 1) });
    }
    return cells;
  });
}

/** colspan/rowspan을 격자 좌표로 전개. rowspan으로 이어지는 아래 행에는 텍스트를 복제하지 않는다
 *  (값이 두 번 세지는 것 방지) — 자리만 점유. */
function placeCells(rows: RawCell[][]): PlacedCell[][] {
  const occupied: Array<Set<number>> = rows.map(() => new Set<number>());
  return rows.map((cells, r) => {
    const placed: PlacedCell[] = [];
    let col = 0;
    for (const cell of cells) {
      while (occupied[r].has(col)) col++;
      const start = col;
      const end = col + cell.colspan;
      for (let rr = r; rr < Math.min(rows.length, r + cell.rowspan); rr++) {
        for (let c = start; c < end; c++) occupied[rr].add(c);
      }
      placed.push({ text: cell.text, start, end });
      col = end;
    }
    return placed;
  });
}

function overlap(a: { start: number; end: number }, b: { start: number; end: number }): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

export interface NormalizedTable {
  kind: "items" | "other";
  /** 품목 표 정규화 결과 (kind=items) */
  html?: string;
  headerLabels?: string[];
  bodyRowCount?: number;
  droppedEmptyRows?: number;
  hadSpans?: boolean;
  /** 헤더 위쪽 행 / 하단 영역 행 / 기타 표 — 텍스트 줄 */
  preLines: string[];
  footerLines: string[];
}

/** 품목 표면 헤더 열 기준으로 재정렬, 아니면 행 텍스트만 반환. 순수 함수. */
export function normalizeTableHtml(html: string): NormalizedTable {
  const raw = parseRows(html);
  const placed = placeCells(raw);
  const rowLine = (cells: PlacedCell[]) => cells.map((c) => c.text.replace(/<br>/g, " ")).filter(Boolean).join(" | ");

  // 헤더 행: 헤더 키워드가 서로 다른 셀 3개 이상
  const headerIdx = placed.findIndex((cells) => {
    const hits = cells.filter((c) => { HEADER_KW_RE.lastIndex = 0; return HEADER_KW_RE.test(c.text); }).length;
    return hits >= 3;
  });
  if (headerIdx < 0) {
    return { kind: "other", preLines: placed.map(rowLine).filter(Boolean), footerLines: [] };
  }

  const header = placed[headerIdx].filter((c) => c.text);
  const hadSpans = raw.some((cells) => cells.some((c) => c.colspan > 1 || c.rowspan > 1));

  const preLines = placed.slice(0, headerIdx).map(rowLine).filter(Boolean);
  const footerLines: string[] = [];
  const bodyRows: string[][] = [];
  let dropped = 0;
  let inFooter = false;

  for (const cells of placed.slice(headerIdx + 1)) {
    const line = rowLine(cells);
    if (!line) { dropped++; continue; }
    if (!inFooter && FOOTER_START_RE.test(line)) inFooter = true;
    if (inFooter || SUBTOTAL_ROW_RE.test(line)) { footerLines.push(line); continue; }

    // 각 셀 → 겹침이 가장 큰 헤더 열 (동률이면 왼쪽)
    const out: string[][] = header.map(() => []);
    for (const c of cells) {
      if (!c.text) continue;
      let best = -1, bestOv = 0;
      header.forEach((h, i) => {
        const ov = overlap(c, h);
        if (ov > bestOv) { best = i; bestOv = ov; }
      });
      if (best < 0) {
        // 헤더가 덮지 않는 격자 열 → 가장 가까운 헤더 열
        let bestDist = Infinity;
        header.forEach((h, i) => {
          const d = c.start >= h.end ? c.start - h.end + 1 : h.start - c.end + 1;
          if (d < bestDist) { bestDist = d; best = i; }
        });
      }
      out[best].push(c.text);
    }
    bodyRows.push(out.map((parts) => parts.join(" ")));
  }

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/&lt;br&gt;/g, "<br>");
  const headerLabels = header.map((h) => h.text.replace(/<br>/g, " "));
  const htmlOut = [
    "<table>",
    `<tr>${headerLabels.map((t) => `<th>${esc(t)}</th>`).join("")}</tr>`,
    ...bodyRows.map((r) => `<tr>${r.map((t) => `<td>${esc(t)}</td>`).join("")}</tr>`),
    "</table>",
  ].join("\n");

  return {
    kind: "items",
    html: htmlOut,
    headerLabels,
    bodyRowCount: bodyRows.length,
    droppedEmptyRows: dropped,
    hadSpans,
    preLines,
    footerLines,
  };
}

/** markdown에서 표 블록(파이프 표·HTML 표)을 제거 — 정규화 표와 중복·충돌 방지 */
function stripTablesFromMarkdown(md: string): string {
  return md
    .replace(/<table[\s\S]*?<\/table>/gi, "")
    .split("\n")
    .filter((l) => !/^\s*\|.*\|\s*$/.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Claude 해석 단계에 넣을 텍스트 컨텍스트를 구성.
 * 품목 표는 헤더 열 기준으로 정규화한 HTML을 1차 근거로 제공하고,
 * 하단 합계/미수금 영역은 "품목 아님" 블록으로 분리한다.
 * 품목 표를 못 찾으면 기존처럼 원본 HTML을 그대로 넘긴다.
 */
export function buildClaudeContext(parsed: UpstageParseResult): string {
  const parts: string[] = [];
  const normalized = parsed.tablesHtml.map((html) => ({ html, n: normalizeTableHtml(html) }));
  const hasItems = normalized.some((t) => t.n.kind === "items");

  if (hasItems) {
    const otherLines: string[] = [];
    const footerLines: string[] = [];
    let itemIdx = 0;
    parts.push("## 품목 표 (헤더 열 기준으로 정규화됨 — 행/열 판정의 1차 근거. 각 <td>는 위 <th> 열에 1:1 대응. 빈 행 제거됨)");
    for (const { n } of normalized) {
      if (n.kind === "items") {
        itemIdx++;
        parts.push(`### 품목 표 ${itemIdx} (본문 ${n.bodyRowCount}행)\n${n.html}`);
        footerLines.push(...n.footerLines);
        otherLines.push(...n.preLines);
      } else {
        // 헤더 없는 표가 품목 표 뒤에 있으면 대개 하단 합계 영역
        (itemIdx > 0 ? footerLines : otherLines).push(...n.preLines);
      }
    }
    if (otherLines.length > 0) {
      parts.push("\n## 기타 표 텍스트 (공급자/공급받는자 등 — 품목 아님)");
      parts.push(otherLines.map((l) => `- ${l}`).join("\n"));
    }
    if (footerLines.length > 0) {
      parts.push("\n## 하단 합계/미수금/서명/공지 영역 (품목 아님 — summary 판정에만 사용, '합계행 읽기' 규칙 적용)");
      parts.push(footerLines.map((l) => `- ${l}`).join("\n"));
    }
    const mdRest = stripTablesFromMarkdown(parsed.markdown);
    if (mdRest) {
      parts.push("\n## 문서 표 외 텍스트 (Upstage markdown에서 표 제거 — 거래처명/날짜 확인용)");
      parts.push(mdRest);
    }
  } else {
    // 표 HTML을 먼저 배치 — 행/열 경계 판정의 1차 근거. markdown은 보조 문맥.
    if (parsed.tablesHtml.length > 0) {
      parts.push("## 표 원본 HTML (셀 경계 기준 — 행/열 판정은 반드시 이 HTML을 우선)");
      parsed.tablesHtml.forEach((html, i) => {
        parts.push(`### Table ${i + 1}\n${html}`);
      });
    }
    parts.push("\n## 문서 전체 (Upstage markdown — 보조 문맥용. 행 경계 판정에는 사용 금지)");
    parts.push(parsed.markdown);
  }

  if (parsed.paragraphs.length > 0) {
    parts.push("\n## 비표 텍스트 블록 (낙서/메모 가능성 있음 — 품목으로 오인 금지)");
    parsed.paragraphs.forEach((p, i) => parts.push(`- [P${i}] ${p}`));
  }

  return parts.join("\n\n");
}
