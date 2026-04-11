# 매입관리 재설계 명세서

> 작성일: 2026-04-11
> 상태: QC/QA 반영 완료 (2026-04-11)
> 방점: 매입품목의 정확한 입력·데이터 체계화 → 가격추이·비교·예측 → 매입효율 극대화

---

## 1. 현행 분석

### 1.1 데이터 흐름

```
[DailyOpsPage 매입 탭]
  사진촬영 → /api/ocr/extract-purchase (Sonnet)
    → 거래처 자동매칭 (fuzzyScore)
    → 품목 후보매칭 (findItemCandidates)
    → 사용자 확인/수정
    → purchasesV2.createOrder
      → purchase_orders_v2 (헤더: 거래처, 날짜, 상태, 총액)
      → purchase_order_items_v2 (항목: rawItemName, itemId, 수량, 단가, 금액)
      → counterparty_items.lastPrice 갱신 (입고 시만)
      → counterparty_ocr_profiles 프로파일 자동갱신

[PurchaseManagementPage — 7탭]
  거래처     → counterparties CRUD
  월별매입   → monthlySummaryByCounterparty (거래처별 월 합산)
  품목관리   → items.findSimilarGroups + merge
  가격비교   → itemPriceComparison (rawItemName 기반)
  단가추이   → itemPriceTrend (rawItemName 기반)
  발주현황   → pendingOrders + counterpartyAmountAnalysis
  중복관리   → findDuplicates (날짜+거래처+금액)
```

### 1.2 구조적 문제

#### 문제 1: 품목 정규화 체계 무력화 (심각도: 치명)

분석 쿼리(`itemPriceComparison`, `itemPriceTrend`)가 `rawItemName`(OCR 원문)으로 GROUP BY.
`items` 테이블에 정규화 마스터가 있고 `itemId`가 존재하지만, 분석에서 사용하지 않음.

**결과**: 같은 품목이 "양파 10kg", "양파(10KG)", "양파10키로"로 OCR되면 3개 별도 품목으로 집계.
`findSimilarGroups` → `merge`로 병합해도 분석 쿼리가 `rawItemName` 기반이라 반영 안 됨.

#### 문제 2: 단위 불일치 (심각도: 높음)

`counterparty_items`에 `purchaseUnit`, `conversionToBase`가 존재하지만,
가격비교 쿼리가 `rawItemName` 기반이라 단위 환산 없이 단가를 직접 비교.
"양파 10kg 박스 @25,000" vs "양파 1kg @3,000" → 같은 선에서 비교됨.

#### 문제 3: 탭 역할 중첩/활용도 불균형 (심각도: 중간)

| 탭 | 문제 |
|---|---|
| 거래처 | 독립 CRUD. 매입관리 안에 있을 이유 약함 |
| 발주현황 | DailyOpsPage 매입 탭에 미입고 목록 이미 존재 → 중복 |
| 중복관리 | 사후 정리 도구. 입력 시점 차단이 더 효과적 |
| 품목관리 | 사후 정리. 입력 시 정규화 강화하면 필요성 급감 |

---

## 2. 재설계 원칙

1. **분석의 기반은 정규화된 `itemId`** — `rawItemName`은 입력 보존용, 분석은 마스터 기준
2. **모든 가격 비교는 기준단위 환산 후** — `unitPrice / conversionToBase` = 기준단위가
3. **사후 정리보다 사전 차단** — 중복/미매칭은 입력 시점에서 해결
4. **탭은 의사결정 단위로 구성** — "뭘 할 수 있는가"가 아닌 "어떤 판단을 하는가" 기준

---

## 3. 신규 탭 구조 (7탭 → 3탭)

```
매입관리
├── ① 품목마스터   — 데이터 체계의 기반
├── ② 가격분석     — 추이 + 비교 + 절감기회
└── ③ 매입현황     — 월별 실적 조회
```

### 3.1 품목마스터 탭

**목적**: 모든 분석의 기반이 되는 품목-거래처 매핑의 정확성 보장

**뷰 구성**:
- 상단: 검색 + 유사품목 경고 배너 (findSimilarGroups 결과 있을 때만)
- 메인: 품목 카드 리스트 (아코디언)
  - 접힌 상태: 품목명 | 기준단위 | 거래처 수 | 최저 기준단위가
  - 펼친 상태: 거래처별 매핑 행

**품목 카드 펼침 시 거래처별 행**:
```
거래처명 | 납품단위 | 환산계수 | 최근납품가 | 기준단위가 | 최종입고일
[수정] [매핑해제]
```

