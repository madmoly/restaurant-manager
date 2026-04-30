# POS P2 UI 설계 (v0.1 초안)

> 작성: 2026-04-30 (Cowork)
> 선행: P1 백엔드 36 endpoint 완료 (`pos-plan.md` v0.6 §15)
> 목표: 천호점(`DEPT_PICKUP`) 파일럿 운영 가능 수준의 UI 완성. 그 외 프리셋은 P3 이후.

---

## 1. P2 범위

**1차 (필수, P2 완료 조건)**
- 마스터 시스템 페이지: POS 활성화/비활성화 토글 (매장별)
- 매장 페이지: POS 설정 보기 + 점장이 프리셋 적용/오버라이드
- **메뉴 관리 화면** (점장 이상): 카테고리·메뉴·옵션 CRUD
- **카운터 UI** (`DEPT_PICKUP` 5화면): 메뉴 → 장바구니 → 결제수단 → 진동벨 → 완료
- **KDS 웹 화면** (주방 태블릿): 신규 주문 카드 + 조리 토글 + 알림음
- **일일 대조 화면**: 월정산 페이지 또는 별도 메뉴

**Out of P2 (후속)**
- 키오스크 UI (`KIOSK_PICKUP`)
- 후불 테이블 UI (`SHOP_TABLE`)
- 카드단말기 브릿지 연동
- 영수증 출력 (외부 단말이 발급하므로 불필요)
- 주방 프린터
- 디바이스 관리 화면 (master 시스템 페이지에 간단 list만, 페어링 흐름은 수동 최소화)

---

## 2. 라우트 구조 (제안)

`wouter` 사용 중. 기존 라우트 컨벤션 따름. 신규:

| 경로 | 페이지 컴포넌트 | 권한 | 비고 |
|---|---|---|---|
| `/system` | SystemPage (확장) | master | POS 활성화/비활성화 토글 추가 |
| `/store-info` | StoreInfoPage (확장) | manager+ | POS 설정(프리셋·4축 오버라이드) 카드 추가 |
| `/pos/:restaurantId/menu` | PosMenuPage | manager+ | 카테고리·메뉴·옵션 CRUD |
| `/pos/:restaurantId/counter` | PosCounterPage | staff+ | 카운터형 주문·결제 5화면 |
| `/pos/:restaurantId/kds` | PosKdsPage | staff+ 또는 디바이스 토큰 | 주방 화면 |
| `/pos/:restaurantId/orders` | PosOrdersPage | staff+ | 주문 이력·취소·환불 |
| `/pos/:restaurantId/reconciliation` | PosReconciliationPage | manager+ | 일일 대조 |

**대안**: `/pos/menu`처럼 매장 콘텍스트는 RestaurantContext에서 가져오고 URL에서 빼기. 기존 패턴(`/sales`, `/staff`)과 일치. → 권장: 매장 컨텍스트 활용, URL 단순화 (`/pos/menu`, `/pos/counter`, `/pos/kds`, ...).

**최종 권장 라우트** (RestaurantContext 활용):

```
/pos                          → POS 진입점, 매장 미선택 시 안내
/pos/menu                     → 메뉴 관리
/pos/counter                  → 카운터 주문
/pos/kds                      → 주방 화면 (전체화면 모드)
/pos/orders                   → 주문 이력
/pos/reconciliation           → 일일 대조
```

`AppLayout` 사이드바에 "POS" 메뉴 그룹 추가 (`posEnabled=true` 매장에서만 노출).

---

## 3. 화면별 설계

### 3.1 마스터 시스템 페이지 — POS 활성화 토글

**위치**: `/system` (`SystemPage`)에 카드 추가
**권한**: `masterProcedure`
**기능**:
- 모든 매장 목록 + `posEnabled` 상태
- 매장별 토글 버튼: enable / disable
- enable 시 `stylePreset` 드롭다운 (5종) — 즉시 적용
- 미완료 주문 있는 매장 disable 시도 → 서버에서 거부, 토스트 표시
- unconfirm 액션 (일일 대조용, 별도 위치 가능)

**호출 API**: `pos.settings.enable`, `pos.settings.disable`, `restaurants.list`(이미 있음)

