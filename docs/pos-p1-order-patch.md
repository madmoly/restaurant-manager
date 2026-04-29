# POS P1 본문 #3 — `pos.order.*` 본문 (트랜잭션·채번·멱등성·가격 재계산)

> 작성: 2026-04-19 (Cowork)
> 대상: Claude Code 세션
> 선행 PR: f8c52e0 (Menu 본문 + 게이트)
> 선행 시연: 12/12 통과 (천호점 id=2, DEPT_PICKUP, 광명AK 비활성 게이트 검증)
> 선행 문서: `docs/pos-plan.md` v0.5, `docs/pos-p1-handoff.md`, `docs/pos-p1-settings-enable-patch.md`, `docs/pos-p1-menu-patch.md`
> 단계: P1 본문 #3 — 주문 생성·조회·상태 전이·취소·환불

---

## 0. 결정값 확정 (사용자 승인)

- **Q-O3-1 채번**: 매장별 일일 리셋 + 4자리 zero-pad (`0001`, `0002`). KST 기준 자정 리셋. 전역 UUID는 `pos_orders.uuid`에 별도 보존.
- **Q-O3-2 가격**: 서버가 `pos_menu_items.price`·`pos_menu_options.priceDelta` 재계산. 클라이언트 `unitPrice`는 무시(받지도 않음).
- **Q-O3-3 초기 상태**: `pos.order.create`는 항상 `open` 상태로 시작. `paid` 전이는 `pos.payment.record`(본문 #4)에서 처리.
- **Q-O3-4 idempotencyKey**: 옵션 입력. 안 보내면 서버 `randomUUID()` 생성. 동일 키 재호출 시 기존 주문 그대로 반환(UNIQUE 충돌 catch).

---

## 1. 목적·범위

활성 매장(`DEPT_PICKUP` 천호점)에서 주문 생성·조회·상태 전이·취소·환불 흐름의 본문을 채운다.

**범위 (라우터 7개 endpoint)**
- `pos.order.create` (storeWrite + 게이트) — 트랜잭션, 채번, 멱등성, 가격 재계산
- `pos.order.get` (storeRead + 게이트)
- `pos.order.list` (storeRead + 게이트) — 날짜·상태 필터, 단순 limit
- `pos.order.markReady` (storeWrite + 게이트) — `paid → ready`
- `pos.order.markServed` (storeWrite + 게이트) — `paid|ready → served`
- `pos.order.void` (storeManager + 게이트) — `open → voided` (결제 전만)
- `pos.order.refund` (storeManager + 게이트) — `paid|ready|served → refunded` + 음수 결제 레코드

**Out of Scope (후속 PR)**
- `pos.payment.*` 본문 (#4)
- `pos.reconciliation.*` 본문 (#5)
- `pos.device.*` 본문 (#6)
- KDS 실시간 publish (subscription 미연결, polling으로 우회)

**완료 조건**
- `pnpm run build` 통과
- 천호점에서 주문 1건 생성 → orderNo `0001` 반환, get/list 정상
- 같은 idempotencyKey 재호출 시 동일 주문 반환 (중복 INSERT 없음)
- 클라이언트가 잘못된 가격 보내도 서버가 마스터 가격으로 덮음
- void 정상, paid 이후는 거부
- 비활성 매장에서 호출 시 `FORBIDDEN`

---

## 2. `server/routers/pos.ts` — order 라우터 본문 (전체 교체)

### 2.1 Import 보강

```ts
import { randomUUID } from "node:crypto";
import { and, eq, desc, isNull, inArray, gte, lte } from "drizzle-orm";
import {
  posStoreReadProcedure, posStoreWriteProcedure, posStoreManagerProcedure,
} from "../trpc";
import {
  posMenuItems, posMenuOptionGroups, posMenuOptions,
  posOrders, posOrderItems, posOrderItemOptions,
  posPayments, posOrderCounters,
} from "../../drizzle/schema";
```

### 2.2 헬퍼 함수 (파일 상단 또는 별도 모듈)

```ts
// KST 기준 'YYYY-MM-DD' 반환
function kstDateString(d: Date = new Date()): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// 매장별 일일 채번 — 트랜잭션 안에서 호출
async function nextOrderNo(tx: any, restaurantId: number, date: string): Promise<string> {
  // INSERT ... ON DUPLICATE KEY UPDATE 패턴으로 원자 증분
  await tx.execute(sql`
    INSERT INTO pos_order_counters (restaurantId, date, lastSeq)
    VALUES (${restaurantId}, ${date}, 1)
    ON DUPLICATE KEY UPDATE lastSeq = lastSeq + 1
  `);
  const [row] = await tx.select({ lastSeq: posOrderCounters.lastSeq })
    .from(posOrderCounters)
    .where(and(
      eq(posOrderCounters.restaurantId, restaurantId),
      eq(posOrderCounters.date, date),
    )).limit(1);
  if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "채번 실패" });
  return String(row.lastSeq).padStart(4, "0");
}

// 가격 재계산: items 배열을 받아 unitPrice/lineTotal/options 검증된 형태로 반환
async function resolvePricedItems(tx: any, restaurantId: number, items: Array<{
  menuItemId: number;
  qty: number;
  optionIds?: number[];
  note?: string;
}>) {
  if (items.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "주문 아이템이 비어있습니다." });
  }
  const menuIds = [...new Set(items.map(i => i.menuItemId))];
  const menus = await tx.select().from(posMenuItems)
    .where(and(
      inArray(posMenuItems.id, menuIds),
      eq(posMenuItems.restaurantId, restaurantId),
      isNull(posMenuItems.deletedAt),
    ));
  const menuMap = new Map<number, any>();
  for (const m of menus) menuMap.set(m.id, m);

  // 누락 검증
  for (const i of items) {
    if (!menuMap.has(i.menuItemId)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `메뉴 id=${i.menuItemId}가 본 매장에 없거나 삭제됨`,
      });
    }
    if (menuMap.get(i.menuItemId).isSoldOut) {
      throw new TRPCError({
        code: "FAILED_PRECONDITION",
        message: `메뉴 '${menuMap.get(i.menuItemId).name}' 품절`,
      });
    }
  }

  // 옵션 일괄 조회
  const allOptionIds = [...new Set(items.flatMap(i => i.optionIds ?? []))];
  const options = allOptionIds.length === 0 ? [] :
    await tx.select({
      id: posMenuOptions.id,
      name: posMenuOptions.name,
      priceDelta: posMenuOptions.priceDelta,
      optionGroupId: posMenuOptions.optionGroupId,
      menuItemId: posMenuOptionGroups.menuItemId,
    })
      .from(posMenuOptions)
      .innerJoin(posMenuOptionGroups, eq(posMenuOptionGroups.id, posMenuOptions.optionGroupId))
      .where(and(
        inArray(posMenuOptions.id, allOptionIds),
        eq(posMenuOptions.isActive, true),
      ));
  const optMap = new Map<number, any>();
  for (const o of options) optMap.set(o.id, o);

  // 라인별 가격 계산
  const resolved = items.map(i => {
    const m = menuMap.get(i.menuItemId);
    const unitPrice = Number(m.price);
    const itemOptions = (i.optionIds ?? []).map(oid => {
      const o = optMap.get(oid);
      if (!o) throw new TRPCError({ code: "BAD_REQUEST", message: `옵션 id=${oid} 없음` });
      if (o.menuItemId !== i.menuItemId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `옵션 id=${oid}이 메뉴와 매칭 안 됨` });
      }
      return { name: o.name, priceDelta: Number(o.priceDelta) };
    });
    const optionsTotal = itemOptions.reduce((s, o) => s + o.priceDelta, 0);
    const lineTotal = (unitPrice + optionsTotal) * i.qty;
    return {
      menuItemId: i.menuItemId,
      menuItemNameSnapshot: m.name,
      unitPrice: unitPrice.toFixed(2),
      qty: i.qty,
      lineTotal: lineTotal.toFixed(2),
      options: itemOptions.map(o => ({ name: o.name, priceDelta: o.priceDelta.toFixed(2) })),
      note: i.note,
    };
  });

  const subtotal = resolved.reduce((s, r) => s + Number(r.lineTotal), 0);
  return { resolved, subtotal };
}
```

### 2.3 order 라우터 본문

```ts
const orderInputSchema = z.object({
  restaurantId: z.number().int().positive(),
  orderMode: z.enum(["prepaid_pickup", "prepaid_table", "postpaid_table"]),
  tableNo: z.string().max(30).optional(),
  pagerNo: z.string().max(30).optional(),
  items: z.array(z.object({
    menuItemId: z.number().int().positive(),
    qty: z.number().int().min(1),
    optionIds: z.array(z.number().int().positive()).default([]),
    note: z.string().max(200).optional(),
  })).min(1),
  discountTotal: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
  customerNote: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

const orderRouter = router({
  // ─── 생성 ───────────────────────────────────────────────────
  create: posStoreWriteProcedure
    .input(orderInputSchema)
    .mutation(async ({ ctx, input }) => {
      const uuid = input.idempotencyKey ?? randomUUID();

      // 멱등성 사전 체크 — 같은 uuid 있으면 그대로 반환
      const [existing] = await ctx.db.select().from(posOrders)
        .where(eq(posOrders.uuid, uuid)).limit(1);
      if (existing) {
        if (existing.restaurantId !== input.restaurantId) {
          throw new TRPCError({ code: "CONFLICT", message: "idempotencyKey가 다른 매장 주문" });
        }
        return { ok: true, id: existing.id, orderNo: existing.orderNo, idempotent: true };
      }

      return ctx.db.transaction(async (tx) => {
        // 가격 재계산 (서버 마스터 가격)
        const { resolved, subtotal } = await resolvePricedItems(tx, input.restaurantId, input.items);
        const discountTotal = Number(input.discountTotal);
        const grandTotal = Math.max(0, subtotal - discountTotal);

        // 채번
        const date = kstDateString();
        const orderNo = await nextOrderNo(tx, input.restaurantId, date);

        // posOrders insert
        const [orderResult] = await tx.insert(posOrders).values({
          uuid,
          restaurantId: input.restaurantId,
          orderNo,
          orderMode: input.orderMode,
          tableNo: input.tableNo ?? null,
          pagerNo: input.pagerNo ?? null,
          status: "open",
          subtotal: subtotal.toFixed(2),
          discountTotal: discountTotal.toFixed(2),
          taxTotal: "0",  // 1차는 세금 분리 계산 안 함 (taxType 활용은 P2)
          grandTotal: grandTotal.toFixed(2),
          customerNote: input.customerNote ?? null,
          createdByUserId: ctx.user.id,
          deviceId: null,
        });
        const orderId = Number((orderResult as any).insertId);

        // posOrderItems + options insert
        for (const r of resolved) {
          const [itemResult] = await tx.insert(posOrderItems).values({
            orderId,
            menuItemId: r.menuItemId,
            menuItemNameSnapshot: r.menuItemNameSnapshot,
            unitPrice: r.unitPrice,
            qty: r.qty,
            lineDiscount: "0",
            lineTotal: r.lineTotal,
            status: "active",
            note: r.note ?? null,
          });
          const orderItemId = Number((itemResult as any).insertId);
          for (const o of r.options) {
            await tx.insert(posOrderItemOptions).values({
              orderItemId,
              optionName: o.name,
              priceDelta: o.priceDelta,
            });
          }
        }

        return { ok: true, id: orderId, orderNo, uuid, grandTotal: grandTotal.toFixed(2), idempotent: false };
      });
    }),

  // ─── 조회 ───────────────────────────────────────────────────
  get: posStoreReadProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      id: z.number().int().positive(),
    }))
    .query(async ({ ctx, input }) => {
      const [order] = await ctx.db.select().from(posOrders)
        .where(eq(posOrders.id, input.id)).limit(1);
      if (!order || order.restaurantId !== input.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const items = await ctx.db.select().from(posOrderItems)
        .where(eq(posOrderItems.orderId, input.id))
        .orderBy(posOrderItems.id);
      const itemIds = items.map(i => i.id);
      const opts = itemIds.length === 0 ? [] :
        await ctx.db.select().from(posOrderItemOptions)
          .where(inArray(posOrderItemOptions.orderItemId, itemIds));
      const payments = await ctx.db.select().from(posPayments)
        .where(eq(posPayments.orderId, input.id))
        .orderBy(posPayments.id);
      return {
        ...order,
        items: items.map(it => ({
          ...it,
          options: opts.filter(o => o.orderItemId === it.id),
        })),
        payments,
      };
    }),

  list: posStoreReadProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      from: z.string().optional(),  // ISO date 'YYYY-MM-DD' 또는 ISO datetime
      to: z.string().optional(),
      status: z.enum(["open","paid","ready","served","voided","refunded"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const conds = [eq(posOrders.restaurantId, input.restaurantId)];
      if (input.from) conds.push(gte(posOrders.createdAt, new Date(input.from)));
      if (input.to) conds.push(lte(posOrders.createdAt, new Date(input.to)));
      if (input.status) conds.push(eq(posOrders.status, input.status));
      return ctx.db.select().from(posOrders)
        .where(and(...conds))
        .orderBy(desc(posOrders.createdAt))
        .limit(input.limit);
    }),

  // ─── 상태 전이 ──────────────────────────────────────────────
  markReady: posStoreWriteProcedure
    .input(z.object({ restaurantId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [o] = await ctx.db.select().from(posOrders)
        .where(eq(posOrders.id, input.id)).limit(1);
      if (!o || o.restaurantId !== input.restaurantId) throw new TRPCError({ code: "NOT_FOUND" });
      if (o.status !== "paid") {
        throw new TRPCError({
          code: "FAILED_PRECONDITION",
          message: `현재 상태=${o.status}. paid 상태에서만 ready 전이 가능.`,
        });
      }
      await ctx.db.update(posOrders)
        .set({ status: "ready", readyAt: new Date() })
        .where(eq(posOrders.id, input.id));
      return { ok: true, status: "ready" };
    }),

  markServed: posStoreWriteProcedure
    .input(z.object({ restaurantId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [o] = await ctx.db.select().from(posOrders)
        .where(eq(posOrders.id, input.id)).limit(1);
      if (!o || o.restaurantId !== input.restaurantId) throw new TRPCError({ code: "NOT_FOUND" });
      if (o.status !== "paid" && o.status !== "ready") {
        throw new TRPCError({
          code: "FAILED_PRECONDITION",
          message: `현재 상태=${o.status}. paid 또는 ready에서만 served 전이 가능.`,
        });
      }
      await ctx.db.update(posOrders)
        .set({ status: "served", servedAt: new Date() })
        .where(eq(posOrders.id, input.id));
      return { ok: true, status: "served" };
    }),

  // ─── 취소 (결제 전만) ───────────────────────────────────────
  void: posStoreManagerProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      id: z.number().int().positive(),
      reason: z.string().min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const [o] = await ctx.db.select().from(posOrders)
        .where(eq(posOrders.id, input.id)).limit(1);
      if (!o || o.restaurantId !== input.restaurantId) throw new TRPCError({ code: "NOT_FOUND" });
      if (o.status !== "open") {
        throw new TRPCError({
          code: "FAILED_PRECONDITION",
          message: `현재 상태=${o.status}. open 상태에서만 void 가능. 결제 후에는 refund 사용.`,
        });
      }
      await ctx.db.update(posOrders)
        .set({ status: "voided", voidedAt: new Date(), voidReason: input.reason })
        .where(eq(posOrders.id, input.id));
      return { ok: true, status: "voided" };
    }),

  // ─── 환불 (결제 후) ─────────────────────────────────────────
  refund: posStoreManagerProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      id: z.number().int().positive(),
      reason: z.string().min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const [o] = await ctx.db.select().from(posOrders)
        .where(eq(posOrders.id, input.id)).limit(1);
      if (!o || o.restaurantId !== input.restaurantId) throw new TRPCError({ code: "NOT_FOUND" });
      if (!["paid", "ready", "served"].includes(o.status)) {
        throw new TRPCError({
          code: "FAILED_PRECONDITION",
          message: `현재 상태=${o.status}. paid/ready/served에서만 refund 가능.`,
        });
      }
      return ctx.db.transaction(async (tx) => {
        // 기존 결제 합계 조회
        const payments = await tx.select().from(posPayments)
          .where(and(eq(posPayments.orderId, input.id), isNull(posPayments.voidedAt)));
        const positiveSum = payments
          .filter(p => Number(p.amount) > 0)
          .reduce((s, p) => s + Number(p.amount), 0);
        // 음수 결제 레코드 추가 (전체 환불)
        if (positiveSum > 0) {
          await tx.insert(posPayments).values({
            orderId: input.id,
            method: "etc",
            amount: (-positiveSum).toFixed(2),
            providerType: "manual",
            providerRef: `refund: ${input.reason}`,
            createdByUserId: ctx.user.id,
          });
        }
        await tx.update(posOrders)
          .set({ status: "refunded", voidReason: input.reason })
          .where(eq(posOrders.id, input.id));
        return { ok: true, status: "refunded", refundedAmount: positiveSum.toFixed(2) };
      });
    }),
});
```

---

## 3. 검증 절차

### 3.1 빌드
- `pnpm run build` 통과

### 3.2 prod 시연 (천호점 id=2, master 또는 owner)

**3.2.1 사전 데이터 준비** (Menu 시연에서 데이터 다 지웠으므로 재생성 필요)

```js
const RID = 2;
const c = await trpc('pos.menu.upsertCategory', {restaurantId: RID, name: '음료', displayOrder: 1}, 'mutation');
const CAT_ID = c.body[0].result.data.id;
const m = await trpc('pos.menu.upsertItem', {restaurantId: RID, categoryId: CAT_ID, name: '아메리카노', price: '4500', taxType: 'taxable', displayOrder: 1}, 'mutation');
const ITEM_ID = m.body[0].result.data.id;
const og = await trpc('pos.menu.upsertOptionGroup', {restaurantId: RID, menuItemId: ITEM_ID, name: '사이즈', minSelect: 1, maxSelect: 1, isRequired: true, displayOrder: 1}, 'mutation');
const OG_ID = og.body[0].result.data.id;
const opt1 = await trpc('pos.menu.upsertOption', {restaurantId: RID, optionGroupId: OG_ID, name: 'Tall', priceDelta: '0', displayOrder: 1}, 'mutation');
const OPT_TALL = opt1.body[0].result.data.id;
const opt2 = await trpc('pos.menu.upsertOption', {restaurantId: RID, optionGroupId: OG_ID, name: 'Grande', priceDelta: '500', displayOrder: 2}, 'mutation');
const OPT_GRANDE = opt2.body[0].result.data.id;
console.log('준비 완료', {CAT_ID, ITEM_ID, OG_ID, OPT_TALL, OPT_GRANDE});
```

**3.2.2 본 시연 (총 14단계)**

```js
// 1) 주문 생성 — 아메리카노 2개(Grande), 음료 1개(Tall)
const o1 = await trpc('pos.order.create', {
  restaurantId: RID, orderMode: 'prepaid_pickup',
  pagerNo: '15',
  items: [
    { menuItemId: ITEM_ID, qty: 2, optionIds: [OPT_GRANDE] },
    { menuItemId: ITEM_ID, qty: 1, optionIds: [OPT_TALL] },
  ],
  customerNote: '얼음 적게',
}, 'mutation');
console.log('1) order.create:', o1);
const ORDER_ID = o1.body[0].result.data.id;
// 기대: orderNo='0001', grandTotal=14500 (5000*2 + 4500*1)

// 2) 주문 조회 — 아이템·옵션·결제(빈배열) 포함
console.log('2) order.get:', await trpc('pos.order.get', {restaurantId: RID, id: ORDER_ID}));

// 3) 주문 목록
console.log('3) order.list:', await trpc('pos.order.list', {restaurantId: RID}));

// 4) 멱등성 — 같은 idempotencyKey로 두 번 호출 시 동일 주문 반환
const KEY = crypto.randomUUID();
const o2a = await trpc('pos.order.create', {
  restaurantId: RID, orderMode: 'prepaid_pickup',
  items: [{ menuItemId: ITEM_ID, qty: 1 }],
  idempotencyKey: KEY,
}, 'mutation');
const o2b = await trpc('pos.order.create', {
  restaurantId: RID, orderMode: 'prepaid_pickup',
  items: [{ menuItemId: ITEM_ID, qty: 1 }],
  idempotencyKey: KEY,
}, 'mutation');
console.log('4a) 첫 호출:', o2a);
console.log('4b) 재호출:', o2b);
// 기대: 4b의 id == 4a의 id, idempotent: true

// 5) 채번 — 새 주문 생성 시 orderNo 0003 (첫 0001, 둘째 0002, 멱등 안 셈)
const o3 = await trpc('pos.order.create', {
  restaurantId: RID, orderMode: 'prepaid_pickup',
  items: [{ menuItemId: ITEM_ID, qty: 1 }],
}, 'mutation');
console.log('5) 채번 검증:', o3);
// 기대: orderNo='0003'

// 6) 가격 재계산 검증 — 클라가 이상한 값 보내도 무시
//    (클라이언트가 unitPrice를 보낼 수 없는 스키마이므로 자동으로 검증됨)
//    대신 옵션 검증: 다른 메뉴의 옵션 id를 섞으면 거부
//    ITEM_ID 외 다른 메뉴의 옵션을 끼우는 시나리오는 메뉴 1개라 생략 가능

// 7) 매장 격리 검증 — 다른 매장의 menuItemId 사용 시도
//    천호점에 다른 매장 메뉴는 없으니 임의의 큰 id로 시도
console.log('7) 매장 격리:', await trpc('pos.order.create', {
  restaurantId: RID, orderMode: 'prepaid_pickup',
  items: [{ menuItemId: 99999, qty: 1 }],
}, 'mutation'));
// 기대: BAD_REQUEST: 메뉴 id=99999가 본 매장에 없거나 삭제됨

// 8) markReady — open 상태에서 거부
console.log('8) markReady (open):', await trpc('pos.order.markReady', {restaurantId: RID, id: ORDER_ID}, 'mutation'));
// 기대: FAILED_PRECONDITION: 현재 상태=open. paid 상태에서만 ready 전이 가능

// 9) void — open 주문 취소
console.log('9) void:', await trpc('pos.order.void', {restaurantId: RID, id: ORDER_ID, reason: '고객 변심'}, 'mutation'));
// 기대: ok, status: 'voided'

// 10) void된 주문 다시 void 시도 — 거부
console.log('10) void 재시도:', await trpc('pos.order.void', {restaurantId: RID, id: ORDER_ID, reason: 'test'}, 'mutation'));
// 기대: FAILED_PRECONDITION

// 11) 품절 메뉴 주문 시도
await trpc('pos.menu.setSoldOut', {restaurantId: RID, id: ITEM_ID, isSoldOut: true}, 'mutation');
console.log('11) 품절 메뉴 주문:', await trpc('pos.order.create', {
  restaurantId: RID, orderMode: 'prepaid_pickup',
  items: [{ menuItemId: ITEM_ID, qty: 1 }],
}, 'mutation'));
// 기대: FAILED_PRECONDITION: 메뉴 '아메리카노' 품절

// 12) 품절 해제 후 정상 주문
await trpc('pos.menu.setSoldOut', {restaurantId: RID, id: ITEM_ID, isSoldOut: false}, 'mutation');

// 13) 비활성 매장 게이트 — 광명AK점(id=4)에서 order.create 시도
console.log('13) 게이트:', await trpc('pos.order.create', {
  restaurantId: 4, orderMode: 'prepaid_pickup',
  items: [{ menuItemId: 1, qty: 1 }],
}, 'mutation'));
// 기대: FORBIDDEN: POS가 이 매장에 활성화되지 않았습니다

// 14) 정리 — 테스트 데이터 삭제 (선택)
//     생성된 주문은 voided/active 그대로 두고, 메뉴는 다시 soft delete
await trpc('pos.menu.deleteItem', {restaurantId: RID, id: ITEM_ID}, 'mutation');
await trpc('pos.menu.deleteCategory', {restaurantId: RID, id: CAT_ID}, 'mutation');
console.log('정리 완료');
```

### 3.3 기대값 표

| 단계 | 기대 |
|---|---|
| 1) order.create | `id: <N>, orderNo: '0001', grandTotal: '14500.00', idempotent: false` |
| 2) order.get | items 2개, 첫 라인 lineTotal `10000.00`(5000×2), 둘째 `4500.00`. payments 빈 배열 |
| 3) order.list | 1건, 방금 만든 주문 |
| 4a) 첫 idempotent | `id: <M>, orderNo: '0002', idempotent: false` |
| 4b) 재호출 | `id: <M>, orderNo: '0002', idempotent: true` (id 동일) |
| 5) 채번 | `orderNo: '0003'` |
| 7) 매장 격리 | `BAD_REQUEST: 메뉴 id=99999가 본 매장에 없거나 삭제됨` |
| 8) markReady (open) | `FAILED_PRECONDITION` |
| 9) void | `ok: true, status: 'voided'` |
| 10) void 재시도 | `FAILED_PRECONDITION` |
| 11) 품절 주문 | `FAILED_PRECONDITION: 메뉴 '아메리카노' 품절` |
| 13) 게이트 | `FORBIDDEN: POS가 이 매장에 활성화되지 않았습니다` |

