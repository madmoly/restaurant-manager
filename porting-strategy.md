# Restaurant Manager: 마누스 → 채팅 버전 포팅 전략

> 작성일: 2026-03-22
> 목적: 마누스 코드베이스(rm-last)의 기능을 채팅 버전(rm-phase1)의 클린 아키텍처에 단계적으로 포팅

---

## 1. 현황 비교

| 항목 | 채팅 버전 (rm-phase1) | 마누스 버전 (rm-last) |
|------|----------------------|----------------------|
| 테이블 | 10개 | 31개 |
| tRPC 프로시저 | ~35개 (8 라우터) | ~170개 (25+ 라우터) |
| 클라이언트 페이지 | 12개 | 22개 |
| UI 시스템 | 커스텀 (Button, Card 등 11개) | shadcn/ui (50+ 컴포넌트) |
| 인증 | JWT + bcrypt + localStorage | Manus OAuth + SDK |
| 권한 모델 | admin/user + manager/sub_manager/employee | master/admin/manager/employee + store_manager/manager/employee |
| 배포 | GitHub + Railway | Manus 플랫폼 |
| PWA | 없음 | 있음 |
| 파일 업로드 | 없음 | S3 |
| PDF 생성 | 없음 | Chromium (@sparticuz) |
| 전자계약 | 없음 | 토큰 기반 서명 |

---

## 2. 아키텍처 판단

### 유지할 것 (채팅 버전의 강점)
- **라우터 파일 분리**: 마누스는 routers.ts 단일 파일(47K tokens). 채팅 버전은 라우터별 분리 → 유지보수 우월
- **자체 인증**: JWT + bcrypt. Manus OAuth 종속 없음. 그대로 유지
- **깔끔한 미들웨어**: storeAuth.ts의 verifyStoreAccess/requireStoreManager 패턴
- **Drizzle 마이그레이션**: drizzle-kit generate → migrate 파이프라인
- **Railway 배포**: Dockerfile 기반, 자체 인프라

### 교체할 것
- **UI 시스템**: 커스텀 → shadcn/ui 도입. 마누스의 50+ 컴포넌트 활용
- **권한 모델**: admin/user → master/admin/manager/employee 4계층으로 확장
- **restaurant_users.role**: manager/sub_manager/employee → store_manager/manager/employee

### 포팅할 것 (마누스에서 가져올 것)
- 21개 추가 테이블 스키마 + relations
- ~135개 추가 tRPC 프로시저 (라우터 분리 구조로 재배치)
- 10개 추가 페이지 + 기존 페이지 고도화
- shared/permissions.ts의 getEffectiveRole 확장
- S3 업로드, PDF 생성, PWA

### 버릴 것 (Manus 종속)
- server/_core/sdk.ts (OAuth)
- server/_core/oauth.ts
- server/_core/notification.ts (Manus 알림 서비스)
- server/_core/llm.ts (Forge LLM)
- vite-plugin-manus-runtime
- ManusDialog.tsx
- client/public/__manus__/

---

## 3. 포팅 단계 계획

### Phase 0: 기반 교체 (UI + 권한 + 스키마 정리)

**예상 작업량: 가장 큰 단계. 이후 Phase의 기반이 됨.**

#### 0-1. shadcn/ui 도입
- [ ] shadcn/ui 의존성 추가 (radix-ui, class-variance-authority, clsx, tailwind-merge)
- [ ] components.json 설정
- [ ] 마누스의 ui/ 컴포넌트 50개 중 실제 사용되는 핵심 20개 선별 포팅
  - button, card, dialog, input, select, badge, tabs, table, sheet, dropdown-menu, tooltip, sonner, skeleton, separator, progress, checkbox, switch, label, form, scroll-area
- [ ] 기존 커스텀 UI(components/ui/index.tsx)를 shadcn 컴포넌트로 교체
- [ ] AppLayout.tsx 재작성 (사이드바 + 모바일 하단탭 + 매장 전환)
- [ ] ThemeContext 도입 (다크모드)
- [ ] index.css 디자인 토큰 업데이트

