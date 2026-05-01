# 거래처 월매입정산표 OCR 대조 — 구현 명세

> 작성: 2026-05-01 (Cowork 설계 → Claude Code 전달용)
> 위치: 월정산 페이지(`/monthly-settlement`) 매입 섹션
> 사용자 결정 (2026-05-01):
> - 비교 단위: **월합계 우선 → 불일치 시 일자/항목 드릴다운**
> - 양식 범위: **양식 무관 범용 OCR** (양식별 분기 X, 후처리로 정규화)
> - 부가세 처리: **거래처별 플래그** (`counterparties.settlementBasis`)
> - 차이 처리: **보고 + 항목별 선택 적용** (체크박스 → 일괄 동기화)

---

## 1. 개요

거래처가 월말에 발행하는 월매입정산표(거래원장)를 사진/PDF로 업로드하면 OCR로 인식하여 `purchase_orders_v2` 입력 내역과 자동 대조한다. 차이가 발견되면 항목별로 보여주고 사용자가 선택해 적용한다.

### 입력 양식 다양성 (확인된 2종)
- (주)331컴퍼니 — Ecount 단순 양식: 일자/적요/판매/수금/잔액
- 풍부한 식자재 공급업체 양식: 연월일/유형/품목/규격/수량/단가/판매금액/반품액/결제액/미수금/비고

→ 양식별 파서 작성 비현실적. **Claude Vision에 자유 형식으로 던져 정규화된 JSON으로 받는다.**

### 비교 흐름 (단계적)

```
[1] 월합계 비교 (항상 실행)
    OCR 정산표 월계 vs 시스템 매입 월합계
    ├─ ±오차범위 내 → "정상" 표시 후 종료
    └─ 불일치 → [2]로 진행

[2] 일자별 합계 비교
    OCR의 일자별 매입 합계 vs 시스템 일자별 매입 합계
    ├─ 모든 일자 일치 → "월합계 계산오차" 경고 후 종료
    └─ 불일치 일자 식별 → [3]로 진행 (해당 일자만)

[3] 항목 단위 비교 (불일치 일자에 한정)
    OCR 항목별 (일자+품목+수량+단가+금액) vs 시스템 매입 항목
    ├─ 매칭됨 + 금액 일치 → "정상"
    ├─ 매칭됨 + 금액 불일치 → "금액 차이"
    ├─ OCR에만 존재 → "시스템 누락"
    └─ 시스템에만 존재 → "정산표 누락" (반대 방향 차이)
```

---

## 2. DB 스키마 변경 (자동 마이그레이션)

`server/index.ts` 시작 시 ALTER TABLE IF NOT EXISTS로 처리.

### 2.1 `counterparties` — 정산표 비교 기준 플래그
```sql
ALTER TABLE counterparties
  ADD COLUMN IF NOT EXISTS settlementBasis VARCHAR(20) DEFAULT 'supply',
  ADD COLUMN IF NOT EXISTS settlementMatchTolerance INT DEFAULT 100;
```
- `settlementBasis`: `'supply'`(공급가) | `'total'`(공급가+부가세) | `'mixed'`(과세/면세 혼합 — 항목별 자동판정)
- `settlementMatchTolerance`: 합계 비교 허용 오차(원). 기본 100원 (원단위 절상/절사 흡수)

### 2.2 신규 테이블 `settlement_statement_audits` — 대조 이력 보존
```sql
CREATE TABLE IF NOT EXISTS settlement_statement_audits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  restaurantId INT NOT NULL,
  counterpartyId INT,
  counterpartyNameRaw VARCHAR(100),  -- OCR이 읽은 거래처명 원문 (매칭 실패 시 보존)
  yearMonth VARCHAR(7) NOT NULL,     -- 'YYYY-MM'
  imageUrl VARCHAR(500),
  ocrRawData JSON NOT NULL,          -- OCR 원본 응답 전체
  parsedItems JSON NOT NULL,         -- 정규화된 항목 배열
  ocrTotal DECIMAL(14,2),            -- 정산표 월계
  systemTotal DECIMAL(14,2),         -- 시스템 매입 월합계
  diffSummary JSON,                  -- {dateMismatches, itemMismatches, missingInSystem, missingInStatement}
  status ENUM('pending','reviewed','applied','dismissed') DEFAULT 'pending',
  appliedActions JSON,               -- 사용자가 적용한 액션 로그
  createdBy INT NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewedAt TIMESTAMP NULL,
  appliedAt TIMESTAMP NULL,
  INDEX idx_restaurant_month (restaurantId, yearMonth),
  INDEX idx_counterparty (counterpartyId)
);
```

