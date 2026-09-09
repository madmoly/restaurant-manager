# 사업그룹(테넌트) 격리 감사 — 2026-09-09

기준 커밋: 0e69218. Cowork 코드 리딩 기반 (실행 테스트 아님). 라우터 37개 + Express 엔드포인트 전수 grep 후 플래그된 프로시저 본문 확인.

## 0. 핵심 판단

사업그룹 격리는 **"매장(restaurants.ownerAdminId) 목록을 뽑는 경로"에만 존재**한다 (`restaurantScope.ts`, `restaurants.list`, `admin.*`, `analysis.*`).
그 외 경로는 격리 개념이 없다. 구체적으로 세 층이 비어 있다.

| 층 | 상태 | 결과 |
|---|---|---|
| A. 사용자(users) 테넌트 소속 | **스키마에 없음**. 사용자는 restaurant_users→restaurants.ownerAdminId 경유로만 간접 소속 | 사용자 단위 스코핑을 구현할 기준 자체가 없음. 배정 0건 사용자는 어느 그룹 소유도 아님 |
| B. 매장 ID 직접 지정 API의 게이트 | `verifyStoreAccess`가 **admin 읽기 = 전 매장 허용** | 어떤 대표든 타 그룹 매장 ID만 알면 매출·매입·급여·계약 전부 읽기 가능 |
| C. 게이트 자체가 없는 프로시저/엔드포인트 | 약 40개 | 로그인만 하면(직원 포함) 타 그룹 데이터 읽기/쓰기 가능. `/api/ocr`, `/api/upload`, `/uploads`는 로그인조차 불필요 |

사용자가 관찰한 "신규 그룹 관리자가 타 그룹 사용자를 본다"는 A+C의 표면 증상(`users.listWithAssignments`)이고, 가장 큰 구멍은 B다.

## 1. 심각도 상위 (계정 탈취 / 전 테넌트 노출)

| # | 위치 | 문제 | 영향 |
|---|---|---|---|
| 1 | `users.update` (adminProcedure) | 대상 userId에 대한 그룹 검증 없음. master 대상만 차단 | **타 그룹 대표(admin) 비밀번호 재설정 가능 → 그룹 통째 탈취**. isActive=false로 타 그룹 계정 정지도 가능 |
| 2 | `users.updateStaffCredentials` (managerProcedure) | 호출자가 `input.restaurantId`에 접근권 있는지 검증 없음. "해당 매장 직원인지"만 확인 | 아무 매장의 점장/매니저가 임의 restaurantId+userId로 **타 그룹 직원 비밀번호 변경** |
| 3 | `storeAuth.verifyStoreAccess` admin 분기 | `requireWrite=false`면 매장 소유 검증 없이 통과 | `verifyStoreAccess`/`storeReadProcedure`를 쓰는 **모든 read API**(sales, purchases, schedules, staff.listActive, electronicContracts, laborCost, monthlyClosings, pos 등)가 타 그룹 대표에게 열려 있음. UI 매장 셀렉터만 스코핑됨 |
| 4 | `/api/ocr/*`, `/api/upload/*` | 인증 미들웨어 없음 (쿠키 검사 0건) | `export-dataset/purchases`·`profiles`·`corrections`·`tracking`: **비로그인으로 전 매장 매입·거래처·품목 덤프**. 업로드 엔드포인트 비인증 |
| 5 | `/uploads` static | 인증 없음 + URL이 `users.get`/`getStaff`로 노출 | 통장사본·보건증·정산 증빙 이미지 URL만 알면 누구나 열람 |
| 6 | `users.get` (protectedProcedure) | id만 받음 | 로그인한 누구나 전 사용자의 phone/email/address/healthCertUrl/bankBookUrl 조회 |
| 7 | `users.list`, `users.listWithAssignments`, `users.delete` (adminProcedure) | 그룹 스코핑 없음 | 보고된 증상. delete는 타 그룹 user 삭제 가능 (배정 0건이면 통과) |

