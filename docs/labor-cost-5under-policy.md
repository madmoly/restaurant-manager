# [ARCHIVED] 5인미만 사업장 인건비 정산 정책

> **상태: 폐기 (2026-05-01)**
> **사유: 사용자 결정으로 시간×시급(현 시스템) 유지. 일 단위 보정 정책 미채택.**
>
> ---
>
> 작성: 2026-05-01 (Cowork)
> 갱신: 2026-05-01 v4 — 테스트 기간 전제로 차액 통지/동의 흐름 제거, Q1·Q3 결정 반영
> v3 — 일마감/월정산 정합성 정책(§12) 추가, dailyClosings + monthlyClosings 변경 범위 포함
> v2 — 결근 개념 정정, 템플릿 2종 분리, 5인미만 리스크 완화 설계 추가
>
> ---
>
> ## 폐기 결정 기록
>
> 진재이 4월 검증값 산출 과정에서 일 단위 보정과 시간 단위 차감의 결과 차이가 ₩627,751로 큰 폭이 드러남. 사용자가 이를 검토 후 시간×시급(현 시스템) 유지 결정. 본 사양서의 모든 정책·헬퍼·테이블 변경은 미적용.
>
> ## 보존 가치 (재논의 시 참고)
>
> 1. **진재이 케이스 — 미달근무 시 시간식의 큰 폭 차감**
>    - 209h 분모 기준이라 18일 출근(144h)이면 65h 부족 → 약 8.1일치 통째 차감
>    - 노동법상 5인미만은 휴업수당 의무 면제라 합법이지만 직원 만족도·이직률에 영향 가능
>
> 2. **§12 정합성 결함은 본 폐기로 자동 해소**
>    - 모든 화면이 동일 시간×시급 식을 사용하므로 LaborCostPage·MonthlySettlement·대시보드 값이 항상 일치
>    - 단, `dailyClosings.ts:127-148` 의 시간×시급 분기와 `schedules.ts:laborCostByCompany` 의 분기가 동일 식임을 코드 리뷰 시 확인할 것
>
> 3. **김정란 "9회 휴무" 의문은 정상 동작 확인됨**
>    - weeklyOffDays=2 × (해당월 일수/7) 반올림 = 9
>    - 5인미만/이상 플래그 무관, 연차와 무관
>    - 단 `round(2 × 31/7)` = `round(2 × 30/7)` = 9 인 31일/30일 동일값 결함은 별도 (휴무 차감/가산 식 자체가 폐기되어 운영상 무관)
>
> 4. **계약서 환산 문구는 코드베이스에 미도입**
>    - 본 작업의 단계 [4] 템플릿 분기 미진행
>    - `electronicContracts.ts` 본문 생성에 5인미만/이상 분기 없음 — 현재 단일 템플릿 유지
>
> ---
> 적용 대상: `server/routers/schedules.ts`, `server/routers/dailyClosings.ts`, `server/routers/monthlyClosings.ts`, `server/routers/electronicContracts.ts`, `client/src/pages/LaborCostPage.tsx`, `client/src/pages/StaffPage.tsx`, `client/src/pages/MonthlySettlementPage.tsx`, `client/src/pages/AdminDashboard.tsx`, `client/src/pages/ManagerDashboard.tsx`, `client/src/pages/ProfitPage.tsx`
> 트리거: 김정란(천호점, 5인미만, 월급제) 4월 정산에서 실효월급이 계약월급과 어긋나는 현상 확인 중 발견된 구조적 결함

---

## 1. 결함 진단

### 현상
- 김정란 4월: 계약월급 ₩2,700,000, 실휴무 8일(계약 9일) → 시스템 표시 ₩2,816,268 (+4.3%)
- 다른 월에서 출근 부족 시 ₩258,373(-90.4%)까지 떨어짐 — 동일 메커니즘

### 원인 (`server/routers/schedules.ts:1085-1097`)
월급제도 시급 환산(`M / 209`) 후 `시간 × 시급`으로 계산. **월급 보장 안 됨**, 양방향 임의 변동.

### 노동법 관점
- 5인미만은 가산수당(×1.5)·연차·휴업수당·부당해고 의무 면제
- 단, **월급제 본질(월 단위 고정 보수)·임금체불 처벌·최저임금**은 살아있음
- 휴무 차이는 **결근/공제 아님** — 스케줄상 매장 사정에 따른 추가근무·미달근무 보정 개념

