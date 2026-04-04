# 331매장관리 (Restaurant Manager) — 프로젝트 문서

> 마지막 갱신: 2026-04-04 (Claude Code 전환 + 04-01 변경사항 통합)

## 작업 규칙 (Claude Code용)

- 예정작업이 발생하면 반드시 `todo.md`에 기록할 것 (세션 간 연속성)
- 컨텍스트 한계에 가까워지면 사전 경고 → 작업 마무리 후 새 세션 전환
- 한글 커밋 메시지: `.commitmsg` 파일에 쓴 후 `git commit --file=.commitmsg`
- `main` 브랜치 직접 push → Railway 자동 배포 (테스트 = 프로덕션)
- 개발 환경: **Mac** (bash/zsh 기준, Windows CMD 안내 불필요)
- 프로덕션 URL: https://restaurant-manager-production-a762.up.railway.app/

## 배포 환경

- **프로덕션 URL**: Railway 자동 배포 (GitHub main 브랜치 push → 자동 빌드/배포)
- **GitHub**: https://github.com/madmoly/restaurant-manager.git
- **DB**: MySQL 8 on Railway (`DATABASE_URL` in `.env`)
- **AI OCR**: Anthropic Claude Vision API (`ANTHROPIC_API_KEY` in `.env`)
- **로컬 개발 환경 없음**: Railway 프로덕션 직접 배포 (테스트 = 프로덕션)
- **빌드 명령**: `pnpm run build` → Vite(클라이언트) + esbuild(서버)
- **시작 명령**: `NODE_ENV=production node dist/index.js`

## Railway 인프라 스펙 (Hobby Plan)

| 항목 | 스펙 | 비용 |
|------|------|------|
| 월 구독료 | $5/월 (포함 크레딧 $5) | 초과분만 청구 |
| 서비스당 CPU | 최대 48 vCPU | $20/vCPU/월 |
| 서비스당 RAM | 최대 48 GB | $10/GB/월 |
| 볼륨 스토리지 | 최대 5 GB/서비스 | $0.15/GB/월 |
| 볼륨 수 | 최대 10개/프로젝트 | — |
| 임시 스토리지 | 100 GB/서비스 | — |
| 이미지 크기 | 최대 100 GB | — |
| 네트워크 Egress | — | $0.05/GB |
| 레플리카 | 최대 6개/서비스 | — |
| 이미지 보존 | 72시간 (롤백용) | — |
| 볼륨 삭제 복구 | 48시간 유예 | — |

