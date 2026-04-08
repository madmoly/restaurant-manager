# 계정·권한·직원관리 재설계 — Claude Code 수정 프롬프트

> 작성 기준: 2026-04-08
> 대상: `restaurant-manager` (React 19 + tRPC v11 + Drizzle + MySQL)
> 실행 방식: **단계별 커밋**. 한 단계 끝날 때마다 `pnpm run build` 통과 확인 → commit → push.
> 원칙: 점장(owner) 중심. 매니져는 운영/스케줄만. 직원 교체 잦음(월 5명±) 전제.

---

## 0. 전제 · 불변 규칙 (전 단계 공통)

- **권한 계층**: `master > admin > owner(점장) > supervisor(매니져) > staff(직원)`. 시스템 role(`users.role`)은 `master/admin/user` 3종으로 수렴. 레거시 `manager/employee` 값은 DB에는 남겨두되 **신규 생성 금지**.
- **매장 스코핑 단일 진실 원천**: `server/helpers/restaurantScope.ts`. 모든 매장 목록/ID 조회는 이 헬퍼 경유.
- **모든 매장 귀속 mutation**은 `verifyStoreAccess(userId, role, restaurantId, requireWrite)` 호출 필수. 예외 없음.
- **인사권(HR)은 owner 전용**. 매니져(supervisor)는 스케줄/운영/체크리스트만.
- **계약서 ↔ 직원정보 동기화는 단방향**: 서명 이벤트 → 직원정보. 직원정보 수동 편집은 "불일치 경고"만 띄우고 차단하지 않음(정책 a).
- **employee_contracts 테이블명 유지**, 주석으로 "민감영역 현재상태 (staff info의 일부)" 명시.
- **기간 한정 승격 금지**. 역할은 owner / supervisor / staff 상태값 그대로.

---

## 단계 1 — 보안/권한 체크 패치 (commit: `fix(auth): tighten store-scoped procedures`)

### 1-1. `server/trpc.ts` — managerProcedure / ownerProcedure 일관화

**현재 문제**: `managerProcedure`가 `restaurant_users` 조회 시 `resignedAt IS NULL` 필터 없음 → 퇴사자도 매니져 권한 유지 가능.

**수정**:
- managerProcedure / ownerProcedure의 storeRoles 서브쿼리에 `and(eq(restaurantUsers.userId, ctx.user.userId), isNull(restaurantUsers.resignedAt))` 추가.
- 두 procedure 모두 `master`와 `admin`은 상위 권한으로 즉시 통과.
- owner 레벨 판정: storeRole ∈ {`owner`, `store_manager`(legacy)}.
- manager 레벨 판정: storeRole ∈ {`owner`, `supervisor`, `store_manager`, `manager`(legacy)}.

### 1-2. `server/routers/restaurants.ts` — 누락된 verifyStoreAccess 주입

**대상 mutation (전부 `verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true)` 선행 호출)**:
- `addStaff` — 지금 **완전 노출**. 임의 restaurantId로 타 매장에 직원 꽂기 가능.
- `updateStaffHireDate`
- `updateWeeklyOffDays`
- 기타 매장 ID 받는 mutation 전수 감사 → 누락 전부 패치.

### 1-3. `server/routers/users.ts` — create 역할 제한

- `create` input role enum에서 `manager`, `employee` 제거. `["master","admin","user"]`만 허용.
- `master` 생성은 `masterProcedure`로만. `admin` 생성은 `adminProcedure`(현행 유지).
- 일반 직원 생성은 이 라우터 쓰지 말 것 → **단계 4의 `staff.quickAdd`로 일원화**.

### 1-4. 완료 조건
- [ ] `grep -rn "managerProcedure\|ownerProcedure" server/routers` → storeRole 조회에 resignedAt 필터 반영 확인
- [ ] `restaurants.addStaff`에 verifyStoreAccess 있음
- [ ] 타 매장 ID 넘겨 addStaff 호출 시 FORBIDDEN (수동 테스트)
- [ ] `pnpm run build` 통과

---