---

## 2. 확정 정책

| 분기 | 정산식 |
|---|---|
| 5인이상 (시급/월급) | **현재 코드 유지** (시간×시급) |
| 5인미만 + 시급제 | **현재 코드 유지** (시간×시급) |
| 5인미만 + 월급제 + 평월 (1·3·4·5·6·7·8·9·10·11·12월) | `계약월급 + (계약휴무 − 실휴무) × 일급` |
| 5인미만 + 월급제 + **2월** | `계약월급 × 해당월일수 / 31` |
| 반차 (실휴무 0.5일) | 일급 × 0.5 차감/가산 |

### 보조 정의
- **일급** = `(계약월급 / 209) × 8`
- **5인미만 판정** = `employmentElectronicContracts.over5Employees = false` (가장 최근 계약 기준)
- **해당월일수** = 28/29/30/31

### 보정 의미 (결근공제 아님)
- 실휴무 < 계약휴무 → 매장 요청 추가근무 → 일급×차이일수 가산
- 실휴무 > 계약휴무 → 매장 사정 미달근무 → 일급×차이일수 차감
- 직원 사유 결근(병가 등)은 본 정책 범위 외 (스케줄 단계에서 별도 처리)

---

## 3. 의사코드

```ts
// 5인미만 + 월급제 분기 (신규, 기존 시간×시급 분기보다 우선)
if (!over5Employees && r.wageType === "monthly" && r.wageAmount) {
  const M = Number(r.wageAmount);
  const dailyWage = (M / 209) * 8;

  if (input.month === 2) {
    wage = M * daysInMonth / 31;     // 2월 일수 비례
  } else {
    const diffDays = contractDaysOff - actualDaysOff;
    wage = M + diffDays * dailyWage; // 평월 휴무 보정
  }

  // 최저임금 가드 (§5 R-MW)
  const effectiveHourly = wage / totalHours;
  if (totalHours > 0 && effectiveHourly < minWageOfYear(input.year)) {
    wage = totalHours * minWageOfYear(input.year);
    setFlag(emp, "minWageBoosted");
  }
}
```

- `actualDaysOff` = `operatingDays - shifts` (반차 0.5일 보정 포함, leaveRequests 조회로 합산)
- `contractDaysOff` = `round(weeklyOffDays × daysInMonth / 7)` (현행 유지)

---

## 4. 코드 변경 위치

### 4.1 신규 헬퍼 — `server/lib/labor.ts`
```ts
export async function getOver5Status(userId, restaurantId): Promise<boolean>
export async function getApplicableTemplate(userId, restaurantId): Promise<"under5" | "over5">
export function calcMonthlyWage5Under(M, daysInMonth, month, contractOff, actualOff): number
export function minWageOfYear(year): number    // 시스템 설정값 조회
```
`leaveBalance.ts:check5PlusEmployee` 도 위 헬퍼로 통합.

### 4.2 `server/routers/schedules.ts`
- `laborCostByCompany` (line 869~)
  - rawRows 쿼리에 `employmentElectronicContracts.over5Employees` JOIN
  - leaveRequests 조회 추가 (반차 0.5 처리)
  - 임금 계산 분기에 5인미만+월급제 케이스 우선 추가
- `workSummaryByEmployee` (line 1415~) 동일 변경

### 4.3 `server/routers/electronicContracts.ts` — 템플릿 2종 분리
- 본문 생성 로직에 분기:
  - `over5Employees=false` → "월급은 해당월 일수 31일 미만 시 (해당월 일수/31) 비례 환산하여 지급한다" 문구 포함
  - `over5Employees=true` → 환산 문구 제외 (통상임금 일할계산 원칙 명시)
- 신규/갱신 시 자동 라우팅, 점장이 임의 변경 불가

### 4.4 `client/src/pages/LaborCostPage.tsx`
- 5인미만+월급제 직원에 **"월급보장(5인미만)" 배지** 추가
- 비용 분해 라인:
  - 평월 보정 발생 시 → `기본 ₩2,700,000  /  보정 ±₩X  /  실지급`
  - 2월 → `기본 (월급 × 일수/31)` 라벨에 "2월 환산" 주석
  - 최저임금 가드 발동 시 → `최저임금 보장 ↑` 표시