**기준단위가 계산**:
```
기준단위가 = lastPrice / conversionToBase
예) "양파 10kg 박스 @25,000" → conversionToBase=10 → kg당 ₩2,500
```

**유사품목 병합**:
- 기존 `findSimilarGroups` + `merge` 로직 유지
- 상단 경고 배너에서 바로 병합 가능

**API 변경/신규**:
```typescript
// 신규: 품목 + 거래처 매핑 + 기준단위가 통합 조회
items.listWithMappings: storeReadProcedure
  → items LEFT JOIN counterparty_items LEFT JOIN counterparties
  → 기준단위가 계산 포함
  → 정렬: 거래처 수 DESC, 품목명 ASC
```

### 3.2 가격분석 탭

**목적**: 매입 효율 극대화를 위한 가격 의사결정 도구

**3개 서브뷰** (세그먼트 토글):

#### A. 거래처 비교

동일 품목을 납품하는 거래처들의 **기준단위가** 비교.

```
[양파] baseUnit: kg
  ├─ A농산 (10kg 박스) → @₩25,000 → kg당 ₩2,500 ← 최저
  ├─ B마트 (1kg)       → @₩3,200  → kg당 ₩3,200
  └─ 차이: ₩700/kg (28%)
```

**쿼리 변경** (`itemPriceComparison`):
```sql
-- 기존: rawItemName 기반 → 변경: itemId 기반 + 기준단위가 환산
SELECT
  i.id AS itemId,
  i.name AS itemName,
  i.baseUnit,
  c.name AS counterpartyName,
  ci.purchaseUnit,
  ci.conversionToBase,
  oi.unitPrice,
  CASE WHEN ci.conversionToBase > 0
    THEN CAST(oi.unitPrice AS DECIMAL(14,4)) / ci.conversionToBase
    ELSE CAST(oi.unitPrice AS DECIMAL(14,4))
  END AS basePricePerUnit,
  o.purchaseDate
FROM purchase_order_items_v2 oi
JOIN purchase_orders_v2 o ON oi.purchaseOrderId = o.id
JOIN items i ON oi.itemId = i.id
LEFT JOIN counterparties c ON o.counterpartyId = c.id
LEFT JOIN counterparty_items ci ON oi.counterpartyItemId = ci.id
WHERE o.restaurantId = ?
  AND oi.itemId IS NOT NULL
  AND o.status = 'received'
ORDER BY i.name, o.purchaseDate DESC
```

#### B. 가격 추이

품목별 시계열 기준단위가 변화.

- 기간 선택: 3/6/12개월
- 품목 카드: 현재가, 변동률, min/max, 이상치 마커
- 펼치면: 시계열 포인트 (날짜, 거래처, 기준단위가, 전회차 대비 변동)

**이상치 감지**:
```
이동평균(최근 5건) 대비 ±20% 이상 → confidence='alert' 마커
```

**쿼리 변경** (`itemPriceTrend`):
```sql
-- 기존: rawItemName → 변경: itemId + 기준단위가
SELECT
  i.id AS itemId,
  i.name AS itemName,
  i.baseUnit,
  c.name AS counterpartyName,
  CASE WHEN ci.conversionToBase > 0
    THEN CAST(oi.unitPrice AS DECIMAL(14,4)) / ci.conversionToBase
    ELSE CAST(oi.unitPrice AS DECIMAL(14,4))
  END AS basePricePerUnit,
  o.purchaseDate
FROM purchase_order_items_v2 oi
JOIN purchase_orders_v2 o ON oi.purchaseOrderId = o.id
JOIN items i ON oi.itemId = i.id
LEFT JOIN counterparties c ON o.counterpartyId = c.id
LEFT JOIN counterparty_items ci ON oi.counterpartyItemId = ci.id
WHERE o.restaurantId = ?
  AND oi.itemId IS NOT NULL
  AND o.purchaseDate >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
ORDER BY i.name, o.purchaseDate ASC
```

#### C. 절감 기회 (신규)

복수 거래처 품목에서 현 주거래처 대비 최저가 거래처로 전환 시 예상 절감액.

**주거래처 판정 기준**: 해당 품목의 최근 3개월 입고 건수가 가장 많은 거래처를 자동 산정.
동률 시 최근 입고일이 더 가까운 거래처 우선.

```
[양파] 현재: B마트 kg당 ₩3,200 | 최저: A농산 kg당 ₩2,500
  월평균 사용량: 150kg
  월 예상 절감: ₩105,000
```

