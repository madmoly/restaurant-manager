import { Router, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { execSync } from "child_process";
import { UPLOAD_ROOT } from "./upload";
import { db } from "./db";
import { counterpartyItems, counterparties, counterpartyOcrProfiles, ocrCorrections, errorLogs } from "../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";

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
    version: "v7-tesseract-confidence",  // Tesseract 4방향 confidence 가중 비교
    timestamp: new Date().toISOString(),
    sharp: sharpStatus,
    tesseract: tessStatus,
    node: process.version,
  });
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

    // 수량↔단가 뒤바뀜 의심: 단가가 수량보다 작으면 열 오독 가능성
    if (qty > 0 && price > 0 && price < qty) {
      confidence = "low";
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
      .select({ id: counterpartyItems.id, name: counterpartyItems.name, price: counterpartyItems.price })
      .from(counterpartyItems)
      .where(and(
        eq(counterpartyItems.counterpartyId, counterpartyId),
        eq(counterpartyItems.isActive, true)
      ));

    if (existingItems.length === 0) return items;

    return items.map((item) => {
      // 기존 품목과 fuzzy 매칭
      const match = existingItems.find((ei) => {
        const eiName = ei.name.toLowerCase();
        const itemName = item.shortName.toLowerCase();
        return eiName === itemName || eiName.includes(itemName) || itemName.includes(eiName);
      });

      if (match && match.price) {
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
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: [{
        role: "user",
        content: [
          imageContent,
          {
            type: "text",
            text: `이 이미지는 한국 식당/매장의 매입 전표입니다 (거래명세서, 거래명세표, 영수증, 간이영수증, 수기전표, 배달정산서 등).

당신의 임무: 이미지에서 **거래처명**과 **품목별 숫자 데이터**를 정확하게 추출하여 JSON으로 출력하세요.

## ⚠ 이미지 방향 (최우선 — 반드시 먼저 수행)

이 이미지는 90°, 180°, 270° 회전되어 있을 수 있습니다. 촬영자가 휴대폰을 옆으로 들고 찍는 경우가 매우 흔합니다.
**데이터를 추출하기 전에 반드시 아래 순서를 따르세요:**
1. 이미지에서 한글 텍스트가 보이는 방향을 확인 — 텍스트가 옆으로 누워있거나 거꾸로일 수 있음
2. 한글이 왼→오른쪽, 위→아래로 자연스럽게 읽히는 방향을 기준으로 문서를 해석
3. 문서 제목("거래명세표", "거래명세서" 등), 표의 열 헤더(품목, 수량, 단가, 공급가액)를 확인하여 열 순서 파악
4. **텍스트가 세로로 읽히면 90° 또는 270° 회전된 것** — 머릿속으로 회전하여 정방향 기준으로 읽으세요

## 문서 양식별 구조

**[유형A] 거래명세표 (0855 양식) — 가장 흔함:**
- 제목: "거래명세표" + 번호 (예: 0855)
- 좌측: 공급자(판매자) 정보 + 사업자등록번호, 우측: 공급받는자(구매자) 정보
- 표 열 순서: 월일 | 품목/규격 | 단위 | 수량 | 단가 | 공급가액 | 부가세 | 비고
- "공급가액" = 수량 × 단가 → 이 값이 lineTotal
- 부가세/비고 열은 추출 대상 아님
- 하단에 합계 행 + 인수자 서명란 있음 (items에 넣지 말 것)

**[유형B] 거래명세서 (수기/인쇄 혼합):**
- 제목: "거래명세서"
- 상단: 공급자 정보 + 도장(빨간 인감)
- 표 열 순서: 품명 | 규격 | 수량 | 단가 | 공급가액 (열 수가 적음)
- 수기 기입이 섞여 있을 수 있음

**[유형C] 영수증/간이영수증:**
- 보통 품명, 수량, 금액 순서
- 합계/총액 행은 items에 넣지 말 것

**[유형D] 수기전표:**
- 손글씨로 작성, 열 구분이 불명확할 수 있음
- 읽기 어려운 글씨는 uncertain: true

**위 유형에 해당하지 않는 새로운 양식:**
- 열 헤더를 먼저 읽어 열 순서를 파악하세요
- documentType을 "기타"로 설정
- 열 구조를 note에 기록하세요 (예: "품명|수량|금액 3열 구조")

## 추출 규칙

1. **거래처명**: 공급자(판매자) 측의 상호명을 찾으세요. 문서 상단 좌측 또는 우측에 있습니다.
   - 거래명세표: "상호" 필드 또는 사업자 정보 영역의 업체명
   - 거래명세서: 상단 공급자 정보의 업체명
   - "공급받는자"가 아닌 "공급자" 측입니다.

2. **각 품목별 추출:**
   - shortName: **품목명만** (규격 제외, 핵심 이름만). 규격은 spec 필드에 별도 기록.
     예시:
     · "핫철리소스/CHOLIMEX/250g(250g*24ea)/막소" → shortName: "핫철리소스"
     · "무항생제 계란(대란) 30구" → shortName: "무항생제 계란"
     · "코카콜라 1.5L PET" → shortName: "코카콜라"
     · "양파(국내산) 10kg" → shortName: "양파"
     · "일회용장갑(L)" → shortName: "일회용장갑"
     · "소금" → shortName: "소금"
   - spec: 규격 부분만 별도 추출 (용량, 중량, 사이즈, 포장단위, 원산지 등). 없으면 빈 문자열.
     예시: "250g*24ea", "대란 30구", "1.5L", "10kg", "L", "국내산", ""
   - originalName: 이미지에 적힌 전체 품목/규격 텍스트 그대로
   - quantity: **수량 열의 숫자** (순수 숫자, 콤마 제거). 소수점 유지. 예: "6.000" → "6", "0.500" → "0.5"
   - unit: 단위. **규격에서 단위를 유추할 수 있으면 반영하세요.**
     · 규격이 "10kg"이면 unit: "kg"
     · 규격이 "250g*24ea"이면 unit: "ea" (박스 안의 개별 단위)
     · 규격이 "1.5L"이면 unit: "병" 또는 "개"
     · 규격 없고 단위 열에 적힌 값이 있으면 그대로: "EA", "박스", "봉", "병", "판", "개", "묶" 등
   - unitPrice: **단가 열의 숫자** (순수 숫자, 콤마 제거). 예: "1,200" → "1200"
   - lineTotal: **공급가액/금액 열의 숫자** (순수 숫자, 콤마 제거). 예: "6,546" → "6546"
   - uncertain: 글씨가 불명확하거나 숫자 판독이 애매하면 true, 아니면 false

3. **숫자 정확도가 최우선입니다:**
   - 수량은 보통 1~50 범위의 작은 숫자, 단가는 보통 1,000~200,000 범위의 큰 숫자입니다
   - 수량이 단가보다 크면 열을 잘못 읽었을 가능성이 높습니다 → 재확인하세요
   - 공급가액 열과 부가세 열을 혼동하지 마세요. 공급가액이 더 큰 숫자입니다
   - 수량×단가 ≠ 공급가액이면 → 공급가액(문서에 적힌 값)을 lineTotal로 사용하고 uncertain: true

4. **합계/소계/총합 행은 items에 포함하지 마세요.** 대신 summary에 넣으세요.

5. **거래일자**: 전표에 표기된 거래일/날짜를 추출하세요. "YYYY-MM-DD" 형식으로.
   - "2026.03.28" → "2026-03-28"
   - "26.3.28" → "2026-03-28"
   - "3/28" → 올해 기준 "2026-03-28"
   - 날짜를 찾을 수 없으면 null

6. **거래처 상세 정보**: 공급자(판매자) 측의 추가 정보가 있으면 추출하세요.
   - contactName: 담당자명 (대표자명 제외, 담당/배달 담당 등)
   - contactPhone: 연락처 (전화번호/핸드폰)
   - 없으면 각각 null

7. note: 문서에 특이 메모가 있으면 포함, 없으면 null

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

    const responseText = extractText(response);
    if (!responseText) {
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

    // ── 거래처 OCR 프로파일 자동 업데이트 (학습) ───────────────────────
    updateOcrProfile(cpId, parsed.documentType || null, items).catch(() => {});

    // ── 거래처 정보는 클라이언트에서 확인 후 별도 API로 업데이트 ──────
    const cpInfo = parsed.counterpartyInfo || {};

    const result = {
      counterpartyName,
      counterpartyId: cpId,
      transactionDate: parsed.transactionDate || null,
      counterpartyInfo: cpInfo.contactName || cpInfo.contactPhone ? cpInfo : null,
      items,
      note: parsed.note || null,
    };

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
      model: "claude-haiku-4-5-20251001",
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
