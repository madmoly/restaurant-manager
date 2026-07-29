# 핸드오프 — 매입전표 OCR 정확도 3건 (줄바꿈 품목 / 과세·면세 / 합계 정합)

> 작성: 2026-07-29 Cowork (설계만, 소스 미수정)
> 대상 세션: Claude Code
> 관련: `docs/ocr-improvement-plan.md`, CLAUDE.md §14
> 사용자 승인 완료 사항: ① 과세/면세는 **DB 저장까지** ② 합계 불일치는 **산술 자동보정 + 수동 재분석 버튼**(자동 재호출 아님)

---

## 0. 핵심 판단

요청 3건은 각각 다른 레이어의 결손이다. 하나의 패치로 묶이지 않는다.

| # | 증상 | 실제 결손 위치 |
|---|---|---|
| 1 | 긴 품목명이 두 줄 → 두 품목으로 분리 | Upstage 표 파싱 결과의 후처리 규칙 부재 (프롬프트 H1의 역방향 케이스가 없음) |
| 2 | 과세/면세 표기 없음 | 데이터 모델 결손. `lineTotal` 하나에 공급가+부가세를 뭉개 놔서 **행 단위 세구분을 판정할 근거 자체가 없음** |
| 3 | 합계 불일치 방치 | 검증 결과가 사용자에게 도달하지 않음. 서버가 감지하고도 `console.warn` + confidence 강등으로만 소비 |

**가장 큰 문제는 3번이다.** 현재 `validateAndEnrichItems`(server/ocr.ts:452~466)는 문서 합계와 항목 합산의 차이를 계산하고도 응답에 싣지 않는다. 그래서 1번(행 분리)으로 항목이 하나 늘거나 금액이 빠져도 사용자가 보는 건 노란 카드뿐이고, 얼마가 어긋났는지 알 수 없다. 3번을 먼저 세워야 1·2번의 개선 효과를 측정할 수 있다.

**2번은 1·3번의 선행 조건이기도 하다.** 합계 불일치 자동보정 중 "부가세 미합산" 케이스는 전 항목에 ×1.1을 적용하는데, 면세 항목이 섞인 전표에서는 이 보정이 오히려 틀린 값을 만든다. 행 단위 `taxType`이 있어야 taxable 행만 골라 보정할 수 있다.

**작업 순서: Phase 1(줄바꿈, 독립) → Phase 2(과세/면세, 스키마) → Phase 3(합계 정합, Phase 2 의존).**

---

## 1. 현행 코드 지도 (수정 대상)

| 파일 | 위치 | 역할 |
|---|---|---|
| `server/ocr-engines/prompts.ts` | `promptV2` STEP 3 (44~78행) | Upstage 텍스트 → Claude 구조화. H1~H5 휴리스틱 |
| `server/ocr-engines/prompts.ts` | `promptV1ImageFallback` | Vision 폴백 (Upstage 실패 시에만) |
| `server/ocr-engines/upstage.ts` | `buildClaudeContext` (201~220행) | markdown 먼저, 표 HTML 나중 순서로 컨텍스트 구성 |
| `server/ocr-engines/hybrid.ts` | `runHybridOcr` (79~114행) | Upstage + Claude를 한 함수에서 원자적으로 실행 → **재분석 시 Upstage 재호출을 피하려면 분리 필요** |
| `server/ocr.ts` | `validateAndEnrichItems` (326~469행) | 서버 검증. summary 크로스체크가 여기 있음 |
| `server/ocr.ts` | `/extract-purchase` 응답 조립 (971~979행) | `totals` 미포함 |
| `server/routers/purchasesV2.ts` | item zod 스키마 3곳 (206, 318, 427행) / insert 3곳 (254, 364, 464행) | createOrder / receiveOrder / updateReceivedItems |
| `drizzle/schema.ts` | `purchaseOrderItemsV2` (678~693행) | 세구분 컬럼 없음 |
| `client/src/pages/DailyOpsPage.tsx` | 1482~1508 (프리필), 1544~1601 (저장), 2479~2486 (합계 표시), 2491~2510 (카드/뱃지) | OCR 확인 UI |