## 2. 게이트 부재 프로시저 목록 (로그인만 하면 타 매장·타 그룹 접근)

읽기/쓰기 모두 매장 소유 검증 없음. `restaurantId`나 row id를 클라이언트가 그대로 지정.

| 라우터 | 프로시저 | 종류 |
|---|---|---|
| items | list, create, searchSimilar, update, findSimilarGroups(manager), merge(manager) | R/W. merge는 타 매장 품목 ID를 넘겨 매입 이력 재배선 가능 |
| counterpartyItems | listByCounterparty, create, linkToExistingItem, update, delete | R/W 전부 |
| pricing | getLastPriceByCounterpartyItem, getRecentComparisonByItem | R |
| restaurants | get, getStaff, getShiftPresets | R. getStaff는 통장/보건증 URL·계약 스냅샷 포함 |
| restaurants | saveShiftPresets, createShiftPresetType, deleteShiftPreset, toggleShiftPreset (manager) | W. 호출자 매장 검증 없음 |
| restaurants | updateStaffRole | "호출자가 그 매장 owner인가"만 확인 → 실제로는 매장 격리됨. 단 admin(비master)은 매장 배정 없으면 거부 — 다른 라우터와 정책 불일치 |
| storeChecklists | createTemplate(manager), getLog, saveLog, listLogs | R/W |
| electronicContracts | createRestaurantContract, updateRestaurantContract (manager) | W. 타 매장 임대/수수료 계약 생성·수정 |
| electronicContracts | getEmploymentContract | R. id만으로 근로계약 전문(급여 포함) |
| leaveBalance | getBalance, getTransactions, checkHolidayWork | R. 타 직원 휴가 잔여 |
| monthlyClosings | close (manager) | W. **타 매장 월마감 실행** |
| monthlyClosings | deleteImage, updateImageAmount (manager) | W. restaurantId를 WHERE에 쓰지만 호출자 검증 없음 |
| invites | delete (manager) | W. 타 매장 초대코드 삭제 |
| notifications | create | W. 임의 recipientId에게 system_announcement 발송 가능 (피싱 벡터) |
| recipes | getById | R. isPublished만 확인, 매장 검증 없음 (공개 의도면 OK, 확인 필요) |
| scheduleChangeRequests | create | W. 타 매장 scheduleId에 변경요청 삽입 |
| feedback | submit | W. restaurantId 임의 (저위험) |
| users | updateHealthCert, updateBankBook (manager) | W. 임의 userId의 서류 URL 덮어쓰기 |
| errorLogs | list, recentSummary (admin) | R. 전 그룹 에러로그(메타데이터에 restaurantId·userId·URL 포함) |

정상 확인(참고): admin.*, analysis.*, restaurants.list/listWithSummary/softDelete, staff.*, schedules.* 대부분, purchasesV2.*, pos.*, settlementStatements.* — 단 **전부 #3(admin 읽기 전체 허용)에 종속**되므로 "매장 격리는 됐지만 그룹 격리는 안 됨".

## 3. 구조적 결함 (개별 패치로 안 닫히는 것)

