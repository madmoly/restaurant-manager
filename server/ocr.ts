import { Router, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { UPLOAD_ROOT } from "./upload";

export const ocrRouter = Router();

/**
 * POST /api/ocr/extract-purchase
 * Body: { imageUrl: string }  — "/uploads/orders/2026-03-24/abc123.jpg" 형태
 *
 * Anthropic Claude Vision API로 매입 전표 이미지에서 데이터 추출
 * 응답: { counterpartyName?, items: [{ name, quantity, unit, unitPrice, lineTotal }], note? }
 */
ocrRouter.post("/extract-purchase", async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(500).json({
        error: "ANTHROPIC_API_KEY가 설정되지 않았습니다. .env 파일에 추가해주세요.",
      });
      return;
    }

    const { imageUrl } = req.body;
    if (!imageUrl || typeof imageUrl !== "string") {
      res.status(400).json({ error: "imageUrl이 필요합니다" });
      return;
    }

    // imageUrl: "/uploads/orders/2026-03-24/abc123.jpg" → 로컬 파일 경로
    const relativePath = imageUrl.replace(/^\/uploads\//, "");
    const filePath = path.join(UPLOAD_ROOT, relativePath);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "이미지 파일을 찾을 수 없습니다" });
      return;
    }

    // 이미지를 base64로 인코딩
    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString("base64");

    // MIME type 추정
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
    };
    const mediaType = mimeMap[ext] || "image/jpeg";

    // Anthropic Vision API 호출
    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: base64Image,
              },
            },
            {
              type: "text",
              text: `이 이미지는 식당 매입 전표/영수증/거래명세서입니다.
이미지에서 다음 정보를 추출하여 JSON 형식으로 반환해주세요.

규칙:
- 거래처명이 보이면 counterpartyName에 넣으세요
- 각 품목의 이름, 수량, 단위, 단가, 합계를 추출하세요

품목명 규칙:
- shortName: 핵심 품목명만 간결하게 (브랜드/용량/스펙/규격/등급/원산지 제거)
  예: "CJ 백설 포도씨유 500ml" → "포도씨유", "오뚜기 진라면 멀티(5입)" → "진라면", "국내산 삼겹살 1등급 냉장" → "삼겹살", "롯데 칠성사이다 1.5L PET" → "칠성사이다"
- originalName: 전표에 적힌 그대로의 전체 명칭

합계 검증 (매우 중요):
- 반드시 합계 = 수량 × 단가가 맞는지 검증하세요
- 만약 전표의 합계가 수량×단가와 다르면, 수량×단가로 계산한 값을 lineTotal에 넣으세요
- 수량/단가가 없으면 빈 문자열로 처리하세요
- 합계만 있고 수량/단가가 없으면 합계를 그대로 사용하세요

기타:
- 비고/메모가 있으면 note에 넣으세요
- 글씨가 불명확한 부분은 최선의 추정으로 입력하세요

반드시 아래 JSON 형식만 반환하세요 (다른 텍스트 없이):
{
  "counterpartyName": "거래처명 또는 null",
  "items": [
    {
      "shortName": "축약 품목명",
      "originalName": "전표 원본 전체명칭",
      "quantity": "수량(숫자)",
      "unit": "단위(개,kg,박스 등)",
      "unitPrice": "단가(숫자)",
      "lineTotal": "합계(숫자) — 반드시 수량×단가 검증"
    }
  ],
  "note": "비고 또는 null"
}`,
            },
          ],
        },
      ],
    });

    // 응답에서 JSON 파싱
    const textContent = message.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      res.status(500).json({ error: "AI 응답에서 텍스트를 찾을 수 없습니다" });
      return;
    }

    let parsed: any;
    try {
      // JSON 블록이 ```json ... ``` 으로 감싸져 있을 수 있음
      let jsonStr = textContent.text.trim();
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
      parsed = JSON.parse(jsonStr);
    } catch {
      // JSON 파싱 실패 시 원본 텍스트 반환
      res.status(200).json({
        counterpartyName: null,
        items: [],
        note: `AI 응답 파싱 실패. 원본: ${textContent.text.substring(0, 500)}`,
      });
      return;
    }

    // 응답 정규화
    const result = {
      counterpartyName: parsed.counterpartyName || null,
      items: Array.isArray(parsed.items)
        ? parsed.items.map((item: any) => ({
            shortName: String(item.shortName || item.name || ""),
            originalName: String(item.originalName || item.name || ""),
            name: String(item.shortName || item.name || ""),
            quantity: String(item.quantity || ""),
            unit: String(item.unit || ""),
            unitPrice: String(item.unitPrice || ""),
            lineTotal: String(item.lineTotal || ""),
          }))
        : [],
      note: parsed.note || null,
    };

    res.json(result);
  } catch (err: any) {
    console.error("[OCR] extract-purchase error:", err);
    res.status(500).json({
      error: `OCR 처리 중 오류: ${err.message}`,
    });
  }
});