### 3.2 매장 페이지 — POS 설정 카드

**위치**: `/store-info` (`StoreInfoPage`)에 카드 추가
**권한 가시**: 모두. **편집**: `manager+`(applyPreset/override)
**기능**:
- 현재 활성화 여부, 프리셋, 4축 표시
- 비활성 시 안내: "마스터 관리자에게 활성화를 요청하세요"
- 활성 + manager+: 프리셋 변경 / 4축 오버라이드 버튼

**호출**: `pos.settings.getStatus`, `applyPreset`, `override`

### 3.3 메뉴 관리 (`/pos/menu`)

**권한**: `manager+`
**레이아웃**: 좌측 카테고리 트리, 우측 메뉴 그리드
**기능**:
- 카테고리 추가/이름변경/순서변경/삭제 (활성 메뉴 있으면 삭제 거부)
- 메뉴 추가/수정 (이름, 가격, 카테고리, 활성, 품절 토글, 표시순서)
- 옵션 그룹 + 옵션 추가/수정 (메뉴 상세 내)
- 1차는 imageUrl 텍스트 입력만 (업로드는 P3)

**호출**: `pos.menu.*` 12 endpoint

### 3.4 카운터 UI (`/pos/counter`) — 5화면 흐름

**권한**: `staff+` (활성 매장만)
**디바이스**: 기존 `users` JWT 사용 (Q-O12). 점원 로그인 = POS 사용.

**5화면 흐름**:

```
[1. 메뉴 선택]
  좌측: 카테고리 탭
  중앙: 메뉴 그리드 (큰 터치 버튼, 가격 표시, 품절 어둡게)
  우측: 장바구니 미리보기 (수량 +/-)
  하단: "결제로 진행" 버튼 (장바구니 비어있으면 disabled)

[2. 장바구니 확인 + 옵션]
  메뉴 클릭 시 옵션 모달 (옵션 그룹 있으면)
  수량 조정, 라인별 메모(텍스트), 라인 삭제
  주문 전체 정액 할인 입력
  "결제 수단 선택" 버튼

[3. 결제 수단 선택]
  큰 버튼: 카드 / 현금 / 삼성페이 / 카카오페이 / 기타
  (천호점은 백화점 단말이 결제 → 직원이 수단만 체크)
  "결제 완료" 클릭 → pos.order.create + pos.payment.record 연속 호출

[4. 진동벨 입력 + 주방 전송]
  진동벨 번호 입력 (숫자 키패드)
  자동으로 KDS에 전송 (이미 paid 상태)
  "픽업 대기" 화면으로 전환 시 5초 카운트다운

[5. 완료 화면]
  주문번호 + 진동벨 표시 (3초 표시 후 1번 화면으로 자동 복귀)
  내부 영수증 미리보기 옵션 (인쇄 X, 화면만)
```

**상태 관리**:
- 로컬 상태(useReducer 또는 zustand)로 장바구니 + 현재 단계
- 화면 1~5 사이는 클라이언트 라우팅 없이 컴포넌트 전환만
- 결제 시 트랜잭션 1회 (`pos.order.create` + `pos.payment.record` 순차 호출)
- 실패 시: 1번 화면으로 복귀, 에러 토스트, 장바구니 보존

**오프라인 대응**: 1차 미적용. 네트워크 끊기면 결제 진행 불가, 안내 메시지. P3에서 IndexedDB 큐로 보강.

### 3.5 KDS 웹 화면 (`/pos/kds`)

**권한**: `staff+` 또는 디바이스 토큰
**디스플레이**: 주방 태블릿 또는 모니터 전체화면

**레이아웃**:
- 상단: 매장명, 현재 시각, 미완료 주문 수
- 본문: 주문 카드 그리드 (3~4 컬럼)
  - 카드: 주문번호 + 진동벨 + 메뉴 리스트 + 옵션·메모 + 경과시간
  - 상태별 색상: 신규(흰색) / 조리중(노랑) / 10분 초과(주황) / 20분 초과(빨강)
- 카드 클릭 → 조리중 토글
- 우측 상단 "조리완료" 버튼 → `markReady` → 진동벨 호출 (디스플레이만)
- "픽업완료" → `markServed`

