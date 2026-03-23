# Restaurant Manager — 업무지침서 (Working Agreement)

## 1. 비즈니스 도메인 정의

**시스템명**: 다매장 식당 관리 시스템 (Restaurant Manager)
**목적**: 자영업 식당의 매출·매입·인건비·수익을 체계적으로 관리하고, 다매장 운영 시 점주(master)가 전체를 통합 조회·제어할 수 있는 SaaS형 내부 시스템.

---

# 이전 작업: 점장 화면 모바일 최적화 + 네비게이션 재구성 ✅ 완료

---

# 현재 작업: 스케줄 시스템 개선 (3건)

## 작업 목적
1. 하루에 1명 1스케줄 제한 (중복 방지)
2. 모바일 친화 스케줄 등록/수정/삭제 UX
3. 상태 흐름 명확화 (고지/확정/완료 의미 재정의)

## 탐색 결과

### 현재 구조 (문제점)
- **서버**: `create`, `quickAssign`, `createTempWorker`, `update`, `copyPreviousWeek` 모두 중복 체크 없음
- **DB**: `(userId, restaurantId, date)` 유니크 제약 없음
- **클라이언트**: 추가 모달이 시간 직접 입력 방식 → 모바일에서 불편
- **삭제**: hover 시 노출 → 터치 환경에서 접근 불가
- **수정**: 수정 기능 자체가 없음 (update mutation은 서버에 존재하지만 UI 미구현)
- **상태 흐름**: 생성 시 바로 `published` → `draft` 상태가 사실상 미사용. `completed`와 `confirmed` 의미가 UI에서 구분 안 됨

### 영향 파일
1. `server/routers/schedules.ts` — 중복 방지 로직, 상태 흐름 수정
2. `client/src/pages/SchedulePage.tsx` — 모바일 UX 전면 재설계
3. `drizzle/schema.ts` — 필요 시 유니크 인덱스 추가 (선택)

---

## Phase 1: 서버 — 중복 방지 + quickAssign 프리셋 정리

- [x] `create`에 중복 체크 추가
  - 조건: 같은 restaurantId + userId + workDate에 기존 스케줄 존재 시 에러
  - 완료 조건: 동일 직원·동일 날짜·동일 매장 재등록 시 "이미 스케줄이 등록되어 있습니다" 에러 반환
- [x]`quickAssign`에 중복 체크 추가
  - 동일 로직 적용
  - 완료 조건: quickAssign으로 동일 조건 재등록 시 에러
- [x]`createTempWorker`에 중복 체크 추가
  - tempWorkerName + restaurantId + workDate 기준 (userId가 null이므로 이름 기반)
  - 완료 조건: 동일 임시직원 이름·날짜 재등록 시 에러
- [x]`update`에 날짜/직원 변경 시 중복 체크
  - workDate 또는 userId 변경 시 새 조합이 기존 스케줄과 충돌하지 않는지 확인
  - 완료 조건: 수정으로 중복 발생 시 에러
- [x]`copyPreviousWeek`에 중복 필터링
  - 이미 존재하는 날짜+직원 조합 건너뛰기
  - 완료 조건: 복사 시 기존 스케줄과 충돌 안 함
- [x]quickAssign 프리셋 명칭 정리
  - 현재: `open`, `fullday`, `close`
  - open = 오픈반차 (openTime ~ midTime)
  - close = 마감반차 (midTime ~ closeTime)
  - fullday = 풀타임 (openTime ~ closeTime)
  - 완료 조건: 프리셋 3종이 매장 openTime/closeTime 기반으로 정확히 계산됨 (이미 구현됨, 확인만)

## Phase 2: 클라이언트 — 모바일 UX 재설계

### 2-1. 빈 셀 탭 → 직원 선택 → 프리셋 선택 (등록)
- [x]기존 Plus 아이콘 버튼 + 시간 입력 모달 제거
- [x]빈 영역 또는 "+" 탭 → 바텀시트 형태 직원 목록 표시
  - 이미 해당 날짜에 스케줄 있는 직원은 비활성화(회색)
  - 완료 조건: 모바일에서 날짜 빈 곳 탭 시 직원 리스트 표시
- [x]직원 선택 후 → 근무 유형 선택 (풀타임 / 오픈반차 / 마감반차)
  - 3개 버튼, 탭하면 즉시 quickAssign 호출
  - 완료 조건: 탭 2번으로 스케줄 등록 완료 (직원 선택 → 유형 선택)

### 2-2. 스케줄 카드 탭 → 수정/삭제 모달
- [x]기존 hover 삭제 버튼 제거
- [x]스케줄 카드 탭 → 작은 모달/바텀시트
  - 표시: 직원명, 근무시간, 상태, 메모
  - 수정: 근무유형 변경 (풀타임↔반차), 시간 직접 수정, 메모 수정
  - 삭제: 하단에 삭제 버튼 (빨간색, 확인 필요)
  - 완료 조건: 모바일에서 카드 탭 → 수정/삭제 가능

### 2-3. 벌크 액션 모바일 최적화
- [x]현재 4개 버튼(복사/고지/완료/확정)이 가로로 나열 → 모바일에서 넘침
  - 더보기(⋯) 메뉴 또는 아코디언으로 변경
  - 완료 조건: 모바일 375px에서 헤더 영역이 넘치지 않음

## Phase 3: 상태 흐름 정리

- [x]상태 정의 명확화
  - `published` (고지): 스케줄 생성 = 즉시 published. 전 직원 스케줄러에 표시
  - `confirmed` (확정): 날짜별 개별 체크. 확정된 스케줄만 추정 인건비에 반영
  - `completed` (완료): 일마감 시 금일 근무자 스케줄 자동 완료 처리
  - `draft` (초안): copyPreviousWeek으로 생성된 스케줄만 draft. "고지" 버튼으로 published 전환
- [x]상태 전이 규칙 수정
  - 현재: draft → published → completed → confirmed
  - 변경: draft → published (고지) → confirmed (확정, 개별) → completed (완료, 일마감 연동)
  - 핵심 변경: confirmed와 completed 순서 변경
  - 완료 조건: 확정(confirmed)이 완료(completed) 앞에 위치
- [x]UI 상태 라벨/색상 정리
  - 초안(draft): 회색, copyPreviousWeek 복사본에만 적용
  - 고지(published): 파란색, 전 직원에게 공개
  - 확정(confirmed): 보라색, 인건비 반영
  - 완료(completed): 초록색, 일마감 확인
  - 완료 조건: STATUS_LABELS 순서·색상이 위와 일치

## Phase 4: 검증

- [x]중복 등록 시도 → 서버 에러 메시지 확인
- [x]모바일(375px)에서 스케줄 등록 플로우 (빈 셀 탭 → 직원 → 유형)
- [x]모바일에서 스케줄 카드 탭 → 수정/삭제 모달
- [x]벌크 액션 모바일에서 정상 표시
- [x]기존 기능 회귀: 주간 복사, 주 이동, 데스크탑 뷰

---

## 리스크
- 상태 순서 변경(confirmed↔completed) 시 기존 데이터와 호환 필요 → 기존 completed 데이터가 있으면 마이그레이션 고려
- quickAssign midTime 계산이 매장 운영시간에 의존 → 운영시간 미설정 시 기본값(09:00~22:00) 사용
- 임시직원 중복 체크가 이름 기반이므로 동명이인 이슈 가능 → 동일 이름 허용 여부 결정 필요

## 검증 방법
- 점장 계정 로그인 → 모바일 뷰포트에서 전체 플로우 확인
- 중복 등록 시도로 서버 에러 확인
- 수정/삭제 모달 동작 확인
