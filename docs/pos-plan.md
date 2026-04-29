# POS 시스템 기획·설계 (v0.5 초안)

> 작성: 2026-04-19 (v0.1) · 갱신: 2026-04-19 (v0.2, v0.3, v0.4, v0.5)
> 상태: **P1 스키마+라우터 골격 push 완료(38969df)**. 본문 채우기 단계. 천호점 파일럿 기준 범위 확정.
>
> **v0.5 변경 요약 (2026-04-19)**
> - **POS 활성화 권한 master 전용 게이트 신설** (사용자 결정)
> - master만 `enable`/`disable` 가능. 점장은 활성화된 매장에 한해 `applyPreset`/`override`
> - settings 라우터 액션 분리: `enable` / `disable` / `applyPreset` / `override` / `getStatus`
> - `enable(restaurantId, stylePreset?)` — 프리셋 선택 입력. 마스터가 천호점처럼 알고 있는 매장은 즉시 프리셋 함께 지정 가능
> - `disable` 정책: 미완료 주문(`open`/`paid`/`ready`) 있으면 거부
> - 활성화 게이트는 **procedure 합성**(`posStoreReadProcedure / posStoreWriteProcedure / posStoreManagerProcedure / posStoreOwnerProcedure` 4종 신설)
> - 부록 A 권한 매핑 갱신
>
> 관련: 매출부(sales/daily_closings/monthly_closings), 레시피(recipes), 계약(restaurant_contracts)
>
> **v0.4 변경 요약 (2026-04-19)**
> - Q-O9~Q-O12 모두 승인·해소 → P1 도메인 구현 진입 가능
> - Q-O9: 천호점 = `DEPT_PICKUP` 확정
> - Q-O10: 후불 테이블 상태머신·DB **1차 포함**(UI는 2차)
> - Q-O11: 메뉴 옵션 **DB·API는 1차**, UI는 2차(텍스트 메모로 임시 운영)
> - Q-O12: POS 세션 = 기존 `users` 로그인 재사용(별도 POS 로그인 없음, 교대 시 재로그인만)
> - Q-O14 권장 채택: `taxType` 기본값 `taxable` 단일
> - Q-O15 권장 채택: 결제 분할·혼합 스키마 yes / UI 단일 수단 1차
> - Railway DB 한도 50GB 상향 반영(C3, 부록 C)
> - **P1 핸드오프 문서 분리**: `docs/pos-p1-handoff.md` 작성. Code 세션이 그대로 집행
>
> **v0.3 변경 요약 (2026-04-19)**
> - **주방 전달 1순위를 KDS(웹 화면)로 전환** (Q-O3: 주방 영수증 전자 대체 가능 확정). 프린터는 옵션으로 내림 → 1차 범위에서 브릿지 에이전트 제외
> - **매장 스타일 프리셋 5종 확정** (D9, 부록 D): `DEPT_PICKUP` / `SHOP_PICKUP` / `SHOP_TABLE` / `COURT_PICKUP` / `KIOSK_PICKUP`
> - 고객 영수증: 백화점 단말이 발급 → 매장 POS는 내부용만 (Q-O3 해소)
> - 할인 1차 범위 "주문 전체 정액 할인"만 확정 (Q-O6 해소)
> - 주문번호 채번 "매장별 일일 리셋 + 전역 UUID 병행" 확정 (Q-O7 해소)
> - 파일럿 성공 지표 정량 확정 (Q-O8 해소, §11 하단)
> - 메뉴 CRUD 권한 `managerProcedure` 확정 (Q-O5 해소)
> - 매출부 연계 B→A 점진 전환 확정 (Q-O1 해소)
>
> **v0.2 변경 요약**
> - 최상위 제약에 **웹앱 기반(C1)** 및 **키오스크 1차 도메인 수용(C5)** 명시 강화
> - 현대백화점 정산 독립성 확정 → §1·§8 반영
> - 키오스크는 "1차 도메인 수용, UI는 2차"로 명확화(§12 재정렬)

---

## 1. 목적·배경

- 매출부(매출 수기/OCR 입력) 위에 POS를 얹어 **주문 단위 원장**을 확보한다.
- 단기: 천호점(현대백화점 입점) 파일럿. 기존 OKPOS 대체.
- 장기: 로드샵(카드단말기 연동)·키오스크(셀프 주문)·VAN 직연동까지 확장 가능한 구조.
- **현대백화점 정산 독립성**: 백화점은 자체 결제 단말에 집계된 금액만 정산 수령. 우리 POS가 백화점에 매출 리포트를 제출할 의무 없음 → 백화점 연동 포맷·전송 레이어 불필요(매출부 단순화의 핵심 근거).

