/**
 * OCR Hybrid Orchestrator
 *
 * 용도: Upstage → Claude 2단계 파이프라인 오케스트레이션 + 엔진 토글 + fallback
 * 연결 지점: server/ocr.ts의 `/extract-purchase` 엔드포인트에서 호출.
 *
 * 환경변수:
 *   OCR_ENGINE=upstage | claude_vision (기본: upstage)
 *   UPSTAGE_API_KEY
 *   ANTHROPIC_API_KEY
 */

import type Anthropic from "@anthropic-ai/sdk";
import {
  extractWithUpstage,
  buildClaudeContext,
  type UpstageParseResult,
  type UpstageParseError,
} from "./upstage";
import { OCR_MODELS } from "./models";

// ────────────────────────────────────────────────────────────────────────────
// 타입
// ────────────────────────────────────────────────────────────────────────────

export type OcrEngine = "upstage" | "claude_vision";

// 텍스트 stage(Upstage 결과 구조화)는 Haiku로 충분 — 속도 2~3배.
// Vision stage(이미지 직접 판독, 폴백 전용)는 정확도 위해 Sonnet 유지.
const TEXT_STAGE_MODEL = OCR_MODELS.text;
const VISION_STAGE_MODEL = OCR_MODELS.vision;
// 매입전표는 항목 30~50줄 내외가 통상 — 8192면 충분 (정산표처럼 100줄+ 케이스는 별도 엔드포인트)
const STAGE_MAX_TOKENS = 8192;

export interface HybridOcrInput {
  filePath: string;
  restaurantId?: number;
  counterpartyId?: number | null;
  engineOverride?: OcrEngine;
}

export interface HybridDeps {
  anthropic: Anthropic;
  buildProfileHint: (profile: any) => string;
  getOcrProfile: (counterpartyId: number | null) => Promise<any>;
  promptV2Template: (upstageContext: string, profileHint: string, correctionNote?: string) => string;
  promptV1ImageFallback: (profileHint: string) => string;
  loadImageBase64Raw: (filePath: string) => { base64: string; mediaType: string };
  extractText: (response: Anthropic.Message) => string | null;
  parseAIJson: (text: string) => any | null;
}

export interface HybridOcrOutput {
  engine: OcrEngine;
  upstage?: {
    pages: number;
    elapsedMs: number;
    usedOcrMode: "auto" | "force";
  };
  claude: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    elapsedMs: number;
  };
  rawJson: any;             // Claude가 뱉은 파싱된 JSON (정규화 전)
  totalElapsedMs: number;
  /** Upstage 경로일 때 파싱 결과 원본 — 재분석 캐시용 (Vision 경로엔 없음) */
  upstageParsed?: UpstageParseResult;
}

// ────────────────────────────────────────────────────────────────────────────
// 엔진 선택
// ────────────────────────────────────────────────────────────────────────────

export function resolveEngine(override?: OcrEngine): OcrEngine {
  if (override) return override;
  const env = (process.env.OCR_ENGINE ?? "").toLowerCase();
  if (env === "claude_vision") return "claude_vision";
  return "upstage"; // 기본값
}

// ────────────────────────────────────────────────────────────────────────────
// 메인 파이프라인
// ────────────────────────────────────────────────────────────────────────────

/**
 * Upstage 경로:
 *   1) Upstage Document Parse
 *   2) Claude 텍스트 해석 (prompt v2)
 *   3) Upstage 실패 시 Claude Vision fallback
 */
export async function runHybridOcr(
  input: HybridOcrInput,
  deps: HybridDeps
): Promise<HybridOcrOutput> {
  const started = Date.now();
  const engine = resolveEngine(input.engineOverride);

  const profile = await deps.getOcrProfile(input.counterpartyId ?? null);
  const profileHint = deps.buildProfileHint(profile);

  if (engine === "upstage") {
    const parsed = await runUpstageStage(input.filePath);

    if (parsed.ok === true) {
      return await runClaudeTextStage(parsed, profileHint, deps, { started });
    }

    // Upstage 실패 → Claude Vision fallback
    const failed = parsed; // narrowed: UpstageParseError
    console.warn(
      `[OCR] Upstage 실패 (status=${failed.status}, ${failed.error}). Claude Vision fallback.`
    );
  }

  // Claude Vision 경로 (기본 fallback 또는 명시적 override)
  return await runClaudeVisionStage(input, profileHint, deps, started);
}