1. **users에 테넌트 키 없음.** `businessGroupId` 또는 `ownerAdminId` 컬럼이 없어 "이 사용자는 누구 소유인가"를 정의할 수 없다. 현재 간접 소속은 (a) 배정 없는 사용자 = 무소속, (b) 두 그룹 매장에 동시 배정된 사용자 = 이중 소속 을 허용한다. `addStaff`는 대상 userId의 그룹/역할을 검증하지 않으므로 대표 A가 그룹 B 직원(또는 B 대표)을 자기 매장에 배정해 users 필드(전화·서류)를 끌어올 수 있다.
2. **verifyStoreAccess의 admin 읽기 정책이 사업그룹 도입(2026-03-30) 이전 가정.** "admin = 단일 대표" 시절 정책이 멀티 테넌트 환경에 그대로 남음. 이 함수 하나가 read 경로의 단일 진실 원천이라 여기만 고치면 #3 계열이 한 번에 닫히지만, 동시에 admin이 정말 타 그룹 매장을 봐야 하는 케이스(현재는 없음으로 추정)를 확인해야 함.
3. **게이트 사용 방식이 3종 혼재.** (a) `store*Procedure`(자동), (b) 본문에서 `verifyStoreAccess` 수동 호출, (c) 없음. (b)는 새 프로시저 추가 시 빠뜨리기 쉬워 §2 목록이 생긴 원인. `protectedProcedure` + `restaurantId` input 조합을 lint로 금지하지 않으면 재발.
4. **Express 엔드포인트는 tRPC 컨텍스트 밖.** `/api/ocr`, `/api/upload`, `/uploads`는 인증 레이어가 아예 없고 restaurantId를 req.body/query에서 신뢰. `/api/error-report`만 쿠키를 읽음.
5. **CLAUDE.md §9와 App.tsx 불일치.** 문서상 `/users`는 master 전용, 실제 라우팅은 admin에게도 열림. 서버(adminProcedure)도 admin 허용. 어느 쪽이 의도인지 결정 필요.
6. **SUB대표(parentId) 처리 불일치.** `restaurantScope`·`verifyStoreAccess`는 parentId를 상위로 치환하지만 `restaurants.softDelete`는 `ownerAdminId !== ctx.user.userId` 직접 비교 → SUB대표는 삭제 불가. `createSubAdmin`은 SUB대표가 다시 SUB대표를 만들 수 있어 parentId 체인이 2단 이상 생기는데 스코핑은 1단만 봄.

## 4. 수정 순서 제안 (완료 조건 포함)

| 단계 | 작업 | 완료 조건 |
|---|---|---|
| 1 | `verifyStoreAccess` admin 분기: read도 `ownerAdminId === effectiveOwnerId` 요구 | 그룹 A 대표 세션으로 그룹 B restaurantId에 `sales.listByMonth` 호출 시 FORBIDDEN |
| 2 | `users.update/delete/get`, `updateStaffCredentials`, `updateHealthCert/BankBook`: 대상 userId가 호출자 소유 매장에 배정된 사용자인지 검증하는 헬퍼(`assertUserInScope`) 도입 | 타 그룹 admin 비밀번호 변경 시도 FORBIDDEN |
| 3 | `/api/ocr`, `/api/upload`에 쿠키 JWT 미들웨어 + restaurantId 소유 검증. `export-dataset/*`·`tracking`은 master 전용 | 비로그인 curl 401 |
| 4 | `/uploads` 정적 서빙을 인증 라우트로 교체(또는 서명 URL) | 로그아웃 상태 이미지 URL 접근 401 |
| 5 | §2 목록 프로시저를 `store*Procedure`로 전환 (row id만 받는 것은 row→restaurantId 조회 후 검증) | 목록 0건 |
| 6 | users 테넌트 키 설계 결정 (컬럼 추가 vs 배정 기반 유지) 후 `users.list*` 스코핑 | admin 로그인 시 자기 그룹 사용자만 표시 |
| 7 | 재발 방지: `protectedProcedure`/`managerProcedure` + input에 `restaurantId` 있는 프로시저를 CI grep으로 실패 처리 | pnpm build 전 스크립트 통과 |

단계 1~3은 서로 독립 → 한 PR로 묶어도 됨. 단계 6은 설계 결정이 선행.

## 5. 정책 확정 (2026-09-09 사용자 결정)

1. 전체 매장·전체 사용자 열람은 **master만**.
2. **사업그룹 간 완전 분리.** 어떤 데이터도 그룹 경계를 넘지 않는다 (읽기·쓰기·존재 여부 노출 포함).

이에 따라 §5 미확인 항목은 모두 닫힘: `recipes.getById`도 그룹 스코핑 대상, `/api/ocr/export-dataset/*`·`tracking`은 master 전용.

### "완전 분리"가 추가로 요구하는 것 (기존 §1~§3에 없던 항목)

