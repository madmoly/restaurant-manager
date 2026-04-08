# 수정 지시: 일간보고 — 보고용 텍스트 클립보드 복사 버튼

> 작성: 2026-04-05 (Cowork) — 확정

## 기능 요약

마감 탭(CloseTab)에 **"보고 복사"** 버튼을 추가.
클릭 시 아래 형식의 텍스트를 클립보드에 복사하여 카카오톡 등에 바로 붙여넣기 가능하도록 함.

## 결정사항

1. **누적매출** = 해당 월 1일~마감 당일까지 `dailySalesDetail.totalAmount` 합산
2. **시재** = 매장별 고정값 (restaurants 테이블에 새 컬럼 추가)
3. **반차 근무자 표시** = 근무시간만 표시 (예: `남영선 6시간`)

## 보고 텍스트 형식 (확정)

```
2026년 4월 3일 금요일
청계산뚝배기수제비천호점 매출보고
* 누적매출 : 4,137,000원
* 객수 or 영수건수 : 86건
* 매출건 특이사항
 -현금매출 : 31,600원
 -카드매출 : 1,230,800원
 -상품권 매출 : 10,000원
 -이체매출 : 0원
 -{기타항목명} : {금액}원
 >일 합산 매출 : 1,311,200원
* 시재
 -오픈시재금 : 200,000원
 -마감시재금 : 200,000원
* 할인 내역
 -{할인항목명} : {금액}원
>일 합산 할인 : 0원
>오버/쇼트 : 0
* 오늘 근무자
천인자 사원
김정란 사원
남영선 6시간
*내일 근무자
김지웅 점장
천인자 사원
김정란 사원
남영선 6시간
===========
```

## 데이터 소스 매핑 (확정)

| 보고 항목 | 데이터 소스 | 비고 |
|-----------|-------------|------|
| 날짜/요일 | `date` 파라미터 | 한국어 요일 변환 |
| 매장명 | `restaurant.name` | |
| **누적매출** | **새 API 필요**: 해당월 1일~당일까지 `dailySalesDetail.totalAmount` SUM | |
| 영수건수 | `dailySalesDetail.receiptCount` | |
| 현금매출 | `dailySalesDetail.cashAmount` | |
| 카드매출 | `dailySalesDetail.cardAmount` | |
| 상품권 매출 | `dailySalesDetail.giftCardAmount` | |
| 이체매출 | `dailySalesDetail.transferAmount` | |
| 기타 매출 항목 | `salesOtherItems` (getDailySales → otherItems) | 항목명별 줄 생성 |
| 일 합산 매출 | `dailySalesDetail.totalAmount` | |
| **시재** | **`restaurants.fixedCashRegister`** (새 컬럼, 기본 200000) | 오픈/마감 동일 |
| 할인 내역 | `dailySalesSpecialItems` (getDailySales → specialItems) | 항목명별 줄 생성 |
| 오버/쇼트 | (시재 - 현금매출) 차이? 아니면 0 고정 | 일단 0 고정 |
| 오늘 근무자 | `schedules.getDaySchedules(date)` | |
| 내일 근무자 | `schedules.getDaySchedules(date+1)` | 추가 쿼리 필요 |

## 구현 지시

### 1. DB 변경 (restaurants 테이블)

**`drizzle/schema.ts`**: restaurants에 컬럼 추가
```typescript
fixedCashRegister: int("fixedCashRegister").default(200000).notNull(),
```

**`server/index.ts`**: 자동 마이그레이션 추가
```sql
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS fixedCashRegister INT NOT NULL DEFAULT 200000
```

### 2. 서버: 누적매출 API

**`server/routers/dailyOps.ts`** (또는 `sales.ts`)에 프로시저 추가:

```typescript
getCumulativeSales: protectedProcedure
  .input(z.object({ restaurantId: z.number(), date: z.string() }))
  .query(async ({ input }) => {
    // date에서 월 시작일 계산
    const monthStart = input.date.slice(0, 7) + '-01'; // "2026-04-01"
    const [result] = await db
      .select({ total: sql<string>`COALESCE(SUM(${dailySalesDetail.totalAmount}), 0)` })
      .from(dailySalesDetail)
      .where(and(
        eq(dailySalesDetail.restaurantId, input.restaurantId),
        sql`${dailySalesDetail.saleDate} >= ${monthStart}`,
        sql`${dailySalesDetail.saleDate} <= ${input.date}`
      ));
    return { total: Number(result?.total ?? 0) };
  }),
```

