# 331매장관리 (Restaurant Manager) — 프로젝트 문서

## 배포 환경

- **프로덕션 URL**: Railway 자동 배포 (GitHub main 브랜치 push → 자동 빌드/배포)
- **GitHub**: https://github.com/madmoly/restaurant-manager.git
- **DB**: MySQL 8 on Railway (`DATABASE_URL` in `.env`)
- **AI OCR**: Anthropic Claude Vision API (`ANTHROPIC_API_KEY` in `.env`)
- **로컬 개발 환경 없음**: Railway 프로덕션 직접 배포 (테스트 = 프로덕션)
- **빌드 명령**: `pnpm run build` → Vite(클라이언트) + esbuild(서버)
- **시작 명령**: `NODE_ENV=production node dist/index.js`

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| Frontend | React 19 + Vite 7 + TailwindCSS 4 + shadcn/ui + wouter (라우팅) |
| Backend | Express + tRPC v11 + Drizzle ORM |
| Database | MySQL 8 (Railway) |
| Auth | JWT (jose) + bcryptjs, 쿠키 기반 세션 |
| OCR | Anthropic Claude Vision API (`claude-sonnet-4-20250514`) |
| PWA | manifest.json + service worker + beforeinstallprompt |

## 프로젝트 구조

```
restaurant-manager/
├── client/                    # 프론트엔드
│   ├── index.html             # PWA 메타태그 + SW 등록
│   └── src/
│       ├── App.tsx            # 라우팅 (wouter, 역할별 분기)
│       ├── components/
│       │   ├── AppLayout.tsx  # 사이드바/모바일탭 네비게이션
│       │   └── ui/            # shadcn/ui 컴포넌트
│       ├── contexts/
│       │   ├── RestaurantContext.tsx
│       │   └── ThemeContext.tsx
│       ├── hooks/
│       │   └── useAuth.ts
│       ├── lib/
│       │   ├── trpc.ts        # tRPC 클라이언트 설정
│       │   └── utils.ts
│       └── pages/             # 페이지 컴포넌트 (아래 상세)
├── server/
│   ├── index.ts               # Express 앱 진입점 + 자동 마이그레이션
│   ├── trpc.ts                # tRPC 컨텍스트 + 프로시저 정의
│   ├── auth.ts                # JWT 토큰 생성/검증
│   ├── db.ts                  # Drizzle DB 연결
│   ├── ocr.ts                 # OCR 엔드포인트 (/api/ocr/*)
│   ├── upload.ts              # 파일 업로드 (/api/upload)
│   └── routers/               # tRPC 라우터 (아래 상세)
├── drizzle/
│   └── schema.ts              # 전체 DB 스키마 (34 테이블)
├── shared/
│   └── permissions.ts         # 역할/권한 모델 (서버+클라이언트 공유)
├── public/                    # PWA 정적 파일 (manifest.json, sw.js, icons/)
└── .env                       # DATABASE_URL, ANTHROPIC_API_KEY
```

## 권한 모델

### 시스템 역할 (users.role)
- `master` (레벨4): 최고 관리자
- `admin` (레벨3): 관리자
- `manager` (레벨2): 매니저급 (거의 사용 안 함, 매장 역할로 대체)
- `user` (레벨1): 일반 사용자

### 매장 역할 (restaurant_users.role)
- `store_manager`: 점장
- `manager`: 매니저
- `employee`: 직원

### 유효 역할 (effectiveRole) 계산
1. `users.role`이 master/admin → 그대로 사용
2. 아니면 `restaurant_users.role` 확인:
   - store_manager/manager → effectiveRole = "manager"
   - employee/null → effectiveRole = "employee"

### tRPC 프로시저 레벨
- `publicProcedure`: 비로그인 접근 가능
- `protectedProcedure`: 로그인 필요
- `managerProcedure`: manager 이상 (시스템 역할 OR 매장 역할 검사)
- `adminProcedure`: admin 이상 (시스템 역할만 검사)

## 페이지 & 라우팅

