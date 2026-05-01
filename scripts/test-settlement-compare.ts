// 임시 스크립트: settlementCompare 알고리즘 sanity check
// 첨부 PDF/xlsx 파일이 uploads/에 없어 OCR 단계는 검증 불가.
// 알고리즘 자체의 3-level 분기와 매칭 로직만 더미 데이터로 검증.

import {
  compareWithSystem,
  summarizeComparison,
  type ParsedItem,
  type SystemPurchaseItem,
} from "../server/helpers/settlementCompare";

function ocr(date: string, name: string, qty: number, price: number, total?: number): ParsedItem {
  return {
    date,
    rawItemName: name,
    itemName: name,
    spec: null,
    quantity: qty,
    unitPrice: price,
    lineTotal: total ?? qty * price,
    taxType: "unknown",
    uncertain: false,
    confidence: 0.95,
  };
}

let nextRowId = 1;
function sys(date: string, name: string, qty: number, price: number, total?: number): SystemPurchaseItem {
  return {
    purchaseOrderId: 1,
    itemRowId: nextRowId++,
    itemId: null,
    itemName: name,
    quantity: qty,
    unitPrice: price,
    lineTotal: total ?? qty * price,
    date,
  };
}

const cp = { settlementBasis: "supply" as const, settlementMatchTolerance: 100 };

console.log("\n═══ Test 1: 월합계 일치 (monthly_match) ═══");
const t1 = compareWithSystem(
  [ocr("2024-04-01", "삼겹살", 5, 12000), ocr("2024-04-02", "양파", 10, 1500)],
  [sys("2024-04-01", "삼겹살", 5, 12000), sys("2024-04-02", "양파", 10, 1500)],
  cp,
  { salesTotal: null }
);
console.log("level:", t1.level, "monthly:", t1.monthly);
console.log("summary:", summarizeComparison(t1));

console.log("\n═══ Test 2: 일자별만 다름 (date_mismatch) ═══");
const t2 = compareWithSystem(
  [ocr("2024-04-01", "삼겹살", 5, 12000), ocr("2024-04-02", "양파", 10, 1500)],
  [sys("2024-04-01", "삼겹살", 5, 12000), sys("2024-04-02", "양파", 10, 1500)],
  cp,
  { salesTotal: 75500 } // 75000과 500원 차이 (tolerance 100보다 큼)
);
console.log("level:", t2.level, "monthly:", t2.monthly);
console.log("dates:", t2.dates);

console.log("\n═══ Test 3: 항목 단위 차이 (item_mismatch — amount_diff) ═══");
const t3 = compareWithSystem(
  [
    ocr("2024-04-01", "삼겹살", 5, 12000, 60000),
    ocr("2024-04-02", "양파", 10, 1500, 15000),
  ],
  [
    sys("2024-04-01", "삼겹살", 5, 12000, 60000),
    sys("2024-04-02", "양파", 10, 1300, 13000), // 단가 다름
  ],
  cp,
  { salesTotal: 75000 }
);
console.log("level:", t3.level);
console.log("dates:", t3.dates);
console.log("items:", t3.items);
console.log("summary:", summarizeComparison(t3));

console.log("\n═══ Test 4: 시스템 누락 (missing_in_system) ═══");
const t4 = compareWithSystem(
  [
    ocr("2024-04-01", "삼겹살", 5, 12000, 60000),
    ocr("2024-04-02", "양파", 10, 1500, 15000),
    ocr("2024-04-02", "마늘", 2, 3000, 6000), // 시스템엔 없음
  ],
  [sys("2024-04-01", "삼겹살", 5, 12000, 60000), sys("2024-04-02", "양파", 10, 1500, 15000)],
  cp,
  {}
);
console.log("level:", t4.level);
console.log("items:", t4.items);
console.log("summary:", summarizeComparison(t4));

console.log("\n═══ Test 5: 부가세 (basis=total → 시스템 ×1.1) ═══");
const t5 = compareWithSystem(
  [ocr("2024-04-01", "삼겹살", 5, 13200, 66000)],
  [sys("2024-04-01", "삼겹살", 5, 12000, 60000)],
  { settlementBasis: "total", settlementMatchTolerance: 100 },
  {}
);
console.log("level:", t5.level, "monthly:", t5.monthly);
// monthly.system은 60000 * 1.1 = 66000으로 변환되어 일치해야 함
console.log("OK:", t5.level === "monthly_match" ? "PASS" : "FAIL");

console.log("\n═══ Test 6: 유사도 매칭 (정규화) ═══");
const t6 = compareWithSystem(
  [ocr("2024-04-01", "삼겹살(국내산)", 5, 12000, 60000)],
  [sys("2024-04-01", "삼겹살", 5, 12000, 60000)],
  cp,
  { salesTotal: 60100 } // 100원 안에 들어가지만 강제로 mismatch 만들어 item 단계까지 가게
);
console.log("level:", t6.level, "monthly:", t6.monthly);
// 100원 차이 → tolerance 100 이하 → monthly_match 가 정상