## 단계 2 — 사업그룹 스코핑 복구 (commit: `fix(restaurants): scope list by ownerAdminId`)

### 2-1. `server/routers/restaurants.ts` → `list`
- 현재 `protectedProcedure`로 전체 실매장 반환 → **admin A가 admin B 매장까지 볼 수 있음**.
- `getOwnedRestaurants(ctx.user.userId, ctx.user.role)` 호출로 교체.
- `master`는 헬퍼 내부에서 이미 전체 반환하므로 분기 불필요.

### 2-2. `client/src/contexts/RestaurantContext.tsx`
- 현 흐름 그대로 두되, admin이 `restaurants.list`로 자기 사업그룹만 받는지 네트워크 탭으로 확인.

### 2-3. 완료 조건
- [ ] admin A 로그인 → 자기 매장만 보임
- [ ] master 로그인 → 전체 실매장 보임
- [ ] Tutorial 매장 누수 없음

---

## 단계 3 — 스키마 확장 (commit: `feat(schema): add phoneNormalized + contract snapshot fields`)

### 3-1. `drizzle/schema.ts`

**users**:
- `phoneNormalized: varchar(20)` — 숫자만 남긴 정규화 전화번호. nullable.
- 인덱스 `idx_users_phone_normalized(phoneNormalized)`.

**employment_electronic_contracts** (박제 스냅샷 테이블 — 서명 이후 immutable):
- 스냅샷 보강 필드 (이미 있으면 skip):
  - `snapshotName`, `snapshotResidentNumber`, `snapshotAddress`, `snapshotBankAccount`, `snapshotPhone`
  - `snapshotWage`, `snapshotWageType`, `snapshotWeeklyHours`, `snapshotWeeklyOffDays`
  - `snapshotContractStart`, `snapshotContractEnd`
  - `snapshotAffiliatedCompany`
- 모두 서명 시점 값으로 INSERT, 이후 UPDATE 금지 (서버 코드에서 강제).

**employee_contracts** (민감영역 현재 상태 — staff info 일부):
- 테이블 상단에 주석 추가:
  ```ts
  // 직원의 "현재 유효한" 민감영역(급여/근무조건/계좌/주민번호)의 최신값.
  // 역사적 증거는 employment_electronic_contracts 사용.
  // 이 테이블은 직원정보 화면에서 참조되며, 계약서 서명 이벤트로만 갱신된다.
  ```

### 3-2. `server/index.ts` 자동 마이그레이션
- ALTER TABLE IF NOT EXISTS로 위 컬럼/인덱스 추가.
- 기존 데이터 마이그레이션: `UPDATE users SET phoneNormalized = REGEXP_REPLACE(phone, '[^0-9]', '') WHERE phoneNormalized IS NULL AND phone IS NOT NULL`.

### 3-3. 완료 조건
- [ ] `pnpm run build` 통과
- [ ] Railway 배포 후 로그에 마이그레이션 성공 출력
- [ ] 전화번호 있는 기존 유저의 phoneNormalized 채워짐

---

## 단계 4 — staff 라우터 신설 (commit: `feat(staff): unified staff lifecycle router`)

### 4-1. `server/routers/staff.ts` (신규)

모든 procedure는 **ownerProcedure + verifyStoreAccess(write)** 조합. 매니져(supervisor) 접근 불가.

#### `quickAdd` (input: `{ restaurantId, name, phone, role: "supervisor"|"staff", sendInvite: boolean }`)
1. phone 정규화 → `phoneNormalized`
2. 동일 `phoneNormalized` 사용자 조회:
   - **없음** → 신규 `users` 생성(role=`user`, mustChangePassword=true, 임시 pw), `restaurant_users` 배정
   - **있음 + 본 매장에 resignedAt 존재** → **재입사 감지**: `resignedAt=NULL`, `role=input.role`, `rehiredAt=NOW()` 업데이트. UI에 "재입사 복귀" 알림 반환.
   - **있음 + 다른 매장 근무중** → **겸직 감지**: 기존 user 재사용, 본 매장 배정만 신규 INSERT. UI에 "다른 매장 근무자" 안내.
   - **있음 + 본 매장 배정 이미 있음 + active** → error "이미 등록된 직원".