### 3. 프론트엔드: `CloseTab` 내 보고 복사 버튼

**`client/src/pages/DailyOpsPage.tsx`** — `CloseTab` 컴포넌트 내 수정

#### 3-1. 추가 쿼리

```typescript
// 누적매출
const cumulativeSalesQuery = trpc.dailyOps.getCumulativeSales.useQuery(
  { restaurantId, date },
  { enabled: restaurantId > 0 }
);

// 내일 스케줄
const tomorrowDate = (() => {
  const d = new Date(date + 'T00:00:00+09:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
})();
const tomorrowSchedulesQuery = trpc.schedules.getDaySchedules.useQuery(
  { restaurantId, date: tomorrowDate },
  { enabled: restaurantId > 0 }
);

// 매장 정보 (fixedCashRegister, openTime, closeTime, halfShiftThreshold)
// → 이미 상위에서 selectedRestaurant으로 접근 가능하면 props로 전달
```

#### 3-2. 보고 텍스트 생성 함수

```typescript
function generateReportText({
  date,
  restaurantName,
  cumulativeSales,
  salesDetail,          // getDailySales 결과
  otherItems,           // salesDetail.otherItems
  specialItems,         // salesDetail.specialItems
  fixedCashRegister,    // 매장 고정 시재
  todaySchedules,
  tomorrowSchedules,
  openTime, closeTime, halfShiftThreshold,
}: {
  date: string;
  restaurantName: string;
  cumulativeSales: number;
  salesDetail: any;
  otherItems: any[];
  specialItems: any[];
  fixedCashRegister: number;
  todaySchedules: any[];
  tomorrowSchedules: any[];
  openTime: string;
  closeTime: string;
  halfShiftThreshold: number;
}): string {
  const d = new Date(date + 'T00:00:00+09:00');
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const dateStr = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${weekdays[d.getDay()]}요일`;
  const fmt = (v: any) => Number(v || 0).toLocaleString();

  const lines: string[] = [
    dateStr,
    `${restaurantName} 매출보고`,
    `* 누적매출 : ${fmt(cumulativeSales)}원`,
    `* 객수 or 영수건수 : ${salesDetail?.receiptCount ?? 0}건`,
    `* 매출건 특이사항`,
    ` -현금매출 : ${fmt(salesDetail?.cashAmount)}원`,
    ` -카드매출 : ${fmt(salesDetail?.cardAmount)}원`,
    ` -상품권 매출 : ${fmt(salesDetail?.giftCardAmount)}원`,
    ` -이체매출 : ${fmt(salesDetail?.transferAmount)}원`,
  ];

  // 기타 매출 항목 (otherItems)
  for (const item of (otherItems ?? [])) {
    lines.push(` -${item.itemName} : ${fmt(item.amount)}원`);
  }

  lines.push(` >일 합산 매출 : ${fmt(salesDetail?.totalAmount)}원`);

  // 시재 (고정)
  lines.push(`* 시재`);
  lines.push(` -오픈시재금 : ${fmt(fixedCashRegister)}원`);
  lines.push(` -마감시재금 : ${fmt(fixedCashRegister)}원`);

  // 할인 내역 (specialItems)
  lines.push(`* 할인 내역`);
  const discountTotal = (specialItems ?? []).reduce((s: number, i: any) => s + Number(i.amount || 0), 0);
  for (const item of (specialItems ?? [])) {
    lines.push(` -${item.typeName} : ${fmt(item.amount)}원`);
  }
  lines.push(`>일 합산 할인 : ${fmt(discountTotal)}원`);
  lines.push(`>오버/쇼트 : 0`);

  // 오늘 근무자
  lines.push(`* 오늘 근무자`);
  for (const s of todaySchedules) {
    lines.push(formatWorkerLine(s, openTime, closeTime, halfShiftThreshold));
  }

  // 내일 근무자
  lines.push(`*내일 근무자`);
  for (const s of tomorrowSchedules) {
    lines.push(formatWorkerLine(s, openTime, closeTime, halfShiftThreshold));
  }

  lines.push(`===========`);
  return lines.join('\n');
}

