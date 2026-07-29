import { Router, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { execSync } from "child_process";
import { UPLOAD_ROOT } from "./upload";
import { db } from "./db";
import { counterpartyItems, counterparties, counterpartyOcrProfiles, ocrCorrections, errorLogs, apiUsageLogs, purchaseOrdersV2, purchaseOrderItemsV2, items, items as itemsTable, restaurants } from "../drizzle/schema";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { exportDatasetToGDrive, isGDriveConfigured, getLastExportResult } from "./gdrive";
import { runHybridOcr, runUpstageStage, runClaudeTextStage, type HybridDeps } from "./ocr-engines/hybrid";
import type { UpstageParseResult } from "./ocr-engines/upstage";
import { promptV2, promptV1ImageFallback } from "./ocr-engines/prompts";
import { OCR_MODELS } from "./ocr-engines/models";

// ─── OCR 이미지 전처리 해상도 캡 (px) ────────────────────────────────────────
// 클라 OCR_HIGH(imageResize.ts)가 이미 2560px로 리사이즈하므로 3500은 실질적으로
// no-op 캡 — 클라가 더 큰 원본을 보내는 경로(예: 회전 후 재처리)를 위한 안전망.
const OCR_PREPROCESS_MAX_DIM = 3500;

// ─── 정산표 OCR 응답 토큰 한도 ───────────────────────────────────────────────
// 정산표는 100~200항목도 흔함. 8192면 ~40항목에서 truncate됨 → 64K 지원 모델 기준 상향.
const STATEMENT_MAX_TOKENS = 32768;
// 보건증/매출전표는 항목 수가 적어 기본 한도로 충분.
const HEALTH_CERT_MAX_TOKENS = 1024;
const SALES_MAX_TOKENS = 4096;

// OCR 에러를 error_logs 테이블에 저장
async function logOcrError(message: string, metadata?: Record<string, any>, restaurantId?: number) {
  try {
    await db.insert(errorLogs).values({
      errorType: "ocr",
      message,
      metadata: metadata || null,
      restaurantId: restaurantId || null,
    });
  } catch (e) {
    console.error("[OCR] 에러 로그 저장 실패:", e);
  }
}

// OCR API 호출을 api_usage_logs에 기록
async function logOcrApiUsage(opts: {
  endpoint: string;
  userId?: number;
  restaurantId?: number;
  requestPayloadSize?: number;
  responseTimeMs: number;
  success: boolean;
  errorMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  itemCount?: number;
  timingBreakdown?: string;
}) {
  try {
    await db.insert(apiUsageLogs).values({
      apiType: "ocr",
      endpoint: opts.endpoint,
      userId: opts.userId || null,
      restaurantId: opts.restaurantId || null,
      requestPayloadSize: opts.requestPayloadSize || null,
      responseTimeMs: opts.responseTimeMs,
      success: opts.success,
      errorMessage: opts.errorMessage || null,
      timingBreakdown: opts.timingBreakdown || null,
    });
  } catch (e) {
    console.error("[OCR] API 사용량 로그 저장 실패:", e);
  }
}

export const ocrRouter = Router();

// ─── 진단: 배포 버전 + sharp 동작 확인 ─────────────────────────────────────────
ocrRouter.get("/debug", async (_req: Request, res: Response) => {
  let sharpStatus = "unknown";
  try {
    // 1x1 빨간 픽셀 JPEG 생성으로 sharp 동작 확인
    const buf = await sharp({
      create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } }
    }).jpeg().toBuffer();
    sharpStatus = `ok (${buf.length} bytes)`;
  } catch (err: any) {
    sharpStatus = `fail: ${err.message}`;
  }
  let tessStatus = "unknown";
  try {
    const tessVer = execSync("tesseract --version 2>&1", { encoding: "utf-8", timeout: 5000 });
    tessStatus = `ok (${tessVer.split("\n")[0]})`;
  } catch (err: any) {
    tessStatus = `fail: ${err.message}`;
  }

  res.json({
    version: "v9-quality-boost",  // 이미지 전처리 v9 + 2-pass 프롬프트 + 검증 강화
    timestamp: new Date().toISOString(),
    sharp: sharpStatus,
    tesseract: tessStatus,
    node: process.version,
  });
});

// ─── POST /api/ocr/detect-orientation — Tesseract OSD 1회 방향감지 ──────────
// 713d7ba 이후 클라이언트가 호출하지 않음 (자동회전 감지 폐기, 수동회전으로 대체).
// 디버그/수동 점검용으로만 잔존 — 엔드포인트 제거는 보류.
ocrRouter.post("/detect-orientation", async (req: Request, res: Response) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) { res.json({ suggestedRotation: 0 }); return; }

    const relativePath = imageUrl.replace(/^\/uploads\//, "");
    const filePath = path.join(UPLOAD_ROOT, relativePath);
    if (!fs.existsSync(filePath)) { res.json({ suggestedRotation: 0 }); return; }

    // EXIF 보정 먼저
    await fixExifOrientation(filePath);

    // Tesseract OSD (--psm 0) 1회 시도
    const tmpPng = filePath + ".osd.png";
    try {
      await sharp(filePath)
        .resize(1200, 1200, { fit: "inside" })
        .grayscale()
        .sharpen()
        .png()
        .toFile(tmpPng);

      let osdOutput = "";
      try {
        osdOutput = execSync(
          `tesseract "${tmpPng}" stdout --psm 0 -l kor+eng 2>&1`,
          { encoding: "utf-8", timeout: 8000 }
        );
      } catch (e: any) {
        osdOutput = e.stdout || e.stderr || "";
      }

      // "Orientation in degrees: 90" 패턴 파싱
      const degMatch = osdOutput.match(/Orientation in degrees:\s*(\d+)/);
      const osdDeg = degMatch ? parseInt(degMatch[1], 10) : 0;
      // OSD confidence
      const confMatch = osdOutput.match(/Orientation confidence:\s*([\d.]+)/);
      const osdConf = confMatch ? parseFloat(confMatch[1]) : 0;

      // Tesseract OSD는 "이미지를 이 각도만큼 돌려야 정방향" → 그대로 사용
      const suggested = [0, 90, 180, 270].includes(osdDeg) ? osdDeg : 0;

      console.log(`[OCR] OSD 방향감지: ${osdDeg}° (conf=${osdConf}) → suggested=${suggested}°`);
      res.json({ suggestedRotation: suggested, osdConfidence: osdConf });
    } finally {
      try { fs.unlinkSync(tmpPng); } catch {}
    }
  } catch (err: any) {
    console.warn("[OCR] detect-orientation error:", err.message);
    res.json({ suggestedRotation: 0 });
  }
});

// ─── 헬퍼: Anthropic 클라이언트 생성 ─────────────────────────────────────────
export function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

// ─── 헬퍼: 이미지 → base64 + MIME ────────────────────────────────────────────
export function loadImageBase64Raw(filePath: string): { base64: string; mediaType: string } {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  };
  const imageBuffer = fs.readFileSync(filePath);
  return {
    base64: imageBuffer.toString("base64"),
    mediaType: mimeMap[ext] || "image/jpeg",
  };
}

// ─── Tesseract 4방향 OCR 비교 기반 방향 감지 ─────────────────────────────────
// EXIF 방향 보정만 수행 (자동 회전 감지는 폐기 — 사용자 수동 회전으로 대체)
async function fixExifOrientation(filePath: string): Promise<void> {
  try {
    const meta = await sharp(filePath).metadata();
    if (meta.orientation && meta.orientation > 1) {
      const exifRotated = await sharp(filePath).rotate().toBuffer();
      fs.writeFileSync(filePath, exifRotated);
      console.log(`[OCR] EXIF 자동회전 적용 (orientation=${meta.orientation}): ${path.basename(filePath)}`);
    }
  } catch (exifErr: any) {
    console.warn(`[OCR] EXIF 회전 실패 (무시): ${path.basename(filePath)} — ${exifErr.message}`);
  }
}

// ─── 헬퍼: 문서 OCR 특화 이미지 전처리 (해상도 캡+그레이스케일+대비+샤픈, v9) ──
// extract-purchase / extract-statement(이미지) / extract-sales 3곳에서 공통 사용.
async function preprocessImageForOcr(filePath: string, logPrefix: string): Promise<void> {
  try {
    const meta = await sharp(filePath).metadata();
    const maxDim = Math.max(meta.width || 0, meta.height || 0);

    let pipeline = sharp(filePath);
    if (maxDim > OCR_PREPROCESS_MAX_DIM) {
      pipeline = pipeline.resize(OCR_PREPROCESS_MAX_DIM, OCR_PREPROCESS_MAX_DIM, { fit: "inside", withoutEnlargement: true });
    }

    pipeline = pipeline
      .grayscale()
      .normalize()                       // 히스토그램 평활화
      .linear(1.3, -(128 * 1.3 - 128))   // contrast boost 1.3x (중심점 128)
      .gamma(1.2);                        // 배경 밝게 (흰 배경 강조)

    pipeline = pipeline.sharpen({
      sigma: 2.0,  // 넓은 커널 (글자 획 전체 커버)
      m1: 2.0,     // flat area: 옅은 인쇄 강화
      m2: 1.0,     // edge area: 글자 경계 강조
    });

    const enhancedBuf = await pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
    fs.writeFileSync(filePath, enhancedBuf);
    console.log(`${logPrefix} 이미지 전처리 v9 완료: ${path.basename(filePath)} (${(enhancedBuf.length / 1024).toFixed(0)}KB, 원본 ${maxDim}px → grayscale+contrast+sharpen)`);
  } catch (enhErr: any) {
    console.warn(`${logPrefix} 이미지 전처리 실패 (원본 사용): ${enhErr.message}`);
  }
}

// ─── 헬퍼: Claude 호출 + 텍스트 추출 + JSON 파싱 통합 ──────────────────────
// extract-statement/extract-health-cert/extract-sales가 각각 복제하던
// messages.create|stream → extractText → parseAIJson 패턴을 공통화.
// throw하지 않고 parsed=null로 반환 (a39ccec 패턴과 동일하게 호출부가 분기).
async function callClaudeJson(opts: {
  anthropic: Anthropic;
  model: string;
  maxTokens: number;
  content: any[];
  stream?: boolean;
}): Promise<{ parsed: any | null; rawText: string | null; inputTokens: number; outputTokens: number; elapsedMs: number; stopReason?: string | null }> {
  const started = Date.now();
  let message: Anthropic.Message;
  if (opts.stream) {
    const stream = opts.anthropic.messages.stream({
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [{ role: "user", content: opts.content }],
    });
    message = await stream.finalMessage();
  } else {
    message = await opts.anthropic.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [{ role: "user", content: opts.content }],
    });
  }

  const elapsedMs = Date.now() - started;
  const inputTokens = message.usage?.input_tokens ?? 0;
  const outputTokens = message.usage?.output_tokens ?? 0;
  const rawText = extractText(message);

  let parsed: any | null = null;
  if (rawText) {
    try {
      parsed = parseAIJson(rawText);
    } catch (err: any) {
      console.warn(`[OCR] parseAIJson 실패: ${err?.message ?? err}`);
    }
  }

  return { parsed, rawText, inputTokens, outputTokens, elapsedMs, stopReason: message.stop_reason };
}

// ─── 헬퍼: 코드펜스 제거 + JSON 파싱 (잘린 JSON 복구 포함) ──────────────────
export function parseAIJson(raw: string): any {
  let jsonStr = raw.trim();

  // 마크다운 코드펜스 제거
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  } else if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").trim();
  }

  // 1차 시도: 정상 파싱
  try {
    return JSON.parse(jsonStr);
  } catch {}

  // 2차 시도: 잘린 JSON 복구
  const lastCompleteItem = jsonStr.lastIndexOf("}");
  if (lastCompleteItem > 0) {
    let truncated = jsonStr.substring(0, lastCompleteItem + 1);
    const openBrackets = (truncated.match(/\[/g) || []).length;
    const closeBrackets = (truncated.match(/\]/g) || []).length;
    for (let i = 0; i < openBrackets - closeBrackets; i++) truncated += "]";
    const openBraces = (truncated.match(/\{/g) || []).length;
    const closeBraces = (truncated.match(/\}/g) || []).length;
    for (let i = 0; i < openBraces - closeBraces; i++) truncated += "}";
    return JSON.parse(truncated);
  }

  throw new Error("JSON 파싱 불가");
}

// ─── 헬퍼: AI 텍스트 응답 추출 ──────────────────────────────────────────────
export function extractText(message: Anthropic.Message): string | null {
  const tc = message.content.find((c) => c.type === "text");
  return tc && tc.type === "text" ? tc.text : null;
}

// ─── 헬퍼: H6 서버 가드 — 줄바꿈으로 쪼개진 품목명 행 병합 ─────────────────
/** 수량·단가·금액이 전부 비어 있고 품목명만 있는 행 → 직전 행 이름에 병합.
 *  프롬프트 H6의 결정론적 백스톱. 수량/단가 판독 실패한 정상 행도 흡수될 수 있어
 *  uncertain=true를 강제해 UI에서 확인 필요 카드로 노출시킨다 (조용히 삼키지 않음). */