**실시간 갱신**:
- 1차: tRPC subscription 미적용. **5초 polling** (`pos.order.list({status:'paid'})`).
- P3에서 tRPC subscription 또는 SSE 도입.

**알림음**:
- 신규 주문 폴링 응답에 새 주문 포함 시 `Audio` 재생.
- 페이지 로드 시 무음 한 번 재생해서 브라우저 자동재생 정책 우회 (사용자가 페이지 열 때 클릭 1회 필요).

**heartbeat**: 디바이스 토큰 모드일 때만 호출. master/owner 로그인 모드면 생략 가능.

**호출**: `pos.order.list`, `pos.order.markReady`, `pos.order.markServed`

### 3.6 주문 이력 (`/pos/orders`)

**권한**: `staff+`
**기능**:
- 날짜·상태 필터, 검색
- 주문 상세 모달 (라인·옵션·결제 이력)
- void / refund 버튼 (`manager+`)

**호출**: `pos.order.list`, `pos.order.get`, `pos.order.void`, `pos.order.refund`

### 3.7 일일 대조 (`/pos/reconciliation`)

**권한**: `manager+`
**기능**:
- 날짜 선택 (default 오늘 KST)
- POS 집계 / 백화점 입력 / 차이 표시
- 임계치 초과 시 노란색 강조
- "백화점 금액 입력" + "확정" 버튼
- 월별 이력 테이블

**호출**: `pos.reconciliation.getOrCreate` (자동 집계), `setExternal`, `confirm`, `list`

---

## 4. AppLayout 수정

`AppLayout.tsx` 사이드바에 신규 그룹 추가:

```
POS  (posEnabled=true 매장에서만 표시)
  ├ 카운터    /pos/counter        (모두)
  ├ 주방      /pos/kds            (모두)
  ├ 주문 이력 /pos/orders         (모두)
  ├ 메뉴 관리 /pos/menu           (manager+)
  └ 일일 대조 /pos/reconciliation (manager+)
```

매장 컨텍스트(`RestaurantContext`)에서 `posEnabled` 상태 가져오기. 비활성 매장 선택 시 POS 그룹 숨김.

---

## 5. 결정 필요한 사항 (P2 진입 전)

**Q-P2-1. 라우트 패턴**
- (a) `/pos/menu`, `/pos/counter` ... (RestaurantContext 활용)
- (b) `/pos/:restaurantId/menu` ...
- 권장: **(a)** — 기존 컨벤션 일치 (`/sales`, `/staff` 등)

**Q-P2-2. 카운터 UI 화면 전환 방식**
- (a) 단일 컴포넌트 + 내부 상태 (5화면을 useState/Reducer로)
- (b) 별도 sub-route (`/pos/counter/cart`, `/pos/counter/payment` ...)
- 권장: **(a)** — 빠른 전환, URL 노출 불필요. 새로고침 시 1번 화면으로 복귀 안전.

**Q-P2-3. KDS 인증 모드**
- (a) `users` JWT만 (점장/직원 로그인)
- (b) 디바이스 토큰 페어링 (전용 태블릿)
- (c) 둘 다 지원
- 권장: **(c)**. 1차는 (a)로 시작 가능 (직원이 로그인해서 사용), 후속에 (b) 추가. 페어링 흐름 UI는 P3에 미뤄도 됨.

**Q-P2-4. 실시간 갱신 방식**
- (a) 5초 polling (단순)
- (b) tRPC subscription (WebSocket)
- (c) SSE
- 권장: **(a)**. P2 단순 시작 → 운영 안정 후 (b) 도입. KDS 부하 측정 후 결정.

**Q-P2-5. 사이드바 노출 조건**
- (a) `posEnabled=true` 매장만 POS 메뉴 그룹 표시
- (b) 항상 표시, 비활성 시 disabled
- 권장: **(a)** — 클러터 감소, 사용자 혼란 방지. master는 어차피 시스템 페이지에서 토글 가능.

**Q-P2-6. 메뉴 이미지**
- (a) 1차는 imageUrl 텍스트만, 업로드 X
- (b) 1차에 업로드 포함 (`/api/upload` 재사용)
- 권장: **(a)** — UI 단순화, 첫 운영은 텍스트만. 업로드는 P3.

