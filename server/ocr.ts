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
      max_tokens: 4096,
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

반드시 아래 JSON 형식만 반환하세요. 마크다운 코드블록(\`\`\`)으로 감싸지 마세요. 순수 JSON만 출력:
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
      let jsonStr = textContent.text.trim();

      // 마크다운 코드펜스 제거 (닫는 ``` 없는 경우도 처리)
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      } else if (jsonStr.startsWith("```")) {
        // 닫는 ```가 없는 경우 (응답 잘림) — 접두사만 제거
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").trim();
      }

      // JSON이 잘린 경우 복구 시도: 마지막 완전한 item까지만 파싱
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        // 잘린 JSON 복구: 마지막 완전한 }를 찾아서 배열/객체 닫기
        const lastCompleteItem = jsonStr.lastIndexOf("}");
        if (lastCompleteItem > 0) {
          let truncated = jsonStr.substring(0, lastCompleteItem + 1);
          // items 배열이 열려있으면 닫기
          const openBrackets = (truncated.match(/\[/g) || []).length;
          const closeBrackets = (truncated.match(/\]/g) || []).length;
          for (let i = 0; i < openBrackets - closeBrackets; i++) {
            truncated += "]";
          }
          // 최상위 객체가 열려있으면 닫기
          const openBraces = (truncated.match(/\{/g) || []).length;
          const closeBraces = (truncated.match(/\}/g) || []).length;
          for (let i = 0; i < openBraces - closeBraces; i++) {
            truncated += "}";
          }
          parsed = JSON.parse(truncated);
        } else {
          throw new Error("복구 불가");
        }
      }
    } catch (parseErr: any) {
      // JSON 파싱 완전 실패 시 원본 텍스트 반환
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

/**
 * POST /api/ocr/extract-health-cert
 * Body: { imageUrl: string }
 * 보건증 이미지에서 갱신 기간(유효기간) 추출
 */
ocrRouter.post("/extract-health-cert", async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
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

    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString("base64");
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".png": "image/png", ".webp": "image/webp",
    };
    const mediaType = mimeMap[ext] || "image/jpeg";

    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType as any, data: base64Image },
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

    const textContent = message.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      res.status(500).json({ error: "AI 응답 없음" });
      return;
    }

    let jsonStr = textContent.text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    else if (jsonStr.startsWith("```")) jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").trim();

    const parsed = JSON.parse(jsonStr);
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