| 경로 | 페이지 | 접근 역할 |
|------|--------|-----------|
| `/` | AdminDashboard / ManagerDashboard / EmployeeDashboard | 역할별 분기 |
| `/users` | UsersPage (사용자 관리) | master, admin |
| `/restaurants` | RestaurantsPage (매장 관리) | master, admin, manager |
| `/sales` | SalesPage (매출) | manager, employee |
| `/profitability` | ProfitPage (수익분석/분석캘린더) | master, admin, manager |
| `/counterparties` | CounterpartiesPage (거래처) | master, admin, manager |
| `/purchase-management` | PurchaseManagementPage (매입) | 전체 |
| `/fixed-costs` | FixedCostsPage (고정비) | manager |
| `/schedule` | SchedulePage (스케줄+휴무신청) | 전체 |
| `/daily-ops` | DailyOpsPage (일일운영) | 전체 |
| `/ops-calendar` | OpsCalendarPage (운영캘린더) | master, admin, manager |
| `/staff` | StaffPage (직원관리) | master, admin, manager |
| `/sign/:token` | ContractSignPage (전자서명) | 비로그인 접근 |

## DB 테이블 (34개)

### 핵심 테이블
| 변수명 | DB 테이블명 | 설명 |
|--------|------------|------|
| users | users | 사용자 (username, passwordHash, name, email, phone, role, healthCertUrl, healthCertExpiry) |
| restaurants | restaurants | 매장 (name, address, monthlyTargetSales, targetLaborRatio, targetCostRatio, openTime, closeTime) |
| restaurantUsers | restaurant_users | 매장-사용자 배정 (restaurantId, userId, role, affiliatedCompany) |

### 매출/마감
| 변수명 | DB 테이블명 | 설명 |
|--------|------------|------|
| sales | sales | 매출 기록 |
| dailyClosings | daily_closings | 일일 마감 |
| dailyClosingSalesTypes | daily_closing_sales_types | 마감 매출 유형 |
| dailyClosingSpecialTypes | daily_closing_special_types | 특별 매출 유형 |
| monthlyClosings | monthly_closings | 월간 마감 |
| dailySalesDetail | daily_sales_detail | 일별 매출 상세 |
| salesOtherItems | sales_other_items | 기타 매출 항목 |
| salesOtherItemTemplates | sales_other_item_templates | 기타 매출 템플릿 |
| intermediateSales | intermediate_sales | 중간 매출 기록 |
| dailySalesSpecialItems | daily_sales_special_items | 특별 매출 항목 |

### 매입/거래처
| 변수명 | DB 테이블명 | 설명 |
|--------|------------|------|
| counterparties | counterparties | 거래처 |
| items | items | 품목 마스터 |
| counterpartyItems | counterparty_items | 거래처별 품목 |
| purchaseOrders | purchase_orders | 매입 발주 (레거시) |
| purchaseOrderItems | purchase_order_items | 매입 발주 품목 (레거시) |
| purchaseOrdersV2 | purchase_orders_v2 | 매입 발주 v2 (현재 사용) |
| purchaseOrderItemsV2 | purchase_order_items_v2 | 매입 발주 품목 v2 |
| fixedCosts | fixed_costs | 고정비 |

### 인사/스케줄
| 변수명 | DB 테이블명 | 설명 |
|--------|------------|------|
| schedules | schedules | 근무 스케줄 |
| scheduleChangeRequests | schedule_change_requests | 스케줄 변경 요청 |
| leaveRequests | leave_requests | 휴무 신청 (dayoff/half_morning/half_evening, 5일전 제한) |
| employeeContracts | employee_contracts | 직원 근로계약 |
| employeeLeaves | employee_leaves | 직원 휴가 기록 |

### 운영
| 변수명 | DB 테이블명 | 설명 |
|--------|------------|------|
| dailyOperations | daily_operations | 일일 운영 기록 (오픈/마감 체크) |
| storeChecklistTemplates | store_checklist_templates | 체크리스트 템플릿 |
| dailyChecklistLogs | daily_checklist_logs | 체크리스트 실행 로그 |
| dailyOrderImages | daily_order_images | 발주서 이미지 (OCR) |
| storeClosedDays | store_closed_days | 매장 휴무일 |
| storeWeeklyClosures | store_weekly_closures | 매장 정기 휴무 |

