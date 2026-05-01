// 월매입정산표 OCR 결과 vs 시스템 매입(purchase_orders_v2) 3-level 비교 알고리즘
// Level 1: 월합계 → Level 2: 일자별 → Level 3: 항목 단위 (불일치 일자만)

export interface ParsedItem {
  date: string; // YYYY-MM-DD
  rawItemName: string;
  itemName: string;
  spec: string | null;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number;
  taxType: "taxable" | "exempt" | "unknown";
  uncertain: boolean;
  confidence: number;
}

export interface SystemPurchaseItem {
  purchaseOrderId: number;
  itemRowId: number; // purchase_order_items_v2.id
  itemName: string; // rawItemName 또는 items.name (조인 결과)
  itemId: number | null;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number;
  date: string; // YYYY-MM-DD (purchaseOrders.purchaseDate)
}

export interface DateRow {
  date: string;
  ocrTotal: number;
  systemTotal: number;
  diff: number;
  ok: boolean;
}

export type ItemDiffKind =
  | "match"
  | "amount_diff"
  | "missing_in_system"
  | "missing_in_statement";

export interface ItemDiff {
  kind: ItemDiffKind;
  date: string;
  ocrItem?: ParsedItem;
  systemItem?: SystemPurchaseItem;
  diff?: number; // ocr - system
}

export interface ComparisonResult {
  level: "monthly_match" | "date_mismatch" | "item_mismatch";
  monthly: { ocr: number; system: number; diff: number; ok: boolean; tolerance: number };
  dates?: DateRow[];
  items?: ItemDiff[];
}

export interface CounterpartyForCompare {
  settlementBasis: "supply" | "total" | "mixed";
  settlementMatchTolerance: number;
}

// ─── 한글 정규화 (ocr.ts와 동일 정책) ───────────────────────────────────────
function normalizeKorean(s: string): string {
  return s.replace(/\s+/g, "").replace(/[()（）\[\]]/g, "").toLowerCase();
}

// ─── 퍼지 유사도 (Levenshtein 기반) ─────────────────────────────────────────
function fuzzyScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const minLen = Math.min(a.length, b.length);
  if (minLen <= 2) return 0;
  if (a.includes(b) || b.includes(a)) {
    const longer = Math.max(a.length, b.length);
    const ratio = minLen / longer;
    if (ratio < 0.6) return 0;
    return ratio;
  }
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

// ─── 부가세 처리: settlementBasis별로 시스템 lineTotal 변환 ────────────────
// ocr lineTotal은 정산표상 금액 그대로. 시스템 매입을 정산표 기준으로 변환해서 비교.
function convertSystemLineTotal(
  systemLineTotal: number,
  basis: "supply" | "total" | "mixed",
  taxType?: "taxable" | "exempt" | "unknown"
): number {
  if (basis === "supply") return systemLineTotal;
  if (basis === "total") return Math.round(systemLineTotal * 1.1);
  // mixed: 1차 구현은 보류 — taxable이면 1.1배, exempt이면 그대로, unknown이면 그대로
  if (taxType === "taxable") return Math.round(systemLineTotal * 1.1);
  return systemLineTotal;
}

// ─── 일자별 그룹핑 ───────────────────────────────────────────────────────────
function groupByDate<T extends { date: string }>(arr: T[]): Record<string, T[]> {
  const map: Record<string, T[]> = {};
  for (const x of arr) {
    if (!x.date) continue;
    if (!map[x.date]) map[x.date] = [];
    map[x.date].push(x);
  }
  return map;
}

function sumLineTotal(arr: { lineTotal: number }[]): number {
  return arr.reduce((s, x) => s + (x.lineTotal || 0), 0);
}

// ─── 항목 매칭: 같은 일자 내 OCR 항목과 시스템 항목을 1:1 매칭 ──────────────
// 정책: 정규화된 itemName 우선 → 유사도 ≥0.6
function matchItemsByName(
  ocrItems: ParsedItem[],
  systemItems: SystemPurchaseItem[]
): { ocr?: ParsedItem; system?: SystemPurchaseItem }[] {
  const matched: { ocr?: ParsedItem; system?: SystemPurchaseItem }[] = [];
  const usedSystem = new Set<number>(); // itemRowId
  const usedOcr = new Set<number>(); // index in ocrItems

  // Pass 1: 완전 일치 (정규화된 이름)
  ocrItems.forEach((ocr, i) => {
    if (usedOcr.has(i)) return;
    const ocrNorm = normalizeKorean(ocr.itemName);
    if (!ocrNorm) return;
    const exactMatch = systemItems.find(
      (s) => !usedSystem.has(s.itemRowId) && normalizeKorean(s.itemName) === ocrNorm
    );
    if (exactMatch) {
      matched.push({ ocr, system: exactMatch });
      usedOcr.add(i);
      usedSystem.add(exactMatch.itemRowId);
    }
  });

  // Pass 2: 유사도 매칭 (≥0.6)
  ocrItems.forEach((ocr, i) => {
    if (usedOcr.has(i)) return;
    const ocrNorm = normalizeKorean(ocr.itemName);
    if (!ocrNorm) return;
    let best: { sys: SystemPurchaseItem; score: number } | null = null;
    for (const sys of systemItems) {
      if (usedSystem.has(sys.itemRowId)) continue;
      const sysNorm = normalizeKorean(sys.itemName);
      const score = fuzzyScore(ocrNorm, sysNorm);
      if (score >= 0.6 && (!best || score > best.score)) {
        best = { sys, score };
      }
    }
    if (best) {
      matched.push({ ocr, system: best.sys });
      usedOcr.add(i);
      usedSystem.add(best.sys.itemRowId);
    }
  });

  // Pass 3: 미매칭 OCR (시스템 누락 후보)
  ocrItems.forEach((ocr, i) => {
    if (!usedOcr.has(i)) matched.push({ ocr });
  });

  // Pass 4: 미매칭 시스템 (정산표 누락 후보)
  for (const sys of systemItems) {
    if (!usedSystem.has(sys.itemRowId)) matched.push({ system: sys });
  }

  return matched;
}

