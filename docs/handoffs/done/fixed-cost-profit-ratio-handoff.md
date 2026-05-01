[done: ec02fc8 — 2026-05-01]

# 고정비 "수익금 대비 %" 유형 추가 — Code 핸드오프

> 작성: 2026-05-01 (Cowork)
> 대상: Claude Code 세션
> 단계: 단일 PR. 스키마 + 헬퍼 + tRPC + UI까지 일괄.

---

## 0. 목적·범위

`fixed_costs.costType`에 신규 enum `profit_ratio`("수익금 대비 %") 추가. 본사 로열티/이익공유 등 **월순이익 기반 비례 비용**을 고정비 관리에 등록·자동 계산.

**범위**
- 스키마: `drizzle/schema.ts` — `costType` enum 확장
- 마이그레이션: `server/index.ts` — idempotent `ALTER TABLE ... MODIFY COLUMN` 추가
- 헬퍼: `server/helpers/fixedCostCalc.ts` — 순환참조 closed-form 계산
- 라우터: `server/routers/fixedCosts.ts` — Zod enum 확장, `monthlyTotal` 입력 보강
- 호출부: `server/routers/monthlyClosings.ts`, `server/routers/admin.ts` — 신호출 시퀀스
- UI: `client/src/pages/FixedCostsPage.tsx` — 옵션·라벨·뱃지·렌더 분기

**범위 제외**
- 일마감(`dailyClosings.ts`) — 사용자 결정: 월정산만 적용
- 기존 `sales_ratio` 동작 변경 없음
- 한도·검증 UI(예: R_p 합 80% 상한)는 Phase 2 (본 PR은 서버 검증만)

**완료 조건**
- `pnpm run build` 통과
- Railway 배포 후 enum 자동 확장 (MySQL `ALTER TABLE ... MODIFY COLUMN ... ENUM(...)`)
- `/fixed-costs` 페이지에서 "수익금 대비 %" 옵션 노출, 등록 가능
- `/monthly-settlement`에서 profit_ratio 항목이 고정비 합계에 반영, profit 재계산 일치
- 적자월(preProfit ≤ 0): profit_ratio 항목 금액 0원 처리 검증

---

## 1. 수학 모델 (확정)

### 변수 정의

```
S       = 월 매출 (confirmedSales.salesTotal)
P       = 월 매입
L       = 월 인건비
E       = 월 즉시지출(daily_expenses)
F       = 일반 고정비 월환산 합계 (monthly + yearly/12 + quarterly/3 + one_time 매칭월)
R_s     = sales_ratio 항목들의 비율 합 (예: 5.5 = 5.5%)
R_p     = profit_ratio 항목들의 비율 합 (예: 10 = 10%)
salesRatioAmt = S × R_s / 100     (매출비율형 합계 금액)
preProfit  = S − P − L − F − salesRatioAmt − E
```

### Closed-form

```
if preProfit > 0:
    monthlyProfit       = round( preProfit × 100 / (100 + R_p) )
    profitRatioAmtTotal = preProfit − monthlyProfit
    각 profit_ratio 항목 i 금액 = round( monthlyProfit × R_i / 100 )
                                  (rounding 잔차는 마지막 항목에 흡수)

else:  # 적자월
    monthlyProfit       = preProfit         (음수 그대로 표시)
    profitRatioAmtTotal = 0
    각 profit_ratio 항목 금액 = 0
```

### fixedCostsTotal 정의

```
fixedCostsTotal = F + salesRatioAmt + profitRatioAmtTotal
```

이 값을 monthlyClosings 스키마의 `fixedCostsTotal` 컬럼에 저장.

### profit 정의 (변경 없음)

```
profit = S − P − L − fixedCostsTotal − E
```

수학적으로 적자월에는 `profit = preProfit`, 흑자월에는 `profit = monthlyProfit` 과 일치. 기존 코드의 마지막 빼기 식은 유지.

### 검증 항등식 (테스트 케이스용)