**Q-P2-7. UI 우선순위 분할 PR**
- 6개 화면을 한 번에 vs 점진 분할
- 권장: **점진 분할** (PR 단위):
  1. 마스터 활성화 토글 + 매장 설정 카드 (가장 작음)
  2. 메뉴 관리
  3. 카운터 UI 5화면
  4. KDS
  5. 주문 이력
  6. 일일 대조
- 각 PR마다 prod 시연 가능. 1번 통과 후 2번 진입 패턴 (P1과 동일).

---

## 6. 디자인 시스템·컴포넌트

기존 shadcn/ui 27개 컴포넌트 재사용. POS는 카운터·KDS에서 **큰 터치 버튼** 필요 → 신규 컴포넌트 후보:

- `<TouchButton>` — 최소 80px 높이, 큰 폰트
- `<NumericKeypad>` — 진동벨 번호 입력
- `<OrderCard>` — KDS 주문 카드 (경과시간 색상)
- `<MenuTile>` — 카운터 메뉴 그리드 셀

기존 컴포넌트(`Button`, `Card`, `Dialog`, `Toast`)는 그대로.

---

## 7. P2 단계 분할 (PR 6개)

| PR | 범위 | 의존성 | 시연 |
|---|---|---|---|
| P2.1 | `/system` POS 토글 + `/store-info` 설정 카드 | 없음 | master 토글 동작, 점장이 프리셋 변경 |
| P2.2 | `/pos/menu` 메뉴 관리 | 사이드바 라우팅 | 카테고리·메뉴·옵션 CRUD |
| P2.3 | `/pos/counter` 카운터 5화면 | P2.2 (메뉴 등록 선행) | 천호점에서 실제 주문 1건 생성 |
| P2.4 | `/pos/kds` 주방 화면 | P2.3 (주문 데이터) | 신규 주문 5초 안에 KDS에 표시, 조리 토글 |
| P2.5 | `/pos/orders` 주문 이력 | P2.3 | 이력 조회·void·refund |
| P2.6 | `/pos/reconciliation` 일일 대조 | P2.3 (결제 데이터) | 자동 집계, 외부 입력, 확정 |

각 PR 후 prod 시연 + 다음 진입. P1과 동일 패턴.

---

## 8. P2 완료 시점의 사용 시나리오 (천호점 기준)

```
[준비 — 1회]
1. 마스터가 /system에서 천호점 POS 활성화 + DEPT_PICKUP 적용 ✅ (이미 됨)
2. 점장이 /pos/menu에서 메뉴 등록 (음료/사이드/메인 카테고리, 항목별)
3. (선택) 주방에 태블릿 배치, 점장 계정으로 /pos/kds 전체화면

[일일 운영]
1. 직원이 /pos/counter에서 주문 입력
   ├ 메뉴 선택 → 장바구니 → 결제수단 체크 → 진동벨 입력 → 완료
2. 백화점 단말로 실제 결제 진행 (POS는 결과만 기록)
3. 주방 KDS에 주문 자동 표시 (5초 polling)
4. 조리 완료 시 KDS에서 "조리완료" → 진동벨 호출
5. 픽업 시 카운터 또는 KDS에서 "픽업완료"

[일마감]
1. 점장이 /pos/reconciliation에서 그날 자동 집계 확인
2. 백화점 정산서에서 본 금액 입력
3. 차이 5,000원 이내면 "확정" → daily_closings 자동 반영(B→A 전환 후)
```

---

## 9. P3 이후 로드맵

- P3: 키오스크 UI + IndexedDB 오프라인 큐 + tRPC subscription
- P4: 후불 테이블 UI + 주방 프린터 브릿지
- P5: 카드단말기 브릿지 (로드샵)
- P6: 재료 차감, 배달앱 연동, KDS 고도화

---

## 10. 결정 요청 (다음 세션 시작 전)

Q-P2-1 ~ Q-P2-7 (§5) 권장값 그대로 OK / 수정 필요 알려주기.
승인되면 P2.1 패치 문서(`docs/pos-p2-1-system-toggle-patch.md`) 작성 진입.
