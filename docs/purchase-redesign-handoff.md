# 매입관리 재설계 — Claude Code 핸드오프

> 작성: 2026-04-11 (Cowork)
> 상세 명세: `docs/purchase-management-redesign.md` (QC/QA 완료)
> 진행 방식: Phase별 순차. 각 Phase 완료 후 `pnpm run build` 통과 확인.

---

## 현재 상태

- `docs/purchase-management-redesign.md` — QC/QA 반영 완료, 상세 설계 확정
- 코드 변경 없음. 착수 전 상태.

---

## Phase 0: 분석 기반 교정 (서버만, UI 무변경)

### P0-1: itemId=NULL 레코드 일괄 역매핑

**목표**: `purchase_order_items_v2`에서 `itemId IS NULL`인 레코드를 기존 `items` 마스터에 fuzzy match로 연결.

**작업**:
1. `scripts/backfill-item-ids.ts` 마이그레이션 스크립트 생성
2. `rawItemName` → `items.name` fuzzy match (ocr.ts의 `fuzzyScore` 재사용)
3. score ≥ 0.7 → 자동 UPDATE `itemId`
4. score < 0.7 → 로그 출력 (수동 큐용)
5. 실행 전 현재 NULL 비율 SELECT 쿼리로 확인
6. 실행 후 NULL 비율 10% 이하 검증

**관련 파일**: `server/ocr.ts` (fuzzyScore, normalizeKorean 함수), `drizzle/schema.ts` (purchase_order_items_v2)

**완료 조건**: 스크립트 실행 후 itemId NULL 비율 ≤ 10%

### P0-2: 분석 쿼리 itemId 전환

**목표**: `itemPriceComparison`, `itemPriceTrend`를 `rawItemName` → `itemId` JOIN으로 전환.

**작업**:
1. `server/routers/purchasesV2.ts` — `itemPriceComparison` (line ~452) 쿼리 변경
   - `rawItemName` GROUP BY → `items.id` JOIN + GROUP BY
   - `itemId IS NULL` 레코드는 "미분류" 그룹으로 별도 집계
   - 상세 SQL: 명세서 §3.2-A 참조
2. `server/routers/purchasesV2.ts` — `itemPriceTrend` (line ~519) 동일 패턴 변경
   - 상세 SQL: 명세서 §3.2-B 참조
3. 클라이언트 타입 변경 없음 (반환 필드명만 rawItemName → itemName으로 매핑)

**관련 파일**: `server/routers/purchasesV2.ts` (lines 440-620), `client/src/pages/PurchaseManagementPage.tsx` (PriceCompareTab, PriceTrendTab)

**완료 조건**: 가격비교/추이 탭이 itemId 기준으로 작동, 미분류 그룹 표시, 빌드 통과

### P0-3: 기준단위 환산 로직

**목표**: 가격 비교 시 `unitPrice / conversionToBase`로 기준단위가 환산.

**작업**:
1. P0-2에서 변경한 쿼리에 `counterparty_items` LEFT JOIN 추가
2. `CASE WHEN ci.conversionToBase > 0 THEN ... END AS basePricePerUnit` 산출
3. `conversionToBase` NULL/0/1인 경우 → 원 단가 그대로 + "(환산계수 미설정)" 표시
4. 클라이언트에서 basePricePerUnit 기준 정렬/비교

**관련 파일**: P0-2와 동일

**완료 조건**: 다른 단위(박스 vs kg)로 납품된 동일 품목이 기준단위 기준으로 비교됨

---

## Phase 1: 입력 품질 강화 + UI 축소

### P1-1: 저장 전 미매칭 경고

**목표**: DailyOpsPage 매입 저장 시 `itemId` 미매칭 항목에 소프트 경고.

**작업**:
1. `client/src/pages/DailyOpsPage.tsx` — `handleOcrCreate` 함수 (line ~1432)
2. 저장 직전 `matchedItemId` 없는 항목 카운트
3. 있으면 `confirm()` 다이얼로그: "N개 품목 미매칭, 가격분석에서 제외됩니다. 저장?"
4. 취소 시 return, 확인 시 저장 진행
5. 상세 코드: 명세서 §5.5 참조

**완료 조건**: 미매칭 품목 저장 시 경고 확인 → 저장 또는 취소

### P1-2: counterpartyItem 자동 생성

**목표**: 저장 시 itemId 있는데 해당 거래처에 매핑 없으면 자동 생성.

**작업**:
1. `server/routers/purchasesV2.ts` — `createOrder` mutation 내부
2. 각 item에 대해 counterpartyItems 테이블 조회
3. 매핑 없으면 INSERT (supplierItemName=rawItemName, purchaseUnit, lastPrice)
4. 상세 코드: 명세서 §5.6-A 참조

**관련 파일**: `server/routers/purchasesV2.ts` (createOrder), `drizzle/schema.ts` (counterparty_items)

**완료 조건**: 신규 거래처-품목 조합 저장 후 counterparty_items에 레코드 생성 확인

### P1-3: createOrder 중복 감지

**목표**: 동일 날짜+거래처+유사금액(±5%) 주문 존재 시 경고.

**작업**:
1. `server/routers/purchasesV2.ts` — 신규 프로시저 `checkDuplicate` 또는 createOrder 내부
2. 저장 전 SELECT: 같은 restaurantId + counterpartyId + purchaseDate + totalAmount ±5%
3. 존재 시 경고 정보 반환 (저장 차단은 아님)
4. 클라이언트에서 경고 표시 후 사용자 확인

