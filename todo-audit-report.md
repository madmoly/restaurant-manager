# Todo 미이행 항목 감사 보고서

> 기준 버전: `a8f5eee1` (2026-03-20)
> 검증 방법: todo.md 전체 미이행(`[ ]`) 항목을 추출하고, 실제 코드(서버/클라이언트/DB)와 대조

---

## 요약

| 분류 | 건수 |
|------|------|
| 실제 필요 (구현 가치 있음) | 10 |
| 이미 구현됨 (완료 표시 누락) | 12 |
| 중복/불필요 (삭제 대상) | 15 |
| 판단 보류 (우선순위 낮음) | 5 |

---

## A. 이미 구현됨 — `[x]`로 변경해야 할 항목

아래 항목들은 코드에 이미 반영되어 있으나 todo.md에서 `[ ]`로 남아 있음.

| # | 위치 (라인) | 항목 | 근거 |
|---|------------|------|------|
| 1 | L507 | effectiveStoreRole 계산 | `shared/permissions.ts`에 `getEffectiveRole` 구현, AppLayout/App.tsx에서 사용 중 |
| 2 | L508 | AppLayout 메뉴 노출: leader/manager → 운영 메뉴 | `AppLayout.tsx` L191에서 `effectiveRole` 기반 메뉴 필터링 구현됨 |
| 3 | L527 | 직원 관리 화면에 역할 컬럼 + 역할 변경 드롭다운 | StaffPage에 승격/강등 버튼 이미 구현 |
| 4 | L528 | 휴무일 설정 UI (날짜 추가/삭제 + 정기 휴무 요일) | RestaurantsManagement.tsx 5번째 탭에 이관 완료, 정기 요일은 API만 존재 |
| 5 | L771 | assertRestaurantAccess 헬퍼 함수 추가 | `server/routers.ts` L84에 구현됨 |
| 6 | L772-778 | restaurants.get/getStaff/sales.listByMonth/purchases.listByMonth/profitability/dailyClosings 소속 검증 | 모두 `assertRestaurantAccess` 호출 확인됨 |
| 7 | L781-787 | App.tsx/AppLayout/DailyOpsPage/SalesPage/PurchasesPage/SchedulePage/ProfitabilityPage getEffectiveRole 통일 | 모두 `getEffectiveRole` 또는 `isManagerLevel` 사용 확인 |
| 8 | L796-799 | MonthNavigator 공통 컴포넌트 생성 및 SalesPage/PurchasesPage/ProfitabilityPage 적용 | `MonthNavigator.tsx` 존재, 3개 페이지 모두 import 확인 |
| 9 | L802-804 | ManagerDashboard/ProfitabilityPage 라벨 명확화 | "마감 확정 전 추정값", "매입(실제 합산)" 라벨 확인 |
| 10 | L816 | DailyOpsPage 사이드바 복원 | L825에서 `[x]`로 완료 표시됨, 중복 항목 |
| 11 | L819-820 | 매장 계약조건 통합 + 사이드바 메뉴 제거 | L826-827에서 `[x]`로 완료 표시됨, 중복 항목 |
| 12 | L1009-1010 | 매장 카드 전체 클릭 + 사이드바 레이블 분기 | 코드에 `cursor-pointer onClick` 및 `내 매장 관리` 분기 확인됨 |

---

## B. 중복/불필요 — 삭제 대상

| # | 위치 (라인) | 항목 | 사유 |
|---|------------|------|------|
| 1 | L153 | 월별 정산 리포트 PDF 다운로드 | L864-866에서 `[x]` 완료. 향후 계획 섹션에 잔존하는 중복 |
| 2 | L154 | 매입 영수증 이미지 S3 업로드 완성 | L893-899에서 `[x]` 완료. 중복 |
| 3 | L155 | 목표 매출 달성률 자동 알림 | 매장 카드에 달성률 바 이미 표시. 자동 알림은 현재 운영 규모상 과잉 기능 |
| 4 | L156 | 계약 조건 유효기간 만료 알림 | L217에서 D-90/D-30 알림 스케줄러 `[x]` 완료. 중복 |
| 5 | L157 | 고정비 월별 추이 차트 | ProfitabilityPage 연간 월별 추이 차트에서 이미 고정비 포함. 별도 차트 불필요 |
| 6 | L158 | 매장별 계약 조건 비교 뷰 | 현재 매장 1개 운영 기준. 다중 매장 확장 시 재검토 |
| 7 | L159 | 직원 근태 통계 페이지 | 스케줄 기반 출근 데이터만 존재, 실제 근태(지각/조퇴) 데이터 수집 체계 없음. 구현 전제 부족 |
| 8 | L163 | routers.ts 분리 | 이미 `electronicContracts`가 분리됨. 나머지는 현재 단일 파일로 관리 가능한 수준 |
| 9 | L164 | E2E 테스트 추가 | 현재 단계에서 ROI 낮음. Vitest 단위 테스트로 충분 |
| 10 | L501 | schedules.getTomorrowCheck API | ManagerDashboard에 내일 스케줄 점검 카드 이미 구현 (별도 API 불필요, 기존 쿼리로 처리) |
| 11 | L502 | schedules.updateConfirmedSchedule API | schedules.update에서 confirmed 상태 수정 이미 가능 |
| 12 | L503 | 스케줄 저장 검증: 중복 시간, 종료<시작 | 현재 프리셋 기반 입력으로 시간 충돌 가능성 낮음 |
| 13 | L504 | 매출/매입 API에 휴무일 검증 추가 | L566-570에서 `[x]` 완료. 중복 |
| 14 | L509 | 인건비 상세: leader만 금액 노출, manager는 비율만 | L556-558, L592-593에서 `[x]` 완료. 중복 |
| 15 | L677-684 | 일일 운영 탭 재편 (미완료 버전) | L687-691에서 동일 항목 `[x]` 완료. 중복 (같은 요청이 두 번 기록됨) |