## 2. 최상위 제약 (이 문서 전체의 전제)

**C1. 웹앱 기반 고정**
- 네이티브/데스크톱 앱 없음. React + Vite + PWA 유지.
- 하드웨어(프린터·카드단말기) 직접 제어 불가 → **로컬 브릿지 에이전트** 필요(ADR-03 참조).
- 키오스크는 Chromium kiosk mode로 PWA 실행.
- 오프라인: Service Worker + IndexedDB 큐 + 재동기화(ADR-02).

**C2. 결제는 1차 범위에서 "수단·결과 기록"만**
- 천호점: 현대백화점 단말이 결제. 우리 POS는 결제 수단만 체크.
- 로드샵 확장: 매장 카드단말기와 로컬 브릿지로 통신(경로 B).
- 장기: VAN 직연동(경로 A) 대비 추상화(Provider 패턴).

**C3. Railway Hobby 한계**
- DB 볼륨 **50GB**(2026-04-19 상향). 단기 압박 해소. 단, 인덱스 비대화·테이블 스캔 성능 저하는 별개 → 월별 파티셔닝/아카이빙 설계는 여전히 권장.

**C4. 기존 시스템과 공존**
- `daily_closings` 등 매출부 기존 스키마·로직 유지.
- POS가 매출부를 대체하지 않음. POS는 원장, 매출부는 일마감·월정산 계층.

**C5. 키오스크 1차 도메인 수용, UI는 2차**
- 도메인 모델(주문 상태머신·결제 처리기·디바이스 인증)은 처음부터 **키오스크 시나리오를 포함**해 설계.
- 실제 고객용 키오스크 UI 구현은 2차. 단, `deviceType='kiosk'`·페어링 토큰·타임아웃 세션·선불 플로우는 1차에 **서버측은 완비**.
- 효과: 2차에서 UI만 얹으면 서버는 무수정.

## 3. 매장 유형·주문 모드 매트릭스

| 축 | 값 |
|---|---|
| **매장 유형** | 백화점입점(천호점) / 로드샵 / 푸드코트 / 배달전문 |
| **주문 모드** | 선불셀프픽업 / 선불테이블 / 후불테이블 |
| **결제 처리기** | 외부결제(백화점) / 카드단말기브릿지 / VAN직연동 / 현금전용 |
| **주문 입력 UI** | 스태프카운터 / 스태프테이블 / 고객키오스크 |
| **주방 전달** | 프린터브릿지 / KDS화면 / 없음 |

매장별로 위 5축을 **설정값**으로 지정. 코어 도메인은 단일, UI와 처리기는 교체 가능. 실무에서는 5축을 매번 고르지 않고 **매장 스타일 프리셋**(부록 D, D9) 하나만 선택. 프리셋이 5축 기본값을 주입한다.

## 4. 핵심 결정사항 (D-시리즈)