// ────────────────────────────────────────────────────────────────────────────
// Upstage 단계 (분리 export — 재분석 시 캐시된 결과로 이 단계를 건너뛰기 위함)
// ────────────────────────────────────────────────────────────────────────────

export async function runUpstageStage(
  filePath: string
): Promise<UpstageParseResult | UpstageParseError> {
  return extractWithUpstage(filePath, { ocrMode: "auto" });
}

// ────────────────────────────────────────────────────────────────────────────
// Claude 텍스트 해석 (Upstage 성공 경로)
// ────────────────────────────────────────────────────────────────────────────

export async function runClaudeTextStage(
  parsed: UpstageParseResult,
  profileHint: string,
  deps: HybridDeps,
  opts?: { correctionNote?: string; started?: number }
): Promise<HybridOcrOutput> {
  const started = opts?.started ?? Date.now();
  const context = buildClaudeContext(parsed);
  const prompt = deps.promptV2Template(context, profileHint, opts?.correctionNote);

  const claudeStarted = Date.now();
  const stream = deps.anthropic.messages.stream({
    model: TEXT_STAGE_MODEL,
    max_tokens: STAGE_MAX_TOKENS,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
  });
  const response = await stream.finalMessage();

  const claudeElapsed = Date.now() - claudeStarted;
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  console.log(`[OCR] stop_reason=${response.stop_reason}, output_tokens=${outputTokens}`);

  const text = deps.extractText(response) ?? "";
  let rawJson: any = null;
  try {
    rawJson = deps.parseAIJson(text);
  } catch (err: any) {
    console.warn(`[OCR] parseAIJson 실패 (text stage): ${err?.message ?? err}`);
  }

  return {
    engine: "upstage",
    upstage: {
      pages: parsed.pages,
      elapsedMs: parsed.elapsedMs,
      usedOcrMode: "auto",
    },
    claude: {
      model: TEXT_STAGE_MODEL,
      inputTokens,
      outputTokens,
      elapsedMs: claudeElapsed,
    },
    rawJson,
    totalElapsedMs: Date.now() - started,
    upstageParsed: parsed,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Claude Vision 레거시 경로 (fallback 또는 override)
// ────────────────────────────────────────────────────────────────────────────

async function runClaudeVisionStage(
  input: HybridOcrInput,
  profileHint: string,
  deps: Parameters<typeof runHybridOcr>[1],
  started: number
): Promise<HybridOcrOutput> {
  const { base64, mediaType } = deps.loadImageBase64Raw(input.filePath);
  const prompt = deps.promptV1ImageFallback(profileHint);

  const claudeStarted = Date.now();
  const stream = deps.anthropic.messages.stream({
    model: VISION_STAGE_MODEL,
    max_tokens: STAGE_MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
              data: base64,
            },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });
  const response = await stream.finalMessage();

  const claudeElapsed = Date.now() - claudeStarted;
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  console.log(`[OCR] stop_reason=${response.stop_reason}, output_tokens=${outputTokens}`);

  const text = deps.extractText(response) ?? "";
  let rawJson: any = null;
  try {
    rawJson = deps.parseAIJson(text);
  } catch (err: any) {
    console.warn(`[OCR] parseAIJson 실패 (vision stage): ${err?.message ?? err}`);
  }

  return {
    engine: "claude_vision",
    claude: {
      model: VISION_STAGE_MODEL,
      inputTokens,
      outputTokens,
      elapsedMs: claudeElapsed,
    },
    rawJson,
    totalElapsedMs: Date.now() - started,
  };
}
