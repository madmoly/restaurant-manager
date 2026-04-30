# POS P1 본문 #4 — `pos.payment.*` 본문 (paid 자동 전이 + voidPayment)

> 작성: 2026-04-19 (Cowork)
> 대상: Claude Code 세션
> 선행 PR: b610e17 (Order 본문 #3)
> 선행 시연: 12/12 통과 (Cowork 자율, paid 진입은 본 PR 후)
> 선행 문서: `docs/pos-plan.md` v0.5, `docs/pos-p1-handoff.md`, `docs/pos-p1-order-patch.md`
> 단계: P1 본문 #4 — 결제 기록·취소

---

## 0. 결정값 확정 (사용자 승인)

- **Q-O4-1 paid 자동 전이**: 활성 결제 합계가 `grandTotal`과 **정확히 일치**할 때만 paid. 합계 초과 시 거부.
- **Q-O4-2 voidPayment 후 status**: paid 상태에서 voidPayment로 합계 < grandTotal이 되면 `paid → open` 자동 되돌림. **ready/served 상태에서는 voidPayment 거부**(refund 사용).
- **Q-O4-3 approvalNo**: 모든 providerType에서 옵션 입력 (1차). 추후 매장 정책별 강화 가능.

---

## 1. 목적·범위

활성 매장(`DEPT_PICKUP` 천호점)에서 결제 기록·취소 + paid 자동 전이.

**범위 (라우터 2개 endpoint)**
- `pos.payment.record` (posStoreWrite + 게이트) — 결제 추가, 합계 도달 시 paid 전이, 트랜잭션
- `pos.payment.voidPayment` (posStoreManager + 게이트) — 결제 취소, paid→open 자동 되돌림, 트랜잭션

**Out of Scope**
- 환불(`pos.order.refund`)는 본문 #3에서 이미 구현됨. 본 PR에서는 재정의 없음.
- 결제 수단별 외부 시스템 연동(VAN·간편결제 API 호출)은 P2 이후. 1차는 "수단·결과 기록"만.

**완료 조건**
- `pnpm run build` 통과
- 분할결제 흐름 정상: 부분결제 → status open 유지 → 합계 도달 시 paid 자동 전이
- voidPayment 후 paid → open 되돌림
- ready/served 상태에서 voidPayment 거부
- over-pay / 음수 amount 거부
- 비활성 매장 게이트
- 통합 시연: open → paid → ready → served, 그리고 refund

---

## 2. `server/routers/pos.ts` — payment 라우터 본문 (전체 교체)

### 2.1 Import 보강 (대부분 #3에서 이미 추가됨, 누락분만)

```ts
// 이미 import됨: posPayments, posOrders, posStoreWriteProcedure, posStoreManagerProcedure
// 추가 필요: 없음 (이미 있는 import 활용)
```

### 2.2 payment 라우터 본문

```ts
const paymentRouter = router({
  // ─── 결제 기록 ──────────────────────────────────────────────
  record: posStoreWriteProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      orderId: z.number().int().positive(),
      method: z.enum([
        "card", "cash", "samsungpay", "kakaopay", "naverpay",
        "gift", "external", "etc",
      ]),
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "결제 금액은 양수(소수점 둘째자리까지)"),
      providerType: z.enum([
        "external_dept_store", "terminal_bridge", "van_direct", "manual",
      ]),
      approvalNo: z.string().max(64).optional(),
      cardBrand: z.string().max(30).optional(),
      providerRef: z.string().max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const amountNum = Number(input.amount);
      if (amountNum <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "결제 금액은 0보다 커야 합니다. 환불은 pos.order.refund 사용.",
        });
      }

      return ctx.db.transaction(async (tx) => {
        // 주문 조회 + 매장 일치 검증
        const [order] = await tx.select().from(posOrders)
          .where(eq(posOrders.id, input.orderId)).limit(1);
        if (!order || order.restaurantId !== input.restaurantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "주문을 찾을 수 없습니다." });
        }

        // 상태 검증: open/paid 만 결제 추가 가능
        // (paid 상태에서 추가 결제는 over-pay이므로 합계 검증에서 거부됨, 여기선 막지 않음)
        if (order.status !== "open" && order.status !== "paid") {
          throw new TRPCError({
            code: "FAILED_PRECONDITION",
            message: `현재 주문 상태=${order.status}. open 또는 paid 상태에서만 결제 가능.`,
          });
        }

        // 기존 활성 결제 합계
        const existing = await tx.select({ amount: posPayments.amount })
          .from(posPayments)
          .where(and(
            eq(posPayments.orderId, input.orderId),
            isNull(posPayments.voidedAt),
          ));
        const existingTotal = existing.reduce((s, p) => s + Number(p.amount), 0);
        const newTotal = existingTotal + amountNum;
        const grandTotal = Number(order.grandTotal);

        // over-pay 거부
        if (newTotal > grandTotal) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `결제 합계(${newTotal.toFixed(2)})가 주문 금액(${grandTotal.toFixed(2)})을 초과합니다. 남은 금액: ${(grandTotal - existingTotal).toFixed(2)}`,
          });
        }

        // 결제 레코드 추가
        const [pResult] = await tx.insert(posPayments).values({
          orderId: input.orderId,
          method: input.method,
          amount: input.amount,
          providerType: input.providerType,
          approvalNo: input.approvalNo ?? null,
          cardBrand: input.cardBrand ?? null,
          providerRef: input.providerRef ?? null,
          createdByUserId: ctx.user.id,
        });
        const paymentId = Number((pResult as any).insertId);

        // 합계 정확히 일치하면 paid 자동 전이
        let newStatus = order.status;
        if (newTotal === grandTotal && order.status === "open") {
          newStatus = "paid";
          await tx.update(posOrders)
            .set({ status: "paid", paidAt: new Date() })
            .where(eq(posOrders.id, input.orderId));
        }

        return {
          ok: true,
          paymentId,
          paid: newTotal.toFixed(2),
          remaining: (grandTotal - newTotal).toFixed(2),
          orderStatus: newStatus,
          autoTransitioned: newStatus !== order.status,
        };
      });
    }),

  // ─── 결제 취소 ──────────────────────────────────────────────
  voidPayment: posStoreManagerProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      id: z.number().int().positive(),
      reason: z.string().max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        // 결제 조회
        const [payment] = await tx.select().from(posPayments)
          .where(eq(posPayments.id, input.id)).limit(1);
        if (!payment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "결제 레코드를 찾을 수 없습니다." });
        }
        if (payment.voidedAt) {
          throw new TRPCError({
            code: "FAILED_PRECONDITION",
            message: "이미 취소된 결제입니다.",
          });
        }

        // 주문 조회 + 매장 일치 검증
        const [order] = await tx.select().from(posOrders)
          .where(eq(posOrders.id, payment.orderId)).limit(1);
        if (!order || order.restaurantId !== input.restaurantId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        // ready/served 상태에서는 voidPayment 거부 → refund 사용
        if (order.status === "ready" || order.status === "served") {
          throw new TRPCError({
            code: "FAILED_PRECONDITION",
            message: `현재 상태=${order.status}. 조리/제공 후에는 voidPayment 불가. pos.order.refund 사용.`,
          });
        }

        // 결제 취소
        await tx.update(posPayments)
          .set({ voidedAt: new Date() })
          .where(eq(posPayments.id, input.id));

        // 활성 결제 합계 재계산
        const sums = await tx.select({ amount: posPayments.amount })
          .from(posPayments)
          .where(and(
            eq(posPayments.orderId, payment.orderId),
            isNull(posPayments.voidedAt),
          ));
        const total = sums.reduce((s, p) => s + Number(p.amount), 0);
        const grandTotal = Number(order.grandTotal);

        // paid 상태에서 합계 < grandTotal이면 open으로 되돌림
        let newStatus = order.status;
        if (order.status === "paid" && total < grandTotal) {
          newStatus = "open";
          await tx.update(posOrders)
            .set({ status: "open", paidAt: null })
            .where(eq(posOrders.id, payment.orderId));
        }

        return {
          ok: true,
          remaining: (grandTotal - total).toFixed(2),
          orderStatus: newStatus,
          autoReverted: newStatus !== order.status,
        };
      });
    }),
});
```

**주의**: 본 라우터는 기존 `paymentRouter` 정의(P1 골격의 stub)를 **전체 교체**.

---

## 3. 검증 절차

### 3.1 빌드
- `pnpm run build` 통과

### 3.2 prod 시연 (천호점 id=2, master)

```js
const RID = 2;

// 사전 데이터 준비
const c = await trpc('pos.menu.upsertCategory', {restaurantId: RID, name: '음료', displayOrder: 1}, 'mutation');
const CAT_ID = c.body[0].result.data.id;
const m = await trpc('pos.menu.upsertItem', {restaurantId: RID, categoryId: CAT_ID, name: '아메리카노', price: '4500', taxType: 'taxable', displayOrder: 1}, 'mutation');
const ITEM_ID = m.body[0].result.data.id;

// 주문 1: 단일 결제 → paid → ready → served (정상 흐름)
const o1 = await trpc('pos.order.create', {
  restaurantId: RID, orderMode: 'prepaid_pickup',
  items: [{ menuItemId: ITEM_ID, qty: 1 }],
}, 'mutation');
const O1_ID = o1.body[0].result.data.id;

// 1) 부분결제 (분할 1단계)
console.log('1) 부분결제 2000:', await trpc('pos.payment.record', {
  restaurantId: RID, orderId: O1_ID,
  method: 'cash', amount: '2000', providerType: 'manual',
}, 'mutation'));
// 기대: paid=2000, remaining=2500, orderStatus='open', autoTransitioned=false

// 2) 부분결제 완료 (분할 2단계)
console.log('2) 부분결제 2500 → paid:', await trpc('pos.payment.record', {
  restaurantId: RID, orderId: O1_ID,
  method: 'card', amount: '2500', providerType: 'external_dept_store',
  approvalNo: 'TEST-12345',
}, 'mutation'));
// 기대: paid=4500, remaining=0, orderStatus='paid', autoTransitioned=true

// 3) markReady → ready
console.log('3) markReady:', await trpc('pos.order.markReady', {restaurantId: RID, id: O1_ID}, 'mutation'));
// 기대: ok, status='ready'

// 4) voidPayment ready 상태에서 거부
const lastPaymentId = (await trpc('pos.order.get', {restaurantId: RID, id: O1_ID})).body[0].result.data.payments.slice(-1)[0].id;
console.log('4) voidPayment ready 거부:', await trpc('pos.payment.voidPayment', {
  restaurantId: RID, id: lastPaymentId,
}, 'mutation'));
// 기대: FAILED_PRECONDITION: 조리/제공 후에는 voidPayment 불가

// 5) markServed → served
console.log('5) markServed:', await trpc('pos.order.markServed', {restaurantId: RID, id: O1_ID}, 'mutation'));
// 기대: ok, status='served'

// 6) refund 호출
console.log('6) refund:', await trpc('pos.order.refund', {restaurantId: RID, id: O1_ID, reason: '품질 불량'}, 'mutation'));
// 기대: ok, status='refunded', refundedAmount='4500.00'

// 주문 2: 단일 결제 → voidPayment → open 되돌림
const o2 = await trpc('pos.order.create', {
  restaurantId: RID, orderMode: 'prepaid_pickup',
  items: [{ menuItemId: ITEM_ID, qty: 1 }],
}, 'mutation');
const O2_ID = o2.body[0].result.data.id;

const p2 = await trpc('pos.payment.record', {
  restaurantId: RID, orderId: O2_ID,
  method: 'card', amount: '4500', providerType: 'manual',
}, 'mutation');
const P2_ID = p2.body[0].result.data.paymentId;
console.log('7) 결제 완료 → paid:', p2);

// 8) voidPayment paid 상태 — open 되돌림
console.log('8) voidPayment paid → open:', await trpc('pos.payment.voidPayment', {
  restaurantId: RID, id: P2_ID, reason: '잘못 결제',
}, 'mutation'));
// 기대: ok, remaining='4500.00', orderStatus='open', autoReverted=true

// 주문 3: over-pay 시도
const o3 = await trpc('pos.order.create', {
  restaurantId: RID, orderMode: 'prepaid_pickup',
  items: [{ menuItemId: ITEM_ID, qty: 1 }],
}, 'mutation');
const O3_ID = o3.body[0].result.data.id;

// 9) over-pay 거부
console.log('9) over-pay 거부:', await trpc('pos.payment.record', {
  restaurantId: RID, orderId: O3_ID,
  method: 'card', amount: '10000', providerType: 'manual',
}, 'mutation'));
// 기대: BAD_REQUEST: 결제 합계(10000.00)가 주문 금액(4500.00)을 초과

// 10) 게이트 — 비활성 매장
console.log('10) 게이트:', await trpc('pos.payment.record', {
  restaurantId: 4, orderId: 1,
  method: 'card', amount: '1000', providerType: 'manual',
}, 'mutation'));
// 기대: FORBIDDEN

// 정리
await trpc('pos.menu.deleteItem', {restaurantId: RID, id: ITEM_ID}, 'mutation');
await trpc('pos.menu.deleteCategory', {restaurantId: RID, id: CAT_ID}, 'mutation');
```

### 3.3 기대값 표

| 단계 | 기대 |
|---|---|
| 1) 부분결제 1 | `paid: '2000.00', remaining: '2500.00', orderStatus: 'open', autoTransitioned: false` |
| 2) 부분결제 2 | `paid: '4500.00', remaining: '0.00', orderStatus: 'paid', autoTransitioned: true` |
| 3) markReady | `status: 'ready'` |
| 4) voidPayment ready | `FAILED_PRECONDITION: 조리/제공 후에는 voidPayment 불가` |
| 5) markServed | `status: 'served'` |
| 6) refund | `status: 'refunded', refundedAmount: '4500.00'` (음수 결제 레코드 추가) |
| 7) 결제 완료 → paid | `orderStatus: 'paid', autoTransitioned: true` |
| 8) voidPayment paid → open | `remaining: '4500.00', orderStatus: 'open', autoReverted: true` |
| 9) over-pay | `BAD_REQUEST: 결제 합계 초과` |
| 10) 게이트 | `FORBIDDEN: POS가 이 매장에 활성화되지 않았습니다` |