**쿼리 (신규)**: `purchasesV2.savingOpportunities`
```sql
-- 품목별 최근 3개월 월평균 수량 (기준단위 환산)
-- × (현재 주거래처 기준단위가 - 최저 기준단위가)
-- = 월 예상 절감액
WITH item_monthly AS (
  SELECT
    oi.itemId,
    AVG(
      CASE WHEN ci.conversionToBase > 0
        THEN oi.quantity * ci.conversionToBase
        ELSE oi.quantity
      END
    ) AS avgMonthlyBaseQty
  FROM purchase_order_items_v2 oi
  JOIN purchase_orders_v2 o ON oi.purchaseOrderId = o.id
  LEFT JOIN counterparty_items ci ON oi.counterpartyItemId = ci.id
  WHERE o.restaurantId = ?
    AND o.status = 'received'
    AND o.purchaseDate >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
    AND oi.itemId IS NOT NULL
  GROUP BY oi.itemId, DATE_FORMAT(o.purchaseDate, '%Y-%m')
),
-- ... (주거래처 단가, 최저 단가 산출 후 차액 × 평균수량)
```

**UI**: 절감 가능액 높은 순 정렬, 상단에 월 총 예상 절감 합계

### 3.3 매입현황 탭

**목적**: 월별 매입 실적 확인 (경영 조회용)

기존 `MonthlyPurchaseTab` 유지 + 경량 개선:
- 전월 대비 증감률 한 줄 추가
- 거래처 드릴다운 시 품목별 기준단위가 함께 표시
- 분석 탭으로 이동 링크 ("이 품목 가격분석 보기")

---

## 4. 제거/이관 대상

| 기존 탭 | 처리 | 사유 |
|---|---|---|
| 거래처 | **흡수** → 품목마스터 | 거래처 CRUD는 품목마스터 탭 내 거래처 필터 + 관리 서브뷰로 이관. 품목 0개인 거래처도 조회/편집 가능 (§9 참조) |
| 발주현황 | **제거** | DailyOpsPage 매입 탭에 미입고 목록 존재. 거래처별 금액분석은 매입현황에서 커버 |
| 중복관리 | **제거** → 입력 시 차단 | `createOrder` 시 동일 날짜+거래처+유사금액(±5%) 감지 → 경고 반환 |
| 품목관리 | **흡수** → 품목마스터 | 유사품목 감지/병합은 품목마스터의 서브기능 |
| 가격비교 | **흡수** → 가격분석 | 비교+추이+절감기회 통합 |
| 단가추이 | **흡수** → 가격분석 | 위와 동일 |

---

## 5. 입력 시점 가이드 강화 (DailyOpsPage 매입 탭)

현재 문제: OCR 추출 후 품목 매칭은 fuzzyScore 기반 "추천 칩"으로 제시되지만,
사용자가 이를 무시하고 rawItemName 그대로 저장하는 것이 허용됨.
수동 입력 시에는 가이드가 거의 없음. 결과적으로 데이터 품질이 입력자에게 의존.

### 5.1 품목 매칭 3단계 워크플로우

현재는 "품명 입력 → (선택적) 추천 칩 클릭 → 저장"의 1단계.
이를 **확인 단계가 포함된 3단계**로 전환.

```
STEP 1: 품명 인식/입력
  OCR → rawItemName 프리필 / 수동 → 직접 타이핑

STEP 2: 마스터 매칭 (자동 + 가이드)
  ├── 자동매칭 (score ≥ 0.7) → ✅ 초록 체크 + 품목명 표시
  ├── 후보 있음 (0.3 ≤ score < 0.7) → 🟡 "이 품목인가요?" 후보 표시 (선택 권장, 강제 아님)
  └── 후보 없음 → 🔴 "신규 품목 등록" 또는 "직접 검색" 유도

STEP 3: 저장 전 검증
  ├── itemId 매칭된 항목 → 정상 저장
  ├── 미매칭 항목 → 소프트 경고 + 저장 허용 (미매칭 항목은 별도 큐에 축적, 품목마스터에서 일괄 정리)
  └── 유사 기존 품목 감지 → "기존 품목과 같은 품목인가요?" 확인
```

### 5.2 품명 입력 필드 개선 (Combobox 강화)

**현재**: 텍스트 입력 + 드롭다운 (거래처 품목 → 전체 품목). 추천 칩은 별도 영역.

**변경**: 입력 필드 자체에 매칭 상태를 통합 표시.

