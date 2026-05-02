# 운영 데이터 SSOT 확장 — Code 핸드오프

작성: 2026-05-02 (Cowork)
대상: Claude Code (Mac M3)
사양서: `docs/redesign_2026-05-02_운영데이터_SSOT_확장.md`
선행: `docs/redesign_2026-05-02_계약_직원_인건비.md` (Phase A~D 완료)
범위: 운영 데이터 12 컬럼 + 박제 11 컬럼 추가 + employee_contracts DROP + 직원 카드 직접 편집 UI

---

## 0. 시작 전 점검 (CLAUDE.md §2 의무)

```bash
git rev-parse --show-toplevel    # = ~/Documents/Claude/Projects/restaurant-manager
git status -sb
git fetch
git log --oneline @{u}..
git log --oneline ..@{u}
ls -la .git/index.lock .git/HEAD.lock 2>/dev/null && rm -f .git/index.lock .git/HEAD.lock
```

선행 핸드오프 진행 로그 마지막 줄 확인 — Phase A~D 완료 상태 검증.

---

## 1. 사용자 확인

§9.7 ~ §9.12 모두 확정. 추가 확인 불요.

다만 자율 SELECT 1회 — DROP TABLE 직전 확인:
```sql
SELECT COUNT(*) FROM employee_contracts;
-- 0 기대 (선행 Phase A에서 DELETE 완료)
```
0 아니면 정지 후 보고. 0이면 그대로 DROP 진행.

---

## 2. 작업 순서 (Phase E — 단일 세션)

```
[E1] drizzle/schema.ts
     - restaurantUsers에 12 컬럼 추가 (사양 §3.1):
       position, contractType, contractStart, contractEnd,
       workStartTime, workEndTime, breakMinutes, weeklyHoliday, weeklyHours,
       taxMode, hourlyWageIncludesHolidayPay,
       mealProvided, mealAllowance, nightShiftConsent, specialTerms
       (정확히 15개 — 사양 §3.1 컬럼 목록 그대로)
     - employmentElectronicContracts에 신규 박제 11 컬럼 추가 (사양 §3.4):
       snapshotPosition, snapshotContractType,
       snapshotWorkStartTime, snapshotWorkEndTime,
       snapshotBreakMinutes, snapshotWeeklyHoliday,
       snapshotMealProvided, snapshotMealAllowance,
       snapshotNightShiftConsent, snapshotSpecialTerms,
       snapshotHourlyWageIncludesHolidayPay
     - employeeContracts 테이블 정의 자체 삭제

[E2] server/index.ts 자동 마이그레이션 (사양 §6 SQL)
     - ALTER restaurant_users 15 컬럼 ADD IF NOT EXISTS
     - ALTER employment_electronic_contracts 11 컬럼 ADD IF NOT EXISTS
     - DROP TABLE IF EXISTS employee_contracts (가드 키 검사 후 1회만)
     - 가드 키: redesign_2026_05_02_extended_applied
     ⚠ 정지 조건: DROP TABLE 직전 1.1 SELECT 결과 0 확인 + 가드 키 부재 확인

[E3] server/helpers/labor.ts (확장)
     - getEffectiveOperationalData(userId, restaurantId): restaurant_users 운영 데이터 fetch
     - getEffectiveWage(userId, restaurantId, asOf?): wage_history 시점별 조회
       (asOf default = now)

[E4] server/routers/staff.ts
     - updateEmployment mutation 신규 (사양 §5.1):
       12 항목 통합 update. zod에서 모두 .optional()
     - updateWage mutation 신규:
       wage_history 새 row INSERT + 이전 row effectiveTo = effectiveFrom으로 닫기
       effectiveFrom 입력 받음 (date)
     - listActive 응답 확장:
       12 운영 데이터 + 최신 wage_history row + 11 신규 snapshot 비교 결과
     - getEmployment query 신규:
       특정 직원의 운영 SSOT 일괄 fetch (계약서 모달 폼 기본값용)

[E5] server/routers/electronicContracts.ts
     - createEmploymentContract: 폼 입력값 그대로 저장 (운영 SSOT 자동 갱신 안 함)
     - signContract 트랜잭션:
       11개 신규 박제 추가 (snapshotPosition ~ snapshotHourlyWageIncludesHolidayPay)
     - getLatestTemplate: 변경 없음 (사양에 명시한 기본값 fetch는 클라이언트에서 결정)

[E6] server/routers/schedules.ts
     - laborCostByCompany / workSummaryByEmployee:
       • taxMode 출처를 restaurant_users로 변경 (현재는 employmentElectronicContracts 또는 wage_history)
       • weeklyHours 출처를 restaurant_users로 변경
       • hourlyWageIncludesHolidayPay 출처를 restaurant_users로 변경
       • wage_history JOIN은 그대로 (wage 자체)
     - employeeContracts JOIN 모두 제거

[E7] server/routers/restaurants.ts, monthlyClosings.ts, dailyClosings.ts
     - employeeContracts 잔존 참조 grep 후 모두 제거

[E8] client/src/pages/StaffPage.tsx 직원 카드 (사양 §4.1):
     - 신규 6개 영역 추가 (직위·계약, 근무, 세무, 임금, 기타)
     - 각 영역 인라인 편집 UI (현행 hireDate 패턴 따라)
     - 임금 영역에 effectiveFrom date input
     - computeNeedsRenewal 17 항목으로 확장
     - 갱신 배너에 어긋난 항목명 나열

[E9] client/src/pages/StaffPage.tsx EmploymentContractModal:
     - 폼 기본값 fetch:
       • 신규 모드: staff.getEmployment(userId, restaurantId)
       • 갱신 모드: latestSignedContract.snapshot* 데이터
     - 신규 항목들 모두 폼에 포함 (현재 일부만 입력)
     - 저장 시 운영 데이터 자동 갱신 안 함 (SSOT 직접 수정 원칙)

[E10] client/src/pages/ContractSignPage.tsx:
      - 11개 신규 snapshot 본문 출력
      - 표 행 + 조항 분기 확장

[E11] pnpm run build 통과
[E12] §8 테스트 케이스 15건 정적 검증
[E13] 5항 의무 보고 → 사용자 승인 → push
```