3. `sendInvite=true`면 초대코드 발급까지 원스텝 처리.
4. return `{ userId, restaurantUserId, status: "new"|"rehire"|"concurrent", inviteCode? }`.

#### `resign` (input: `{ restaurantId, userId, reason? }`)
- `restaurant_users.resignedAt=NOW()`, `resignReason=reason`.
- users 테이블은 건드리지 않음 (재입사/겸직 대비).
- `audit_logs`에 기록.

#### `reinstate` (input: `{ restaurantId, userId }`)
- resignedAt=NULL. 재입사 시 quickAdd 경유 권장이지만 명시 복원용.

#### `resetPassword` (input: `{ userId }`)
- 해당 직원이 본인 매장 소속인지 확인(restaurant_users row 존재).
- 임시 pw 재발급, mustChangePassword=true.

#### `changeRole` (input: `{ restaurantId, userId, newRole: "supervisor"|"staff" }`)
- owner 간 전환은 불가(본 procedure는 매장 역할만). owner 임명은 별도 관리자 플로우 유지.
- audit_logs 기록.

#### `listActive` (query, input: `{ restaurantId }`)
- managerProcedure 허용 (읽기는 매니져 가능).
- resignedAt IS NULL 필터. 각 row에 `mismatchedFields: string[]` 동봉 (단계 5에서 구현).

#### `listRecentlyResigned` (query, input: `{ restaurantId }`)
- 최근 90일 이내 resignedAt. 재입사 원클릭용.

### 4-2. `server/routers/index.ts`에 등록.

### 4-3. 완료 조건
- [ ] 매니져가 staff.quickAdd 호출 시 FORBIDDEN
- [ ] 동일 휴대폰 재등록 시 rehire 분기 작동
- [ ] 다른 매장 근무자 등록 시 concurrent 분기 작동

---

## 단계 5 — 계약서 서명 트랜잭션 + 단방향 동기화 (commit: `feat(contracts): one-way sync on signing`)

### 5-1. 필드 분류 (코드 상수로 `shared/contractFields.ts` 신설)

```ts
// A군: 계약서 전용 (서명 후 불변). 직원정보에 노출 X
export const A_FIELDS = [
  "wage", "wageType", "weeklyHours",
  "contractStart", "contractEnd",
] as const;

// B군: 직원정보 전용 (계약서와 무관)
export const B_FIELDS = [
  "healthCertUrl", "healthCertExpiry",
  "bankbookUrl", "username", "passwordHash",
] as const;

// C군: 계약서 → 직원정보 단방향 sync 대상
export const C_FIELDS = [
  "name", "phone", "address", "residentNumber",
  "bankAccount", "affiliatedCompany",
  "hireDate", "weeklyOffDays",
] as const;
```

### 5-2. `server/routers/electronicContracts.ts` → `signContract`

서명 완료 시 **단일 트랜잭션**:

1. 해당 계약서 `status='signed'`, `signedAt=NOW()`, 스냅샷 필드 전부 박제.
2. 같은 (userId, restaurantId)의 이전 active 전자계약서 `status='superseded'` 처리.
3. C군 필드를 적재 대상 테이블로 분배:
   - `users`: name, phone, phoneNormalized(재계산), address, residentNumber
   - `restaurant_users`: affiliatedCompany, hireDate, weeklyOffDays
   - `employee_contracts`: bankAccount, residentNumber (민감영역 미러), weeklyOffDays, wage, wageType, contractStart, contractEnd (A군도 민감영역 현재값으로 미러)
4. 실패 시 전부 롤백.

### 5-3. 불일치 감지 (`staff.listActive` / `staff.getDetail` 내부)

- 각 직원 row 조회 후, 최신 active 전자계약서 스냅샷과 C군 값 비교.
- 다른 필드명을 `mismatchedFields: string[]`로 반환.
- UI가 "⚠️ 계약서와 불일치: 주소, 계좌번호" 표시.
- **별도 플래그 컬럼 두지 않음** — 쿼리 시점 계산.

