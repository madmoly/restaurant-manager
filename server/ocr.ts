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
function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

// ─── 헬퍼: 이미지 → base64 + MIME ────────────────────────────────────────────
function loadImageBase64Raw(filePath: string): { base64: string; mediaType: string } {
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

// ─── 헬퍼: 코드펜스 제거 + JSON 파싱 (잘린 JSON 복구 포함) ──────────────────
function parseAIJson(raw: string): any {
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
function extractText(message: Anthropic.Message): string | null {
  const tc = message.content.find((c) => c.type === "text");
  return tc && tc.type === "text" ? tc.text : null;
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
  confidence: "high" | "medium" | "low";
}

function validateAndEnrichItems(items: any[], summary?: { totalSupply?: string; grandTotal?: string } | null): OcrItem[] {
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

    // ── 수량 ".000" 오독 보정 ──────────────────────────────────────────────
    // OCR이 "3.000"을 "3000"으로 읽는 패턴: qty가 1000의 배수이고,
    // qty/1000 × price = lineTotal 이면 수량을 1000으로 나눈다
    if (qty >= 1000 && qty % 1000 === 0 && price > 0) {
      const correctedQty = qty / 1000;
      const totalCheck = parseFloat(totalStr) || 0;
      if (totalCheck > 0 && Math.abs(correctedQty * price - totalCheck) <= 1) {
        console.log(`[OCR] 수량 .000 보정: ${qtyStr} → ${correctedQty} (${shortName})`);
        qty = correctedQty;
        qtyStr = String(correctedQty);
      }
    }
    const total = parseFloat(totalStr) || 0;
    let finalTotal = totalStr;
    let confidence: "high" | "medium" | "low" = "high";

    // 합계 검증: 수량×단가 vs 문서 공급가액
    if (qty > 0 && price > 0 && total > 0) {
      const calculated = Math.round(qty * price);
      const diff = Math.abs(total - calculated);
      if (diff > 1 && diff / Math.max(total, calculated) > 0.02) {
        // VAT 패턴 감지: 단가가 세후(부가세포함), 공급가액이 세전 → 비율 ~1.1
        const vatRatio = calculated / total;
        if (vatRatio > 1.08 && vatRatio < 1.12) {
          // 부가세 차이 → 수량×단가(세후) = 실제 지불금액으로 교정
          finalTotal = String(calculated);
          confidence = "medium";
        } else {
          // 기타 불일치 → 수량×단가를 우선 사용 (사용자가 직접 입력한 값 기준)
          finalTotal = String(calculated);
          confidence = "medium";
        }
      }
    } else if (qty > 0 && price > 0 && !total) {
      // 합계 누락 시 계산
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

    return {
      shortName: shortName.replace(/\[\?\]/g, "").trim(),
      spec: spec.trim(),
      originalName: originalName.replace(/\[\?\]/g, "").trim(),
      name: shortName.replace(/\[\?\]/g, "").trim(),
      quantity: qtyStr,
      unit: String(item.unit || ""),
      unitPrice: priceStr,
      lineTotal: finalTotal,
      confidence,
    };
  });

  // ── summary 크로스체크: 아이템 합산 vs 문서 합계 ──────────────────────
  if (summary) {
    const docTotal = parseFloat(String(summary.totalSupply || summary.grandTotal || "").replace(/,/g, "")) || 0;
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

// ─── 거래처 품목 매칭 (기존 DB 활용) ────────────────────────────────────────
async function matchCounterpartyItems(
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
      if (!ocrNorm) return item;

      // 1) 거래처 품목에서 매칭
      let bestMatch: { itemId: number; itemName: string; score: number; source: "counterparty" | "master" } | null = null;
      let candidates: { itemId: number; itemName: string; score: number; source: "counterparty" | "master" }[] = [];

      for (const ci of cpItems) {
        const displayName = ci.name || ci.itemName;
        if (!displayName) continue;
        const score = fuzzyScore(ocrNorm, normalizeKorean(displayName));
        if (score >= 0.3 && ci.itemId) {
          candidates.push({ itemId: ci.itemId, itemName: displayName, score, source: "counterparty" });
        }
      }

      // 2) 거래처 품목에서 좋은 매칭 없으면 전체 마스터에서 검색
      if (candidates.length === 0 || (candidates[0] && candidates[0].score < 0.7)) {
        for (const mi of allItems) {
          const score = fuzzyScore(ocrNorm, normalizeKorean(mi.name));
          if (score >= 0.3) {
            candidates.push({ itemId: mi.id, itemName: mi.name, score, source: "master" });
          }
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      bestMatch = candidates[0] || null;

      return {
        ...item,
        matchedItemId: bestMatch?.score && bestMatch.score >= 0.7 ? bestMatch.itemId : undefined,
        matchedItemName: bestMatch?.score && bestMatch.score >= 0.7 ? bestMatch.itemName : undefined,
        itemCandidates: candidates.slice(0, 3).map((c) => ({
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

  // 포함 관계 체크
  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return shorter / longer; // 길이 비율로 점수화 (짧은쪽/긴쪽)
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
async function getOcrProfile(counterpartyId: number | null): Promise<{
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
function buildProfileHint(profile: {
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
    try {
      const meta = await sharp(filePath).metadata();
      const maxDim = Math.max(meta.width || 0, meta.height || 0);

      // 1단계: 해상도 제한 (3500px — 작은 숫자 판독 위해 기존 3000에서 상향)
      let pipeline = sharp(filePath);
      if (maxDim > 3500) {
        pipeline = pipeline.resize(3500, 3500, { fit: "inside", withoutEnlargement: true });
      }

      // 2단계: 그레이스케일 변환 (색상 노이즈 제거, 흑백 대비 극대화)
      pipeline = pipeline.grayscale();

      // 3단계: 대비 강화 (전표의 옅은 인쇄, 그림자 보정)
      pipeline = pipeline
        .normalize()                // 히스토그램 평활화
        .linear(1.3, -(128 * 1.3 - 128))  // contrast boost 1.3x (중심점 128)
        .gamma(1.2);                // 배경 밝게 (흰 배경 강조)

      // 4단계: 샤프닝 (텍스트 가장자리 강화 — 한글/숫자 경계 선명화)
      pipeline = pipeline.sharpen({
        sigma: 2.0,           // 넓은 커널 (글자 획 전체 커버)
        m1: 2.0,              // flat area: 옅은 인쇄 강화
        m2: 1.0,              // edge area: 글자 경계 강조
      });

      // 5단계: 최종 출력 (고품질 JPEG)
      const enhancedBuf = await pipeline
        .jpeg({ quality: 95, mozjpeg: true })
        .toBuffer();

      fs.writeFileSync(filePath, enhancedBuf);
      console.log(`[OCR] 이미지 전처리 v9 완료: ${path.basename(filePath)} (${(enhancedBuf.length / 1024).toFixed(0)}KB, 원본 ${maxDim}px → grayscale+contrast+sharpen)`);
    } catch (enhErr: any) {
      console.warn(`[OCR] 이미지 전처리 실패 (원본 사용): ${enhErr.message}`);
    }

    // ── 거래처 프로파일 조회 (동적 프롬프트 힌트용) ──────────────────────
    const ocrProfile = await getOcrProfile(clientCpId ? Number(clientCpId) : null);
    const profileHint = buildProfileHint(ocrProfile);

    const { base64, mediaType } = loadImageBase64Raw(filePath);
    const imageContent: Anthropic.ImageBlockParam = {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
        data: base64,
      },
    };

    // ── 단일 Vision: 이미지 → 직접 구조화 JSON ───────────────────────────
    const ocrStartTime = Date.now();
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: [{
        role: "user",
        content: [
          imageContent,
          {
            type: "text",
            text: `이 이미지는 한국 식당/매장의 매입 전표입니다.

## 작업 순서 (반드시 이 순서대로 수행하세요)

### STEP 1: 문서 구조 파악
먼저 이미지 전체를 살펴보고 다음을 확인하세요:
- 문서 유형 (거래명세표/거래명세서/영수증/수기전표/배달정산서/기타)
- 표의 열 헤더 위치와 순서 (품목, 규격, 단위, 수량, 단가, 공급가액 등)
- 공급자(판매자) 정보 위치

### STEP 2: 거래처명/날짜 추출
문서 상단에서:
- 거래처명: **공급자(판매자)** 측 상호명 ("공급받는자"가 아님)
- 거래일: YYYY-MM-DD 형식

### STEP 3: 품목별 데이터 추출
표의 **각 행**을 위에서 아래로 하나씩 읽으세요:
- 열 위치를 혼동하지 마세요. STEP 1에서 확인한 열 순서를 따르세요.
- **숫자는 자릿수까지 정확히 읽으세요.** 1과 7, 3과 8, 5와 6, 0과 8을 구분하세요.
- 콤마가 포함된 숫자: "12,000"은 12000이지 12나 1200이 아닙니다.

### STEP 4: 자기 검증
추출 완료 후 각 행에 대해 검증하세요:
- 수량 × 단가 ≈ 공급가액 인지 확인 (10% 이내)
- 수량은 보통 0.5~50, 단가는 보통 500~200,000 범위
- 수량이 단가보다 크면 열을 잘못 읽은 것 → 재확인
- 합계행의 금액과 개별 lineTotal의 합이 비슷한지 확인

## ⚠ 한글 인식 규칙

**글자 단위로 정확히 읽으세요:**
- 받침: "달" ≠ "닭", "곤" ≠ "콩", "갈" ≠ "감", "봉" ≠ "볶", "란" ≠ "단"
- 모음: "대" ≠ "데", "래" ≠ "레", "파" ≠ "피", "무" ≠ "두", "배" ≠ "베"
- 초성: "깨" ≠ "째", "감" ≠ "강", "돈" ≠ "론", "불" ≠ "볼"
- 겹받침: "닭" ≠ "달", "삶" ≠ "살", "읽" ≠ "일"

**식자재 참고 단어집:**
채소: 양파, 감자, 대파, 쪽파, 당근, 양배추, 깻잎, 마늘, 생강, 고추, 청양고추, 오이, 배추, 시금치, 무, 부추, 미나리, 콩나물, 숙주, 브로콜리, 파프리카, 토마토, 호박, 애호박
육류: 삼겹살, 목살, 안심, 등심, 갈비, 닭가슴살, 닭다리, 닭날개, 오리, 소고기, 돼지고기, 항정살, 차돌박이
수산: 새우, 오징어, 고등어, 연어, 참치, 조개, 굴, 문어, 멸치, 꽃게, 전복, 갈치, 광어
가공: 두부, 우유, 계란, 치즈, 버터, 참기름, 들기름, 식용유, 올리브유, 마요네즈, 케첩
조미: 소금, 설탕, 간장, 된장, 고추장, 쌈장, 식초, 후추, 물엿, 맛술, 굴소스, 칠리소스
곡물: 밀가루, 쌀, 면, 국수, 라면, 떡, 만두, 부침가루, 전분
음료: 콜라, 사이다, 맥주, 소주, 생수, 주스, 탄산수, 에이드
소모품: 일회용, 랩, 호일, 봉투, 장갑, 행주, 세제, 소독, 키친타올, 물티슈

**숫자와 한글 분리:**
- "양파10kg" → 품목: "양파", 규격: "10kg"
- "대파1단" → 품목: "대파", 수량: "1", 단위: "단"

**불확실한 글자:** 가장 가능성 높은 식자재명으로 추정 + uncertain: true

## 문서 양식

**[A] 거래명세표** — 가장 흔함. 열: 월일|품목/규격|단위|수량|단가|공급가액|부가세|비고. "공급가액"=수량×단가→lineTotal. 부가세/비고는 추출 불필요.
**[B] 거래명세서** — 열: 품명|규격|수량|단가|공급가액. 수기 혼합 가능.
**[C] 영수증** — 품명, 수량, 금액. 합계행 제외.
**[D] 수기전표** — 손글씨. 열 구분 불명확 시 uncertain: true.
**[기타]** — 열 헤더 먼저 읽고, 구조를 note에 기록.

## 추출 필드

각 품목:
- shortName: 품목명만 (규격 제외). 예: "핫철리소스/CHOLIMEX/250g" → "핫철리소스"
- spec: 규격 (용량/중량/사이즈). 없으면 ""
- originalName: 이미지 원본 텍스트 그대로
- quantity: 수량 (숫자, 콤마 제거, 소수점 유지. "6.000"→"6")
- unit: 단위 (규격에서 유추 가능하면 반영)
- unitPrice: 단가 (숫자, 콤마 제거)
- lineTotal: 공급가액 (숫자, 콤마 제거)
- uncertain: 불명확하면 true

거래처/기타:
- counterpartyName: 공급자 상호명
- transactionDate: YYYY-MM-DD (없으면 null)
- contactName/contactPhone: 담당자 정보 (없으면 null)
- summary: totalSupply, totalTax, grandTotal
- 합계/소계 행은 items에 넣지 말고 summary에

## 출력 형식 (순수 JSON만, 코드블록 없이):
{
  "counterpartyName": "거래처명 또는 null",
  "transactionDate": "거래일 YYYY-MM-DD 또는 null",
  "counterpartyInfo": {
    "contactName": "담당자명 또는 null",
    "contactPhone": "연락처 또는 null"
  },
  "documentType": "거래명세표|거래명세서|영수증|간이영수증|수기전표|배달정산서|기타",
  "items": [
    {
      "shortName": "품목명/규격 (규격 없으면 품목명만)",
      "spec": "규격 (용량/중량/사이즈/포장단위, 없으면 빈 문자열)",
      "originalName": "이미지 원본 텍스트",
      "quantity": "수량(숫자)",
      "unit": "단위 (규격에서 유추 가능하면 반영)",
      "unitPrice": "단가(숫자)",
      "lineTotal": "공급가액(숫자)",
      "uncertain": false
    }
  ],
  "summary": {
    "totalSupply": "공급가액 합계(숫자) 또는 null",
    "totalTax": "부가세 합계(숫자) 또는 null",
    "grandTotal": "총합계(숫자) 또는 null"
  },
  "note": "비고 또는 null"
}${profileHint}`,
          },
        ],
      }],
    });

    const ocrElapsed = Date.now() - ocrStartTime;
    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;

    const responseText = extractText(response);
    if (!responseText) {
      logOcrApiUsage({ endpoint: "extract-purchase", restaurantId: restaurantId ? Number(restaurantId) : undefined, responseTimeMs: ocrElapsed, success: false, errorMessage: "AI 응답 없음", inputTokens, outputTokens, model: "sonnet" });
      res.status(500).json({ error: "AI 응답 없음" });
      return;
    }

    let parsed: any;
    try {
      parsed = parseAIJson(responseText);
    } catch {
      // JSON 파싱 실패 → 에러 로그 저장 + 재시도 가능 에러 응답
      await logOcrError("OCR JSON 파싱 실패", {
        responsePreview: responseText.substring(0, 1000),
        imageUrl,
      }, restaurantId ? Number(restaurantId) : undefined);
      res.status(500).json({
        error: "AI 응답을 처리하지 못했습니다. 다시 시도해주세요.",
        retryable: true,
      });
      return;
    }

    // ── 합계 검증 + 신뢰도 + summary 크로스체크 ──────────────────────────
    let items = validateAndEnrichItems(
      Array.isArray(parsed.items) ? parsed.items : [],
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

    // ── 거래처 정보는 클라이언트에서 확인 후 별도 API로 업데이트 ──────
    const cpInfo = parsed.counterpartyInfo || {};

    const result = {
      counterpartyName,
      counterpartyId: cpId,
      counterpartyCandidates: counterpartyCandidates.length > 0 ? counterpartyCandidates : undefined,
      transactionDate: parsed.transactionDate || null,
      counterpartyInfo: cpInfo.contactName || cpInfo.contactPhone ? cpInfo : null,
      items,
      note: parsed.note || null,
    };

    // API 사용량 로깅 (성공)
    logOcrApiUsage({
      endpoint: "extract-purchase",
      restaurantId: restaurantId ? Number(restaurantId) : undefined,
      responseTimeMs: ocrElapsed,
      success: true,
      inputTokens, outputTokens,
      model: "sonnet",
      itemCount: items.length,
      requestPayloadSize: base64.length,
    });

    res.json(result);
  } catch (err: any) {
    console.error("[OCR] extract-purchase error:", err);
    await logOcrError(`OCR 처리 오류: ${err.message}`, {
      stack: err.stack?.substring(0, 1000),
      imageUrl: req.body?.imageUrl,
    }, req.body?.restaurantId ? Number(req.body.restaurantId) : undefined);
    res.status(500).json({
      error: `OCR 처리 중 오류가 발생했습니다.`,
      retryable: true,
    });
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

    const { base64, mediaType } = await loadImageBase64(filePath);

    // 보건증은 단순 구조 → haiku로 충분 (비용 절감)
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{
        role: "user",
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
      }],
    });

    const text = extractText(message);
    if (!text) {
      res.status(500).json({ error: "AI 응답 없음" });
      return;
    }

    const parsed = parseAIJson(text);
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
        model: "claude-sonnet-4-20250514",
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
    try {
      const meta = await sharp(filePath).metadata();
      const maxDim = Math.max(meta.width || 0, meta.height || 0);
      let pipeline = sharp(filePath);
      if (maxDim > 3500) {
        pipeline = pipeline.resize(3500, 3500, { fit: "inside", withoutEnlargement: true });
      }
      pipeline = pipeline.grayscale().normalize().linear(1.3, -(128 * 1.3 - 128)).gamma(1.2);
      pipeline = pipeline.sharpen({ sigma: 2.0, m1: 2.0, m2: 1.0 });
      const enhancedBuf = await pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
      fs.writeFileSync(filePath, enhancedBuf);
    } catch (enhErr: any) {
      console.warn(`[OCR-Sales] 이미지 전처리 실패 (원본 사용): ${enhErr.message}`);
    }

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
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
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
      await logOcrApiUsage({ endpoint: "extract-sales", restaurantId: Number(restaurantId) || undefined, responseTimeMs, success: false, errorMessage: "JSON 파싱 실패", model: "claude-sonnet-4-20250514" });
      res.status(422).json({ error: "전표 인식에 실패했습니다. 다시 촬영해주세요." });
      return;
    }

    let ocrResult: SalesOcrResult;
    try {
      ocrResult = JSON.parse(jsonMatch[0]);
    } catch {
      await logOcrApiUsage({ endpoint: "extract-sales", restaurantId: Number(restaurantId) || undefined, responseTimeMs, success: false, errorMessage: "JSON parse error", model: "claude-sonnet-4-20250514" });
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
      model: "claude-sonnet-4-20250514",
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
    await logOcrApiUsage({ endpoint: "extract-sales", restaurantId: Number(req.body?.restaurantId) || undefined, responseTimeMs, success: false, errorMessage: err.message, model: "claude-sonnet-4-20250514" });
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