**참고**: 월정산표 경로(`/extract-statement`, ocr.ts:1121, 1234)에는 이미 `taxType: taxable|exempt|unknown` 이 있다. **동일한 enum 값을 재사용할 것.** 새 어휘 만들지 말 것.

---

## Phase 1 — 줄바꿈 품목명 오분리

### 1-1. 원인 확정 (선행 · 추정 금지)

원인은 아직 **미확정**이다. 다음 세 가지 중 하나이며, 어느 것이냐에 따라 고칠 곳이 다르다.

실패한 전표 이미지 1~2장으로 Upstage raw 응답을 덤프하고 표 HTML을 직접 확인한다.

- **(a) 셀 내부 줄바꿈 유지형** — `<td>긴품목명<br>나머지</td>`
  → Claude가 `<br>`을 행 구분으로 오해. 프롬프트에 "셀 내 `<br>`/개행은 같은 품목명" 명시 + 서버에서 `\n` → 공백 제거 정규화.
- **(b) 행 분해형** — `<tr><td>긴품목명</td><td></td>…</tr><tr><td>나머지</td><td></td>…</tr>`
  → 1-2, 1-3 전부 필요.
- **(c) markdown만 깨짐** — 표 HTML은 정상인데 `content.markdown`에서 행 경계 소실
  → `buildClaudeContext`의 배치 순서 교체(1-2 ③)만으로 해소 가능.

**완료 조건**: 어느 케이스인지 실제 Upstage 응답 로그로 확정하고, 이 문서 하단 "실행 로그"에 한 줄 기록.

### 1-2. 프롬프트 수정 (`prompts.ts`)

`promptV2` STEP 3 휴리스틱에 **H6**을 추가. H1 바로 뒤(역방향 케이스이므로 인접 배치).

```
**[H6] 품목명 줄바꿈 분리 복원 (중요)**
  긴 품목명이 셀 폭을 넘어 두 행으로 쪼개지는 경우가 잦습니다.
  판정: 어떤 행에 품목명 텍스트만 있고 수량·단가·공급가액·부가세·합계 칸이
        **전부 비어 있으면**, 그 행은 독립 품목이 아니라 **직전 행 품목명의 이어짐**입니다.
  처리: 직전 행의 shortName/originalName 뒤에 이어붙이고, 그 행 자체는 items에서 제거.
        병합한 항목은 mergedFrom="H6", uncertain=true 로 표시.
  금지: 숫자 칸 중 하나라도 값이 있으면 절대 병합하지 마세요 (별개 품목입니다).
  예외: 텍스트가 "합계/소계/부가세/총계/이월/잔액"이면 H6이 아니라 H4로 처리.
  참고: 표 HTML의 한 셀 안에 <br> 또는 줄바꿈이 있으면 그것은 처음부터 하나의 품목명입니다.
        절대 두 품목으로 쪼개지 마세요.
```

`promptV1ImageFallback`(Vision 경로)에도 같은 취지의 1문단을 "## ⚠ 한글 인식 규칙" 아래에 추가:

```
**품목명 줄바꿈**: 한 품목명이 칸 안에서 두 줄로 접혀 있으면 하나의 품목입니다.
아랫줄에 수량·단가·금액이 없으면 윗줄 품목명의 연속입니다. 별개 항목으로 세지 마세요.
```

③ `buildClaudeContext`(upstage.ts:201) 순서 교체 — 표 HTML을 먼저, markdown을 보조로:

```ts
if (parsed.tablesHtml.length > 0) {
  parts.push("## 표 원본 HTML (셀 경계 기준 — 행/열 판정은 반드시 이 HTML을 우선)");
  parsed.tablesHtml.forEach((html, i) => parts.push(`### Table ${i + 1}\n${html}`));
}
parts.push("\n## 문서 전체 (Upstage markdown — 보조 문맥용. 행 경계 판정에는 사용 금지)");
parts.push(parsed.markdown);
```

### 1-3. 서버 결정론적 가드 (`server/ocr.ts`)

프롬프트만으로는 보장이 안 된다. `validateAndEnrichItems` 호출 **직전**에 순수 함수로 한 번 더 거른다.

```ts
/** 수량·단가·금액이 전부 비어 있고 품목명만 있는 행 → 직전 행 이름에 병합 (H6 서버 가드) */
export function mergeWrappedNameRows(items: any[]): any[] {
  const NUM_KEYS = ["quantity", "unitPrice", "lineTotal", "supplyAmount", "vatAmount"];
  const SUMMARY_RE = /^(합\s*계|소\s*계|총\s*계|총\s*합|부가세|공급가액|이월|잔액|total|subtotal)/i;
  const out: any[] = [];
  for (const it of items) {
    const hasNum = NUM_KEYS.some((k) => {
      const v = String(it?.[k] ?? "").replace(/[,\s원]/g, "");
      return v !== "" && Number.isFinite(Number(v)) && Number(v) !== 0;
    });
    const name = String(it?.shortName || it?.name || "").replace(/\s+/g, " ").trim();
    if (!hasNum && name && !SUMMARY_RE.test(name) && out.length > 0) {
      const prev = out[out.length - 1];
      const fragment = name;
      prev.shortName = `${String(prev.shortName || "").trim()}${fragment}`;
      prev.originalName = `${String(prev.originalName || "").trim()}${fragment}`;
      prev.uncertain = true;
      prev.mergedFrom = [prev.mergedFrom, "H6-server"].filter(Boolean).join(",");
      console.log(`[OCR] H6 서버 병합: "${fragment}" → "${prev.shortName}"`);
      continue;
    }
    out.push(it);
  }
  return out;
}
```

호출 지점 (ocr.ts:920):

```ts
let items = validateAndEnrichItems(
  mergeWrappedNameRows(Array.isArray(parsed.items) ? parsed.items : []),
  parsed.summary || null
);
```

**의도적 부작용과 그 완화**: 수량·단가를 진짜로 못 읽은 정상 행도 흡수된다. 그래서 `uncertain = true`를 강제해 confidence가 medium 이하로 떨어지고, UI에서 노란/빨간 카드로 사용자 눈에 걸리게 만든다. 조용히 삼키지 않는 것이 설계 의도다.

**놓치기 쉬운 지점**: `purchase_order_items_v2.rawItemName`은 `varchar(100)`이다. 병합 후 100자를 넘으면 insert가 깨진다. `purchasesV2.ts` 3개 insert 지점 모두에서 `rawItemName?.slice(0, 100)` 처리할 것. (또는 클라이언트 저장 매핑에서.)

### Phase 1 완료 조건

- 실패 샘플 재분석 시 추출 항목 수 = 전표 실제 행 수
- 병합된 항목이 UI에서 "확인 필요" 표시로 노출
- **회귀**: 정상 전표 3장 이상에서 항목 수가 이전과 동일 (오탐 없음)
- `pnpm run build` 통과

---

## Phase 2 — 과세/면세 (DB 저장까지)

### 2-1. 설계 판단: `taxType`만 추가하면 안 된다

`taxType` 하나만 붙이면 모델의 추측을 그대로 DB에 박게 된다. 검증 가능한 근거가 없기 때문이다. 현재 `lineTotal` 정의는 "공급가 + 부가세"(CLAUDE.md §14)라서 행 단위 부가세가 얼마인지 복원할 수 없다.

→ **`supplyAmount`(공급가액) / `vatAmount`(부가세액)를 함께 추출·저장한다.** 이 둘이 있으면 `taxType`은 계산으로 검증되고, 3-2의 부가세 자동보정도 안전해진다.

`lineTotal` 정의는 **변경하지 않는다** (기존 축적 데이터 호환).

### 2-2. 스키마 (`drizzle/schema.ts` purchaseOrderItemsV2)

```ts
  lineTotal: decimal("lineTotal", { precision: 14, scale: 2 }).notNull(), // 기존: 공급가+부가세
  supplyAmount: decimal("supplyAmount", { precision: 14, scale: 2 }),     // 신규 nullable
  vatAmount: decimal("vatAmount", { precision: 14, scale: 2 }),           // 신규 nullable
  taxType: mysqlEnum("taxType", ["taxable", "exempt", "unknown"]).default("unknown").notNull(),