### 계약/알림
| 변수명 | DB 테이블명 | 설명 |
|--------|------------|------|
| restaurantContracts | restaurant_contracts | 매장 계약 조건 (임대/수수료/로열티) |
| employmentElectronicContracts | employment_electronic_contracts | 전자 근로계약서 (토큰 서명, affiliatedCompany 포함) |
| notifications | notifications | 알림 (type, title, content, isRead) |

## tRPC API 전체 목록

### auth (인증)
- `auth.me` (public) — 현재 로그인 사용자 정보
- `auth.login` (public) — 로그인
- `auth.logout` (public) — 로그아웃
- `auth.changePassword` (protected) — 비밀번호 변경

### users (사용자 관리)
- `users.list` (admin) — 전체 사용자 목록
- `users.get` (protected) — 사용자 상세
- `users.create` (admin) — 사용자 생성
- `users.update` (admin) — 사용자 수정
- `users.updateStaffCredentials` (manager) — 직원 ID/PW/이름/연락처 수정
- `users.updateHealthCert` (manager) — 보건증 URL/만료일 업데이트

### restaurants (매장 관리)
- `restaurants.list` (protected) — 매장 목록
- `restaurants.listMine` (protected) — 내 매장 목록
- `restaurants.get` (protected) — 매장 상세
- `restaurants.getMyStoreRole` (protected) — 현재 매장 내 내 역할
- `restaurants.create` (admin) — 매장 생성
- `restaurants.update` (protected) — 매장 수정
- `restaurants.getStaff` (protected) — 매장 직원 목록 (healthCertUrl, healthCertExpiry, affiliatedCompany 포함)
- `restaurants.addStaff` (protected) — 직원 매장 배정
- `restaurants.updateStaffCompany` (protected) — 직원 소속회사 변경
- `restaurants.updateStaffRole` (admin) — 직원 역할 변경 (admin 전용)
- `restaurants.removeStaff` (protected) — 직원 매장 제거

### sales (매출)
- `sales.listByMonth` (protected) — 월별 매출
- `sales.listByDate` (protected) — 일별 매출
- `sales.monthlyTotal` (protected) — 월간 합계
- `sales.create` (protected) — 매출 등록
- `sales.update` (protected) — 매출 수정
- `sales.delete` (protected) — 매출 삭제

### counterparties (거래처)
- `counterparties.list` (protected) — 거래처 목록
- `counterparties.create` (protected) — 거래처 생성
- `counterparties.update` (protected) — 거래처 수정
- `counterparties.deactivate` (protected) — 거래처 비활성화

### purchasesV2 (매입 v2 — 현재 사용)
- `purchasesV2.listOrdersByMonth` (protected) — 월별 발주 목록
- `purchasesV2.listByDate` (protected) — 일별 발주
- `purchasesV2.getOrderItems` (protected) — 발주 품목 상세
- `purchasesV2.getRecentOrdersByCounterparty` (protected) — 거래처별 최근 발주
- `purchasesV2.createOrder` (protected) — 발주 생성
- `purchasesV2.updateOrder` (protected) — 발주 수정
- `purchasesV2.deleteOrder` (manager) — 발주 삭제
- `purchasesV2.itemPriceComparison` (protected) — 품목 가격 비교
- `purchasesV2.itemPriceTrend` (protected) — 품목 가격 추이
- `purchasesV2.counterpartyAmountAnalysis` (protected) — 거래처별 매입 분석
- `purchasesV2.pendingOrders` (protected) — 미입고 발주 목록

### fixedCosts (고정비)
- `fixedCosts.list` / `monthlyTotal` / `create` / `update` / `deactivate` (protected)

### dailyClosings (일일 마감)
- `dailyClosings.listSalesTypes` / `createSalesType` (protected)
- `dailyClosings.getByDate` / `listByMonth` (protected)
- `dailyClosings.calculateDay` / `save` / `monthlySummary` (protected)