### 4.5 `client/src/pages/StaffPage.tsx` — 서명 게이트 (§5 R-SIG)
- 5인미만 + 월급제 직원의 계약서가 **서명 미완료** 또는 **환산 문구 없는 구버전**이면:
  - 인건비 정산 화면에 경고 띠 표시
  - 신정책 적용 보류 → 현행 시간 비례식으로 계산 (안전 fallback)
  - "계약서 갱신 필요" 알림 + 재발급 버튼

### 4.6 `server/routers/monthlyClosings.ts` — 월별 보정 (§12 신규)
- `monthly_closings` 에 `laborCostAdjustment`, `adjustmentDetails` 컬럼 추가 (자동 마이그레이션)
- `confirm` mutation에 보정값 자동 계산 + 저장
- 조회 query에 보정값 포함 응답
- 미확정 상태 조회 시 실시간 계산 (캐시 없음)

### 4.7 `server/routers/dailyClosings.ts` — **변경 없음**
- 일별 시간 비례 식 그대로 유지 (§12 옵션 b 채택 결과)
- 일별 손익 정확도 유지 위해 의도적 보존

### 4.8 월 단위 표시 화면 일괄 — 보정값 합산 표시
- `MonthlySettlementPage.tsx`: 인건비 라인에 `(보정 ±₩X)` 부기 표시
- `AdminDashboard.tsx`, `ManagerDashboard.tsx`: 합계만 보정 후 값 (tooltip에 detail)
- `ProfitPage.tsx`: 인건비율 = `(laborCost + adjustment) / sales × 100`

---

## 5. 5인미만 회사 리스크 완화 설계

R1(5인이상 적용 위법)은 §6에 분리. 여기서는 5인미만에서도 살아있는 리스크를 **시스템 설계로 차단**.

### R-SIG 임금체불 처벌 적용 → 직원 서명 게이트
- 5인미만이라도 임금체불은 처벌 대상. 계약서 미서명 상태에서 신정책 적용 시 직원이 "동의한 적 없다" 주장 가능
- **설계**:
  1. 신정책은 **계약서에 환산 문구 + 직원 서명 완료** 시점부터만 적용
  2. 시스템에서 자동 게이트: `employmentElectronicContracts.signedAt IS NULL` → 신정책 비활성, 안내 배너
  3. 서명 이력 보관 (이미 `employmentElectronicContracts` 스키마에 존재)
  4. 정산 결과 명세서에 적용된 정책 버전 명시 (`policy_version: "5under_v1"` 등)

### R-MW 최저임금 적용 → 자동 가드
- 2월 환산: `M × 28/31`로 깎인 후 시간으로 환산했을 때 시급이 최저임금 미만이면 위법
- 평월 미달근무: 일급 차감 후 시급 환산이 최저임금 미만이면 위법
- **설계**:
  1. 정산 마지막 단계에서 `effectiveHourly = wage / totalHours` 계산
  2. `effectiveHourly < minWageOfYear` 면 `wage = totalHours × minWage` 로 상향 보정
  3. 보정 발생 시 직원·정산본에 플래그(`minWageBoosted: true`)
  4. `minWageOfYear` 값은 `system_settings` 테이블에 연도별 저장, master만 수정 가능
  5. **2026년 최저임금 시급 = 10,320원** (확정 고시값, 적용기간 2026.01.01~12.31)

### R-NOTI 소급 재계산 (테스트 기간 단순화)
**전제**: 본 시스템은 아직 테스트 기간으로 인건비 정산분이 실제 지급된 적 없음.

- 차액 통지·동의·환수·이의신청 흐름 **불필요**
- `payroll_adjustment_consents` 테이블 **불필요**
- 소급 배치는 단순 재계산:
  1. master 전용 일회성 스크립트 실행
  2. 2026.01~04 각 월의 `monthly_closings.laborCostAdjustment` 채움
  3. `daily_closings`는 변경 없음
  4. 별도 알림·동의 절차 없음
- 운영 시작 후 첫 정산부터 신정책이 정확한 값을 표시
- ⚠ **운영 진입(실 지급 시작) 후 정책 변경 시에는 본 단순화 적용 불가** — 그 시점에는 차액 통지·동의 흐름 별도 설계 필요