완료 조건:
- 빌드 통과
- 신규 직원 1명 → 직원 카드에서 모든 운영 데이터 입력 → 인건비 정산 정상 반영 (계약서 미작성 상태)
- 임금 변경 → effectiveFrom 시점부터 적용
- 새 계약서 작성·서명 → 11 신규 박제 모두 채워짐
- 갱신 배너: 17개 항목 어긋남 정확 표시

---

## 3. 정지 조건 (CLAUDE.md §3 외 추가)

### 3.1 DROP TABLE employee_contracts 직전 — 최우선

```sql
-- Code 자율 SELECT 후 결과 보고
SELECT COUNT(*) FROM employee_contracts;
SELECT settingKey, settingValue FROM system_settings
  WHERE settingKey = 'redesign_2026_05_02_extended_applied';
```

조건:
- COUNT(*) = 0 (선행 Phase A에서 이미 DELETE 됨)
- 가드 키 부재 (이번 마이그레이션 첫 실행)

둘 다 만족 시 자율 진행. 하나라도 어긋나면 정지 후 보고.

운영 진입(인건비 실 지급 시작) 후에는 본 마이그레이션 코드 자체를 server/index.ts에서 제거 권장.

### 3.2 각 단계 push 직전
- 항상 5항 보고 후 사용자 승인 대기
- Phase E 단일 push 권장 (작업이 단일 사양 범위 내)

### 3.3 근본 분기 판단
- 사양과 어긋나는 선택지 등장 시 정지 후 보고
- 특히 SSOT 통합 시 wage_history와 의미 충돌 발견되면 즉시 보고 (사양 §3.2 wage_history 그대로 유지가 원칙)

