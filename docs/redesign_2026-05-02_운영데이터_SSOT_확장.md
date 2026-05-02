# 운영 데이터 SSOT 확장 — 계약서·정산 분리 사양서

> 작성: 2026-05-02 (Cowork)
> 상태: 결정 §10 모두 확정
> 트리거: 사용자 요청 — 직원 정보 수정이 가능해야 함. 매번 서명받지 않아도 운영값(임금·근무시간·계약기간 등) 변경 가능. 계약서는 시점 박제만, 정산 반영은 운영 SSOT 기준.
> 선행 사양: `docs/redesign_2026-05-02_계약_직원_인건비.md` (Phase A~D 완료, 커밋 0d7ba9d ~ 4adc056)
> 적용 범위: drizzle/schema.ts, server/routers/staff.ts, server/routers/electronicContracts.ts, server/routers/schedules.ts, server/index.ts, client/src/pages/StaffPage.tsx

---

## 1. 핵심 판단

**계약서 = 법적 박제, 운영 데이터 = SSOT (직원정보)**. 두 흐름을 명시적으로 분리.

- **계약서 작성·서명** = 법적 의무 충족용. 서명 시점의 운영 데이터를 `snapshot*`으로 박제. 박제는 불변.
- **운영 데이터 변경** = 직원 카드에서 즉시 가능. 계약서 서명 없이도 임금·근무시간·계약기간 등 모든 운영값 수정 가능.
- **인건비 정산** = 운영 SSOT 기준. wage_history는 임금만 시점 분기로 유지.
- **갱신 알림** = 운영 SSOT가 가장 최근 박제와 어긋나면 배너 표시. **차단 없음.**

운영 흐름:
1. 신규 직원 추가 → 직원 카드에서 운영 데이터 입력 (계약서 작성 안 해도 정산 가능)
2. 임금 변경 → 직원 카드에서 시급/월급 변경 + `effectiveFrom` 입력 → wage_history 새 row
3. 비임금 항목 변경 (근무시간·계약기간 등) → 직원 카드에서 즉시 덮어쓰기
4. 계약서 작성 → 별도 행위. 현재 운영 데이터를 폼 기본값으로 채움. 서명 후 박제 생성.
5. 갱신 배너 → 운영 SSOT vs 가장 최근 박제 비교. 어긋난 항목명 나열.

---

## 2. 결함 진단 (선행 Phase A~D 적용 후 잔존)

### 2.1 운영 데이터의 SSOT 부재
선행 Phase A~D에서 SSOT로 확정된 항목은 비임금 4개뿐:
- `restaurant_users.role`, `affiliatedCompany`, `hireDate`, `weeklyOffDays`
임금은 wage_history (시점 분기) 유지. 그 외 12개 운영 항목은 **계약서가 사실상 SSOT**:
- position, contractType, contractStart, contractEnd
- workStartTime, workEndTime, breakMinutes, weeklyHoliday, weeklyHours
- taxMode, hourlyWageIncludesHolidayPay
- mealProvided, mealAllowance, nightShiftConsent, specialTerms

→ 변경하려면 새 계약서 작성·서명 필요. 운영 부담 큼. 테스트 단계에서는 더 큼.

### 2.2 직원 카드 수정 UI 부재
- 임금 직접 수정 UI 없음 (계약서 모달에서만 입력)
- 근무시간·계약기간·직위 등 모두 계약서 모달에서만 입력
- 즉, 운영 부담 = 계약서 작성·서명 흐름 강제

### 2.3 employee_contracts와 wage_history 의미 중복
- `employee_contracts`: isActive 기반 단일 row 패턴. wageType/wageAmount 보유.
- `employee_wage_history`: effectiveFrom/effectiveTo 기반 시점 분기. wageType/wageAmount 보유.
- 두 테이블 모두 임금 정보 보관. 의미 중복.
- 인건비 정산은 wage_history만 사용 (선행 Phase A 결과). employee_contracts는 deprecated 상태.

---

## 3. 재설계 원칙

### 3.1 운영 SSOT = restaurant_users 통합

`restaurant_users`에 운영 데이터 12 컬럼 추가:
```ts
position: varchar(50)                      // 직위
contractType: mysqlEnum(["permanent","fixed_term","part_time","daily"])
contractStart: date                        // 계약 시작
contractEnd: date                          // 계약 종료 (null = 무기한)
workStartTime: varchar(5) default "09:00"
workEndTime: varchar(5) default "18:00"
breakMinutes: int default 60
weeklyHoliday: varchar(20) default "일요일"
weeklyHours: decimal(5,2) default 40
taxMode: mysqlEnum(["social_insurance","biz_income_3_3"]) default "social_insurance"
hourlyWageIncludesHolidayPay: boolean default true notNull
mealProvided: boolean default false notNull
mealAllowance: decimal(10,2) default 0
nightShiftConsent: boolean default false notNull
specialTerms: text
```