- **D1.** 주문 상태 단일 머신으로 선불·후불 모두 수용. 상태값: `open / paid / ready / served / voided / refunded`.
- **D2.** 주문 생성 시 모드(선불/후불) 선택. 매장 기본값 설정 + 수동 오버라이드.
- **D3.** 테이블 번호·진동벨 번호는 모든 모드에서 **선택 필드**. 모드에 따라 화면에서 노출/숨김.
- **D4.** 결제 처리기는 Provider 추상 인터페이스로 분리. 매장 설정값 `payment_provider` 로 선택.
- **D5.** 주방 전달기도 Provider 추상화. 프린터/KDS/없음 중 매장별 선택.
- **D6.** 일일 대조는 "POS 집계 / 외부(백화점 등) 입력 / 차이" 3필드. 임계치 초과만 경고.
- **D7.** OKPOS 병행 기간 2주 유지. 이 기간 동안 POS 매출은 `daily_closings`에 **자동 반영 안 함**(수동 확정). 전환 후 자동 반영 모드로 전환.
- **D8.** 모든 POS 디바이스에 `pos_devices` 레코드로 식별. 키오스크는 별도 디바이스 토큰 인증.
- **D9.** **매장 스타일 프리셋**(5종)으로 매장 설정을 묶는다. `restaurants.posStylePreset` 하나 고르면 `orderMode/paymentProvider/kitchenRouter/primaryDeviceType/reconcileTolerance` 기본값이 자동 주입. 개별 오버라이드 가능. 상세는 부록 D.
- **D10.** **주방 전달 1순위는 KDS(웹 화면)**. 주방 태블릿 또는 대형 모니터에서 PWA 실행. 조리 상태(접수/조리중/완료) 토글. 프린터는 2차 옵션(`kitchenRouter='printer'`).
- **D11.** **고객 영수증은 외부(백화점 단말/카드단말기) 발급**. 매장 POS는 내부 관리용 출력/미리보기만 제공(1차는 미리보기 화면만).
- **D12.** **할인 1차 범위**: 주문 전체 정액 할인만(쿠폰/정율/품목할인 2차).
- **D13.** **주문번호 채번**: 매장별 일일 리셋 번호(고객용, 예: "A-015") + 전역 UUID(DB 키). 둘 다 `pos_orders` 에 보존.
- **D14.** **메뉴 CRUD 권한**: `managerProcedure` 이상(owner+supervisor).
- **D15.** **천호점 매장 프리셋**: `DEPT_PICKUP` 적용. 기본 진입점.
- **D16.** **후불 테이블 모드**: 상태머신·DB·API는 1차 완비. UI는 2차. 1차에서 후불 진입 시 "준비 중" 안내.
- **D17.** **메뉴 옵션**: 스키마(`pos_menu_option_groups`, `pos_menu_options`)·tRPC API는 1차에 작성. 메뉴 등록 화면에서 옵션 입력은 2차. 1차 운영 중 옵션 표현은 주문 라인의 `customerNote`(텍스트) 활용.
- **D18.** **POS 세션**: 기존 `users` JWT 세션 그대로 재사용. POS 전용 로그인 없음. 교대 전환 시 로그아웃→재로그인. `pos_orders.createdByUserId`는 현 세션 사용자.

## 5. 도메인 모델 (1차 초안)

### 5.1 신규 테이블

```
pos_menu_categories         메뉴 카테고리 (매장별)
  id, restaurantId, name, displayOrder, isActive, deletedAt

pos_menu_items              메뉴 항목
  id, restaurantId, categoryId, name, price, imageUrl,
  recipeId (recipes FK, nullable), isSoldOut, isActive,
  taxType ('taxable'|'exempt'|'zero'), displayOrder, deletedAt

pos_menu_option_groups      옵션 그룹 (예: 사이즈, 토핑)
  id, menuItemId, name, minSelect, maxSelect, isRequired

pos_menu_options            옵션 값
  id, optionGroupId, name, priceDelta

pos_orders                  주문 헤더
  id, restaurantId, orderNo, orderMode ('prepaid_pickup'|'prepaid_table'|'postpaid_table'),
  tableNo (nullable), pagerNo (nullable),
  status ('open'|'paid'|'ready'|'served'|'voided'|'refunded'),
  subtotal, discountTotal, taxTotal, grandTotal,
  createdByUserId, deviceId, openedAt, paidAt, readyAt, servedAt, voidedAt,
  voidReason, customerNote, createdAt, updatedAt

pos_order_items             주문 라인
  id, orderId, menuItemId, menuItemNameSnapshot, unitPrice, qty,
  lineDiscount, lineTotal, status ('active'|'voided'),
  voidedAt, voidedByUserId, createdAt

pos_order_item_options      라인별 옵션 스냅샷
  id, orderItemId, optionName, priceDelta

pos_payments                결제 기록 (한 주문당 N건 — 분할결제 가능)
  id, orderId, method ('card'|'cash'|'samsungpay'|'kakaopay'|'gift'|'external'|'etc'),
  amount, approvalNo (nullable), cardBrand (nullable),
  providerType ('external_dept_store'|'terminal_bridge'|'van_direct'|'manual'),
  providerRef (nullable),  -- 외부 시스템 레퍼런스
  createdByUserId, createdAt, voidedAt

pos_devices                 POS 디바이스
  id, restaurantId, name, deviceType ('staff_counter'|'staff_table'|'kiosk'|'kds'),
  deviceToken (hash), lastSeenAt, isActive

pos_print_jobs              주방/영수증 출력 큐 (브릿지 에이전트가 폴링)
  id, restaurantId, orderId, printerType ('kitchen'|'receipt'),
  payload (JSON), status ('pending'|'printed'|'failed'),
  attempts, createdAt, printedAt, failedAt, errorMsg

pos_daily_reconciliation    일일 대조 (천호점처럼 외부 결제 매장용)
  id, restaurantId, date, posGross, externalGross,
  diff (=externalGross - posGross), note, confirmedByUserId, confirmedAt
```