#### 0-2. 권한 모델 확장
- [ ] users.role enum: admin/user → master/admin/manager/employee/user
- [ ] restaurant_users.role enum: manager/sub_manager/employee → store_manager/manager/employee
- [ ] shared/permissions.ts: getEffectiveRole() 마누스 버전으로 교체
- [ ] App.tsx: RoleRouter 패턴 도입 (effectiveRole 기반 라우트 분기)
- [ ] tRPC 미들웨어: managerProcedure 추가 (protectedProcedure + manager 이상 검증)
- [ ] seed 데이터 업데이트 (4계층 테스트 계정)

#### 0-3. 스키마 정리 (채팅↔마누스 차이 해소)
- [ ] restaurants: deletedAt, salesInputStartTime/EndTime, halfShiftThreshold 컬럼 추가
- [ ] restaurant_users: roleChangedAt, roleChangedBy 컬럼 추가
- [ ] sales: rawData(json) 컬럼 추가, updatedAt 제거 (마누스 스키마에 없음)
- [ ] 마이그레이션 생성 및 적용

#### 0-4. 기존 페이지 고도화
- [ ] Login.tsx: 원클릭 테스트 계정 패널 추가
- [ ] ManagerDashboard.tsx: KPI 카드 + 비용 구조 차트 + 빠른 매출 입력
- [ ] AdminDashboard.tsx: 전체 매장 통합 지표
- [ ] EmployeeDashboard.tsx: 내 스케줄 + 체크리스트
- [ ] SalesPage.tsx: 일매출 상세(현금/카드/영수건수) 추가

---

### Phase 1-B: 매입 V2 + 거래처/품목 마스터 (채팅 Phase 1 확장)

**현재 채팅 버전의 매입은 purchase_orders + items 2단 구조. 마누스의 V2 시스템은 이보다 진화.**

#### 1-B-1. 스키마 추가
- [ ] counterparties 테이블에 contactName/contactPhone 제거 (마누스 V2 구조와 정렬)
- [ ] items 테이블 신규 (공통 품목 마스터)
- [ ] counterparty_items 테이블 신규 (거래처-품목 매핑)
- [ ] purchase_orders_v2 테이블 신규 (수정이력 포함)
- [ ] purchase_order_items_v2 테이블 신규
- [ ] purchases 테이블 (Legacy V1) 유지 — 기존 데이터 호환

#### 1-B-2. API 추가
- [ ] items 라우터 (list, create, searchSimilar)
- [ ] counterpartyItems 라우터 (listByCounterparty, create)
- [ ] purchasesV2 라우터 (listOrdersByMonth, getOrderItems, createOrder, updateOrder, deleteOrder)
- [ ] pricing 라우터 (getLastPriceByCounterpartyItem, getRecentComparisonByItem)

#### 1-B-3. 페이지 업데이트
- [ ] PurchasesPage.tsx: V1/V2 전환 또는 V2로 완전 교체
- [ ] CounterpartiesPage.tsx: 품목 매핑 UI 추가

---

### Phase 2: 스케줄 + 일일운영 + 체크리스트

#### 2-1. 스키마
- [ ] schedules 테이블 (임시근로자 지원, 상태 흐름, 프리셋)
- [ ] schedule_change_requests 테이블
- [ ] employee_contracts 테이블
- [ ] employee_leaves 테이블
- [ ] daily_operations 테이블
- [ ] daily_sales_detail + sales_other_items + sales_other_item_templates
- [ ] intermediate_sales 테이블
- [ ] store_closed_days + store_weekly_closures
- [ ] store_checklist_templates + daily_checklist_logs

#### 2-2. API (6개 라우터, ~50 프로시저)
- [ ] schedules 라우터 (16 프로시저)
- [ ] scheduleChangeRequests 라우터 (5 프로시저)
- [ ] leaves 라우터 (3 프로시저)
- [ ] dailyOps 라우터 (5 프로시저)
- [ ] dailySales 라우터 (6 프로시저)
- [ ] intermediateSales 라우터 (4 프로시저)
- [ ] storeClosures 라우터 (5 프로시저)
- [ ] storeChecklists 라우터 (8 프로시저)
- [ ] holidays 라우터 (2 프로시저)