---

## 4. 단계별 검증 포인트

### Phase E 완료 시
- [ ] `restaurant_users` 컬럼 15개 추가 확인 (information_schema SELECT)
- [ ] `employment_electronic_contracts` snapshot 컬럼 11개 추가 확인
- [ ] `employee_contracts` 테이블 부재 확인 (`SHOW TABLES LIKE 'employee_contracts'` → 0건)
- [ ] 가드 키 박제 확인 (`SELECT * FROM system_settings WHERE settingKey = 'redesign_2026_05_02_extended_applied'`)
- [ ] 빌드 통과
- [ ] 신규 직원 1명 + 운영 데이터 입력 + 임금 입력 → 인건비 정산 정상 반영 (수동 검증)
- [ ] 새 계약서 작성·서명 → 11 신규 박제 모두 NOT NULL 확인 (DB SELECT)

---

## 5. 5항 의무 보고 형식 (CLAUDE.md §4)

push 직전:

```
1. 변경 파일:
   - drizzle/schema.ts (+restaurant_users 15컬럼, +empContracts 11컬럼, -employeeContracts 정의)
   - server/index.ts (마이그레이션 +N줄, 가드 키 + DROP TABLE)
   - server/helpers/labor.ts (+getEffectiveOperationalData, +getEffectiveWage)
   - server/routers/staff.ts (+updateEmployment, +updateWage, +getEmployment, listActive 확장)
   - server/routers/electronicContracts.ts (signContract 박제 +11)
   - server/routers/schedules.ts (taxMode·weeklyHours 출처 변경, employeeContracts 제거)
   - server/routers/restaurants.ts, monthlyClosings.ts, dailyClosings.ts (employeeContracts 참조 제거)
   - client/src/pages/StaffPage.tsx (직원 카드 6영역 신설, computeNeedsRenewal 17항목, 모달 기본값 fetch 분기)
   - client/src/pages/ContractSignPage.tsx (11 snapshot 본문 출력)

2. 변경 의도:
   - 계약서 ↔ 운영 데이터 분리. 운영 SSOT를 직원정보로 확장.
   - 운영값 변경 시 계약서 서명 불요. 정산은 운영 SSOT 즉시 반영.
   - 계약서는 시점 박제만. 분쟁 시 증거 보존.
   - employee_contracts 의미 중복 폐기 (wage_history와 통합).

3. 영향 범위:
   - DB: restaurant_users +15컬럼, empContracts +11컬럼, employee_contracts DROP, system_settings +1키
   - tRPC: staff (3 mutation 신규, listActive 확장), electronicContracts (signContract 박제), schedules (출처 변경)
   - UI: StaffPage 직원 카드 대폭 확장, EmploymentContractModal 기본값 fetch 분기, ContractSignPage 박제 출력 확장
   - 권한: updateEmployment/updateWage = manager 이상

4. 리스크:
   - employee_contracts DROP은 1회 한정. 가드 키로 재실행 차단. 운영 진입 후 마이그레이션 코드 자체 제거 권장.
   - 직원 카드에서 임금·근무시간 변경 시 미박제 월 인건비 즉시 재계산. 점장 안내 toast 필요.
   - 갱신 배너 만성화 가능 — 운영값 자주 변경 + 박제 갱신 빈도 낮으면 항상 출현. 점장이 분기/연도별 일괄 갱신 권장.
   - 비임금 항목 변경 audit log 부재 — 후속 핸드오프 후보.
   - 롤백: git revert + system_settings 가드 키 삭제 + employee_contracts 재생성. 단 이미 DROP된 데이터는 복구 불가 (테스트 단계라 무관).

5. 빌드 결과:
   - pnpm run build 통과 / 실패
   - 테스트 15건 정적 검증 통과 / 실패
```

---

## 6. 진행 로그 의무

본 파일에 작업 마무리 시 한 줄 append:

```
2026-05-02 Code(SHA) — Phase E 완료 / 미해결: ...
```