### R-PAY 명세서 발급
- 임금체불 분쟁 시 가장 큰 증거가 명세서 미발급/불일치
- **설계**:
  1. 월별 정산 확정 시점에 직원별 명세서 PDF 자동 생성 (또는 화면 출력 + PDF 다운로드)
  2. 항목: 계약월급, 휴무 보정 내역(차이일수×일급), 2월 환산(해당 시), 최저임금 가드(해당 시), 적용 정책 버전
  3. 직원 본인 화면에서 조회 가능 (현재 `restaurantUsers` role 기반 접근)
  4. 명세서 발급 이력은 별도 테이블 보관 (`payroll_statements` 신규)

---

## 6. 5인이상 회사 리스크 (적용 금지)

이 정책을 5인이상 직원에게 적용하면 거의 전 영역에서 위법:

| 영역 | 상태 | 위반 결과 |
|---|---|---|
| 통상임금 일할계산 원칙 | 적용 | 28/31 분모는 사업주 임의 산정 — 무효 |
| 가산수당 ×1.5 의무 | 적용 | 추가근무 일급×1.0 가산 → 임금체불 |
| 연차 의무 | 적용 | 연차 사용 휴무가 미달근무로 잘못 보정 → 이중 손실 |
| 휴업수당 의무 | 적용 | 매장 사정 미달근무 일급 차감 → 휴업수당(평균 70%)보다 더 깎음 |
| 부당해고 제한 | 적용 | 일방적 임금산정 변경 → 근로조건 불이익변경 |

### 차단 설계
- 전자계약서 템플릿 자동 라우팅(§4.3)으로 5인이상에 환산 문구 진입 자체 봉쇄
- `schedules.ts` 정산 로직에서 `over5Employees=true` 분기는 항상 현행 시간 비례식
- 매장 인원 변동으로 직원이 5인미만→5인이상 전환 시:
  - 시스템 알림 발생 ("5인이상 매장 진입 — 계약서 갱신 필요")
  - 갱신 전까지는 5인미만 정책 유지하되, 점장에게 경고 누적

---

## 7. 결정 사항 (구 §7 미정)

| 항목 | 결정 |
|---|---|
| 소급 적용 범위 | 2026.01~04 단순 재계산 (테스트 기간 — 통지/동의 불필요) |
| 계약서 템플릿 | 2종 분리 (5인미만용/5인이상용), 자동 라우팅 |
| 결근 사유 입력 UI | 불필요 (휴무는 결근 아닌 스케줄 보정 개념) |
| 5인미만 시급제 | 현행 시간×시급 유지 |
| 2026 최저임금 | 시급 10,320원 (확정 고시) |

---

## 8. 테스트 케이스

| # | 조건 | 입력 | 기대 출력 |
|---|---|---|---|
| 1 | 4월, 휴무 9/9 | M=2,700,000 | ₩2,700,000 |
| 2 | 4월, 휴무 9/8 (1일 추가근무) | M=2,700,000 | ₩2,803,349 |
| 3 | 4월, 휴무 9/11 (2일 미달근무) | M=2,700,000 | ₩2,493,302 |
| 4 | 4월, 반차 1회 + 휴무 9/8.5 | M=2,700,000 | ₩2,751,675 |
| 5 | 2월(28일) | M=2,700,000 | ₩2,438,710 |
| 6 | 2월(29일, 윤년) | M=2,700,000 | ₩2,525,806 |
| 7 | 5인이상 직원 | (현행 식) | 현행 결과 |
| 8 | 5인미만 + 시급제 | (현행 식) | 현행 결과 |
| 9 | 1월(31일), 휴무 9/9 | M=2,700,000 | ₩2,700,000 |
| 10 | 최저임금 가드 발동 (2월 환산 + 장시간 근무) | M=2,000,000, 2월, 220h | `220 × minWage` 보정 |
| 11 | 미서명 계약서 | 5인미만+월급제, signedAt=NULL | 현행 시간 비례식 (게이트 차단) |
| 12 | 환산 문구 없는 구버전 계약서 | 5인미만+월급제, 구 템플릿 | 현행 시간 비례식 + 갱신 알림 |
| 13 | **정합성 검증** (§12) | 김정란 4월 LaborCostPage 합계 | `monthlyClosings.laborCost + laborCostAdjustment` 와 일치 |
| 14 | 월정산 미확정 상태 보정값 조회 | 신정책 직원 있는 매장 | 실시간 계산값 반환 (캐시 없음) |
| 15 | 5인이상 직원만 있는 매장 | 모든 직원 over5 | adjustment = 0 (기존 동작 유지) |