### 주의사항
- DB(MySQL)도 볼륨 기반 → **5GB 한도** (Hobby). 초과 시 Pro($20/월, 50GB~250GB) 업그레이드 필요
- 파일 업로드(레시피 사진, 체크리스트 등)는 서버 임시 스토리지 사용 → **배포 시 초기화됨**. 영구 저장 필요 시 볼륨 마운트 또는 외부 스토리지(S3 등) 필요
- 실 사용량 기반 과금: CPU/RAM은 활성 시간 기준, 유휴 시 비용 최소화
- Pro 플랜 업그레이드 기준: 볼륨 5GB 초과, 레플리카 7개 이상, 더 긴 이미지 보존(120시간) 필요 시

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
│       │   ├── ErrorBoundary.tsx
│       │   └── ui/            # shadcn/ui 컴포넌트 (27개)
│       ├── contexts/
│       │   ├── RestaurantContext.tsx
│       │   └── ThemeContext.tsx
│       ├── hooks/
│       │   ├── useAuth.tsx
│       │   └── useRestaurant.tsx
│       ├── lib/
│       │   ├── trpc.ts        # tRPC 클라이언트 설정
│       │   ├── utils.ts
│       │   ├── errorReporter.ts  # 글로벌 에러 수집
│       │   ├── imageResize.ts
│       │   └── koreanHolidays.ts
│       └── pages/             # 24개 페이지 컴포넌트
├── server/
│   ├── index.ts               # Express 앱 진입점 + 자동 마이그레이션
│   ├── trpc.ts                # tRPC 컨텍스트 + 6단계 프로시저
│   ├── auth.ts                # JWT 토큰 생성/검증
│   ├── db.ts                  # Drizzle DB 연결
│   ├── ocr.ts                 # OCR 엔드포인트 (/api/ocr/*)
│   ├── upload.ts              # 파일 업로드 (/api/upload)
│   ├── middleware/storeAuth.ts # 매장 접근 검증
│   └── routers/               # tRPC 라우터 29개 (+ index.ts)
├── drizzle/
│   └── schema.ts              # 전체 DB 스키마 (48 테이블, ~905줄)
├── shared/
│   └── permissions.ts         # 역할/권한 모델 (서버+클라이언트 공유)
├── scripts/
│   └── seed.ts                # 시드 데이터
├── public/                    # PWA 정적 파일 (manifest.json, sw.js, icons/)
└── .env                       # DATABASE_URL, ANTHROPIC_API_KEY, JWT_SECRET
```

## 권한 모델 (현행 — 2026-03-26 확정)

### 시스템 역할 (users.role)
- `master` (레벨4): 개발자 — 시스템 전체 접근
- `admin` (레벨3): 대표 — 사업 운영 전체
- `user` (레벨1): 일반 사용자 — 매장 역할로 권한 결정
- ※ 시스템 레벨 `manager`는 폐지 (매장 역할로 대체)

### 매장 역할 (restaurant_users.role)
- `owner`: 점장 — 매장 전권 (재무+인사+운영)
- `supervisor`: 매니져 — 운영 실행권, 인사 일부 제한
- `staff`: 직원 — 실행만
- 레거시 호환: `store_manager`→점장, `manager`→매니져, `employee`→직원

### 유효 역할 (effectiveRole) 계산
1. `users.role`이 master/admin → 그대로 사용 (master=개발자, admin=대표)
2. 아니면 `restaurant_users.role` 확인:
   - owner/supervisor → effectiveRole = "manager"
   - staff/null → effectiveRole = "staff"

### 역할 계층 (높→낮)
```
master(개발자) > admin(대표) > owner(점장) > supervisor(매니져) > staff(직원)
```

### 역할 라벨 매핑
| 코드 | 표시명 | 비고 |
|------|--------|------|
| master | 개발자 | 시스템 |
| admin | 대표 | 시스템 |
| owner | 점장 | 매장 (현행) |
| supervisor | 매니져 | 매장 (현행) |
| staff | 직원 | 매장 (현행) |
| store_manager | 점장 | 레거시 |
| manager | 매니져 | 레거시 |
| employee | 직원 | 레거시 |

### 점장(owner) vs 매니져(supervisor) 권한 차이 (3개만)
- 근로계약서 생성/발송: owner만
- 인건비 정산 조회: owner만
- 소속회사 변경: owner만

### tRPC 프로시저 레벨 (6단계)
- `publicProcedure`: 비로그인 접근 가능
- `protectedProcedure`: 로그인 필요
- `managerProcedure`: manager 이상 (점장+매니져 공통)
- `ownerProcedure`: owner 이상 (점장 전용: 인건비, 계약서, 소속회사)
- `adminProcedure`: admin 이상 (대표+개발자)
- `masterProcedure`: master 전용 (개발자만)

### 역할 라벨 (UI 표시)
| 코드 | 표시명 |
|------|--------|
| master | 개발자 |
| admin | 대표 |
| owner | 점장 |
| supervisor | 매니져 |
| staff | 직원 |

## 페이지 & 라우팅

| 경로 | 페이지 | effectiveRole |
|------|--------|---------------|
| `/` | MasterDashboard / AdminDashboard / ManagerDashboard / EmployeeDashboard | 역할별 분기 |
| `/business` | AdminDashboard (사업 대시보드) | master, admin |
| `/groups` | MasterDashboard (사업그룹 관리) | master |
| `/users` | UsersPage (사용자 관리) | master |
| `/restaurants` | RestaurantsPage (매장 관리) | master, admin, manager |
| `/sales` | SalesPage (매출) | 전체 |
| `/daily-closing` | SalesPage (일마감 — 별칭) | admin |
| `/monthly-settlement` | MonthlySettlementPage (월정산) | master, admin, manager, staff |
| `/profitability` | → `/monthly-settlement`로 리다이렉트 | — |
| `/counterparties` | CounterpartiesPage (거래처) | master, admin, manager |
| `/purchase-management` | PurchaseManagementPage (매입) | 전체 |
| `/fixed-costs` | FixedCostsPage (고정비) | master, admin, manager |
| `/schedule` | SchedulePage (스케줄+휴무신청) | 전체 |
| `/daily-ops` | DailyOpsPage (일일운영) | 전체 |
| `/ops-calendar` | OpsCalendarPage (운영캘린더) | master, admin, manager |
| `/task-management` | TaskManagementPage (업무관리) | admin, manager |
| `/labor-cost` | LaborCostPage (인건비) | admin, manager |
| `/staff` | StaffPage (직원관리) | master, admin, manager |
| `/recipes` | RecipesPage (레시피 정보) | 전체 (편집: manager 이상) |
| `/store-info` | StoreInfoPage (업무정보) | 전체 (편집: manager 이상) |
| `/system` | SystemPage (시스템 관리) | master |
| `/sign/:token` | ContractSignPage (전자서명) | 비로그인 접근 |
| `/join/:code` | JoinPage (초대코드 가입) | 비로그인 접근 |
| `/change-password` | ChangePasswordPage (비밀번호 변경) | 로그인 필요 |
| `/login` | Login (로그인) | 비로그인 접근 |

## DB 테이블 (48개)

### 핵심 테이블
| 변수명 | DB 테이블명 | 설명 |
|--------|------------|------|
| users | users | 사용자 (username, passwordHash, name, email, phone, role, isTutorial, parentId, healthCertUrl, healthCertExpiry, mustChangePassword) |
| businessGroups | business_groups | 사업그룹 (name, adminId — 대표별 조직 단위) |
| restaurants | restaurants | 매장 (name, address, monthlyTargetSales, targetLaborRatio, targetCostRatio, openTime, closeTime, halfShiftThreshold, isTutorial, ownerAdminId, deletedAt, salesInputStartTime/EndTime) |
| restaurantUsers | restaurant_users | 매장-사용자 배정 (restaurantId, userId, role, affiliatedCompany, roleChangedAt/By) |
| restaurantShiftPresets | restaurant_shift_presets | 매장별 근무 프리셋 시간 (presetType: open/full/close, dayType: weekday/weekend, startTime, endTime, breakMinutes) |

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
| schedules | schedules | 근무 스케줄 (상태: draft→confirmed→completed/canceled, shiftPreset: open/full/close/custom, breakMinutes) |
| scheduleChangeRequests | schedule_change_requests | 스케줄 변경 요청 |
| leaveRequests | leave_requests | 휴무 신청 (dayoff/half_morning/half_evening, 5일전 제한) |
| employeeContracts | employee_contracts | 직원 근로계약 |
| employeeLeaves | employee_leaves | 직원 휴가 기록 |
| leaveTransactions | leave_transactions | 대체휴무/연차 상세 이력 (earn/use, 공휴일 근무 기반) |

### 운영
| 변수명 | DB 테이블명 | 설명 |
|--------|------------|------|
| dailyOperations | daily_operations | 일일 운영 기록 (오픈/마감 체크) |
| storeChecklistTemplates | store_checklist_templates | 체크리스트 템플릿 (태그, 반복유형, requirementType) |
| dailyChecklistLogs | daily_checklist_logs | 체크리스트 실행 로그 |
| dailyOrderImages | daily_order_images | 발주서 이미지 (OCR) |
| storeClosedDays | store_closed_days | 매장 휴무일 |
| storeWeeklyClosures | store_weekly_closures | 매장 정기 휴무 |

### 계약/알림/에러
| 변수명 | DB 테이블명 | 설명 |
|--------|------------|------|
| restaurantContracts | restaurant_contracts | 매장 계약 조건 (임대/수수료/로열티) |
| employmentElectronicContracts | employment_electronic_contracts | 전자 근로계약서 (토큰 서명, affiliatedCompany 포함) |
| notifications | notifications | 알림 (type, title, content, isRead) |
| errorLogs | error_logs | 에러 로그 (errorType, message, stack, url, userAgent, metadata) |

### 매장 콘텐츠
| 변수명 | DB 테이블명 | 설명 |
|--------|------------|------|
| recipes | recipes | 레시피 게시판 (restaurantId, title, category, imageUrl, content, sortOrder) |
| storeInfoCards | store_info_cards | 업무정보 카드 (restaurantId, cardType, title, content, isPinned, sortOrder) |

### OCR/학습
| 변수명 | DB 테이블명 | 설명 |
|--------|------------|------|
| counterpartyOcrProfiles | counterparty_ocr_profiles | 거래처별 OCR 프로파일 (documentType, columnOrder, frequentItems) |
| ocrCorrections | ocr_corrections | OCR 사용자 수정 이력 (originalItems, correctedItems) |

### 시스템/감사
| 변수명 | DB 테이블명 | 설명 |
|--------|------------|------|
| auditLogs | audit_logs | 감사 로그 (action, target, details — before/after) |
| systemSettings | system_settings | 시스템 설정 (key-value) |
| apiUsageLogs | api_usage_logs | API 사용량 로그 (ocr, geocoding 등) |
| dbBackupLogs | db_backup_logs | DB 백업 이력 |
| restaurantInvites | restaurant_invites | 매장 초대 코드 (code, role, expiresAt) |

## 사업그룹 구조 (2026-03-30 적용)

- `business_groups` 테이블: adminId로 대표(admin)에 연결되는 조직 단위
- `restaurants.ownerAdminId`: 매장이 어느 대표(사업그룹)에 속하는지
- `users.isTutorial` / `restaurants.isTutorial`: Tutorial 데이터 격리 플래그
- `users.parentId`: SUB대표 계층 (상위 대표 userId, NULL = 최상위)
- master 로그인 시 `/business`에서 사업그룹 필터(전체/개별그룹/Tutorial) 사용
- `/groups` 경로에서 사업그룹 생성/매장배정/관리

### 매장 추가 컬럼 (restaurants)
- `halfShiftThreshold`: 반차 판별 기준 (운영시간 대비 %, 기본 60)
- `deletedAt`: 소프트 삭제 일시 (null이면 활성)
- `salesInputStartTime`/`salesInputEndTime`: 매출 입력 허용 시간대

### 스케줄 추가 컬럼 (schedules)
- `shiftPreset`: 근무유형 (open/full/close/custom)
- `breakMinutes`: 휴게시간 (분, 풀타임 기본 60)
- `tempWorkerName`/`tempWageType`/`tempWageAmount`: 임시 근로자 지원

### 매장별 근무 프리셋 (restaurant_shift_presets)
- 매장 영업시간(openTime/closeTime)과 **독립적으로** 근무유형별 시간 설정 가능
- `presetType`: open(오픈), full(풀타임), close(마감)
- `dayType`: weekday(평일), weekend(주말) — 같은 프리셋이라도 요일별로 다른 시간 설정 가능
- UNIQUE KEY: (restaurantId, presetType, dayType) — ON DUPLICATE KEY UPDATE로 upsert
- 스케줄 배정 시 우선순위: 커스텀 프리셋 → (없으면) 영업시간 기반 자동 계산 (폴백)
- 설정 UI: 업무정보 페이지(StoreInfoPage) > 매장 기본정보 > 근무 프리셋 시간
- 예시: 매장 영업시간 10:30~19:30이지만 풀타임 근무는 09:30~20:30으로 별도 설정

## tRPC 라우터 목록 (29개)

| 라우터 | 파일 | 설명 |
|--------|------|------|
| auth | auth.ts | 로그인/회원가입/토큰 |
| users | users.ts | 사용자 CRUD |
| restaurants | restaurants.ts | 매장 CRUD |
| sales | sales.ts | 매출 |
| counterparties | counterparties.ts | 거래처 |
| purchases | purchases.ts | 매입 (레거시) |
| fixedCosts | fixedCosts.ts | 고정비 |
| dailyClosings | dailyClosings.ts | 일일 마감 |
| schedules | schedules.ts | 근무 스케줄 |
| scheduleChangeRequests | scheduleChangeRequests.ts | 스케줄 변경 요청 |
| dailyOps | dailyOps.ts | 일일운영 |
| storeClosures | storeClosures.ts | 매장 휴무 |
| storeChecklists | storeChecklists.ts | 체크리스트 |
| items | items.ts | 품목 마스터 |
| counterpartyItems | counterpartyItems.ts | 거래처별 품목 |
| purchasesV2 | purchasesV2.ts | 매입 v2 (현재 사용) |
| pricing | pricing.ts | 가격 관련 |
| monthlyClosings | monthlyClosings.ts | 월간 마감 |
| notifications | notifications.ts | 알림 |
| electronicContracts | electronicContracts.ts | 전자 근로계약서 |
| leaveRequests | leaveRequests.ts | 휴무 신청 |
| errorLogs | errorLogs.ts | 에러 로그 |
| admin | admin.ts | 대표/관리자 기능 |
| system | system.ts | 시스템 관리 (master 전용) |
| invites | invites.ts | 매장 초대 코드 |
| leaveBalance | leaveBalance.ts | 연차/대체휴무 잔여 |
| recipes | recipes.ts | 레시피 |
| storeInfo | storeInfo.ts | 업무정보 카드 |
| businessGroups | businessGroups.ts | 사업그룹 CRUD |

## 최근 주요 변경 (2026-04-01)

### 월정산 페이지 전면 개편
- ProfitPage(수익분석) → MonthlySettlementPage(월정산) 교체
- `monthlyClosings.settlementData` API: 수집현황/손익/지표/전월비교/마감상태 통합 조회
- 5섹션: 데이터수집현황 → 손익요약(결제수단별/거래처별/소속사별 드릴다운) → 운영지표 → 전월비교 → 월정산확정
- ProfitPage.tsx는 미삭제 (dead code, 정리 필요)

### 운영캘린더 → 일일운영 바로가기
- OpsCalendarPage 날짜 상세뷰에 "일일운영 상세 보기" 버튼 추가
- DailyOpsPage에 `?date=YYYY-MM-DD` URL 파라미터 지원

### 체크리스트 적용 기간 관리
- `store_checklist_templates`에 `effectiveFrom`, `effectiveTo`, `deactivatedBy` 컬럼 추가
- 생성 시 effectiveFrom=오늘(KST) 자동설정 → 과거 일일운영에 소급 적용 방지
- 삭제 → 소프트 비활성(effectiveTo=오늘, isActive=false) → 과거 참조 보존
- 기존 데이터: effectiveFrom=NULL → 제한없음 (하위호환)

## 자동 마이그레이션

`server/index.ts` 시작 시 자동 실행. 새 컬럼/테이블 추가 시:
```typescript
await conn.query(`
  ALTER TABLE 테이블명
    ADD COLUMN IF NOT EXISTS 컬럼명 타입 DEFAULT NULL
`).catch(() => {}); // 이미 존재하면 무시
```

## 개발 컨벤션

### Git 커밋
- 한글 커밋 메시지: `.commitmsg` 파일에 쓴 후 `git commit --file=.commitmsg` 사용
- `main` 브랜치 직접 push → Railway 자동 배포

### 새 기능 추가 패턴
1. **스키마**: `drizzle/schema.ts`에 테이블/컬럼 추가
2. **마이그레이션**: `server/index.ts` 자동 마이그레이션 섹션에 ALTER TABLE 추가
3. **라우터**: `server/routers/`에 tRPC 라우터 생성 → `server/routers/index.ts`에 등록
4. **페이지**: `client/src/pages/`에 컴포넌트 생성 → `App.tsx` 라우트 + `AppLayout.tsx` 네비 추가

### 빌드 & 배포
```bash
git add -A && git commit --file=.commitmsg && git push origin main
# Railway가 자동 빌드/배포
```

---

## OCR 매입 자동입력 — 현황 및 개선 가이드

### 현재 상태 (2026-03-29, Phase 1 적용)

**완료된 개선:**
- OCR 프롬프트 전면 교체: 회전 이미지 대응, 양식 4유형 세분화(거래명세표/거래명세서/영수증/수기전표), 신규 양식 자동 감지
- 서버 검증 로직 추가: 수량↔단가 뒤바뀜 감지, 수량 이상치(>100) 경고, 합계 크로스체크

**미적용 (Phase 2~3, 추후):**
- 거래처별 OCR 프로파일 DB (`counterparty_ocr_profiles` 테이블)
- 동적 프롬프트 주입 (거래처 기존 품목/단가를 OCR 힌트로 투입)
- 사용자 수정 데이터 기반 자동 학습 파이프라인
- 클라이언트 사이드 이미지 회전/크롭 UI

### OCR 정확도 향상을 위한 사용자 참여 가이드

**1. 사진 촬영 시 지켜야 할 것:**
- 전표를 **정방향**으로 놓고 촬영 (글씨가 읽히는 방향). 현재 85%가 90° 회전되어 있음
- 전표 전체가 프레임에 들어오도록 (특히 상단 거래처명, 하단 합계)
- 그림자가 숫자 위에 떨어지지 않도록 조명 확보
- 배경에 다른 서류/메뉴판이 겹치지 않도록

**2. OCR 결과 확인 시:**
- 노란색 하이라이트(uncertain) 항목은 반드시 확인 후 수정
- 거래처명이 미추출/오추출이면 직접 선택
- 수량과 단가가 뒤바뀌었으면 수정 (시스템이 confidence="low"로 표시)
- 수정 완료 후 저장하면 수정 데이터가 자동 축적됨 → 향후 학습 데이터로 활용

**3. 신규 거래처/양식:**
- 처음 보는 거래처의 전표는 OCR 정확도가 낮을 수 있음 → 1~2회 수동 수정 필요
- 거래처별 양식은 고정이므로, 초기 수정 후 동일 거래처는 정확도 향상 예정 (Phase 2)

### 관련 파일
- `server/ocr.ts`: OCR 엔드포인트 + 프롬프트 + 검증 로직
- `client/src/lib/imageResize.ts`: 클라이언트 이미지 전처리 (OCR_HIGH: 2560px/0.92)
- `client/src/pages/DailyOpsPage.tsx`: OCR UI (업로드 → 결과 확인 → 수정)
- `scripts/ocr-test.ts`: OCR 정확도 테스트 스크립트
- `docs/ocr-improvement-plan.md`: 전체 개선 기획서 (Phase 1~3)
- `drizzle/schema.ts`: `dailyOrderImages` 테이블 (OCR 이미지 저장)

### OCR 개선 TODO (우선순위순)
- [x] Phase 1: 프롬프트 강화 (회전 대응 + 양식 세분화 + 수량/단가 휴리스틱)
- [x] Phase 1: 서버 검증 (수량↔단가 뒤바뀜 감지, 수량 이상치 경고)
- [x] Phase 2 (스키마): `counterparty_ocr_profiles` + `ocr_corrections` 테이블 생성 완료
- [x] Phase 2 (프로파일): 거래처별 OCR 프로파일 자동 생성/업데이트 + 이동평균 단가 학습
- [x] Phase 2 (수정 축적): 사용자 OCR 수정 데이터 INSERT + corrections 조회/통계 API (GET /api/ocr/corrections, /corrections/stats)
- [x] Phase 2 (모니터링): SystemPage > OCR학습 탭에서 수정 빈도/프로파일 현황 조회 가능
- [x] Phase 3: 동적 프롬프트 주입 (거래처 프로파일 기반 품목/단가 힌트 — ocr.ts buildProfileHint)
- ~~Phase 2: 클라이언트 수동 이미지 회전 UI~~ → 서버 AI 자동 회전(detectAndFixOrientation)으로 대체, 불필요
- ~~Phase 3: 사용자 수정 데이터 기반 학습 파이프라인~~ → 오인식 수정값의 프로파일 오염 리스크. OCR 결과 기반 자동 학습으로 충분