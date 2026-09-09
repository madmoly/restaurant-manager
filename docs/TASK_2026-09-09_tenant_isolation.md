# TASK: 사업그룹 완전 분리 (테넌트 격리)

> 작성: 2026-09-09 (Cowork) · 감사 원본: `docs/tenant-isolation-audit-2026-09-09.md`
> 정책(확정): ① 전체 매장·사용자 열람은 **master만** ② 사업그룹 간 **완전 분리** (읽기/쓰기/존재 여부 노출 전부) ③ 현재 그룹 간 사용자 겹침 없음(사용자 진술 — PR2에서 SQL로 검증)
> 진행: PR1 → PR2 → PR3 순차. 각 PR은 독립 배포 가능. 각 PR 끝에 `pnpm run build` + §4 5항 보고 후 push 승인.

---

## 0. 착수 전 확인

- `git status -sb`: 미커밋 `docs/store-analysis-spec.md`(M) 존재 — 본 작업 커밋에 섞지 말 것.
- 기준 커밋 0e69218. 감사 이후 라우터 변경이 있으면 `git log --oneline 0e69218.. -- server/` 로 차이 확인 후 §2 목록 재검증.
- 스코핑 기준값 정의 (전 PR 공통): **effectiveOwnerId** = master → null(무제한) / admin → `users.parentId ?? userId` / user → 소속 매장의 `restaurants.ownerAdminId`. `restaurantScope.ts`의 `getOwnedRestaurants`가 이미 이 규칙을 씀.

---

## PR1: 즉시 차단 (스키마 변경 없음)

### 1-1. `server/middleware/storeAuth.ts` — admin 읽기에도 소유 검증

현재: `systemRole === "admin"` 분기에서 `requireWrite && !storeRole`일 때만 ownerAdminId 검사.
변경: admin은 **읽기/쓰기 무관**하게 `restaurants.ownerAdminId === effectiveOwnerId` 이거나 `restaurant_users` 배정이 있어야 통과. 배정만 있고 ownerAdminId가 다른 경우(타 그룹 매장에 배정된 admin)는 **거부** — 완전 분리 원칙.

```ts
if (systemRole === "admin") {
  const [r] = await db.select({ ownerAdminId: restaurants.ownerAdminId }).from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
  if (!r) throw NOT_FOUND;
  const [me] = await db.select({ parentId: users.parentId }).from(users).where(eq(users.id, userId)).limit(1);
  const effectiveOwnerId = me?.parentId ?? userId;
  if (r.ownerAdminId !== effectiveOwnerId) throw FORBIDDEN("다른 사업그룹의 매장입니다");
  return { storeRole };
}
```
`requireStoreManager`는 내부적으로 `verifyStoreAccess(…, true)`를 호출하므로 자동 반영. 함수 상단 주석(admin 읽기 정책)도 갱신.

**완료 조건**: 그룹 A admin 세션으로 그룹 B restaurantId에 `sales.listByMonth`, `restaurants.getStaff`(PR3 전이라 이건 아직 열림 — 제외), `schedules.listByRestaurant`, `staff.listActive` 호출 → FORBIDDEN. 자기 그룹 매장은 정상.

### 1-2. `server/helpers/restaurantScope.ts` — 사용자 스코프 헬퍼 추가

```ts
/** 호출자 스코프 안의 userId 집합. master → null(무제한). */
export async function getScopedUserIds(userId: number, role: string): Promise<number[] | null>
// admin: getOwnedRestaurantIds → restaurant_users.userId DISTINCT (resignedAt 무관 — 퇴사자도 자기 그룹 소속)
//        + 자기 자신 + 자기 하위 SUB대표(users.parentId = effectiveOwnerId) + effectiveOwnerId
// user : 본인 배정 매장(resignedAt IS NULL)의 restaurant_users.userId DISTINCT

/** 대상 userId가 스코프 밖이면 FORBIDDEN. master는 통과. */
export async function assertUserInScope(callerId: number, role: string, targetUserId: number): Promise<void>
```
PR2에서 `users.ownerAdminId` 컬럼이 생기면 admin 분기를 컬럼 기준으로 교체(§PR2-3). PR1에서는 배정 기반으로 우선 닫는다.

### 1-3. `server/routers/users.ts`

