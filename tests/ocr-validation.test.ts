/**
 * OCR 매입 처리 검증 로직 단위 테스트
 *
 * 테스트 대상: server/ocr.ts → validateAndEnrichItems()
 *
 * 이 함수는 순수 함수(DB 의존 없음)이지만 현재 모듈 내 private이므로
 * 로직을 직접 복제하여 테스트한다.
 * → TODO: validateAndEnrichItems를 export하여 직접 import 전환
 *
 * 핵심 검증 항목:
 * - 수량 ".000" 오독 보정 (3000 → 3)
 * - 합계 크로스체크 (qty × price vs lineTotal)
 * - VAT 패턴 감지 (1.08~1.12)
 * - 수량↔단가 뒤바뀜 감지 (price < qty → low)
 * - 누락값 역산 (단가/수량)
 * - summary 크로스체크 (5% 기준)
 * - confidence 결정 로직
 */
import { describe, it, expect } from "vitest";

// ─── validateAndEnrichItems 로직 재현 ─────────────────────────────────────────
// server/ocr.ts 230-362행의 순수 로직을 그대로 가져옴
// TODO: ocr.ts에서 export 후 직접 import로 전환

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

function validateAndEnrichItems(
  items: any[],
  summary?: { totalSupply?: string; grandTotal?: string } | null,
): OcrItem[] {
  const enriched = items.map((item: any) => {
    const shortName = String(item.shortName || item.name || "");
    const spec = String(item.spec || "");
    const originalName = String(item.originalName || item.name || "");
    let qtyStr = String(item.quantity || "").replace(/,/g, "");
    if (qtyStr && !isNaN(Number(qtyStr))) {
      qtyStr = String(parseFloat(qtyStr));
    }
    const priceStr = String(item.unitPrice || "").replace(/,/g, "");
    const totalStr = String(item.lineTotal || "").replace(/,/g, "");
    const isUncertain = item.uncertain === true || item.uncertain === "true";

    let qty = parseFloat(qtyStr) || 0;
    const price = parseFloat(priceStr) || 0;

    // 수량 ".000" 오독 보정
    if (qty >= 1000 && qty % 1000 === 0 && price > 0) {
      const correctedQty = qty / 1000;
      const totalCheck = parseFloat(totalStr) || 0;
      if (totalCheck > 0 && Math.abs(correctedQty * price - totalCheck) <= 1) {
        qty = correctedQty;
        qtyStr = String(correctedQty);
      }
    }
    const total = parseFloat(totalStr) || 0;
    let finalTotal = totalStr;
    let confidence: "high" | "medium" | "low" = "high";

    if (qty > 0 && price > 0 && total > 0) {
      const calculated = Math.round(qty * price);
      const diff = Math.abs(total - calculated);
      if (diff > 1 && diff / Math.max(total, calculated) > 0.02) {
        const vatRatio = calculated / total;
        if (vatRatio > 1.08 && vatRatio < 1.12) {
          finalTotal = String(calculated);
          confidence = "medium";
        } else {
          finalTotal = String(calculated);
          confidence = "medium";
        }
      }
    } else if (qty > 0 && price > 0 && !total) {
      finalTotal = String(Math.round(qty * price));
    }

    if (isUncertain) {
      confidence = confidence === "high" ? "medium" : "low";
    }
    if (!shortName || (!qtyStr && !totalStr)) {
      confidence = "low";
    }
    if (price < 0 || (price === 0 && total > 0)) {
      confidence = "low";
    }
    if (qty > 100 && confidence === "high") {
      confidence = "medium";
    }
    if (qty > 0 && price > 0 && price < qty) {
      confidence = "low";
    }
    if (total > 0 && qty > 0 && price === 0) {
      const inferredPrice = Math.round(total / qty);
      if (inferredPrice > 0) {
        confidence = "medium";
      }
    }
    if (total > 0 && price > 0 && qty === 0) {
      const inferredQty = parseFloat((total / price).toFixed(2));
      if (inferredQty > 0 && inferredQty < 200) {
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

  if (summary) {
    const docTotal =
      parseFloat(
        String(summary.totalSupply || summary.grandTotal || "").replace(
          /,/g,
          "",
        ),
      ) || 0;
    if (docTotal > 0 && enriched.length > 0) {
      const itemSum = enriched.reduce(
        (sum, it) => sum + (parseFloat(it.lineTotal) || 0),
        0,
      );
      const totalDiff = Math.abs(itemSum - docTotal);
      if (totalDiff > 100 && totalDiff / docTotal > 0.05) {
        for (const it of enriched) {
          if (it.confidence === "high") it.confidence = "medium";
        }
      }
    }
  }

  return enriched;
}

// ─── 테스트 시작 ──────────────────────────────────────────────────────────────

describe("OCR validateAndEnrichItems", () => {
  // ── 정상 케이스 ───────────────────────────────────────────────────
  describe("정상 입력", () => {
    it("수량 × 단가 = 합계가 일치하면 high confidence", () => {
      const result = validateAndEnrichItems([
        {
          shortName: "삼겹살",
          quantity: "5",
          unitPrice: "12000",
          lineTotal: "60000",
        },
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBe("high");
      expect(result[0].lineTotal).toBe("60000");
    });

    it("합계 누락 시 자동 계산", () => {
      const result = validateAndEnrichItems([
        { shortName: "대파", quantity: "3", unitPrice: "2000", lineTotal: "" },
      ]);
      expect(result[0].lineTotal).toBe("6000");
    });
  });

  // ── 수량 .000 오독 보정 ────────────────────────────────────────────
  describe("수량 .000 오독 보정", () => {
    it("3000 → 3 보정 (3 × 5000 = 15000과 일치 시)", () => {
      const result = validateAndEnrichItems([
        {
          shortName: "양파",
          quantity: "3000",
          unitPrice: "5000",
          lineTotal: "15000",
        },
      ]);
      expect(result[0].quantity).toBe("3");
      expect(result[0].confidence).toBe("high");
    });

    it("lineTotal이 없으면 보정하지 않음", () => {
      const result = validateAndEnrichItems([
        {
          shortName: "양파",
          quantity: "3000",
          unitPrice: "5000",
          lineTotal: "",
        },
      ]);
      expect(result[0].quantity).toBe("3000");
    });

    it("보정 후에도 qty×price ≠ lineTotal이면 보정하지 않음", () => {
      const result = validateAndEnrichItems([
        {
          shortName: "양파",
          quantity: "3000",
          unitPrice: "5000",
          lineTotal: "20000",
        },
      ]);
      // 3000/1000=3, 3×5000=15000 ≠ 20000 → 보정 안함
      expect(result[0].quantity).toBe("3000");
    });
  });

  // ── 합계 크로스체크 ────────────────────────────────────────────────
  describe("합계 크로스체크", () => {
    it("2% 이내 차이는 허용 (high 유지)", () => {
      // qty(10) × price(1000) = 10000, lineTotal=10100 → 차이 1% → OK
      const result = validateAndEnrichItems([
        {
          shortName: "감자",
          quantity: "10",
          unitPrice: "1000",
          lineTotal: "10100",
        },
      ]);
      expect(result[0].confidence).toBe("high");
    });

    it("2% 초과 차이 시 medium으로 하향 + 계산값 우선", () => {
      // qty(10) × price(1000) = 10000, lineTotal=12000 → 차이 16.7%
      const result = validateAndEnrichItems([
        {
          shortName: "감자",
          quantity: "10",
          unitPrice: "1000",
          lineTotal: "12000",
        },
      ]);
      expect(result[0].confidence).toBe("medium");
      expect(result[0].lineTotal).toBe("10000"); // 계산값 우선
    });

    it("VAT 패턴 감지 (비율 1.08~1.12)", () => {
      // qty(10) × price(1100) = 11000, lineTotal=10000 → ratio=1.1
      const result = validateAndEnrichItems([
        {
          shortName: "소금",
          quantity: "10",
          unitPrice: "1100",
          lineTotal: "10000",
        },
      ]);
      expect(result[0].confidence).toBe("medium");
      expect(result[0].lineTotal).toBe("11000"); // 세후금액 우선
    });
  });

  // ── 수량↔단가 뒤바뀜 감지 ──────────────────────────────────────────
  describe("수량↔단가 뒤바뀜 감지", () => {
    it("price < qty이면 low confidence (열 오독 가능성)", () => {
      // 단가(5) < 수량(12000) → 비정상
      const result = validateAndEnrichItems([
        {
          shortName: "돼지고기",
          quantity: "12000",
          unitPrice: "5",
          lineTotal: "60000",
        },
      ]);
      expect(result[0].confidence).toBe("low");
    });

    it("price > qty이면 정상", () => {
      const result = validateAndEnrichItems([
        {
          shortName: "돼지고기",
          quantity: "5",
          unitPrice: "12000",
          lineTotal: "60000",
        },
      ]);
      expect(result[0].confidence).toBe("high");
    });
  });

  // ── 누락값 역산 ───────────────────────────────────────────────────
  describe("누락값 역산", () => {
    it("단가 누락: lineTotal / qty로 역산 → medium", () => {
      const result = validateAndEnrichItems([
        {
          shortName: "당근",
          quantity: "5",
          unitPrice: "",
          lineTotal: "25000",
        },
      ]);
      expect(result[0].confidence).toBe("medium");
    });

    it("수량 누락: lineTotal / price로 역산 → medium", () => {
      const result = validateAndEnrichItems([
        {
          shortName: "당근",
          quantity: "",
          unitPrice: "5000",
          lineTotal: "25000",
        },
      ]);
      expect(result[0].quantity).toBe("5");
      expect(result[0].confidence).toBe("medium");
    });

    it("수량 역산 결과 200 이상이면 역산하지 않음", () => {
      const result = validateAndEnrichItems([
        {
          shortName: "소금",
          quantity: "",
          unitPrice: "10",
          lineTotal: "5000",
        },
      ]);
      // 5000/10 = 500 > 200 → 역산 안함
      expect(result[0].quantity).toBe("");
    });
  });

  // ── confidence 결정 ────────────────────────────────────────────────
  describe("confidence 결정", () => {
    it("uncertain=true → high가 medium으로", () => {
      const result = validateAndEnrichItems([
        {
          shortName: "마늘",
          quantity: "2",
          unitPrice: "3000",
          lineTotal: "6000",
          uncertain: true,
        },
      ]);
      expect(result[0].confidence).toBe("medium");
    });

    it("uncertain=true + 이미 medium → low로", () => {
      // qty(2) × price(3000) = 6000, lineTotal=8000 → medium (불일치)
      // + uncertain → low
      const result = validateAndEnrichItems([
        {
          shortName: "마늘",
          quantity: "2",
          unitPrice: "3000",
          lineTotal: "8000",
          uncertain: true,
        },
      ]);
      expect(result[0].confidence).toBe("low");
    });

    it("shortName 누락 → low", () => {
      const result = validateAndEnrichItems([
        { shortName: "", quantity: "5", unitPrice: "1000", lineTotal: "5000" },
      ]);
      expect(result[0].confidence).toBe("low");
    });

    it("price 음수 → low", () => {
      const result = validateAndEnrichItems([
        {
          shortName: "반품",
          quantity: "1",
          unitPrice: "-5000",
          lineTotal: "-5000",
        },
      ]);
      expect(result[0].confidence).toBe("low");
    });

    it("수량 100 초과 → medium (high에서만 하향)", () => {
      const result = validateAndEnrichItems([
        {
          shortName: "빨대",
          quantity: "200",
          unitPrice: "50",
          lineTotal: "10000",
        },
      ]);
      // price(50) < qty(200) → low가 먼저 적용
      // 이 케이스는 price < qty가 먼저 잡히므로 low
      expect(result[0].confidence).toBe("low");
    });

    it("수량 101이고 price >= qty → medium", () => {
      const result = validateAndEnrichItems([
        {
          shortName: "종이컵",
          quantity: "101",
          unitPrice: "200",
          lineTotal: "20200",
        },
      ]);
      expect(result[0].confidence).toBe("medium");
    });
  });

  // ── summary 크로스체크 ─────────────────────────────────────────────
  describe("summary 크로스체크", () => {
    it("아이템 합산과 문서 합계가 5% 이내면 유지", () => {
      const result = validateAndEnrichItems(
        [
          {
            shortName: "A",
            quantity: "1",
            unitPrice: "10000",
            lineTotal: "10000",
          },
          {
            shortName: "B",
            quantity: "1",
            unitPrice: "10000",
            lineTotal: "10000",
          },
        ],
        { totalSupply: "20500" },
      );
      // 합산=20000, 문서=20500, 차이=500, 500/20500=2.4% < 5%
      expect(result[0].confidence).toBe("high");
      expect(result[1].confidence).toBe("high");
    });

    it("5% 초과 차이 시 모든 high → medium", () => {
      const result = validateAndEnrichItems(
        [
          {
            shortName: "A",
            quantity: "1",
            unitPrice: "10000",
            lineTotal: "10000",
          },
          {
            shortName: "B",
            quantity: "1",
            unitPrice: "10000",
            lineTotal: "10000",
          },
        ],
        { totalSupply: "30000" },
      );
      // 합산=20000, 문서=30000, 차이=10000, 10000/30000=33% > 5%
      expect(result[0].confidence).toBe("medium");
      expect(result[1].confidence).toBe("medium");
    });

    it("이미 medium/low인 항목은 summary 크로스체크로 추가 하향 안됨", () => {
      const result = validateAndEnrichItems(
        [
          {
            shortName: "",
            quantity: "1",
            unitPrice: "10000",
            lineTotal: "10000",
          }, // low (shortName 누락)
        ],
        { totalSupply: "50000" },
      );
      expect(result[0].confidence).toBe("low"); // low 유지 (medium으로 올라가지 않음)
    });
  });

  // ── 특수문자 정리 ──────────────────────────────────────────────────
  describe("특수문자 정리", () => {
    it("[?] 마커 제거", () => {
      const result = validateAndEnrichItems([
        {
          shortName: "마늘[?]",
          originalName: "깐마늘[?]",
          quantity: "1",
          unitPrice: "5000",
          lineTotal: "5000",
        },
      ]);
      expect(result[0].shortName).toBe("마늘");
      expect(result[0].originalName).toBe("깐마늘");
    });

    it("콤마 포함 숫자 정상 파싱", () => {
      const result = validateAndEnrichItems([
        {
          shortName: "소고기",
          quantity: "2",
          unitPrice: "35,000",
          lineTotal: "70,000",
        },
      ]);
      expect(result[0].unitPrice).toBe("35000"); // priceStr는 콤마 제거됨 (replace(/,/g, ""))
      expect(result[0].confidence).toBe("high");
    });
  });
});