### schedules (스케줄)
- `schedules.listByRestaurant` (protected) — 매장 스케줄 목록 (from/to 필수)
- `schedules.listByUser` (protected) — 내 스케줄
- `schedules.create` / `createTempWorker` / `quickAssign` (manager)
- `schedules.update` / `delete` (manager)
- `schedules.copyPreviousWeek` (manager) — 전주 스케줄 복사
- `schedules.confirmRange` / `confirmDay` (manager) — 스케줄 확정
- `schedules.completeRange` / `completeDay` / `completeOne` (manager) — 근무 완료 처리
- `schedules.getDaySchedules` (manager) — 특정 일 스케줄
- `schedules.getUpcoming7Days` (protected) — 향후 7일 스케줄
- `schedules.listPast` (manager) — 과거 스케줄

### leaveRequests (휴무 신청)
- `leaveRequests.listMine` (protected) — 내 휴무 신청 목록
- `leaveRequests.list` (manager) — 전체 목록 (상태 필터)
- `leaveRequests.create` (protected) — 휴무 신청 (최소 5일 전)
- `leaveRequests.review` (manager) — 승인/거절
- `leaveRequests.cancel` (protected) — 신청 취소
- `leaveRequests.pendingCount` (manager) — 대기 건수

### dailyOps (일일 운영)
- `dailyOps.getByDate` (protected) — 일일 운영 현황 (오픈/마감 체크 상태)
- `dailyOps.checkOpen` / `checkClose` (manager) — 오픈/마감 체크
- `dailyOps.getYesterdaySummary` / `getWeekdayAvgSales` (protected) — 전일 요약, 요일 평균
- `dailyOps.getTodayStaff` (protected) — 오늘 근무자
- `dailyOps.getMidSales` / `saveMidSales` / `deleteMidSales` — 중간 매출
- `dailyOps.getOrderImages` / `saveOrderImage` / `deleteOrderImage` — 발주서 이미지(OCR)
- `dailyOps.getDailySales` / `saveDailySales` — 일매출 등록
- `dailyOps.getOtherItemTemplates` (protected) — 기타 항목 템플릿
- `dailyOps.getMonthlyCalendar` (protected) — 월간 운영 캘린더

### storeChecklists (체크리스트)
- `storeChecklists.listTemplates` / `listAllTemplates` — 템플릿 조회
- `storeChecklists.createTemplate` / `updateTemplate` / `deleteTemplate` (manager)
- `storeChecklists.getLog` / `saveLog` / `listLogs` (protected)

### storeClosures (휴무 관리)
- `storeClosures.listByMonth` / `create` / `delete` — 휴무일
- `storeClosures.getWeeklyClosures` / `setWeeklyClosures` — 정기 휴무

### electronicContracts (전자계약)
- `electronicContracts.listRestaurantContracts` (protected) — 매장 계약 조건 목록
- `electronicContracts.createRestaurantContract` / `updateRestaurantContract` (manager)
- `electronicContracts.listEmploymentContracts` (protected) — 근로계약서 목록
- `electronicContracts.getEmploymentContract` (protected) — 계약서 상세
- `electronicContracts.getByToken` (public) — 토큰으로 계약서 조회 (서명 페이지용)
- `electronicContracts.createEmploymentContract` (manager) — 계약서 생성 (affiliatedCompany 포함)
- `electronicContracts.sendContract` (manager) — 계약서 발송
- `electronicContracts.signContract` (public) — 계약서 서명

### notifications (알림)
- `notifications.listMine` / `unreadCount` / `markRead` / `markAllRead` / `create` (protected)

### 기타
- `items.list` / `create` / `searchSimilar` / `update` — 품목 마스터
- `counterpartyItems.*` — 거래처별 품목 CRUD
- `pricing.*` — 가격 이력 조회
- `monthlyClosings.get` / `listByYear` / `close` — 월간 마감
- `purchases.*` — 매입 v1 (레거시, purchasesV2 사용 권장)
- `scheduleChangeRequests.*` — 스케줄 변경 요청 (list/listMine/create/review)

