# 매출 전표 OCR 자동입력 — 구현 명세

> 작성: 2026-04-05 (Cowork 설계 → Claude Code 전달용)

## 개요

POS 마감 전표 사진을 찍으면 매출 항목을 자동 추출하여 `daily_sales_detail`에 저장하는 기능.
기존 매입 OCR (`/api/ocr/extract-purchase`) 인프라를 재사용한다.

## 데이터 흐름

```
[사진 촬영/업로드]
    ↓
[클라이언트] imageResize (기존 OCR_HIGH: 2560px/0.92)
    ↓
[서버] POST /api/ocr/extract-sales (신규)
    ├─ preprocessImage() 재사용
    ├─ Claude Vision API (claude-haiku-4-5-20251001)
    ├─ 결과 검증 (항목 합계 ≈ totalAmount)
    └─ 응답: 구조화된 매출 데이터
    ↓
[클라이언트] 추출 결과 편집 UI → 사용자 확인/수정
    ↓
[서버] sales.upsertDetail (tRPC) → daily_sales_detail + sales_other_items 저장
```

## Step 1: 스키마 변경

### daily_sales_detail 컬럼 추가

```sql
ALTER TABLE daily_sales_detail
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS ocrRawData JSON DEFAULT NULL;
```

- `source`: "manual" | "ocr" — 입력 출처 구분
- `ocrRawData`: OCR 원본 추출 결과 전체 보존 (디버깅, 학습용)

### drizzle/schema.ts 반영

```typescript
// dailySalesDetail에 추가
source: varchar("source", { length: 20 }).default("manual").notNull(),
ocrRawData: json("ocrRawData").$type<SalesOcrRawData | null>(),
```

### server/index.ts 자동 마이그레이션에 추가

```typescript
await conn.query(`
  ALTER TABLE daily_sales_detail
    ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS ocrRawData JSON DEFAULT NULL
`).catch(() => {});
```

## Step 2: 서버 OCR 엔드포인트

### 파일: server/ocr.ts

### 엔드포인트: POST /api/ocr/extract-sales

### 요청

```typescript
// multipart/form-data
{
  image: File,           // 전표 이미지
  restaurantId: string,  // 매장 ID
  rotation?: string      // 수동 회전 (0/90/180/270)
}
```

### OCR 프롬프트 설계 (핵심)

```
당신은 한국 요식업 POS 마감 전표를 분석하는 전문가입니다.

이미지에서 다음을 추출하세요:

1. **전표 기본 정보**
   - posVendor: POS 제조사명 (HYUNDAI, OKPOS, POSBANK, KIOSK 등)
   - saleDate: 거래 날짜 (YYYY-MM-DD)
   - receiptNo: 전표 번호

2. **매출 항목 전체** (items 배열)
   모든 행을 빠짐없이 추출합니다. 각 행:
   - label: 항목명 (전표에 표기된 그대로)
   - count: 건수 (없으면 0)
   - amount: 금액 (숫자만, 콤마 제거)
   - type: 항목 성격 분류
     - "cash": 현금매출
     - "card": 카드매출 (신용카드, 체크카드 포함)
     - "giftcard": 상품권 (자사/타사)
     - "transfer": 계좌이체
     - "point": 포인트 결제 (H.Point, OK캐쉬백 등)
     - "delivery": 배달앱매출
     - "discount": 할인
     - "subtotal": 소계/합계 행 (저장 대상 아님)
     - "other": 위에 해당 없음

3. **총매출 (totalAmount)**
   전표에서 최종 총매출/총합계 금액

주의사항:
- 이미지가 회전되어 있을 수 있습니다. 텍스트 방향을 자동 감지하세요.
- 소계/합계 행은 type="subtotal"로 분류하고, 실제 결제수단 항목과 구분하세요.
- 금액이 0인 행도 포함하세요 (전표 구조 파악용).
- 같은 카테고리의 세부 항목이 여러 개일 수 있습니다 (예: 신용카드, 체크카드 → 둘 다 type="card").

응답 형식 (JSON만, 다른 텍스트 없이):
{
  "posVendor": "HYUNDAI",
  "saleDate": "2026-04-04",
  "receiptNo": "1237",
  "items": [
    { "label": "현금매출", "count": 1, "amount": 26000, "type": "cash" },
    { "label": "카드매출", "count": 7, "amount": 96000, "type": "card" },
    ...
  ],
  "totalAmount": 1413800,
  "confidence": "high"
}
```