이력 보존 이유: 같은 정산표를 두 번 올렸을 때 중복 적용 방지 + 사후 감사.

---

## 3. 서버 구현

### 3.1 OCR 엔드포인트 — `POST /api/ocr/extract-statement`

`server/ocr.ts`에 추가. 기존 `extract-purchase` 패턴 그대로.

```ts
// 요청
{ imageUrls: string[], restaurantId: number, hintCounterpartyId?: number, hintYearMonth?: string }

// 응답
{
  counterpartyName: string | null,        // OCR이 읽은 거래처명
  counterpartyId: number | null,          // findCounterpartyId() 매칭 결과
  yearMonth: string | null,               // 'YYYY-MM' (헤더에서 추출)
  items: Array<{
    date: string,                         // 'YYYY-MM-DD'
    rawItemName: string,                  // 적요 원문
    itemName: string,                     // 정규화된 품목명
    spec: string | null,                  // 규격/단위 (예: '1kg', '박스')
    quantity: number | null,
    unitPrice: number | null,
    lineTotal: number,                    // 판매금액 (정산표상)
    taxType: 'taxable' | 'exempt' | 'unknown',
    uncertain: boolean,
    confidence: number
  }>,
  monthlySummary: {
    salesTotal: number | null,            // 월 판매 합계
    paymentTotal: number | null,          // 월 수금 합계 (있으면)
    balance: number | null                // 잔액 (있으면)
  },
  rawText: string                         // 디버깅용 원본
}
```

#### 프롬프트 핵심 지시사항
- "이것은 거래처가 발행한 월매입정산표(거래원장)이다. 한 거래처와 한 매장 사이의 한 달치 거래내역이다."
- "헤더에서 거래처명·사업자번호·연월을 추출"
- "각 거래라인은 일자+품목+수량+단가+합계금액 4~5요소"
- "판매/수금/잔액 컬럼이 있으면 판매만 추출. 수금/잔액은 monthlySummary에"
- "적요란이 `품목(원산지) [규격] / 수량 * 단가` 형식이면 분해"
- "한 일자에 여러 품목 행이 있으면 모두 추출"
- "월계/거래처계 행은 monthlySummary로"
- 기존 `validateAndEnrichItems`와 유사한 검증 적용

#### 거래처 매칭 (재사용)
- `findCounterpartyId(name, restaurantId)` 그대로 사용
- 실패 시 `counterpartyName` 원문만 보존 → UI에서 사용자가 거래처 수동 지정

### 3.2 tRPC 라우터 — `server/routers/settlementStatements.ts` (신규)

```ts
// 1. extractAndCompare (managerProcedure)
input: { imageUrls: string[], restaurantId, counterpartyId?, yearMonth? }
output: {
  audit: SettlementStatementAudit,        // settlement_statement_audits 행
  comparison: {
    level: 'monthly_match' | 'date_mismatch' | 'item_mismatch',
    monthly: { ocr: number, system: number, diff: number, ok: boolean },
    dates?: Array<{ date, ocrTotal, systemTotal, diff, ok }>,
    items?: Array<{
      kind: 'match' | 'amount_diff' | 'missing_in_system' | 'missing_in_statement',
      ocrItem?: ParsedItem,
      systemItem?: { purchaseOrderId, itemId, ...},
      diff?: number
    }>
  }
}

// 2. listAudits (managerProcedure) — 매장+월 조회
input: { restaurantId, yearMonth }
output: SettlementStatementAudit[]

// 3. getAudit (managerProcedure)
input: { auditId }
output: SettlementStatementAudit + 재계산된 comparison

// 4. applySelectedActions (managerProcedure, 트랜잭션)
input: {
  auditId,
  actions: Array<{
    type: 'add_to_system' | 'update_amount' | 'create_order' | 'dismiss',
    itemRef: ...,
    targetPurchaseOrderId?: number,
    payload?: { quantity, unitPrice, lineTotal, ... }
  }>
}
처리:
  - 트랜잭션 내에서 각 액션을 purchase_orders_v2 / purchase_order_items_v2에 반영
  - audit.status='applied', appliedActions 기록
  - editHistory에 "정산표 대조 적용" 항목 추가

// 5. dismissAudit (managerProcedure)
input: { auditId, reason? }
status='dismissed'로만 표시
```

`verifyStoreAccess` 미들웨어 필수.

### 3.3 비교 알고리즘 상세