### 5.2 기존 테이블 연계

- `sales` / `daily_closings` — POS가 **집계 소스**로 기여하되, 스키마는 변경 최소.
- `recipes` — `pos_menu_items.recipeId` 로 선택적 연결(재료차감은 1차 제외).
- `restaurants` — 아래 설정 컬럼 추가:
  ```
  posEnabled BOOLEAN
  posStylePreset ENUM  -- 'DEPT_PICKUP' | 'SHOP_PICKUP' | 'SHOP_TABLE' | 'COURT_PICKUP' | 'KIOSK_PICKUP'
  posDefaultOrderMode ENUM  -- 프리셋 오버라이드용
  posPaymentProvider ENUM   -- 프리셋 오버라이드용
  posKitchenRouter ENUM     -- 'printer' | 'kds' | 'none' (프리셋 오버라이드용)
  posReconcileTolerance INT -- 허용 오차(원), 프리셋 기본값 주입
  ```

### 5.3 인덱스·파티셔닝

- `pos_orders`, `pos_order_items`, `pos_payments` 는 `(restaurantId, createdAt)` 복합 인덱스.
- 월별 데이터 보존. 2년 초과 데이터는 별도 아카이브 테이블(`pos_orders_archive`)로 이관 배치 설계(향후).

## 6. 주문 상태머신

```
[선불 셀프픽업 / 선불 테이블]
  (시작) → paid → ready → served
                       ↘ refunded
                ↘ voided

[후불 테이블]
  (시작) → open → (아이템 추가/수정 반복) → paid → served
                                              ↘ refunded
              ↘ voided
```

- `voided` 는 결제 전 취소(금액 0 처리).
- `refunded` 는 결제 후 환불(음수 결제 레코드 또는 역분개 레코드).
- 상태 전이는 트랜잭션으로만. 직접 상태값 수정 금지.

## 7. 주문 플로우 (UI 프로필별)

### 7.1 스태프 카운터 (선불 셀프픽업, 천호점 = `DEPT_PICKUP`)
1. 카테고리 → 메뉴 탭 → 수량 (+ 옵션: 1차는 텍스트 메모)
2. 장바구니 확인, 할인 적용(선택, 주문 전체 정액)
3. "결제로 진행" → 결제수단 선택(카드/현금/삼성페이/기타)
4. (천호점) 백화점 단말에서 별도 결제 → 직원이 POS에서 "결제완료" 확인
5. 진동벨 번호 입력 → **KDS로 실시간 전송**(tRPC subscription)
6. 주문 상태 `paid`. 주방 KDS에서 조리 토글 → `ready`. 픽업 완료 "호출종료"로 `served`
7. 고객 영수증은 백화점 단말이 발급. 매장 POS는 내부용 미리보기만 제공

### 7.2 스태프 테이블 (후불, `SHOP_TABLE` 계열, 2차)
1. 테이블 선택 → 해당 테이블 주문 세션 진입(없으면 신규 `open`)
2. 메뉴 추가/수정 → 주방 전달(추가 건만, 프리셋에 따라 KDS 또는 프린터)
3. 식사 종료 후 "계산" → 결제 → `paid`
4. 퇴장 처리 `served`, 테이블 해제

### 7.3 고객 키오스크 (선불 셀프, `KIOSK_PICKUP`, UI 2차)
1. 메인 화면(매장 로고·시작 버튼)
2. 카테고리·메뉴·장바구니(UI 큼직, 터치 친화)
3. 옵션·수량 선택
4. 결제 단계 — 카드단말기브릿지 또는 QR 간편결제(경로에 따름). 천호점은 키오스크 불가(백화점 단말 특성상)
5. 주문번호/진동벨 번호 화면 표시 + KDS 실시간 전송
6. 타임아웃(30~60초) 시 세션 초기화
7. 서버측(도메인·인증·상태머신·KDS 연동)은 1차에서 완비, UI만 2차

## 8. 매출부(`daily_closings`) 연계 — A/B/C안 비교