function formatWorkerLine(
  s: any,
  openTime: string,
  closeTime: string,
  halfShiftThreshold: number
): string {
  const name = s.userName ?? s.tempWorkerName ?? '미배정';

  // 근무시간 계산 (시간 단위)
  const workMs = new Date(s.endTime).getTime() - new Date(s.startTime).getTime();
  const workHours = Math.round(workMs / 3600000);

  // 반차 판별
  const [oh, om] = (openTime || '09:00').split(':').map(Number);
  const [ch, cm] = (closeTime || '22:00').split(':').map(Number);
  const totalMinutes = (ch * 60 + cm) - (oh * 60 + om);
  const workMinutes = workMs / 60000;
  const isHalf = totalMinutes > 0 && (workMinutes / totalMinutes) * 100 < halfShiftThreshold;

  // 반차면 근무시간만 표시, 그 외엔 역할 라벨
  if (isHalf) {
    return `${name} ${workHours}시간`;
  }

  // 역할 라벨 (점장/매니져/사원)
  // getDaySchedules 응답에 role 정보가 없으므로 추가 필요 — 아래 참조
  return `${name} 사원`; // 기본값, role 정보 추가 후 수정
}
```

### 4. getDaySchedules 응답에 역할 정보 추가

현재 `getDaySchedules`는 `users.name`만 조인함. 보고 텍스트에서 `점장/사원` 등 역할을 표시하려면:

**`server/routers/schedules.ts`** — `getDaySchedules` 쿼리 수정:

```typescript
// 기존: .leftJoin(users, eq(schedules.userId, users.id))
// 변경: restaurantUsers도 조인하여 매장 역할 가져오기

.leftJoin(users, eq(schedules.userId, users.id))
.leftJoin(
  restaurantUsers,
  and(
    eq(schedules.userId, restaurantUsers.userId),
    eq(schedules.restaurantId, restaurantUsers.restaurantId)
  )
)

// select에 추가:
storeRole: restaurantUsers.role,  // owner/supervisor/staff
systemRole: users.role,            // master/admin/user
```

프론트에서 역할 라벨 매핑:
```typescript
function getRoleLabel(s: any): string {
  const sr = s.systemRole;
  const rr = s.storeRole;
  if (sr === 'master') return '개발자';
  if (sr === 'admin') return '대표';
  if (rr === 'owner' || rr === 'store_manager') return '점장';
  if (rr === 'supervisor' || rr === 'manager') return '매니져';
  return '사원';
}
```

### 5. 버튼 UI

마감 탭(`CloseTab`) 하단, 마감 확정 버튼 근처에 배치:

```tsx
<button
  onClick={async () => {
    const text = generateReportText({ ... });
    await navigator.clipboard.writeText(text);
    toast.success('보고 텍스트가 복사되었습니다');
  }}
  className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors"
>
  <Copy className="w-4 h-4" />
  보고 복사
</button>
```

- 마감 여부와 무관하게 항상 표시 (매출 데이터가 있으면 복사 가능)
- 아이콘: lucide-react의 `Copy`

### 6. 업무정보 페이지에 시재 설정 UI (선택)

`StoreInfoPage` > 매장 기본정보 섹션에 "시재 고정금액" 입력 필드 추가.
기본값 200,000원. 매장별로 다른 값 설정 가능.

---

## 변경 범위 요약

| 변경 | 파일 | 내용 |
|------|------|------|
| DB 스키마 | `drizzle/schema.ts` | restaurants에 `fixedCashRegister` 추가 |
| 마이그레이션 | `server/index.ts` | ALTER TABLE |
| 서버 API | `server/routers/dailyOps.ts` | `getCumulativeSales` 프로시저 추가 |
| 서버 API | `server/routers/schedules.ts` | `getDaySchedules` 응답에 역할 추가 |
| 프론트엔드 | `client/src/pages/DailyOpsPage.tsx` | CloseTab에 보고 복사 버튼 + generateReportText |

## 완료 조건

- [ ] 마감 탭에 "보고 복사" 버튼 표시
- [ ] 클릭 시 확정 형식의 텍스트가 클립보드에 복사됨
- [ ] 누적매출 = 해당월 1일~당일까지 dailySalesDetail 합산
- [ ] 시재 = 매장 고정값 (기본 200,000원)
- [ ] 반차 근무자는 `이름 N시간` 형태 (역할 생략)
- [ ] 풀타임 근무자는 `이름 역할` 형태 (점장/사원 등)
- [ ] 내일 근무자 포함
- [ ] toast로 복사 완료 알림
- [ ] 빌드 성공 확인