테스트 9: 31일 달도 휴무 동일하면 월급 그대로 (현행 시간 비례식과 다른 결과 확인 포인트)
테스트 13: 화면별 인건비 값이 항상 일치 — 정합성 핵심 검증

---

## 9. 작업 순서 (Code 핸드오프용)

### Phase A — 백엔드 핵심 (세션 1)
1. `server/lib/labor.ts` 신규 — 4종 헬퍼 작성
2. `leaveBalance.ts:check5PlusEmployee` 를 헬퍼로 교체
3. `system_settings` 에 `minimumWage_2026 = 10320` INSERT (별도 승인)
4. `electronicContracts.ts` 템플릿 본문 생성 분기 (5인미만/5인이상)
5. `schedules.ts:laborCostByCompany` 분기 추가 + leaveRequests 조회 + 최저임금 가드
6. `schedules.ts:workSummaryByEmployee` 동일 변경

### Phase B — 정합성 (세션 2, §12)
7. `drizzle/schema.ts` + `server/index.ts` — `monthly_closings.laborCostAdjustment`, `adjustmentDetails` 자동 마이그레이션
8. `monthlyClosings.ts:confirm` — 보정값 자동 계산·저장
9. `monthlyClosings.ts` 조회 query — 보정값 응답 포함, 미확정 시 실시간 계산
10. `MonthlySettlementPage.tsx` — 보정 부기 표시
11. `AdminDashboard.tsx`, `ManagerDashboard.tsx`, `ProfitPage.tsx` — 합계 보정 후 값 + tooltip detail
12. **정합성 테스트 #13~15 검증** (사양서 §8) — 모든 화면 인건비 값 일치 확인

### Phase C — UI + 명세서 (세션 3)
13. `LaborCostPage.tsx` 배지 + 비용 분해 라인 + 최저임금 보정 표시
14. `StaffPage.tsx` 계약서 미서명/구버전 경고 배너 + 재발급 버튼
15. `payroll_statements` 테이블 신규 + 명세서 발급 라우터/페이지 (화면 표시 우선, PDF는 v1.5)

### Phase D — 소급 단순 재계산 (세션 4, 테스트 기간 단순화)
16. 소급 재계산 배치 스크립트 (`scripts/recalculate-2026-q1.ts`) — master 일회성 실행
    - daily_closings.laborCost: 변경 없음
    - monthly_closings.laborCostAdjustment: 채움
    - 알림·동의 흐름 없음 (테스트 기간, 실 지급 전)
    - dry-run으로 신정책 적용 정확도 검증 후 실행

### 공통
17. 테스트 케이스 15건 전수 검증
18. `pnpm run build` 통과 확인
19. 5항 의무 보고 → push (Phase별로 분리 push 권장)

각 단계 완료 조건: 직전 단계 컴파일 + 동작 검증.

---

## 10. 김정란 4월 검증값

| 항목 | 현재 시스템 | 신정책 적용 후 |
|---|---|---|
| 계약월급 | ₩2,700,000 | ₩2,700,000 |
| 실효월급 | ₩2,816,268 (+4.3%) | ₩2,803,349 (+3.8%) |
| 차이 | — | −₩12,919 (시간→일 단위 정규화) |

차이 ₩12,919는 시급 1시간분. 시간 비례식의 분 단위 정밀 계산이 일 단위 보정으로 정리됨.

---

## 11. 사용자 확인 필요 (구현 진입 전)

1. **2026년 최저임금 시급** — ✓ **확정: 10,320원** (system_settings.minimumWage_2026)
2. **천호점 김정란 + 다른 5인미만+월급제 직원 계약서 상태** — 환산 문구 유무·서명 상태. Code가 prod DB SELECT로 일괄 조회 후 보고 (Phase A 진입 전 검증 대상자 명단 확정)
3. ~~**소급 차액 처리 방침**~~ — ✗ **무효** (테스트 기간, 실 지급 전이라 단순 재계산만)
4. **명세서 발급 형식** — ✓ **확정: 화면 표시 v1, PDF v1.5 분리**

---

