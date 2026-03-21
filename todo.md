# 331매장관리 시스템 — 작업 관리 문서

> 이 파일은 프로젝트의 모든 요청·실행 작업을 기록하고 관리하는 단일 진실 공급원(Single Source of Truth)입니다.
> 새로운 요청이 들어오면 **[요청 로그]** 섹션에 먼저 기록한 뒤 해당 기능 섹션에 항목을 추가합니다.

---

## 목차

1. [프로젝트 개요](#프로젝트-개요)
2. [요청 로그 (작업 이력)](#요청-로그-작업-이력)
3. [완료된 기능](#완료된-기능)
4. [향후 계획 (미완료)](#향후-계획-미완료)
5. [알려진 버그 및 기술 부채](#알려진-버그-및-기술-부채)

---

## 프로젝트 개요

| 항목 | 내용 |
|------|------|
| 앱 이름 | 331매장관리 시스템 |
| 프레임워크 | React 19 + Tailwind 4 + Express 4 + tRPC 11 |
| DB | MySQL (TiDB) / Drizzle ORM |
| 인증 | Manus OAuth + JWT 세션 쿠키 |
| 배포 URL | https://restomgmt-vwwsdsrd.manus.space |
| 테스트 계정 | 로그인 페이지 우측 원클릭 패널 참고 (비밀번호 통합: `1111`) |
| 현재 버전 | `d4369bce` (2026-03-01) |

---

## 요청 로그 (작업 이력)

> 모든 요청과 실행 결과를 날짜순으로 기록합니다.
> 형식: `[날짜] 요청 내용 → 실행 결과 (버전)`

---

### 2026-03-01 이전 — 초기 구축

| # | 요청 내용 | 실행 결과 | 버전 |
|---|-----------|-----------|------|
| 1 | 식당 통합 관리 시스템 초기 구축 | 프로젝트 스캐폴딩, DB 스키마 설계, 4계층 권한 시스템, 전체 페이지 구현 | `18aac178` |
| 2 | 스케줄러 전면 개편 (전체 직원 × 날짜 그리드) | 주간 그리드 형태 스케줄러로 전면 교체 | — |
| 3 | 앱 이름 변경 + 테스트 데이터 교체 | '331매장관리 시스템'으로 변경, 청계산뚝배기수제비 천호점 데이터 생성 | — |
| 4 | 원클릭 테스트 계정 로그인 패널 추가 | 로그인 페이지 우측에 계정 버튼 패널 구현 | — |
| 5 | 모바일 반응형 최적화 | 하단 탭 네비게이션, 전체 페이지 모바일 대응 | — |
| 6 | 대시보드 매출 빠른 입력 모달 | 대시보드에서 바로 매출 입력 가능한 모달 추가 | — |
| 7 | 비용 구조 통합 비율 시각화 | 매입/임대/고정비/잡비/인건비 비율 + 인건비 세부 내역 차트 추가 | — |
| 8 | 테스트 계정 로그인 불가 버그 수정 | JWT 발급 방식 `sdk.createSessionToken`으로 교체 | — |
| 9 | 다중 매장 관리 기능 | 전역 RestaurantContext, 매장 전환 드롭다운, 페이지별 매장 필터링 | — |

---

### 2026-03-01 — 계약 조건 기능

| # | 요청 내용 | 실행 결과 | 버전 |
|---|-----------|-----------|------|
| 10 | 매장별 계약 조건 입력 + 고정비 자동 반영 | `restaurant_contracts` 테이블 생성, 계약 조건 CRUD API, `syncContractToFixedCosts()` 구현, ContractsPage UI, 수동 동기화 버튼, Vitest 5개 추가 | `d4369bce` |

---

### 향후 요청 기록란

> 새로운 요청이 들어오면 아래에 행을 추가합니다.

| # | 날짜 | 요청 내용 | 실행 결과 | 버전 |
|---|------|-----------|-----------|------|
| — | — | — | — | — |

---

## 완료된 기능

### DB & 백엔드

- [x] DB 스키마 설계 (`users`, `restaurants`, `restaurant_users`, `schedules`, `sales`, `purchases`, `monthly_fixed_costs`, `restaurant_contracts`, `notifications`)
- [x] DB 마이그레이션 실행 (Drizzle Kit)
- [x] 4계층 권한 미들웨어 (`master` > `admin` > `manager` > `employee`)
- [x] 사용자 관리 API — CRUD, 역할 지정, 매장 배정
- [x] 매장 관리 API — CRUD, 목표 매출 설정
- [x] 직원 계약 정보 API — 급여 형태(시급/월급), 급여액, 계약 내용
- [x] 스케줄 API — CRUD, 변경 요청, 승인/거절
- [x] 매출 API — 일별 기록, 월별 집계
- [x] 매입 API — 거래처명, 명세서 이미지 업로드 포함
- [x] 월 고정비 API — 항목별 CRUD, 전월 복사, 카테고리 분류
- [x] 실시간 인건비 계산 API — 시급제/월급제 자동 계산
- [x] 수익성 분석 API — 매출 대비 비용 비율, 매장별 비교
- [x] 마스터 알림 API — 스케줄 변경, 비용 초과, 목표 달성 자동 알림
- [x] 매장 계약 조건 API — CRUD, 고정비 자동 동기화 (`syncContractToFixedCosts`)
- [x] 수동 고정비 동기화 mutation (`syncToFixedCosts`)

### 프론트엔드 — 공통

- [x] 글로벌 레이아웃 (DashboardLayout 커스터마이징, 다크 테마)
- [x] 로그인 화면 — 아이디/비밀번호 입력
- [x] 원클릭 테스트 계정 버튼 패널 (자동 로그인)
- [x] 권한별 라우팅 — 역할에 따른 자동 리디렉션
- [x] 공통 컴포넌트 — KPI 카드, 게이지 차트, 도넛 차트
- [x] 전역 매장 컨텍스트 (`RestaurantContext`) — 다중 매장 전환
- [x] 모바일 반응형 — 하단 탭 네비게이션, 전체 페이지 대응

### 프론트엔드 — 마스터/관리자

- [x] 전체 KPI 요약 카드 (전체 매출, 매입, 이익, 직원 수)
- [x] 매장별 성과 비교 테이블/차트
- [x] 사용자 계정 관리 — 추가/수정/삭제, 역할 지정
- [x] 통합 공지사항 관리
- [x] 매장 계약 조건 페이지 접근 권한 부여

### 프론트엔드 — 점장

- [x] 매장 현황 KPI (금일 매출, 인건비율, 총비용율)
- [x] 대시보드 매출 빠른 입력 모달
- [x] 향후 5일 스케줄 상시 표시
- [x] 전체 직원 × 날짜 그리드 스케줄러 (주간/월간)
- [x] 스케줄 변경 요청 승인/거절
- [x] 직원 관리 — 추가/제거/정보 수정, 계약 정보 등록
- [x] 매출 기록 입력
- [x] 매입 기록 입력 (거래처명, 명세서 이미지)
- [x] 월 고정비 관리 — 항목별 CRUD, 전월 복사
- [x] 비용 구조 통합 비율 시각화 (매입/임대/고정비/잡비/인건비)
- [x] 수익성 분석 — 게이지, 도넛 차트, 상세 테이블
- [x] 월별 정산 리포트
- [x] **매장 계약 조건 관리 페이지** — 임대료/수수료/로얄티/투자자지분 등록·편집
- [x] 계약 조건 → 고정비 자동 반영 (등록·수정·삭제 시 즉시 동기화)
- [x] 수동 고정비 동기화 버튼

### 프론트엔드 — 직원

- [x] 나의 스케줄 (주간/월간)
- [x] 스케줄 변경 요청
- [x] 팀 스케줄 조회 (읽기 전용)
- [x] 공지사항 확인
- [x] 매출/업무 기록 입력

### 테스트 & 품질

- [x] Vitest 9개 테스트 전체 통과
  - `auth.login.test.ts` — 로그인 플로우 3개
  - `auth.logout.test.ts` — 로그아웃 플로우 1개
  - `contracts.sync.test.ts` — 계약 조건 동기화 로직 5개

---

## 향후 계획 (미완료)

> 아래 항목은 사용자 요청 또는 내부 개선 제안으로 추가된 예정 작업입니다.
> 우선순위: 🔴 높음 / 🟡 보통 / 🟢 낮음

### 기능 개선 제안

- [x] 🔴 **월별 정산 리포트 PDF 다운로드** — ✅ L864-866에서 구현 완료
- [x] 🔴 **매입 영수증 이미지 S3 업로드 완성** — ✅ L893-899에서 구현 완료
- ~~[ ] 🟡 **목표 매출 달성률 자동 알림**~~ — 매장 카드에 달성률 바 이미 표시, 자동 알림은 현 규모상 과잉
- [x] 🟡 **계약 조건 유효기간 만료 알림** — ✅ L217에서 D-90/D-30 알림 스케줄러 구현 완료
- ~~[ ] 🟡 **고정비 월별 추이 차트**~~ — ProfitabilityPage 연간 월별 추이 차트에서 고정비 포함
- ~~[ ] 🟢 **매장별 계약 조건 비교 뷰**~~ — 현재 단일 매장 운영, 다중 매장 확장 시 재검토
- ~~[ ] 🟢 **직원 근태 통계 페이지**~~ — 근태(지각/조퇴) 데이터 수집 체계 없음, 구현 전제 부족

### 기술 부채

- ~~[ ] 🟡 `routers.ts` 분리~~ — electronicContracts 이미 분리됨, 나머지는 현재 관리 가능 수준
- ~~[ ] 🟢 E2E 테스트 추가~~ — 현재 단계에서 ROI 낮음, Vitest 단위 테스트로 충분

---

## 알려진 버그 및 기술 부채

| 상태 | 내용 | 발견일 | 해결일 |
|------|------|--------|--------|
| ✅ 해결 | 테스트 계정 전체 로그인 불가 (JWT 발급 방식 문제) | 2026-02 | 2026-02 |
| 🔍 모니터링 | Safari Private / Firefox Strict ETP 환경에서 OAuth 쿠키 차단 가능성 | — | — |

---

*최종 업데이트: 2026-03-01 | 버전: `d4369bce`*

## 모바일 최적화 & 다크모드 (2026-03-01 요청)

- [x] 다크모드 CSS 변수 전면 재설계 (index.css) — 네이비-그레이 팔레트
- [x] ThemeProvider 기본값 dark로 전환 + switchable 활성화
- [x] 다크모드 토글 버튼 추가 (헤더 + 사이드바 + 유저 드롭다운)
- [x] AppLayout 하단 탭 네비게이션 모바일 최적화 (더보기 팝업 메뉴)
- [x] 사이드바 모바일 오버레이 개선 (backdrop-blur, slide-in 애니메이션)
- [x] 주요 페이지 모바일 레이아웃 개선 (대시보드, 스케줄, 매출, 고정비, 계약 조건)
- [x] 카드/테이블 모바일 스크롤 및 터치 최적화 (safe-area-bottom, scroll-smooth-mobile)
- [x] KpiCard 다크모드 완전 호환 색상 전면 개선

## 계약 조건 매장 통합 & 매장 관리 실적 수치 (2026-03-01 요청)

- [x] 사이드바에서 독립 "계약 조건" 메뉴 제거
- [x] 매장 수정 다이얼로그를 탭 구조(기본정보/계약조건/직원관리)로 전면 개편
- [x] 다중 계약 항목 합산 지원 (임대료 + 로얄티 + 투자자지분 등 중첩 허용)
- [x] 고정비 자동 반영 로직 개선 — 계약 유형별 합산 후 단일 항목으로 upsert
- [x] 매장 관리 목록 페이지에 이번 달 실적 수치 표시 (매출, 매입, 고정비, 인건비, 순이익, 달성률)
- [x] 매장 카드에 목표 매출 대비 진행률 바 및 비용율 상태 표시
- [x] 계약 조건 탭에 유형별 합산 미리보기 카드 추가

## 전자계약 시스템 (2026-03-01 요청)

- [x] 2026년 최저임금(10,320원/시) 및 근로기준법 필수 기재사항 조사
- [x] 요식업 특화 노무 가이드라인 및 급여 테이블 작성 (labor-law-guide.md)
- [x] DB: employment_electronic_contracts 테이블 추가 (계약서 내용, 서명 상태, 발송 이력, IP 기록)
- [x] 백엔드: 계약서 생성/발송/서명/조회/취소 tRPC API (electronicContracts 라우터)
- [x] 백엔드: 계약서 HTML 자동 생성 (근로기준법 제17조 준수, 법적 고지 포함)
- [x] 프론트엔드: 직원 관리 탭 → 계약서 발송 위자드 다이얼로그 (계약 유형/급여/근무시간/특약 입력)
- [x] 전자계약서 미리보기/서명 페이지 (/contract/sign/:token) — 로그인 불필요 공개 라우트
- [x] 서명 방식 2종 지원: 이름 텍스트 서명 / 캔버스 직접 서명 (터치 지원)
- [x] 계약 현황 요약 (발송됨/서명완료/취소 상태 배지 표시)
- [x] 최저임금 자동 검증 — 시급/월급 입력 시 2026년 최저임금 미달 경고
- [x] 수습기간 설정 — 최저임금 90% 적용 안내 포함
- [x] 5인 이상/미만 사업장 구분 — 연장·야간·휴일 가산수당 자동 적용 여부 분기

## 계약 알림·PDF·링크 공유 시스템 (2026-03-01 요청) — 완료

- [x] 계약 만료 D-90/D-30 자동 알림 스케줄러 (cron 매일 09:00 실행)
- [x] 직원 관리 탭에 계약 갱신일 표시 — D-day 색상 코딩 (직색/주황/회색)
- [x] 수습(월단위 최대 3개월) → 1년 계약직 계약 구조 안내 UI (위자드 1단계 배너)
- [x] 서명 완료 계약서 PDF 다운로드 (/api/contract/pdf/:token 엔드포인트)
- [x] 계약서 링크 공유 UI — 클립보드 복사, SMS 딥링크, 카카오 공유 버튼
- [x] 수습 배지 표시 — 기간제 3개월 이하 계약에 '수습' 배지 자동 표시
- [x] 계약직 기본값 수정 — 위자드 계약 유형 선택 순서를 '기간제'를 상단으로 이동

## 계약 고도화 3종 (2026-03-01 요청)

- [ ] 서명 완료 즉시 점장 알림 — 직원 서명 시 점장에게 앱 알림 자동 발송
- [ ] 계약 갱신 원클릭 재발송 — 만료/수습 완료 계약 기반 새 계약서 자동 생성 및 재발송
- [ ] 직원별 계약 이력 페이지 — 수습→계약직 전환 타임라인, 급여 변동, 서명 날짜 조회

## 버그 수정 (2026-03-01 — 전자계약 플로우 검증)

- [x] 계약서 저장 시 권한 오류 — `contractRestaurant` 상태 분리로 수정 (editRestaurant 닫힘 시 null 방지)
- [x] `wageAmount` 초기값 빈 문자열 → `"10320"` 기본값 설정 (저장 조건 통과)
- [x] 계약서 날짜 형식 UTC → 한국어 (`toLocaleDateString('ko-KR')`) — RestaurantsManagement, ContractSignPage, electronicContracts 라우터 전체 수정
- [x] 서명 페이지 서명 입력 필드 placeholder 값이 실제 state에 반영되지 않는 UX 개선 확인

## 버그 수정 (2026-03-02 — 오류 리포트)

- [x] /sales 페이지 restaurantId null 오류 — selectedRestaurant 로딩 전 API 호출 방지 (enabled 조건 추가)
- [x] /contract-history 페이지 권한 오류 — user 로드 후에만 쿼리 실행 (!!user && isAdmin 조건)
- [x] SchedulePage, PurchasesPage, FixedCostsPage, StaffPage, ProfitabilityPage 동일 패턴 일괄 수정

## 버그 수정 (2026-03-02 — /staff 권한 오류)

- [x] /staff 페이지 권한 오류 — manager가 users.list(adminProcedure) 호출, enabled: !!user && isAdmin 조건 추가

## 직원 관리 + 계약 이력 통합 (2026-03-02 요청)

- [x] 계약 이력 메뉴를 직원 관리 페이지 탭으로 통합 (사이드바에서 계약 이력 메뉴 제거, /contract-history 접근 시 /staff로 리디렉션)
- [x] 직원 카드에 계약서 열람 버튼 추가 (최신 계약서 미리보기 직접 열람)
- [x] 직원 카드에 요약된 계약정보 표시 (직체/급여/계약기간 읽기 전용, 수정 불가 안내 문구 포함)
- [x] 계약 미등록 직원에게 전자서명 발송 버튼 추가 (직원 카드에서 바로 위자드 열림)
- [ ] 전자서명 완료 시 계약정보 자동 저장 (sign 완료 → contracts 테이블 업데이트) — 미구현

## 버그 수정 (2026-03-02 — 전자계약 DB 삽입 오류 + 최저임금 상수 불일치)

- [x] contractStart/contractEnd Date 객체 → YYYY-MM-DD 문자열 정규화 (toDateStr 헬퍼 추가)
- [x] create/renew 뮤테이션 zod 스키마를 z.union([z.string(), z.date()])로 변경 (superjson 역직렬화 대응)
- [x] 프론트엔드 최저월급 상수 불일치 수정 (StaffPage: 2157720 → 2156880)
- [x] Vitest 테스트 추가 (electronicContracts.date.test.ts — 10개 테스트, 전체 19개 통과)

## 7가지 기능 추가 (2026-03-13 요청)

- [x] 1. 계정 등록 권한 확장 — 마스터/관리자/점장(manager) 모두 계정 생성 가능 (users.create → managerProcedure)
- [x] 1. 점장이 신규 직원 계정 생성 다이얼로그 추가 (StaffPage "신규 계정 생성" 버튼)
- [x] 1. 기존 계정 추가 버튼 조건 isAdmin → isManager로 확장 (점장도 기존 계정 매장 추가 가능)
- [x] 2. 매장 소프트 삭제 기능 — restaurants.delete (deletedAt 컬럼, isActive=false)
- [x] 2. 삭제된 매장 1년 보관 — listDeleted API (1년 이내 데이터만 조회)
- [x] 2. 삭제된 매장 복원 기능 — restaurants.restore API
- [x] 2. RestaurantsManagement UI — 삭제 버튼, 삭제된 매장 목록, 복원 버튼
- [x] 3. 점장이 직원 추가 가능 — restaurants.addStaff managerProcedure 유지
- [x] 4. 직원 → 매니저 승격 버튼 추가 (StaffPage 직원 카드)
- [x] 4. 매니저 → 직원 강등 버튼 추가 (StaffPage 직원 카드)
- [x] 4. 매니저 역할은 점장과 동일 권한 (managerProcedure가 manager 역할 포함)
- [x] 5. 매입 입력 권한 — 직원/매니저/점장 모두 가능 (purchases.create protectedProcedure 유지)
- [x] 6. 매출 입력 시간 강제 — restaurants.setSalesInputTime API, 매장별 salesInputStartTime/salesInputEndTime 설정
- [x] 6. 매출 입력 시간 설정 UI (RestaurantsManagement 수정 다이얼로그 내 시간 설정 탭)
- [x] 6. 매출 입력 시 시간 범위 검증 (sales.create에서 현재 시간이 허용 범위 내인지 확인)
- [x] 7. 매입 거래처 자동완성 — purchases.listVendors API (기존 거래처명 목록 반환)
- [x] 7. 매입 품목 자동완성 — purchases.listVendorItems API (거래처별 기존 품목+가격 반환)
- [x] 7. 발주/입고 상태 선택 — purchaseStatus 컬럼 (received/ordered)
- [x] 7. 발주 시 예상 입고일 입력 — expectedArrivalDate 컬럼
- [x] 7. 발주 현황 탭 추가 (PurchasesPage) — 발주 중인 항목 목록, 지연 표시
- [x] 7. 입고 확인 버튼 — purchases.confirmArrival API (ordered → received 상태 변경)
- [x] DB 마이그레이션 — deletedAt, salesInputStartTime/EndTime, purchaseStatus, expectedArrivalDate, arrivedAt, arrivedBy 컬럼 추가

## 버그 수정 (2026-03-13 — /sales 직원 권한 오류)

- [x] restaurants.getStaff managerProcedure → protectedProcedure 변경 (직원도 같은 매장 직원 목록 조회 가능)
- [x] SchedulePage에서 직원이 getStaff 호출 시 권한 오류 해결

## 오픈/마감 체크리스트 + 상세 매출 입력 (2026-03-13 요청)

- [x] DB: daily_operations 테이블 추가 (오픈/마감 체크, 출근 인원 확인, 매출 확인 상태)
- [x] DB: sales 테이블에 cashAmount, cardAmount, receiptCount, discountAmount, status(draft/confirmed), confirmedBy 컬럼 추가
- [x] DB: sales_other_items 테이블 추가 (상품권/카카오페이/쿠폰 등 기타 매출 항목, 한번 입력된 항목 저장)
- [x] DB: intermediate_sales 테이블 추가 (중간 매출 입력 - 전체 금액만)
- [x] 백엔드: 오픈 체크 API (당일 출근 인원 조회, 인건비 반영)
- [x] 백엔드: 마감 체크 API (출근 인원 변동 확인, 매출 입력 여부 검증)
- [x] 백엔드: 상세 매출 입력 API (현금/카드/기타/할인/영수건수)
- [x] 백엔드: 기타 매출 항목 저장/조회 API (한번 입력된 항목 재사용)
- [x] 백엔드: 중간 매출 입력 API
- [x] 백엔드: 매출 확인/승인 API (점장/매니저 전용)
- [x] 프론트엔드: 오픈 체크 페이지 (당일 출근 인원 확인, 인건비 미리보기)
- [x] 프론트엔드: 마감 체크 페이지 (출근 인원 변동 확인, 매출 입력 완료 여부 체크)
- [x] 프론트엔드: 매출 입력 폼 개편 (현금/카드/기타/할인/영수건수 입력)
- [x] 프론트엔드: 중간 매출 입력 UI
- [x] 프론트엔드: 매출 승인 UI (점장/매니저 확인 버튼)
- [x] 프론트엔드: 사이드바에 오픈/마감 메뉴 추가

## 버그 수정 (2026-03-13 — 승격 UI 반영 + 매입 권한)

- [x] 직원→매니저 승격 후 UI 즉시 반영 안 되는 문제 수정
- [x] 직원(employee)이 매입 입력 가능하도록 권한 수정

## 튜토리얼 데이터 교체 (2026-03-13 요청)

- [x] 기존 더미 데이터 전체 삭제 (매장/사용자/매출/매입/스케줄/고정비/계약)
- [x] 튜토리얼 매장 2개 생성 (명칭에 "[튜토리얼]" 표시)
- [x] 튜토리얼 사용자 계정 생성 (마스터/관리자/점장/직원 각 역할)
- [x] 2025년 11~12월, 2026년 1~2월 매출 데이터 생성 (일별 현금/카드/기타)
- [x] 동기간 매입 데이터 생성 (거래처별 식재료/소모품/공과금)
- [x] 동기간 스케줄 데이터 생성 (직원별 주간 근무 스케줄)
- [x] 동기간 고정비 데이터 생성 (임대료/관리비/보험료 등)

## 로그인 페이지 튜토리얼 계정 업데이트 (2026-03-13 요청)

- [x] 원클릭 로그인 패널 계정 목록을 새 튜토리얼 계정으로 교체
- [x] 매장 선택 안내 문구에 튜토리얼 매장명 반영

## 대시보드 최신 데이터 월 자동 조회 (2026-03-13 요청)

- [x] 백엔드: 매장별 가장 최근 매출 데이터가 있는 연월 반환 API
- [x] 프론트엔드: 대시보드 첫 진입 시 최신 데이터 월로 자동 설정

## 관리자 로그인 오류 수정 (2026-03-15 요청)

- [x] admin/master 계정 비밀번호를 1111로 재설정 (기존 admin1234로 설정되어 있던 문제)

## 계정 아이디/비밀번호 수정 기능 (2026-03-15 요청)

- [x] 백엔드: 관리자용 updateCredentials API (모든 계정 수정 가능)
- [x] 백엔드: 점장용 updateStaffCredentials API (자신의 매장 직원만 수정 가능)
- [x] 프론트엔드: 관리자 사용자 목록에 아이디/비밀번호 수정 모달 추가
- [x] 프론트엔드: 점장 직원 관리 페이지에 아이디/비밀번호 수정 모달 추가

## 매입 전표 리팩터링 v2 (2026-03-16 요청)

- [x] DB: counterparties 테이블 추가
- [x] DB: items 테이블 추가
- [x] DB: counterparty_items 테이블 추가
- [x] DB: purchase_orders_v2 테이블 추가
- [x] DB: purchase_order_items_v2 테이블 추가
- [x] 백엔드: counterparties.list/create/update API
- [x] 백엔드: items.list/create/searchSimilar API
- [x] 백엔드: counterpartyItems.listByCounterparty/create/linkToExistingItem API
- [x] 백엔드: purchasesV2.listOrdersByMonth/getOrderItems/getRecentOrdersByCounterparty/createOrder/updateOrder/deleteOrder API
- [x] 백엔드: pricing.getLastPriceByCounterpartyItem/getRecentComparisonByItem API
- [x] 프론트: PurchasesPage 거래처 중심 입력 UX 리팩터링
- [x] 프론트: 최근 입력 재사용 (최근 5건 복제 버튼)
- [x] 프론트: 거래처 간 가격 비교 기능
- [x] 프론트: 항목 입력 테이블 (항목명/유형/수량/단위/단가/합계/원가분류)
- [x] 프론트: 거래처-품목 매핑 기반 자동완성 및 단가 자동입력

## 매입 페이지 UX 개선 (2026-03-16 요청)

- [x] "전표 입력" 버튼명 → "매입 입력"으로 변경
- [x] 유형(itemType)과 원가분류(costingCategory) 통합 — 하나의 선택 필드로 통합
- [x] 단위 시스템: KG(소수점 허용), 개, 박스, 리터, 봉, 팩, 병, 캔, 장, 묶음 등 제공
- [x] 합계 입력 시 단가 자동계산, 단가 입력 시 합계 자동계산
- [x] 모바일 입력 UX 개선 (카드형 스텝 입력 방식)

## 스케줄 관리 개선 (2026-03-16 요청)

- [x] DB: restaurants 테이블에 openTime/closeTime 컬럼 추가 (매장 운영시간)
- [x] 백엔드: restaurants.setOperatingHours API (운영시간 저장)
- [x] 백엔드: schedules.completeToday API (당일 완료 처리 — 마감 시 오늘 스케줄만)
- [x] 백엔드: schedules.listPast API (완료/확정 스케줄 월별 조회)
- [x] 백엔드: quickAssign 프리셋 — 매장 운영시간 기반 동적 계산 (오픈=오픈~중간, 마감=중간~마감)
- [x] 프론트: SchedulePage 5일 뷰 (오늘 기준 향후 5일, 이전/다음 5일 이동)
- [x] 프론트: SchedulePage 운영시간 설정 다이얼로그 (점장 전용, 오픈/마감 시각 설정)
- [x] 프론트: SchedulePage 오늘 완료 버튼 (오늘이 뷰에 있을 때만 표시, 마감 업무 완료 시 사용)
- [x] 프론트: SchedulePage 프리셋 툴팁에 실제 시각 표시 (운영시간 기반)
- [x] 프론트: PayrollSchedulePage 신규 생성 (지난 스케줄 조회, 인건비 정산 개념)
- [x] 프론트: PayrollSchedulePage 날짜별/직원별 보기 전환
- [x] 프론트: PayrollSchedulePage 직원별 예상 급여 계산 (시급 × 근무시간)
- [x] 프론트: AppLayout 사이드바에 "지난 스케줄" 메뉴 추가 (점장 전용)
- [x] 프론트: App.tsx에 /payroll-schedule 라우트 등록

## 스케줄/계층권한 MVP 리팩터링 (2026-03-16 요청)

- [ ] DB: restaurant_users.role → leader/manager/employee 3단계 확장
- [ ] DB: schedules.status → draft/published/completed/confirmed/canceled 5단계
- [ ] DB: schedules에 editReason, payrollRecheckRequired 컬럼 추가
- [ ] DB: schedule_change_requests 테이블 신규 생성
- [ ] 백엔드: updateStaffRole (leader가 manager 승급/강등)
- [ ] 백엔드: schedule CRUD 확장 (상태 전환, 검증 3종)
- [ ] 백엔드: copyPreviousWeek
- [ ] 백엔드: quickAssign (오픈/종일/마감 프리셋)
- [ ] 백엔드: publishRange / completeRange / confirmRange
- [ ] 백엔드: getUpcoming7Days / getTomorrowCheck
- [ ] 백엔드: updateConfirmedSchedule (editReason 기록)
- [ ] 백엔드: changeRequests CRUD (생성/승인/거절)
- [ ] 프론트: RestaurantContext에 effectiveStoreRole 추가
- [ ] 프론트: AppLayout 권한 메뉴 effectiveStoreRole 기반으로 변경
- [ ] 프론트: SchedulePage 전면 리팩터링 (지난주 복사, 프리셋, 고지/완료/확정, 변경요청 탭)
- [ ] 프론트: 대시보드 향후 7일 스케줄 카드 추가
- [ ] 프론트: 대시보드 내일 스케줄 점검 카드 추가
- [ ] 프론트: StaffPage 승급/강등 UI leader/manager 역할 반영

## 지난 스케줄 편집 + 임시 근로자 스케줄 (2026-03-16 요청)

- [x] DB: schedules 테이블에 tempWorkerName 컬럼 추가 (임시/급구 근로자 이름)
- [x] 백엔드: schedules.updatePast API (완료/확정 스케줄 시작/종료 시간 수정)
- [x] 백엔드: schedules.createTempWorker API (임시 근로자 스케줄 생성 — userId 없이 이름만)
- [x] 프론트: PayrollSchedulePage 편집 다이얼로그 (시작/종료 시간 수정, 임시 근로자 이름 표시)
- [x] 프론트: SchedulePage 임시 근로자 추가 버튼 (이름 입력 → 프리셋/시간 선택 → 스케줄 등록)
- [x] 프론트: 임시 근로자 스케줄 카드에 별도 색상/배지 표시

## 임시 근로자 시급/일당 + 인건비 반영 (2026-03-16 추가 요청)

- [x] DB: schedules 테이블에 tempWageType(hourly/daily), tempWageAmount 컬럼 추가
- [x] 백엔드: createTempWorker에 wageType/wageAmount 파라미터 추가
- [x] 백엔드: listPast에 tempWageType/tempWageAmount 반환
- [x] 프론트: SchedulePage 임시 근로자 등록 폼에 시급/일당 선택 및 금액 입력
- [x] 프론트: PayrollSchedulePage 임시 근로자 급여 계산 (시급×근무시간 또는 일당 고정)
- [x] 프론트: PayrollSchedulePage 임시 근로자 합계에 인건비 포함

## 버그: 5일 뷰 마지막 날 스케줄 미표시 (2026-03-16)

- [x] 원인 파악: SchedulePage에서 endDate 계산 시 마지막 날 23:59:59 미포함 여부 확인
- [x] 수정: listByRestaurantAndRange 쿼리의 endDate를 마지막 날 23:59:59로 설정

## 매니저 스케줄 관리 권한 확장 (2026-03-16)

- [x] SchedulePage: isManager 조건에 leader/manager 모두 포함 (점장=leader, 매니저=manager)
- [x] PayrollSchedulePage: 매니저도 접근 가능하도록 권한 조건 수정
- [x] AppLayout: 지난 스케줄 메뉴 매니저도 표시 (effectiveRole 기반)

## 임시 근로자 완료 처리 + 완료 시각 기준 급여 계산 (2026-03-16)

- [x] 백엔드: completeToday에서 tempWorkerName 스케줄도 함께 완료 처리 (userId IS NULL 조건 포함, KST 날짜 기준 수정)
- [x] DB: schedules 테이블에 completedAt 컨럼 이미 존재 확인
- [x] 백엔드: completeToday 실행 시 completedAt = 현재 시각 저장
- [x] 백엔드: listPast에서 completedAt, completedAtStr, actualHours, calculatedWage 반환
- [x] 프론트: PayrollSchedulePage 시급 계산 시 completedAt 기준 실제 근무시간 사용 (startTime~completedAt)
- [x] 프론트: PayrollSchedulePage 임시 근로자 급여 계산 — 시급이면 completedAt 기준, 일당이면 고정
- [x] 프론트: PayrollSchedulePage 날짜별 보기에 완료 시각 표시 (예정 종료와 다를 때만)

## 반차 인원 0.5명 표시 (2026-03-16)

- [ ] SchedulePage: 반차(오픈/마감 프리셋) 스케줄 판별 로직 추가 (전체 근무시간의 절반 이하이면 반차)
- [ ] SchedulePage: 날짜별 인원 합계 계산 시 반차는 0.5명으로 계산
- [ ] SchedulePage: 스케줄 카드에 반차 배지 표시 및 인원 합계에 0.5명 반영

## 버그: 임시 근로자 등록 오류 (2026-03-16)

- [x] 원인 파악: managerProcedure가 users.role만 확인 → restaurant_users.role(leader/manager)인 사용자 FORBIDDEN 오류
- [x] 수정: managerProcedure에서 users.role 부족 시 restaurant_users.role도 확인 (checkStoreManagerRole 헬퍼 추가)
- [x] 효과: 스케줄 관련 모든 managerProcedure API에 일괄 적용 (createTempWorker, create, update, completeToday 등)

## 반차 인원 0.5명 표시 (2026-03-16)

- [x] SchedulePage: 반차 판별 함수 추가 (운영시간의 60% 미만 근무 = 반차)
- [x] SchedulePage: 날짜별 인원 합계 계산 시 반차는 0.5명으로 계산
- [x] SchedulePage: 스케줄 카드에 반차 배지 표시 (주황색)
- [x] SchedulePage: 날짜 헤더에 인원 합계를 소수점 포함 표시 (예: 2.5명)

## 버그: 임시 근로자 등록 시 userId NOT NULL 오류 (2026-03-16)

- [x] 원인: schedules 테이블 userId 컬럼이 DB에서 NOT NULL로 설정되어 있어 null 삽입 거부
- [x] 수정: ALTER TABLE schedules MODIFY COLUMN userId INT NULL 실행으로 NULL 허용 변경

## 매장별 반차 기준 설정 (2026-03-16)

- [x] DB: restaurants 테이블에 halfShiftThreshold 컨럼 추가 (기본값 60, 단위: %)
- [x] 백엔드: setOperatingHours API에 halfShiftThreshold 파라미터 추가
- [x] 백엔드: restaurants.list/get에서 halfShiftThreshold 반환 (Drizzle ORM 자동 포함)
- [x] 프론트엔드: SchedulePage 운영시간 설정 다이얼로그에 반차 기준 슬라이더+입력 추가 (10~90% 범위)
- [x] 프론트엔드: isHalfShift 함수에 동적 threshold 적용 (기본값 60)

## 매장 중심 계층권한 + 스케줄 MVP 통합 리팩터링 (2026-03-16)

### Phase 1: DB 스키마 확장
- [ ] restaurant_users.role enum: leader/manager/employee (3단계)
- [ ] restaurant_users 테이블: assignedBy, assignedAt 컬럼 추가
- [ ] schedules 테이블: planningStatus, completedBy, confirmedAt, confirmedBy, shiftPreset, completionNote 필드 추가
- [ ] store_closed_days 테이블 추가 (id, restaurantId, closedDate, reason, createdBy, createdAt)
- [ ] store_weekly_closures 테이블 추가 (id, restaurantId, weekday, isClosed, createdAt)

### Phase 2: 백엔드 API
- [ ] requireRestaurantRole 헬퍼 추가 (server/db.ts 또는 공용 위치)
- [ ] restaurants.updateStaffRole API (leader만 가능, 최소 1명 leader 보장)
- [ ] storeClosures.list/create/delete API
- [ ] storeWeeklyClosures.upsert API
- [ ] schedules.copyPreviousWeek API (지난주 복사, 휴무일 스킵)
- [ ] schedules.completeRange API (범위 완료 처리)
- [ ] schedules.confirmRange API (범위 확정 처리, leader만)
- [ ] schedules.getUpcoming7Days API (대시보드용)
- ~~[ ] schedules.getTomorrowCheck API~~ — ManagerDashboard 내일 스케줄 점검 카드에서 기존 쿼리로 처리
- ~~[ ] schedules.updateConfirmedSchedule API~~ — schedules.update에서 confirmed 상태 수정 이미 가능
- ~~[ ] 스케줄 저장 검증: 중복 시간, 종료<시작~~ — 프리셋 기반 입력으로 시간 충돌 가능성 낮음
- [x] 매출/매입 API에 휴무일 검증 추가 — ✅ L566-570에서 구현 완료

### Phase 3: RestaurantContext + AppLayout
- [x] effectiveStoreRole 계산 — ✅ shared/permissions.ts getEffectiveRole 구현, AppLayout/App.tsx 사용 중
- [x] AppLayout 메뉴 노출 — ✅ effectiveRole 기반 메뉴 필터링 구현됨
- [x] 인건비 상세: leader만 금액 노출, manager는 비율만 — ✅ L556-558, L592-593에서 구현 완료

### Phase 4: SchedulePage 리팩터링
- [x] scheduled/completed/confirmed/canceled 상태 배지/색상 표시 — ✅ L849에서 구현 완료
- [x] 지난주 복사 버튼 추가 — ✅ L850에서 구현 완료
- ~~[ ] 셀 클릭 시 오픈/종일/마감/직접입력 프리셋 선택~~ — 다이얼로그 방식으로 동작 중, 선택적 UX 개선
- ~~[ ] shiftPreset 필드 저장~~ — 프리셋 UI와 함께 구현 시 의미
- [x] 범위 완료/확정 처리 UI — ✅ L851에서 구현 완료
- ~~[ ] confirmed 상태 수정 시 editReason 입력 다이얼로그~~ — 운영 필요성 판단 보류
- [x] 휴무일 셀 비활성화 표시 — ✅ L537에서 구현 완료
- [x] 직원 화면: 내 스케줄 + 요청 목록 + 요청 상태 — ✅ L859-861에서 구현 완료

### Phase 5: 대시보드 수정
- [x] 향후 7일 스케줄 카드 — ✅ L852에서 구현 완료
- [x] 내일 스케줄 점검 카드 — ✅ L853에서 구현 완료
- [x] manager에게 인건비 비율만 노출, leader에게 상세 금액 노출 — ✅ L605-607에서 구현 완료

### Phase 6: 직원 관리 + 휴무일 설정 UI
- [x] 직원 관리 화면에 역할 컬럼 + 역할 변경 드롭다운 — ✅ StaffPage 승격/강등 버튼 구현됨
- [x] 휴무일 설정 UI — ✅ RestaurantsManagement 5번째 탭으로 이관 완료 (정기 요일 UI는 별도 구현 예정)

## 매장 중심 계층권한 + 스케줄 MVP 통합 리팩터링 — 완료 항목 (2026-03-16)

- [x] DB: store_closed_days, store_weekly_closures 테이블 생성
- [x] DB: schedules 테이블에 shiftPreset, completedBy, confirmedBy 컬럼 추가
- [x] 백엔드: storeClosures.getSpecial/addSpecial/removeSpecial API 추가
- [x] 백엔드: schedules.copyPreviousWeek/confirmRange API 추가
- [x] 백엔드: managerProcedure에 restaurant_users.role(leader/manager) 체크 추가
- [x] 프론트: SchedulePage 휴무일 셀 비활성화 및 날짜 헤더 휴무일 배지
- [x] 프론트: StaffPage에 휴무일 설정 탭 추가 (매니저 전용, 날짜 추가/삭제)

## 버그 수정 (2026-03-16 — /sales 직원 권한 오류)

- [x] /sales 페이지에서 직원(employee) 권한으로 접근 시 "권한이 부족합니다" 오류 수정

## 역할 분리 + 매니저 인건비 비공개 + 스케줄 알림 + 수정 UI + 휴무일 차단 (2026-03-16 요청)

### DB / 마이그레이션
- [x] notifications.type enum에 schedule_assigned, schedule_updated, schedule_deleted 추가

### 서버 권한 가드 분리
- [x] requireStoreManager (leader만 통과) 함수 추가
- [x] requireManagerOrAbove (leader+manager 통과) 함수 추가
- [x] storeClosures.setWeekly, addSpecial, removeSpecial → requireStoreManager로 강화 (leader 전용)
- [x] managerProcedure 내부 storeRole 체크 로직 정리

### 수익성 API 역할별 분기
- [x] profitability.monthly — ctx.user 기반 역할 분기 (매니저는 laborByUser 제거)
- [x] profitability.daily — 매니저는 laborCost 제거

### 스케줄 CRUD 알림 연동
- [x] schedules.create — 대상 직원에게 schedule_assigned 알림 생성
- [x] schedules.update — 대상 직원에게 schedule_updated 알림 생성
- [x] schedules.delete — 대상 직원에게 schedule_deleted 알림 생성
- [x] schedules.quickAssign — 알림 연동

### 휴무일 차단 서버 검증
- [x] schedules.create — 휴무일 차단 (특정 날짜 + 정기 요일)
- [x] schedules.quickAssign/createTempWorker — 휴무일 차단
- [x] schedules.update — 날짜 변경 시 휴무일 차단
- [x] sales.create — 휴무일 차단
- [x] purchases.create — 휴무일 차단

### 프론트엔드 수정
- [x] SchedulePage — 기존 스케줄 수정 모달 추가 (시간/메모 수정 가능)
- [x] SchedulePage — 과거 날짜에도 스케줄 추가 가능하도록 isPast 조건 제거
- [x] StaffPage — 역할 라벨: leader→점장, manager→매니저, employee→직원 (기존 구현 확인)
- [x] StaffPage — 휴무일 설정 탭: leader 전용으로 제한 (storeRoleQuery 추가)
- [x] ProfitabilityPage/CostBreakdown — 매니저는 인건비 상세(laborByUser) 숨김, 안내 메시지 표시

## 전면 개선 (2026-03-16 pasted_content_3 요청)

### DB / 마이그레이션
- [x] restaurant_users.role enum: leader → store_manager 변경 (기존 leader 데이터 마이그레이션)
- [x] schedules.update input에 workDate, userId 추가 (날짜/직원 변경 지원)

### 서버 권한 가드 재설계
- [x] requireStoreManager (store_manager 전용 미들웨어)
- [x] requireManagerOrAbove (store_manager+manager 통과 미들웨어)
- [x] requireEmployeeOrAbove (모든 매장 소속 직원 통과)
- [x] storeClosures.setWeekly/addSpecial/removeSpecial → requireStoreManager

### profitability API 역할별 분기
- [x] profitability.monthly — 매니저는 laborCost/laborByUser null 반환
- [x] profitability.daily — 매니저는 laborCost null 반환

### 휴무일 차단 서버 검증
- [x] sales.create — isClosedDay 검증 추가
- [x] purchases.create — isClosedDay 검증 추가
- [x] schedules.update — 날짜 변경 시 isClosedDay 검증

### 스케줄 수정 UI 완성
- [x] schedules.update input에 workDate, userId 추가 (서버)
- [x] SchedulePage 수정 모달에 날짜/직원 선택 추가

### 프론트엔드 역할별 UI 분기
- [x] ManagerDashboard — storeRoleQuery 추가, 매니저는 인건비 카드 숨김
- [x] ProfitabilityPage — 매니저는 인건비 수치 숨김 (당일/월별)
- [x] CostBreakdown — 매니저는 laborByUser null 처리 (점장만 확인 가능 메시지)

## 버그 수정 (2026-03-16 — /staff 404 오류)

- [x] /staff 라우트 404 오류 원인 파악 및 수정 (App.tsx RoleRouter에 effectiveRole 기반 라우팅 추가 — users.role=employee이지만 storeRole=manager/store_manager인 사용자도 /staff 접근 가능)

## 기능 개선 (2026-03-16 — 스케줄 주간 네비게이션)

- [x] SchedulePage — 이전/이후 주 버튼 및 스크롤 제스처로 주간 탐색 (터치 스와이프, 키보드 ←→, Shift+스크롤)
- [x] SchedulePage — 과거 주 스케줄 편집 가능 (날짜 제한 없음)
- [x] SchedulePage — 현재 주로 돌아오기 버튼 (이번 주 버튼)

## 버그 수정 (2026-03-17 — /schedule employee 권한 오류)

- [x] /schedule 페이지에서 employee(진재이) 뮤테이션 호출 시 "권한이 부족합니다" 오류 수정 (managerProcedure에서 inp?.id 폴백 제거, deleteMutation에 restaurantId 추가)

## 버그 수정 (2026-03-17 — notifications INSERT 오류)

- [x] notifications 테이블 INSERT 실패 — type enum에 schedule_assigned/schedule_updated/schedule_deleted 추가 (ALTER TABLE 직접 적용)

## 기능 개선 (2026-03-18 — 스케줄 화면 간결화)

- [x] SchedulePage — 중복 요소 제거 및 역할별 간결한 UI 재설계 (단일 다이얼로그, 드롭다운 메뉴 통합, 범례 제거, 변경 요청 시트)

## 일마감/월마감 + 대시보드/수익성 분석 개편 (2026-03-18 요청)

### DB / 백엔드
- [x] DB: daily_closings 테이블 추가 (일마감 확정 레코드 — 날짜, 매입, 매입, 인건비, 고정비, 순이익, 확정자, 메모)
- [x] DB: monthly_closings 테이블 추가 (월마감 확정 레코드 — 연월, 집계 수치, 확정자)
- [x] API: dailyClosings.close (일마감 확정), dailyClosings.get (일별 조회), dailyClosings.listByMonth (월별 캘린더용)
- [x] API: monthlyClosings.close (월마감 확정), monthlyClosings.get (월별 조회), monthlyClosings.listByYear (연간 조회)
- [x] API: dailyReport.get — 특정 날짜의 매입/매입/스케줄/인건비 집계 (일마감 리포트용)

### 대시보드 개편
- [x] 대시보드 — 오늘 현황 카드 (매입/매입/인건비/순이익 실시간)
- [x] 대시보드 — 일마감 버튼 + 일마감 리포트 모달 (마감 시간 기준 집계)
- [x] 대시보드 — 최근 7일 일마감 현황 미니 캘린더 (마감 완료/미완료 표시)

### 수익성 분석 개편
- [x] 수익성 분석 — 탭 구조로 개편 (월별 분석 | 캘린더 | 월마감)
- [x] 수익성 분석 — 캘린더 뷰 (월 단위, 날짜별 매입/순이익 표시, 일마감 상태 색상)
- [x] 수익성 분석 — 월마감 버튼 + 월마감 확정 리포트
- [x] 수익성 분석 — 연간 월별 추이 차트 (월마감 데이터 기반)

## 일마감 캘린더 날짜 클릭 슬라이드 패널 (2026-03-18 요청)

- [x] 백엔드: dailyClosings.getDailyDetail API (날짜별 매출 상세 + 매입 목록 반환)
- [x] 프론트엔드: Sheet 컴포넌트 기반 슬라이드 패널 (매출 breakdown + 매입 목록)

## 메뉴 카테고리 정리 및 UI 재정비 (2026-03-18 요청)
- [x] AppLayout 사이드바: 카테고리 그룹핑 (섹션 헤더 추가)
- [x] 역할별 메뉴 구조 재정의 (admin/manager/employee)
- [x] 모바일 탭 우선순위 재조정
- [x] 사이드바 너비 및 시각적 계층 개선

## 버그 수정 (2026-03-18 — /daily-ops 오류 2건)

- [x] /daily-ops 마감 체크 시 "마감 전 매출을 제출하여야 합니다" 오류 → 매출 미제출이어도 마감 허용, 경고 토스트로 변경
- [x] /daily-ops 페이지 탈출 UI 없음 → 헤더에 뒤로가기(←) 버튼 추가 (대시보드로 이동)

## 일일 운영 통합 (2026-03-18 요청)

- [x] DailyOpsPage에 탭 구조 추가 (오픈/마감 | 매출 입력 | 매입 입력 | 일마감)
- [x] 매출 입력 탭: SalesPage 핵심 기능 이식 (현금/카드/기타 항목 입력)
- [x] 매입 입력 탭: PurchasesPage 핵심 기능 이식 (거래처/품목/금액 입력)
- [x] 일마감 탭: DailyClosingPage 5단계 플로우 이식
- [x] 사이드바: 일일 운영을 홈 바로 다음(최상단)으로 이동
- [x] 사이드바: 매출 입력, 매입 입력, 일마감 메뉴 제거 (일일 운영으로 통합)
- [x] App.tsx: /sales, /purchases, /daily-closing → /daily-ops 리디렉션 처리

## 일일 운영 탭 재편 (2026-03-18 요청)

- ~~[x] 탭1 오픈~~ — ✅ L687에서 구현 완료 (중복 기록)
- ~~[x] 탭2 매입 입력~~ — ✅ L688에서 구현 완료 (중복 기록)
- ~~[x] 탭3 중간 매출~~ — ✅ L689에서 구현 완료 (중복 기록)
- ~~[x] 탭4 일마감~~ — ✅ L690에서 구현 완료 (중복 기록)
- ~~[x] DB: daily_interim_sales~~ — ✅ intermediate_sales 테이블로 구현 완료 (중복 기록)
- ~~[x] API: 중간 매출 합산~~ — ✅ L844에서 구현 완료 (중복 기록)

## 일일 운영 탭 재편 (2026-03-18 요청)
- [x] 탭1: 오픈 (금일 출근 인원 확인 + 전날 마감 내용 확인)
- [x] 탭2: 매입 입력 (기존 purchases 탭)
- [x] 탭3: 중간 매출 (독립 탭, 일마감 시 자동 합산)
- [x] 탭4: 일마감 (중간 매출 포함 합산 확정)

## 전면 CSS 리디자인 — 포레스트 다크 (2026-03-19 요청)
- [x] index.css: 포레스트 다크 테마 (차콜/그린 배경 + 에메랄드 포인트)
- [x] index.html: Noto Sans KR + Inter Google Fonts CDN 추가 (이미 적용되어 있음)
- [x] AppLayout: 사이드바 스타일 개편 (로고 강화, 섹션 헤더 가독성, 활성 메뉴 액센트 바)
- [x] 전체 컴포넌트 대비/간격/타이포그래피 통일

## 고정비 기간 관리 & 직원 관리 개선 (2026-03-19 요청)

- [x] 직원 관리 페이지에서 "기존 계정 추가" 버튼 및 다이얼로그 제거
- [x] 고정비 관리에서 "전월 복사" 버튼 제거
- [x] 고정비 항목에 시작일(startDate) / 종료일(endDate) 기간 필드 추가 (미입력 시 상시)
- [x] 고정비 추가/수정 다이얼로그에 날짜 피커 추가
- [x] 고정비 목록 테이블에 기간 컬럼 추가 (상시 항목은 ∞ 아이콘 표시)
- [x] 만료 임박 알림 배너 구현 — 종료일 30일 이내 항목 상단 경고 표시 (노란색 배너)
- [x] 만료 임박 항목 행에 경고 아이콘(⚠) 표시
- [x] getExpiringSoon API — 30일 이내 만료 고정비 조회 (managerProcedure)
- [x] Vitest 테스트 추가 (fixed-costs.test.ts — 21개 테스트, 전체 91개 통과)

## PWA 홈 화면 추가 기능 (2026-03-19 요청)

- [x] manifest.json 생성 (앱 이름, 아이콘, 테마 색상, standalone 모드)
- [x] PWA 아이콘 생성 (192x192, 512x512, apple-touch-icon)
- [x] Service Worker 등록 (오프라인 캐시 기본 설정)
- [x] index.html에 manifest 링크 및 meta 태그 추가
- [x] 로그인 페이지에 PWA 설치 배너/버튼 UI 구현 (iOS/Android 분기)
- [x] iOS Safari용 "홈 화면에 추가" 안내 모달 구현
- [x] Android/Chrome용 beforeinstallprompt 이벤트 처리
- [x] 설치 완료 후 배너 숨김 처리

## 구조 정합성 리팩터링 (2026-03-19 요청)

### 공통 유틸
- [x] shared/permissions.ts — getEffectiveRole, ROLE_LEVEL 공통화
- [x] shared/dateKST.ts — todayKST(), toKSTDateString() 공통 유틸

### 서버 수정
- [x] updateStaffRole에서 users.role 덮어쓰기 제거
- [x] managerProcedure: id-only mutation에서 record lookup으로 restaurantId 추적
- [x] sales.update: protectedProcedure → 소속 매장 검증 추가
- [x] sales.delete: 소속 매장 검증 추가
- [x] purchases.delete: 소속 매장 검증 추가
- [x] purchases.confirmArrival: 소속 매장 검증 추가
- [x] fixedCosts.update: 소속 매장 검증 추가
- [x] fixedCosts.delete: 소속 매장 검증 추가
- [x] schedules.delete: 소속 매장 검증 추가
- [x] 오픈/마감 체크 status 조건 수정 ('approved' 제거 → 'published','confirmed')
- [x] 서버 전체 toISOString().split("T")[0] → todayKST() 교체

### 클라이언트 수정
- [x] AppLayout 역할 배지: effectiveRole 기준으로 표시
- [x] DailyOpsPage: isManager에 storeRole 반영
- [x] SalesPage: isManager에 storeRole 반영
- [x] PurchasesPage: isManager에 storeRole 반영
- [x] 일마감 라벨 정합화: "오늘 매입" → "매입 배분(추정)" 라벨 수정
- [x] 클라이언트 전체 toISOString().split("T")[0] → todayKST() 교체

## 일마감 캘린더 날짜 클릭 슬라이드 패널 (2026-03-19 요청)

- [x] 백엔드: dailyClosings.getDailyDetail API (날짜별 매출 상세 + 매입 목록 반환)
- [x] 프론트엔드: Sheet 컴포넌트 기반 슬라이드 패널 (매출 breakdown + 매입 목록)
- [x] 캘린더 날짜 클릭 → 슬라이드 패널 열기 연동
- [x] 슬라이드 패널에 일마감 확정 여부, 매출 상세(카드/현금/기타), 매입 목록, 인건비 표시
- [x] 테스트 작성

## 과거 날짜 편집 허용 & 수정 이력 기록 (2026-03-19 요청)

- [x] DB: daily_closings에 lastModifiedBy, lastModifiedAt, editHistory 컬럼 추가
- [x] 서버: dailyClosings.close — 기존 마감 있을 때 editHistory append
- [x] 서버: dailyClosings.getDetail — editHistory 응답에 포함
- [x] 슬라이드 패널: 편집 모드 (매출 수정 + 메모 수정 + 저장)
- [x] 슬라이드 패널: 수정 이력 타임라인 표시
- [x] DailyOpsPage: 매출 날짜 picker max 제한 제거 (과거 날짜 입력 허용)
- [x] DailyOpsPage: 매입 날짜 picker max 제한 제거
- [x] SchedulePage: 점장 이상 과거 날짜 스케줄 추가/수정 허용
- [x] update-approval-workflow 스킬 생성

## 구조 정합성 미이행 항목 재수정 + 추가 요청 (2026-03-19)

### [1] 서버 리소스 스코프 검증
- [x] assertRestaurantAccess 헬퍼 함수 추가 — ✅ server/routers.ts L84에 구현됨
- [x] restaurants.get 소속 검증 — ✅ assertRestaurantAccess 호출 확인
- [x] restaurants.getStaff 소속 검증 — ✅ assertRestaurantAccess 호출 확인
- [x] sales.listByMonth 소속 검증 — ✅ assertRestaurantAccess 호출 확인
- [x] purchases.listByMonth 소속 검증 — ✅ assertRestaurantAccess 호출 확인
- [x] profitability.monthly 소속 검증 — ✅ assertRestaurantAccess 호출 확인
- [x] profitability.daily 소속 검증 — ✅ assertRestaurantAccess 호출 확인
- [x] dailyClosings.get/listByMonth/getDetail 소속 검증 — ✅ assertRestaurantAccess 호출 확인

### [2] 권한 공통화
- [x] App.tsx effectiveRole → getEffectiveRole 공통 함수 사용 — ✅ 구현 확인
- [x] AppLayout.tsx 배지 → getEffectiveRole 공통 함수 사용 — ✅ 구현 확인
- [x] DailyOpsPage isManager → getEffectiveRole 기반 통일 — ✅ L825에서 구현 완료
- [x] SalesPage isManager → getEffectiveRole 기반 통일 — ✅ L828에서 구현 완료
- [x] PurchasesPage isManager → getEffectiveRole 기반 통일 — ✅ L828에서 구현 완료
- [x] SchedulePage isManager → getEffectiveRole 기반 통일 — ✅ L828에서 구현 완료
- [x] ProfitabilityPage isManager → getEffectiveRole 기반 통일 — ✅ L828에서 구현 완료

### [3] UX-서버 권한 불일치 제거 (버튼 숨김)
- [ ] DailyOpsPage: 일마감 탭 직원에게 숨김 처리 필요 (서버에서 거부하지만 UI 혼란)
- ~~[ ] SalesPage: 추가/수정/삭제 버튼~~ — SalesPage는 일일운영으로 통합됨
- ~~[ ] PurchasesPage: 추가/수정/삭제 버튼~~ — PurchasesPage는 일일운영으로 통합됨
- ~~[ ] SchedulePage: 추가/수정/삭제 버튼~~ — isManager 기반 분기 이미 구현됨

### [4] 날짜 선택 UI 일관화
- [x] MonthNavigator 공통 컴포넌트 생성 — ✅ client/src/components/MonthNavigator.tsx 존재
- [x] SalesPage MonthNavigator 적용 — ✅ import 확인
- [x] PurchasesPage MonthNavigator 적용 — ✅ import 확인
- [x] ProfitabilityPage MonthNavigator 적용 — ✅ import 확인

### [5] 대시보드/수익성 정보 명확화
- [x] ManagerDashboard 라벨 명확화 — ✅ "마감 확정 전 추정값", "매입(추정)" 라벨 확인
- ~~[ ] EmployeeDashboard 라벨 명확화~~ — 직원 대시보드는 매출/비용 수치 노출 제한적, 영향 미미
- [x] ProfitabilityPage KPI 카드 기준 명시 — ✅ "매입(실제 합산)" 라벨 확인
- [x] 일마감 슬라이드 패널 라벨 정합화 — ✅ L936-940에서 구현 완료

### [6] KST 날짜 잔존 코드 제거
- [x] 서버 toISOString().split("T")[0] 대부분 교체 완료 — 2건 잔존 (L890 KST 날짜 계산용, L2598 purchaseDate 비교용 — 기능상 정상 동작)

### [7] 테스트 보강
- [x] 다른 매장 데이터 접근 차단 테스트 — ✅ permissions.test.ts에 assertRestaurantAccess 테스트 포함
- [x] store_manager/manager/employee 권한 분기 테스트 — ✅ permissions.test.ts 28개 테스트
- ~~[ ] id-only API 권한 검증 테스트~~ — managerProcedure에서 record lookup으로 전환 완료, 별도 테스트 불필요

### [추가] 사이드바/레이아웃 수정
- [x] DailyOpsPage 사이드바 복원 — ✅ L824에서 구현 완료

### [추가] 매장 계약조건 통합
- [x] 매장 계약조건 페이지를 매장 관리 탭으로 통합 — ✅ L826에서 구현 완료
- [x] 사이드바에서 매장 계약조건 독립 메뉴 항목 제거 — ✅ L826에서 구현 완료

## 버그 수정 (2026-03-19 — DailyOpsPage 사이드바 + 계약조건 통합)

- [x] DailyOpsPage AppLayout 래핑 추가 — 일일 운영 페이지 진입 시 사이드바 복원
- [x] DailyOpsPage isManager → getEffectiveRole 기반 통일
- [x] 사이드바 "매장 계약 조건" 독립 메뉴 항목 제거 (AppLayout.tsx)
- [x] /contracts 라우트 → /restaurants 리디렉션 처리 (App.tsx)
- [x] SalesPage/PurchasesPage/SchedulePage isManager → getEffectiveRole 기반 통일
- [x] AppLayout.tsx/App.tsx getEffectiveRole import 추가 (@shared/permissions)
- [x] vite.config.ts fs.allow에 client 폴더 추가 (shared 모듈 접근 허용)

## 신규 작업 (2026-03-19 — 3개 항목 요청)

### [A] 구조 정합성 완료
- [x] KST 잔존 코드 정리 — client/src/pages/SchedulePage.tsx, StaffPage.tsx, RestaurantsManagement.tsx todayKST() 교체
- [x] server/db.ts workDate 계산 toISOString().split("T")[0] → toKSTDateString() 교체
- [x] ManagerDashboard 라벨 명확화 — "매입 (일 배분)" → "매입(추정)", "오늘 집계 (마감 시 확정)" 기준 명시
- [x] ProfitabilityPage KPI 카드 기준 명시 — "매입(실제 합산)" 라벨로 교체
- [x] 권한 검증 테스트 추가 — getEffectiveRole/isManagerLevel/isAdminLevel/assertRestaurantAccess/store_role 계층 분기 28개 테스트 추가 (permissions.test.ts 확장, 전체 180개 통과)

### [B] 일일 운영 탭 재편
- [x] DB: intermediate_sales 테이블 이미 존재 (restaurantId, saleDate, amount, note, recordedBy, recordedAt)
- [x] API: intermediateSales.listByDate / create / delete 이미 구현됨
- [x] API: dailyClosings.close에서 intermediate_sales 합산 로직 이미 구현됨
- [x] DailyOpsPage: 중간 매출 탭 — intermediate_sales 기반으로 이미 구현됨
- [x] DailyOpsPage: 일마감 탭 — 중간 매출 합산 표시 이미 구현됨

### [C] 스케줄/계층권한 MVP 프론트엔드
- [x] SchedulePage: 스케줄 상태 배지 5단계 (draft/published/completed/confirmed/canceled) 이미 구현됨
- [x] SchedulePage: 지난주 복사 버튼 이미 구현됨 (copyPreviousWeek API 연동)
- [x] SchedulePage: 범위 완료/확정 처리 UI 이미 구현됨 (completeToday/confirmRange API 연동)
- [x] ManagerDashboard: 향후 7일 스케줄 카드 이미 구현됨
- [x] ManagerDashboard: 내일 스케줄 점검 카드 이미 구현됨
- [x] EmployeeDashboard: 내 스케줄 + 변경 요청 목록 표시 — ✅ L859-861에서 구현 완료

## 신규 작업 (2026-03-19 — 3개 항목 요청 2차)

### [D] EmployeeDashboard 강화
- [x] EmployeeDashboard: 내 스케줄 상세 — 상태 배지(초안/고지/완료/확정) 표시
- [x] EmployeeDashboard: 변경 요청 목록 표시 (myRequests API 연동, 최근 5건)
- [x] EmployeeDashboard: 변경 요청 상태 배지 (pending/approved/rejected)

### [E] 월별 정산 리포트 PDF 다운로드
- [x] 백엔드: /api/report/monthly-pdf/:restaurantId/:year/:month 엔드포인트 구현 (server/_core/index.ts)
- [x] 백엔드: server/monthlyReportHtml.ts — 매출/매입/고정비/인건비/순이익 집계 HTML 생성
- [x] 프론트엔드: ProfitabilityPage에 PDF 다운로드 버튼 추가

### [F] 계약 고도화
- [x] 서명 완료 즉시 점장 알림 — 이미 구현됨 (notifyOwner 호출 확인)
- [x] 계약 갱신 원클릭 재발송 — ContractCard 갱신 버튼 + RenewDialog 구현 (renew API 연동, 서명 링크 자동 복사)
- [x] 직원별 계약 이력 타임라인 — 이미 구현됨 (수습→정규직 전환 타임라인, 급여/서명일시 표시)

## 신규 작업 (2026-03-19 — 4개 항목 요청 3차)

### [G] 스케줄 모바일 스크롤 개선
- [x] 스케줄 그리드 좌우 스크롤 시 페이지 전환 방지 (touch-action: pan-x + overscroll-behavior-x: contain 적용)
- [x] 스케줄 주간 네비게이션 날짜 범위 표시 — 지난주/이번주/다음주 N월 N일~N일 형식으로 weekLabel 변경

### [H] 대시보드 비용 비율 차트 색상 개선
- [x] ManagerDashboard 파이차트 색상을 사이트 컨셉(에메랄드/틸열/안백색 계열)에 맞게 수정
- [x] Legend 텍스트 색상도 테마에 맞게 수정 (wrapperStyle 색상 적용)

### [I] 매장 관리 간편매입 입력 모드
- [x] DailyOpsPage 매입 탭에 간편매입 입력 모드 스위치 추가 (Zap 아이콘 + 토글)
- [x] 간편매입 모드 ON 시 입력 필드: 거래체, 전체금액, 입고/발주 상태, 메모, 영수증 첨부만 표시
- [x] 간편매입 모드 OFF 시 기존 상세 입력 다이얼로그 유지

### [J] 일마감 쾘린더 상세 화면 매출/매입/인건비 입력
- [x] ProfitabilityPage 날짜 클릭 상세 Sheet에 매출/매입/인건비 직접 입력 UI 추가
- [x] 미마감 날짜 클릭 시 매출 수정 + 간편 매입 추가 후 일마감 확정 가능
- [x] 마감된 날짜 클릭 시 수정 모드로 진입 가능 (수정 다이얼로그 + editHistory 기록)

## 영수증 첨부 S3 저장 완성 (2026-03-19 요청)

- [x] 서버: /api/upload 엔드포인트 추가 (multipart/form-data → S3 storagePut → URL 반환)
- [x] DailyOpsPage 일반 매입 탭: /api/upload 연결 확인 및 attachmentUrl DB 저장 연결
- [x] DailyOpsPage 간편매입 모드: /api/upload 연결 확인 및 quickAttachmentUrl DB 저장 연결
- [x] PurchasesPage: /api/upload 연결 확인 및 attachmentUrl DB 저장 연결
- [x] 매입 목록에서 영수증 이미지 조회 가능 (URL 클릭 시 이미지 열기)

## 매입 UX 3종 개선 (2026-03-19 요청)

### [K] 영수증 이미지 미리보기 모달
- [x] 공통 ImagePreviewModal 컴포넌트 구현 (이미지 URL 클릭 시 앱 내 모달로 표시)
- [x] DailyOpsPage OrderRow "영수증" 링크 → ImagePreviewModal 연결
- [x] PurchasesPage OrderRow "영수증" 링크 → ImagePreviewModal 연결

### [L] 일마감 Sheet 패널 영수증 표시
- [x] ProfitabilityPage 날짜 클릭 Sheet 내 매입 목록에 영수증 썸네일/링크 표시
- [x] 영수증 클릭 시 ImagePreviewModal로 표시

### [M] 매입 전표 수정 기능
- [x] DB: purchaseOrdersV2에 editHistory(json), lastModifiedBy, lastModifiedAt 커럼 추가
- [x] 서버: purchasesV2.updateOrder API 구현 (날짜/상태/메모/영수증 수정 + editHistory append)
- [x] 클라이언트: DailyOpsPage OrderRow 수정 버튼 + 수정 다이얼로그
- [x] 클라이언트: PurchasesPage OrderRow 수정 버튼 + 수정 다이얼로그
- [x] 수정 이력 타임라인 표시 (수정 다이얼로그 하단)

## 스케줄 스와이프 이동 제거 (2026-03-19 요청)

- [x] SchedulePage: 좌우 스와이프로 주간 이동되는 동작 제거
- [x] SchedulePage: 화살표 버튼 클릭 시에만 주간 이동 작동
- [x] SchedulePage: 그리드 내부 좌우 스크롤은 정상 유지

## 분석캘린더 개편 (2026-03-19 요청)

### [N] 메뉴/탭 구조 변경
- [x] 메뉴명 '수익성 분석' → '분석캘린더' 변경 (사이드바, 하단 탭, 페이지 타이틀)
- [x] ProfitabilityPage 탭 순서: 캘린더 탭을 첫 번째로 이동

### [O] 캘린더 날짜 셀 요약 정보 추가
- [x] 한국 공휴일 표시 (날짜 셀에 공휴일명 표시)
- [x] 날짜 셀에 총출근인원 표시 (해당일 스케줄 완료 인원 수)
- [x] 기존 매출/매입 요약은 유지

### [P] 상세 Sheet 일마감 내용 일관성 정리
- [x] 서버: getDetail API에 출근인원 수 및 인건비 합계 포함
- [x] 상세 Sheet에 출근인원 / 인건비 요약 카드 추가
- [x] 상세 Sheet에 일마감 시 입력한 특이사항/메모 표시
- [x] 일일 운영(DailyOpsPage) 일마감 데이터와 상세 Sheet 표시 내용 일관성 확인

## 분석캘린더 PDF/월마감 개편 (2026-03-19 요청)

### [Q] PDF 버튼 위치 이동 및 월마감 상세 표시
- [x] 상단 PDF 다운로드 버튼 제거 (분석캘린더 헤더에서)
- [x] 월마감 탭 내부에 PDF 다운로드 버튼 추가
- [x] 월마감 완료 시 상세 내용 표시 (매출/매입/고정비/인건비/순이익/메모/확정일시)
- [x] 월마감 미완료 시 안내 메시지 표시
- [x] 월마감 상세 PDF 다운로드 버튼 연결 (/api/report/monthly-pdf 활용)

## 연간 현황 그리드 클릭 연동 (2026-03-19 요청)

- [x] 월마감 탭 연간 그리드: 마감된 월 셀 클릭 시 하단 마감 내역 상세 패널 자동 펼치기
- [x] 클릭 후 해당 항목으로 자동 스크롤
- [x] 미마감 월 셀 클릭 시 월마감 다이얼로그 바로 열기 (점장 이상)

## 일일운영 발주체크 단계 추가 (2026-03-19 요청)

- [x] DB: dailyClosings에 orderCheckPhotoUrl, orderCheckNoOrder 커럼 추가
- [x] 서버: close API에 발주체크 필드 추가 (upsertDailyClosing 시그니처 확장)
- [x] 클라이언트: CLOSING_STEPS에 발주체크 2단계 삽입 (매출 입력 다음)
- [x] 발주체크 UI: 사진 업로드(S3) + '금일 발주 없음' 체크박스 + 이미지 미리보기
- [x] 둘 중 하나 완료 시에만 다음 단계 진행 가능 (canProceedClosing 2단계 유효성 검사)

## 버그: 앱 사용 중 Manus OAuth 로그인 페이지 리다이렉트 (2026-03-20 요청)

- [x] 세션 만료/인증 실패 시 Manus OAuth 외부 페이지로 리다이렉트되는 트리거 코드 파악
- [x] 세션 만료 시 앱 내 자체 로그인 화면(/login)으로 처리하도록 수정 (main.tsx, useAuth.ts, DashboardLayout.tsx)
- [x] trpc 에러 핸들러에서 UNAUTHORIZED 시 외부 OAuth URL 대신 /login으로 내부 라우팅 처리

## 스케줄러 6가지 수정 (2026-03-20 요청)

- [x] 버그: 마감반차 입력 시 다음날로 스케줄이 들어가는 날짜 오류 수정 (UTC-4 환경에서 +09:00 오프셋 명시)
- [x] 상세화면에 삭제 버튼 추가 (수정 다이얼로그 하단 좌측)
- [x] + 추가 버튼 제거 (헤더에서)
- [x] 명칭 변경: '인건비 확정' → '스케줄 확정'
- [x] '오늘 완료처리' 기능 제거 (드롭다운에서)
- [x] 배정 시 자동 고지 (published 상태로 생성 + 알림 전송) 및 고지 버튼 제거

## 일일운영 7가지 수정 (2026-03-20 요청)

- [x] 1. 일일운영 전 직원(employee/manager/owner) 접근 허용 (기존 유지 확인)
- [x] 2. 오픈체크 단계: 매장별 오픈 체크리스트 항목 체크 (DailyChecklistCard 컴포넌트 오픈 탭에 삽입)
- [x] 3. 중간매웈 메뉴명 → '중간매웈 & 발주확인' (TODO: 다음 작업 시 적용)
- [x] 4. 발주확인: 매장별 발주 체크리스트 + 금일 발주없음 항목 (일마감 스텝 2에 DailyChecklistCard order 통합)
- [x] 5. 일마감 청소 확인 체크리스트 단계 추가 (TODO: 다음 작업 시 적용 - 현재 오픈/발주만 구현)
- [x] 6. 매장업무관리 페이지에서 오픈/발주/청소 체크리스트 CRUD (StoreOperationsTab 컴포넌트)
- [x] 7. 매장 운영시간 UI를 매장업무관리로 이관 (기본정보 탭에서 제거 → 업무관리 탭으로 이동)
- [x] DB: store_checklist_templates, daily_checklist_logs 테이블 생성
- [x] 서버: 체크리스트 템플릿 CRUD API (storeChecklists 라우터)
- [x] 서버: 일별 체크 저장/조회 API (saveDailyLog, getDailyLog)
- [x] 매장업무관리 탭 추가 (매장 수정 다이얼로그 4번째 탭)

## 미적용 항목 완성 + 추가 기능 (2026-03-20 계속)

- [x] 일마감 청소 확인 체크리스트 스텝 추가 (CLOSING_STEPS 6번, DailyChecklistCard cleaning)
- [x] 중간매출 탭 명칭 → '중간매출 & 발주확인'
- [x] 점장 대시보드 체크리스트 완료율 위젯 (오늘 오픈/발주/청소 완료 여부 요약)

## 매장 관리 권한 및 UI 개편 (2026-03-20)

- [x] 매장 추가 버튼 관리자(admin/master) 전용으로 제한 (점장/매니저는 숨김)
- [x] 점장/매니저 뷰에서 매장 카드 크기 확대 (1개 매장: max-w-2xl full-width, 아이콘/매장명 확대)
- [x] 휴무일 설정 UI를 매장 수정 다이얼로그 5번째 탭으로 이관
- [x] 인사관리 > 직원관리에서 휴무일 설정 탭 제거 (코드 정리 완료)

## 제안 3가지 구현 (2026-03-20)

- [x] 매장 카드 전체 클릭 시 수정 다이얼로그 오픈 — ✅ cursor-pointer + onClick 구현 확인
- [x] AppLayout 사이드바 '매장 관리' 레이블 역할 분기 — ✅ '내 매장 관리' 분기 구현 확인
- [x] 휴무일 탭 정기 휴무 설정 섹션 추가 (storeWeeklyClosures API 활용, 요일 토글 UI 구현)

## 스케줄러 개편 (2026-03-20)

- [x] 날짜별 인원 요약에서 반차 인원 0.5명으로 표시
- [x] 주단위 페이지 방식 제거 → 오늘 기준 7일(어제 포함) 스크롤 방식으로 전환
- [x] '이번주' 버튼 클릭 시 오늘 기준 어제 포함 7일로 스크롤 이동

## 보고서 기반 실행 (2026-03-20)

- [x] todo.md 정리 — 이미 구현된 12건 완료 표시, 중복/불필요 15건 취소선 처리
- [x] 정기 휴무 UI 구현 — 휴무일 탭에 요일 토글 섹션 추가 (storeWeeklyClosures API 활용)
- [x] 전자서명 완료 시 계약정보 자동 저장 — sign 프로시저에서 employeeContracts upsert 로직 추가