```ts
function compareWithSystem(
  ocrItems: ParsedItem[],
  systemPurchases: PurchaseOrderV2WithItems[],
  counterparty: Counterparty,
  monthlySummary
): ComparisonResult {
  const tol = counterparty.settlementMatchTolerance ?? 100;

  // === Level 1: 월합계 ===
  const ocrMonthTotal = monthlySummary.salesTotal
    ?? sum(ocrItems.map(i => i.lineTotal));
  const sysMonthTotal = sum(systemPurchases.flatMap(p => p.items.map(it => it.lineTotal)));
  const monthlyOk = Math.abs(ocrMonthTotal - sysMonthTotal) <= tol;

  if (monthlyOk) return { level: 'monthly_match', monthly: {...} };

  // === Level 2: 일자별 합계 ===
  const ocrByDate = groupByDate(ocrItems);
  const sysByDate = groupByDate(systemPurchases);
  const allDates = union(Object.keys(ocrByDate), Object.keys(sysByDate));
  const dateRows = allDates.map(d => {
    const o = sumLine(ocrByDate[d] ?? []);
    const s = sumLine(sysByDate[d] ?? []);
    return { date: d, ocrTotal: o, systemTotal: s, diff: o - s, ok: Math.abs(o - s) <= tol };
  });
  const mismatchDates = dateRows.filter(r => !r.ok);

  if (mismatchDates.length === 0) {
    // 일자별로는 다 맞는데 월계만 다름 — 합계 계산 오차
    return { level: 'date_mismatch', monthly, dates: dateRows };
  }

  // === Level 3: 항목 단위 (불일치 일자만) ===
  const itemRows: ItemDiff[] = [];
  for (const dRow of mismatchDates) {
    const ocrItemsOfDate = ocrByDate[dRow.date] ?? [];
    const sysItemsOfDate = (sysByDate[dRow.date] ?? []).flatMap(p => p.items.map(it => ({ ...it, purchaseOrderId: p.id })));

    // 매칭 전략: 정규화된 itemName 우선 → counterparty_items.alias → 유사도(>0.8)
    // 매칭 시 단가/수량/lineTotal 비교
    const matched = matchItemsByName(ocrItemsOfDate, sysItemsOfDate);
    // matched: [{ ocr, sys?, kind }]
    itemRows.push(...matched);
  }

  return { level: 'item_mismatch', monthly, dates: dateRows, items: itemRows };
}
```

매칭 함수는 기존 `matchCounterpartyItems` / `fuzzyScore` / `normalizeKorean` 재사용.

### 3.4 부가세 처리

비교 직전 `counterparty.settlementBasis`로 분기:
- `'supply'`: 시스템 lineTotal 그대로 비교 (현 시스템이 공급가 입력 전제)
- `'total'`: 시스템 lineTotal × 1.1 vs OCR lineTotal
- `'mixed'`: 항목별 `taxType`로 결정 (taxable이면 ×1.1, exempt면 그대로). OCR이 taxType을 못 잡으면 단가 추정으로 보정 — 1차 구현은 보류, "혼합 거래처는 정확도 낮음" 경고만 표시.

---

## 4. UI

### 4.1 진입점 — MonthlySettlementPage 매입 섹션

기존 매입 카드 옆에 **"정산표 대조"** 보조 버튼 추가. 클릭 시 모달.

### 4.2 모달 — `SettlementStatementCompareModal`

#### Step 1: 업로드
- 거래처 선택 드롭다운 (월에 매입 있는 거래처 목록 + "OCR로 자동감지")
- 이미지/PDF 업로드 (다중, 긴 정산표는 페이지 여러 장)
- "분석 시작" → `extractAndCompare` 호출

#### Step 2: 결과 (비교 레벨에 따라 다른 화면)

**a) `monthly_match`** — 초록 배지 "월합계 일치 (오차 ±N원 이내)" + 닫기

**b) `date_mismatch` (일자별로는 다 맞음)** — 노란 배지 "월합계만 N원 차이. 일자별 합계는 모두 일치." + 일자별 표

**c) `item_mismatch`** — 메인 화면. 4개 섹션:
1. **금액 차이** — `[ ] 시스템 금액 → 정산표 금액으로 수정` 체크박스 행
2. **시스템 누락** (정산표에 있는데 시스템엔 없음) — `[ ] 시스템에 매입 추가` 체크박스 행
3. **정산표 누락** (시스템에 있는데 정산표엔 없음) — `[ ] 무시(반품/오입력 가능)` 또는 `[ ] 시스템에서 삭제 표시`
4. **정상** (참고용 접힘)

각 행에 OCR원본 / 시스템값 / 차액 표시. 하단 "선택 항목 적용" 버튼 → `applySelectedActions` 호출.