## 12. 일마감/월정산 정합성 정책 (v3 신규)

### 발견된 정합성 결함
`dailyClosings.ts:127-148` 에 인건비 자동 계산이 별도 존재. 본 정책 미반영 시 화면별로 다른 값 표시:

| 화면 | 출처 | 신정책 반영 |
|---|---|---|
| LaborCostPage | `laborCostByCompany` 직접 계산 | ✓ |
| MonthlySettlementPage | `dailyClosings` 합계 | ✗ |
| AdminDashboard / ManagerDashboard | `monthlyClosings` 또는 `dailyClosings` 합계 | ✗ |
| ProfitPage | `monthlyClosings` | ✗ |

김정란 4월: LaborCostPage ₩2,803,349 vs 대시보드 ₩2,816,268 → 정합성 깨짐.

### 채택 방식 — C+B 혼합 (옵션 b)
- **일별(daily_closings.laborCost)**: 시간 비례 그대로 유지 (현행 식, 일별 손익 추적 정확도 유지)
- **월별 보정**: `monthly_closings` 에 신규 컬럼 `laborCostAdjustment` 추가
- **표시값**: 모든 월 단위 화면에서 `laborCost + laborCostAdjustment` 합산 표시

### 의사코드

```ts
// server/routers/monthlyClosings.ts (월정산 확정 시)
async function calculateLaborAdjustment(restaurantId, year, month): Promise<number> {
  const sumDaily = await sumDailyLaborCost(restaurantId, year, month);
  const newPolicyTotal = await computeNewPolicyLaborCost(restaurantId, year, month);
  return newPolicyTotal - sumDaily;  // 양/음 모두 가능
}

// 신정책 적용 직원만 보정 대상
async function computeNewPolicyLaborCost(restaurantId, year, month): Promise<number> {
  const employees = await getEligibleEmployees(restaurantId);  // 5인미만+월급제+서명완료
  let total = 0;
  for (const emp of employees) {
    const M = emp.contractMonthly;
    const adjusted = month === 2
      ? M * daysInMonth(year, 2) / 31
      : M + (contractOff - actualOff) * dailyWage(M);
    const sumDailyForThisEmp = sumDailyLaborForEmployee(emp.userId, year, month);
    total += (adjusted - sumDailyForThisEmp);
  }
  return total;
}
```

### 트리거 시점
- **월정산 확정 시** (`monthlyClosings.confirm` 호출 시): 자동 계산 → `laborCostAdjustment` 저장
- **월정산 미확정 상태** (월 진행 중 또는 미확정): adjustment = NULL 또는 실시간 계산 (조회 시점)
  - 권장: 조회 시점 실시간 계산 (캐시 없음, 항상 최신)
  - 단점: 계산 비용 — 매장당 직원 수 적으니 무시 가능

### DB 변경
```sql
ALTER TABLE monthly_closings ADD COLUMN IF NOT EXISTS laborCostAdjustment DECIMAL(12, 2) DEFAULT NULL;
ALTER TABLE monthly_closings ADD COLUMN IF NOT EXISTS adjustmentDetails JSON DEFAULT NULL;
-- adjustmentDetails: [{ userId, name, expected, actual, diff }]
```

### UI 영향
- **MonthlySettlementPage**: 인건비 라인에 보정값 표시 (예: `₩X,XXX,XXX (+₩116,268 5인미만 보정)`)
- **AdminDashboard / ManagerDashboard**: 합계만 보정 후 값으로. 보정 detail은 toolltip 또는 펼침
- **ProfitPage**: 동일 — 인건비율 계산도 보정 후 값 기준
- **LaborCostPage**: 변경 없음 (이미 신정책 직접 계산)

### 정합성 검증
모든 신정책 적용 직원에 대해:
```
LaborCostPage.totalWage(emp) == sumDailyLabor(emp) + laborCostAdjustment_부분(emp)
```
이 등식이 성립해야 한다. 테스트 케이스 §8에 추가 (#13).

### 소급 재계산 영향 (Phase D 단계 [16])
1. 2026.01~04 각 월의 신정책 직원 정산값 계산
2. 해당 월의 `daily_closings.laborCost` 합계와 차이 산출
3. `monthly_closings.laborCostAdjustment` 에 저장
4. 차액 통지·동의 흐름 **없음** (테스트 기간, R-NOTI 단순화)