// ─── 메인 비교 함수 ─────────────────────────────────────────────────────────
export function compareWithSystem(
  ocrItems: ParsedItem[],
  systemPurchases: SystemPurchaseItem[],
  counterparty: CounterpartyForCompare,
  monthlySummary: { salesTotal?: number | null; paymentTotal?: number | null; balance?: number | null }
): ComparisonResult {
  const tol = counterparty.settlementMatchTolerance ?? 100;
  const basis = counterparty.settlementBasis ?? "supply";

  // ── Level 1: 월합계 ────────────────────────────────────────────────────
  const ocrMonthTotal = monthlySummary?.salesTotal != null
    ? monthlySummary.salesTotal
    : sumLineTotal(ocrItems);

  const sysMonthTotalRaw = sumLineTotal(systemPurchases);
  // 시스템 합계를 정산표 기준으로 변환 (전체 평균 — mixed는 항목별 처리지만 합계 단계에선 raw 사용)
  const sysMonthTotal = basis === "total"
    ? Math.round(sysMonthTotalRaw * 1.1)
    : sysMonthTotalRaw;

  const monthly = {
    ocr: ocrMonthTotal,
    system: sysMonthTotal,
    diff: ocrMonthTotal - sysMonthTotal,
    ok: Math.abs(ocrMonthTotal - sysMonthTotal) <= tol,
    tolerance: tol,
  };

  if (monthly.ok) {
    return { level: "monthly_match", monthly };
  }

  // ── Level 2: 일자별 합계 ─────────────────────────────────────────────────
  const ocrByDate = groupByDate(ocrItems);
  const sysByDate = groupByDate(systemPurchases);
  const allDates = Array.from(new Set([...Object.keys(ocrByDate), ...Object.keys(sysByDate)])).sort();

  const dateRows: DateRow[] = allDates.map((d) => {
    const o = sumLineTotal(ocrByDate[d] ?? []);
    const sRaw = sumLineTotal(sysByDate[d] ?? []);
    const s = basis === "total" ? Math.round(sRaw * 1.1) : sRaw;
    const diff = o - s;
    return { date: d, ocrTotal: o, systemTotal: s, diff, ok: Math.abs(diff) <= tol };
  });

  const mismatchDates = dateRows.filter((r) => !r.ok);
  if (mismatchDates.length === 0) {
    // 일자별로는 모두 맞는데 월합계만 다름 — 합계 계산 오차
    return { level: "date_mismatch", monthly, dates: dateRows };
  }

  // ── Level 3: 항목 단위 (불일치 일자만) ──────────────────────────────────
  const itemRows: ItemDiff[] = [];
  for (const dRow of mismatchDates) {
    const ocrOfDate = (ocrByDate[dRow.date] ?? []) as ParsedItem[];
    const sysOfDate = (sysByDate[dRow.date] ?? []) as SystemPurchaseItem[];
    const matched = matchItemsByName(ocrOfDate, sysOfDate);

    for (const m of matched) {
      if (m.ocr && m.system) {
        const sysAdjusted = convertSystemLineTotal(m.system.lineTotal, basis, m.ocr.taxType);
        const diff = m.ocr.lineTotal - sysAdjusted;
        if (Math.abs(diff) <= tol) {
          itemRows.push({ kind: "match", date: dRow.date, ocrItem: m.ocr, systemItem: m.system, diff });
        } else {
          itemRows.push({ kind: "amount_diff", date: dRow.date, ocrItem: m.ocr, systemItem: m.system, diff });
        }
      } else if (m.ocr && !m.system) {
        itemRows.push({ kind: "missing_in_system", date: dRow.date, ocrItem: m.ocr });
      } else if (!m.ocr && m.system) {
        itemRows.push({ kind: "missing_in_statement", date: dRow.date, systemItem: m.system });
      }
    }
  }

  return { level: "item_mismatch", monthly, dates: dateRows, items: itemRows };
}

// ─── 결과 요약 (audit.diffSummary용) ─────────────────────────────────────────
export function summarizeComparison(comp: ComparisonResult) {
  return {
    level: comp.level,
    monthlyOk: comp.monthly.ok,
    monthlyDiff: comp.monthly.diff,
    dateMismatchCount: comp.dates?.filter((d) => !d.ok).length ?? 0,
    itemMismatches: {
      amountDiff: comp.items?.filter((i) => i.kind === "amount_diff").length ?? 0,
      missingInSystem: comp.items?.filter((i) => i.kind === "missing_in_system").length ?? 0,
      missingInStatement: comp.items?.filter((i) => i.kind === "missing_in_statement").length ?? 0,
      match: comp.items?.filter((i) => i.kind === "match").length ?? 0,
    },
  };
}