| # | 위치 | 현재 동작 | 완전 분리 위반 |
|---|---|---|---|
| A | `staff.checkPhone` | `users.phoneNormalized` **전역** 조회 → 타 그룹 사용자의 name 반환, "다른 매장 근무중" 상태 노출 | 전화번호로 타 그룹 직원 재직 여부·이름 탐색 가능 |
| B | `staff.quickAdd` | 전화번호 일치 시 **타 그룹 사용자 계정을 재사용**해 자기 매장에 배정 | 한 계정이 두 그룹에 걸침 → users 필드(주소·서류 URL·비밀번호)가 양쪽 대표에게 공유 |
| C | `restaurants.addStaff` / `invites.register` | 대상 userId·가입자의 그룹 검증 없음 | B와 동일 결과 |
| D | `users.username` UNIQUE 전역 | 가입/생성 시 "이미 존재하는 아이디" 에러 | 타 그룹 아이디 존재 여부 oracle (저위험, 단 완전 분리 정의상 위반) |
| E | `notifications.create` | recipientId 임의 | 그룹 경계 넘는 메시지 삽입 |
| F | `errorLogs`, `userFeedbacks` | restaurantId·userId 메타 포함, admin 조회 무스코핑 | master 전용으로 내리거나 그룹 스코핑 |

### 설계 결정 필요 (완전 분리 전제에서 피할 수 없음)

**사용자 = 단일 그룹 소속** 이어야 완전 분리가 성립한다. 현재 스키마(users에 테넌트 키 없음 + 전화번호 전역 dedupe)는 "한 사람 = 한 계정 = 여러 그룹" 모델이라 정면 충돌.

| 선택지 | 내용 | 비용 |
|---|---|---|
| (1) `users.ownerAdminId` 컬럼 추가, 사용자는 한 그룹에만 귀속 | 같은 사람이 두 그룹에서 일하면 계정 2개. 전화번호 UNIQUE를 (ownerAdminId, phoneNormalized)로 변경 | 마이그레이션: 기존 users를 restaurant_users→restaurants.ownerAdminId로 역산해 채움. 두 그룹에 걸친 기존 계정은 수동 분리 필요 (건수는 Railway Data 탭에서 확인) |
| (2) 스키마 유지, 모든 users 조회를 "호출자 소유 매장에 배정된 userId" 집합으로 필터 | 컬럼 없이 조인으로 해결 | 배정 0건 사용자는 무소속으로 남음(대표가 못 봄), 이중 소속 여전히 가능 → **완전 분리 미달** |

(2)는 완전 분리 요구와 맞지 않으므로 (1) 권고. master/admin 계정은 ownerAdminId NULL(master) 또는 본인/parentId(admin).

**전제 확인 (2026-09-09 사용자)**: 현재 사업그룹 간 사용자 겹침 없음 → (1)의 백필은 결정적(한 사용자의 모든 활성 배정이 같은 ownerAdminId). 수동 분리 작업 없음. 백필 전 검증 쿼리로 겹침 0건을 실제로 확인한 뒤 진행(정지 조건 #3 DB WRITE).

```sql
-- 겹침 검증: 결과 0행이어야 함
SELECT ru.userId, COUNT(DISTINCT r.ownerAdminId) AS groups
FROM restaurant_users ru JOIN restaurants r ON r.id = ru.restaurantId
WHERE ru.resignedAt IS NULL AND r.deletedAt IS NULL
GROUP BY ru.userId HAVING groups > 1;
```

배정 0건 사용자(퇴사자만 있는 계정 등)는 ownerAdminId NULL로 남음 → master만 열람. 필요 시 마지막 퇴사 매장의 ownerAdminId로 2차 백필.

### 수정 순서 갱신

§4 단계 6을 "(1) 채택 → `users.ownerAdminId` 추가 + 백필 + checkPhone/quickAdd/addStaff/register를 그룹 내부 dedupe로 전환"으로 확정. 단계 1~3(즉시 차단)과 독립이므로 먼저 배포 가능.
