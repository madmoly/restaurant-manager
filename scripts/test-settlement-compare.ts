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
function sys(
  date: string,
  name: string,
  qty: number,
  price: number,
  total?: number,
  opts?: { supplierItemName?: string | null; masterItemName?: string | null; rawPurchaseName?: string | null }
): SystemPurchaseItem {
  return {
    purchaseOrderId: 1,
    itemRowId: nextRowId++,
    itemId: null,
    // 인자 없으면 name이 masterItemName으로 들어가 Pass 3 (master 정확 일치) 매칭이 동작
    supplierItemName: opts?.supplierItemName ?? null,
    masterItemName: opts?.masterItemName ?? name,
    rawPurchaseName: opts?.rawPurchaseName ?? name,
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

// ── Phase B: 매칭 우선순위 5단계 검증 ──────────────────────────────────────
console.log("\n═══ Test 7: alias hit (Pass 1 supplierItemName 정확 일치) ═══");
{
  // OCR rawItemName이 거래처 고유 표기, 시스템엔 동일 표기가 supplierItemName으로 학습됨.
  // lineTotal을 다르게 두어 amount_diff로 분류되며 매칭 자체는 Pass 1로 잡혀야 함.
  const ocrItems: ParsedItem[] = [
    ocr("2024-04-05", "한돈오겹(국)1kg", 3, 13500, 40500),
  ];
  const systemItems: SystemPurchaseItem[] = [
    sys("2024-04-05", "삼겹살", 3, 13000, 39000, { supplierItemName: "한돈오겹(국)1kg", masterItemName: "삼겹살", rawPurchaseName: "삼겹살국내산" }),
  ];
  const t7 = compareWithSystem(ocrItems, systemItems, cp, { salesTotal: 40500 });
  console.log("level:", t7.level);
  console.log("items:", t7.items?.map((it) => ({ kind: it.kind, ocr: it.ocrItem?.rawItemName, sys: it.systemItem?.supplierItemName, diff: it.diff })));
  const amountDiff = t7.items?.find((i) => i.kind === "amount_diff");
  console.log("OK:", amountDiff?.systemItem?.supplierItemName === "한돈오겹(국)1kg" && amountDiff.diff === 1500 ? "PASS — Pass 1 alias hit (amount_diff)" : "FAIL");
}

console.log("\n═══ Test 8: alias 미학습 → masterItemName fallback (Pass 3) ═══");
{
  // OCR itemName == 시스템 masterItemName 정확 일치 (Pass 3). lineTotal 차이로 amount_diff.
  const ocrItems: ParsedItem[] = [
    ocr("2024-04-05", "양배추", 1, 9500, 9500),
  ];
  const systemItems: SystemPurchaseItem[] = [
    sys("2024-04-05", "양배추(매입입력시 표기)", 1, 9000, 9000, { supplierItemName: null, masterItemName: "양배추", rawPurchaseName: "양배추(매입입력시 표기)" }),
  ];
  const t8 = compareWithSystem(ocrItems, systemItems, cp, { salesTotal: 9500 });
  console.log("level:", t8.level);
  console.log("items:", t8.items?.map((it) => ({ kind: it.kind, ocr: it.ocrItem?.itemName, master: it.systemItem?.masterItemName, supplier: it.systemItem?.supplierItemName, diff: it.diff })));
  const amountDiff = t8.items?.find((i) => i.kind === "amount_diff");
  console.log("OK:", amountDiff?.systemItem?.masterItemName === "양배추" && amountDiff?.systemItem?.supplierItemName === null ? "PASS — Pass 3 master hit" : "FAIL");
}

console.log("\n═══ Test 9: alias 충돌 회피 — 다른 alias 가진 항목과 안 섞임 ═══");
{
  // OCR "신상품"은 어느 supplierItemName과도 정확/유사 매칭 안 됨 → missing_in_system
  const ocrItems: ParsedItem[] = [
    ocr("2024-04-05", "신상품", 1, 5000, 5000),
  ];
  const systemItems: SystemPurchaseItem[] = [
    sys("2024-04-05", "삼겹살", 3, 13000, 39000, { supplierItemName: "한돈오겹(국)1kg", masterItemName: "삼겹살" }),
  ];
  const t9 = compareWithSystem(ocrItems, systemItems, cp, { salesTotal: 5000 });
  console.log("level:", t9.level);
  console.log("items:", t9.items);
  const missing = t9.items?.find((i) => i.kind === "missing_in_system");
  const stillMissingSys = t9.items?.find((i) => i.kind === "missing_in_statement");
  console.log("OK:", missing && stillMissingSys ? "PASS — 잘못된 매칭 발생 안 함" : "FAIL");
}
