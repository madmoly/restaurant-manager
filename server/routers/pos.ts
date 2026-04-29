/**
 * POS Phase 1 (2026-04-19) — 라우터 골격
 *
 * 시그니처·권한·매장 격리만 단단히 잡고, 비즈니스 본문(`TODO`)은 도메인별
 * 후속 PR에서 점진 구현. 본 파일에 7개 sub-router를 묶어 export.
 *
 * 권한 매핑 (docs/pos-p1-handoff.md §6 + 부록 A):
 *   - 메뉴 조회         : storeReadProcedure   (staff 이상 + 매장격리)
 *   - 메뉴 변경         : storeManagerProcedure (manager 이상 + 매장격리)
 *   - 주문 생성/상태전이 : storeWriteProcedure  (staff 이상 + 매장격리)
 *   - 주문 void/refund  : storeManagerProcedure
 *   - 결제 기록         : storeWriteProcedure
 *   - 결제 취소         : storeManagerProcedure
 *   - 일일대조 조회      : storeReadProcedure
 *   - 일일대조 수정/확정 : storeManagerProcedure
 *   - 디바이스 관리      : storeOwnerProcedure (owner 전용 + 매장격리)
 *   - POS 활성화/설정    : storeOwnerProcedure
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  router,
  protectedProcedure,
  storeReadProcedure,
  storeWriteProcedure,
  storeManagerProcedure,
  storeOwnerProcedure,
} from "../trpc";

const NOT_IMPLEMENTED = (where: string) =>
  new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `POS Phase 1 미구현 본문: ${where}`,
  });

// ─── 1) Health (스모크용) ─────────────────────────────────────────────────────
const healthRouter = router({
  ping: protectedProcedure.query(() => ({
    ok: true,
    phase: "P1",
    ts: new Date().toISOString(),
  })),
});

// ─── 2) Menu (카테고리/메뉴/옵션) ──────────────────────────────────────────────
const menuRouter = router({
  listCategories: storeReadProcedure.query(async () => {
    throw NOT_IMPLEMENTED("menu.listCategories");
  }),
  upsertCategory: storeManagerProcedure
    .input(
      z.object({
        id: z.number().int().optional(),
        name: z.string().min(1).max(100),
        displayOrder: z.number().int().default(0),
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async () => {
      throw NOT_IMPLEMENTED("menu.upsertCategory");
    }),
  listItems: storeReadProcedure
    .input(z.object({ categoryId: z.number().int().optional() }))
    .query(async () => {
      throw NOT_IMPLEMENTED("menu.listItems");
    }),
  upsertItem: storeManagerProcedure
    .input(
      z.object({
        id: z.number().int().optional(),
        categoryId: z.number().int().nullable().optional(),
        name: z.string().min(1).max(150),
        price: z.string(),
        imageUrl: z.string().max(500).nullable().optional(),
        recipeId: z.number().int().nullable().optional(),
        taxType: z.enum(["taxable", "exempt", "zero"]).default("taxable"),
        isActive: z.boolean().default(true),
        displayOrder: z.number().int().default(0),
      })
    )
    .mutation(async () => {
      throw NOT_IMPLEMENTED("menu.upsertItem");
    }),
  setSoldOut: storeManagerProcedure
    .input(z.object({ itemId: z.number().int(), isSoldOut: z.boolean() }))
    .mutation(async () => {
      throw NOT_IMPLEMENTED("menu.setSoldOut");
    }),
});

// ─── 3) Order (주문 생성/조회/상태전이/취소/환불) ────────────────────────────
const orderItemInput = z.object({
  menuItemId: z.number().int(),
  qty: z.number().int().min(1),
  unitPrice: z.string(),
  note: z.string().max(200).optional(),
  options: z
    .array(z.object({ name: z.string().max(100), priceDelta: z.string() }))
    .default([]),
});

const orderRouter = router({
  create: storeWriteProcedure
    .input(
      z.object({
        orderMode: z.enum(["prepaid_pickup", "prepaid_table", "postpaid_table"]),
        tableNo: z.string().max(30).optional(),
        pagerNo: z.string().max(30).optional(),
        items: z.array(orderItemInput).min(1),
        discountTotal: z.string().default("0"),
        customerNote: z.string().max(500).optional(),
        idempotencyKey: z.string().uuid().optional(),
      })
    )
    .mutation(async () => {
      // TODO: 트랜잭션
      // 1. orderNo = pos_order_counters 매장별 일일 리셋
      // 2. uuid = idempotencyKey ?? randomUUID()  (멱등성)
      // 3. posOrders / posOrderItems / posOrderItemOptions insert
      // 4. subtotal/grandTotal 계산
      // 5. KitchenRouter dispatch (1차: KDS subscription publish는 P3에서)
      throw NOT_IMPLEMENTED("order.create");
    }),
  get: storeReadProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async () => {
      throw NOT_IMPLEMENTED("order.get");
    }),
  list: storeReadProcedure
    .input(
      z.object({
        from: z.string().optional(),
        to: z.string().optional(),
        status: z.string().optional(),
        limit: z.number().int().max(200).default(50),
      })
    )
    .query(async () => {
      throw NOT_IMPLEMENTED("order.list");
    }),
  markReady: storeWriteProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async () => {
      // TODO: status open|paid → ready (전이 검증)
      throw NOT_IMPLEMENTED("order.markReady");
    }),
  markServed: storeWriteProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async () => {
      // TODO: ready → served
      throw NOT_IMPLEMENTED("order.markServed");
    }),
  void: storeManagerProcedure
    .input(z.object({ id: z.number().int(), reason: z.string().min(1).max(200) }))
    .mutation(async () => {
      // TODO: open → voided. 결제 있으면 거부, refund로 가야 함
      throw NOT_IMPLEMENTED("order.void");
    }),
  refund: storeManagerProcedure
    .input(z.object({ id: z.number().int(), reason: z.string().min(1).max(200) }))
    .mutation(async () => {
      // TODO: paid|ready|served → refunded. 음수 결제 레코드 추가
      throw NOT_IMPLEMENTED("order.refund");
    }),
});

// ─── 4) Payment (결제 기록/취소) ──────────────────────────────────────────────
const paymentRouter = router({
  record: storeWriteProcedure
    .input(
      z.object({
        orderId: z.number().int(),
        method: z.enum([
          "card",
          "cash",
          "samsungpay",
          "kakaopay",
          "naverpay",
          "gift",
          "external",
          "etc",
        ]),
        amount: z.string(),
        providerType: z.enum([
          "external_dept_store",
          "terminal_bridge",
          "van_direct",
          "manual",
        ]),
        approvalNo: z.string().max(64).optional(),
        cardBrand: z.string().max(30).optional(),
        providerRef: z.string().max(200).optional(),
      })
    )
    .mutation(async () => {
      // TODO: 트랜잭션
      // 1. posPayments insert
      // 2. order.grandTotal == sum(payments.amount) 이면 status open→paid, paidAt=now
      // 3. external_dept_store 일 때 approvalNo 선택. 천호점은 미입력 허용
      throw NOT_IMPLEMENTED("payment.record");
    }),
  voidPayment: storeManagerProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async () => {
      // TODO: voidedAt=now, order 합계 재계산
      throw NOT_IMPLEMENTED("payment.voidPayment");
    }),
});

// ─── 5) Device (POS 디바이스 등록/페어링) ────────────────────────────────────
const deviceRouter = router({
  list: storeOwnerProcedure.query(async () => {
    throw NOT_IMPLEMENTED("device.list");
  }),
  create: storeOwnerProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        deviceType: z.enum(["staff_counter", "staff_table", "kiosk", "kds"]),
      })
    )
    .mutation(async () => {
      // TODO: 페어링 코드 1회용 발급(서버 메모리/캐시), 키오스크/KDS만 토큰 필요
      throw NOT_IMPLEMENTED("device.create");
    }),
  pair: protectedProcedure
    .input(z.object({ pairingCode: z.string() }))
    .mutation(async () => {
      // TODO: 페어링 코드 → 디바이스 토큰 발급 (cookie+localStorage 저장)
      throw NOT_IMPLEMENTED("device.pair");
    }),
  revoke: storeOwnerProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async () => {
      // TODO: deviceTokenHash 무효화
      throw NOT_IMPLEMENTED("device.revoke");
    }),
});

// ─── 6) Reconciliation (일일 대조) ────────────────────────────────────────────
const reconciliationRouter = router({
  getOrCreate: storeReadProcedure
    .input(z.object({ date: z.string() }))
    .query(async () => {
      // TODO: 해당 날짜 행 없으면 posGross 자동 집계해서 행 생성
      throw NOT_IMPLEMENTED("reconciliation.getOrCreate");
    }),
  setExternal: storeManagerProcedure
    .input(
      z.object({
        date: z.string(),
        externalGross: z.string(),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async () => {
      // TODO: externalGross / diff 갱신
      throw NOT_IMPLEMENTED("reconciliation.setExternal");
    }),
  confirm: storeManagerProcedure
    .input(z.object({ date: z.string() }))
    .mutation(async () => {
      // TODO: confirmedByUserId / confirmedAt 기록
      throw NOT_IMPLEMENTED("reconciliation.confirm");
    }),
});

// ─── 7) Settings (POS 활성화/프리셋) ──────────────────────────────────────────
const settingsRouter = router({
  enable: storeOwnerProcedure
    .input(
      z.object({
        stylePreset: z.enum([
          "DEPT_PICKUP",
          "SHOP_PICKUP",
          "SHOP_TABLE",
          "COURT_PICKUP",
          "KIOSK_PICKUP",
        ]),
      })
    )
    .mutation(async () => {
      // TODO: 부록 D 프리셋 매핑 적용 — orderMode/paymentProvider/kitchenRouter/reconcileTolerance 자동 주입,
      //       restaurants.posEnabled=true
      throw NOT_IMPLEMENTED("settings.enable");
    }),
  override: storeOwnerProcedure
    .input(
      z.object({
        orderMode: z
          .enum(["prepaid_pickup", "prepaid_table", "postpaid_table"])
          .optional(),
        paymentProvider: z
          .enum(["external_dept_store", "terminal_bridge", "van_direct", "manual"])
          .optional(),
        kitchenRouter: z.enum(["kds", "printer", "none"]).optional(),
        reconcileTolerance: z.number().int().optional(),
      })
    )
    .mutation(async () => {
      // TODO: 부분 업데이트
      throw NOT_IMPLEMENTED("settings.override");
    }),
});

export const posRouter = router({
  health: healthRouter,
  menu: menuRouter,
  order: orderRouter,
  payment: paymentRouter,
  device: deviceRouter,
  reconciliation: reconciliationRouter,
  settings: settingsRouter,
});