```
S = 100,000,000
P = 30,000,000
L = 25,000,000
E = 1,000,000
F = 5,000,000
sales_ratio: [{ratio: 3}]      → R_s = 3, salesRatioAmt = 3,000,000
profit_ratio: [{ratio: 10}]    → R_p = 10

preProfit = 100M − 30M − 25M − 5M − 3M − 1M = 36,000,000
monthlyProfit = round(36M × 100 / 110) = 32,727,273
profitRatioAmtTotal = 36M − 32,727,273 = 3,272,727
fixedCostsTotal = 5M + 3M + 3,272,727 = 11,272,727
profit = 100M − 30M − 25M − 11,272,727 − 1M = 32,727,273  ✓ (= monthlyProfit)
```

---

## 2. 스키마 변경

### `drizzle/schema.ts`

기존 (line 226):
```ts
costType: mysqlEnum("costType", ["monthly", "yearly", "one_time", "quarterly", "sales_ratio"]).default("monthly").notNull(),
```

변경:
```ts
costType: mysqlEnum("costType", ["monthly", "yearly", "one_time", "quarterly", "sales_ratio", "profit_ratio"]).default("monthly").notNull(),
```

주석 업데이트 (line 225, 229):
```ts
// monthly: 월 고정, yearly: 연간(월할), quarterly: 분기별(3개월할),
// sales_ratio: 매출대비 %, profit_ratio: 월순이익대비 % (closed-form, 적자월 0)
costType: ...
amount: ...
// yearly→12분할, quarterly→3분할, sales_ratio→amount는 매출 % 값, profit_ratio→월순이익 % 값
```

### `server/index.ts` 자동 마이그레이션

기존 자동 마이그레이션 블록 끝에 추가 (idempotent — `MODIFY COLUMN`은 매 부팅 적용해도 안전):

```ts
await conn.query(`
  ALTER TABLE fixed_costs
  MODIFY COLUMN costType ENUM('monthly','yearly','one_time','quarterly','sales_ratio','profit_ratio')
  NOT NULL DEFAULT 'monthly'
`).catch((e) => { console.warn("[migrate] fixed_costs.costType enum extend skipped:", e?.message); });
```

**주의**: 기존 데이터에 영향 없음. enum 확장은 추가만 하므로 호환.

---

## 3. 헬퍼 변경 — `server/helpers/fixedCostCalc.ts`

### 인터페이스 확장

```ts
export interface RatioItem {
  id: number;
  name: string;
  ratio: number;
  category: string | null;
}

export interface MonthlyFixedCostResult {
  fixedTotal: number;        // F (일반 고정비)
  salesRatioTotal: number;   // S × R_s / 100  (이전 ratioTotal 의 의미)
  profitRatioTotal: number;  // Σ profit_ratio 항목 금액
  totalWithRatio: number;    // F + salesRatioTotal + profitRatioTotal
  monthlyProfit: number;     // closed-form 결과 (적자면 음수)
  preProfit: number;         // 디버그/표시용
  breakdown: FixedCostBreakdown[];
  salesRatioItems: RatioItem[];
  profitRatioItems: (RatioItem & { amount: number })[];  // 항목별 금액 포함

  // 하위호환 deprecated alias (점진 제거)
  ratioItems: RatioItem[];   // = salesRatioItems
  ratioTotal: number;        // = salesRatioTotal
}
```

### 시그니처 변경

```ts
export async function calcMonthlyFixedCosts(
  restaurantId: number,
  year: number,
  month: number,
  salesAmount?: number,
  /** profit_ratio 계산용. monthlyClosings 외부 비용(매입+인건비+즉시지출). 없으면 0 처리 → profitRatioTotal=0 */
  externalCosts?: { purchases: number; labor: number; expenses: number },
): Promise<MonthlyFixedCostResult>
```

### 본문 흐름

1. 기존 루프에서 `costType === "profit_ratio"`를 새 분기로 분리:
   ```ts
   if (fc.costType === "profit_ratio") {
     profitRatioItemsRaw.push({ id, name, ratio, category });
     continue;
   }
   ```

