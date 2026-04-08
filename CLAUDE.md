# 331매장관리 (Restaurant Manager)

> 마지막 갱신: 2026-04-09 (운영 규칙 슬림화 + 프로젝트 reference 복원)

---

## 1. 작업 원칙 (Single Source of Truth)

- **데이터** = Railway DB 단일. 로컬 백업 보관 금지, 덤프 파일 repo 커밋 금지.
- **작업관리** = GitHub Issues 단일. 로컬 `todo.md`, 작업 로그 파일 생성 금지.
- **코드** = `origin/main` 단일. 다른 위치 clone/worktree 금지.
- **로컬 경로** = `~/Code/restaurant-manager` 1개소. `~/Documents`, `~/Desktop`, `~/iCloud Drive` 하위에 clone 금지 (iCloud Drive는 현재 OFF지만 규칙은 유지).
- **로컬 산출물** = `.env`, `_railway_sync.sh`, `backups/`, `*.sql`, scratch 파일은 `.gitignore` 강제 차단.
- **로컬 런타임 없음** = `pnpm dev` 일상 사용 금지. 검증은 `pnpm run build` 통과 + Railway 자동 배포 결과로 함.

## 2. 역할 분담 (Cowork ↔ Claude Code)

| 역할 | Cowork (claude.ai 웹) | Claude Code (Mac M3 셸) |
|---|---|---|
| 잘하는 일 | 기획·설계·문서 리뷰·수정안 초안 | 빌드·배포·테스트·rebase/reset·대량 파일 조작·git push |
| 한계 | 샌드박스 마운트가 `unlink()` 거부 → `rm`/`git checkout -- file`/`git rebase`/이력 재작성 모두 EPERM | 한계 거의 없음 |
| 핸드오프 트리거 | rebase/머지 충돌/대량 삭제/lock 해제/`git push` 필요 시 즉시 Code로 | — |

**핸드오프 프로토콜**:
1. Cowork에서 막히면 **현재 상태**(스테이징/임시파일/draft commit msg)를 인라인 메모로 정리 후 사용자에게 "Code에서 이어서 진행" 요청.
2. Code 새 세션은 시작 시 `git rev-parse --show-toplevel` (→ `~/Code/restaurant-manager`인지 확인) + `git status -sb && git fetch && git log --oneline @{u}.. && git log --oneline ..@{u}` 로 전후 차이부터 검증.
3. 잔존 lock(`.git/index.lock`, `.git/HEAD.lock`) 정리.
4. 작업 마무리 후 배포 전 의무 요약 5항 보고 → 사용자 승인 → `git push`.

## 3. 자율 실행 규칙

**원칙**: 로컬 작업(파일 읽기/쓰기/수정/삭제, Bash, git add/commit, 빌드, 테스트)은 사전 확인 없이 자율 실행. 허락을 묻지 말 것.

**예외 (반드시 사전 승인)** — 비가역 인프라 작업:
- `git push origin main` (Railway 자동 배포 트리거)
- `git push --force`, 브랜치 강제 삭제(`-D`), `git commit --amend`
- DB 스키마 DROP/TRUNCATE, 대량 데이터 삭제, 프로덕션 MySQL 직접 접속
- Railway 환경변수 변경, 서비스 재시작, 볼륨 삭제
- `rm -rf` 광범위 삭제 (프로젝트 루트 이상)
- 외부 API 유료 호출 대량 실행 (Anthropic OCR 벌크 테스트 등)

## 4. 배포 전 의무 요약 (5항)

`git push` 직전 항상 아래 순서로 보고 후 승인 대기:

1. **변경 파일 목록** (`git diff --stat`)
2. **변경 의도** (왜 고쳤는가, 1~3줄)
3. **영향 범위** (DB 마이그레이션 / tRPC 라우터 / UI / 권한 모델 중 어디)
4. **리스크** (예상 장애 지점, 롤백 방법)
5. **빌드 결과** (`pnpm run build` 통과 여부)

## 5. 금지

- 로컬 `todo.md`, 작업 로그 파일 생성 (작업관리는 GitHub Issues에서만)
- DB dump의 repo 커밋
- `.env` 커밋 또는 로컬 장기 보관 (필요 시 `_railway_sync.sh`로 즉석 복원)
- `git push --no-verify`, pre-commit hook 우회 (실패하면 근본 원인 fix 후 재시도)
- npm/yarn 사용 (pnpm 고정)
- Homebrew 자동 설치 (필요 시 사용자 승인 후 `/opt/homebrew` arm64만 허용)

---

## 6. 기술 스택