| 프로시저 | 변경 |
|---|---|
| `list`, `listWithAssignments` | `adminProcedure` 유지하되 본문에서 `getScopedUserIds` 필터. master는 무필터. assignments 조인도 `ownedRestaurantFilter`로 제한 |
| `get` | `assertUserInScope(ctx.user.userId, ctx.user.role, input.id)` 선행. 본인은 항상 허용 |
| `update` | 대상 != 본인이면 `assertUserInScope`. 추가로 **대상 role이 admin이면 master만** (현재는 master 대상만 보호) |
| `delete` | `assertUserInScope` 선행 |
| `updateStaffCredentials` | 본문 첫 줄에 `await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true)` |
| `updateHealthCert`, `updateBankBook` | input에 `restaurantId` 추가 → `verifyStoreAccess(…, true)` + 대상이 그 매장 배정자인지 확인. 클라이언트 호출부 `client/src/pages/StaffPage.tsx` L273·L296에 restaurantId 전달 |
| `createSubAdmin` | 변경 없음 (parentId 체인 2단 방지: `ctx.user.role === "admin"`이고 본인 parentId가 있으면 거부) |

### 1-4. `server/index.ts` — Express 인증 미들웨어

```ts
// /api/upload, /api/ocr 마운트 직전
import { requireSession } from "./middleware/httpAuth";   // 신규 파일
app.use("/api/upload", requireSession, uploadRouter);
app.use("/api/ocr", requireSession, ocrRouter);
app.use("/uploads", requireSession, express.static(UPLOAD_ROOT));
```
`server/middleware/httpAuth.ts` 신규: 쿠키 `session` → `verifyToken` → `req.user = payload`, 실패 시 401 JSON. `server/index.ts` L1582 error-report의 쿠키 파싱 로직을 여기로 옮겨 재사용.
클라이언트 fetch는 same-origin이라 쿠키 자동 전송 — 클라이언트 변경 없음 (`grep -c credentials` 0건 확인됨).

`server/ocr.ts` 내부 추가 게이트:
- `/export-dataset/*`, `/tracking`, `/corrections/stats`, `/gdrive/*`, `/debug` → `req.user.role === "master"` 아니면 403
- `/extract-*`, `/reanalyze-purchase`, `/submit-correction`, `/update-counterparty-info`, `/corrections`(GET) → `req.body.restaurantId`(또는 query) 필수 + `verifyStoreAccess(req.user.userId, req.user.role, restaurantId, false)` (쓰기성 엔드포인트는 `true`)
`server/upload.ts`: 각 엔드포인트 `req.body.restaurantId` 필수 + `verifyStoreAccess(…, true)`. multer 이후 body 파싱되므로 미들웨어는 `upload.single()` **뒤**에 배치. 클라이언트 FormData에 restaurantId 미첨부인 호출부는 추가 (`grep -rn "api/upload/" client/src`로 11곳 확인).

**완료 조건**: 로그아웃 상태 `curl -X POST /api/ocr/extract-purchase` → 401. `curl /uploads/<any>` → 401. `GET /api/ocr/export-dataset/purchases` admin 세션 → 403. 로그인 후 DailyOps OCR·체크리스트 사진 업로드·정산 이미지 업로드 정상.

### 1-5. `client/src/App.tsx` L139 — admin `/users` 라우트

정책 ①에 따라 **제거**. AppLayout 네비에서 admin의 "사용자" 메뉴도 제거. (admin이 자기 그룹 사용자를 볼 화면이 필요하면 별도 이슈 — 현재 요구에 없음.) `AdminDashboard.tsx` L43 `users.list`는 1-3 스코핑으로 자기 그룹 인원수만 표시되므로 유지.

### 1-6. 게이트 부재 프로시저 중 **쓰기·고위험** 우선 전환 (나머지는 PR3)

| 라우터 | 프로시저 | 처리 |
|---|---|---|
| monthlyClosings | `close` | 본문 첫 줄 `requireStoreManager(ctx.user.userId, ctx.user.role, input.restaurantId)` |
| monthlyClosings | `deleteImage`, `updateImageAmount` | 동일 |
| electronicContracts | `createRestaurantContract` | 동일 |
| electronicContracts | `updateRestaurantContract` | id → `restaurant_contracts.restaurantId` 조회 후 `requireStoreManager` |
| electronicContracts | `getEmploymentContract` | row.restaurantId로 `verifyStoreAccess(…, false)` + (user 레벨이면 `row.employeeId === ctx.user.userId` 또는 매장 owner/supervisor) |
| items | `merge` | targetId·sourceIds 전부 같은 restaurantId인지 확인 후 `requireStoreManager` |
| notifications | `create` | recipientId가 `getScopedUserIds` 안에 있는지 확인. system_announcement 타입은 master 전용 |
| users | (1-3에서 처리) | — |