| 항목 | A안: POS가 매출부 자동 생성 | B안: POS 별도, 마감 시 수동 복사 | C안: 공존(매장별 선택) |
|---|---|---|---|
| 데이터 일관성 | 최상 | 중 | 중하 (관리 복잡) |
| 감사 추적 | POS·마감 일체 → 변경 이력 명확 | 복사 시점 기준 → 소스 추적 필요 | 매장마다 다름 |
| 수기입력 병행 | 불가 | 가능 | 가능 |
| 월정산 로직 재사용 | 그대로 | 그대로 | 그대로 |
| 롤백 용이성 | 낮음(POS 제거 시 마감 재구성) | 높음 | 중 |
| 구현 난이도 | 중 | 낮 | 높 |

**권장: B안에서 시작 → A안으로 점진 전환.**
파일럿 기간 동안은 B(수동 복사·확정)로 운영 → 안정 확인 후 매장 설정으로 A 모드 전환.

**백화점 매장 추가 주의**: 천호점 같은 백화점 입점 매장의 `daily_closings` 매출금액은 **백화점 정산 기준 금액**이 최종 정답. 우리 POS 집계가 기준이 아니다. 일일 대조(`pos_daily_reconciliation`)에서 외부 금액이 기준, POS 금액은 내부 참고용. 자동반영 모드(A)에서도 이 매장 유형은 "외부 금액을 수동 확정"하는 게이트를 유지한다.

## 9. Provider 추상화 (확장성 핵심)

### 9.1 PaymentProvider 인터페이스
```
interface PaymentProvider {
  type: 'external_dept_store' | 'terminal_bridge' | 'van_direct' | 'manual'
  requestPayment(order, amount, method): Promise<PaymentResult>
  voidPayment(paymentId): Promise<void>
  refundPayment(paymentId, amount): Promise<void>
}
```
- `external_dept_store`: 외부(백화점)에서 결제. POS는 수단·금액만 기록.
- `terminal_bridge`: 로컬 브릿지 에이전트 → 카드단말기.
- `van_direct`: VAN사 API 직접(장기).
- `manual`: 현금·수기 입력.

### 9.2 KitchenRouter 인터페이스
```
interface KitchenRouter {
  type: 'printer' | 'kds' | 'none'
  send(order, deltaItems?): Promise<void>
}
```
- `printer`: 로컬 브릿지로 HTTP POST → ESC/POS 출력.
- `kds`: WebSocket 푸시로 주방 화면 갱신(장기).
- `none`: 아무것도 안 함(소형 매장).

## 10. ADR (Architecture Decision Records)

### ADR-01. 실시간 전송 방식
- 후불 테이블·KDS·키오스크 주문 접수 실시간성 필요.
- 옵션: ① tRPC v11 subscription(WebSocket 기반) ② SSE ③ 폴링
- **채택: tRPC subscription.** 이미 스택에 포함, 타입 공유 이득, Railway에서 WS 허용.
- 예외: 브릿지 에이전트는 HTTP 폴링(단순성 우선).

### ADR-02. 오프라인 대응
- 매장 인터넷 단절 시 최소한 주문·결제 UI는 동작해야 함.
- 방식: **Service Worker + IndexedDB 주문 큐**. 서버 복구 시 재동기화.
- 결제는 오프라인 시 `manual`/`cash` 만 허용. 카드결제는 단말기가 처리하므로 POS 오프라인이어도 무관(천호점·로드샵 모두).
- 1차 범위: "주문 생성·출력" 까지는 오프라인 가능. 조회·리포트는 온라인 전용.

### ADR-03. 프린터·단말기 브릿지 (1차 범위 제외, 2차 이후)
- 브라우저는 LAN 프린터·시리얼 카드단말기에 직접 못 붙는다.
- 필요 시점(로드샵 카드단말기 연동·주방 프린터 필수 매장): 매장 PC에 **경량 Node 에이전트**(로컬 HTTP 서버) 상주.
- POS(웹) → `http://localhost:PORT/print` 로 ESC/POS 페이로드 전송. 카드단말기 시리얼 통신도 동일 에이전트가 중계.
- 에이전트 설치·업데이트·로그 수집 전략은 별도 문서(`docs/pos-bridge-agent.md`)로 분리.
- **1차(천호점 파일럿)에서는 불필요** — 결제는 백화점 단말, 주방은 KDS(ADR-04).
- 본 문서에서는 인터페이스만 정의하고 구현은 후속.

