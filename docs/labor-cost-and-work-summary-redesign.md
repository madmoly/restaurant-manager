# 인건비 정산 · 근무 현황 UI 재설계

> 작성: 2026-05-01 (Cowork)
> 적용 대상: `client/src/pages/LaborCostPage.tsx`, `client/src/pages/WorkSummaryPage.tsx`, `server/routers/schedules.ts`

---

## 1. 결정 사항 (잠금)

| 항목 | 결정 |
|---|---|
| 두 페이지 관계 | 분리 유지, 각각 재설계 |
| 인건비 정산 방향 | 시간 컬럼 제거 + 비용 분해 강화 |
| 가이드라인 정의 | 등록 임금값 + 실효치 산출 후 비교(±%) |
| 환산 단위 | 시급·일급·월급 모두 표기(임금유형 무관) |
| 근무 현황 방향 | 일자×직원 매트릭스(데스크톱) + 직원 펼침 시 미니캘린더(모바일) |
| 우선 디바이스 | 모바일 1순위, 가로스크롤 금지 |

**5B↔6A 충돌 해결안**: 매트릭스는 데스크톱(`md` 이상)에서만 노출. 모바일은 직원 카드를 펼치면 그 안에 7일×주N 그리드(미니캘린더)가 세로로 흐름.

---

## 2. 인건비 정산 (LaborCostPage)

### 2.1 정보 구조

회사 카드(헤더) → 직원 카드(4라인) → 회사 합계 → 매장 총합

직원 카드 4라인:
- L1: 이름 · 직책 · 임금유형 배지(시급/월급/임시)
- L2: 가이드 — `시급 ₩X / 일급 ₩Y / 월급 ₩Z` (등록값 기준 환산)
- L3: 실효 — `시급 ₩X′(±%) / 일급 ₩Y′(±%) / 월급 ₩Z′(±%)`
- L4: 비용 분해 — 기본 / 주휴 / 연장 / 야간 / 공제 / 실지급(굵게)
  - `deductionMode = '3.3%'` (사업소득) → 공제 = `round(과세대상 × 0.033)`, 실지급 = 총임금 − 공제
  - `deductionMode = 'external'` (4대보험 가입) → 공제 라벨을 `공제 외부정산` 으로 표시, 실지급 라벨을 `잠정 합계`로 변경(굵게 유지). 4대보험·소득세는 노무사 정산값으로 별도 처리됨을 명시
  - 페이지 상단 또는 합계 카드에 1줄 안내: "4대보험 가입자의 공제는 노무사 정산 결과 기준 — 본 화면 미반영"

시간 관련(총시간·시프트수)은 모두 제거. 단, 출근일수는 실효일급 산출에 필요하므로 라우터에 보존.

### 2.2 환산 산식

```
시급제 등록 (wageAmount = H)
  guideHourly  = H
  guideDaily   = H × 8
  guideMonthly = H × 209

월급제 등록 (wageAmount = M)
  guideMonthly = M
  guideHourly  = M ÷ 209
  guideDaily   = guideHourly × 8

일급제(임시근로자만, wageAmount = D)
  guideDaily   = D
  guideHourly  = D ÷ 8
  guideMonthly = guideHourly × 209
```

`209h`는 통상임금 표준값(주40h 기준). 매장별 옵션화는 후속 과제.

### 2.3 실효치 산식

```
effectiveHourly  = totalWage / totalHours      (totalHours = 0이면 null)
effectiveDaily   = totalWage / workedDays      (workedDays = 0이면 null)
effectiveMonthly = totalWage
diffPct(eff, guide) = (eff - guide) / guide × 100   (소수 1자리, guide=0이면 null)
```

`workedDays`: 해당 직원의 confirmed/completed 시프트가 존재하는 고유 날짜 수. 같은 날 2시프트도 1일로 카운트.

### 2.4 라우터 확장 — `schedules.laborCostByCompany`

`employees[i]`에 다음 필드 추가:

```ts
workedDays: number;
guideHourly: number | null;
guideDaily: number | null;
guideMonthly: number | null;
effectiveHourly: number | null;
effectiveDaily: number | null;
effectiveMonthly: number | null;
wageBreakdown: {
  base: number;          // 기본 임금
  weeklyHoliday: number; // 주휴수당
  overtime: number;      // 연장
  night: number;         // 야간
  deduction: number;     // 공제 (음수 아님, 양수 표기). 'external' 모드에서는 0
  net: number;           // 실지급 = base+weeklyHoliday+overtime+night - deduction
};
deductionMode: '3.3%' | 'external';
// '3.3%'   : socialInsurance=false → 시스템 산출 (round(과세대상 × 0.033))
// 'external': socialInsurance=true  → 노무사 외부 정산. deduction=0, UI 라벨 분기
```