```

`supplyAmount`/`vatAmount`를 nullable로 두는 이유: 과거 행은 NULL = "분류 안 됨"이고, `0`(면세 확정)과 구분되어야 한다.

### 2-3. 자동 마이그레이션 (`server/index.ts`)

⚠ **CLAUDE.md §13의 `ADD COLUMN IF NOT EXISTS` 예시를 따르지 말 것.** MySQL 8은 그 문법을 지원하지 않으며, `.catch(() => {})` 때문에 syntax error가 조용히 삼켜져 컬럼이 생기지 않는다. index.ts:24에 이미 올바른 헬퍼 `addColumnIfNotExists(table, column, definition)`가 있다. 이것을 쓴다.

```ts
await addColumnIfNotExists("purchase_order_items_v2", "supplyAmount", "DECIMAL(14,2) NULL");
await addColumnIfNotExists("purchase_order_items_v2", "vatAmount", "DECIMAL(14,2) NULL");
await addColumnIfNotExists("purchase_order_items_v2", "taxType",
  "ENUM('taxable','exempt','unknown') NOT NULL DEFAULT 'unknown'");
```

(별건이지만 CLAUDE.md §13의 예시 코드는 이번 기회에 헬퍼 사용으로 고쳐두는 편이 낫다. 같은 함정을 반복 유발한다.)

### 2-4. 프롬프트 (`prompts.ts` — promptV2 / promptV1 양쪽 items 스키마)

출력 필드 추가:

```
"supplyAmount": "공급가액(부가세 제외, 숫자 문자열). 해당 컬럼이 없으면 null",
"vatAmount": "부가세액(숫자 문자열). 부가세 컬럼이 없거나 판독 불가면 0이 아니라 null",
"taxType": "taxable | exempt | unknown",
```

판정 규칙을 STEP으로 명시 (STEP 3 뒤, STEP 4 앞):

```
### STEP 3.5: 과세/면세 판정

우선순위대로 적용하고, 근거가 없으면 반드시 "unknown"으로 두세요. **추측 금지.**

1. 전표에 세구분 컬럼이 있으면 그대로 사용
   (표기 예: "과"/"면", "과세"/"면세", "T"/"E", "V"/"X", "10%"/"0%")
2. 세구분 컬럼은 없지만 **행별 부가세 컬럼**이 있으면:
   - 부가세 > 0 → "taxable"
   - 부가세가 0 또는 "-" 또는 빈칸인데, 같은 표의 다른 행에는 부가세 값이 있음 → "exempt"
3. 행별 부가세 컬럼 자체가 없으면 → "unknown"
   (문서 하단에 부가세 총액만 있는 경우도 행 단위로는 unknown입니다. 안분하지 마세요.)

면세 품목 참고(판정 보조일 뿐, 위 1~3을 뒤집지 마세요):
쌀·잡곡, 신선 채소·과일, 정육(미가공), 생선·수산물(미가공), 계란, 우유(흰우유), 김치 등
가공식품·조미료·소스·음료·주류·일회용품·소모품은 통상 과세
```

### 2-5. 서버 보정 (`ocr.ts` validateAndEnrichItems)

`OcrItem` 인터페이스에 `supplyAmount: string | null; vatAmount: string | null; taxType: "taxable"|"exempt"|"unknown"; vatEstimated?: boolean` 추가하고, 매핑 말미에:

```ts
// ── 과세/면세 보정 ────────────────────────────────────────────────
let taxType: "taxable" | "exempt" | "unknown" =
  ["taxable", "exempt", "unknown"].includes(item.taxType) ? item.taxType : "unknown";
const supply = item.supplyAmount != null && String(item.supplyAmount) !== ""
  ? parseFloat(String(item.supplyAmount).replace(/,/g, "")) : null;
const vat = item.vatAmount != null && String(item.vatAmount) !== ""
  ? parseFloat(String(item.vatAmount).replace(/,/g, "")) : null;
let vatEstimated = false;