export function mergeWrappedNameRows(items: any[]): any[] {
  const NUM_KEYS = ["quantity", "unitPrice", "lineTotal", "supplyAmount", "vatAmount"];
  const SUMMARY_RE = /^(합\s*계|소\s*계|총\s*계|총\s*합|부가세|공급가액|이월|잔액|미수금|total|subtotal)/i;
  const num = (v: any) => {
    const s = String(v ?? "").replace(/[,\s원]/g, "");
    return s !== "" && Number.isFinite(Number(s)) && Number(s) !== 0;
  };
  const out: any[] = [];
  for (const it of items) {
    const name = String(it?.shortName || it?.name || "").replace(/\s+/g, " ").trim();
    if (!name || SUMMARY_RE.test(name) || out.length === 0) { out.push(it); continue; }
    const prev = out[out.length - 1];
    const prevName = String(prev.shortName || "").trim();
    const filled = NUM_KEYS.filter((k) => num(it[k])).length;
    // 병합 신호 (실물 검증: "손칼국수...(1kg*" + "12)" 같은 숫자 시작 파편 대응)
    const prevOpen = (prevName.match(/\(/g) || []).length > (prevName.match(/\)/g) || []).length; // ③ 여는 괄호 초과
    const prevDangling = /[*/(\-]$/.test(prevName);                                               // ② 구분자로 끝남
    const selfCloser = /\)$/.test(name) && !name.includes("(");                                   // ④ ")"로 끝나는데 여는 괄호 없음
    const continuation =
      filled === 0 ||                                            // ① 숫자 칸 전무
      ((prevOpen || prevDangling || selfCloser) && filled <= 1); // ②③④ + 숫자 파편 1개 이하
    if (continuation) {
      prev.shortName = `${prevName}${name}`;
      prev.originalName = `${String(prev.originalName || "").trim()}${name}`;
      prev.uncertain = true;
      prev.mergedFrom = [prev.mergedFrom, "H6-server"].filter(Boolean).join(",");
      console.log(`[OCR] H6 서버 병합: "${name}" → "${prev.shortName}"`);
      continue;
    }
    out.push(it);
  }
  return out;
}

// ─── 헬퍼: 합계 검증 + 신뢰도 산정 (서버사이드) ────────────────────────────
interface OcrItem {
  shortName: string;
  spec: string;
  originalName: string;
  name: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  lineTotal: string;
  supplyAmount: string | null;
  vatAmount: string | null;
  taxType: "taxable" | "exempt" | "unknown";
  vatEstimated?: boolean;
  confidence: "high" | "medium" | "low";
}

export function validateAndEnrichItems(items: any[], summary?: { totalSupply?: string; grandTotal?: string } | null): OcrItem[] {
  // 표에 행별 부가세 값이 하나라도 있는가 — 면세 안전망의 발화 조건.
  // 부가세 컬럼 자체가 없는 전표에서 "공급가=결제금액 → 면세" 안전망이 전 행을
  // exempt로 오판하는 것을 막는다 (그런 전표는 근거 없음 = unknown이 정답).
  const anyRowVat = items.some((it: any) => {
    const v = String(it?.vatAmount ?? "").replace(/,/g, "").trim();
    return v !== "" && Number.isFinite(Number(v)) && Number(v) > 0;
  });
  const enriched = items.map((item: any) => {
    const shortName = String(item.shortName || item.name || "");
    const spec = String(item.spec || "");
    const originalName = String(item.originalName || item.name || "");
    // 수량: 소수점 끝의 불필요한 0 제거 (예: "6.000" → "6")
    let qtyStr = String(item.quantity || "").replace(/,/g, "");
    if (qtyStr && !isNaN(Number(qtyStr))) {
      qtyStr = String(parseFloat(qtyStr));
    }
    const priceStr = String(item.unitPrice || "").replace(/,/g, "");
    const totalStr = String(item.lineTotal || "").replace(/,/g, "");
    const isUncertain = item.uncertain === true || item.uncertain === "true";

    let qty = parseFloat(qtyStr) || 0;
    const price = parseFloat(priceStr) || 0;

    // ── 수량 ".000"/스케일 오독 보정 (×1000, ×10, 음수 포함) ────────────────
    // OCR/Vision 폴백이 "3.000"을 "3000"으로 읽는 패턴: qty가 1000(또는 10)의
    // 배수(음수 포함)이고 qty/N × price ≈ lineTotal 이면 수량을 N으로 나눈다.
    // 나눗셈이라 부호는 자연 보존됨. 0.5·-2 같은 정상 소수/음수는 1000·10의
    // 배수가 아니므로 대상에서 자동 제외되어 과보정되지 않는다.
    if (qty !== 0 && price > 0) {
      const totalCheck = parseFloat(totalStr) || 0;
      if (totalCheck !== 0) {
        for (const divisor of [1000, 10]) {
          if (Math.abs(qty) >= divisor && qty % divisor === 0) {
            const correctedQty = qty / divisor;
            if (Math.abs(correctedQty * price - totalCheck) <= 1) {
              console.log(`[OCR] 수량 ×${divisor} 오독 보정: ${qtyStr} → ${correctedQty} (${shortName})`);
              qty = correctedQty;
              qtyStr = String(correctedQty);
              break;
            }
          }
        }
      }
    }
    const total = parseFloat(totalStr) || 0;
    let finalTotal = totalStr;
    let confidence: "high" | "medium" | "low" = "high";

    // 합계 검증: 수량×단가 vs lineTotal (합계금액 = 공급가+부가세)
    if (qty > 0 && price > 0 && total > 0) {
      const calculated = Math.round(qty * price);
      const diff = Math.abs(total - calculated);
      if (diff > 1 && diff / Math.max(total, calculated) > 0.02) {
        const vatRatio = calculated / total;
        if (vatRatio > 1.08 && vatRatio < 1.12) {
          // 단가 세후(부가세포함) / lineTotal 세전 (legacy) → 수량×단가(세후)로 교정
          finalTotal = String(calculated);
          confidence = "medium";
        } else if (vatRatio > 0.88 && vatRatio < 0.92) {
          // 단가 세전 / lineTotal 세후 (신규 정책: 부가세 별도 컬럼 양식) → lineTotal 그대로
          // 보정/confidence 변경 없음
        } else {
          // 기타 불일치 → 수량×단가 우선
          finalTotal = String(calculated);
          confidence = "medium";
        }
      }
    } else if (qty > 0 && price > 0 && !total) {
      // 합계 누락 시 계산 (면세 가능성 → ×1.1 자동 적용 안 함)
      finalTotal = String(Math.round(qty * price));
    }

    // AI가 uncertain으로 마킹한 항목
    if (isUncertain) {
      confidence = confidence === "high" ? "medium" : "low";
    }

    // 핵심 데이터 누락
    if (!shortName || (!qtyStr && !totalStr)) {
      confidence = "low";
    }

    // 비정상적 단가 감지 (단가 0 또는 음수)
    if (price < 0 || (price === 0 && total > 0)) {
      confidence = "low";
    }

    // 수량 이상치: 일반 매입 수량 100 초과는 드묾
    if (qty > 100 && confidence === "high") {
      confidence = "medium";
    }

    // 수량↔단가 뒤바뀜 감지: 단가가 수량보다 작으면 열 오독 가능성
    if (qty > 0 && price > 0 && price < qty) {
      confidence = "low";
    }

    // lineTotal 기반 역산 검증: lineTotal이 있고 qty×price와 큰 차이이면,
    // lineTotal/qty 또는 lineTotal/price로 누락값 복원 시도
    if (total > 0 && qty > 0 && price === 0) {
      // 단가 누락 → lineTotal/qty로 역산
      const inferredPrice = Math.round(total / qty);
      if (inferredPrice > 0) {
        console.log(`[OCR] 단가 역산: ${shortName} → lineTotal(${total})/qty(${qty})=${inferredPrice}`);
        // priceStr는 const이므로 finalTotal만 보정
        confidence = "medium";
      }
    }
    if (total > 0 && price > 0 && qty === 0) {
      // 수량 누락 → lineTotal/price로 역산
      const inferredQty = parseFloat((total / price).toFixed(2));
      if (inferredQty > 0 && inferredQty < 200) {
        console.log(`[OCR] 수량 역산: ${shortName} → lineTotal(${total})/price(${price})=${inferredQty}`);
        qty = inferredQty;
        qtyStr = String(inferredQty);
        confidence = "medium";
      }
    }

    // ── 과세/면세 보정 (부가세 칸 값이 1차 신호 — 모델 판정보다 우선) ────
    let taxType: "taxable" | "exempt" | "unknown" =
      ["taxable", "exempt", "unknown"].includes(item.taxType) ? item.taxType : "unknown";
    const supply = item.supplyAmount != null && String(item.supplyAmount) !== ""
      ? parseFloat(String(item.supplyAmount).replace(/,/g, "")) : null;
    const vat = item.vatAmount != null && String(item.vatAmount) !== ""
      ? parseFloat(String(item.vatAmount).replace(/,/g, "")) : null;
    // 행 결제금액: 0855 계열은 단가가 부가세 포함 → 수량×단가 = 결제금액. 없으면 lineTotal.
    const gross = qty > 0 && price > 0 ? Math.round(qty * price) : Math.round(parseFloat(finalTotal) || 0);
    if (vat != null) {
      taxType = vat > 0 ? "taxable" : "exempt";
    } else if (anyRowVat && supply != null && gross > 0 && Math.abs(supply - gross) <= 1) {
      // 안전망: 부가세 컬럼이 존재하는 표에서 공급가액 = 결제금액이면 면세.
      // 품목명에 "(면세)" 표기가 없는 면세 대응 (실물 예: "백합/냉동/1kg(1kg*5개/박스)")
      // anyRowVat 게이트: 부가세 컬럼 자체가 없는 전표는 근거 없음 → unknown 유지
      taxType = "exempt";
    }
    let supplyFinal = supply;
    let vatFinal = vat;
    let vatEstimated = false;
    if (gross > 0) {
      if (taxType === "exempt") {
        supplyFinal = gross;
        vatFinal = 0;
      } else if (taxType === "taxable") {
        // 실물 검증 결과 반올림은 올림(ceil). 서버 검증은 ±1원 허용 (거래처별 ROUND 가능성)
        if (supplyFinal == null) { supplyFinal = Math.ceil(gross / 1.1); vatEstimated = true; }
        if (vatFinal == null) { vatFinal = gross - supplyFinal; vatEstimated = true; }
        // 정합성 검사: 공급가액 + 부가세 = 결제금액
        if (Math.abs(supplyFinal + vatFinal - gross) > 1) confidence = "low";
      }
      // 관계식 기반 결제금액 교정: 공급가+부가세 = 수량×단가가 성립하는데 lineTotal만
      // 어긋나면 lineTotal 오독이다 (0855 계열: 단가 세후). 단가 세전 양식에서는
      // 공급가+부가세 ≠ 수량×단가라 이 조건이 성립하지 않으므로 오발화하지 않는다.
      if (qty > 0 && price > 0 && supplyFinal != null && vatFinal != null
          && Math.abs(supplyFinal + vatFinal - gross) <= 1
          && Math.abs((parseFloat(finalTotal) || 0) - gross) > 1) {
        console.log(`[OCR] lineTotal 관계식 교정: ${shortName} ${finalTotal} → ${gross}`);
        finalTotal = String(gross);
        if (confidence === "high") confidence = "medium";
      }
    }

    return {
      shortName: shortName.replace(/\[\?\]/g, "").trim(),
      spec: spec.trim(),
      originalName: originalName.replace(/\[\?\]/g, "").trim(),
      name: shortName.replace(/\[\?\]/g, "").trim(),
      quantity: qtyStr,
      unit: String(item.unit || ""),
      unitPrice: priceStr,
      lineTotal: finalTotal,
      supplyAmount: supplyFinal != null && Number.isFinite(supplyFinal) ? String(supplyFinal) : null,
      vatAmount: vatFinal != null && Number.isFinite(vatFinal) ? String(vatFinal) : null,
      taxType,
      vatEstimated: vatEstimated || undefined,
      confidence,
    };
  });

  // ── summary 크로스체크: 아이템 합산 vs 문서 합계 ──────────────────────
  // 기준을 reconcileTotals와 동일하게 resolveDocGrand로 통일 (배너/confidence 엇갈림 방지)
  if (summary) {
    const docTotal = resolveDocGrand(summary) ?? 0;
    if (docTotal > 0 && enriched.length > 0) {
      const itemSum = enriched.reduce((sum, it) => sum + (parseFloat(it.lineTotal) || 0), 0);
      const totalDiff = Math.abs(itemSum - docTotal);
      if (totalDiff > 100 && totalDiff / docTotal > 0.05) {
        // 5% 이상 차이 → 모든 아이템을 medium으로 (전체적 판독 오류 가능성)
        console.warn(`[OCR] 합계 불일치: items합산=${itemSum}, 문서합계=${docTotal}, 차이=${totalDiff}`);
        for (const it of enriched) {
          if (it.confidence === "high") it.confidence = "medium";
        }
      }
    }
  }

  return enriched;
}

// ─── 헬퍼: 문서 결제합계 판별 ───────────────────────────────────────────────
/** 문서 합계의 신뢰 우선순위: 공급가액합 + 부가세합 → grandTotal → 공급가액합.
 *  거래명세표 0855 계열의 하단 합계행에는 "①+② 합계"(누적 미수금)가 있어
 *  모델이 이를 grandTotal로 오독하면 합계 검증이 통째로 무력화된다.
 *  공급가+부가세 합성은 이 오독에 면역이므로 1순위로 쓴다. */
export function resolveDocGrand(s: { totalSupply?: string | null; totalTax?: string | null; grandTotal?: string | null } | null | undefined): number | null {
  const n = (v: any): number | null => {
    if (v == null || String(v).trim() === "") return null;
    const x = parseFloat(String(v).replace(/,/g, ""));
    return Number.isFinite(x) ? x : null;
  };
  const supply = n(s?.totalSupply);
  const tax = n(s?.totalTax);
  const grand = n(s?.grandTotal);
  if (supply != null && supply > 0 && tax != null) {
    if (grand != null && Math.abs(grand - (supply + tax)) > 10) {
      console.warn(`[OCR] grandTotal(${grand}) 무시 — 공급가+부가세(${supply + tax})와 불일치. 누적미수금 오독 의심`);
    }
    return supply + tax;
  }
  if (grand != null && grand > 0) return grand;
  if (supply != null && supply > 0) return supply;
  return null;
}

// ─── 헬퍼: 합계 정합 검증 + 결정론적 자동보정 ───────────────────────────────
export interface OcrTotals {
  docSupply: number | null;   // summary.totalSupply
  docTax: number | null;      // summary.totalTax
  docGrand: number | null;    // summary.grandTotal ?? (docSupply + docTax)
  itemSum: number;            // Σ lineTotal (보정 후)
  diff: number;               // itemSum - docGrand
  status: "match" | "auto_fixed" | "mismatch" | "no_doc_total";
  fixes: string[];            // 사람이 읽는 보정 설명 (한글)
}

