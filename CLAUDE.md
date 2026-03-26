# 331매장관리 (Restaurant Manager) — 프로젝트 문서

> 마지막 갱신: 2026-03-26 (프로젝트 정리 후 현행 기준 전면 갱신)

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
│   └── routers/               # tRPC 라우터 24개
├── drizzle/
│   └── schema.ts              # 전체 DB 스키마 (34 테이블, 701줄)
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
| `/business` | AdminDashboard (사업 대시보드) | master만 (사업현황 바로가기) |
| `/users` | UsersPage (사용자 관리) | master |
| `/restaurants` | RestaurantsPage (매장 관리) | master, admin, manager |
| `/sales` | SalesPage (매출) | 전체 |
| `/profitability` | ProfitPage (수익분석/분석캘린더) | master, admin, manager, staff |
| `/counterparties` | CounterpartiesPage (거래처) | master, admin, manager |
| `/purchase-management` | PurchaseManagementPage (매입) | 전체 |
| `/fixed-costs` | FixedCostsPage (고정비) | master, admin, manager |
| `/schedule` | SchedulePage (스케줄+휴무신청) | 전체 |
| `/daily-ops` | DailyOpsPage (일일운영) | 전체 |
| `/ops-calendar` | OpsCalendarPage (운영캘린더) | admin, manager |
| `/task-management` | TaskManagementPage (업무관리) | admin, manager |
| `/labor-cost` | LaborCostPage (인건비) | admin, manager |
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
| schedules | schedules | 근무 스케줄 (중복방지, 상태: draft→published→confirmed→completed) |
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

### 계약/알림/에러
| 변수명 | DB 테이블명 | 설명 |
|--------|------------|------|
| restaurantContracts | restaurant_contracts | 매장 계약 조건 (임대/수수료/로열티) |
| employmentElectronicContracts | employment_electronic_contracts | 전자 근로계약서 (토큰 서명, affiliatedCompany 포함) |
| notifications | notifications | 알림 (type, title, content, isRead) |
| errorLogs | error_logs | 에러 로그 (errorType, message, stack, url, userAgent, metadata) |

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
- CMD에서 한글 커밋 메시지는 인코딩 문제 발생 → `.commitmsg` 파일에 쓴 후 `git commit --file=.commitmsg` 사용
- `main` 브랜치 직접 push → Railway 자동 배포
- Windows 경로: `C:\Users\madmo\Documents\Claude\Projects\restaurant-manager\`

### 새 기능 추가 패턴
1. **스키마**: `drizzle/schema.ts`에 테이블/컬럼 추가
2. **마이그레이션**: `server/index.ts` 자동 마이그레이션 섹션에 ALTER TABLE 추가
3. **라우터**: `server/routers/`에 tRPC 라우터 생성 → `server/routers/index.ts`에 등록
4. **페이지**: `client/src/pages/`에 컴포넌트 생성 → `App.tsx` 라우트 + `AppLayout.tsx` 네비 추가

### 빌드 & 배포
```bash
git add -A && git commit --file=.commitmsg && git push origin main
# Railway가 자동 빌