// 모델이 unknown으로 뒀지만 부가세 값이 있으면 계산으로 확정
if (taxType === "unknown" && vat != null) taxType = vat > 0 ? "taxable" : "exempt";

// taxable인데 부가세 결측 → 공급가 기준 추정 (플래그 필수)
let vatFinal = vat;
if (taxType === "taxable" && vat == null && supply != null && supply > 0) {
  vatFinal = Math.round(supply * 0.1);
  vatEstimated = true;
}
// 공급가 결측 + lineTotal 존재 시 역산
let supplyFinal = supply;
if (supplyFinal == null && parseFloat(finalTotal) > 0) {
  const t = parseFloat(finalTotal);
  if (taxType === "exempt") supplyFinal = t;
  else if (taxType === "taxable") { supplyFinal = Math.round(t / 1.1); vatEstimated = vatFinal == null || vatEstimated; if (vatFinal == null) vatFinal = t - supplyFinal; }
}
```

**금지 사항**: 문서 하단의 부가세 총액을 행 수로 나눠 안분하지 말 것. 근거 없는 숫자가 DB에 들어간다. 판정 불가는 `unknown` + NULL로 남긴다.

### 2-6. 라우터 (`purchasesV2.ts`)

item zod 스키마 **3곳 전부**(206, 318, 427행)에 동일 필드 추가:

```ts
supplyAmount: z.string().optional(),
vatAmount: z.string().optional(),
taxType: z.enum(["taxable", "exempt", "unknown"]).default("unknown"),
```

insert **3곳 전부**(254, 364, 464행)에 매핑 추가. 빈 문자열은 `null`로 정규화할 것 (`v === "" ? null : v`) — 빈 문자열이 DECIMAL 컬럼에 들어가면 MySQL strict mode에서 실패한다.

### 2-7. 클라이언트 (`DailyOpsPage.tsx`)

- `PurchaseItem` 타입(890행 부근)에 `supplyAmount?`, `vatAmount?`, `taxType?` 추가
- OCR 프리필(1484행)에 `taxType: item.taxType || 'unknown'`, `supplyAmount`, `vatAmount` 전달
- 항목 카드(2502행 부근)에 **클릭 토글 가능한 3-state 뱃지**:

| 값 | 라벨 | 색 |
|---|---|---|
| `taxable` | 과세 | 파랑 (`bg-blue-500/15 text-blue-600`) |
| `exempt` | 면세 | 초록 (`bg-emerald-500/15 text-emerald-600`) |
| `unknown` | 미확인 | 회색 (`bg-muted text-muted-foreground`) |

`vatEstimated === true`이면 뱃지 옆에 "추정" 소형 표시.

**토글은 필수 기능이다.** OCR 오판정을 사용자가 고칠 경로가 없으면 잘못된 세구분이 그대로 DB에 축적된다. 클릭 시 taxable → exempt → unknown 순환.

- 저장 매핑(1569~1577행)에 세 필드 전달
- `submit-correction` 페이로드(1590행)에도 `taxType` 포함 (학습 데이터 축적)

### 2-8. 집계 쪽 영향 (이번 범위 밖, 문서화만)

`monthlyClosings` / `analysis` 라우터는 이번에 건드리지 않는다. 다만 다음을 이 문서에 남기고 별도 이슈로 등록:
`vatAmount IS NULL`은 "부가세 0"이 아니라 **"미분류"**다. 향후 부가세 집계 쿼리에서 `IFNULL(vatAmount, 0)`으로 뭉개면 과거 데이터가 전부 면세로 잡힌다. 별도 버킷으로 분리할 것.

### Phase 2 완료 조건

- 샘플 전표에서 과세/면세 뱃지가 표시되고 클릭 토글 동작
- 저장 후 `SELECT taxType, supplyAmount, vatAmount FROM purchase_order_items_v2 ORDER BY id DESC LIMIT 10` 로 값 확인 (READ-ONLY)
- 기존 매입 등록(비-OCR 수동 입력) 경로가 깨지지 않음 — `taxType` 기본값 `unknown`으로 통과
- `pnpm run build` 통과

---

## Phase 3 — 합계 정합 (자동보정 + 수동 재분석)

### 3-1. 검증 결과를 응답에 싣는다

현행 크로스체크(ocr.ts:452~466)는 5% 허용오차로 confidence만 강등한다. **5%는 너무 헐겁다** — 40만원 전표에서 2만원 오차가 통과한다. 그리고 그 사실이 UI에 전달되지 않는다.

응답 타입 신설:

```ts
export interface OcrTotals {
  docSupply: number | null;   // summary.totalSupply
  docTax: number | null;      // summary.totalTax
  docGrand: number | null;    // summary.grandTotal ?? (docSupply + docTax)
  itemSum: number;            // Σ lineTotal (보정 후)
  diff: number;               // itemSum - docGrand
  status: "match" | "auto_fixed" | "mismatch" | "no_doc_total";
  fixes: string[];            // 사람이 읽는 보정 설명 (한글)
}
```

허용오차: `Math.abs(diff) <= Math.max(10, docGrand * 0.001)` → `match`.
`docGrand`가 null이면 `no_doc_total` (수기전표에서 흔함 — 검증 불가를 정직하게 표시).

`/extract-purchase` 응답(971행 `result`)에 `totals` 추가.

### 3-2. 결정론적 자동보정 `reconcileTotals(items, summary)`

순서대로 시도하고 **정확히 맞는(±10원) 첫 후보에서 종료**. 추가 API 호출 없음, 순수 산술이므로 비용 0.

| 순서 | 케이스 | 판정 | 조치 |
|---|---|---|---|
| (a) | 부가세 미합산 | `Σ(taxable 행 lineTotal)×1.1 + Σ(exempt 행) ≈ docGrand` | **taxable/unknown 행만** lineTotal = round(공급가×1.1) 재계산. exempt 행 제외 |
| (b) | 부가세 이중합산 | `itemSum ≈ docGrand×1.1` | 역보정 |
| (c) | 단일 행 자릿수 오독 | 행 i의 lineTotal에 ×10 / ÷10 / ×100 / ÷100 중 하나를 적용하면 합이 정확히 맞음 | 그 행만 교체 + 해당 행 `confidence="low"` |
| (d) | 중복 행 | `diff`가 어떤 행의 lineTotal과 정확히 일치하고, 동일 품명이 2회 이상 등장 | 중복 후보 제거 |
| (e) | 행 누락 의심 | `docGrand > itemSum`이고 자동 설명 불가 | **자동 추가 금지.** `fixes`에 "행 누락 의심 (부족액 N원)"만 기록하고 status=mismatch |

**(a)가 Phase 2에 의존하는 이유가 여기 있다.** taxType 없이 전 행에 ×1.1을 적용하면 면세 혼합 전표에서 틀린 금액을 만든다. Phase 2 완료 전에는 (a)를 비활성화할 것.

모든 자동보정은 `fixes[]`에 한글 문장으로 남기고 UI에 그대로 노출한다. 조용한 보정 금지.

### 3-3. 수동 재분석 (사용자 클릭 시에만)

**자동 재호출은 채택하지 않는다.** 기존 Claude 텍스트 단계 지연(~24초, "Load failed" 타임아웃 이슈)이 2배가 되어 문제를 악화시킨다.

① `hybrid.ts` 분리 — 현재 `runHybridOcr`은 Upstage와 Claude를 원자적으로 실행한다. 재분석에서 Upstage를 재호출하면 Tier 0 429 리스크가 재발한다. 다음으로 쪼갠다:

```ts
export async function runUpstageStage(filePath: string): Promise<UpstageParseResult | UpstageParseError>
export async function runClaudeTextStage(parsed, profileHint, deps, opts?: { correctionNote?: string })
```
`runHybridOcr`은 이 둘의 조합으로 재작성 (기존 호출부 시그니처 유지).

② Upstage 결과 캐시 — 서버 메모리 `Map<imageUrl, { parsed, expiresAt }>`, TTL 10분, 최대 20건 LRU. Railway 단일 인스턴스 전제. 캐시 미스면 Upstage 재호출을 허용하되, 재분석 버튼에 **30초 쿨다운**을 걸어 연타로 인한 429를 막는다.

③ 신규 엔드포인트 `POST /api/ocr/reanalyze-purchase`

```
body: { imageUrl, restaurantId, counterpartyId, docTotal, itemSum, previousItems }
```

`promptV2`에 `correctionNote`를 주입(프롬프트 말미 추가):

```
## 재검증 요청 (2차 시도)