/** 문서 합계 vs 항목 합산 정합 검증. 순수 산술 자동보정(추가 API 호출 없음).
 *  순서대로 시도하고 허용오차 내로 정확히 맞는 첫 후보에서 종료.
 *  모든 보정은 fixes[]에 한글로 기록 — 조용한 보정 금지. */
export function reconcileTotals(
  items: OcrItem[],
  summary?: { totalSupply?: string | null; totalTax?: string | null; grandTotal?: string | null } | null
): OcrTotals {
  const totals = reconcileCore(items, summary);

  // ── 독립 축 검증: 결제 합계가 맞아도 공급가/부가세 축이 어긋나면 세구분 오판정 의심 ──
  const axisTol = (doc: number) => Math.max(10, Math.abs(doc) * 0.001);
  if (totals.docSupply != null && totals.docSupply > 0 && items.length > 0 && items.every((it) => it.supplyAmount != null)) {
    const supplySum = Math.round(items.reduce((s, it) => s + (parseFloat(it.supplyAmount ?? "") || 0), 0));
    if (Math.abs(supplySum - totals.docSupply) > axisTol(totals.docSupply)) {
      totals.fixes.push(`공급가액 합계 불일치 (문서 ${totals.docSupply.toLocaleString()}원 / 항목 합산 ${supplySum.toLocaleString()}원) — 과세/면세 분류를 확인해주세요`);
    }
  }
  if (totals.docTax != null && items.length > 0 && items.every((it) => it.vatAmount != null)) {
    const vatSum = Math.round(items.reduce((s, it) => s + (parseFloat(it.vatAmount ?? "") || 0), 0));
    if (Math.abs(vatSum - totals.docTax) > axisTol(totals.docTax)) {
      totals.fixes.push(`부가세 합계 불일치 (문서 ${totals.docTax.toLocaleString()}원 / 항목 합산 ${vatSum.toLocaleString()}원) — 과세/면세 분류를 확인해주세요`);
    }
  }
  return totals;
}