```
┌──────────────────────────────────────────┐
│ [✅ 양파 (10kg)]                    [×]  │  ← 매칭 완료 (초록 배경)
│  거래처명: A농산 | 최근단가 ₩25,000      │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│ [🟡 양파10키로]                     [▼]  │  ← 후보 있음 (노란 배경)
│  이 품목인가요?                          │
│  ┌─────────────────────────────────────┐ │
│  │ 양파 (10kg)  A농산  @₩25,000  [선택]│ │  ← 거래처 등록 품목 우선
│  │ 양파         마스터  kg기준   [선택]│ │
│  │ 해당없음 — 신규 등록           [▶]  │ │
│  └─────────────────────────────────────┘ │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│ [🔴 프리미엄양송이버섯]             [▼]  │  ← 미매칭 (빨간 테두리)
│  등록된 품목에 없습니다                  │
│  ┌─────────────────────────────────────┐ │
│  │ "프리미엄양송이버섯" 신규 등록 [▶]  │ │
│  │ 양송이버섯 (기존)             [선택]│ │  ← 부분 매칭 후보
│  │ 버섯류 (기존)                 [선택]│ │
│  └─────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

**구현 핵심**:
- `matchedItemId` 존재 → 초록 배경 + 체크 아이콘 + 거래처 매핑 정보 한 줄
- `itemCandidates` 존재 + `matchedItemId` 없음 → 노란 배경 + 후보 목록 자동 펼침
- 둘 다 없음 → 빨간 테두리 + "신규 등록" 유도
- **현재와의 차이**: 추천 칩이 별도 영역이 아닌 입력 필드 내부 드롭다운으로 통합.
  후보가 있으면 드롭다운이 자동으로 열림 (현재는 사용자가 칩을 인지해야 함)

### 5.3 신규 품목 등록 인라인 플로우

현재: 미매칭 품목은 `rawItemName`으로 저장 → `itemId=NULL` → 분석에서 누락
변경: 미매칭 시 인라인 신규 등록 팝업 제공

```
"프리미엄양송이버섯" 신규 등록 [▶] 클릭 시:

┌──────────────────────────────────────────┐
│ 신규 품목 등록                           │
│                                          │
│ 품목명: [양송이버섯          ]  ← 정규화된 이름 제안
│         (OCR 원본: 프리미엄양송이버섯)    │
│                                          │
│ 기준단위: [kg ▼]                         │
│                                          │
│ 분류: [식재료 ▼]                         │
│                                          │
│ ⚠️ "양송이버섯"과(와) 비슷한 기존 품목:  │
│    · 양송이 (거래처 2곳, 매입 15건)      │
│    → 기존 품목 사용하기 [선택]           │
│                                          │
│         [등록] [취소]                    │
└──────────────────────────────────────────┘
```

**핵심 로직**:
- **최소 입력: 품목명만 필수**. 빠른 입력 흐름을 깨지 않는 것이 우선.
- `baseUnit`은 기본값 자동 할당 (품목명에서 추론, 불가 시 "개"). 나중에 품목마스터 탭에서 보강.
- `itemType`은 `'product'` 고정 (변경 필요 시 품목마스터에서).
- 등록 전 유사 기존 품목 자동 검색 (`findSimilarGroups` 로직 재사용)
- 유사 품목이 있으면 "기존 품목 사용하기" 버튼으로 전환 가능
- **2단계 보강**: 품목마스터 탭에서 baseUnit/분류/유사품목 병합을 일괄 정리

**서버 변경**:
```typescript
// 신규: items.quickCreate — 인라인 등록용 경량 프로시저
items.quickCreate: storeWriteProcedure
  .input(z.object({
    name: z.string().min(1),  // 유일한 필수 필드
    baseUnit: z.string().optional(),  // 품목명에서 추론, 불가 시 '개' 기본값
    itemType: z.enum(['product', 'service', 'misc']).default('product'),
  }))
  .mutation(async ({ input }) => {
    // 1. 유사 품목 체크 (정규화 후 score ≥ 0.8이면 경고 반환)
    // 2. 품목 생성
    // 3. counterpartyItem 자동 매핑 (counterpartyId가 있으면)
    // 4. 생성된 itemId 반환
  })
```

### 5.4 단위/환산계수 입력 가이드

현재: 단위 선택은 있으나 `conversionToBase`는 입력 UI에 노출되지 않음.
변경: 품목 마스터의 `baseUnit`과 입력 단위가 다를 때 환산계수 입력 유도.

```
[양파] 마스터 기준단위: kg

입력 단위: [박스 ▼]  ← 거래처 납품 단위