### ADR-04. 주방 전달 방식 (KDS 우선)
- 옵션: ① **KDS(웹 화면)** ② 주방 프린터(브릿지) ③ 혼합
- **채택: ① KDS 기본, ② 프린터는 매장 설정 옵션.** 근거:
  - 웹앱 기반 원칙(C1)과 일치. 하드웨어 의존 0.
  - 파일럿(천호점)에서 "주문메뉴 영수증 전자 대체 가능" 확정.
  - 2차 로드샵 확장 시 프린터 필요한 매장은 `kitchenRouter='printer'` 로 선택.
- **KDS 요구사항**:
  - 주방 태블릿/모니터에서 전체화면 PWA 실행.
  - 신규 주문 카드로 표시, 조리 상태(접수/조리중/완료) 토글.
  - 신규 주문 도착 시 알림음 + 색상 강조(주문 누락 방지).
  - 10분·20분 초과 주문 색 변경(경과시간 트래킹).
  - 실시간 전송: tRPC v11 subscription(ADR-01) 사용.
  - 화면 새로고침/탭 종료 감지 후 재접속 자동화.
- **리스크**: 태블릿 배터리·화면 꺼짐·브라우저 크래시. 대응: 전용 주방 단말 지정, 자동재연결, 알림음, 마지막 heartbeat 기준 연결 상태 경고.
- **폴백**: KDS 연결 불안정 감지 시 POS 메인에 "주방 연결 끊김" 배너 → 수기 전달 가능.

## 11. 천호점 파일럿 전환 계획

| 단계 | 기간 | 내용 | 완료 조건 |
|---|---|---|---|
| P0 설계 확정 | 1주 | 본 문서 리뷰·승인 | 대표 승인 + ADR 3장 확정 |
| P1 도메인·tRPC | 2주 | 스키마 마이그레이션, 라우터 구현, 단위테스트 | `pnpm build` 통과 + 주문 CRUD API 스모크 테스트 |
| P2 스태프 카운터 UI | 2주 | 선불 셀프픽업 UI, 메뉴 관리 화면, 일일 대조 화면 | 내부 QA 매장(Tutorial)에서 100주문 에러 없음 |
| P3 KDS 웹 화면 | 1주 | 주방 태블릿용 KDS UI + tRPC subscription 실시간 주문 수신 | 천호점 주방 태블릿에서 100주문 누락·지연 없이 접수 |
| P4 천호점 그림자 운영 | 2주 | OKPOS와 **병행**. 우리 POS는 기록만, 매출부 자동 반영 OFF | 2주간 일일 집계 차이 ±5,000원 이하 + 성공지표(§11 하단) 달성 |
| P5 전환 | 1주 | OKPOS 제거, 우리 POS 단독 운영, 자동반영 ON | 7일 연속 장애 없음 |
| P6 안정화·확장 기획 | — | 후불/테이블/키오스크 UI/로드샵 설계 2차 | — |

### 파일럿 성공 지표 (정량, Q-O8 해소)

| 지표 | 목표 | 측정 방법 |
|---|---|---|
| 주문 처리 시간 | 주문 시작 → `paid` 전환 평균 60초 이하 | `pos_orders.openedAt` / `paidAt` 타임스탬프 |
| POS-백화점 일일 차이 | ±5,000원 이하 일수 비율 ≥ 90% | `pos_daily_reconciliation.diff` |
| 주문 오류율 | 주문 실패·재시도·수동 재입력 ≤ 1% | 에러 로그 + 수동 폴백 카운터 |
| 일일 서비스 다운타임 | ≤ 5분/일 | Railway healthcheck + 프론트 에러 |
| KDS 주문 누락 | 0건 (허용 0) | KDS 접수 로그 vs `pos_orders` 차이 |
| OKPOS 폴백 빈도 | P4 기간 말 주당 ≤ 2건 | 수동 폴백 카운터 |
| 직원 주관 만족도 | 5점 척도 평균 ≥ 3.5 | P4 말 주 1회 설문 |
| 영업 중단 사고 | 0건 (허용 0) | 인시던트 로그 |

지표 중 1개라도 미달 시 P5 전환 보류 → 원인 분석 후 P3/P4 재진입.

## 12. 이번 버전에서 하지 않는 것 (Out of Scope)