1차 추출 결과가 문서 합계와 {diff}원 불일치했습니다.
- 문서에 적힌 합계: {docTotal}원
- 1차 추출 항목 합산: {itemSum}원
- 1차 결과(참고): {previousItems를 "품명 수량×단가=금액" 한 줄씩}

다음을 이 순서로 재점검하세요:
1. 긴 품목명이 두 행으로 쪼개져 항목이 중복 계상되지 않았는가 (H6)
2. 누락된 행이 없는가 (특히 표의 첫 행/마지막 행, 페이지 경계)
3. 자릿수 오독은 없는가 (0 개수, 콤마 위치)
4. 부가세를 빠뜨렸거나 이중으로 더하지 않았는가

출력 직전에 반드시 Σ lineTotal 을 계산해 문서 합계와 비교하고,
그래도 맞지 않으면 어느 행이 의심스러운지 note에 한글로 적으세요.
```

응답 스키마는 `/extract-purchase`와 동일 + `totals`. **클라이언트는 새 결과의 `|diff|`가 기존보다 작을 때만 교체한다.** 더 나빠지면 기존 결과를 유지하고 "재분석 결과가 더 정확하지 않아 기존 결과를 유지했습니다" 안내.

비용/지연: Upstage 재호출 없음, Claude 텍스트 1회(Haiku). 사용자 명시 클릭이므로 기존 자동 재시도(`MAX_OCR_AUTO_RETRY`) 경로와 분리되어야 한다 — 섞지 말 것.

### 3-4. UI (`DailyOpsPage.tsx` 2479~2486 합계 블록 확장)

현재 파란 합계 박스를 `totals.status`에 따라 4분기:

| status | 표시 |
|---|---|
| `match` | 기존 파란 합계 + 작은 체크 "전표 합계와 일치" |
| `auto_fixed` | 노란 배너 + `fixes[]` 문장 나열 + 보정 전/후 금액 |
| `mismatch` | **빨간 배너** "전표 합계 {docGrand} / 입력 합계 {itemSum} — {diff}원 차이" + `[재분석]` 버튼 + `[무시하고 진행]` |
| `no_doc_total` | 회색 "전표에 합계가 없어 자동 검증 불가" |

- 사용자가 항목을 수동 편집하면 `itemSum`을 재계산해 배너를 실시간 갱신 (`docGrand`는 OCR 값 고정)
- 저장 게이트: `mismatch` 상태에서 저장 시 `window.confirm` 1회. **차단하지 않는다** — 전표 자체가 틀린 경우가 실제로 존재한다
- 재분석 버튼은 진행 중 disabled + 30초 쿨다운

### Phase 3 완료 조건

- 합계 있는 전표에서 `totals.status`가 UI에 정확히 반영
- 의도적으로 한 행을 지운 테스트 케이스에서 빨간 배너 + 차액 정확히 표시
- 재분석 버튼이 Upstage를 재호출하지 않음 (로그로 확인: `[upstage]` 호출 0회)
- 합계 없는 전표에서 회색 안내로 graceful degrade
- `pnpm run build` 통과

---

## 4. 리스크 목록

| # | 리스크 | 완화 |
|---|---|---|
| 1 | H6 서버 병합 오탐 — 수량/단가 판독 실패한 정상 행을 흡수 | `uncertain=true` 강제 → UI 확인 필요 카드. 정상 전표 회귀 테스트 필수 |
| 2 | 병합 후 `rawItemName`이 varchar(100) 초과 → insert 실패 | purchasesV2 insert 3곳에서 `slice(0,100)` |
| 3 | `ADD COLUMN IF NOT EXISTS` 사용 시 MySQL 8에서 조용히 무시됨 | index.ts:24 `addColumnIfNotExists` 헬퍼 사용 (CLAUDE.md §13 예시는 잘못됨) |
| 4 | 자동보정 (a) ×1.1을 전 행에 적용 → 면세 혼합 전표 오답 | Phase 2 선행. exempt 행 제외. Phase 2 미완이면 (a) 비활성화 |
| 5 | 재분석 캐시 미스 → Upstage 재호출 → Tier 0 429 재발 | 30초 쿨다운 + TTL 10분 캐시. 관련 맥락은 memory `project-ocr-upstage-tier0` |
| 6 | 기존 축적 데이터의 `vatAmount`/`supplyAmount` NULL | 집계 쿼리에서 `IFNULL(...,0)` 금지. 별도 이슈 등록 |
| 7 | 빈 문자열이 DECIMAL 컬럼에 유입 | 라우터에서 `"" → null` 정규화 |
| 8 | 부가세 총액을 행 수로 안분하려는 유혹 | 프롬프트·서버 양쪽에서 명시 금지. 판정 불가는 unknown |

## 5. DB 쓰기 관련

Phase 2의 `ALTER TABLE` 3건은 CLAUDE.md §3 정지조건 3번(DB WRITE)에 해당한다. 다만 자동 마이그레이션은 배포 시 실행되므로, **`git push` 승인 = 마이그레이션 승인**으로 묶어 §4 5항 보고에 "DB 마이그레이션: purchase_order_items_v2에 컬럼 3개 추가 (nullable + default, 기존 데이터 무영향)"을 명시할 것.

롤백: 컬럼 추가는 nullable/default라 기존 코드와 호환되므로, 코드만 revert하면 컬럼은 남아도 무해하다. `DROP COLUMN` 불필요.

## 6. 검증

- `scripts/ocr-test.ts` 확장: 샘플 전표 N장에 대해 (추출 항목 수, Σ 일치 여부, 과세/면세 분류율, H6 병합 발생 수) 리포트
- 회귀 세트: 기존에 잘 되던 전표 3장 이상 — 항목 수 불변 확인
- `pnpm run build` 통과 후 Railway 자동 배포 결과로 최종 검증

---

## 실행 로그

<!-- Code 세션에서 한 줄씩 append: YYYY-MM-DD Code(SHA) — 한 일 / 미해결 -->
- 2026-07-29 Cowork — 설계 문서 작성. 소스 미수정. Phase 1-1(원인 확정)부터 시작 필요
- 2026-07-29 Code(pre-push) — Phase 1-1 원인 확정: **(b) 행 분해형**. 보유 샘플(test-ocr.jpg) Upstage raw 덤프에서 시각적 한 줄 = 한 <tr>로 방출됨을 확인 (간마늘 단가가 숫자만 있는 별도 <tr>로 분리). 셀 내부 <br>는 미관찰(<br>은 table 태그 앞 장식). Phase 1(H6 프롬프트+서버 가드+컨텍스트 순서교체) / Phase 2(taxType·supplyAmount·vatAmount 스키마+마이그레이션+라우터 3곳+토글 뱃지 UI) / Phase 3(reconcileTotals 자동보정 a~e + totals 응답 + 4분기 배너 + /reanalyze-purchase + Upstage 캐시 10분/20건 + 30초 쿨다운) 전부 구현. 추가로 getOrderItems·편집저장 경로에 세필드 관통(편집 시 taxType 'unknown' 덮어쓰기 방지), CLAUDE.md §13 마이그레이션 예시 헬퍼 사용으로 교정, 집계 주의사항 GitHub #25 등록. 검증: 순수함수 유닛(H6 병합/오탐회귀/과세보정/reconcile a·c·e·match·no_doc_total) 전부 통과, 캐시 Upstage+Haiku 실호출 E2E에서 신규 필드 정상 출력·H1 병합·낙서 제외·no_doc_total graceful 확인, pnpm run build 통과. 미해결: 줄바꿈 실패 실전 전표로의 H6 재현 테스트(실전표 미보유), 회귀 세트 3장 검증은 프로덕션 사용으로 갈음 필요.