### 5-4. C군 수동 편집 정책 (정책 a)
- 직원정보 화면에서 C군 필드 수정은 **허용하되** mismatch 배지 즉시 표시.
- 근본 해결은 [재계약 작성] 버튼 → 신규 전자계약서 서명 → sync.
- 서버는 수동 편집을 막지 않음. 단, audit_logs에 `manual_c_edit` action 기록.

### 5-5. 완료 조건
- [ ] 서명 완료 시 users/restaurant_users/employee_contracts 한 번에 반영
- [ ] 중간 실패 시뮬레이션 → 전부 롤백
- [ ] listActive 응답에 mismatchedFields 배열 포함
- [ ] 이전 계약서가 superseded 처리됨

---

## 단계 6 — UI 재설계 (commit: `feat(ui): owner-centric staff page`)

### 6-1. `client/src/pages/StaffPage.tsx` 재작성

**레이아웃 (owner 뷰)**:
```
[매장 선택 드롭다운] (selectedRestaurantId가 0이면 페이지 자체를 로드하지 않음)

[+ 직원 추가]  (하나의 버튼 → 모달: 이름/전화/역할/초대발송 체크)

── 활동 직원 (staff.listActive) ──
[카드 1] 이름 · 역할 · ⚠️불일치배지(있을 때) · [상세] [퇴사]
[카드 2] ...

▾ 지난 3개월 나간 사람 (접힘, staff.listRecentlyResigned)
    [이름] ... [복귀] 버튼 → quickAdd rehire 분기
```

**[+ 직원 추가] 모달 동작**:
- 전화번호 입력 시 실시간 `staff.checkPhone` 조회 → 재입사/겸직 감지 시 배지 표시 후 확인.
- 완료 시 초대코드 즉시 노출(복사 버튼).

**직원 상세 모달 (2섹션)**:
```
[근무 조건] 🔒 (A군 + C군 일부: 시급/근무시간/계약기간/주휴일/소속회사)
  - read-only
  - [재계약 작성] 버튼 → 전자계약서 생성 플로우

[개인 정보] (C군 + B군: 이름/전화/주소/계좌/주민번호 / 보건증 / 로그인정보)
  - C군은 편집 가능하지만 ⚠️ "계약서와 불일치" 경고 표시
  - B군은 자유 편집
```

### 6-2. 매니져(supervisor) 뷰
- /staff 접근 시: `listActive`만 읽기 전용.
- [+ 직원 추가], [퇴사], [재계약 작성], [상세 편집] 버튼 **전부 숨김**.
- 시급/월급 필드도 숨김 (단계 6-3 참조).

### 6-3. 매니져 급여 필드 가시성 (기본 정책: **숨김**)
- StaffPage 카드/상세에서 `wage`, `wageType` 필드는 role !== `owner` && role !== `admin` && role !== `master`일 때 미렌더.
- 서버 `listActive` 응답에서도 매니져 호출 시 wage 필드 제거 (민감정보는 필드 drop으로 방어).

### 6-4. `client/src/pages/UsersPage.tsx`
- 일반 직원 생성 UI 제거. 여기는 master/admin 생성 전용으로 축소.
- "직원을 추가하려면 /staff 페이지로" 안내 링크.

### 6-5. `RestaurantContext` 방어
- selectedRestaurantId가 0/null인 상태에서 staff.* 쿼리가 실행되지 않도록 `enabled: !!selectedRestaurantId && selectedRestaurantId > 0` 가드.

### 6-6. 완료 조건
- [ ] owner 계정으로 직원 추가 → 재입사 → 퇴사 → 복귀 전체 플로우 확인
- [ ] supervisor 계정으로 /staff 진입 → 읽기만 가능, 급여 숨김
- [ ] 매장 미선택 상태에서 restaurantId=0 API 호출 발생하지 않음

---

## 단계 7 — 레거시 역할 정리 (commit: `chore(roles): freeze legacy manager/employee values`)