1. 카드단말기 시리얼 연동 (로드샵용, 2차)
2. VAN 직연동
3. 현금영수증 자동발급
4. 전자세금계산서
5. 재료 자동 차감(recipes 연계 재고)
6. 배달앱(배민/쿠팡이츠/요기요) 연동
7. 포인트·스탬프·멤버십
8. 주문 예약·선주문
9. 다국어 UI (키오스크용, 2차)
10. **주방 프린터 브릿지** — 1차는 KDS 웹화면으로 대체(ADR-04). 2차 `SHOP_TABLE` 프리셋 전개 시 필요
11. 키오스크 UI (2차, 단 도메인은 1차 수용)
12. 매장 간 재고·메뉴 공유(향후 사업그룹 기능)
13. 영수증 이메일·SMS 발송
14. 쿠폰·프로모션 엔진(단순 할인만 1차)
15. 메뉴 옵션 UI (1차는 단순 텍스트 메모로 대체, Q-O11)
16. 후불 테이블 UI (1차는 DB·상태머신만 준비, UI 2차, Q-O10)

## 13. 오픈 이슈

### 해소 (v0.3 반영)
- ~~Q-O1 매출부 연계~~ → B→A 점진 전환 확정(§8)
- ~~Q-O2 주방 프린터~~ → 1차 범위 제외. KDS로 대체(ADR-04). 프린터 필요 매장 대비 `docs/pos-bridge-agent.md` 2차 작성
- ~~Q-O3 영수증~~ → 고객용은 외부 발급, 매장 POS는 내부용 미리보기만(D11)
- ~~Q-O4 진동벨~~ → 1차 수기 입력(D3 기존)
- ~~Q-O5 메뉴 권한~~ → `managerProcedure` 확정(D14)
- ~~Q-O6 할인~~ → 주문 전체 정액만(D12)
- ~~Q-O7 주문번호~~ → 매장별 일일 리셋 + 전역 UUID(D13)
- ~~Q-O8 성공 지표~~ → §11 하단 표로 정량화

### 해소 (v0.4 반영)
- ~~Q-O9 천호점 프리셋~~ → `DEPT_PICKUP` 확정(D15)
- ~~Q-O10 후불 1차 포함~~ → 상태머신·DB·API 1차, UI 2차(D16)
- ~~Q-O11 옵션 UI~~ → DB·API 1차, UI 2차(D17). 1차 운영 중 표현은 `customerNote`
- ~~Q-O12 POS 세션~~ → 기존 `users` JWT 재사용(D18)

### 추적 중 (P1 진행 중 또는 P2 진입 전 결정)
- **Q-O13.** **메뉴 마이그레이션 전략** — 천호점 OKPOS의 현재 메뉴 구조를 어떻게 1차 시스템으로 이식할지(수기 입력 / CSV 업로드 / OKPOS export 파싱). P2 UI 진입 전 결정.
- **Q-O14.** **세금 처리** — `pos_menu_items.taxType`(taxable/exempt/zero) 기본값과 매장별 면세품목 정책. 1차 단일값 디폴트로 시작 가능(권장: `taxable` 단일).
- **Q-O15.** **결제 분할/혼합** — 한 주문을 카드+현금 등 복수 수단으로 결제하는 케이스를 1차에 허용? (스키마는 N건 결제 수용 — `pos_payments`). UI는 단일 수단만 1차, 복수는 2차로 권장.

## 14. 향후 로드맵 개요

- **Phase 2**: 후불 테이블 + 로드샵 카드단말기 연동(경로 B)
- **Phase 3**: 키오스크 UI + QR 간편결제
- **Phase 4**: 재료 차감·재고 경보(recipes 연계)
- **Phase 5**: KDS 화면 + 배달앱 통합
- **Phase 6**: VAN 직연동(경로 A) 검토

---

## 부록 A. 권한 매핑 (v0.5 갱신)

활성화 게이트가 적용된 라우터는 모두 `posStore*Procedure`(매장 격리 + `posEnabled=true` 검증).
활성화 자체와 상태 조회는 게이트 적용 안 됨(역설 방지).

| 기능 | 필요 레벨 | 활성화 게이트 |
|---|---|---|
| `pos.settings.enable` (POS 활성화 + 선택적 프리셋) | `masterProcedure` | 없음 |
| `pos.settings.disable` (POS 비활성화) | `masterProcedure` | 없음 (단, 미완료 주문 있으면 거부) |
| `pos.settings.getStatus` (활성화·프리셋 조회) | `storeReadProcedure` | 없음 |
| `pos.settings.applyPreset` (프리셋 변경) | `posStoreOwnerProcedure` | 적용 |
| `pos.settings.override` (4축 미세조정) | `posStoreOwnerProcedure` | 적용 |
| 메뉴 CRUD, 카테고리 관리 | `posStoreManagerProcedure` | 적용 |
| 주문 생성·수정 | `posStoreWriteProcedure` (staff 포함) | 적용 |
| 주문 강제취소(`void`)·환불(`refund`) | `posStoreManagerProcedure` | 적용 |
| 결제 기록·취소 | `posStoreWriteProcedure` (수정), `posStoreManagerProcedure` (취소) | 적용 |
| 일일 대조 확정 | `posStoreManagerProcedure` | 적용 |
| 기기 등록·토큰 재발급·페어링 | `posStoreOwnerProcedure` | 적용 |