## REST API (tRPC 외)

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/api/upload` | POST | 이미지/파일 업로드 (multer, FormData) → `{ url }` 반환 |
| `/api/ocr/receipt` | POST | 영수증/발주서 OCR → JSON 파싱 (품목명, 수량, 단가 등) |
| `/api/ocr/extract-health-cert` | POST | 보건증 OCR → `{ name, issueDate, expiryDate }` |
| `/uploads/*` | GET | 업로드 파일 정적 서빙 |
| `/api/init` | GET | DB 초기화 + 시드 데이터 (개발/리셋 전용) |

## 자동 마이그레이션

`server/index.ts` 시작 시 자동 실행:
- `CREATE TABLE IF NOT EXISTS leave_requests ...`
- `ALTER TABLE users ADD COLUMN IF NOT EXISTS healthCertUrl/healthCertExpiry`
- `ALTER TABLE restaurant_users ADD COLUMN IF NOT EXISTS affiliatedCompany`
- `ALTER TABLE employment_electronic_contracts ADD COLUMN IF NOT EXISTS affiliatedCompany`

새 컬럼/테이블 추가 시 이 패턴으로 마이그레이션 추가:
```typescript
await conn.query(`
  ALTER TABLE 테이블명
    ADD COLUMN IF NOT EXISTS 컬럼명 타입 DEFAULT NULL
`).catch(() => {}); // 이미 존재하면 무시
```

## 네비게이션 구조 (AppLayout.tsx)

모바일 하단 탭 (역할별):
- **admin/master**: 대시보드(1), 사용자관리(2), 스케줄(3), 수익분석(4) + 더보기
- **manager**: 대시보드(1), 일일운영(2), 스케줄(3), 분석캘린더(4) + 더보기
- **employee**: 대시보드(1), 일일운영(2), 스케줄(3) + 더보기

데스크탑 사이드바 그룹:
1. 일일 운영: 대시보드, 일일운영, 운영캘린더
2. 인사 관리: 스케줄, 직원관리
3. 재무 분석: 분석캘린더/수익분석, 매출, 고정비, 매입관리
4. 시스템: 사용자관리, 매장관리, 알림

## 개발 컨벤션

### 파일 I/O
- Desktop Commander MCP의 `node:local` 프로세스 또는 `write_file`/`edit_block` 사용
- `read_file`은 메타데이터만 반환 → `type` 명령 또는 `start_process`로 내용 읽기
- Windows 경로: `C:/Users/madmo/Documents/Claude/Projects/restaurant-manager/`

### Git 커밋
- CMD에서 한글 커밋 메시지는 인코딩 문제 발생 → `.commitmsg` 파일에 쓴 후 `git commit --file=.commitmsg` 사용
- `main` 브랜치 직접 push → Railway 자동 배포

### 새 기능 추가 패턴
1. **스키마**: `drizzle/schema.ts`에 테이블/컬럼 추가
2. **마이그레이션**: `server/index.ts` 자동 마이그레이션 섹션에 ALTER TABLE 추가
3. **라우터**: `server/routers/`에 tRPC 라우터 생성 → `server/routers/index.ts`에 등록
4. **페이지**: `client/src/pages/`에 컴포넌트 생성 → `App.tsx` 라우트 + `AppLayout.tsx` 네비 추가

### 빌드 & 배포
```bash
# 로컬 빌드 확인
npx vite build          # 프론트엔드 빌드 확인
npx tsc --noEmit        # 타입 체크 (기존 에러 일부 있음, 신규 에러만 확인)

# 배포
git add -A && git commit --file=.commitmsg && git push origin main
# Railway가 자동 빌드/배포
```

### 테스트 계정 (시드 데이터)
- admin / 1111 (관리자)
- manager1 / 1111 (점장 - 테스트 천호점)
- manager2 / 1111 (점장 - 테스트 강남점)
- staff1, staff2 / 1111 (직원)

## 미완료 / 진행 예정 작업

### 직원관리 후속
- [ ] 보건증 만료 도래 시 자동 알림 (notifications 테이블 연동, cron/스케줄러)
- [ ] 소속회사별 인건비 정산 조회 화면

### 체크리스트 개편 (요청됨, 미착수)
- [ ] "매장관리 > 체크리스트관리" → "내 매장 업무관리"로 명칭 변경, 네비게이션바 이동
- [ ] 체크리스트 속성에 반복(주 몇회/언제) vs 특정 날짜(강조) 구분 추가
- [ ] 오픈/발주/마감 분리 제거 → 속성/태그로 통합

### 네비 통합 (요청됨, 미착수)
- [ ] 매출 + 분석캘린더 → "매출캘린더"로 통합