### 서버 검증 로직

```typescript
function validateSalesOcrResult(result: SalesOcrResult): SalesOcrResult {
  // 1. type이 subtotal이 아닌 항목들의 합계 계산
  const paymentItems = result.items.filter(i => i.type !== "subtotal" && i.type !== "discount");
  const itemsSum = paymentItems.reduce((sum, i) => sum + i.amount, 0);

  // 2. totalAmount와 비교 (±5% 허용 — POS마다 합산 기준이 다를 수 있음)
  const diff = Math.abs(itemsSum - result.totalAmount);
  const tolerance = result.totalAmount * 0.05;
  if (diff > tolerance) {
    result.confidence = "low";
    // 경고 플래그 추가
  }

  // 3. 음수 금액 체크
  result.items.forEach(item => {
    if (item.amount < 0 && item.type !== "discount") {
      item.confidence = "low";
    }
  });

  return result;
}
```

### 응답 타입

```typescript
interface SalesOcrResponse {
  posVendor: string;
  saleDate: string;        // YYYY-MM-DD
  receiptNo: string;
  items: SalesOcrItem[];
  totalAmount: number;
  confidence: "high" | "medium" | "low";
  // 표준 필드 매핑 (클라이언트 편의용)
  mapped: {
    cashAmount: number;      // type="cash" 합산
    cardAmount: number;      // type="card" 합산
    giftCardAmount: number;  // type="giftcard" 합산
    transferAmount: number;  // type="transfer" 합산
    discountAmount: number;  // type="discount" 합산
    otherAmount: number;     // type="point"+"delivery"+"other" 합산
    totalAmount: number;
  };
}

interface SalesOcrItem {
  label: string;
  count: number;
  amount: number;
  type: "cash" | "card" | "giftcard" | "transfer" | "point" | "delivery" | "discount" | "subtotal" | "other";
  confidence?: "high" | "medium" | "low";
}
```

### API 사용량 로깅

기존 `api_usage_logs` 테이블에 기록:
- endpoint: "extract-sales"
- model: "claude-haiku-4-5-20251001"
- 기타 기존 매입 OCR과 동일한 포맷

### 모델 선택: claude-haiku-4-5-20251001

매출 전표는 매입 전표 대비:
- 품목 라인 수가 적음 (20~30행 vs 매입 50~100행)
- 구조가 정형화됨 (표 형태, 컬럼 고정)
- 복잡한 품명 해석 불필요

→ Haiku로 충분. 비용 약 1/10 ($0.004/회 vs $0.042/회).
→ 정확도 부족 시 Sonnet으로 업그레이드 가능 (설정 변수화).

## Step 3: tRPC 프로시저

### 파일: server/routers/sales.ts

### sales.upsertDetail (mutation, managerProcedure)

```typescript
input: z.object({
  restaurantId: z.number(),
  saleDate: z.string(),  // YYYY-MM-DD
  cashAmount: z.string().default("0"),
  cardAmount: z.string().default("0"),
  giftCardAmount: z.string().default("0"),
  transferAmount: z.string().default("0"),
  transferDepositor: z.string().optional(),
  receiptCount: z.number().default(0),
  discountAmount: z.string().default("0"),
  otherAmount: z.string().default("0"),
  totalAmount: z.string(),
  source: z.enum(["manual", "ocr"]).default("manual"),
  ocrRawData: z.any().optional(),  // OCR 원본 JSON
  note: z.string().optional(),
  // 기타 항목 (sales_other_items)
  otherItems: z.array(z.object({
    itemName: z.string(),
    amount: z.string(),
  })).optional(),
})
```

**로직:**
1. `daily_sales_detail`에서 해당 restaurantId + saleDate 조회
2. 있으면 UPDATE, 없으면 INSERT
3. `otherItems`가 있으면:
   - 기존 `sales_other_items` 삭제 (해당 dailySalesDetailId)
   - 새 항목 INSERT
4. recordedBy = ctx.user.userId
5. status = "draft"

### sales.getDetail (query, protectedProcedure)

```typescript
input: z.object({
  restaurantId: z.number(),
  saleDate: z.string(),
})
```

**반환:** daily_sales_detail 레코드 + 연관 sales_other_items 배열. 없으면 null.

## Step 4: 클라이언트 UI

### 파일: client/src/pages/SalesPage.tsx

### UI 변경 사항