#### 2-3. 페이지
- [ ] SchedulePage.tsx (주간 그리드 스케줄러, ~1061줄)
- [ ] PayrollSchedulePage.tsx (급여 스케줄, ~396줄)
- [ ] DailyOpsPage.tsx (일일 운영, ~1611줄 — 가장 큰 페이지)
- [ ] DailyClosingPage.tsx 고도화 (체크사진, 수정이력, 스냅샷)
- [ ] EmployeeDashboard 연동 (내 스케줄, 변경 요청)

---

### Phase 3: HR/전자계약 + 알림 + 월마감 + PWA

#### 3-1. 스키마
- [ ] employment_electronic_contracts 테이블 (33개 컬럼)
- [ ] notifications 테이블
- [ ] monthly_closings 테이블
- [ ] restaurant_contracts 테이블 (이미 채팅 Phase1에 fixed_costs 있지만 contracts 구조가 다름)

#### 3-2. API
- [ ] electronicContracts 라우터 (별도 파일, 서명/PDF/갱신)
- [ ] notifications 라우터 (list, markRead, create)
- [ ] monthlyClosings 라우터 (get, listByYear, close)
- [ ] contractExpiryScheduler (만료 알림 스케줄러)

#### 3-3. 페이지
- [ ] StaffPage.tsx (직원 통합 관리, ~1173줄)
- [ ] ContractSignPage.tsx (공개 라우트, 토큰 기반 서명)
- [ ] NotificationsPage.tsx
- [ ] ProfitabilityPage.tsx 고도화 (연간 추이, 매장 비교)
- [ ] RestaurantsManagement.tsx (계약조건 탭, 휴무일 탭 등)

#### 3-4. 인프라
- [ ] S3 파일 업로드 (영수증, 서명 이미지)
- [ ] PDF 생성 (월 보고서, 전자계약서)
- [ ] PWA manifest + service worker
- [ ] 자체 알림 시스템 (Manus 알림 서비스 대체)

---

## 4. 리스크 및 주의사항

### 높은 리스크
1. **routers.ts 분리**: 마누스의 47K 단일 파일을 라우터별로 분리하면서 로직 누락 가능. 프로시저별 단위 테스트 필수.
2. **스키마 마이그레이션**: 이미 Railway에 운영 DB 존재. 기존 데이터 유지하면서 스키마 변경 필요. `drizzle-kit generate` 후 SQL 직접 검토.
3. **권한 모델 전환**: admin/user → 4계층 전환 시 기존 seed 데이터 및 테스트 계정 깨짐. init 스크립트 동시 업데이트.

### 중간 리스크
4. **shadcn/ui 의존성 폭발**: Radix UI 패키지 20+개. 번들 사이즈 증가 불가피. 필요한 것만 선별.
5. **마누스 코드의 하드코딩**: routers.ts에 Manus 특화 로직(sdk 호출, 쿠키 처리) 산재. 복사가 아닌 재작성 필요.

### 낮은 리스크
6. **PDF 생성**: @sparticuz/chromium은 Lambda/서버리스 환경용. Railway 컨테이너에서는 puppeteer가 더 적합할 수 있음.
7. **PWA**: manifest.json + sw.js는 마누스 코드 거의 그대로 포팅 가능.

---

## 5. 권장 실행 순서

1. **Phase 0 먼저 완성** — UI 기반과 권한 모델이 모든 후속 작업의 전제. 여기서 70%의 아키텍처 결정이 이루어짐.
2. **Phase 2를 Phase 1-B보다 먼저** — 매입 V2는 기존 V1이 동작하므로 급하지 않음. 스케줄/일일운영이 "점장의 하루" 핵심 흐름에 더 중요.
3. **Phase 3은 마지막** — 전자계약/PDF는 법적 요건이지만 기능 복잡도 대비 일일 사용 빈도 낮음.

**실제 권장 순서: Phase 0 → Phase 2 → Phase 1-B → Phase 3**