⚠️ "박스" → "kg" 환산계수를 입력하세요
   1 박스 = [ 10 ] kg
   → kg당 ₩2,500 (박스 ₩25,000 기준)

   💡 이전 입고: A농산 양파 박스 = 10kg (2회 사용)
```

**트리거 조건** (거래처-품목 쌍 당 최초 1회만):
- 입력 단위 ≠ 품목 baseUnit
- 해당 거래처-품목 매핑에 `conversionToBase`가 NULL이거나 1
- 이미 `conversionToBase` 값이 설정된 쌍은 안내 생략, 자동 적용

**자동 제안**:
- 동일 거래처-품목의 과거 환산계수가 있으면 자동 채움
- 없으면 품목명에서 수량 추출 시도 ("양파 10kg" → 10)

**저장 시**:
- 환산계수가 설정되면 `counterparty_items.conversionToBase` 자동 업데이트
- 가격분석에서 기준단위가 자동 계산 가능

### 5.5 저장 전 검증 강화

현재 검증: 거래처 필수, 최소 1항목 (품명+금액)
변경: 데이터 품질 검증 추가

```typescript
const handleOcrCreate = () => {
  // 기존 검증
  if (!counterpartyId) { toast.error('거래처를 선택하세요.'); return; }
  
  const validItems = purchaseItems.filter(i => i.rawItemName.trim() && parseFloat(i.lineTotal || '0') > 0);
  if (validItems.length === 0) { toast.error('최소 1개 항목을 입력하세요.'); return; }

  // ── 신규 검증 ──

  // 1. 미매칭 품목 경고
  const unmatchedItems = validItems.filter(i => !i.matchedItemId);
  if (unmatchedItems.length > 0) {
    // 소프트 경고: 저장은 가능하되 확인 필요
    const proceed = confirm(
      `${unmatchedItems.length}개 품목이 마스터에 매칭되지 않았습니다:\n` +
      unmatchedItems.map(i => `  · ${i.rawItemName}`).join('\n') +
      `\n\n매칭 없이 저장하면 가격분석에서 제외됩니다.\n그래도 저장하시겠습니까?`
    );
    if (!proceed) return;
  }

  // 2. 중복 입고 감지
  // → purchasesV2.checkDuplicate 호출 (§4 중복관리 → 입력 시 차단 참조)

  // 3. 단가 이상치 경고
  const priceAlerts = validItems.filter(i => {
    if (!i.matchedItemId || !i.unitPrice) return false;
    // counterpartyItems의 lastPrice 대비 ±50% 벗어나면 경고
    const ci = cpItems.find((c: any) => c.itemId === i.matchedItemId);
    if (!ci?.lastPrice) return false;
    const ratio = parseFloat(i.unitPrice) / parseFloat(ci.lastPrice);
    return ratio < 0.5 || ratio > 1.5;
  });
  if (priceAlerts.length > 0) {
    toast.warning(
      `${priceAlerts.length}개 품목의 단가가 평소와 크게 다릅니다. 확인해주세요.`,
      { duration: 5000 }
    );
    // 해당 항목에 '⚠️ 단가 이상' 마커 표시 (저장 차단은 아님)
  }

  // 4. 수량 0 또는 단가 0 경고
  const zeroItems = validItems.filter(i => 
    (i.quantity && parseFloat(i.quantity) === 0) || 
    (i.unitPrice && parseFloat(i.unitPrice) === 0)
  );
  if (zeroItems.length > 0) {
    toast.warning(`${zeroItems.length}개 항목의 수량 또는 단가가 0입니다.`);
  }

  // 검증 통과 → 저장 진행
  createOrder.mutate({ ... });
};
```

### 5.6 저장 후 학습 피드백 루프

현재: `ocrOriginalItems`와 수정된 `validItems`를 `/api/ocr/submit-correction`에 제출.
변경: 수정 데이터를 더 적극적으로 활용.

**A. 품목 자동 매핑 생성**

저장 시 `itemId`가 있는데 해당 거래처에 `counterpartyItem` 매핑이 없으면 자동 생성:
```typescript
// createOrder 내부
for (const item of items) {
  if (item.matchedItemId && counterpartyId) {
    const existingMapping = await db.select()
      .from(counterpartyItems)
      .where(and(
        eq(counterpartyItems.counterpartyId, counterpartyId),
        eq(counterpartyItems.itemId, item.matchedItemId),
      ))
      .limit(1);
    
    if (existingMapping.length === 0) {
      await db.insert(counterpartyItems).values({
        restaurantId: input.restaurantId,
        counterpartyId,
        itemId: item.matchedItemId,
        supplierItemName: item.rawItemName,
        purchaseUnit: item.unitName || '개',
        lastPrice: item.unitPrice || null,
        isActive: true,
      });
    }
  }
}
```

**B. OCR 정규화 사전 축적**

사용자가 OCR 원본 "양파10키로"를 "양파 (10kg)"로 수정 → 매핑 저장:
```
ocr_corrections 테이블 활용:
  originalName: "양파10키로" → correctedName: "양파" + matchedItemId: 42
  → 다음 OCR 시 "양파10키로" 인식하면 itemId=42 자동매칭 (score 보너스)