2. F + salesRatioTotal 계산은 그대로.

3. profit_ratio 처리:
   ```ts
   const S = salesAmount ?? 0;
   const ext = externalCosts ?? { purchases: 0, labor: 0, expenses: 0 };
   const salesRatioTotal = ...;  // 기존 로직
   const preProfit = S - ext.purchases - ext.labor - fixedTotal - salesRatioTotal - ext.expenses;

   let monthlyProfit: number;
   let profitRatioTotal = 0;
   const profitRatioItems: (RatioItem & { amount: number })[] = [];

   if (preProfit > 0 && profitRatioItemsRaw.length > 0) {
     const Rp = profitRatioItemsRaw.reduce((s, r) => s + r.ratio, 0);
     monthlyProfit = Math.round(preProfit * 100 / (100 + Rp));
     profitRatioTotal = preProfit - monthlyProfit;

     // 항목별 금액 안분 (잔차는 마지막 항목)
     let acc = 0;
     profitRatioItemsRaw.forEach((r, idx) => {
       const isLast = idx === profitRatioItemsRaw.length - 1;
       const amt = isLast
         ? profitRatioTotal - acc
         : Math.round(monthlyProfit * r.ratio / 100);
       acc += amt;
       profitRatioItems.push({ ...r, amount: amt });
     });
   } else {
     monthlyProfit = preProfit;  // 적자 또는 profit_ratio 없음 → 그대로
     profitRatioItemsRaw.forEach(r => profitRatioItems.push({ ...r, amount: 0 }));
   }

   const totalWithRatio = fixedTotal + salesRatioTotal + profitRatioTotal;
   ```

4. 반환에 `salesRatioItems`/`profitRatioItems`/`monthlyProfit`/`preProfit` 포함. deprecated 별칭(`ratioItems`/`ratioTotal`)은 `salesRatioTotal`/`salesRatioItems`로 매핑.

### 하위호환

- `externalCosts` 미전달 시 `preProfit = S − F − salesRatioTotal` (P/L/E를 0으로 간주). profit_ratio 항목이 등록돼 있다면 결과 부정확하지만, **월정산 외 호출처(예: 페이지 미리보기)**는 어차피 정확한 P/L/E를 모르므로 표시용 근사치 또는 0 처리.
- 더 안전: profit_ratio 항목이 있는데 `externalCosts`가 없으면 `profitRatioTotal=0`으로 두고 `profitRatioItems`만 0원으로 채워 반환. **호출부에서 주의 필요.**

---

## 4. 라우터 변경

### `server/routers/fixedCosts.ts`

1. Zod enum 확장 (line 9):
   ```ts
   const costTypeEnum = z.enum(["monthly", "yearly", "quarterly", "sales_ratio", "profit_ratio"]);
   ```

2. `monthlyTotal` 입력 보강 — 페이지 미리보기에서 사용:
   ```ts
   .input(z.object({
     restaurantId: z.number(),
     year: z.number(),
     month: z.number(),
     salesAmount: z.number().optional(),
     // 신규 (선택): 정확한 profit_ratio 계산용
     purchasesAmount: z.number().optional(),
     laborAmount: z.number().optional(),
     expensesAmount: z.number().optional(),
   }))
   ```
   `externalCosts` 매핑은 셋 다 전달된 경우에만. 일부만 오면 0 처리(=근사).

3. 반환 객체에 `profitRatioItems`, `profitRatioTotal`, `monthlyProfit`, `preProfit` 추가. 기존 필드(`ratioItems`, `ratioTotal`) 유지(하위호환).

### `server/routers/monthlyClosings.ts`

기존 (line 377):
```ts
const fixedResult = await calcMonthlyFixedCosts(restaurantId, year, month, confirmedSales.salesTotal);
```

변경: `externalCosts` 전달. 단, **호출 순서 의존성**이 있다.