**완료 조건**: 표의 각 프로시저를 타 그룹 restaurantId/row id로 호출 시 FORBIDDEN.

---

## PR2: `users.ownerAdminId` — 사용자 단일 그룹 귀속

### 2-1. 스키마 `drizzle/schema.ts` users
```ts
ownerAdminId: int("ownerAdminId"),   // NULL = master 또는 미배정
```
인덱스: `index("idx_users_owner").on(t.ownerAdminId)`. phoneNormalized는 현재 UNIQUE 없음(앱 레벨 dedupe) → 스키마 제약 추가 안 함.

### 2-2. 마이그레이션 `server/index.ts`
```ts
await addColumnIfNotExists("users", "ownerAdminId", "INT DEFAULT NULL");
```
백필은 **자동 마이그레이션에 넣지 않는다** (정지 조건 #3). `scripts/backfill-user-owner.ts` 작성 → 사용자 승인 후 1회 실행.

백필 스크립트 순서:
1. 겹침 검증 (0행이어야 진행):
   ```sql
   SELECT ru.userId, COUNT(DISTINCT r.ownerAdminId) g
   FROM restaurant_users ru JOIN restaurants r ON r.id = ru.restaurantId
   WHERE r.deletedAt IS NULL AND r.ownerAdminId IS NOT NULL
   GROUP BY ru.userId HAVING g > 1;
   ```
   (resignedAt 조건 없이 — 퇴사 이력까지 한 그룹이어야 안전. 1행 이상이면 중단·보고.)
2. admin: `UPDATE users SET ownerAdminId = COALESCE(parentId, id) WHERE role='admin'`
3. user: 배정 매장의 ownerAdminId (활성 우선, 없으면 최근 퇴사 매장)
   ```sql
   UPDATE users u JOIN (
     SELECT ru.userId, r.ownerAdminId FROM restaurant_users ru JOIN restaurants r ON r.id=ru.restaurantId
     WHERE r.ownerAdminId IS NOT NULL GROUP BY ru.userId, r.ownerAdminId
   ) x ON x.userId = u.id SET u.ownerAdminId = x.ownerAdminId WHERE u.role='user';
   ```
4. 결과 보고: role별 NULL 잔존 건수. master는 NULL 정상. user NULL = 배정 이력 0건 → 목록으로 출력(수동 판단).

### 2-3. 코드 전환
- `getScopedUserIds`/`assertUserInScope` admin 분기를 `users.ownerAdminId = effectiveOwnerId` 조회로 교체 (조인 제거).
- 사용자 생성 지점 4곳에 ownerAdminId 기록:
  - `staff.quickAdd`: `restaurants.ownerAdminId` of input.restaurantId
  - `invites.register`: `invite.restaurantId` → restaurants.ownerAdminId
  - `users.createSubAdmin`: `parentId ?? ctx.user.userId`
  - `businessGroups.create` newAdmin: 생성된 admin 자신의 id / `users.create`: master가 만들면 NULL, admin이 만들면 effectiveOwnerId
- 그룹 내 dedupe 전환: `staff.checkPhone`, `staff.quickAdd`의 `users.phoneNormalized` 조회에 `AND ownerAdminId = <매장 ownerAdminId>` 추가. 타 그룹 동일 번호는 "new"로 취급(계정 2개 허용).
- `restaurants.addStaff`: 대상 `users.ownerAdminId`가 매장 ownerAdminId와 다르면 FORBIDDEN(NULL이면 매장 그룹으로 귀속시키며 허용 — 미배정 사용자 흡수).
- `businessGroups.assignStore`(master): 매장 그룹 이동 시 그 매장 배정자 중 다른 매장 배정이 없는 사용자의 ownerAdminId도 이동. 있는 사용자는 이동 불가 에러(겹침 방지).
- `users.delete` admin 의존 검사에 `users.ownerAdminId = target.id` 인 사용자 수 추가.

**완료 조건**: 백필 후 `SELECT role, COUNT(*) FROM users WHERE ownerAdminId IS NULL GROUP BY role` → master만(또는 승인된 미배정 목록). 그룹 B 직원 전화번호로 그룹 A `checkPhone` → "new". 그룹 A admin `users.list` = A 소속만.
추가 완료 조건(PR1 이관 §3-4 c): **archived 매장(`deletedAt IS NOT NULL`)에만 배정 이력이 있는 사용자가 admin의 `users.list`에 다시 나타나고 `users.delete`도 가능해야 한다.** PR1의 `getScopedUserIds` admin 분기가 `getOwnedRestaurantIds`(deletedAt IS NULL) 기반이라 생긴 누락으로, `users.ownerAdminId` 컬럼 조회로 교체하면 자동 해소된다.

---

## PR3: 게이트 부재 프로시저 일괄 전환 + 재발 방지

### 3-1. `store*Procedure` 전환 (input에 restaurantId 있는 것)

| 라우터 | 프로시저 → 게이트 |
|---|---|
| items | `list`, `searchSimilar` → storeReadProcedure / `create`, `update`(id→restaurantId 조회) → storeManagerProcedure / `findSimilarGroups` → storeManagerProcedure |
| counterpartyItems | `listByCounterparty`(counterpartyId→counterparties.restaurantId 조회 후 verifyStoreAccess) / `create` → storeManagerProcedure / `linkToExistingItem`, `update`, `delete`(id→restaurantId 조회 후 requireStoreManager) |
| pricing | `getLastPriceByCounterpartyItem`(id→restaurantId) / `getRecentComparisonByItem` → storeReadProcedure |
| restaurants | `get`(id를 restaurantId로 verifyStoreAccess) / `getStaff`, `getShiftPresets` → storeReadProcedure / `saveShiftPresets`, `createShiftPresetType`, `toggleShiftPreset` → storeManagerProcedure / `deleteShiftPreset`(id→restaurantId) |
| storeChecklists | `createTemplate` → storeManagerProcedure / `getLog`, `listLogs` → storeReadProcedure / `saveLog` → storeWriteProcedure |
| leaveBalance | `getBalance`, `getTransactions`, `checkHolidayWork` → storeReadProcedure + (user 레벨이면 `input.userId === ctx.user.userId`) |
| invites | `delete`(id→restaurantId 조회 후 requireStoreManager) |
| recipes | `getById`(row.restaurantId로 verifyStoreAccess) |
| scheduleChangeRequests | `create`, `listMine` → storeReadProcedure(본인 배정 확인 목적) + scheduleId가 해당 매장 소속인지 확인 |
| feedback | `submit` restaurantId 있으면 verifyStoreAccess |
| errorLogs | `list`, `recentSummary` → masterProcedure |
| `restaurants.updateStaffRole` | admin(비master)도 자기 그룹 매장이면 허용하도록 `verifyStoreAccess(…, true)`로 통일 (현재는 매장 배정 없으면 거부) |

주의: `storeReadProcedure`는 input을 `.input(storeBaseInput)`으로 머지하므로 기존 `.input(z.object({restaurantId, ...}))`에서 restaurantId 중복 선언 제거.
클라이언트 호출부는 input 형태가 그대로라 대부분 무변경. `updateHealthCert/updateBankBook`(PR1)만 restaurantId 추가.

### 3-1-a. PR1에서 이관된 잔여 항목 (2026-09-10 Code)

PR1 구현 중 확인했으나 범위를 넘어 손대지 않은 것들. PR3에서 처리한다.

| # | 항목 | 내용 / 처리 방향 |
|---|---|---|
| a | **`/uploads` 매장 스코프 부재** | PR1은 `requireSession`만 적용 → 로그인한 사용자면 누구나 URL만 알면 타 그룹 통장사본·보건증 열람 가능. 파일경로↔restaurantId 매핑 검증 또는 서명 URL(signed URL) 전환 필요. **잔존 위험 중 가장 큼.** |
| b | **multer가 인가 전에 디스크 기록** | `upload.single(...) → requireStore(...)` 순서라 403이어도 파일은 이미 저장됨. 403 시 `fs.unlink` 정리, 또는 `restaurantId`를 query로 받아 multer 앞에서 검증하도록 전환. |
| c | **`getScopedUserIds` archived 매장 누락** | admin 분기가 `getOwnedRestaurantIds`(deletedAt IS NULL) 기반 → archived 매장에만 배정 이력이 있는 사용자가 목록에서 빠지고 삭제도 불가. **PR2 `users.ownerAdminId` 전환으로 해소** (PR2 완료 조건에 명시됨). |
| d | **`/api/ocr/detect-orientation`** | `requireSession`만 적용, `requireStore` 없음. 클라이언트 미사용 + 반환값이 회전각뿐이라 저위험. |
| e | **StaffPage 보건증·통장사본 업로드 404** | `POST /api/upload`(하위경로 없음)를 호출하는데 `uploadRouter`에 해당 라우트 부재 — PR1 이전부터 깨져 있던 기능. **별도 이슈로 분리**하며 본 TASK 범위 아님. |

### 3-2. 재발 방지 스크립트 `scripts/check-store-gate.ts`
`server/routers/*.ts`를 파싱해 `(protectedProcedure|managerProcedure|ownerProcedure)`로 시작하고 input에 `restaurantId`가 있으며 본문에 `verifyStoreAccess|requireStoreManager|ownedRestaurantFilter|getOwnedRestaurant` 가 없는 프로시저를 나열, 1건 이상이면 exit 1. `package.json` `"build"` 앞에 `"prebuild": "tsx scripts/check-store-gate.ts"`. 감사 §2 파이썬 스니펫이 원형.

### 3-3. 문서
- CLAUDE.md §8: "admin은 자기 사업그룹(ownerAdminId) 범위만. 전체는 master" 한 줄 추가, §9 `/users` master 유지, §11 users에 ownerAdminId, §12에 "사용자 단일 그룹 귀속" 추가.
- `docs/tenant-isolation-audit-2026-09-09.md` 상단에 "해결: PR1 <sha> / PR2 <sha> / PR3 <sha>" 기입.

**완료 조건**: `pnpm run build` 통과(prebuild 게이트 0건). 그룹 A user 계정으로 그룹 B restaurantId 전 프로시저 호출 스크립트(간단 tRPC 클라이언트, `tests/`에 두되 실행은 로컬 DB 없으므로 프로드 read-only 계정 2개로 수동) → 전부 FORBIDDEN.

---

## 리스크 / 롤백

- PR1 1-1의 접근 변화는 **정책상 의도된 결과**이므로 배포 판단 근거가 아니다. 배포 전 SQL 검증은 **해제**(2026-09-10 결정).
  - 사유 ①: 로컬에서 프로드 DB 직접 연결 불가 확정 — `.env` DATABASE_URL이 `mysql.railway.internal` 내부망 전용, public proxy URL 없음. Railway 대시보드는 사용자 Chrome 세션에서만 접근 가능.
  - 사유 ②: 두 케이스 중 어느 결과가 나와도 코드는 바뀌지 않는다.
    - 타 그룹 매장에 `restaurant_users`로 배정된 admin의 접근 차단 → 완전 분리 정책상 의도된 결과.
    - `restaurants.ownerAdminId IS NULL` 매장이 master 전용이 되는 것 → 정책상 정상. 기존에도 `getOwnedRestaurants`가 NULL을 제외해 admin 목록엔 미노출이었다.
  - 대체 확인: **배포 후 master 계정 `/groups` 화면에서 사업그룹 미배정 매장 유무를 육안 확인**한다. 운영 통지용이며 배포 게이트가 아니다.
- PR1 1-4 `/uploads` 인증화: 근로계약서 서명 페이지(`/sign/:token`, 비로그인)에서 이미지 로드가 있으면 깨짐 → Cowork 확인 결과 `ContractSignPage.tsx`에 `/uploads` 참조 0건. `JoinPage`도 0건 확인 완료(Code). 서비스워커는 캐시 write가 없어 401 캐싱 없음.
- 롤백: 각 PR 단일 커밋 revert. PR2 컬럼은 남겨도 무해.

## 진행 로그
(Code가 append)

- 2026-09-10 Code(d4bd196) — PR1 전량 구현(1-1~1-6). storeAuth admin 분기를 ownerAdminId 일치 필수로 재작성 / `getScopedUserIds`·`assertUserInScope` 신설 / users 라우터 7개 프로시저 스코프 검증 / `server/middleware/httpAuth.ts` 신설해 `/api/upload`·`/api/ocr`·`/uploads`에 세션 게이트 + OCR 관리 엔드포인트 master 전용 + 매장 엔드포인트 restaurantId 검증 / 클라이언트 업로드·OCR 호출부 11곳 restaurantId 전달 / admin `/users` 라우트·네비 제거 / 게이트 부재 쓰기 프로시저 8종 보강. `pnpm run build` 통과, tsc 신규 에러 0건(기존 46건 유지). 미해결: §3-1-a a~e 항목 PR3 이관, c는 PR2에서 해소.