### 3.4 markServed/refund는 Payment 본문 #4 후 검증
- `paid` 상태로 만들려면 `pos.payment.record`가 필요. 현재는 시연 불가.
- 시그니처와 본문은 작성. payment.record 구현 후 통합 시연.

---

## 4. 5항 보고 템플릿

```
1. 변경 파일:
   - server/routers/pos.ts (order 라우터 본문 ~400 lines + 헬퍼 ~80 lines + import 보강)
2. 의도: POS Phase 1 본문 #3 — 주문 생성·조회·상태 전이·취소·환불 본문 + 활성화 게이트 적용
   채번(매장별 일일 4자리), 멱등성(uuid), 가격 재계산(서버 마스터), 매장 격리(메뉴+옵션 검증)
3. 영향 범위:
   - tRPC: pos.order.* 7개 endpoint 본문 동작
   - 권한: posStoreReadProcedure (조회), posStoreWriteProcedure (생성/상태전이), posStoreManagerProcedure (void/refund)
   - DB: 변경 없음
   - UI: 변경 없음
4. 리스크:
   - KST 채번: kstDateString() — 서버 시간이 UTC 가정. Railway는 UTC라 가정 일치 추정. 다르면 검증 필요.
   - 멱등성: pre-check + UNIQUE(uuid). 동시성 race는 UNIQUE 충돌로 catch 후 SELECT (현재 코드는 pre-check만 — race window 존재. 보강 필요시 후속 패치)
   - 가격 재계산: 서버 마스터 가격을 클라가 보지 못하면 UI에서 표시 가격과 결제 금액 불일치 가능. UI(P2)에서 실시간 메뉴 조회 필요.
   - markReady/markServed/refund: paid 상태가 필요 → payment 본문 #4까지는 통합 시연 불가. 시그니처만 검증.
   - 롤백: order 라우터 본문만 영향, 라우터 단위 revert 가능.
5. 빌드: pnpm run build ✅
```

---

## 5. 후속 PR 가이드

- 본 PR 통과 → **Payment 본문 #4** (`pos.payment.record`/`voidPayment`, paid 자동 전이)
- Payment 통과 후 markReady/markServed/refund 통합 시연
- 그 다음 **Reconciliation 본문 #5** → **Device 본문 #6**
- Device #6까지 끝나면 P1 완료, P2 UI 진입

---

## 6. 메모

- **순환 import 주의**: `posOrders` 등을 헬퍼 함수에서 사용할 때 schema import 경로 정확히
- **트랜잭션 내부에서 ctx.db 대신 tx 사용**: drizzle 표준
- **insertId**: settings/menu와 동일 패턴 (`(result as any).insertId`)
- **UNIQUE(uuid)**: schema에 이미 정의됨 (`uniq_pos_order_uuid`)
- **세금 계산**: 1차는 `taxTotal: 0`. taxType별 분리 계산은 P2 (월정산 연계 결정 필요)