```ts
// 매입/인건비/즉시지출 먼저 산출 (현 코드는 이 순서 아님 → 재배치 필요)
const confirmedPurchases = await sumPurchasesByCP(...);
const confirmedLabor = await sumLaborByCompany(...);
const expensesTotal = ...;  // dailyExpenses 합계

// 그 다음 고정비 (profit_ratio 정확 계산)
const fixedResult = await calcMonthlyFixedCosts(
  restaurantId, year, month, confirmedSales.salesTotal,
  { purchases: confirmedPurchases.total, labor: confirmedLabor.totalCost, expenses: expensesTotal },
);
const fixedCostsTotal = fixedResult.totalWithRatio;

// breakdown 확장
const fixedBreakdown = [
  ...fixedResult.breakdown.map(f => ({ name: f.name, type: f.type, amount: f.amount, ratio: null as number | null })),
  ...fixedResult.salesRatioItems.map(r => ({
    name: r.name, type: "sales_ratio" as const,
    amount: Math.round(confirmedSales.salesTotal * r.ratio / 100),
    ratio: r.ratio,
  })),
  ...fixedResult.profitRatioItems.map(r => ({
    name: r.name, type: "profit_ratio" as const,
    amount: r.amount, ratio: r.ratio,
  })),
];

// profit 식은 그대로 (수학적으로 일치)
const profit = confirmedSales.salesTotal - confirmedPurchases.total - confirmedLabor.totalCost - fixedCostsTotal - expensesTotal;
```

**주의**: line 377 부근의 호출 순서를 재배치해야 한다. 현재는 fixedCosts → purchases → labor → expenses 순. profit_ratio 정확 계산을 위해 purchases/labor/expenses → fixedCosts 순으로 변경.

라인 634(다른 `calcMonthlyFixedCosts` 호출)도 동일 패턴 적용.

### `server/routers/admin.ts`

라인 71 부근. AdminDashboard용 매장별 요약. profit_ratio도 정확히 표시하려면 동일하게 externalCosts 전달.

```ts
const fixedResult = await calcMonthlyFixedCosts(
  r.id, input.year, input.month, salesTotal,
  { purchases: purchasesTotal, labor: laborCost, expenses: 0 },  // expensesTotal 미수집 — Code 측 판단: 추가 쿼리할지, 0 처리할지
);
```

**Code 결정 사항**: admin.ts에서 dailyExpenses 합계도 같이 가져올지 여부. 가져오면 정확, 안 가져오면 expenses=0 근사. 근사 채택 시 코멘트로 표시 — `// expenses 미반영, profit_ratio 항목은 약간 과대계상될 수 있음`

---

## 5. UI 변경 — `client/src/pages/FixedCostsPage.tsx`

### 옵션·라벨 추가

```ts
const COST_TYPE_OPTIONS = [
  { value: "monthly", label: "월 고정" },
  { value: "yearly", label: "연간 (월할)" },
  { value: "quarterly", label: "분기별 (3개월할)" },
  { value: "sales_ratio", label: "매출대비 %" },
  { value: "profit_ratio", label: "월순이익대비 %" },  // 신규
];

const COST_TYPE_LABELS: Record<string, string> = {
  monthly: "월 고정",
  yearly: "연간",
  quarterly: "분기별",
  sales_ratio: "매출%",
  profit_ratio: "순이익%",  // 신규
  one_time: "일회성",
};

const BADGE_VARIANTS: Record<string, string> = {
  monthly: "info",
  yearly: "warning",
  quarterly: "default",
  sales_ratio: "success",
  profit_ratio: "success",  // 신규 (success 또는 신규 variant)
  one_time: "default",
};
```

### 폼 입력 라벨

```ts
<Input
  label={
    costType === "sales_ratio" ? "비율 (%, 매출 기준)" :
    costType === "profit_ratio" ? "비율 (%, 월순이익 기준)" :
    "금액 (원)"
  }
  ...
  placeholder={costType === "sales_ratio" || costType === "profit_ratio" ? "5.5" : "0"}
/>
```

### 카드 렌더 분기 (line 187 부근)

```tsx
{(fc.costType === "sales_ratio" || fc.costType === "profit_ratio") ? (
  <span className="text-sm font-semibold text-foreground tabular-nums">{Number(fc.amount)}%</span>
) : (
  // 기존 금액 렌더
)}
```