기존 컬럼은 그대로:
- role, affiliatedCompany, hireDate, weeklyOffDays
- 매장-직원 관계 메타: rehiredAt, resignedAt, roleChangedAt/By, contractMigrated

총 추가: **15 컬럼** (위 12 + 기존 §2 결정에서 추가된 것 외).
※ 정확히는 12 — `taxMode`, `hourlyWageIncludesHolidayPay`도 포함.

### 3.2 임금 SSOT = wage_history (현행 유지)

- 변경 시 새 row INSERT + 이전 row `effectiveTo` 채움
- `effectiveFrom` 입력 받음
  - default: 다음 월 1일 (안전 기본값)
  - 즉시 적용 옵션: "당월 1일" 선택 시
- 인건비 정산은 wage_history JOIN 그대로 (선행 Phase A 결과 유지)

### 3.3 employee_contracts 폐기

- 의미 중복 해소
- 테스트 단계라 데이터 손실 무관
- DROP TABLE 진행

### 3.4 박제 (계약서) 확장

`employmentElectronicContracts.snapshot*` 14개 신규 추가:
```ts
snapshotPosition: varchar(50)
snapshotContractType: varchar(20)
snapshotWorkStartTime: varchar(5)
snapshotWorkEndTime: varchar(5)
snapshotBreakMinutes: int
snapshotWeeklyHoliday: varchar(20)
snapshotMealProvided: boolean
snapshotMealAllowance: decimal(10,2)
snapshotNightShiftConsent: boolean
snapshotSpecialTerms: text
snapshotHourlyWageIncludesHolidayPay: boolean
// snapshotPayDay, snapshotPayMethod, snapshotEmployerBusinessNumber 등 추가 검토
```

기존 박제와 합쳐 서명 시점의 모든 운영 데이터를 박제. 추후 법적 분쟁 시 박제값으로 증거 제출 가능.

### 3.5 직원 카드 = 운영 데이터 편집의 단일 진입점

직원 카드에 다음 영역 신설:
- 기본 (현행): 역할, 소속회사, 입사일, 주휴무
- 직위·계약: position, contractType, contractStart, contractEnd
- 근무: workStartTime, workEndTime, breakMinutes, weeklyHoliday, weeklyHours
- 세무: taxMode (4대보험/3.3% 라디오)
- 임금: wageType, wageAmount, hourlyWageIncludesHolidayPay + effectiveFrom
- 기타: mealProvided, mealAllowance, nightShiftConsent, specialTerms

저장 시:
- 임금 변경: wage_history INSERT
- 그 외: restaurant_users UPDATE (즉시 덮어쓰기)

### 3.6 갱신 배너 확장

`computeNeedsRenewal`을 17개 항목 비교로 확장:
- 어긋난 항목명을 배너에 나열 (`"3개 항목 어긋남: 직위, 시급, 근무시간"`)
- 차단 없음. 안내만.
- 사용자가 새 계약서 작성·서명하면 박제값이 갱신되어 배너 사라짐

### 3.7 계약서 작성 흐름 변경

`EmploymentContractModal`:
- 신규 모드: 폼 기본값 = 운영 SSOT (restaurant_users + wage_history)
- 갱신 모드: 폼 기본값 = 가장 최근 박제 (`latestSignedContract.snapshot*`)
- 사용자가 폼에서 수정 가능 (박제는 그 시점 폼값 기준)
- 서명 시: `snapshot*` 14개 + 기존 박제 모두 박힘. 운영 데이터는 자동 갱신 안 함 (SSOT 변경은 점장이 직접).

---

## 4. UI 변경

### 4.1 직원 카드 — 직접 편집 영역 신설

기존 영역 + 신규 영역:
```
[기본]            ← 현행
역할, 소속회사, 입사일, 주휴무

[직위·계약]       ← 신규
직위, 계약유형, 계약 시작, 계약 종료

[근무]            ← 신규
업무 시작 시간, 종료 시간, 휴게 분, 주휴일, 주 근무시간

[세무]            ← 신규
4대보험 / 3.3% (라디오)

[임금]            ← 신규
시급/월급 라디오, 금액, 주휴포함 여부 (시급제만)
+ effectiveFrom (date) — default 다음 월 1일

[기타]            ← 신규
식사 제공, 식대, 야간동의, 특이사항

[갱신 필요 배너]  ← 확장
17개 항목 비교, 어긋난 항목명 나열
```

