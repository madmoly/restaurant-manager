import { Router, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { UPLOAD_ROOT } from "./upload";
import { db } from "./db";
import { counterpartyItems, counterparties } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

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
  res.json({
    version: "v3-raw-upload",  // 원본 파일 직접 업로드 + 서버 EXIF 회전
    timestamp: new Date().toISOString(),
    sharp: sharpStatus,
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
// sharp.rotate() (인자 없음): EXIF orientation 태그를 읽어 실제 픽셀을 회전한 뒤 태그 제거
// - 스마트폰 사진(EXIF 있음): 올바른 방향으로 자동 회전
// - Canvas 거친 이미지(EXIF 없음): 아무 변경 없음 (안전)
async function loadImageBase64(filePath: string): Promise<{ base64: string; mediaType: string }> {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  };

  try {
    // EXIF orientation 기반 자동 회전 + 태그 제거
    // .rotate() (인자 없음) = EXIF 방향대로 픽셀을 실제 회전 후 태그 삭제
    // → EXIF가 없으면 아무것도 안 함 (Canvas 거친 이미지도 안전)
    const cleanBuffer = await sharp(filePath)
      .rotate()
      .toBuffer();
    console.log(`[OCR] EXIF 자동회전 완료: ${path.basename(filePath)} (${(cleanBuffer.length / 1024).toFixed(0)}KB)`);
    return {
      base64: cleanBuffer.toString("base64"),
      mediaType: mimeMap[ext] || "image/jpeg",
    };
  } catch (err) {
    // sharp 실패 시 원본 그대로 사용
    console.warn(`[OCR] sharp 처리 실패, 원본 사용: ${path.basename(filePath)}`, err);
    const imageBuffer = fs.readFileSync(filePath);
    return {
      base64: imageBuffer.toString("base64"),
      mediaType: mimeMap[ext] || "image/jpeg",
    };
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

    const { imageUrl, restaurantId } = req.body;
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

## ⚠ 이미지 방향 (최우선 확인)

이미지가 90°, 180° 회전되어 있을 수 있습니다. **반드시 문서의 텍스트 방향을 먼저 파악하세요.**
1. 문서 제목("거래명세표", "거래명세서" 등)이 어느 방향에 있는지 확인
2. 그 기준으로 표의 열 헤더(품목, 수량, 단가, 공급가액 등)를 왼→오 순서로 읽기
3. 열 순서 오류는 전체 데이터를 무효화하므로, 헤더를 반드시 먼저 확인

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
   - shortName: 핵심 품목명만 (예: "핫철리소스/CHOLIMEX/250g(250g*24ea)/막소" → "핫철리소스")
   - originalName: 이미지에 적힌 전체 품목/규격 텍스트 그대로
   - quantity: **수량 열의 숫자** (순수 숫자, 콤마 제거). 소수점 유지. 예: "6.000" → "6", "0.500" → "0.5"
   - unit: 단위 (EA, kg, 박스, 봉, 병, 판, 개, 묶 등)
   - unitPrice: **단가 열의 숫자** (순수 숫자, 콤마 제거). 예: "1,200" → "1200"
   - lineTotal: **공급가액/금액 열의 숫자** (순수 숫자, 콤마 제거). 예: "6,546" → "6546"
   - uncertain: 글씨가 불명확하거나 숫자 판독이 애매하면 true, 아니면 false

3. **숫자 정확도가 최우선입니다:**
   - 수량은 보통 1~50 범위의 작은 숫자, 단가는 보통 1,000~200,000 범위의 큰 숫자입니다
   - 수량이 단가보다 크면 열을 잘못 읽었을 가능성이 높습니다 → 재확인하세요
   - 공급가액 열과 부가세 열을 혼동하지 마세요. 공급가액이 더 큰 숫자입니다
   - 수량×단가 ≠ 공급가액이면 → 공급가액(문서에 적힌 값)을 lineTotal로 사용하고 uncertain: true

4. **합계/소계/총합 행은 items에 포함하지 마세요.** 대신 summary에 넣으세요.

5. note: 문서에 특이 메모가 있으면 포함, 없으면 null

## 출력 형식 (순수 JSON만, 코드블록 없이):
{
  "counterpartyName": "거래처명 또는 null",
  "documentType": "거래명세표|거래명세서|영수증|간이영수증|수기전표|배달정산서|기타",
  "items": [
    {
      "shortName": "품목 축약명",
      "originalName": "이미지 원본 텍스트",
      "quantity": "수량(숫자)",
      "unit": "단위",
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
}`,
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
      // JSON 파싱 실패 시 원문 일부 반환
      res.status(200).json({
        counterpartyName: null,
        items: [],
        note: `구조화 실패. AI 응답: ${responseText.substring(0, 500)}`,
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
    const cpId = await findCounterpartyId(counterpartyName, restaurantId ? Number(restaurantId) : undefined);
    items = await matchCounterpartyItems(cpId, items);

    const result = {
      counterpartyName,
      items,
      note: parsed.note || null,
    };

    res.json(result);
  } catch (err: any) {
    console.error("[OCR] extract-purchase error:", err);
    res.status(500).json({
      error: `OCR 처리 중 오류: ${err.message}`,
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