| 레이어 | 기술 |
|---|---|
| Frontend | React 19 + Vite 7 + TailwindCSS 4 + shadcn/ui + wouter (라우팅) |
| Backend | Express + tRPC v11 + Drizzle ORM |
| Database | MySQL 8 (Railway) |
| Auth | JWT (jose) + bcryptjs, 쿠키 기반 세션 |
| OCR | Anthropic Claude Vision API (`claude-sonnet-4-20250514`) |
| PWA | manifest.json + service worker + beforeinstallprompt |
| Node | fnm + arm64 네이티브, pnpm 10.x |

**프로덕션**: https://restaurant-manager-production-a762.up.railway.app/ (Railway, main push 자동 배포)
**빌드**: `pnpm run build` → Vite(클라이언트) + esbuild(서버)
**시작**: `NODE_ENV=production node dist/index.js`

## 7. 프로젝트 구조

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
│       ├── contexts/          # RestaurantContext, ThemeContext
│       ├── hooks/             # useAuth, useRestaurant
│       ├── lib/
│       │   ├── trpc.ts        # tRPC 클라이언트 설정
│       │   ├── errorReporter.ts  # 글로벌 에러 수집
│       │   ├── imageResize.ts
│       │   └── koreanHolidays.ts
│       └── pages/             # 24개 페이지 컴포넌트
├── server/
│   ├── index.ts               # Express 진입점 + 자동 마이그레이션
│   ├── trpc.ts                # tRPC 컨텍스트 + 6단계 프로시저
│   ├── auth.ts                # JWT 토큰 생성/검증
│   ├── db.ts                  # Drizzle DB 연결
│   ├── ocr.ts                 # OCR 엔드포인트 (/api/ocr/*)
│   ├── upload.ts              # 파일 업로드 (/api/upload)
│   ├── middleware/storeAuth.ts # 매장 접근 검증 (verifyStoreAccess)
│   └── routers/               # tRPC 라우터 29개 (+ index.ts)
├── drizzle/
│   └── schema.ts              # 전체 DB 스키마 (48 테이블, ~905줄)
├── shared/
│   ├── permissions.ts         # 역할/권한 모델 (서버+클라이언트 공유)
│   └── contractFields.ts      # 전자계약 스냅샷 필드 정의
├── scripts/
│   ├── seed.ts                # 시드 데이터
│   └── normalize-legacy-roles.ts  # legacy 역할 정규화
├── public/                    # PWA 정적 (manifest.json, sw.js, icons/)
├── docs/                      # 스펙·개선 기획서
└── .env                       # (gitignored) DATABASE_URL, ANTHROPIC_API_KEY, JWT_SECRET ...
```

---

## 8. 권한 모델 (현행 — 2026-03-26 확정)

### 시스템 역할 (`users.role`)
- `master` (레벨4): 개발자 — 시스템 전체 접근
- `admin` (레벨3): 대표 — 사업 운영 전체
- `user` (레벨1): 일반 사용자 — 매장 역할로 권한 결정
- ※ 시스템 레벨 `manager`는 폐지 (매장 역할로 대체)

### 매장 역할 (`restaurant_users.role`)
- `owner`: 점장 — 매장 전권 (재무+인사+운영)
- `supervisor`: 매니져 — 운영 실행권, 인사 일부 제한
- `staff`: 직원 — 실행만
- 레거시 호환: `store_manager`→점장, `manager`→매니져, `employee`→직원

### 유효 역할 (effectiveRole) 계산
1. `users.role`이 master/admin → 그대로 사용
2. 아니면 `restaurant_users.role` 확인:
   - owner/supervisor → effectiveRole = `manager`
   - staff/null → effectiveRole = `staff`

### 역할 계층 (높→낮)
```
master(개발자) > admin(대표) > owner(점장) > supervisor(매니져) > staff(직원)
```

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

**스토어 소속 자원 접근 시 `verifyStoreAccess` 미들웨어 필수.**

---

## 9. 페이지 & 라우팅

| 경로 | 페이지 | 접근 가능 |
|---|---|---|
| `/` | Master/Admin/Manager/EmployeeDashboard | 역할별 분기 |
| `/business` | AdminDashboard (사업 대시보드) | master, admin |
| `/groups` | 사업그룹 관리 | master |
| `/users` | UsersPage | master |
| `/restaurants` | RestaurantsPage | master, admin, manager |
| `/sales` | SalesPage (매출) | 전체 |
| `/daily-closing` | SalesPage (일마감 별칭) | admin |
| `/monthly-settlement` | MonthlySettlementPage (월정산) | master, admin, manager, staff |
| `/profitability` | → `/monthly-settlement` 리다이렉트 | — |
| `/counterparties` | CounterpartiesPage | master, admin, manager |
| `/purchase-management` | PurchaseManagementPage | 전체 |
| `/fixed-costs` | FixedCostsPage | master, admin, manager |
| `/schedule` | SchedulePage (스케줄+휴무신청) | 전체 |
| `/daily-ops` | DailyOpsPage (일일운영) | 전체 |
| `/ops-calendar` | OpsCalendarPage | master, admin, manager |
| `/task-management` | TaskManagementPage | admin, manager |
| `/labor-cost` | LaborCostPage | admin, manager |
| `/staff` | StaffPage | master, admin, manager |
| `/recipes` | RecipesPage | 전체 (편집: manager 이상) |
| `/store-info` | StoreInfoPage | 전체 (편집: manager 이상) |
| `/system` | SystemPage | master |
| `/sign/:token` | ContractSignPage (전자서명) | 비로그인 |
| `/join/:code` | JoinPage (초대코드 가입) | 비로그인 |
| `/change-password` | ChangePasswordPage | 로그인 필요 |
| `/login` | Login | 비로그인 |

---

## 10. tRPC 라우터 (29개)

| 라우터 | 설명 |
|---|---|
| auth | 로그인/회원가입/토큰 |
| users | 사용자 CRUD (master 전용 delete 포함) |
| restaurants | 매장 CRUD (`getOwnedRestaurants`로 admin 격리) |
| sales / dailyClosings / monthlyClosings | 매출·일마감·월마감 |
| counterparties / counterpartyItems / items | 거래처·품목 |
| purchases (legacy) / purchasesV2 | 매입 (현재 v2) |
| pricing | 가격 |
| fixedCosts | 고정비 |
| schedules / scheduleChangeRequests | 근무 스케줄 |
| leaveRequests / leaveBalance | 휴무·연차/대체휴무 |
| dailyOps / storeChecklists / storeClosures | 일일운영·체크리스트·매장 휴무 |
| electronicContracts | 전자 근로계약서 (스냅샷·signContract 트랜잭션) |
| staff | 직원 라이프사이클 (quickAdd / resign / reinstate / changeRole 등) |
| notifications | 알림 |
| errorLogs | 글로벌 에러 수집 |
| admin / system / invites | 대표·시스템 관리·매장 초대 |
| recipes / storeInfo | 레시피·업무정보 게시판 |
| businessGroups | 사업그룹 CRUD |

---

## 11. DB 테이블 (48개)

### 핵심
| 변수명 | 테이블 | 비고 |
|---|---|---|
| users | users | username, passwordHash, name, email, phone(+phoneNormalized), role, isTutorial, parentId, healthCertUrl/Expiry, mustChangePassword |
| businessGroups | business_groups | adminId — 대표별 조직 단위 |
| restaurants | restaurants | name, address, monthlyTargetSales, targetLaborRatio/CostRatio, openTime/closeTime, halfShiftThreshold, isTutorial, ownerAdminId, deletedAt, salesInputStartTime/EndTime |
| restaurantUsers | restaurant_users | restaurantId, userId, role, affiliatedCompany, roleChangedAt/By, rehiredAt, resignedAt |
| restaurantShiftPresets | restaurant_shift_presets | presetType(open/full/close), dayType(weekday/weekend), startTime/endTime, breakMinutes |

### 매출/마감
sales · daily_closings · daily_closing_sales_types · daily_closing_special_types · monthly_closings · daily_sales_detail · sales_other_items · sales_other_item_templates · intermediate_sales · daily_sales_special_items

### 매입/거래처
counterparties · items · counterparty_items · purchase_orders (legacy) · purchase_order_items (legacy) · purchase_orders_v2 (현행) · purchase_order_items_v2 · fixed_costs

### 인사/스케줄
schedules (shiftPreset, breakMinutes, tempWorker*) · schedule_change_requests · leave_requests (dayoff/half_morning/half_evening) · employee_contracts · employee_leaves · leave_transactions (대체휴무/연차 earn-use)

### 운영
daily_operations · store_checklist_templates (effectiveFrom/effectiveTo, requirementType) · daily_checklist_logs · daily_order_images (OCR 원본) · store_closed_days · store_weekly_closures

### 계약/알림/에러
restaurant_contracts (임대/수수료/로열티) · employment_electronic_contracts (토큰 서명, snapshot* 12필드, status 'superseded') · notifications · error_logs

### 매장 콘텐츠
recipes · store_info_cards

### OCR/학습
counterparty_ocr_profiles (documentType, columnOrder, frequentItems) · ocr_corrections (originalItems/correctedItems)

### 시스템/감사
audit_logs · system_settings · api_usage_logs · db_backup_logs · restaurant_invites

---

## 12. 사업그룹 구조 (2026-03-30 적용)

- `business_groups`: adminId로 대표(admin)에 연결되는 조직 단위
- `restaurants.ownerAdminId`: 매장이 속한 사업그룹(대표)
- `users.isTutorial` / `restaurants.isTutorial`: Tutorial 데이터 격리 플래그
- `users.parentId`: SUB대표 계층 (NULL = 최상위)
- master `/business`에서 사업그룹 필터(전체/개별/Tutorial) 사용
- `/groups`에서 사업그룹 생성·매장배정·관리

### 매장별 근무 프리셋 (restaurant_shift_presets)
- 매장 영업시간(openTime/closeTime)과 **독립적**으로 근무유형별 시간 설정 가능
- `presetType`: open(오픈), full(풀타임), close(마감)
- `dayType`: weekday(평일), weekend(주말) — 같은 프리셋도 요일별 다른 시간 가능
- UNIQUE: (restaurantId, presetType, dayType) — upsert
- 우선순위: 커스텀 프리셋 → (없으면) 영업시간 기반 자동 계산
- 설정 UI: StoreInfoPage > 매장 기본정보 > 근무 프리셋 시간

---

## 13. 새 기능 추가 패턴

1. **스키마**: `drizzle/schema.ts`에 테이블/컬럼 추가
2. **자동 마이그레이션**: `server/index.ts` 시작 시 idempotent ALTER TABLE 추가
   ```ts
   await conn.query(`
     ALTER TABLE 테이블명 ADD COLUMN IF NOT EXISTS 컬럼명 타입 DEFAULT NULL
   `).catch(() => {});
   ```
3. **라우터**: `server/routers/`에 tRPC 라우터 생성 → `server/routers/index.ts`에 등록
4. **페이지**: `client/src/pages/`에 컴포넌트 생성 → `App.tsx` 라우트 + `AppLayout.tsx` 네비 추가

### Git 커밋
- 한글 커밋 메시지: 임시 파일에 본문 작성 후 `git commit --file=<path>` 사용 (`.commitmsg`는 gitignored 임시명)
- `main` 직접 push → Railway 자동 배포

---

## 14. OCR 매입 자동입력

### 현재 상태 (Phase 1~3 완료)
- 프롬프트 강화 (회전 대응, 양식 4유형 세분화, 수량/단가 휴리스틱)
- 서버 검증 (수량↔단가 뒤바뀜, 이상치 경고, 합계 크로스체크)
- 거래처별 OCR 프로파일 자동 생성/이동평균 단가 학습
- 사용자 OCR 수정 데이터 축적 + 통계 API
- 동적 프롬프트 주입 (거래처 프로파일 기반 품목/단가 힌트)
- 서버 AI 자동 회전 (`detectAndFixOrientation`) — 클라이언트 수동 회전 UI 불필요

### 사용자 가이드 (촬영·확인)
- **촬영**: 정방향, 전체 프레임, 그림자 회피, 배경 단순
- **확인**: 노란색 uncertain 항목 반드시 확인, 거래처명·수량/단가 뒤바뀜 수정, 저장 시 학습 데이터 자동 축적
- **신규 거래처**: 1~2회 수동 수정 후 정확도 향상

### 관련 파일
- `server/ocr.ts` — 엔드포인트 + 프롬프트 + 검증 + buildProfileHint
- `client/src/lib/imageResize.ts` — 클라이언트 이미지 전처리 (OCR_HIGH: 2560px/0.92)
- `client/src/pages/DailyOpsPage.tsx` — OCR UI
- `scripts/ocr-test.ts` — OCR 정확도 테스트
- `docs/ocr-improvement-plan.md` — 전체 기획서

---

## 15. Railway 인프라 (Hobby Plan)

| 항목 | 한도 | 비고 |
|---|---|---|
| 월 구독료 | $5 (포함 크레딧 $5) | 초과분만 청구 |
| 서비스당 CPU/RAM | 48 vCPU / 48 GB | $20/vCPU·$10/GB 월 |
| 볼륨 | 5 GB/서비스, 10개/프로젝트 | $0.15/GB 월 |
| 임시 스토리지 | 100 GB | 배포 시 초기화 |
| 네트워크 Egress | — | $0.05/GB |
| 이미지 보존 | 72시간 | 롤백용 |

**주의**: DB(MySQL)도 볼륨 기반 → 5GB 한도. 파일 업로드는 임시 스토리지라 배포 시 초기화 → 영구 저장 필요 시 외부 스토리지 검토.

---

## 16. 알려진 기술 부채

- **`mysql2.createConnection` 남용**: server/ 내 11개 파일이 `mysql.createConnection()` 직접 호출 → 풀 미재사용. Drizzle 인스턴스로 일원화 필요.
- **클라이언트 번들 1.5MB**: `index-*.js` 청크 500kB 경고. `manualChunks` 또는 동적 import 미적용. jspdf/xlsx/html2canvas 지연 로딩 후보.
- **ignored build scripts**: `sharp`, `esbuild`, `@tailwindcss/oxide`, `core-js` postinstall 미실행. 필요 시 `pnpm approve-builds` 선별 승인.