---

## 7. 본 작업 범위 외 (별도 핸드오프 후보)

- 비임금 항목 변경 audit log
- employer_presets 폐기 (affiliated_companies로 일원화)
- 임시 근로자(`tempWorker*`) 모델 통합
- 시급제 + 주15h 미만 4대보험 미적용 안내
- 3.3% 직원 인건비 명세서 양식 분리
- 점검 페이지 N+1 fetch 재설계 (수백명 규모 도달 시)

각 항목 발견 시 본 PR에 섞지 말 것. 메모만 남기고 사용자에 보고.

---

## 진행 로그

(append 영역)

2026-05-02 Code(pending) — Phase E [E1]~[E13] 완료. schema.ts: restaurant_users +15컬럼, employmentElectronicContracts +11 snapshot 컬럼, employeeContracts 정의 삭제. server/index.ts: redesign_2026_05_02_extended_applied 가드 키 + ALTER 26개(idempotent) + DROP TABLE IF EXISTS employee_contracts (1회 한정). helpers/labor.ts: getEffectiveOperationalData / getEffectiveWage / getLatestWage 신규. staff.ts: updateEmployment(15필드) / updateWage(wage_history INSERT + open row close) / getEmployment 신규, listActive 17 박제 fetch + computeNeedsRenewal 17항목, updateInfo에서 employeeContracts 분기 제거. electronicContracts.ts: createEmploymentContract SSOT 자동 sync 제거 (사양 §3.7), signContract 11 신규 박제 추가, wage_history 백필 1회만. schedules.ts: laborCostByCompany / workSummaryByEmployee taxMode·weeklyHours·hourlyWageIncludesHolidayPay·position 출처를 restaurant_users로 일원화, employeeContracts JOIN 모두 제거. restaurants.ts/dailyClosings.ts: employeeContracts 잔존 참조 제거, weeklyHours·position·계좌 출처 변경. restaurants.getStaff 응답 확장(운영 12+박제 15). monthlyClosings.ts: **Phase E 박제 안전망 보강** — sumLaborByCompany에서 closedDateStrs 있을 때 daily_closings.laborCost SUM으로 totalCost 박제값 사용, byCompany 분해는 schedules 비율 + 박제 총합 비율 보정 (사양 §10.1 정합 — 박제된 일자 회고 변경 차단). StaffPage.tsx: 직원 카드 6 영역(직위·계약/근무/세무/임금/기타) 인라인 편집 UI 추가, 임금 effectiveFrom date input + updateWage 호출, computeNeedsRenewal 17 항목 한글 항목명. ContractFormModal: staff.getEmployment query + empSSOT prefill (신규 모드 운영 SSOT 우선), mealAllowance(form) input + nightShiftConsent 체크박스 + 박제↔운영 SSOT 분리 안내 배너 추가. ContractSignPage.tsx: 11 신규 박제 fallback (pickSnap 헬퍼) 본문 출력 (직위·계약유형·근무시간·휴게·주휴일·식대·야간동의·특이사항·주휴포함 분기). seed.ts: employeeContracts INSERT를 wage_history + restaurant_users 운영 데이터 update로 교체. 사전 SELECT(prod, MYSQL_PUBLIC_URL): employee_contracts row 0건, redesign_2026_05_02_extended_applied 가드 키 부재. pnpm run build 통과 (vite 2,979 modules + esbuild 813.2kb). pnpm test 통과 (4 files / 106 tests, settlement-calc 35건 포함). 미해결 / 후속 핸드오프 후보: (1) audit_logs 전후값 비교 미기록(현재 details.fields 키 목록만), (2) 17 항목 일괄 박제 mutation 부재(일괄 박제는 새 계약서 작성·서명만), (3) 외부 employee_contracts 참조 검증 미수행(BI/백업/수기 SQL — 사용자 측 확인 필요), (4) restaurant_users 5인여부 컬럼 미포함(affiliated_companies.over5Employees가 단일 SSOT 유지).