1. **"전표 촬영" 버튼 추가** — 기존 "매출 입력" 버튼 옆
   - 카메라 아이콘 + "전표 촬영" 텍스트
   - 클릭 → `<input type="file" accept="image/*" capture="environment">`
   - 모바일: 카메라 직접 실행, 데스크톱: 파일 선택

2. **OCR 처리 중 상태** — 로딩 오버레이 + "전표 분석 중..." 메시지

3. **OCR 결과 편집 모달** — 핵심 UI

```
┌─────────────────────────────────────┐
│ 📷 매출 전표 인식 결과              │
│ POS: HYUNDAI  |  전표 #1237         │
│                                     │
│ 날짜: [2026-04-05]  ← 수정가능     │
│ ─────────────────────────────────── │
│                                     │
│ 📋 추출된 항목:                     │
│ ┌───────────────┬────┬──────────┐  │
│ │ 항목명        │건수│ 금액     │  │
│ ├───────────────┼────┼──────────┤  │
│ │ 🟢 현금매출   │  1 │ 26,000   │  │
│ │ 🟢 카드매출   │  7 │ 96,000   │  │
│ │ 🟡 자사상품권 │  1 │ 5,900    │  │
│ │ 🟢 H.Point    │  3 │ 23,800   │  │
│ │ ...           │    │          │  │
│ └───────────────┴────┴──────────┘  │
│                                     │
│ 🟢 높음  🟡 확인필요  🔴 오류      │
│                                     │
│ ─────────────────────────────────── │
│ 표준 분류 매핑:                     │
│ 현금:     26,000원                  │
│ 카드:     96,000원                  │
│ 상품권:   5,900원                   │
│ 이체:     0원                       │
│ 할인:     5,900원                   │
│ 기타:     ___원 (포인트+배달 등)    │
│ ─────────────────────────────────── │
│ 총매출:   1,413,800원               │
│                                     │
│ [취소]                    [저장]    │
└─────────────────────────────────────┘
```

**모달 동작:**
- 상단: OCR이 추출한 원본 항목 테이블 (읽기 전용 or 수정 가능)
- 하단: 표준 카테고리 매핑 결과 (수정 가능 — 최종 저장 대상)
- 금액 수정 시 합계 자동 재계산
- confidence가 low인 항목은 🟡 표시
- 저장 시:
  1. 해당 날짜에 기존 데이터 있으면 "이미 입력된 매출이 있습니다. 덮어쓰시겠습니까?" 확인
  2. `sales.upsertDetail` 호출
  3. 성공 후 모달 닫기 + 목록 갱신

## Step 5: 기존 연동 확인

### dailyClosings.calculateDay 와의 연동

현재 `calculateDay`는 `daily_sales_detail.totalAmount`을 우선 참조 → **OCR로 저장하면 자동 반영됨. 추가 작업 불필요.**

### 월정산 (MonthlySettlementPage) 연동

`monthlyClosings.settlementData`에서 daily_sales_detail을 조회하므로 **자동 반영.**

## 구현 순서 (단계별)

1. **스키마 + 마이그레이션** — `source`, `ocrRawData` 컬럼 추가
   - 완료 조건: 빌드 성공 + 배포 후 ALTER 실행 확인

2. **서버 OCR 엔드포인트** — `POST /api/ocr/extract-sales`
   - 완료 조건: curl로 이미지 전송 → JSON 응답 정상 반환

3. **tRPC 프로시저** — `sales.upsertDetail`, `sales.getDetail`
   - 완료 조건: 프로시저 호출로 daily_sales_detail upsert 성공

4. **클라이언트 UI** — SalesPage에 OCR 업로드 + 결과 편집 모달
   - 완료 조건: 사진 → 자동추출 → 수정 → 저장 end-to-end 동작

5. **검증** — 실제 전표 사진으로 테스트
   - 완료 조건: 저장 데이터가 일마감 계산에 정상 반영

## 비용 추정

- Haiku 모델: ~$0.004/회
- 매장 1곳 × 하루 1회 = 월 $0.12
- 매장 10곳 = 월 $1.2
- Railway API 호출 비용 영향 거의 없음

## 향후 확장 (이번 스코프 밖)

- POS 벤더별 프로파일 학습 (매입 OCR의 counterparty_ocr_profiles와 유사)
- 배달앱 정산서 OCR (별도 documentType)
- 매출 전표 사진 저장/이력 조회
- OCR 수정 이력 축적 → 프롬프트 개선 피드백