### 4.2 EmploymentContractModal 변경

- 폼 기본값 fetch:
  - 신규 모드: GET `staff.getEmployment(userId, restaurantId)` → restaurant_users + wage_history 현재값
  - 갱신 모드: 가장 최근 박제값
- 사용자가 폼에서 수정 가능
- 서명 후 박제 생성. 운영 데이터 자동 갱신 안 함 (SSOT 직접 수정 원칙).

### 4.3 ContractSignPage

본문 출력 시 박제값(snapshotPosition, snapshotContractType 등) 사용. 현행 본문 분기 로직 그대로 + 신규 박제 필드 표시.

---

## 5. 라우터 변경

### 5.1 server/routers/staff.ts

신규 mutation 2개:

```ts
updateEmployment: managerProcedure
  .input(z.object({
    userId: z.number(),
    restaurantId: z.number(),
    position: z.string().optional(),
    contractType: z.enum([...]).optional(),
    contractStart: z.string().nullable().optional(),
    contractEnd: z.string().nullable().optional(),
    workStartTime: z.string().optional(),
    workEndTime: z.string().optional(),
    breakMinutes: z.number().optional(),
    weeklyHoliday: z.string().optional(),
    weeklyHours: z.string().optional(),
    taxMode: z.enum(["social_insurance","biz_income_3_3"]).optional(),
    hourlyWageIncludesHolidayPay: z.boolean().optional(),
    mealProvided: z.boolean().optional(),
    mealAllowance: z.string().optional(),
    nightShiftConsent: z.boolean().optional(),
    specialTerms: z.string().nullable().optional(),
  }))
  .mutation(...) // restaurant_users UPDATE

updateWage: managerProcedure
  .input(z.object({
    userId: z.number(),
    restaurantId: z.number(),
    wageType: z.enum(["hourly","monthly"]),
    wageAmount: z.string(),
    effectiveFrom: z.string(),  // YYYY-MM-DD
  }))
  .mutation(...) // wage_history 새 row INSERT + 이전 row effectiveTo 채움
```

기존 mutation은 그대로 유지 (updateRole, updateCompany, updateHireDate, updateWeeklyOffDays).

### 5.2 server/routers/staff.ts:listActive 응답 확장

응답 객체에 운영 데이터 12 항목 + 가장 최근 wage_history row + 가장 최근 박제 17개 비교 결과 포함.

### 5.3 server/routers/electronicContracts.ts

- `createEmploymentContract` zod 입력은 사용자가 폼에서 수정한 모든 항목 그대로 받음. 운영 데이터와 분리.
- `signContract`: 14개 신규 박제 컬럼 채움.
- `getLatestTemplate`: 운영 SSOT 또는 가장 최근 박제 둘 중 선택 가능 (UI에서 결정).
- 신규 query: `staff.getEmployment(userId, restaurantId)` — 운영 데이터 fetch (계약서 모달 폼 기본값용)

### 5.4 server/routers/schedules.ts

- laborCostByCompany / workSummaryByEmployee:
  - taxMode·weeklyHours·hourlyWageIncludesHolidayPay 출처를 `restaurant_users`로 변경 (현재는 employmentElectronicContracts에서 조회)
  - wage 정보는 wage_history 그대로 (변경 없음)

---

## 6. 자동 마이그레이션 (server/index.ts)

가드 키: `redesign_2026_05_02_extended_applied` (별도 키, 선행 가드와 분리)