**활성화 흐름**
1. master가 `pos.settings.enable(restaurantId, stylePreset?)` 호출
   - stylePreset 함께 주면: `posEnabled=true` + 4축 디폴트 즉시 주입 → 점장은 운영만
   - stylePreset 생략 시: `posEnabled=true`만. 점장이 이후 `applyPreset` 호출해야 운영 가능
2. (선택) 점장이 `pos.settings.applyPreset(stylePreset)` 호출 → 4축 디폴트 주입
3. (선택) 점장이 `pos.settings.override(...)` 호출 → 4축 부분 미세조정
4. 매장 전체 POS 운영 시작

## 부록 B. 키오스크 디바이스 인증 (개요)

- 최초 등록: 점장(owner)이 관리화면에서 "키오스크 추가" → 일회용 페어링 코드 발급
- 키오스크 브라우저에서 페어링 코드 입력 → 서버가 장기 디바이스 토큰 발급(쿠키+localStorage)
- 각 주문은 디바이스 토큰으로 인증. 사용자 로그인 없이 동작.
- 관리화면에서 토큰 폐기 가능(기기 분실 대응).

## 부록 C. 데이터 볼륨 추정 (2년)

- 천호점 단독: 평균 300주문/일 × 730일 = 약 22만 주문
- 주문당 평균 3라인 → 66만 `pos_order_items`
- 10개 매장 확장 시 2년간 약 220만 주문 / 660만 아이템
- 인덱스 포함 DB 점유 예상: 2~3GB (50GB 한도 대비 매우 여유. 다만 단일 테이블 수천만 row 도달 시 쿼리 성능 저하 가능 → 파티셔닝/아카이빙은 성능 관점에서 별도 검토)

## 부록 D. 매장 스타일 프리셋 (D9 상세)

매장 등록/수정 시 `posStylePreset` 하나를 고르면 아래 5개 설정이 자동 주입. 개별 오버라이드 가능.

| 프리셋 키 | 표시명 | 대표 사례 | orderMode | paymentProvider | kitchenRouter | primaryDeviceType | reconcileTolerance(원) |
|---|---|---|---|---|---|---|---|
| `DEPT_PICKUP` | 백화점 선불 셀프픽업 | **천호점** | `prepaid_pickup` | `external_dept_store` | `kds` | `staff_counter` | 5,000 |
| `SHOP_PICKUP` | 로드샵 선불 셀프픽업 | 카페·분식·테이크아웃 | `prepaid_pickup` | `terminal_bridge` | `kds` | `staff_counter` | 2,000 |
| `SHOP_TABLE` | 로드샵 후불 테이블 | 한식당·고깃집 | `postpaid_table` | `terminal_bridge` | `printer` (default) | `staff_table` | 2,000 |
| `COURT_PICKUP` | 푸드코트 선불 테이블 | 쇼핑몰 푸드코트 | `prepaid_table` | `terminal_bridge` | `kds` | `staff_counter` | 3,000 |
| `KIOSK_PICKUP` | 키오스크 무인 선불 | 무인 매장·야간 무인 | `prepaid_pickup` | `terminal_bridge` | `kds` | `kiosk` | 2,000 |

### 1차 범위 매핑
- **P1~P5 (파일럿)**: `DEPT_PICKUP`만 완성도 확보
- **P6 이후 2차**: `SHOP_PICKUP` → `SHOP_TABLE` → `COURT_PICKUP` → `KIOSK_PICKUP` 순
- DB·도메인 모델·상태머신은 1차에 5종 모두 수용. UI만 프리셋별 점진 확장

### 프리셋 변경 시 정책
- 기존 매장의 프리셋 변경은 `ownerProcedure` 이상만 가능
- 변경 시 미완료(`open`/`paid`) 주문이 있으면 거부
- 변경 이력은 `audit_logs`에 보존
