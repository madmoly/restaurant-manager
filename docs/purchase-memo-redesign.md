# 발주 메모 재설계 — 구현 스펙

> 작성: 2026-04-05
> 상태: 확정 — Claude Code 실행 대기

## 배경

매입탭 발주입력이 "정식 발주 시스템"(발주→입고 상태전환, 품목별 라인아이템, 단가계산)으로 과잉 설계됨.
실제 사용: 전화/카톡/직접 등 외부에서 발주 → **"뭘 발주했는지 기억"**만 하면 됨.

## 확정 설계

### 컨셉: "발주 메모 + 입고 리마인더"

- 발주 = 거래처 + 내용(자유텍스트) + 사진(선택)
- 금액 입력 불필요
- 발주방식 구분 불필요
- 입고 확인 = 체크박스 (대시보드/운영일지에서 "입고됐나요?" 리마인더)

### OCR 전표입력은 별도 흐름으로 분리 유지

발주 메모와 OCR 매입은 다른 행위:
- 발주 메모: "오늘 한우마을에 삼겹살 발주함" (사전 기록)
- OCR 입고: "배달 온 전표 찍어서 매입 확정" (사후 정산용)

---

## 구현 단계

### Step 1: 스키마 수정

`purchaseOrdersV2` 테이블에 컬럼 추가 (기존 테이블 재활용, 새 테이블 X):

```sql
ALTER TABLE purchase_orders_v2
  ADD COLUMN IF NOT EXISTS content TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS counterparty_name VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_received BOOLEAN DEFAULT FALSE;
```

- `content`: 발주 내용 자유텍스트 ("삼겹살 10kg, 목살 5kg")
- `counterpartyName`: 미등록 거래처 직접입력용
- `isReceived`: 입고 확인 여부 (기본 false)
- 기존 `receivedAt` 필드 재활용 (입고 확인 시각)
- 기존 `status` 필드: 새 발주메모는 `'memo'` 값 사용 (기존 `ordered`/`received`와 구분)

`drizzle/schema.ts` 수정:
- `purchaseOrdersV2`에 `content`, `counterpartyName`, `isReceived` 컬럼 추가
- `status` enum에 `'memo'` 추가

`server/index.ts` 자동 마이그레이션 섹션에 ALTER TABLE 추가.

**완료조건**: 빌드 성공 + 배포 후 테이블 컬럼 확인

### Step 2: tRPC API 추가

`server/routers/purchasesV2.ts`에 새 프로시저 4개 추가 (기존 API는 유지):

#### 2-1. `createMemo` (protectedProcedure)
```typescript
input: {
  restaurantId: number,
  counterpartyId?: number,       // 등록된 거래처 선택 시
  counterpartyName?: string,     // 미등록 거래처 직접입력 시
  content: string,               // 발주 내용 (필수)
  attachmentUrl?: string,        // 사진
  purchaseDate?: string,         // 기본값: 오늘(KST)
}
```
- `status = 'memo'`, `isReceived = false`
- `totalAmount = 0` (금액 불필요)
- `counterpartyId`와 `counterpartyName` 중 하나는 필수

#### 2-2. `listMemosByDate` (protectedProcedure)
```typescript
input: { restaurantId: number, date: string }
output: [{ id, counterpartyName, counterpartyId, content, attachmentUrl, isReceived, receivedAt, createdBy, createdAt }]
```
- `status = 'memo'`인 것만 조회
- 거래처명은 counterpartyId가 있으면 join, 없으면 counterpartyName 사용

#### 2-3. `toggleReceived` (protectedProcedure)
```typescript
input: { id: number, isReceived: boolean }
```
- `isReceived` 토글 + `receivedAt` = isReceived ? now : null

#### 2-4. `listUnreceived` (protectedProcedure)
```typescript
input: { restaurantId: number }
output: [{ id, counterpartyName, content, purchaseDate, createdAt }]
```
- `status = 'memo'` AND `isReceived = false` AND `purchaseDate < 오늘(KST)`
- 리마인더용: "어제 발주한 건 입고됐나요?"

**완료조건**: 4개 API 동작 확인 (빌드 성공)

### Step 3: DailyOpsPage 매입탭 UI 교체

현재 매입탭의 복잡한 발주입력 폼을 **발주 메모 리스트 + 간단 입력폼**으로 교체.

**기존 OCR 전표입력 흐름은 그대로 유지** — 매입탭 내에서 "전표입력"과 "발주메모"를 분리.

#### 매입탭 구조 (변경 후)