```sql
-- 1. restaurant_users에 운영 데이터 12 컬럼 추가 (idempotent)
ALTER TABLE restaurant_users
  ADD COLUMN IF NOT EXISTS position VARCHAR(50),
  ADD COLUMN IF NOT EXISTS contractType VARCHAR(20),
  ADD COLUMN IF NOT EXISTS contractStart DATE,
  ADD COLUMN IF NOT EXISTS contractEnd DATE,
  ADD COLUMN IF NOT EXISTS workStartTime VARCHAR(5) DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS workEndTime VARCHAR(5) DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS breakMinutes INT DEFAULT 60,
  ADD COLUMN IF NOT EXISTS weeklyHoliday VARCHAR(20) DEFAULT '일요일',
  ADD COLUMN IF NOT EXISTS weeklyHours DECIMAL(5,2) DEFAULT 40,
  ADD COLUMN IF NOT EXISTS taxMode VARCHAR(30) NOT NULL DEFAULT 'social_insurance',
  ADD COLUMN IF NOT EXISTS hourlyWageIncludesHolidayPay BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS mealProvided BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mealAllowance DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nightShiftConsent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS specialTerms TEXT;

-- 2. employmentElectronicContracts에 신규 박제 컬럼 추가
ALTER TABLE employment_electronic_contracts
  ADD COLUMN IF NOT EXISTS snapshotPosition VARCHAR(50),
  ADD COLUMN IF NOT EXISTS snapshotContractType VARCHAR(20),
  ADD COLUMN IF NOT EXISTS snapshotWorkStartTime VARCHAR(5),
  ADD COLUMN IF NOT EXISTS snapshotWorkEndTime VARCHAR(5),
  ADD COLUMN IF NOT EXISTS snapshotBreakMinutes INT,
  ADD COLUMN IF NOT EXISTS snapshotWeeklyHoliday VARCHAR(20),
  ADD COLUMN IF NOT EXISTS snapshotMealProvided BOOLEAN,
  ADD COLUMN IF NOT EXISTS snapshotMealAllowance DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS snapshotNightShiftConsent BOOLEAN,
  ADD COLUMN IF NOT EXISTS snapshotSpecialTerms TEXT,
  ADD COLUMN IF NOT EXISTS snapshotHourlyWageIncludesHolidayPay BOOLEAN;

-- 3. employee_contracts 폐기 (테스트 단계 — 데이터 손실 무관)
-- 가드 키 검사 후 1회만 실행
DROP TABLE IF EXISTS employee_contracts;

-- 4. 가드 키 박제
INSERT INTO system_settings (settingKey, settingValue)
VALUES ('redesign_2026_05_02_extended_applied', JSON_OBJECT('appliedAt', NOW()))
ON DUPLICATE KEY UPDATE settingKey = settingKey;  -- no-op
```

가드 동작:
- 매 부팅 시 ALTER는 idempotent하게 실행 (IF NOT EXISTS)
- DROP TABLE은 가드 키 없을 때만 1회 실행
- 운영 진입 후 가드 키가 박혀 있어 재실행 안전

---

## 7. 작업 순서 (Phase E — Code 단일 세션)

```
[E1] drizzle/schema.ts
     - restaurantUsers 12 컬럼 추가
     - employmentElectronicContracts 11 snapshot 컬럼 추가
     - employeeContracts 정의 삭제 (DROP TABLE 동반)

[E2] server/index.ts 자동 마이그레이션
     ⚠ 정지 조건: DROP TABLE employee_contracts 직전 가드 키 검사 필수
     - 1회만 실행. 운영 진입 후 절대 재실행 금지.

[E3] server/routers/staff.ts
     - updateEmployment mutation 신규 (12 항목 통합 update)
     - updateWage mutation 신규 (wage_history INSERT)
     - listActive 응답 확장 — 12 운영 데이터 + 최신 wage + 11 신규 박제 비교
     - getEmployment query 신규 (계약서 모달 폼 기본값용)

[E4] server/routers/electronicContracts.ts
     - createEmploymentContract: 폼 기본값 fetch 분기 (신규 vs 갱신)
     - signContract: 11개 신규 박제 추가
     - getLatestTemplate: 박제 우선 fallback 운영 SSOT

[E5] server/routers/schedules.ts
     - laborCostByCompany / workSummaryByEmployee:
       • taxMode·weeklyHours·hourlyWageIncludesHolidayPay 출처를 restaurant_users로 변경
       • wage는 wage_history 그대로
     - employeeContracts 참조 모두 제거

[E6] client/src/pages/StaffPage.tsx 직원 카드:
     - 직접 편집 영역 6개 신설 (직위·계약, 근무, 세무, 임금, 기타)
     - 임금 영역에 effectiveFrom date input
     - computeNeedsRenewal 17 항목으로 확장
     - 갱신 배너 어긋난 항목명 나열

[E7] client/src/pages/StaffPage.tsx EmploymentContractModal:
     - 폼 기본값 fetch 분기 (신규: getEmployment, 갱신: latestSignedContract.snapshot*)
     - 신규 항목들 모두 폼에 포함

[E8] client/src/pages/ContractSignPage.tsx:
     - 11개 신규 snapshot 본문 출력
     - 표 행 · 조항 분기 확장

[E9] employee_contracts 잔존 참조 제거 (server/routers/restaurants.ts 등)

[E10] pnpm run build 통과
[E11] 5항 의무 보고 → 사용자 승인 → push
```

완료 조건:
- 빌드 통과
- 신규 직원 1명 → 직원 카드에서 운영 데이터 입력 → 정산 즉시 반영 (계약서 미작성 상태)
- 임금 변경 → wage_history 새 row + effectiveFrom 적용
- 새 계약서 작성·서명 → 박제 17개 (기존 + 신규 11) 모두 박힘
- 갱신 배너: 운영 SSOT vs 박제 어긋날 때 항목명 정확 표시