### 미리보기 영역 (line 129 부근)

`profitRatioItems` 별도 섹션으로 표시:

```tsx
{(monthlyTotal as any).profitRatioItems?.length > 0 && (
  <div className="px-4 py-2 bg-muted/50 rounded-lg space-y-1">
    <p className="text-xs text-muted-foreground">월순이익 대비 비율 항목 (월정산 시 자동 계산)</p>
    {(monthlyTotal as any).profitRatioItems.map((r: any, i: number) => (
      <span key={i} className="text-xs text-foreground mr-3">
        {r.name}: {r.ratio}%
        {r.amount > 0 && ` (${r.amount.toLocaleString()}원)`}
      </span>
    ))}
  </div>
)}
```

### 도움말 한 줄 (선택)

profit_ratio 선택 시 폼 하단에 안내:
```
적자월에는 0원으로 처리됩니다. 월정산 시 매출−매입−인건비−고정비−즉시지출 계산 후 자동 적용.
```

---

## 6. 엣지 케이스·검증

### 서버 검증 (fixedCostsRouter.create/update)

profit_ratio amount 검증:
```ts
if (input.costType === "profit_ratio") {
  const ratio = Number(input.amount);
  if (!isFinite(ratio) || ratio <= 0 || ratio > 100) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "월순이익 비율은 0 초과 100 이하여야 합니다." });
  }
}
```

R_p 합 ≥ 100% 차단(선택 — Phase 2): create/update 시 활성 항목 합 시뮬레이션 후 100 이상이면 거부. 본 PR은 단일 항목 100 이하 검증만.

### 적자월 항등성 테스트

`tests/settlement-calc.test.ts`에 케이스 추가:
- preProfit > 0, R_p = 0 → 기존과 동일
- preProfit > 0, R_p = 10 → closed-form 검증
- preProfit ≤ 0, R_p > 0 → profit_ratio 항목 0, profit = preProfit
- preProfit > 0, R_s = 5 + R_p = 10 → 둘 다 적용
- profit_ratio 다중 항목 → 잔차 흡수 검증

### 기존 sales_ratio 회귀

`monthlyTotal` 호출 결과에서 `ratioItems`/`ratioTotal`(deprecated)이 `salesRatioItems`/`salesRatioTotal` 과 동일 값인지 확인. 클라이언트 다른 페이지(MonthlySettlementPage 등)에서 deprecated 필드 참조 여부 grep 후 필요 시 동시 갱신.

---

## 7. 검증·배포 체크리스트

```
□ pnpm run build 통과
□ tests/settlement-calc.test.ts 신규 케이스 추가 후 pass
□ /fixed-costs 페이지에서 "월순이익대비 %" 옵션 노출, 등록·수정·삭제 동작
□ 흑자월: profit_ratio 항목이 fixedCostsTotal에 포함, profit이 monthlyProfit과 일치
□ 적자월: profit_ratio 항목 0원, profit = preProfit (음수)
□ MonthlySettlementPage에서 fixedCostsTotal·profit 표시값 일치
□ AdminDashboard 매장별 profit이 새 로직과 일치 (expenses 미반영 단서 명시)
□ Railway 배포 후 enum 확장 자동 적용 확인 (DESCRIBE fixed_costs)
□ §4 5항 요약 보고 후 git push
```

---

## 8. 비고

- **법인세 부과기준과 무관**: 본 시스템의 "월순이익"은 매장 단위 관리회계지표. 법인세 과세표준은 결산서 당기순이익 ± 세무조정으로 별도 산출. 사용자에게 이 점은 별도 안내됨(Cowork 대화).
- **profit_ratio 다중 등록 시 한도**: 합 ≥ 100% 방지 검증은 본 PR 범위 외. 필요 시 후속 PR.
- **일마감 적용 안 함**: 사용자 결정. 추후 필요 시 dailyClosings도 동일 closed-form으로 확장 가능.
