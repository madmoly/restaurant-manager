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
  itemId: number | null;
  // 매칭 우선순위별 후보 이름 (spec §3.3)
  // ① supplierItemName: counterparty_items.supplierItemName (alias, 1·2순위)
  // ② masterItemName: items.name (마스터, 3·4순위)
  // ③ rawPurchaseName: purchase_order_items_v2.rawItemName (입력 시 원본, 폴백)
  supplierItemName: string | null;
  masterItemName: string | null;
  rawPurchaseName: string | null;
  // 표시용 통합 이름 (UI 디버깅)
  itemName: string;
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

export type ComparisonWarning =
  | "ocr_items_partial"      // OCR이 footer 합계는 읽었지만 items 합이 5%+ 차이 → 라인 누락 의심
  | "ocr_no_summary"         // monthlySummary.salesTotal 자체가 null → footer 합계 미추출
  | "system_only_diff";      // 1~4섹션 비고 정상만 있는데 monthly diff가 있음 → 사용자 액션 경로 차단 경고

export interface ComparisonResult {
  level: "monthly_match" | "date_mismatch" | "item_mismatch";
  monthly: { ocr: number; system: number; diff: number; ok: boolean; tolerance: number };
  dates?: DateRow[];
  items?: ItemDiff[];
  warnings?: ComparisonWarning[];
  ocrItemsSum?: number;       // sum(items.lineTotal) — UI에서 footer 합계와 비교 노출용
  ocrSummaryTotal?: number | null; // monthlySummary.salesTotal 원본
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
//
// spec §3.3 매칭 우선순위 (확정):
//   ① counterparty_items.supplierItemName 정확 일치 (정규화 후) — OCR rawItemName 기준
//   ② counterparty_items.supplierItemName 유사도 ≥ 0.85
//   ③ items.name 정확 일치 — OCR itemName 기준
//   ④ items.name 유사도 ≥ 0.85
//   ⑤ rawPurchaseName 정확 일치 (alias 미학습 폴백)
//   ⑥ 위 모두 실패 → 미매칭
//
// 각 pass는 이전 pass에서 매칭된 항목을 제외하고 진행 (1:1 강제, 그리디).
// Pass 내에서는 유사도 점수가 가장 높은 후보를 선택.
const FUZZY_THRESHOLD = 0.85;

type MatchPair = { ocr?: ParsedItem; system?: SystemPurchaseItem; passUsed?: number };

function pickBest(
  ocrKey: string,
  systemItems: SystemPurchaseItem[],
  usedSystem: Set<number>,
  getter: (s: SystemPurchaseItem) => string | null,
  exactOnly: boolean
): SystemPurchaseItem | null {
  if (!ocrKey) return null;
  let best: { sys: SystemPurchaseItem; score: number } | null = null;
  for (const sys of systemItems) {
    if (usedSystem.has(sys.itemRowId)) continue;
    const raw = getter(sys);
    if (!raw) continue;
    const sysNorm = normalizeKorean(raw);
    if (!sysNorm) continue;
    if (exactOnly) {
      if (sysNorm === ocrKey) return sys;
    } else {
      const score = fuzzyScore(ocrKey, sysNorm);
      if (score >= FUZZY_THRESHOLD && (!best || score > best.score)) {
        best = { sys, score };
      }
    }
  }
  return best?.sys ?? null;
}

function matchItemsByName(
  ocrItems: ParsedItem[],
  systemItems: SystemPurchaseItem[]
): MatchPair[] {
  const matched: MatchPair[] = [];
  const usedSystem = new Set<number>();
  const usedOcr = new Set<number>();

  // 5개 pass를 순서대로 적용. 각 pass에서 OCR ↔ system을 1:1 매칭.
  type Pass = {
    n: number;
    ocrKey: (o: ParsedItem) => string;       // OCR 측 비교 키 추출
    sysGet: (s: SystemPurchaseItem) => string | null; // system 측 후보 필드
    exactOnly: boolean;
  };
  const passes: Pass[] = [
    { n: 1, ocrKey: (o) => normalizeKorean(o.rawItemName || o.itemName), sysGet: (s) => s.supplierItemName, exactOnly: true },
    { n: 2, ocrKey: (o) => normalizeKorean(o.rawItemName || o.itemName), sysGet: (s) => s.supplierItemName, exactOnly: false },
    { n: 3, ocrKey: (o) => normalizeKorean(o.itemName || o.rawItemName), sysGet: (s) => s.masterItemName,   exactOnly: true },
    { n: 4, ocrKey: (o) => normalizeKorean(o.itemName || o.rawItemName), sysGet: (s) => s.masterItemName,   exactOnly: false },
    { n: 5, ocrKey: (o) => normalizeKorean(o.rawItemName || o.itemName), sysGet: (s) => s.rawPurchaseName,  exactOnly: true },
  ];

  for (const pass of passes) {
    ocrItems.forEach((ocr, i) => {
      if (usedOcr.has(i)) return;
      const key = pass.ocrKey(ocr);
      if (!key) return;
      const hit = pickBest(key, systemItems, usedSystem, pass.sysGet, pass.exactOnly);
      if (hit) {
        matched.push({ ocr, system: hit, passUsed: pass.n });
        usedOcr.add(i);
        usedSystem.add(hit.itemRowId);
      }
    });
  }

  // 미매칭 OCR (시스템 누락 후보)
  ocrItems.forEach((ocr, i) => {
    if (!usedOcr.has(i)) matched.push({ ocr });
  });

  // 미매칭 시스템 (정산표 누락 후보)
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
  const ocrItemsSum = sumLineTotal(ocrItems);
  const ocrSummaryTotal = monthlySummary?.salesTotal ?? null;
  const ocrMonthTotal = ocrSummaryTotal != null ? ocrSummaryTotal : ocrItemsSum;

  // OCR items 합 vs footer 합계 검증: 5% 이상 차이면 라인 누락 의심
  const warnings: ComparisonWarning[] = [];
  if (ocrSummaryTotal == null) {
    warnings.push("ocr_no_summary");
  } else if (ocrSummaryTotal > 0) {
    const diffRatio = Math.abs(ocrItemsSum - ocrSummaryTotal) / Math.max(ocrSummaryTotal, ocrItemsSum);
    if (diffRatio > 0.05) warnings.push("ocr_items_partial");
  }

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
    return { level: "monthly_match", monthly, warnings: warnings.length ? warnings : undefined, ocrItemsSum, ocrSummaryTotal };
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
    return { level: "date_mismatch", monthly, dates: dateRows, warnings: warnings.length ? warnings : undefined, ocrItemsSum, ocrSummaryTotal };
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

  // Level 3까지 와서 모든 항목이 match인데 monthly diff가 있으면
  // → 1~4 액션 섹션이 비어 사용자 액션 경로 차단. 경고 추가.
  const actionableCount = itemRows.filter(
    (r) => r.kind === "amount_diff" || r.kind === "missing_in_system" || r.kind === "missing_in_statement"
  ).length;
  if (actionableCount === 0 && !monthly.ok) warnings.push("system_only_diff");

  return {
    level: "item_mismatch",
    monthly,
    dates: dateRows,
    items: itemRows,
    warnings: warnings.length ? warnings : undefined,
    ocrItemsSum,
    ocrSummaryTotal,
  };
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