---

## C. 실제 필요 — 구현 가치 있는 항목

| # | 위치 (라인) | 항목 | 필요 사유 | 우선순위 |
|---|------------|------|----------|---------|
| 1 | L254 | 전자서명 완료 시 계약정보 자동 저장 | sign 프로시저에서 서명만 처리, 직원 계약정보(급여/계약기간) DB 자동 반영 없음. 수동 입력 필요한 상태 | 높음 |
| 2 | L227 | 서명 완료 즉시 점장 알림 (앱 내 알림) | 현재 `notifyOwner`만 호출 (마스터에게만 감). 점장 앱 내 알림은 미구현 | 보통 |
| 3 | L228 | 계약 갱신 원클릭 재발송 | L870에서 `[x]` 표시되었으나 실제 renew API 동작 재검증 필요 | 낮음 |
| 4 | L229 | 직원별 계약 이력 페이지 | L871에서 `[x]` 표시됨. 실제 구현 상태 재검증 필요 | 낮음 |
| 5 | L790-793 | UX-서버 권한 불일치 제거 (버튼 숨김) | DailyOpsPage 일마감 탭이 직원에게도 노출됨. 서버에서 거부하지만 UI에서 혼란 유발 | 보통 |
| 6 | L808 | KST 날짜 잔존 코드 제거 (서버) | `server/routers.ts` L890, L2598에 `toISOString().split("T")[0]` 2건 잔존 | 낮음 |
| 7 | L811-813 | 다른 매장 데이터 접근 차단 테스트 / 권한 분기 테스트 | assertRestaurantAccess 구현됨, 테스트 커버리지 보강 필요 | 보통 |
| 8 | L1011 | 휴무일 탭 정기 휴무 설정 UI | API(getWeekly/setWeekly) 존재하나 UI 미구현. 현재 정기 휴무 요일 설정 불가 | 높음 |
| 9 | L512 | scheduled/completed/confirmed/canceled 상태 배지/색상 | 이미 구현됨으로 보이나 `셀 클릭 시 프리셋 선택`은 미구현 | 낮음 |
| 10 | L854 | EmployeeDashboard: 내 스케줄 + 변경 요청 목록 | L859-861에서 `[x]` 완료. 중복 확인 필요 | - |

---

## D. 판단 보류 — 우선순위 낮음

| # | 위치 (라인) | 항목 | 비고 |
|---|------------|------|------|
| 1 | L514 | 셀 클릭 시 오픈/종일/마감/직접입력 프리셋 선택 | 현재 다이얼로그 방식으로 동작. 프리셋 UX 개선은 선택적 |
| 2 | L515 | shiftPreset 필드 저장 | DB 컬럼 존재하나 프론트에서 미활용. 프리셋 UI와 함께 구현 시 의미 |
| 3 | L516 | 범위 완료/확정 처리 UI | confirmRange API 존재, UI에서 부분적 구현. 완성도 검증 필요 |
| 4 | L517 | confirmed 상태 수정 시 editReason 입력 | 현재 스케줄 수정 시 별도 사유 입력 없음. 운영 필요성 판단 필요 |
| 5 | L803 | EmployeeDashboard 라벨 명확화 | 직원 대시보드는 매출/비용 수치 노출 제한적. 라벨 변경 영향 미미 |

---

## 권장 조치

1. **즉시 처리**: A 섹션 12건을 `[x]`로 변경, B 섹션 15건을 삭제 또는 취소선 처리
2. **다음 작업**: C 섹션에서 높음 우선순위 2건 (전자서명→계약정보 자동 저장, 정기 휴무 UI) 구현
3. **보류**: D 섹션은 운영 피드백 후 재평가