### 4.3 신규 매입 추가 시 처리
- "시스템에 매입 추가" 액션 선택 시:
  - 같은 일자+거래처의 기존 `purchase_orders_v2`가 있으면 → 그 전표에 항목만 추가
  - 없으면 → 새 전표 생성 (`status='received'`, `purchaseDate=OCR일자`, `note='정산표 대조로 추가'`)

### 4.4 거래처 미매칭 처리
- OCR이 읽은 거래처명이 `counterparties`에 없으면 → 모달 상단에 "거래처를 선택하세요" 드롭다운 노출
- 선택 후 다시 비교 실행 (재 OCR 불필요, 캐시된 ocrRawData 사용)

---

## 5. 파일 변경 목록 (Code 작업 단위)

| 파일 | 변경 |
|---|---|
| `drizzle/schema.ts` | counterparties 컬럼 2개 추가, settlementStatementAudits 테이블 추가 |
| `server/index.ts` | 자동 마이그레이션 ALTER/CREATE 추가 |
| `server/ocr.ts` | `extract-statement` 엔드포인트 + 프롬프트 + 검증 함수 |
| `server/routers/settlementStatements.ts` | **신규** tRPC 라우터 (5개 프로시저) |
| `server/routers/index.ts` | `settlementStatements` 등록 |
| `server/routers/counterparties.ts` | `settlementBasis`/`settlementMatchTolerance` 입력 필드 추가 |
| `client/src/pages/MonthlySettlementPage.tsx` | 매입 섹션에 "정산표 대조" 버튼 |
| `client/src/components/SettlementStatementCompareModal.tsx` | **신규** 모달 |
| `client/src/pages/CounterpartiesPage.tsx` | 거래처 편집에 정산 기준 필드 |

---

## 6. 작업 순서 (Code 핸드오프 후)

각 단계 완료 조건 명시.

### Phase A — 스키마 + 백엔드 골격
1. schema.ts + 자동 마이그레이션. **완료 조건**: `pnpm run build` 통과 + 로컬에서 ALTER 문 idempotent 확인.
2. `extract-statement` OCR 엔드포인트. **완료 조건**: 첨부 PDF 2종으로 curl 호출 시 정규화된 JSON 응답 (수동 검증).
3. `settlementStatements` 라우터 5개 프로시저. **완료 조건**: tRPC 타입 빌드 통과.

### Phase B — 비교 로직
4. `compareWithSystem` 알고리즘 + 단위테스트(있으면) 또는 임시 스크립트 검증.
   **완료 조건**: 첨부 (주)331컴퍼니 정산표를 임의 매입 데이터와 비교해 3-level 결과가 나오는지 확인.

### Phase C — UI
5. `SettlementStatementCompareModal` 컴포넌트.
6. MonthlySettlementPage 매입 섹션 진입점.
7. CounterpartiesPage 정산 기준 필드.
   **완료 조건**: 빌드 통과 + 천호점(restaurantId=2) Tutorial 데이터로 수동 시나리오 1회 통과.

### Phase D — 배포
8. §4 5항 보고 → 사용자 승인 → push.

---

## 7. 알려진 한계 / 후속 과제

- **혼합 과세 거래처** (`settlementBasis='mixed'`): 1차 구현 X. OCR이 taxType을 정확히 잡지 못하면 단가 기반 추정 필요. 후속.
- **반품 처리**: xlsx 양식의 "반품액" 컬럼은 무시. 향후 `purchase_returns` 테이블 도입 시 통합.
- **수금 대조**: `monthlySummary.paymentTotal`은 저장만. 시스템에 거래처 수금 입력 기능이 없음 — 이건 별도 기획.
- **PDF 다페이지**: PDF.js로 페이지별 이미지화 후 다중 OCR. 1차는 사용자가 페이지별 캡처 업로드 권장.
- **중복 적용 방지**: 같은 yearMonth+counterpartyId의 audit이 `applied` 상태면 새 업로드 시 경고.

---

## 8. 의존 / 영향 범위

- 신규 테이블 1, 신규 컬럼 2, 신규 라우터 1, 신규 컴포넌트 1
- 기존 OCR 인프라(`getAnthropicClient`, `validateAndEnrichItems`, `findCounterpartyId`, `matchCounterpartyItems`) 재사용 — 회귀 위험 낮음
- `purchase_orders_v2` WRITE 발생 (applySelectedActions 트랜잭션) — 기존 라우터의 audit/editHistory 패턴 동일하게 적용
- 권한: `managerProcedure` 이상 (점장+매니져 공통, staff 차단)