기존 `laborCostByCompany`가 분해 단계로 계산하는지 확인 필요. 분해 출력이 없으면 base=totalWage, 나머지=0으로 폴백 후 점진 도입.

---

## 3. 근무 현황 (WorkSummaryPage)

### 3.1 정보 구조

회사 카드(헤더: 인원수·총시간) → 직원 영역.

**모바일(<md)**: 직원 행 클릭 시 펼쳐서 미니캘린더
- 7열 × N행 그리드(요일 헤더: 일·월·화·수·목·금·토)
- 셀: 근무 있는 날 → 시간(h, 소수1) / 빈 날 → 회색 dot
- 매장 휴무일(정기/특정): 셀 배경 음영

**데스크톱(≥md)**: 직원 영역을 매트릭스 표로 대체
- 가로축: 1~말일 (휴무일 셀 음영)
- 세로축: 직원 이름
- 셀: 시간(h, 소수1), hover 시 `시작–종료` 툴팁
- 직원 행 마지막에 합계 컬럼

총시간 합계, 잔여 대체휴무·연차 등 기존 메타정보는 직원 행 우측에 칩으로 유지.

### 3.2 라우터 확장 — `schedules.workSummaryByEmployee`

`employees[i]`에 다음 필드 추가:

```ts
daily: { date: string; hours: number; shifts: number }[];
//   date = 'YYYY-MM-DD' (KST)
//   hours = 해당일 net 근무시간 합계
//   shifts = 해당일 시프트 수
```

응답 루트에 매장 휴무일 정보도 동봉:

```ts
closedDates: string[];   // 'YYYY-MM-DD'
closedWeekdays: number[]; // 0=일 ... 6=토
operatingDays: number;
```

---

## 4. 구현 단계

| # | 단계 | 완료 조건 |
|---|---|---|
| 1 | `schedules.laborCostByCompany` 라우터 확장 — workedDays·guide·effective·wageBreakdown 필드 추가 | tRPC 응답에 신규 필드 노출, 빌드 통과 |
| 2 | `schedules.workSummaryByEmployee` 라우터 확장 — daily 배열·closedDates 추가 | 위와 동일 |
| 3 | LaborCostPage 재구성 — 4라인 직원 카드 | 모바일에서 가로스크롤 0, 시간 컬럼 0 |
| 4 | WorkSummaryPage 재구성 — 모바일 미니캘린더 / 데스크톱 매트릭스 | `md` 분기 정상, 휴무일 음영 |
| 5 | `pnpm run build` | 통과 |
| 6 | 5항 요약 후 push | 사용자 승인 |

---

## 5. 미정 · 리스크

- **비용 분해의 정확도**: 현재 `laborCostByCompany`가 base/weeklyHoliday/overtime/night을 분리 계산하는지 확인 안 됨 (Code에서 `server/routers/schedules.ts` L869~L1359 정독 후 결정). 분해 미지원이면 1차 릴리스는 base=총임금 폴백, 분해는 후속 PR.
- **4대보험 공제는 시스템 산출 대상 아님**: 운영상 점장이 근무 자료를 노무사에게 송부 → 노무사 정산값으로 실제 송금. 시스템은 노무사 회신과 대조용 참고치 역할. 따라서 socialInsurance=true 직원의 공제는 0(외부정산)으로 두고 UI에서 명시. 시스템상 자동 계산 시도 금지.
- **DB 임금유형**: `wageType` enum이 `hourly | monthly`만 존재. 정직원 일급제는 표기 불가 → 일급은 임시근로자 한정. 정직원은 시급/월급 → 일급 환산값으로만 노출.
- **209시간 가정**: 매장별 통상시간 다를 경우 가이드 시급/일급 오차 발생. 후속 매장 설정값 도입.
- **모바일 매트릭스 회피**: 데스크톱 매트릭스를 모바일에서 보고 싶다는 요청이 추후 들어오면 가로 스크롤 허용 토글 옵션을 추가.
- **출근일수 vs 시프트수**: 같은 날 2시프트 시 출근일수 1로 카운트. 실효일급은 출근일 기준이라 의도와 일치.

---

## 6. Code 핸드오프 체크리스트

- [ ] 본 문서를 기준으로 라우터 → 페이지 순서 작업
- [ ] 라우터 변경 시 응답 타입(zod 스키마 또는 tRPC 추론) 확인
- [ ] 페이지 모바일 레이아웃 우선 작성 후 `md:` 분기 추가
- [ ] 직원이 없는 회사 카드 처리, 0건 회사 처리
- [ ] 임시근로자 정렬(회사 하단) 유지
- [ ] PDF/엑셀 내보내기 영향 확인 (인건비 정산만 해당, 시간 컬럼 제거 시 export 행 정의도 동기화)
- [ ] 빌드 통과 후 5항 요약 → push 승인