본 시연으로 **#3에서 보류했던 markReady/markServed/refund 정상 흐름까지 통합 검증**됨.

---

## 4. 5항 보고 템플릿

```
1. 변경 파일:
   - server/routers/pos.ts (paymentRouter 본문 ~120 lines)
2. 의도: POS Phase 1 본문 #4 — 결제 기록·취소 + paid 자동 전이.
   합계 정확히 일치 시 paid 자동, voidPayment 후 paid→open 되돌림, ready/served는 거부.
3. 영향 범위:
   - tRPC: pos.payment.record / voidPayment 본문 동작
   - 권한: posStoreWriteProcedure (record), posStoreManagerProcedure (voidPayment)
   - DB: 변경 없음
   - UI: 변경 없음
   - 통합 시연 가능: open → paid → ready → served + refund 전 흐름
4. 리스크:
   - 결제 합계 일치 검증: floating point 비교 (Number === Number). decimal 두 자리라 안전 추정.
   - voidPayment 동시성: 같은 결제 id에 동시 호출 시 race window. 트랜잭션으로 1차 보호, UNIQUE 제약 없음.
   - over-pay 시 사용자 메시지에 남은 금액 안내 — UX 명확
   - ready/served에서 voidPayment 거부: refund 흐름으로 유도
   - 롤백: payment 라우터 본문만, 라우터 단위 revert 가능.
5. 빌드: pnpm run build ✅
```

---

## 5. 후속 PR 가이드

본 PR 통과 → P1 잔여 endpoint:
- **Reconciliation 본문 #5** (`pos.reconciliation.*`) — 외부 결제 매장 일일 대조
- **Device 본문 #6** (`pos.device.*`) — POS 디바이스 등록·페어링·KDS 연동

#5와 #6 끝나면 P1 백엔드 완료 → P2 UI 진입.

---

## 6. 메모

- **floating point**: `Number(decimal('XXX.YY'))` 비교는 두 자리 소수에서 안전 추정. 의심되면 `Math.round(n * 100)` 정수 비교로 변경 가능.
- **분할결제 UX**: 1차에서는 호출자가 amount를 직접 보내야 함. UI(P2)에서 "남은 금액" 자동 채움.
- **paid 후 추가 record**: 합계 검증으로 over-pay 자동 거부. 별도 status 검증 불필요.
- **refund 음수 레코드**: `pos.order.refund`(본문 #3)에서 직접 INSERT. payment 라우터 거치지 않음. 의도된 분리 — refund는 비즈니스 액션, voidPayment는 결제 단건 취소.
