import { Router, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { UPLOAD_ROOT } from "./upload";
import { db } from "./db";
import { counterpartyItems, counterparties } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

export const ocrRouter = Router();

// ─── 헬퍼: Anthropic 클라이언트 생성 ─────────────────────────────────────────
function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

// ─── 헬퍼: 이미지 → base64 + MIME ────────────────────────────────────────────
function loadImageBase64(filePath: string): { base64: string; mediaType: string } {
  const imageBuffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  };
  return {
    base64: imageBuffer.toString("base64"),
    mediaType: mimeMap[ext] || "image/jpeg",
  };
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

function validateAndEnrichItems(items: any[]): OcrItem[] {
  return items.map((item: any) => {
    const shortName = String(item.shortName || item.name || "");
    const originalName = String(item.originalName || item.name || "");
    const qtyStr = String(item.quantity || "");
    const priceStr = String(item.unitPrice || "");
    const totalStr = String(item.lineTotal || "");
    const hasUncertain = String(item.uncertain || "");

    const qty = parseFloat(qtyStr) || 0;
    const price = parseFloat(priceStr) || 0;
    const total = parseFloat(totalStr) || 0;
    let finalTotal = totalStr;
    let confidence: "high" | "medium" | "low" = "high";

    // 합계 검증
    if (qty > 0 && price > 0) {
      const calculated = Math.round(qty * price);
      if (total > 0 && Math.abs(total - calculated) / calculated > 0.01) {
        // 전표 합계와 수량×단가 불일치 → 수량×단가로 보정
        finalTotal = String(calculated);
        confidence = "medium";
      } else if (!total) {
        finalTotal = String(calculated);
      }
    }

    // 불확실 마킹된 필드
    if (hasUncertain === "true" || shortName.includes("[?]") || originalName.includes("[?]")) {
      confidence = "low";
    }

    // 핵심 데이터 누락
    if (!shortName || (!qtyStr && !totalStr)) {
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
// POST /api/ocr/extract-purchase — 2단계 OCR (판독 → 구조화)
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

    const { base64, mediaType } = loadImageBase64(filePath);
    const imageContent: Anthropic.ImageBlockParam = {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
        data: base64,
      },
    };

    // ── 1단계: 이미지 원시 판독 (Vision 집중, sonnet) ──────────────────────
    const step1 = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: [
          imageContent,
          {
            type: "text",
            text: `당신은 한국 식당 매입 전표/영수증/거래명세서 전문 판독기입니다.

작업: 이 이미지의 모든 텍스트를 있는 그대로 정확하게 전사하세요.

규칙:
1. 표 구조가 있으면 | 구분자로 행/열을 유지하세요
2. 글씨가 흐리거나 불명확한 부분은 [?텍스트] 형식으로 표시하세요 (예: [?삼겹살])
3. 숫자는 콤마 포함 그대로 전사하세요 (예: 15,000)
4. 상단의 거래처/업체명, 날짜, 전화번호 등 헤더 정보도 포함하세요
5. 빈 칸이나 읽을 수 없는 부분은 [판독불가]로 표시하세요
6. 전표 하단의 합계, 부가세, 총액 등도 반드시 포함하세요
7. 절대 내용을 추측하거나 보정하지 마세요 — 보이는 그대로만 전사

문서 유형도 첫 줄에 명시하세요:
[유형: 거래명세서/영수증/수기전표/카드전표/배달정산서/기타]

전사 결과만 출력하세요. 설명이나 해석은 불필요합니다.`,
          },
        ],
      }],
    });

    const rawTranscription = extractText(step1);
    if (!rawTranscription) {
      res.status(500).json({ error: "1단계 판독 실패: AI 응답 없음" });
      return;
    }

    // ── 2단계: 텍스트 → 구조화 JSON (haiku — 비용 효율) ───────────────────
    const step2 = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: `아래는 한국 식당 매입 전표를 이미지에서 전사한 원문입니다.
이 텍스트를 분석하여 구조화된 JSON으로 변환하세요.

=== 전사 원문 ===
${rawTranscription}
=== 끝 ===

변환 규칙:
1. counterpartyName: 거래처/업체명 (없으면 null)
2. 각 품목별로:
   - shortName: 핵심 품목명만 (브랜드/용량/규격/등급/원산지 제거)
     예: "CJ 백설 포도씨유 500ml" → "포도씨유", "국내산 삼겹살 1등급" → "삼겹살"
   - originalName: 전사 원문 그대로의 품목명
   - quantity: 수량 (숫자만, 콤마 제거)
   - unit: 단위 (개, kg, 박스, EA 등)
   - unitPrice: 단가 (숫자만, 콤마 제거)
   - lineTotal: 행 합계 (숫자만, 콤마 제거)
   - uncertain: [?] 마킹이 포함된 필드가 있으면 "true", 없으면 "false"
3. note: 비고/메모 (없으면 null)

중요:
- 숫자에서 콤마(,)를 제거하고 순수 숫자만 넣으세요
- 수량/단가가 없고 합계만 있으면 합계를 lineTotal에 넣고 quantity/unitPrice는 빈 문자열
- 합계가 없고 수량×단가가 있으면 계산하여 lineTotal에 넣으세요
- [?]나 [판독불가] 태그가 있는 품목은 uncertain: "true"

순수 JSON만 출력하세요. 코드블록(\`\`\`)으로 감싸지 마세요:
{
  "counterpartyName": "거래처명 또는 null",
  "items": [
    {
      "shortName": "축약명",
      "originalName": "원본명",
      "quantity": "수량",
      "unit": "단위",
      "unitPrice": "단가",
      "lineTotal": "합계",
      "uncertain": "true 또는 false"
    }
  ],
  "note": "비고 또는 null"
}`,
      }],
    });

    const step2Text = extractText(step2);
    if (!step2Text) {
      res.status(500).json({ error: "2단계 구조화 실패: AI 응답 없음" });
      return;
    }

    let parsed: any;
    try {
      parsed = parseAIJson(step2Text);
    } catch {
      res.status(200).json({
        counterpartyName: null,
        items: [],
        note: `구조화 실패. 판독 원문: ${rawTranscription.substring(0, 500)}`,
      });
      return;
    }

    // ── 합계 검증 + 신뢰도 산정 ──────────────────────────────────────────
    let items = validateAndEnrichItems(Array.isArray(parsed.items) ? parsed.items : []);

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

    // 자동 재시도: 1회
    // (재시도 로직은 클라이언트에서도 가능하지만, API 비용을 고려하여 서버에서 1회만)
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

    const { base64, mediaType } = loadImageBase64(filePath);

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