---

## 8. 테스트 케이스

| # | 조건 | 기대 |
|---|---|---|
| 1 | 신규 직원 추가 (계약서 미작성) | 직원 카드에서 운영 데이터 입력 + wage 입력 → 정산 정상 반영 |
| 2 | 임금 변경 (effectiveFrom = 다음 월 1일) | 당월은 옛 임금, 다음 월부터 새 임금 |
| 3 | 임금 변경 (effectiveFrom = 당월 1일) | 당월부터 새 임금 |
| 4 | 근무시간 변경 | 즉시 정산 반영. 박제는 불변. 갱신 배너 출현 |
| 5 | 직위 변경 | 즉시 반영. 갱신 배너 출현 |
| 6 | 계약기간 변경 (contractEnd) | 즉시 반영. 갱신 배너 출현 |
| 7 | taxMode 변경 (4대보험 → 3.3%) | 즉시 반영. 인건비 정산에서 taxMode 분기 갱신 |
| 8 | hourlyWageIncludesHolidayPay 변경 | 즉시 반영. 시급제 주15h 분기 갱신 |
| 9 | 새 계약서 작성 (운영 SSOT 기반) | 폼 기본값 = 운영 데이터 + wage_history 현재값 |
| 10 | 새 계약서 작성 (갱신 모드) | 폼 기본값 = 가장 최근 박제 |
| 11 | 서명 완료 후 박제 검사 | 11 신규 + 기존 박제 모두 채워짐 |
| 12 | 박제 직후 갱신 배너 | 출현 안 함 (운영 SSOT == 박제) |
| 13 | 운영 데이터 변경 후 갱신 배너 | 출현. 어긋난 항목명 정확 |
| 14 | employee_contracts DROP 검증 | 테이블 자체 부재 |
| 15 | 가드 키 동작 | 재부팅 시 DROP TABLE 재실행 안 됨 |

---

## 9. 결정 사항 (확정)

| # | 항목 | 결정 |
|---|---|---|
| 9.7 | SSOT 위치 | restaurant_users 통합 + employee_contracts 폐기 |
| 9.8 | 임금 시점 분기 | wage_history 신규 row + UI에서 effectiveFrom 입력 |
| 9.9 | 비임금 항목 시점 분기 | 즉시 덮어쓰기. 감사 로그는 후속 핸드오프. |
| 9.10 | 갱신 배너 범위 | 17개 항목 비교, 어긋난 항목명 나열. 차단 없음. |
| 9.11 | 계약서 작성 흐름 | 신규: 운영 SSOT 기본값. 갱신: 박제 기본값. 박제 후 운영 데이터 자동 갱신 안 함. |
| 9.12 | 직원 카드 UI 범위 | 17개 항목 모두 직접 편집. 임금만 effectiveFrom 동반. |

---

## 10. 함의 — 운영 흐름 변화

### 10.1 인건비 정산 즉시 영향
- 직원 카드에서 근무시간·taxMode·임금 변경 시 미박제 월 인건비 즉시 재계산
- monthly_closings.confirm 후 박제된 월은 박제값 유지
- 점장 안내: 변경 시 toast로 "이번 달부터 변경된 값으로 정산됩니다" 표시

### 10.2 계약서의 의미 약화
- 계약서 = 법적 박제만. 운영값과 분리.
- 운영값 변경 빈번하면 박제와 어긋나는 직원 다수 발생 → 갱신 배너 만성화 가능
- 점장이 분기/연도별로 일괄 갱신하는 운영 흐름 권장

### 10.3 분쟁 시 증거
- 박제된 계약서 + wage_history 변경 이력 + 운영 데이터 현재값
- audit log 부재 (비임금 항목) → 변경 추적 불가능
- 후속 핸드오프 후보: 감사 로그 도입

### 10.4 employer_presets, contractFields.ts 잔존 정리
- 본 작업 범위 외. 별도 핸드오프.

---

## 11. 미해결 / 후속 핸드오프 후보

- 비임금 항목 변경의 감사 로그 (audit_logs 활용)
- employee_contracts 잔존 참조 grep 후 일괄 제거
- 임시 근로자(`tempWorker*`) 데이터 모델과 본 사양 통합
- 시급제 + 주15h 미만 직원 4대보험 미적용 자동 안내
- 3.3% 직원 인건비 명세서 양식 분리

각 항목 발견 시 본 PR에 섞지 말 것.