```
[매입탭]
  ┌─ 미입고 발주 리마인더 (있을 때만) ─────┐
  │ 📦 어제 한우마을에 발주한 건            │
  │ "삼겹살 10kg, 목살 5kg"               │
  │ 입고되었나요?  [네 ✓] [아직]            │
  └─────────────────────────────────────┘

  ┌─ 오늘의 발주 ──────────────────────────┐
  │                                        │
  │  🏪 한우마을                     [✓입고] │
  │  삼겹살 10kg, 목살 5kg           📎    │
  │                                        │
  │  🏪 농협유통                     [ 입고] │
  │  채소류 일괄                            │
  │                                        │
  │  [+ 발주 기록하기]                      │
  └─────────────────────────────────────────┘

  ┌─ 전표 매입 (기존 OCR 흐름) ─────────────┐
  │  (기존 OCR 입고 UI 그대로 유지)          │
  │  오늘 매입 확정 건: 3건 / 450,000원     │
  │  [+ 전표 입력하기]                      │
  └─────────────────────────────────────────┘
```

#### 발주 기록 입력폼 (인라인 펼침 or 바텀시트)

```
거래처: [드롭다운/검색] 또는 [직접입력]
내용:   [textarea - "삼겹살 10kg, 목살 5kg"]
사진:   [📷 첨부] (선택)
        [저장] [취소]
```

- 입력 시간 목표: 5~10초
- 거래처 선택 시 최근 거래처 상위 노출
- textarea는 1줄 기본, 내용에 따라 자동 확장
- 저장 후 리스트에 즉시 추가

#### 삭제할 UI 요소

- 발주/입고/즉시지출 모드 분기 (inputMode 상태)
- 간편/상세 모드 토글
- 품목별 라인아이템 테이블 (수량×단가×소계)
- 미입고 발주 배너 (→ 리마인더로 대체)
- 발주 상태전환 버튼 (→ 체크박스로 대체)

#### 유지할 UI 요소

- OCR 전표입력 전체 흐름 (사진촬영 → 분석 → 수정 → 저장)
- 기존 매입(status='received') 목록 표시
- 거래처 드롭다운/검색

**완료조건**: 발주 기록 5초 내 가능 + OCR 전표입력 기존대로 동작

### Step 4: 리마인더 컴포넌트

대시보드(ManagerDashboard, AdminDashboard)와 DailyOpsPage 매입탭 상단에 미입고 리마인더 표시.

```typescript
// UnreceivedOrdersReminder 컴포넌트
// listUnreceived API 호출 → 카드 리스트
// 각 카드: 거래처명 + 내용 + 발주일
// [네] → toggleReceived(true) → 카드 사라짐
// [아직] → 카드 유지 (다음에 다시 노출)
```

- DailyOpsPage 매입탭 상단에 배치
- 대시보드에도 간략 버전 (건수 + "확인하기" 링크)

**완료조건**: 미입고 건 대시보드/매입탭에 노출 + 확인 처리 동작

### Step 5: 기존 데이터 호환

- 기존 `purchaseOrdersV2` 데이터(status='ordered'/'received')는 그대로 유지
- `listMemosByDate`는 `status='memo'`만 조회 → 기존 데이터와 충돌 없음
- 기존 `listByDate` API도 유지 → OCR 매입 데이터 표시용
- PurchaseManagementPage의 월별매입/가격비교/단가추이는 기존 received 데이터 기반 → 영향 없음
- 발주현황 탭(pendingOrders) → 삭제 or "발주 메모 미입고" 목록으로 교체
- 중복관리 탭 → 유지 (received 기준)

**완료조건**: 기존 매입 데이터 조회 정상 동작

### Step 6: 검증

- [ ] 발주 메모 생성 → DB 저장 확인
- [ ] 발주 메모 리스트 조회 (날짜별)
- [ ] 입고 체크 토글 동작
- [ ] 미입고 리마인더 노출 (전날 발주 건)
- [ ] OCR 전표입력 기존대로 동작
- [ ] 기존 매입 데이터 월정산 연동 정상
- [ ] PurchaseManagementPage 가격비교/단가추이 정상

---

## 변경하지 않는 것

- OCR 엔드포인트 (`server/ocr.ts`) — 그대로
- 거래처 관리 (`counterparties` 라우터) — 그대로
- PurchaseManagementPage의 거래처/월별매입/품목관리/가격비교/단가추이 탭 — 그대로
- 월정산 매입 데이터 소스 (`monthlyClosings.settlementData`) — 기존 received 데이터 기반
- `purchaseOrderItemsV2` 테이블 — OCR 입고 시 사용, 발주 메모에서는 미사용

## 폐기 대상 (Step 3 완료 후)

- DailyOpsPage 내 `inputMode` 상태 ('order' | 'receive' | 'expense')
- 간편/상세 모드 토글 관련 코드
- 품목 라인아이템 입력 UI (발주용만. OCR 입고용은 유지)
- `purchasesV2.createOrder`에서 발주(status='ordered') 생성 경로 — memo로 대체
- `purchasesV2.receiveOrder` — memo의 toggleReceived로 대체 (기존 데이터용은 유지)
- PurchaseManagementPage 발주현황 탭 (pendingOrders)