function reconcileCore(
  items: OcrItem[],
  summary?: { totalSupply?: string | null; totalTax?: string | null; grandTotal?: string | null } | null
): OcrTotals {
  const num = (v: any): number | null => {
    if (v == null || String(v).trim() === "") return null;
    const n = parseFloat(String(v).replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const docSupply = num(summary?.totalSupply);
  const docTax = summary?.totalTax != null && String(summary.totalTax).trim() !== ""
    ? (Number.isFinite(parseFloat(String(summary.totalTax).replace(/,/g, ""))) ? parseFloat(String(summary.totalTax).replace(/,/g, "")) : null)
    : null; // 부가세 0은 유효값
  // 우선순위: 공급가+부가세 합성 → grandTotal (누적미수금 오독 면역 — resolveDocGrand 참조)
  const docGrand = resolveDocGrand(summary);

  const sumOf = (list: OcrItem[]) => list.reduce((s, it) => s + (parseFloat(it.lineTotal) || 0), 0);
  let itemSum = Math.round(sumOf(items));
  const fixes: string[] = [];

  if (docGrand == null) {
    return { docSupply, docTax, docGrand: null, itemSum, diff: 0, status: "no_doc_total", fixes };
  }

  const tol = Math.max(10, docGrand * 0.001);
  const within = (v: number) => Math.abs(v - docGrand) <= tol;

  if (within(itemSum)) {
    return { docSupply, docTax, docGrand, itemSum, diff: itemSum - docGrand, status: "match", fixes };
  }

  // (a0) 행 결제금액을 공급가액으로 읽음 — 0855 계열에서 가장 흔한 오독 유형
  //      판정: Σ supplyAmount ≈ docSupply 이고 itemSum ≈ docSupply (결제금액이 공급가액 자리)
  //      조치: 전 행 lineTotal = supplyAmount + vatAmount. 면세 행 오염 위험 없음.
  if (docSupply != null && docSupply > 0 && items.every((it) => it.supplyAmount != null)) {
    const supplySum = Math.round(items.reduce((s, it) => s + (parseFloat(it.supplyAmount ?? "") || 0), 0));
    const tolS = Math.max(10, docSupply * 0.001);
    if (Math.abs(supplySum - docSupply) <= tolS && Math.abs(itemSum - docSupply) <= tolS) {
      for (const it of items) {
        const s = parseFloat(it.supplyAmount ?? "") || 0;
        const v = parseFloat(it.vatAmount ?? "") || 0;
        if (s > 0) {
          it.lineTotal = String(Math.round(s + v));
          if (it.confidence === "high") it.confidence = "medium";
        }
      }
      itemSum = Math.round(sumOf(items));
      fixes.push("각 행 금액을 공급가액으로 읽은 것으로 판단해 공급가액+부가세로 재계산했습니다");
      if (within(itemSum)) {
        return { docSupply, docTax, docGrand, itemSum, diff: itemSum - docGrand, status: "auto_fixed", fixes };
      }
    }
  }

  // (a) 부가세 미합산: taxable/unknown 행 ×1.1 + exempt 행 그대로 ≈ docGrand
  //     행 단위 taxType이 있어 면세 혼합 전표에서도 안전 (exempt 행 제외)
  {
    const candidate = Math.round(items.reduce((s, it) => {
      const lt = parseFloat(it.lineTotal) || 0;
      return s + (it.taxType === "exempt" ? lt : Math.round(lt * 1.1));
    }, 0));
    if (within(candidate)) {
      for (const it of items) {
        if (it.taxType === "exempt") continue;
        const lt = parseFloat(it.lineTotal) || 0;
        if (lt <= 0) continue;
        it.supplyAmount = it.supplyAmount ?? String(lt);
        it.lineTotal = String(Math.round(lt * 1.1));
        it.vatAmount = it.vatAmount ?? String(Math.round(lt * 1.1) - lt);
        if (it.confidence === "high") it.confidence = "medium";
      }
      itemSum = Math.round(sumOf(items));
      fixes.push(`부가세 미합산으로 판단해 과세 항목에 부가세 10%를 더했습니다 (면세 항목 제외)`);
      return { docSupply, docTax, docGrand, itemSum, diff: itemSum - docGrand, status: "auto_fixed", fixes };
    }
  }

  // (b) 부가세 이중합산: taxable/unknown 행 ÷1.1 ≈ docGrand
  {
    const candidate = Math.round(items.reduce((s, it) => {
      const lt = parseFloat(it.lineTotal) || 0;
      return s + (it.taxType === "exempt" ? lt : Math.round(lt / 1.1));
    }, 0));
    if (within(candidate)) {
      for (const it of items) {
        if (it.taxType === "exempt") continue;
        const lt = parseFloat(it.lineTotal) || 0;
        if (lt <= 0) continue;
        it.lineTotal = String(Math.round(lt / 1.1));
        if (it.confidence === "high") it.confidence = "medium";
      }
      itemSum = Math.round(sumOf(items));
      fixes.push(`부가세 이중합산으로 판단해 과세 항목 금액을 1.1로 나눠 되돌렸습니다`);
      return { docSupply, docTax, docGrand, itemSum, diff: itemSum - docGrand, status: "auto_fixed", fixes };
    }
  }

  // (c) 단일 행 자릿수 오독: 어떤 행 하나에 ×10/÷10/×100/÷100을 적용하면 정확히 맞음
  for (let i = 0; i < items.length; i++) {
    const lt = parseFloat(items[i].lineTotal) || 0;
    if (lt <= 0) continue;
    for (const factor of [10, 0.1, 100, 0.01]) {
      const fixed = Math.round(lt * factor);
      const candidate = itemSum - Math.round(lt) + fixed;
      if (Math.abs(candidate - docGrand) <= 10) {
        items[i].lineTotal = String(fixed);
        items[i].confidence = "low";
        itemSum = Math.round(sumOf(items));
        fixes.push(`"${items[i].shortName}" 금액 자릿수 오독으로 판단해 ${Math.round(lt).toLocaleString()}원 → ${fixed.toLocaleString()}원으로 보정했습니다`);
        return { docSupply, docTax, docGrand, itemSum, diff: itemSum - docGrand, status: "auto_fixed", fixes };
      }
    }
  }

  // (d) 중복 행: 초과분이 특정 행 금액과 정확히 일치 + 동일 품명 2회 이상 등장
  if (itemSum > docGrand) {
    const excess = itemSum - docGrand;
    const nameCount = new Map<string, number>();
    for (const it of items) nameCount.set(it.shortName, (nameCount.get(it.shortName) ?? 0) + 1);
    const dupIdx = items.findIndex(
      (it) => Math.abs((parseFloat(it.lineTotal) || 0) - excess) <= 10 && (nameCount.get(it.shortName) ?? 0) >= 2
    );
    if (dupIdx >= 0) {
      const removed = items.splice(dupIdx, 1)[0];
      itemSum = Math.round(sumOf(items));
      fixes.push(`중복 계상된 항목 "${removed.shortName}" (${Math.round(parseFloat(removed.lineTotal) || 0).toLocaleString()}원) 1건을 제거했습니다`);
      return { docSupply, docTax, docGrand, itemSum, diff: itemSum - docGrand, status: "auto_fixed", fixes };
    }
  }

  // (e) 행 누락 의심 — 자동 추가 금지, 기록만
  if (docGrand > itemSum) {
    fixes.push(`행 누락 의심 (부족액 ${Math.round(docGrand - itemSum).toLocaleString()}원)`);
  }
  return { docSupply, docTax, docGrand, itemSum, diff: itemSum - docGrand, status: "mismatch", fixes };
}

// ─── 거래처 품목 매칭 (기존 DB 활용) ────────────────────────────────────────
export async function matchCounterpartyItems(
  counterpartyId: number | null,
  items: OcrItem[]
): Promise<OcrItem[]> {
  if (!counterpartyId) return items;

  try {
    const existingItems = await db
      .select({ id: counterpartyItems.id, itemId: counterpartyItems.itemId, name: counterpartyItems.supplierItemName, itemName: itemsTable.name, price: counterpartyItems.defaultPrice })
      .from(counterpartyItems)
      .leftJoin(itemsTable, eq(counterpartyItems.itemId, itemsTable.id))
      .where(and(
        eq(counterpartyItems.counterpartyId, counterpartyId),
        eq(counterpartyItems.isActive, true)
      ));

    if (existingItems.length === 0) return items;

    return items.map((item) => {
      // 기존 품목과 fuzzy 매칭
      const match = existingItems.find((ei) => {
        const displayName = ei.name || ei.itemName;
        if (!displayName) return false;
        const eiName = displayName.toLowerCase();
        const itemName = item.shortName.toLowerCase();
        return eiName === itemName || eiName.includes(itemName) || itemName.includes(eiName);
      });

      if (match && match.price != null) {
        // 단가 이상 감지: 기존 평균 단가 대비 ±30% 이상이면 confidence 낮춤
        const currentPrice = parseFloat(item.unitPrice) || 0;
        const existingPrice = Number(match.price);
        if (currentPrice > 0 && existingPrice > 0) {
          const diff = Math.abs(currentPrice - existingPrice) / existingPrice;
          if (diff > 0.3) {
            return { ...item, confidence: "low" as const };
          }
        }
      }
      return item;
    });
  } catch {
    return items;
  }
}

// ─── 거래처명 → ID 매칭 ─────────────────────────────────────────────────────
async function findCounterpartyId(name: string, restaurantId?: number): Promise<number | null> {
  if (!name || !restaurantId) return null;
  try {
    const rows = await db
      .select({ id: counterparties.id, name: counterparties.name })
      .from(counterparties)
      .where(and(
        eq(counterparties.restaurantId, restaurantId),
        eq(counterparties.isActive, true)
      ));
    const match = rows.find((r) => r.name.includes(name) || name.includes(r.name));
    return match?.id ?? null;
  } catch {
    return null;
  }
}

// ─── 거래처 후보 매칭 (퍼지) ────────────────────────────────────────────────
async function findCounterpartyCandidates(
  ocrName: string,
  restaurantId?: number
): Promise<{ id: number; name: string; score: number }[]> {
  if (!ocrName || !restaurantId) return [];
  try {
    const rows = await db
      .select({ id: counterparties.id, name: counterparties.name })
      .from(counterparties)
      .where(and(
        eq(counterparties.restaurantId, restaurantId),
        eq(counterparties.isActive, true)
      ));
    if (rows.length === 0) return [];

    const ocrNorm = normalizeKorean(ocrName);
    return rows
      .map((r) => {
        const dbNorm = normalizeKorean(r.name);
        const score = fuzzyScore(ocrNorm, dbNorm);
        return { id: r.id, name: r.name, score };
      })
      .filter((r) => r.score >= 0.3) // 30% 이상 유사도만
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  } catch {
    return [];
  }
}

// ─── 품목 매칭 임계값 ─────────────────────────────────────────────────────
// COUNTERPARTY: 거래처 품목 후보 인정 최소치 (미만이면 마스터 폴백)
// MASTER_FALLBACK: 전체 마스터 폴백 시 최소 score
// DISPLAY: 사용자에게 후보로 보여줄 최소치
// AUTOPICK: 자동 매칭(matchedItemId 세팅) 최소치
const ITEM_MATCH_THRESHOLD = {
  COUNTERPARTY: 0.65,
  MASTER_FALLBACK: 0.75,
  DISPLAY: 0.5,
  AUTOPICK: 0.8,
};

// ─── 품목 후보 매칭 (거래처 확정 후) ──────────────────────────────────────────
async function findItemCandidates(
  restaurantId: number,
  counterpartyId: number | null,
  ocrItems: OcrItem[]
): Promise<OcrItem[]> {
  try {
    // 거래처 품목 + 전체 품목 마스터 조회
    let cpItems: { id: number; itemId: number | null; name: string | null; itemName: string | null; price: string | null }[] = [];
    if (counterpartyId) {
      cpItems = await db
        .select({ id: counterpartyItems.id, itemId: counterpartyItems.itemId, name: counterpartyItems.supplierItemName, itemName: items.name, price: counterpartyItems.defaultPrice })
        .from(counterpartyItems)
        .leftJoin(items, eq(counterpartyItems.itemId, items.id))
        .where(and(
          eq(counterpartyItems.counterpartyId, counterpartyId),
          eq(counterpartyItems.isActive, true)
        ));
    }

    // 전체 품목 마스터 (거래처 품목에 없는 경우 폴백)
    const allItems = await db
      .select({ id: items.id, name: items.name })
      .from(items)
      .where(eq(items.restaurantId, restaurantId));

    return ocrItems.map((item) => {
      const ocrNorm = normalizeKorean(item.shortName);

      // 1) 거래처 품목에서 매칭
      let bestMatch: { itemId: number; itemName: string; score: number; source: "counterparty" | "master" } | null = null;
      let candidates: { itemId: number; itemName: string; score: number; source: "counterparty" | "master" }[] = [];

      for (const ci of cpItems) {
        const displayName = ci.name || ci.itemName;
        if (!displayName) continue;
        const score = ocrNorm ? fuzzyScore(ocrNorm, normalizeKorean(displayName)) : 0;
        if (ci.itemId) {
          candidates.push({ itemId: ci.itemId, itemName: displayName, score, source: "counterparty" });
        }
      }

      // 2) 거래처 품목에서 유효 후보가 하나도 없으면 전체 마스터에서 검색
      if (candidates.filter(c => c.score >= ITEM_MATCH_THRESHOLD.COUNTERPARTY).length === 0) {
        for (const mi of allItems) {
          const score = ocrNorm ? fuzzyScore(ocrNorm, normalizeKorean(mi.name)) : 0;
          if (score >= ITEM_MATCH_THRESHOLD.MASTER_FALLBACK) {
            candidates.push({ itemId: mi.id, itemName: mi.name, score, source: "master" });
          }
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      bestMatch = candidates[0] || null;

      const displayCandidates = candidates.filter((c) => c.score >= ITEM_MATCH_THRESHOLD.DISPLAY);

      return {
        ...item,
        matchedItemId: bestMatch?.score && bestMatch.score >= ITEM_MATCH_THRESHOLD.AUTOPICK ? bestMatch.itemId : undefined,
        matchedItemName: bestMatch?.score && bestMatch.score >= ITEM_MATCH_THRESHOLD.AUTOPICK ? bestMatch.itemName : undefined,
        itemCandidates: displayCandidates.slice(0, 5).map((c) => ({
          itemId: c.itemId,
          itemName: c.itemName,
          score: Math.round(c.score * 100),
          source: c.source,
        })),
      };
    });
  } catch {
    return ocrItems;
  }
}

// ─── 한글 정규화 (공백, 괄호 정리) ──────────────────────────────────────────
function normalizeKorean(s: string): string {
  return s
    .replace(/\s+/g, '')        // 공백 제거
    .replace(/[()（）\[\]]/g, '') // 괄호 제거
    .toLowerCase();
}

// ─── 퍼지 유사도 점수 (0~1) ────────────────────────────────────────────────
function fuzzyScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  // 짧은 단어(≤2자)는 완전일치만 인정 — "양파"/"양배추" 같은 오매칭 방지
  const minLen = Math.min(a.length, b.length);
  if (minLen <= 2) return 0;

  // 포함 관계 체크 — 길이 비율이 0.6 미만이면 0 (너무 짧은 쪽이 긴 쪽에 포함되는 우연 매칭 차단)
  if (a.includes(b) || b.includes(a)) {
    const longer = Math.max(a.length, b.length);
    const ratio = minLen / longer;
    if (ratio < 0.6) return 0;
    return ratio; // 길이 비율로 점수화 (짧은쪽/긴쪽)
  }

  // Levenshtein distance 기반 유사도
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ─── 거래처 정보 변경 감지 → DB 자동 반영 ─────────────────────────────────
async function updateCounterpartyInfo(
  counterpartyId: number,
  info: { contactName?: string; contactPhone?: string }
): Promise<void> {
  try {
    const existing = await db
      .select({ contactName: counterparties.contactName, contactPhone: counterparties.contactPhone })
      .from(counterparties)
      .where(eq(counterparties.id, counterpartyId))
      .limit(1);
    if (existing.length === 0) return;

    const updates: Record<string, string> = {};
    // 담당자명: 기존에 없거나 다르면 업데이트
    if (info.contactName && info.contactName !== existing[0].contactName) {
      updates.contactName = info.contactName;
    }
    // 연락처: 기존에 없거나 다르면 업데이트
    if (info.contactPhone && info.contactPhone !== existing[0].contactPhone) {
      updates.contactPhone = info.contactPhone;
    }

    if (Object.keys(updates).length > 0) {
      await db.update(counterparties)
        .set(updates)
        .where(eq(counterparties.id, counterpartyId));
      console.log(`[OCR] 거래처 정보 업데이트: cpId=${counterpartyId}`, updates);
    }
  } catch (err) {
    console.warn("[OCR] 거래처 정보 업데이트 실패:", err);
  }
}

// ─── 거래처 OCR 프로파일 조회 ──────────────────────────────────────────────
export async function getOcrProfile(counterpartyId: number | null): Promise<{
  documentType?: string;
  columnOrder?: string;
  frequentItems?: { name: string; avgPrice: number; unit: string }[];
} | null> {
  if (!counterpartyId) return null;
  try {
    const rows = await db
      .select()
      .from(counterpartyOcrProfiles)
      .where(eq(counterpartyOcrProfiles.counterpartyId, counterpartyId))
      .limit(1);
    if (rows.length === 0) return null;
    const profile = rows[0];
    return {
      documentType: profile.documentType || undefined,
      columnOrder: profile.columnOrder || undefined,
      frequentItems: (profile.frequentItems as any) || undefined,
    };
  } catch {
    return null;
  }
}

// ─── 거래처 OCR 프로파일 업데이트 (OCR 결과 기반 자동 학습) ────────────────
async function updateOcrProfile(
  counterpartyId: number | null,
  documentType: string | null,
  items: OcrItem[]
): Promise<void> {
  if (!counterpartyId || items.length === 0) return;
  try {
    const existing = await db
      .select()
      .from(counterpartyOcrProfiles)
      .where(eq(counterpartyOcrProfiles.counterpartyId, counterpartyId))
      .limit(1);

    // 현재 품목 → frequentItems로 변환
    const currentItems = items
      .filter(i => i.shortName && parseFloat(i.unitPrice) > 0)
      .map(i => ({
        name: i.shortName,
        avgPrice: parseFloat(i.unitPrice),
        unit: i.unit || "",
      }));

    if (existing.length === 0) {
      // 신규 생성
      await db.insert(counterpartyOcrProfiles).values({
        counterpartyId,
        documentType: documentType || null,
        frequentItems: currentItems,
        sampleCount: 1,
        lastUsedAt: new Date(),
      });
      console.log(`[OCR] 프로파일 신규 생성: counterpartyId=${counterpartyId}`);
    } else {
      // 기존 프로파일 업데이트: frequentItems 병합 (이동평균 단가)
      const oldItems = (existing[0].frequentItems as any[]) || [];
      const merged = [...oldItems];
      for (const ci of currentItems) {
        const found = merged.find(m => m.name === ci.name);
        if (found) {
          // 이동평균: (기존단가 × 0.7) + (새단가 × 0.3)
          found.avgPrice = Math.round(found.avgPrice * 0.7 + ci.avgPrice * 0.3);
          found.unit = ci.unit || found.unit;
        } else {
          merged.push(ci);
        }
      }
      // 최근 50개만 유지 (오래된 것부터 제거)
      const trimmed = merged.slice(-50);

      await db.update(counterpartyOcrProfiles)
        .set({
          documentType: documentType || existing[0].documentType,
          frequentItems: trimmed,
          sampleCount: (existing[0].sampleCount || 0) + 1,
          lastUsedAt: new Date(),
        })
        .where(eq(counterpartyOcrProfiles.counterpartyId, counterpartyId));
      console.log(`[OCR] 프로파일 업데이트: counterpartyId=${counterpartyId}, items=${trimmed.length}`);
    }
  } catch (err) {
    console.warn("[OCR] 프로파일 업데이트 실패:", err);
  }
}

// ─── 동적 프롬프트 생성: 거래처 프로파일 기반 힌트 ──────────────────────────
export function buildProfileHint(profile: {
  documentType?: string;
  columnOrder?: string;
  frequentItems?: { name: string; avgPrice: number; unit: string }[];
} | null): string {
  if (!profile) return "";

  const parts: string[] = [];
  parts.push("\n\n## 이 거래처의 기존 정보 (참고용 힌트)");

  if (profile.documentType) {
    parts.push(`- 양식 유형: ${profile.documentType}`);
  }
  if (profile.columnOrder) {
    parts.push(`- 열 구조: ${profile.columnOrder}`);
  }
  if (profile.frequentItems && profile.frequentItems.length > 0) {
    parts.push("- 자주 등장하는 품목 (품명 → 평균 단가):");
    for (const item of profile.frequentItems.slice(0, 20)) {
      parts.push(`  · ${item.name}: ~${item.avgPrice.toLocaleString()}원${item.unit ? ` (${item.unit})` : ""}`);
    }
    parts.push("※ 위 단가는 참고용입니다. 이미지에 적힌 실제 숫자를 우선하세요.");
  }

  return parts.join("\n");
}

// ─── Upstage 파싱 결과 캐시 (재분석 시 Upstage 재호출 회피) ──────────────────
// Railway 단일 인스턴스 전제의 인메모리 캐시. TTL 10분, LRU 최대 20건.
const upstageCache = new Map<string, { parsed: UpstageParseResult; expiresAt: number }>();
const UPSTAGE_CACHE_TTL_MS = 10 * 60_000;
const UPSTAGE_CACHE_MAX = 20;

function upstageCacheSet(key: string, parsed: UpstageParseResult) {
  upstageCache.delete(key); // 재삽입으로 LRU 순서 갱신
  upstageCache.set(key, { parsed, expiresAt: Date.now() + UPSTAGE_CACHE_TTL_MS });
  while (upstageCache.size > UPSTAGE_CACHE_MAX) {
    const oldest = upstageCache.keys().next().value;
    if (oldest === undefined) break;
    upstageCache.delete(oldest);
  }
}

function upstageCacheGet(key: string): UpstageParseResult | null {
  const entry = upstageCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    upstageCache.delete(key);
    return null;
  }
  return entry.parsed;
}

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/ocr/extract-purchase — 단일 Vision 직접 구조화
// ═════════════════════════════════════════════════════════════════════════════
ocrRouter.post("/extract-purchase", async (req: Request, res: Response) => {
  try {
    const anthropic = getAnthropicClient();
    if (!anthropic) {
      res.status(500).json({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." });
      return;
    }

    const { imageUrl, restaurantId, counterpartyId: clientCpId, rotation } = req.body;
    if (!imageUrl || typeof imageUrl !== "string") {
      res.status(400).json({ error: "imageUrl이 필요합니다" });
      return;
    }

    const relativePath = imageUrl.replace(/^\/uploads\//, "");
    const filePath = path.join(UPLOAD_ROOT, relativePath);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "이미지 파일을 찾을 수 없습니다" });
      return;
    }

    const preStart = Date.now();

    // ── EXIF 방향 보정 ──
    await fixExifOrientation(filePath);

    // ── 사용자 수동 회전 적용 (0/90/180/270) ──
    const rotationDeg = typeof rotation === "number" && [90, 180, 270].includes(rotation) ? rotation : 0;
    if (rotationDeg > 0) {
      console.log(`[OCR] 사용자 회전 적용: ${rotationDeg}°`);
      const rotatedBuf = await sharp(filePath).rotate(rotationDeg).toBuffer();
      fs.writeFileSync(filePath, rotatedBuf);
    }

    // ── 이미지 전처리: 문서 OCR 특화 파이프라인 (v9) ──
    await preprocessImageForOcr(filePath, "[OCR]");

    // ── 하이브리드 OCR 파이프라인 (Upstage + Claude 텍스트 해석, fallback: Claude Vision) ──
    const ocrStartTime = Date.now();
    const hybridOut = await runHybridOcr(
      { filePath, restaurantId: Number(restaurantId) || undefined, counterpartyId: clientCpId ? Number(clientCpId) : undefined },
      {
        anthropic,
        buildProfileHint,
        getOcrProfile,
        promptV2Template: promptV2,
        promptV1ImageFallback,
        loadImageBase64Raw,
        extractText,
        parseAIJson,
      }
    );

    const ocrElapsed = Date.now() - ocrStartTime;
    const inputTokens = hybridOut.claude.inputTokens;
    const outputTokens = hybridOut.claude.outputTokens;

    const parsed = hybridOut.rawJson;
    if (!parsed) {
      logOcrApiUsage({ endpoint: "extract-purchase", restaurantId: restaurantId ? Number(restaurantId) : undefined, responseTimeMs: ocrElapsed, success: false, errorMessage: "AI 응답 파싱 실패", inputTokens, outputTokens, model: hybridOut.claude.model });
      res.status(500).json({ error: "AI 응답을 처리하지 못했습니다. 다시 시도해주세요.", retryable: true, reason: "parse_failed" });
      return;
    }

    // ── Upstage 파싱 결과 캐시 (재분석 시 Upstage 재호출 회피) ──────────
    if (hybridOut.upstageParsed) {
      upstageCacheSet(imageUrl, hybridOut.upstageParsed);
    }

    // ── 합계 검증 + 신뢰도 + summary 크로스체크 (H6 서버 가드 선적용) ────
    let items = validateAndEnrichItems(
      mergeWrappedNameRows(Array.isArray(parsed.items) ? parsed.items : []),
      parsed.summary || null
    );

    // ── 빈 항목 제거 + 완전 중복 제거 ──────────────────────────────────
    items = items.filter((item) => {
      // 품목명이 없는 항목 제거
      if (!item.shortName.trim()) return false;
      // 합계/소계 행이 품목으로 잘못 들어온 경우 제거
      const lowerName = item.shortName.trim().toLowerCase();
      if (/^(합계|소계|총합|total|subtotal|합\s*계)$/i.test(lowerName)) return false;
      return true;
    });

    // 완전 동일한 항목 중복 제거 (품명+수량+단가+합계 모두 같으면 중복)
    const seen = new Set<string>();
    items = items.filter((item) => {
      const key = `${item.shortName}|${item.quantity}|${item.unitPrice}|${item.lineTotal}`;
      if (seen.has(key)) {
        console.log(`[OCR] 중복 항목 제거: ${item.shortName} (qty=${item.quantity}, price=${item.unitPrice})`);
        return false;
      }
      seen.add(key);
      return true;
    });

    // ── 거래처 품목 매칭 (기존 DB와 단가 비교) ──────────────────────────
    const counterpartyName = parsed.counterpartyName || null;
    const cpId = clientCpId ? Number(clientCpId)
      : await findCounterpartyId(counterpartyName, restaurantId ? Number(restaurantId) : undefined);
    items = await matchCounterpartyItems(cpId, items);

    // ── 거래처 후보 매칭 (사용자가 미선택 + 자동매칭 실패 시) ──────────
    let counterpartyCandidates: { id: number; name: string; score: number }[] = [];
    if (!clientCpId && !cpId && counterpartyName && restaurantId) {
      counterpartyCandidates = await findCounterpartyCandidates(counterpartyName, Number(restaurantId));
    }

    // ── 품목 후보 매칭 (기존 품목 DB와 유사도 비교) ──────────────────
    const rId = restaurantId ? Number(restaurantId) : 0;
    if (rId > 0) {
      items = await findItemCandidates(rId, cpId || (counterpartyCandidates[0]?.id ?? null), items);
    }

    // ── 거래처 OCR 프로파일 자동 업데이트 (학습) ───────────────────────
    updateOcrProfile(cpId, parsed.documentType || null, items).catch(() => {});

    // ── 합계 정합 검증 + 산술 자동보정 ─────────────────────────────────
    const totals = reconcileTotals(items, parsed.summary || null);
    if (totals.status !== "match" && totals.status !== "no_doc_total") {
      console.log(`[OCR] 합계 정합: status=${totals.status}, doc=${totals.docGrand}, items=${totals.itemSum}, diff=${totals.diff}, fixes=${totals.fixes.join(" / ")}`);
    }

    // ── 거래처 정보는 클라이언트에서 확인 후 별도 API로 업데이트 ──────
    const cpInfo = parsed.counterpartyInfo || {};

    const result = {
      counterpartyName,
      counterpartyId: cpId,
      counterpartyCandidates: counterpartyCandidates.length > 0 ? counterpartyCandidates : undefined,
      transactionDate: parsed.transactionDate || null,
      counterpartyInfo: cpInfo.contactName || cpInfo.contactPhone ? cpInfo : null,
      items,
      totals,
      note: parsed.note || null,
    };

    // API 사용량 로깅 (성공)
    logOcrApiUsage({
      endpoint: `extract-purchase:${hybridOut.engine}`,
      restaurantId: restaurantId ? Number(restaurantId) : undefined,
      responseTimeMs: ocrElapsed,
      success: true,
      inputTokens, outputTokens,
      model: hybridOut.claude.model,
      itemCount: items.length,
      timingBreakdown: `pre=${ocrStartTime - preStart},upstage=${hybridOut.upstage?.elapsedMs ?? 0},claude=${hybridOut.claude.elapsedMs}`,
    });

    res.json(result);
  } catch (err: any) {
    console.error("[OCR] extract-purchase error:", err);
    await logOcrError(`OCR 처리 오류: ${err.message}`, {
      stack: err.stack?.substring(0, 1000),
      imageUrl: req.body?.imageUrl,
    }, req.body?.restaurantId ? Number(req.body.restaurantId) : undefined);
    const isRateLimited = err?.status === 429 || err?.response?.status === 429;
    res.status(500).json({
      error: `OCR 처리 중 오류가 발생했습니다.`,
      retryable: true,
      reason: isRateLimited ? "rate_limited" : "upstream_error",
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/ocr/reanalyze-purchase — 합계 불일치 시 사용자 클릭 재분석 (2차 시도)
// Upstage는 캐시 재사용(미스 시에만 1회 재호출), Claude 텍스트 단계만 재실행.
// 자동 재시도(MAX_OCR_AUTO_RETRY) 경로와 완전 분리 — 사용자 명시 클릭 전용.
// ═════════════════════════════════════════════════════════════════════════════
ocrRouter.post("/reanalyze-purchase", async (req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    const anthropic = getAnthropicClient();
    if (!anthropic) {
      res.status(500).json({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." });
      return;
    }

    const { imageUrl, restaurantId, counterpartyId: clientCpId, docTotal, itemSum: prevItemSum, previousItems } = req.body;
    if (!imageUrl || typeof imageUrl !== "string") {
      res.status(400).json({ error: "imageUrl이 필요합니다" });
      return;
    }

    // ── Upstage 결과: 캐시 우선, 미스 시에만 재호출 ────────────────────
    let parsed = upstageCacheGet(imageUrl);
    let upstageElapsed = 0;
    if (!parsed) {
      const relativePath = imageUrl.replace(/^\/uploads\//, "");
      const filePath = path.join(UPLOAD_ROOT, relativePath);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: "이미지 파일을 찾을 수 없습니다" });
        return;
      }
      console.log(`[OCR] 재분석 캐시 미스 — Upstage 재호출: ${imageUrl}`);
      const fresh = await runUpstageStage(filePath);
      if (!fresh.ok) {
        res.status(500).json({
          error: "재분석을 위한 문서 파싱에 실패했습니다. 잠시 후 다시 시도해주세요.",
          retryable: true,
          reason: fresh.status === 429 ? "rate_limited" : "upstream_error",
        });
        return;
      }
      parsed = fresh;
      upstageElapsed = fresh.elapsedMs;
      upstageCacheSet(imageUrl, fresh);
    } else {
      console.log(`[OCR] 재분석 캐시 적중 — Upstage 호출 생략: ${imageUrl}`);
    }

    const cpId = clientCpId ? Number(clientCpId) : null;
    const profile = await getOcrProfile(cpId);
    const profileHint = buildProfileHint(profile);

    // ── 1차 결과 요약을 correctionNote로 주입 ──────────────────────────
    const docTotalNum = Math.round(parseFloat(String(docTotal ?? "").replace(/,/g, "")) || 0);
    const prevSumNum = Math.round(parseFloat(String(prevItemSum ?? "").replace(/,/g, "")) || 0);
    const prevLines = Array.isArray(previousItems)
      ? previousItems.slice(0, 60).map((it: any) =>
          `- ${String(it.rawItemName || it.shortName || it.name || "?")} ${it.quantity || "?"}×${it.unitPrice || "?"}=${it.lineTotal || "?"}`
        ).join("\n")
      : "(없음)";
    const correctionNote = `## 재검증 요청 (2차 시도)
1차 추출 결과가 문서 합계와 ${(prevSumNum - docTotalNum).toLocaleString()}원 불일치했습니다.
- 문서에 적힌 합계: ${docTotalNum.toLocaleString()}원
- 1차 추출 항목 합산: ${prevSumNum.toLocaleString()}원
- 1차 결과(참고):
${prevLines}

다음을 이 순서로 재점검하세요:
1. 긴 품목명이 두 행으로 쪼개져 항목이 중복 계상되지 않았는가 (H6)
2. 누락된 행이 없는가 (특히 표의 첫 행/마지막 행, 페이지 경계)
3. 자릿수 오독은 없는가 (0 개수, 콤마 위치)
4. 부가세를 빠뜨렸거나 이중으로 더하지 않았는가

출력 직전에 반드시 Σ lineTotal 을 계산해 문서 합계와 비교하고,
그래도 맞지 않으면 어느 행이 의심스러운지 note에 한글로 적으세요.`;

    const deps: HybridDeps = {
      anthropic,
      buildProfileHint,
      getOcrProfile,
      promptV2Template: promptV2,
      promptV1ImageFallback,
      loadImageBase64Raw,
      extractText,
      parseAIJson,
    };
    const out = await runClaudeTextStage(parsed, profileHint, deps, { correctionNote });
    const parsedJson = out.rawJson;
    const elapsed = Date.now() - startedAt;

    if (!parsedJson) {
      logOcrApiUsage({ endpoint: "reanalyze-purchase", restaurantId: restaurantId ? Number(restaurantId) : undefined, responseTimeMs: elapsed, success: false, errorMessage: "AI 응답 파싱 실패", inputTokens: out.claude.inputTokens, outputTokens: out.claude.outputTokens, model: out.claude.model });
      res.status(500).json({ error: "AI 응답을 처리하지 못했습니다. 다시 시도해주세요.", retryable: true, reason: "parse_failed" });
      return;
    }

    // ── extract-purchase와 동일한 후처리 (거래처 후보/프로파일 갱신은 생략) ──
    let items = validateAndEnrichItems(
      mergeWrappedNameRows(Array.isArray(parsedJson.items) ? parsedJson.items : []),
      parsedJson.summary || null
    );
    items = items.filter((item) => {
      if (!item.shortName.trim()) return false;
      const lowerName = item.shortName.trim().toLowerCase();
      if (/^(합계|소계|총합|total|subtotal|합\s*계)$/i.test(lowerName)) return false;
      return true;
    });
    const seen = new Set<string>();
    items = items.filter((item) => {
      const key = `${item.shortName}|${item.quantity}|${item.unitPrice}|${item.lineTotal}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    items = await matchCounterpartyItems(cpId, items);
    const rId = restaurantId ? Number(restaurantId) : 0;
    if (rId > 0) {
      items = await findItemCandidates(rId, cpId, items);
    }

    const totals = reconcileTotals(items, parsedJson.summary || null);
    console.log(`[OCR] 재분석 결과: status=${totals.status}, doc=${totals.docGrand}, items=${totals.itemSum}, diff=${totals.diff}`);

    logOcrApiUsage({
      endpoint: "reanalyze-purchase",
      restaurantId: restaurantId ? Number(restaurantId) : undefined,
      responseTimeMs: elapsed,
      success: true,
      inputTokens: out.claude.inputTokens,
      outputTokens: out.claude.outputTokens,
      model: out.claude.model,
      itemCount: items.length,
      timingBreakdown: `upstage=${upstageElapsed},claude=${out.claude.elapsedMs}`,
    });

    res.json({
      counterpartyName: parsedJson.counterpartyName || null,
      counterpartyId: cpId,
      transactionDate: parsedJson.transactionDate || null,
      counterpartyInfo: null,
      items,
      totals,
      note: parsedJson.note || null,
    });
  } catch (err: any) {
    console.error("[OCR] reanalyze-purchase error:", err);
    await logOcrError(`OCR 재분석 오류: ${err.message}`, {
      stack: err.stack?.substring(0, 1000),
      imageUrl: req.body?.imageUrl,
    }, req.body?.restaurantId ? Number(req.body.restaurantId) : undefined);
    const isRateLimited = err?.status === 429 || err?.response?.status === 429;
    res.status(500).json({
      error: "OCR 재분석 중 오류가 발생했습니다.",
      retryable: true,
      reason: isRateLimited ? "rate_limited" : "upstream_error",
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/ocr/extract-statement — 월매입정산표(거래원장) OCR
// 거래처가 발행한 한 달치 매입 정산표를 OCR로 읽어 구조화된 JSON으로 반환.
// 비교 알고리즘은 settlementStatements 라우터에서 별도 처리.
// ═════════════════════════════════════════════════════════════════════════════
ocrRouter.post("/extract-statement", async (req: Request, res: Response) => {
  const ocrStartTime = Date.now();
  try {
    const anthropic = getAnthropicClient();
    if (!anthropic) {
      res.status(500).json({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." });
      return;
    }

    const { imageUrls, spreadsheetText, restaurantId, hintCounterpartyId, hintYearMonth } = req.body;
    const urls: string[] = Array.isArray(imageUrls) ? imageUrls
      : (typeof imageUrls === "string" ? [imageUrls] : []);
    const sheetText = typeof spreadsheetText === "string" ? spreadsheetText.trim() : "";

    if (urls.length === 0 && !sheetText) {
      res.status(400).json({ error: "imageUrls 또는 spreadsheetText 중 하나가 필요합니다" });
      return;
    }
    // 입력 모드 결정 (둘 다 오면 image 우선)
    const inputMode: "image" | "spreadsheet" = urls.length > 0 ? "image" : "spreadsheet";

    // ── 이미지/PDF 모드: 파일 검증 + (이미지만) EXIF 회전 + 전처리 ──
    // PDF는 sharp 전처리 없이 base64로 그대로 Anthropic document 블록에 전달.
    const fileBlocks: any[] = [];
    if (inputMode === "image") {
      for (const url of urls) {
        const relativePath = url.replace(/^\/uploads\//, "");
        const filePath = path.join(UPLOAD_ROOT, relativePath);
        if (!fs.existsSync(filePath)) {
          res.status(404).json({ error: `파일을 찾을 수 없습니다: ${url}` });
          return;
        }

        const isPdf = filePath.toLowerCase().endsWith(".pdf");
        if (isPdf) {
          // PDF는 그대로 document block으로 전달 — Anthropic이 페이지별 OCR 처리
          const pdfBuf = fs.readFileSync(filePath);
          fileBlocks.push({
            type: "document" as const,
            source: { type: "base64" as const, media_type: "application/pdf", data: pdfBuf.toString("base64") },
          });
          continue;
        }

        await fixExifOrientation(filePath);

        // 정산표는 길고 텍스트 위주 → 해상도 3500, 그레이+대비+샤프 (extract-purchase와 동일 v9)
        await preprocessImageForOcr(filePath, "[OCR-Statement]");

        const { base64, mediaType } = loadImageBase64Raw(filePath);
        fileBlocks.push({
          type: "image" as const,
          source: { type: "base64" as const, media_type: mediaType, data: base64 },
        });
      }
    }

    // ── 거래처 프로파일 힌트 ─────────────────────────────────────────────
    const hintCpId = hintCounterpartyId ? Number(hintCounterpartyId) : null;
    const profile = await getOcrProfile(hintCpId);
    const profileHint = buildProfileHint(profile);

    // ── 정산표 전용 프롬프트 ─────────────────────────────────────────────
    const promptText = `이 이미지(들)는 거래처가 발행한 **월매입정산표(거래원장)**입니다.
하나의 거래처와 하나의 매장 사이의 한 달치 거래내역이 표 형태로 나열되어 있습니다.

## 🚨 최우선 규칙 (위반 금지)

1. **모든 거래 라인을 빠짐없이 추출.** 행 수가 100개를 넘어도 전부 items 배열에 담아라.
2. **요약·생략·축약 금지.** "...나머지 동일", "이하 생략", "총 N건" 같은 메타 표현으로 라인을 대체하지 마라.
3. **footer/합계행에서 읽은 salesTotal과 items의 lineTotal 합이 일치해야 한다.**
   - 일치하지 않으면 items 일부가 누락된 것이므로 누락된 라인을 다시 찾아 추가하라.
   - 추출 직전에 \`Σ items.lineTotal\` 계산 후 monthlySummary.salesTotal과 검증.
4. **합계행은 절대 items에 포함하지 마라.** 키워드: "계", "일계", "월 계", "거래처계", "합계", "소계", "총합", "전월이월", "당월잔액", "Total", "Subtotal".
   - 이 행들의 금액은 monthlySummary로만 사용.

## 입력 형식별 레이아웃

### PDF 거래원장
- 페이지 레이아웃은 일반적으로 \`[전월이월][일자별 거래라인들][일계][...반복][총합계]\`.
- 페이지 경계에서 라인이 잘리지 않도록 모든 페이지를 끝까지 스캔.
- "전월이월" / "당월잔액" 행은 items 제외, monthlySummary.balance 후보.

### Excel/CSV 표 데이터
- 표 텍스트의 모든 행을 검사. 합계행 키워드(위 4번)에 매칭되는 행만 monthlySummary로 분리.
- 셀 분할이 명확하므로 일자/품목/수량/단가/합계 컬럼을 정확히 매핑.

### 다중 이미지
이미지가 여러 장이면 같은 정산표의 연속된 페이지로 간주하고 모든 페이지의 거래라인을 하나의 items 배열로 합쳐.

## 추출 규칙

### 1. 헤더
- counterpartyName: 거래처(공급자/판매자) 회사명. **매장명이 아님 — 발행처(공급사)만**
- counterpartyBusinessNumber: 사업자등록번호 (있으면)
- yearMonth: 정산 대상 연월 (YYYY-MM 형식). 헤더의 "2024년 4월" 같은 텍스트 또는 거래일자 다수에서 추론.

### 2. 거래 라인 (items 배열)
각 행은 **일자 + 품목 + (수량) + (단가) + 합계금액**의 4~6요소.

- date: YYYY-MM-DD (헤더 연월과 일자 합성)
- rawItemName: 적요/품목/내역 컬럼의 **원문 그대로**
- itemName: 정규화된 품목명 (예: "삼겹살(국내산) [1kg]" → "삼겹살")
- spec: 규격/단위 정보 (예: "1kg", "박스", "20kg"). 없으면 null
- quantity: 숫자만. 정수형이면 정수, 소수면 소수. 없으면 null
- unitPrice: 단가 (원). 없으면 null
- lineTotal: 그 행의 거래 금액 (원). **반드시 추출** — 정산표에서 가장 중요한 값
- taxType: "taxable"(과세) | "exempt"(면세) | "unknown" — 양식에 명시(과/면, V/X)되어 있으면 그대로, 없으면 unknown
- uncertain: 판독 자신없는 행이면 true
- confidence: 0~1 사이 추정 신뢰도

### 3. 양식 다양성 처리
- "판매" / "수금" / "잔액" 컬럼이 분리된 양식이면 → **판매(매출) 행만 items로**, 수금은 monthlySummary.paymentTotal 합산.
- 적요란이 \`삼겹살(국내산) [1kg] / 6 * 12,000\` 형식이면 itemName/spec/quantity/unitPrice를 분해.
- 한 일자에 여러 품목 행이 있으면 모두 추출 (일자 칼럼이 비어 있어도 직전 일자 상속).
- "반품", "환입" 라인은 lineTotal을 음수로(-)하여 items에 포함.

### 4. 월간 요약 (monthlySummary)
- salesTotal: 월 판매(거래) 합계. footer/합계행에서 명시된 값 그대로 추출. **null로 두지 말고 반드시 찾을 것** — 합계행이 보이지 않으면 마지막 페이지 끝까지 스캔.
- paymentTotal: 월 수금 합계 (있으면)
- balance: 잔액/미수금 (있으면)

## 출력 형식 (JSON만, 마크다운 코드펜스 없이)

\`\`\`json
{
  "counterpartyName": "거래처명",
  "counterpartyBusinessNumber": "123-45-67890" | null,
  "yearMonth": "YYYY-MM",
  "documentType": "양식 유형 추정 (예: '거래원장', '월정산서', 'Ecount')",
  "items": [
    {
      "date": "YYYY-MM-DD",
      "rawItemName": "...",
      "itemName": "...",
      "spec": "..." | null,
      "quantity": 6 | null,
      "unitPrice": 12000 | null,
      "lineTotal": 72000,
      "taxType": "taxable" | "exempt" | "unknown",
      "uncertain": false,
      "confidence": 0.95
    }
  ],
  "monthlySummary": {
    "salesTotal": 1234567 | null,
    "paymentTotal": 1000000 | null,
    "balance": 234567 | null
  }
}
\`\`\`

${hintYearMonth ? `\n참고: 사용자가 ${hintYearMonth} 정산표라고 알려주었습니다.` : ""}
${profileHint}`;

    // ── Claude 호출 (이미지/PDF 모드: Vision+Document / 스프레드시트 모드: 텍스트) ────
    const messageContent: any[] = inputMode === "image" ? [...fileBlocks] : [];

    if (inputMode === "spreadsheet") {
      messageContent.push({
        type: "text",
        text: `다음은 거래처가 발행한 월매입정산표를 Excel/CSV에서 추출한 표 데이터입니다 (SheetJS dump). 이 표를 정산표 이미지와 동일한 규칙으로 분석해 JSON으로 변환해주세요.\n\n\`\`\`\n${sheetText}\n\`\`\`\n`,
      });
    }
    messageContent.push({ type: "text", text: promptText });

    // 정산표는 항목 수가 많을 수 있음 (100~200건도 흔함). STATEMENT_MAX_TOKENS(32768) 미만이면
    // ~40항목에서 truncate됨. claude-sonnet-4는 64K까지 지원.
    // ⚠️ Anthropic SDK는 max_tokens가 크면 non-streaming 요청을 거부함 (예상 처리시간 >10분).
    //    streaming으로 호출 후 finalMessage()로 한 번에 받음 (인터페이스는 동일).
    const { parsed: claudeParsed, rawText: text, inputTokens, outputTokens, elapsedMs: claudeMs } = await callClaudeJson({
      anthropic,
      model: OCR_MODELS.statement,
      maxTokens: STATEMENT_MAX_TOKENS,
      content: messageContent,
      stream: true,
    });
    const ocrElapsed = Date.now() - ocrStartTime;

    if (!text) {
      logOcrApiUsage({ endpoint: "extract-statement", restaurantId: restaurantId ? Number(restaurantId) : undefined, responseTimeMs: ocrElapsed, success: false, errorMessage: "AI 응답 비어있음", inputTokens, outputTokens, model: OCR_MODELS.statement });
      res.status(500).json({ error: "AI 응답이 비어있습니다", retryable: true });
      return;
    }

    if (!claudeParsed) {
      logOcrApiUsage({ endpoint: "extract-statement", restaurantId: restaurantId ? Number(restaurantId) : undefined, responseTimeMs: ocrElapsed, success: false, errorMessage: "JSON 파싱 실패", inputTokens, outputTokens, model: OCR_MODELS.statement });
      res.status(500).json({ error: "AI 응답을 처리하지 못했습니다. 다시 시도해주세요.", retryable: true, rawText: text.slice(0, 500) });
      return;
    }
    const parsed: any = claudeParsed;

    // ── 항목 정규화 + 검증 ───────────────────────────────────────────────
    const rawItems: any[] = Array.isArray(parsed.items) ? parsed.items : [];
    const normalizedItems = rawItems.map((it) => {
      const lineTotal = Number(String(it.lineTotal ?? "").replace(/,/g, "")) || 0;
      const quantity = it.quantity !== null && it.quantity !== undefined && it.quantity !== ""
        ? Number(String(it.quantity).replace(/,/g, "")) : null;
      const unitPrice = it.unitPrice !== null && it.unitPrice !== undefined && it.unitPrice !== ""
        ? Number(String(it.unitPrice).replace(/,/g, "")) : null;

      // 합계 검증: quantity × unitPrice ≈ lineTotal (둘 다 있고 lineTotal>0인 경우)
      let uncertain = !!it.uncertain;
      if (quantity && unitPrice && lineTotal > 0) {
        const calculated = Math.round(quantity * unitPrice);
        const diff = Math.abs(lineTotal - calculated);
        if (diff > 1 && diff / Math.max(lineTotal, calculated) > 0.05) {
          // 5% 이상 차이 — 부가세 분리 가능성 등. 일단 lineTotal을 신뢰
          uncertain = true;
        }
      }

      return {
        date: String(it.date || ""),
        rawItemName: String(it.rawItemName || it.itemName || ""),
        itemName: String(it.itemName || it.rawItemName || "").trim(),
        spec: it.spec ? String(it.spec) : null,
        quantity,
        unitPrice,
        lineTotal,
        taxType: ["taxable", "exempt", "unknown"].includes(it.taxType) ? it.taxType : "unknown",
        uncertain,
        confidence: typeof it.confidence === "number" ? it.confidence : 0.8,
      };
    }).filter((it) => {
      // 빈 항목, 합계행 잔재 제거
      if (!it.itemName && !it.rawItemName) return false;
      const lower = it.rawItemName.trim().toLowerCase();
      if (/^(합계|소계|총합|월계|거래처계|이월|잔액|total|subtotal)$/i.test(lower)) return false;
      return true;
    });

    // ── 거래처 매칭 ──────────────────────────────────────────────────────
    const counterpartyName = parsed.counterpartyName || null;
    const cpId = hintCpId
      || (counterpartyName && restaurantId
            ? await findCounterpartyId(counterpartyName, Number(restaurantId))
            : null);

    // ── 거래처 후보 (자동매칭 실패 시) ───────────────────────────────────
    let counterpartyCandidates: { id: number; name: string; score: number }[] = [];
    if (!hintCpId && !cpId && counterpartyName && restaurantId) {
      counterpartyCandidates = await findCounterpartyCandidates(counterpartyName, Number(restaurantId));
    }

    // ── 월계 요약 ────────────────────────────────────────────────────────
    const monthlySummary = parsed.monthlySummary || {};
    const result = {
      counterpartyName,
      counterpartyId: cpId,
      counterpartyBusinessNumber: parsed.counterpartyBusinessNumber || null,
      counterpartyCandidates: counterpartyCandidates.length > 0 ? counterpartyCandidates : undefined,
      yearMonth: parsed.yearMonth || hintYearMonth || null,
      documentType: parsed.documentType || null,
      items: normalizedItems,
      monthlySummary: {
        salesTotal: monthlySummary.salesTotal != null ? Number(String(monthlySummary.salesTotal).replace(/,/g, "")) : null,
        paymentTotal: monthlySummary.paymentTotal != null ? Number(String(monthlySummary.paymentTotal).replace(/,/g, "")) : null,
        balance: monthlySummary.balance != null ? Number(String(monthlySummary.balance).replace(/,/g, "")) : null,
      },
      rawText: text,
    };

    logOcrApiUsage({
      endpoint: "extract-statement",
      restaurantId: restaurantId ? Number(restaurantId) : undefined,
      responseTimeMs: ocrElapsed,
      success: true,
      inputTokens, outputTokens,
      model: OCR_MODELS.statement,
      itemCount: normalizedItems.length,
      timingBreakdown: `claude=${claudeMs}`,
    });

    res.json(result);
  } catch (err: any) {
    console.error("[OCR] extract-statement error:", err);
    await logOcrError(`정산표 OCR 오류: ${err.message}`, {
      stack: err.stack?.substring(0, 1000),
      imageUrls: req.body?.imageUrls,
    }, req.body?.restaurantId ? Number(req.body.restaurantId) : undefined);
    logOcrApiUsage({
      endpoint: "extract-statement",
      restaurantId: req.body?.restaurantId ? Number(req.body.restaurantId) : undefined,
      responseTimeMs: Date.now() - ocrStartTime,
      success: false,
      errorMessage: err.message,
    });
    res.status(500).json({ error: "정산표 OCR 처리 중 오류가 발생했습니다.", retryable: true });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/ocr/extract-health-cert — 보건증 판독 (haiku로 변경)
// ═════════════════════════════════════════════════════════════════════════════
ocrRouter.post("/extract-health-cert", async (req: Request, res: Response) => {
  try {
    const anthropic = getAnthropicClient();
    if (!anthropic) {
      res.status(500).json({ error: "ANTHROPIC_API_KEY 미설정" });
      return;
    }

    const { imageUrl } = req.body;
    if (!imageUrl || typeof imageUrl !== "string") {
      res.status(400).json({ error: "imageUrl이 필요합니다" });
      return;
    }

    const relativePath = imageUrl.replace(/^\/uploads\//, "");
    const filePath = path.join(UPLOAD_ROOT, relativePath);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "이미지 파일을 찾을 수 없습니다" });
      return;
    }

    const { base64, mediaType } = loadImageBase64Raw(filePath);

    // 보건증은 단순 구조 — 항목 수 적음, 1024 토큰으로 충분
    const { parsed, rawText: text } = await callClaudeJson({
      anthropic,
      model: OCR_MODELS.healthCert,
      maxTokens: HEALTH_CERT_MAX_TOKENS,
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: mediaType as any, data: base64 },
        },
        {
          type: "text",
          text: `이 이미지는 보건증(건강진단결과서)입니다.
다음 정보를 추출해주세요:
- 성명
- 유효기간 종료일 (보건증은 보통 발급일로부터 1년)

반드시 아래 JSON 형식만 반환하세요. 마크다운 코드블록으로 감싸지 마세요:
{
  "name": "성명",
  "issueDate": "발급일 YYYY-MM-DD 또는 null",
  "expiryDate": "유효기간 종료일 YYYY-MM-DD"
}

유효기간 종료일이 명시되어 있지 않으면 발급일 + 1년으로 계산하세요.
발급일도 없으면 expiryDate를 null로 반환하세요.`,
        },
      ],
    });

    if (!text) {
      res.status(500).json({ error: "AI 응답 없음" });
      return;
    }
    if (!parsed) {
      // callClaudeJson은 파싱 실패를 throw하지 않으므로 기존 동작(파싱 예외 → 외부 catch) 보존을 위해 직접 throw
      throw new Error("JSON 파싱 불가");
    }

    res.json({
      name: parsed.name || null,
      issueDate: parsed.issueDate || null,
      expiryDate: parsed.expiryDate || null,
    });
  } catch (err: any) {
    console.error("[OCR] extract-health-cert error:", err);
    res.status(500).json({ error: `보건증 분석 오류: ${err.message}` });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/ocr/update-counterparty-info — 사용자 확인 후 거래처 정보 반영
// ═════════════════════════════════════════════════════════════════════════════
ocrRouter.post("/update-counterparty-info", async (req: Request, res: Response) => {
  try {
    const { counterpartyId, contactName, contactPhone } = req.body;
    if (!counterpartyId) {
      res.status(400).json({ error: "counterpartyId 필요" });
      return;
    }
    await updateCounterpartyInfo(Number(counterpartyId), { contactName, contactPhone });
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[OCR] update-counterparty-info error:", err);
    res.json({ ok: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/ocr/submit-correction — 사용자 수정 데이터 축적 (Phase 3-2)
// ═════════════════════════════════════════════════════════════════════════════
ocrRouter.post("/submit-correction", async (req: Request, res: Response) => {
  try {
    const { restaurantId, counterpartyId, imageUrl, originalItems, correctedItems } = req.body;
    if (!restaurantId || !imageUrl || !correctedItems) {
      res.status(400).json({ error: "필수 데이터 누락" });
      return;
    }

    // ocr_corrections 테이블에 저장
    const mysql2 = await import("mysql2/promise");
    const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
    try {
      await conn.query(
        `INSERT INTO ocr_corrections (restaurantId, counterpartyId, imageUrl, originalItems, correctedItems, createdAt)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [
          restaurantId,
          counterpartyId || null,
          imageUrl,
          JSON.stringify(originalItems || []),
          JSON.stringify(correctedItems),
        ]
      );
      res.json({ ok: true });
    } finally {
      await conn.end();
    }
  } catch (err: any) {
    console.error("[OCR] submit-correction error:", err);
    // 비치명적 — 수정 데이터 저장 실패해도 정상 동작
    res.json({ ok: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/ocr/corrections — OCR 수정 이력 조회 (master/admin용)
// ═════════════════════════════════════════════════════════════════════════════
ocrRouter.get("/corrections", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const restaurantId = req.query.restaurantId ? Number(req.query.restaurantId) : undefined;

    const conditions = restaurantId
      ? eq(ocrCorrections.restaurantId, restaurantId)
      : undefined;

    const rows = await db.select().from(ocrCorrections)
      .where(conditions)
      .orderBy(desc(ocrCorrections.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ corrections: rows, count: rows.length });
  } catch (err: any) {
    console.error("[OCR] corrections list error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/ocr/corrections/stats — OCR 수정 통계 (거래처별 수정 빈도)
// ═════════════════════════════════════════════════════════════════════════════
ocrRouter.get("/corrections/stats", async (req: Request, res: Response) => {
  try {
    const restaurantId = req.query.restaurantId ? Number(req.query.restaurantId) : undefined;

    // 거래처별 수정 건수
    const conditions = restaurantId
      ? eq(ocrCorrections.restaurantId, restaurantId)
      : undefined;

    const stats = await db.select({
      counterpartyId: ocrCorrections.counterpartyId,
      correctionCount: sql<number>`COUNT(*)`,
      lastCorrectedAt: sql<string>`MAX(${ocrCorrections.createdAt})`,
    }).from(ocrCorrections)
      .where(conditions)
      .groupBy(ocrCorrections.counterpartyId)
      .orderBy(sql`COUNT(*) DESC`);

    // 거래처명 매핑
    const counterpartyIds = stats.map(s => s.counterpartyId).filter(Boolean) as number[];
    let counterpartyMap: Record<number, string> = {};
    if (counterpartyIds.length > 0) {
      const cps = await db.select({ id: counterparties.id, name: counterparties.name })
        .from(counterparties)
        .where(sql`${counterparties.id} IN (${sql.join(counterpartyIds.map(id => sql`${id}`), sql`, `)})`);
      counterpartyMap = Object.fromEntries(cps.map(c => [c.id, c.name]));
    }

    // OCR 프로파일 정보
    const profiles = await db.select().from(counterpartyOcrProfiles);

    const total = stats.reduce((sum, s) => sum + Number(s.correctionCount), 0);

    res.json({
      totalCorrections: total,
      byCounterparty: stats.map(s => ({
        counterpartyId: s.counterpartyId,
        counterpartyName: s.counterpartyId ? counterpartyMap[s.counterpartyId] ?? "알 수 없음" : "미지정",
        correctionCount: Number(s.correctionCount),
        lastCorrectedAt: s.lastCorrectedAt,
      })),
      profileCount: profiles.length,
      profiles: profiles.map(p => ({
        counterpartyId: p.counterpartyId,
        documentType: p.documentType,
        sampleCount: p.sampleCount,
        frequentItemCount: Array.isArray(p.frequentItems) ? (p.frequentItems as any[]).length : 0,
        lastUsedAt: p.lastUsedAt,
      })),
    });
  } catch (err: any) {
    console.error("[OCR] corrections stats error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/ocr/tracking — OCR 트래킹 종합 대시보드 데이터
// ═════════════════════════════════════════════════════════════════════════════
ocrRouter.get("/tracking", async (req: Request, res: Response) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 90);
    const since = new Date();
    since.setDate(since.getDate() - days);

    // 1) OCR API 호출 통계 (api_usage_logs where apiType='ocr')
    const apiStats = await db.select({
      totalCalls: sql<number>`COUNT(*)`,
      successCount: sql<number>`SUM(CASE WHEN ${apiUsageLogs.success} = TRUE THEN 1 ELSE 0 END)`,
      failCount: sql<number>`SUM(CASE WHEN ${apiUsageLogs.success} = FALSE THEN 1 ELSE 0 END)`,
      avgResponseMs: sql<number>`ROUND(AVG(${apiUsageLogs.responseTimeMs}))`,
      maxResponseMs: sql<number>`MAX(${apiUsageLogs.responseTimeMs})`,
      totalPayloadBytes: sql<number>`COALESCE(SUM(${apiUsageLogs.requestPayloadSize}), 0)`,
    }).from(apiUsageLogs)
      .where(and(
        eq(apiUsageLogs.apiType, "ocr"),
        gte(apiUsageLogs.createdAt, since),
      ));

    // 2) 일별 호출 추이
    const dailyCalls = await db.select({
      date: sql<string>`DATE(${apiUsageLogs.createdAt})`,
      calls: sql<number>`COUNT(*)`,
      successCount: sql<number>`SUM(CASE WHEN ${apiUsageLogs.success} = TRUE THEN 1 ELSE 0 END)`,
      failCount: sql<number>`SUM(CASE WHEN ${apiUsageLogs.success} = FALSE THEN 1 ELSE 0 END)`,
      avgMs: sql<number>`ROUND(AVG(${apiUsageLogs.responseTimeMs}))`,
    }).from(apiUsageLogs)
      .where(and(
        eq(apiUsageLogs.apiType, "ocr"),
        gte(apiUsageLogs.createdAt, since),
      ))
      .groupBy(sql`DATE(${apiUsageLogs.createdAt})`)
      .orderBy(sql`DATE(${apiUsageLogs.createdAt})`);

    // 3) OCR 에러 로그 (최근 건 + 에러 유형 분포)
    const ocrErrors = await db.select({
      id: errorLogs.id,
      message: errorLogs.message,
      metadata: errorLogs.metadata,
      restaurantId: errorLogs.restaurantId,
      createdAt: errorLogs.createdAt,
    }).from(errorLogs)
      .where(and(
        eq(errorLogs.errorType, "ocr"),
        gte(errorLogs.createdAt, since),
      ))
      .orderBy(desc(errorLogs.createdAt))
      .limit(30);

    const totalOcrErrors = await db.select({
      count: sql<number>`COUNT(*)`,
    }).from(errorLogs)
      .where(and(
        eq(errorLogs.errorType, "ocr"),
        gte(errorLogs.createdAt, since),
      ));

    // 4) OCR 수정 통계
    const correctionStats = await db.select({
      totalCorrections: sql<number>`COUNT(*)`,
    }).from(ocrCorrections)
      .where(gte(ocrCorrections.createdAt, since));

    // 5) 프로파일 수
    const profileRows = await db.select({
      count: sql<number>`COUNT(*)`,
    }).from(counterpartyOcrProfiles);

    // 6) 비용 추정 (Sonnet 기준)
    // Input: ~$3/1M tokens, Output: ~$15/1M tokens
    // 대략 1회당 input 8000 tokens, output 1200 tokens → $0.042
    const totalCalls = Number(apiStats[0]?.totalCalls) || 0;
    const estimatedCost = totalCalls * 0.042;

    res.json({
      period: { days, since: since.toISOString() },
      api: {
        totalCalls,
        successCount: Number(apiStats[0]?.successCount) || 0,
        failCount: Number(apiStats[0]?.failCount) || 0,
        successRate: totalCalls > 0 ? Math.round((Number(apiStats[0]?.successCount) || 0) / totalCalls * 100) : 0,
        avgResponseMs: Number(apiStats[0]?.avgResponseMs) || 0,
        maxResponseMs: Number(apiStats[0]?.maxResponseMs) || 0,
        totalPayloadMB: ((Number(apiStats[0]?.totalPayloadBytes) || 0) / 1048576).toFixed(1),
      },
      cost: {
        estimatedUsd: estimatedCost.toFixed(2),
        estimatedKrw: Math.round(estimatedCost * 1350),
        perCallUsd: "0.042",
        model: "claude-sonnet-4-6",
      },
      daily: dailyCalls.map(d => ({
        date: d.date,
        calls: Number(d.calls),
        success: Number(d.successCount),
        fail: Number(d.failCount),
        avgMs: Number(d.avgMs),
      })),
      errors: {
        total: Number(totalOcrErrors[0]?.count) || 0,
        recent: ocrErrors.map(e => ({
          id: e.id,
          message: e.message,
          restaurantId: e.restaurantId,
          createdAt: e.createdAt,
          metadata: e.metadata,
        })),
      },
      corrections: {
        total: Number(correctionStats[0]?.totalCorrections) || 0,
      },
      profiles: {
        total: Number(profileRows[0]?.count) || 0,
      },
    });
  } catch (err: any) {
    console.error("[OCR] tracking error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 학습 데이터셋 내보내기 (master 전용)
// ============================================================

// 1) OCR 수정 데이터셋: 원본 OCR → 사람이 수정한 값 쌍
ocrRouter.get("/export-dataset/corrections", async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: ocrCorrections.id,
        restaurantId: ocrCorrections.restaurantId,
        counterpartyId: ocrCorrections.counterpartyId,
        counterpartyName: counterparties.name,
        imageUrl: ocrCorrections.imageUrl,
        originalItems: ocrCorrections.originalItems,
        correctedItems: ocrCorrections.correctedItems,
        createdAt: ocrCorrections.createdAt,
      })
      .from(ocrCorrections)
      .leftJoin(counterparties, eq(ocrCorrections.counterpartyId, counterparties.id))
      .orderBy(desc(ocrCorrections.createdAt));

    const dataset = rows.map((r) => ({
      id: r.id,
      restaurantId: r.restaurantId,
      counterparty: { id: r.counterpartyId, name: r.counterpartyName },
      imageUrl: r.imageUrl,
      original: r.originalItems,
      corrected: r.correctedItems,
      createdAt: r.createdAt,
    }));

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ocr-corrections-dataset-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      type: "ocr_corrections",
      description: "OCR 원본→사용자 수정 쌍. 요식업 전표 인식 학습용.",
      totalRecords: dataset.length,
      data: dataset,
    });
  } catch (err: any) {
    console.error("[OCR] export corrections error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2) 확정 매입 데이터셋: 사람이 검증 완료한 매입 내역
ocrRouter.get("/export-dataset/purchases", async (req: Request, res: Response) => {
  try {
    const orders = await db
      .select({
        orderId: purchaseOrdersV2.id,
        restaurantId: purchaseOrdersV2.restaurantId,
        restaurantName: restaurants.name,
        counterpartyId: purchaseOrdersV2.counterpartyId,
        counterpartyName: counterparties.name,
        purchaseDate: purchaseOrdersV2.purchaseDate,
        status: purchaseOrdersV2.status,
        totalAmount: purchaseOrdersV2.totalAmount,
        createdAt: purchaseOrdersV2.createdAt,
      })
      .from(purchaseOrdersV2)
      .leftJoin(counterparties, eq(purchaseOrdersV2.counterpartyId, counterparties.id))
      .leftJoin(restaurants, eq(purchaseOrdersV2.restaurantId, restaurants.id))
      .orderBy(desc(purchaseOrdersV2.purchaseDate));

    const orderIds = orders.map((o) => o.orderId);

    let allItems: any[] = [];
    if (orderIds.length > 0) {
      // batch fetch items
      allItems = await db
        .select({
          purchaseOrderId: purchaseOrderItemsV2.purchaseOrderId,
          itemId: purchaseOrderItemsV2.itemId,
          rawItemName: purchaseOrderItemsV2.rawItemName,
          itemType: purchaseOrderItemsV2.itemType,
          quantity: purchaseOrderItemsV2.quantity,
          unitName: purchaseOrderItemsV2.unitName,
          unitPrice: purchaseOrderItemsV2.unitPrice,
          lineTotal: purchaseOrderItemsV2.lineTotal,
          costingCategory: purchaseOrderItemsV2.costingCategory,
          standardItemName: items.name,
        })
        .from(purchaseOrderItemsV2)
        .leftJoin(items, eq(purchaseOrderItemsV2.itemId, items.id))
        .orderBy(purchaseOrderItemsV2.purchaseOrderId);
    }

    // group items by orderId
    const itemsByOrder = new Map<number, any[]>();
    for (const it of allItems) {
      const list = itemsByOrder.get(it.purchaseOrderId) || [];
      list.push({
        itemId: it.itemId,
        rawName: it.rawItemName,
        standardName: it.standardItemName,
        type: it.itemType,
        quantity: it.quantity ? Number(it.quantity) : null,
        unit: it.unitName,
        unitPrice: it.unitPrice ? Number(it.unitPrice) : null,
        lineTotal: it.lineTotal ? Number(it.lineTotal) : null,
        category: it.costingCategory,
      });
      itemsByOrder.set(it.purchaseOrderId, list);
    }

    const dataset = orders.map((o) => ({
      orderId: o.orderId,
      restaurant: { id: o.restaurantId, name: o.restaurantName },
      counterparty: { id: o.counterpartyId, name: o.counterpartyName },
      purchaseDate: o.purchaseDate,
      status: o.status,
      totalAmount: o.totalAmount ? Number(o.totalAmount) : null,
      items: itemsByOrder.get(o.orderId) || [],
      createdAt: o.createdAt,
    }));

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="purchase-dataset-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      type: "verified_purchases",
      description: "사람이 검증한 요식업 식자재 매입 데이터. 품목명/단가/수량/거래처/날짜.",
      totalOrders: dataset.length,
      totalItems: allItems.length,
      data: dataset,
    });
  } catch (err: any) {
    console.error("[OCR] export purchases error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 3) 거래처 OCR 프로파일 + 품목 마스터
ocrRouter.get("/export-dataset/profiles", async (req: Request, res: Response) => {
  try {
    const profiles = await db
      .select({
        id: counterpartyOcrProfiles.id,
        counterpartyId: counterpartyOcrProfiles.counterpartyId,
        counterpartyName: counterparties.name,
        documentType: counterpartyOcrProfiles.documentType,
        columnOrder: counterpartyOcrProfiles.columnOrder,
        frequentItems: counterpartyOcrProfiles.frequentItems,
        sampleCount: counterpartyOcrProfiles.sampleCount,
        lastUsedAt: counterpartyOcrProfiles.lastUsedAt,
      })
      .from(counterpartyOcrProfiles)
      .leftJoin(counterparties, eq(counterpartyOcrProfiles.counterpartyId, counterparties.id))
      .orderBy(desc(counterpartyOcrProfiles.sampleCount));

    const itemMaster = await db
      .select({
        id: items.id,
        restaurantId: items.restaurantId,
        name: items.name,
        itemType: items.itemType,
        costingCategory: items.costingCategory,
        baseUnit: items.baseUnit,
        isActive: items.isActive,
      })
      .from(items)
      .orderBy(items.restaurantId, items.name);

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="profiles-items-dataset-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      type: "ocr_profiles_and_items",
      description: "거래처별 OCR 프로파일(양식 패턴, 빈출 품목, 이동평균 단가) + 품목 마스터.",
      profiles: {
        total: profiles.length,
        data: profiles.map((p) => ({
          counterparty: { id: p.counterpartyId, name: p.counterpartyName },
          documentType: p.documentType,
          columnOrder: p.columnOrder,
          frequentItems: p.frequentItems,
          sampleCount: p.sampleCount,
          lastUsedAt: p.lastUsedAt,
        })),
      },
      itemMaster: {
        total: itemMaster.length,
        data: itemMaster,
      },
    });
  } catch (err: any) {
    console.error("[OCR] export profiles error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 매출 전표 OCR (POS 마감 전표 → 매출 항목 자동 추출)
// ============================================================

interface SalesOcrItem {
  label: string;
  count: number;
  amount: number;
  type: "cash" | "card" | "giftcard" | "transfer" | "point" | "delivery" | "discount" | "subtotal" | "other";
  confidence?: "high" | "medium" | "low";
}

interface SalesOcrResult {
  posVendor: string;
  saleDate: string;
  receiptNo: string;
  items: SalesOcrItem[];
  totalAmount: number;
  confidence: "high" | "medium" | "low";
}

function validateSalesOcrResult(result: SalesOcrResult): SalesOcrResult {
  // type이 subtotal/discount가 아닌 결제수단 항목 합산
  const paymentItems = result.items.filter(i => i.type !== "subtotal" && i.type !== "discount");
  const itemsSum = paymentItems.reduce((sum, i) => sum + i.amount, 0);

  // totalAmount와 비교 (±5% 허용)
  if (result.totalAmount > 0) {
    const diff = Math.abs(itemsSum - result.totalAmount);
    const tolerance = result.totalAmount * 0.05;
    if (diff > tolerance) {
      result.confidence = "low";
    }
  }

  // 음수 금액 체크 (할인 제외)
  result.items.forEach(item => {
    if (item.amount < 0 && item.type !== "discount") {
      item.confidence = "low";
    }
  });

  return result;
}

function mapSalesOcrToStandard(result: SalesOcrResult) {
  const sum = (type: string) =>
    result.items.filter(i => i.type === type).reduce((s, i) => s + i.amount, 0);

  return {
    cashAmount: sum("cash"),
    cardAmount: sum("card"),
    giftCardAmount: sum("giftcard"),
    transferAmount: sum("transfer"),
    discountAmount: sum("discount"),
    otherAmount: sum("point") + sum("delivery") + sum("other"),
    totalAmount: result.totalAmount,
  };
}

ocrRouter.post("/extract-sales", async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const anthropic = getAnthropicClient();
    if (!anthropic) {
      res.status(500).json({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." });
      return;
    }

    const { imageUrl, restaurantId, rotation } = req.body;
    if (!imageUrl || typeof imageUrl !== "string") {
      res.status(400).json({ error: "imageUrl이 필요합니다" });
      return;
    }

    const relativePath = imageUrl.replace(/^\/uploads\//, "");
    const filePath = path.join(UPLOAD_ROOT, relativePath);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "이미지 파일을 찾을 수 없습니다" });
      return;
    }

    // EXIF 방향 보정
    await fixExifOrientation(filePath);

    // 수동 회전 적용
    const rotationDeg = typeof rotation === "number" && [90, 180, 270].includes(rotation) ? rotation : 0;
    if (rotationDeg > 0) {
      const rotatedBuf = await sharp(filePath).rotate(rotationDeg).toBuffer();
      fs.writeFileSync(filePath, rotatedBuf);
    }

    // 이미지 전처리 (매입 OCR과 동일 파이프라인)
    await preprocessImageForOcr(filePath, "[OCR-Sales]");

    // base64 로드
    const { base64, mediaType } = loadImageBase64Raw(filePath);

    const salesOcrPrompt = `당신은 한국 요식업 POS 마감 전표(거래별 점검표, 일마감 보고서 등)를 분석하는 전문가입니다.

## 목표
전표에서 **결제수단별 최종 매출 금액**을 정확히 추출합니다.

## 전표 구조 이해 (중요!)
한국 POS 전표는 보통 다음 구조입니다:
- 컬럼: 거래내역 | 건수 | 순매출(금액) | 에누리(할인)
- **"*" 표시 행은 소계/합계**입니다 (예: "* 현금 매출계", "* 신용거래계", "* 총 매출")
- 세부 행과 소계 행이 반복됩니다. **소계 행의 금액이 정확한 값**입니다.
- 금액 열이 여러 개일 수 있습니다 — **"순매출" 열의 숫자를 읽으세요**, "에누리" 열(보통 0)과 혼동하지 마세요.

## 추출 규칙

### 1. 전표 기본 정보
- posVendor: POS 제조사 (HYUNDAI, OKPOS, POSBANK 등)
- saleDate: 날짜 (YYYY-MM-DD)
- receiptNo: 전표 번호

### 2. 핵심 매출 값 (결제수단별 최종 소계)
아래 값을 전표에서 찾아 **items 배열**에 넣으세요. 각 항목은 해당 소계(*표시) 행의 금액입니다:

| 찾을 키워드 | type | 설명 |
|------------|------|------|
| 현금 매출계, 현금매출 | "cash" | 현금 결제 합계 |
| 신용거래계, 카드매출계, 신용판매 계 | "card" | 카드(신용+체크) 결제 합계. 자사+타사 합산된 최종 소계 사용 |
| 상품권 매출계, 자상 매출계 | "giftcard" | 상품권 결제 합계 |
| H.Point, 포인트 매출 | "point" | 포인트 결제 합계 |
| 배달매출, 배민, 요기요, 쿠팡이츠 | "delivery" | 배달앱 합계 |
| 계좌이체, 이체매출 | "transfer" | 이체 합계 |
| 에누리, 할인 | "discount" | 할인 합계 |
| 총 매출, 총매출 | "subtotal" | 전체 합계 (totalAmount에도 사용) |

### 3. totalAmount
"* 총 매출" 또는 "* 순 매출" 행의 금액.

## 주의사항
- 이미지가 회전되어 있을 수 있습니다. 텍스트 방향을 자동 감지하세요.
- 금액을 읽을 때 **자릿수를 정확히** 세세요. 예: 1,249,300과 124,930은 다릅니다.
- 소계 행과 세부 행이 있으면 **소계 행(* 표시)의 값**을 사용하세요.
- 신용거래계(카드 합계)에는 자사매출+타사매출-반품이 포함됩니다. 개별 항목이 아닌 최종 합산 소계를 사용하세요.

## 응답 형식 (JSON만, 다른 텍스트 없이)
{
  "posVendor": "HYUNDAI",
  "saleDate": "2026-04-04",
  "receiptNo": "1237",
  "items": [
    { "label": "* 현금 매출계", "count": 7, "amount": 96600, "type": "cash" },
    { "label": "* 신용거래계", "count": 80, "amount": 1249300, "type": "card" },
    { "label": "상품권 매출계", "count": 1, "amount": 44100, "type": "giftcard" },
    { "label": "* H.Point 매출", "count": 3, "amount": 23800, "type": "point" }
  ],
  "totalAmount": 1413000,
  "confidence": "high"
}`;

    const aiResponse = await anthropic.messages.create({
      model: OCR_MODELS.sales,
      max_tokens: SALES_MAX_TOKENS,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: base64 } },
          { type: "text", text: salesOcrPrompt },
        ],
      }],
    });

    const responseTimeMs = Date.now() - startTime;
    const rawText = aiResponse.content.filter(c => c.type === "text").map(c => c.text).join("");

    // JSON 파싱
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await logOcrApiUsage({ endpoint: "extract-sales", restaurantId: Number(restaurantId) || undefined, responseTimeMs, success: false, errorMessage: "JSON 파싱 실패", model: OCR_MODELS.sales });
      res.status(422).json({ error: "전표 인식에 실패했습니다. 다시 촬영해주세요." });
      return;
    }

    let ocrResult: SalesOcrResult;
    try {
      ocrResult = JSON.parse(jsonMatch[0]);
    } catch {
      await logOcrApiUsage({ endpoint: "extract-sales", restaurantId: Number(restaurantId) || undefined, responseTimeMs, success: false, errorMessage: "JSON parse error", model: OCR_MODELS.sales });
      res.status(422).json({ error: "전표 인식 결과를 파싱할 수 없습니다." });
      return;
    }

    // 검증
    ocrResult = validateSalesOcrResult(ocrResult);
    const mapped = mapSalesOcrToStandard(ocrResult);

    // API 사용량 로깅
    await logOcrApiUsage({
      endpoint: "extract-sales",
      restaurantId: Number(restaurantId) || undefined,
      responseTimeMs,
      success: true,
      inputTokens: aiResponse.usage?.input_tokens,
      outputTokens: aiResponse.usage?.output_tokens,
      model: OCR_MODELS.sales,
      itemCount: ocrResult.items.length,
      requestPayloadSize: base64.length,
    });

    res.json({
      ...ocrResult,
      mapped,
    });

  } catch (err: any) {
    const responseTimeMs = Date.now() - startTime;
    console.error("[OCR-Sales] error:", err);
    await logOcrError("extract-sales 실패", { error: err.message }, Number(req.body?.restaurantId) || undefined);
    await logOcrApiUsage({ endpoint: "extract-sales", restaurantId: Number(req.body?.restaurantId) || undefined, responseTimeMs, success: false, errorMessage: err.message, model: OCR_MODELS.sales });
    res.status(500).json({ error: err.message, retryable: true });
  }
});

// ============================================================
// Google Drive 데이터셋 업로드
// ============================================================

// 연동 상태 + 마지막 업로드 결과 확인
ocrRouter.get("/gdrive/status", async (_req: Request, res: Response) => {
  const { lastExport, inProgress } = getLastExportResult();
  res.json({
    configured: isGDriveConfigured(),
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || null,
    inProgress,
    lastExport,
  });
});

// Drive에 전체 데이터셋 업로드 실행
ocrRouter.post("/gdrive/export", async (_req: Request, res: Response) => {
  if (!isGDriveConfigured()) {
    return res.status(400).json({
      success: false,
      error: "Google Drive 미설정. GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_DRIVE_FOLDER_ID 환경변수 필요.",
    });
  }

  try {
    const result = await exportDatasetToGDrive("manual");
    res.json(result);
  } catch (err: any) {
    console.error("[OCR] gdrive export error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