- `drizzle/schema.ts` users.role enum에 legacy 유지하되, 코드 레벨 `shared/permissions.ts`에서 **신규 쓰기 금지 화이트리스트** 운영.
- 일회성 데이터 정리 스크립트 `scripts/normalize-legacy-roles.ts`:
  - `users.role='manager'` → `user` + `restaurant_users.role='supervisor'` 보정
  - `users.role='employee'` → `user` + `restaurant_users.role='staff'` 보정
  - 로그로 변경 건수 출력.
- 스크립트는 수동 실행, 결과 audit_logs에 bulk 기록.

### 완료 조건
- [ ] 스크립트 dry-run 결과 확인 후 실제 적용
- [ ] users.role 분포가 master/admin/user 3종으로 수렴

---

## 단계 8 — 회귀 검증 체크리스트 (배포 전 수동 테스트)

### 권한 경계
- [ ] admin A가 admin B의 매장 리스트를 볼 수 없음
- [ ] 매니져가 staff.quickAdd / resign / changeRole 호출 시 FORBIDDEN
- [ ] 퇴사자 계정으로 로그인 → 해당 매장 API 전부 FORBIDDEN
- [ ] 퇴사자가 다른 매장에 현직이면 해당 매장은 정상 접근

### 점장 주요 플로우
- [ ] 신규 직원 등록 (전화번호 신규)
- [ ] 동일 전화번호로 재등록 → 재입사 감지 → 복귀 처리
- [ ] 타 매장 근무자 전화번호로 등록 → 겸직 감지
- [ ] 초대코드 발급 → 본인 자가등록 → 자동 로그인
- [ ] 퇴사 → "지난 3개월" 섹션에 표시 → [복귀] 버튼 작동

### 계약서 sync
- [ ] 전자계약서 서명 → 직원정보 C군 즉시 반영
- [ ] 이전 active 계약서가 superseded 처리
- [ ] 서명 후 직원정보에서 주소 수정 → mismatch 배지 표시
- [ ] [재계약 작성] → 신규 서명 → mismatch 해소

### UX
- [ ] 매장 미선택 상태에서 /staff 진입해도 restaurantId=0 에러 없음
- [ ] 매니져 계정에서 급여 필드 렌더되지 않음
- [ ] 모바일 레이아웃 깨짐 없음

### 성능/안정성
- [ ] `pnpm run build` 통과, 번들 경고 외 에러 없음
- [ ] Railway 자동 마이그레이션 성공 로그
- [ ] 에러 로그 신규 발생 없음 (errorLogs 테이블 확인)

---

## 부록 A — 커밋 메시지 템플릿 (`.commitmsg`)

```
fix(auth): tighten store-scoped procedures

- managerProcedure / ownerProcedure: resignedAt IS NULL 필터 추가
- restaurants.addStaff / updateStaffHireDate / updateWeeklyOffDays:
  verifyStoreAccess 주입 (권한 우회 방지)
- users.create: 레거시 role(manager/employee) 신규 생성 차단
```

## 부록 B — 열어둔 결정

- **employee_contracts 테이블명**: 유지 (주석으로 역할 명시). 리네임은 다운타임 리스크 대비 미착수.
- **C군 수동 편집 정책**: (a) 허용 + mismatch 경고. (b)/(c)는 추후 정책 강화 필요 시 전환.
- **매니져 급여 가시성**: 기본 숨김. 사업장별 요구가 있으면 restaurant flag로 on/off 가능.

## 부록 C — 미착수/연기 항목 (이 프롬프트 범위 외)

- JWT 세션 무효화(블랙리스트). 현재는 verifyStoreAccess 게이트로 실질 차단.
- 민감필드 암호화(residentNumber, bankAccount). Phase 2.
- mysql2.createConnection → pool 일원화. 기술부채 항목 유지.
- 클라이언트 번들 청크 분리.

---

**실행 순서 요약**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.
단계 1~2는 즉시 배포 가능한 보안 패치이므로 **가장 먼저** 적용.