**완료 조건**: 동일 조건 전표 존재 시 경고 표시, 사용자 확인 후 저장 가능

### P1-4: 3탭 UI 재구성

**목표**: PurchaseManagementPage 7탭 → 3탭 (품목마스터, 가격분석, 매입현황).

**작업**:
1. `client/src/pages/PurchaseManagementPage.tsx` — TabId 타입 변경: `"master" | "analysis" | "history"`
2. 품목마스터 탭: 신규 컴포넌트 (P1-5의 데이터 소스 사용)
3. 가격분석 탭: 기존 PriceCompareTab + PriceTrendTab 통합 (세그먼트 토글: 거래처비교/가격추이)
4. 매입현황 탭: 기존 MonthlyPurchaseTab 유지 + 전월 대비 증감률 추가
5. 거래처 관리: 품목마스터 탭 상단에 "거래처 관리" 서브뷰 진입점 (명세서 §9)
6. SuppliersTab, PendingOrdersTab, DuplicatesTab, ItemManagementTab 코드 제거
7. AppLayout.tsx 네비 변경 불필요 (페이지 경로 동일)

**주의**: 
- findDuplicates/deleteDuplicate 프로시저는 서버에서 제거하지 않음 (사후 정리용 유지)
- pendingOrders 프로시저도 유지 (DailyOpsPage에서 사용)

**완료 조건**: 3탭 작동, 빌드 통과, 기존 7탭 코드 정리 완료

### P1-5: items.listWithMappings 프로시저

**목표**: 품목마스터 탭 데이터 소스.

**작업**:
1. `server/routers/items.ts` — 신규 프로시저 `listWithMappings`
2. items LEFT JOIN counterparty_items LEFT JOIN counterparties
3. 기준단위가 계산 포함: `lastPrice / conversionToBase`
4. 정렬: 거래처 수 DESC, 품목명 ASC
5. storeReadProcedure 레벨

**완료 조건**: 품목마스터 탭에서 품목-거래처 매핑 + 기준단위가 표시

---

## Phase 2: 입력 UX 고도화

### P2-1: 품명 필드 매칭 상태 통합 표시
- DailyOpsPage 품목 입력 combobox에 초록/노랑/빨강 3상태 시각 구분
- 명세서 §5.2 UI 와이어프레임 참조

### P2-2: 수동 입력 시 최근 품목 템플릿
- 거래처 선택 즉시 빈출 품목 리스트 표시
- `purchasesV2.recentItemsByCounterparty` 신규 프로시저 필요
- 명세서 §5.7 참조

### P2-3: 신규 품목 인라인 등록
- 미매칭 시 인라인 등록 (품목명만 필수, baseUnit 자동추론)
- `items.quickCreate` 신규 프로시저 필요
- 명세서 §5.3 참조

### P2-4: 단위 환산계수 입력 가이드
- baseUnit ≠ 입력단위 시 환산계수 입력 UI
- 거래처-품목 쌍 당 최초 1회만 트리거
- 명세서 §5.4 참조

---

## Phase 3: 분석 고도화

### P3-1: 절감기회 (savingOpportunities)
- 주거래처 판정: 최근 3개월 입고 건수 최다
- 가격갭 × 월평균수량 = 월 예상 절감액
- 명세서 §3.2-C 참조

### P3-2: 이상치 자동 감지
- 이동평균(최근 5건) 대비 ±20% → alert 마커

### P3-3: 품목명 정규화 제안
- 공백·괄호 규격·후행 단위만 분리 (브랜드/원산지 제거 안 함)
- 명세서 §5.8 참조

### P3-4: OCR 수정 → 자동매칭 사전 축적
- correction 데이터 → fuzzyScore 보너스
- 명세서 §5.6-B 참조

---

## 핵심 파일 맵

| 파일 | Phase | 변경 종류 |
|---|---|---|
| `server/routers/purchasesV2.ts` | P0, P1 | 쿼리 전환, createOrder 수정, 신규 프로시저 |
| `server/routers/items.ts` | P1, P2 | listWithMappings, quickCreate 신규 |
| `client/src/pages/PurchaseManagementPage.tsx` | P0, P1 | 7탭→3탭 재구성, 타입 변경 |
| `client/src/pages/DailyOpsPage.tsx` | P1, P2 | 저장 검증, combobox 강화, 템플릿 |
| `server/ocr.ts` | P0 | fuzzyScore 함수 재사용 (변경 없음) |
| `drizzle/schema.ts` | — | 스키마 변경 없음 (기존 컬럼 활용) |
| `scripts/backfill-item-ids.ts` | P0 | 신규 마이그레이션 스크립트 |

## 스키마 변경 없음 확인

모든 Phase에서 DB 스키마 추가/변경 없음. 기존 테이블·컬럼만 활용:
- `purchase_order_items_v2.itemId` (이미 존재, 활용률 향상)
- `purchase_order_items_v2.counterpartyItemId` (이미 존재)
- `counterparty_items.conversionToBase` (이미 존재, 활용 시작)
- `counterparty_items.purchaseUnit` (이미 존재)

## 진행 규칙

1. Phase 0부터 순차 진행. Phase 건너뛰기 금지 (P0이 P1의 전제).
2. 각 Phase 완료 후 `pnpm run build` 통과 필수.
3. Phase 내 작업 순서는 ID 순서 권장이나 의존성 없으면 자율.
4. P0-1(역매핑 스크립트)은 **Railway prod DB에 직접 실행** → 정지 조건 §2.1 적용, 승인 대기.
5. git push 전 5항 요약 보고.