```

**C. 거래처별 빈출 품목 순서 학습**

`counterparty_ocr_profiles.frequentItems`에 빈도순 정렬:
- 동일 거래처 재입력 시 품목 드롭다운 상단에 빈출 품목 표시
- "A농산에서 자주 입고하는 품목: 양파, 감자, 당근, 대파"

### 5.7 수동 입력 시 가이드 (OCR 없이 직접 입력)

현재: OCR 없이 수동 입력 시 빈 폼에서 시작. 가이드 없음.
변경: 거래처 선택 즉시 해당 거래처의 최근 입고 품목을 템플릿으로 제안.

```
거래처: [A농산] 선택 완료

┌──────────────────────────────────────────┐
│ 💡 A농산 최근 입고 품목 (빠른 추가)      │
│                                          │
│ [+ 양파 10kg @₩25,000]                   │
│ [+ 감자 20kg @₩32,000]                   │
│ [+ 당근 5kg @₩15,000]                    │
│ [+ 대파 3단 @₩9,000]                     │
│                                          │
│ [전체 추가] [직접 입력]                   │
└──────────────────────────────────────────┘
```

**"빠른 추가" 클릭 시**:
- 해당 품목이 `purchaseItems`에 추가 (수량/단가는 최근 값으로 프리필)
- `itemId`, `counterpartyItemId` 자동 매핑됨
- 사용자는 수량/단가만 수정하면 됨

**"전체 추가"**:
- 최근 입고 내역의 전 품목을 한 번에 추가
- 수량/단가를 최근 값으로 프리필

**데이터 소스**: `purchasesV2.getRecentOrdersByCounterparty` (이미 존재) 활용.
단, 현재는 전표 단위 반환 → 품목 단위 반환으로 변경 필요:
```typescript
// 변경: 거래처별 최근 매입 품목 (고유 품목 리스트 + 최근 단가)
purchasesV2.recentItemsByCounterparty: storeReadProcedure
  .input(z.object({ counterpartyId: z.number() }))
  .query(async ({ input }) => {
    // 최근 3개월 내 해당 거래처 입고 품목
    // GROUP BY itemId → 최근 단가, 평균 수량, 입고 횟수
    // 빈도순 정렬
  })
```

### 5.8 품목명 정규화 제안 (입력 시점)

사용자가 품명 필드에 직접 타이핑할 때, 실시간으로 정규화 제안.

**정규화 범위 (최소한만)**:

의미를 변경하는 정규화(브랜드/등급 제거 등)는 위험도가 높으므로 적용하지 않음.
"프리미엄 소시지"와 "소시지"는 다른 품목일 수 있다.

적용하는 것: 공백 정리, 특수문자 정리, 괄호 내 규격 분리만.
실질적 유사품목 판정은 `fuzzyScore`에 위임.

```typescript
function suggestNormalizedName(raw: string): string | null {
  let normalized = raw;
  
  // 1. 괄호 내 규격 정보를 분리 제안: "(10kg)", "(냉동)" 등
  //    → 규격은 단위/비고 필드로 이동 권장
  const bracketMatch = normalized.match(/\s*[\(（]([^)）]+)[\)）]/);
  const specNote = bracketMatch ? bracketMatch[1] : null;
  normalized = normalized.replace(/\s*[\(（].*?[\)）]/g, '');
  
  // 2. 후행 숫자+단위 분리: "양파 10kg" → "양파" + 규격 "10kg"
  normalized = normalized.replace(/\s+\d+\s*(kg|g|L|ml|개|팩|박스|봉|병|근|포)$/i, '');
  
  // 3. 연속 공백/특수문자 정리
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized !== raw.trim() ? normalized : null;
}
```

**UI 표시**:
```
입력: [양송이버섯 1kg]

💡 품목명 제안: "양송이버섯"  (후행 규격 "1kg" 분리)
   [제안 적용] [원본 유지]

입력: [양파(10kg) 국내산]

💡 품목명 제안: "양파 국내산"  (괄호 규격 "(10kg)" 분리)
   [제안 적용] [원본 유지]
```

> 주의: 브랜드("프리미엄"), 원산지("국내산"), 등급("1등급") 등 의미 변경 가능한
> 접두어/접미어는 제거하지 않음. 이들이 실제 다른 품목을 가리킬 수 있기 때문.

### 5.9 구현 우선순위 (가이드 강화 단독)

| 단계 | 작업 | 효과 |
|---|---|---|
| **G1** | 저장 전 미매칭 경고 (§5.5 #1) | 최소 비용으로 데이터 품질 의식 향상 |
| **G1** | 저장 후 counterpartyItem 자동 생성 (§5.6-A) | 2회차부터 자동매칭률 급상승 |
| **G2** | 품명 필드 매칭 상태 통합 표시 (§5.2) | 미매칭 인지도 향상, 후보 클릭 유도 |
| **G2** | 수동 입력 시 최근 품목 템플릿 (§5.7) | 수동 입력 속도 + 매칭률 동시 개선 |
| **G3** | 신규 품목 인라인 등록 (§5.3) | itemId NULL 근본 해결 |
| **G3** | 단위 환산계수 입력 가이드 (§5.4) | 가격분석 정확도 근본 개선 |
| **G4** | 품목명 정규화 제안 (§5.8) | 유사품목 생성 사전 차단 |
| **G4** | OCR 수정 → 자동매칭 사전 축적 (§5.6-B) | 장기 OCR 정확도 자동 향상 |

---

## 6. 서버 변경 목록

### 신규 프로시저

| 프로시저 | 위치 | 설명 |
|---|---|---|
| `items.listWithMappings` | items.ts | 품목 + counterpartyItems + 기준단위가 통합 조회 |
| `items.quickCreate` | items.ts | 인라인 신규 품목 등록 (품목명만 필수, baseUnit 자동추론/기본값 + 유사품목 체크) |
| `purchasesV2.savingOpportunities` | purchasesV2.ts | 절감기회 산출 (가격갭 × 월평균수량) |
| `purchasesV2.checkDuplicate` | purchasesV2.ts | createOrder 전 중복 감지 |
| `purchasesV2.recentItemsByCounterparty` | purchasesV2.ts | 거래처별 최근 매입 품목 (빈도순, 최근 단가 포함) |

### 수정 프로시저

| 프로시저 | 변경 내용 |
|---|---|
| `purchasesV2.itemPriceComparison` | `rawItemName` → `itemId` JOIN, 기준단위가 환산 추가 |
| `purchasesV2.itemPriceTrend` | `rawItemName` → `itemId` JOIN, 기준단위가 환산 추가 |
| `purchasesV2.createOrder` | 중복 감지 경고 반환 + 미매칭 경고 + counterpartyItem 자동 생성 |
| `purchasesV2.getRecentOrdersByCounterparty` | 전표 단위 → 품목 단위 반환으로 변경 (빈도순) |

### 제거 가능 프로시저

| 프로시저 | 사유 |
|---|---|
| `purchasesV2.findDuplicates` | 탭에서는 제거하되 프로시저 자체는 유지 (다중 사용자 동시 입력 시 사후 정리용) |
| `purchasesV2.deleteDuplicate` | 위와 동일 — findDuplicates와 함께 유지 |
| `purchasesV2.pendingOrders` | DailyOpsPage에서만 사용 (이미 존재) → 유지하되 매입관리에서 제거 |

---

## 7. 구현 우선순위 (전체 통합, §5 참조 포함)

### Phase 0: 분석 기반 교정 (서버만, UI 변경 최소)

| ID | 작업 | 완료 조건 |
|---|---|---|
| **P0-1** | 기존 `itemId=NULL` 레코드 일괄 역매핑 (fuzzy match + 수동 큐) | NULL 비율 10% 이하로 감소 |
| **P0-2** | 분석 쿼리 `rawItemName` → `itemId` 전환 + `itemId IS NULL` "미분류" 그룹 별도 집계 | 가격비교/추이가 itemId 기준 작동, 기존 데이터 누락 없음 |
| **P0-3** | 기준단위 환산 로직 추가 | 다른 단위 납품도 동일 기준 비교 가능 |

### Phase 1: 입력 품질 강화 + UI 축소

| ID | 작업 | 완료 조건 |
|---|---|---|
| **P1-1** | 저장 전 미매칭 경고 (§5.5) | itemId NULL 항목 저장 시 confirm 경고 |
| **P1-2** | 저장 후 counterpartyItem 자동 생성 (§5.6-A) | 2회차 입고부터 자동매칭률 향상 검증 |
| **P1-3** | `createOrder` 중복 감지 (§4, §5.5 #2) | 동일 조건 전표 존재 시 경고 반환 |
| **P1-4** | 3탭 UI 재구성 (§3) | 7탭 → 3탭 전환 완료, 빌드 통과 |
| **P1-5** | `items.listWithMappings` 프로시저 | 품목마스터 탭 데이터 소스 작동 |

### Phase 2: 입력 UX 고도화

| ID | 작업 | 완료 조건 |
|---|---|---|
| **P2-1** | 품명 필드 매칭 상태 통합 표시 (§5.2) | 초록/노랑/빨강 3상태 시각 구분 |
| **P2-2** | 수동 입력 시 최근 품목 템플릿 (§5.7) | 거래처 선택 시 빈출 품목 리스트 표시 |
| **P2-3** | 신규 품목 인라인 등록 (§5.3) | 미매칭 시 인라인 등록 → itemId 즉시 연결 |
| **P2-4** | 단위 환산계수 입력 가이드 (§5.4) | baseUnit ≠ 입력단위 시 환산계수 입력 UI |

### Phase 3: 분석 고도화

| ID | 작업 | 완료 조건 |
|---|---|---|
| **P3-1** | `savingOpportunities` 쿼리 + 절감기회 UI | 월 예상 절감액 표시 |
| **P3-2** | 이상치 자동 감지 (이동평균 ±20%) | 추이 뷰에 alert 마커 표시 |
| **P3-3** | 품목명 정규화 제안 (§5.8) | 입력 시 정규화 이름 자동 제안 |
| **P3-4** | OCR 수정 → 자동매칭 사전 축적 (§5.6-B) | correction 데이터 → 매칭 점수 보너스 |

---

## 8. 리스크 및 한계

### 기존 데이터 호환

- `rawItemName`만 있고 `itemId=NULL`인 기존 레코드는 가격분석에서 제외될 위험
- **P0-1에서 선행 처리**: 마이그레이션 스크립트로 기존 `rawItemName` → `itemId` 역매핑 시도 (fuzzy match, score ≥ 0.7 자동, 이하는 수동 큐)
- **분석 쿼리에 안전장치**: `itemId IS NULL` 레코드를 "미분류" 그룹으로 별도 집계하여 총액 불일치 방지
- 매칭 불가 건은 품목마스터 탭에서 "미매칭 항목" 섹션으로 노출, 수동 연결 유도

### `conversionToBase` 데이터 품질

- 기존 `counterparty_items`의 `conversionToBase`가 대부분 NULL 또는 1일 가능성
- **완화**: 환산계수 없으면 기준단위가 = 납품단가 그대로 표시 + "환산계수 미설정" 표시
- 입력 시 OCR 인식 단위 + baseUnit 비교로 자동 제안

### 절감기회 산출 정확도

- 품목 단위 불균일, 계절 가격 변동, 최소 주문량 등 미반영
- **한계 명시**: "예상 절감액은 단순 단가 차이 기반이며, 배송비·MOQ·품질 차이를 반영하지 않음"

---

## 9. 거래처 CRUD 이관 계획

거래처 관리 기능 자체를 삭제하는 것이 아님. 접근 경로를 정리하는 것.

**품목 0개 거래처 처리**: 품목마스터 탭 상단에 "거래처 관리" 필터/서브뷰를 제공.
품목이 연결되지 않은 거래처도 이 뷰에서 조회·편집·비활성화 가능.
신규 거래처 등록도 이 진입점에서 수행.

| 기능 | 현재 위치 | 이관 후 |
|---|---|---|
| 거래처 신규 등록 | PurchaseManagementPage > 거래처 탭 | DailyOpsPage 매입 입력 시 인라인 생성 (이미 존재) |
| 거래처 정보 수정 | PurchaseManagementPage > 거래처 탭 | 품목마스터 탭에서 거래처 행 탭 시 수정 모달 |
| 거래처 비활성화 | PurchaseManagementPage > 거래처 탭 | 품목마스터 탭에서 거래처 행 내 비활성화 |
| 거래처 목록 조회 | PurchaseManagementPage > 거래처 탭 | 품목마스터 탭의 품목→거래처 구조로 자연스럽게 조회 |
