# POS P1 도메인 구현 — Code 핸드오프

> 작성: 2026-04-19 (Cowork)
> 대상: Claude Code 세션
> 선행 문서: `docs/pos-plan.md` v0.4
> 단계: P1 (스키마 + tRPC 라우터 골격). UI는 P2.

---

## 0. 목적·범위

본 핸드오프는 POS 1차 파일럿(`DEPT_PICKUP` 천호점)을 위한 **DB 스키마 추가 + tRPC 라우터 골격 + 자동 마이그레이션 ALTER 문** 작성을 Code 세션에서 일괄 처리하기 위한 지시문이다.

**범위**
- `drizzle/schema.ts` 끝에 13개 신규 테이블 추가 + `restaurants` 6컬럼 추가
- `server/index.ts` 자동 마이그레이션 블록에 idempotent ALTER 추가
- `server/routers/pos.ts` 신규 (단일 파일 안에 하위 라우터 7개 mount)
- `server/routers/index.ts` 에 `pos` 라우터 등록
- 페이지·UI 작업 없음 (P2)

**완료 조건**
- `pnpm run build` 통과
- Railway 배포 후 자동 ALTER 13개 테이블 + 6컬럼 정상 생성
- tRPC `pos.health.ping` 호출 성공 (스모크)

---

## 1. `drizzle/schema.ts` — 끝에 추가할 신규 테이블 13개

기존 컨벤션 그대로 따른다. `mysqlTable / mysqlEnum / decimal / timestamp / index / uniqueIndex` 사용. 각 테이블 직후 `$inferSelect` / `$inferInsert` 타입 export.

```ts
// ─── POS: Menu ───────────────────────────────────────────────────────────────
export const posMenuCategories = mysqlTable(
  "pos_menu_categories",
  {
    id: int("id").autoincrement().primaryKey(),
    restaurantId: int("restaurantId").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    displayOrder: int("displayOrder").default(0).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    deletedAt: timestamp("deletedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("idx_pos_menu_cat_rest").on(t.restaurantId, t.displayOrder)]
);
export type PosMenuCategory = typeof posMenuCategories.$inferSelect;
export type InsertPosMenuCategory = typeof posMenuCategories.$inferInsert;

export const posMenuItems = mysqlTable(
  "pos_menu_items",
  {
    id: int("id").autoincrement().primaryKey(),
    restaurantId: int("restaurantId").notNull(),
    categoryId: int("categoryId"),
    name: varchar("name", { length: 150 }).notNull(),
    price: decimal("price", { precision: 12, scale: 2 }).notNull().default("0"),
    imageUrl: varchar("imageUrl", { length: 500 }),
    recipeId: int("recipeId"),
    taxType: mysqlEnum("taxType", ["taxable", "exempt", "zero"])
      .default("taxable").notNull(),
    isSoldOut: boolean("isSoldOut").default(false).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    displayOrder: int("displayOrder").default(0).notNull(),
    deletedAt: timestamp("deletedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    index("idx_pos_menu_item_rest").on(t.restaurantId, t.categoryId, t.displayOrder),
    index("idx_pos_menu_item_active").on(t.restaurantId, t.isActive, t.deletedAt),
  ]
);
export type PosMenuItem = typeof posMenuItems.$inferSelect;
export type InsertPosMenuItem = typeof posMenuItems.$inferInsert;

export const posMenuOptionGroups = mysqlTable(
  "pos_menu_option_groups",
  {
    id: int("id").autoincrement().primaryKey(),
    menuItemId: int("menuItemId").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    minSelect: int("minSelect").default(0).notNull(),
    maxSelect: int("maxSelect").default(1).notNull(),
    isRequired: boolean("isRequired").default(false).notNull(),
    displayOrder: int("displayOrder").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_pos_optgrp_item").on(t.menuItemId)]
);
export type PosMenuOptionGroup = typeof posMenuOptionGroups.$inferSelect;
export type InsertPosMenuOptionGroup = typeof posMenuOptionGroups.$inferInsert;

export const posMenuOptions = mysqlTable(
  "pos_menu_options",
  {
    id: int("id").autoincrement().primaryKey(),
    optionGroupId: int("optionGroupId").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    priceDelta: decimal("priceDelta", { precision: 10, scale: 2 }).default("0").notNull(),
    displayOrder: int("displayOrder").default(0).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_pos_opt_group").on(t.optionGroupId)]
);
export type PosMenuOption = typeof posMenuOptions.$inferSelect;
export type InsertPosMenuOption = typeof posMenuOptions.$inferInsert;

// ─── POS: Orders ─────────────────────────────────────────────────────────────
export const posOrders = mysqlTable(
  "pos_orders",
  {
    id: int("id").autoincrement().primaryKey(),
    uuid: varchar("uuid", { length: 36 }).notNull(),  // 전역 UUID (멱등성)
    restaurantId: int("restaurantId").notNull(),
    orderNo: varchar("orderNo", { length: 16 }).notNull(),  // 매장별 일일 리셋 (예: A-015)
    orderMode: mysqlEnum("orderMode", [
      "prepaid_pickup",
      "prepaid_table",
      "postpaid_table",
    ]).notNull(),
    tableNo: varchar("tableNo", { length: 30 }),
    pagerNo: varchar("pagerNo", { length: 30 }),
    status: mysqlEnum("status", [
      "open", "paid", "ready", "served", "voided", "refunded",
    ]).notNull().default("open"),
    subtotal: decimal("subtotal", { precision: 12, scale: 2 }).default("0").notNull(),
    discountTotal: decimal("discountTotal", { precision: 12, scale: 2 }).default("0").notNull(),
    taxTotal: decimal("taxTotal", { precision: 12, scale: 2 }).default("0").notNull(),
    grandTotal: decimal("grandTotal", { precision: 12, scale: 2 }).default("0").notNull(),
    customerNote: varchar("customerNote", { length: 500 }),
    voidReason: varchar("voidReason", { length: 200 }),
    createdByUserId: int("createdByUserId").notNull(),
    deviceId: int("deviceId"),
    openedAt: timestamp("openedAt").defaultNow().notNull(),
    paidAt: timestamp("paidAt"),
    readyAt: timestamp("readyAt"),
    servedAt: timestamp("servedAt"),
    voidedAt: timestamp("voidedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    uniqueIndex("uniq_pos_order_uuid").on(t.uuid),
    index("idx_pos_order_rest_status").on(t.restaurantId, t.status, t.openedAt),
    index("idx_pos_order_rest_created").on(t.restaurantId, t.createdAt),
  ]
);
export type PosOrder = typeof posOrders.$inferSelect;
export type InsertPosOrder = typeof posOrders.$inferInsert;

export const posOrderItems = mysqlTable(
  "pos_order_items",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("orderId").notNull(),
    menuItemId: int("menuItemId"),
    menuItemNameSnapshot: varchar("menuItemNameSnapshot", { length: 150 }).notNull(),
    unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
    qty: int("qty").notNull().default(1),
    lineDiscount: decimal("lineDiscount", { precision: 10, scale: 2 }).default("0").notNull(),
    lineTotal: decimal("lineTotal", { precision: 12, scale: 2 }).notNull(),
    status: mysqlEnum("status", ["active", "voided"]).default("active").notNull(),
    note: varchar("note", { length: 200 }),  // 옵션 임시 표현(D17)
    voidedAt: timestamp("voidedAt"),
    voidedByUserId: int("voidedByUserId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_pos_orderitem_order").on(t.orderId)]
);
export type PosOrderItem = typeof posOrderItems.$inferSelect;
export type InsertPosOrderItem = typeof posOrderItems.$inferInsert;

export const posOrderItemOptions = mysqlTable(
  "pos_order_item_options",
  {
    id: int("id").autoincrement().primaryKey(),
    orderItemId: int("orderItemId").notNull(),
    optionName: varchar("optionName", { length: 100 }).notNull(),
    priceDelta: decimal("priceDelta", { precision: 10, scale: 2 }).default("0").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_pos_orderitemopt_item").on(t.orderItemId)]
);
export type PosOrderItemOption = typeof posOrderItemOptions.$inferSelect;
export type InsertPosOrderItemOption = typeof posOrderItemOptions.$inferInsert;

// ─── POS: Payments ───────────────────────────────────────────────────────────
export const posPayments = mysqlTable(
  "pos_payments",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("orderId").notNull(),
    method: mysqlEnum("method", [
      "card", "cash", "samsungpay", "kakaopay", "naverpay",
      "gift", "external", "etc",
    ]).notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    approvalNo: varchar("approvalNo", { length: 64 }),
    cardBrand: varchar("cardBrand", { length: 30 }),
    providerType: mysqlEnum("providerType", [
      "external_dept_store",
      "terminal_bridge",
      "van_direct",
      "manual",
    ]).notNull().default("manual"),
    providerRef: varchar("providerRef", { length: 200 }),
    createdByUserId: int("createdByUserId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    voidedAt: timestamp("voidedAt"),
  },
  (t) => [index("idx_pos_payment_order").on(t.orderId)]
);
export type PosPayment = typeof posPayments.$inferSelect;
export type InsertPosPayment = typeof posPayments.$inferInsert;

// ─── POS: Devices ────────────────────────────────────────────────────────────
export const posDevices = mysqlTable(
  "pos_devices",
  {
    id: int("id").autoincrement().primaryKey(),
    restaurantId: int("restaurantId").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    deviceType: mysqlEnum("deviceType", [
      "staff_counter", "staff_table", "kiosk", "kds",
    ]).notNull(),
    deviceTokenHash: varchar("deviceTokenHash", { length: 255 }),
    isActive: boolean("isActive").default(true).notNull(),
    lastSeenAt: timestamp("lastSeenAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_pos_device_rest").on(t.restaurantId, t.deviceType)]
);
export type PosDevice = typeof posDevices.$inferSelect;
export type InsertPosDevice = typeof posDevices.$inferInsert;

// ─── POS: Print Jobs (브릿지 에이전트 폴링용, 1차에서 사용 안 함) ─────────────
export const posPrintJobs = mysqlTable(
  "pos_print_jobs",
  {
    id: int("id").autoincrement().primaryKey(),
    restaurantId: int("restaurantId").notNull(),
    orderId: int("orderId").notNull(),
    printerType: mysqlEnum("printerType", ["kitchen", "receipt"]).notNull(),
    payload: json("payload").notNull(),
    status: mysqlEnum("status", ["pending", "printed", "failed"])
      .default("pending").notNull(),
    attempts: int("attempts").default(0).notNull(),
    errorMsg: varchar("errorMsg", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    printedAt: timestamp("printedAt"),
    failedAt: timestamp("failedAt"),
  },
  (t) => [index("idx_pos_printjob_rest_status").on(t.restaurantId, t.status, t.createdAt)]
);
export type PosPrintJob = typeof posPrintJobs.$inferSelect;
export type InsertPosPrintJob = typeof posPrintJobs.$inferInsert;

// ─── POS: Daily Reconciliation (외부 결제 매장 일일 대조) ─────────────────────
export const posDailyReconciliation = mysqlTable(
  "pos_daily_reconciliation",
  {
    id: int("id").autoincrement().primaryKey(),
    restaurantId: int("restaurantId").notNull(),
    date: date("date").notNull(),
    posGross: decimal("posGross", { precision: 14, scale: 2 }).default("0").notNull(),
    externalGross: decimal("externalGross", { precision: 14, scale: 2 }).default("0").notNull(),
    diff: decimal("diff", { precision: 14, scale: 2 }).default("0").notNull(),
    note: varchar("note", { length: 500 }),
    confirmedByUserId: int("confirmedByUserId"),
    confirmedAt: timestamp("confirmedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [uniqueIndex("uniq_pos_recon_rest_date").on(t.restaurantId, t.date)]
);
export type PosDailyReconciliation = typeof posDailyReconciliation.$inferSelect;
export type InsertPosDailyReconciliation = typeof posDailyReconciliation.$inferInsert;

// ─── POS: Order No Counter (매장별 일일 리셋) ────────────────────────────────
export const posOrderCounters = mysqlTable(
  "pos_order_counters",
  {
    id: int("id").autoincrement().primaryKey(),
    restaurantId: int("restaurantId").notNull(),
    date: date("date").notNull(),
    lastSeq: int("lastSeq").default(0).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [uniqueIndex("uniq_pos_ordercnt_rest_date").on(t.restaurantId, t.date)]
);
export type PosOrderCounter = typeof posOrderCounters.$inferSelect;
export type InsertPosOrderCounter = typeof posOrderCounters.$inferInsert;
```

총 11개 신규 테이블. (기존 v0.3 문서에서 13개로 표기했으나 실제 분해 결과 11개. `pos_print_jobs`·`pos_order_counters`·`pos_order_item_options` 포함.)

---

## 2. `restaurants` 테이블 컬럼 6개 추가

기존 `restaurants` 정의에 아래 컬럼을 추가:

```ts
posEnabled: boolean("posEnabled").default(false).notNull(),
posStylePreset: mysqlEnum("posStylePreset", [
  "DEPT_PICKUP",
  "SHOP_PICKUP",
  "SHOP_TABLE",
  "COURT_PICKUP",
  "KIOSK_PICKUP",
]),
posDefaultOrderMode: mysqlEnum("posDefaultOrderMode", [
  "prepaid_pickup", "prepaid_table", "postpaid_table",
]),
posPaymentProvider: mysqlEnum("posPaymentProvider", [
  "external_dept_store", "terminal_bridge", "van_direct", "manual",
]),
posKitchenRouter: mysqlEnum("posKitchenRouter", ["kds", "printer", "none"]),
posReconcileTolerance: int("posReconcileTolerance").default(0).notNull(),
```

---

## 3. `server/index.ts` 자동 마이그레이션 ALTER 추가

기존 idempotent 패턴(`ADD COLUMN IF NOT EXISTS` + `.catch(() => {})`) 따른다. 신규 테이블은 Drizzle push 또는 raw `CREATE TABLE IF NOT EXISTS`로. 본 프로젝트는 자동 마이그레이션 블록에 raw SQL을 쓰는 패턴이므로 동일하게:

```ts
// === POS Phase 1 ===

// restaurants 컬럼 6개
await conn.query(`
  ALTER TABLE restaurants
    ADD COLUMN IF NOT EXISTS posEnabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS posStylePreset
      ENUM('DEPT_PICKUP','SHOP_PICKUP','SHOP_TABLE','COURT_PICKUP','KIOSK_PICKUP') NULL,
    ADD COLUMN IF NOT EXISTS posDefaultOrderMode
      ENUM('prepaid_pickup','prepaid_table','postpaid_table') NULL,
    ADD COLUMN IF NOT EXISTS posPaymentProvider
      ENUM('external_dept_store','terminal_bridge','van_direct','manual') NULL,
    ADD COLUMN IF NOT EXISTS posKitchenRouter ENUM('kds','printer','none') NULL,
    ADD COLUMN IF NOT EXISTS posReconcileTolerance INT NOT NULL DEFAULT 0
`).catch(() => {});

// 11개 테이블 생성 (CREATE TABLE IF NOT EXISTS)
await conn.query(`
  CREATE TABLE IF NOT EXISTS pos_menu_categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurantId INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    displayOrder INT NOT NULL DEFAULT 0,
    isActive BOOLEAN NOT NULL DEFAULT TRUE,
    deletedAt TIMESTAMP NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_pos_menu_cat_rest (restaurantId, displayOrder)
  )
`).catch(() => {});

// ... (이하 11개 모두 동일 패턴. 각 컬럼·인덱스는 §1의 Drizzle 정의를 1:1로 SQL화)
```

**Code 세션에서 작성 시 주의**:
- 각 `CREATE TABLE` 블록마다 `.catch(() => {})` 붙여 idempotent 보장
- 컬럼 타입 매핑: `decimal(P,S)` → `DECIMAL(P,S)`, `mysqlEnum` → `ENUM(...)`, `int` → `INT`, `varchar(N)` → `VARCHAR(N)`, `text` → `TEXT`, `json` → `JSON`, `timestamp` → `TIMESTAMP`
- `defaultNow()` → `DEFAULT CURRENT_TIMESTAMP`
- `onUpdateNow()` → `ON UPDATE CURRENT_TIMESTAMP`
- `uniqueIndex` → `UNIQUE INDEX`
- 본 프로젝트는 외래키를 거의 사용 안 함(자동 마이그레이션 패턴 단순화 위해). 동일 정책 따름

---

## 4. `server/routers/pos.ts` 신규 — 라우터 골격

본 파일에 7개 sub-router 묶어 export. P1에서는 **시그니처와 핵심 로직만**, 복잡한 비즈니스 로직(재고차감·재료연계 등)은 비워둠. 모든 sub-router는 `verifyStoreAccess`로 매장 격리.

```ts
import { z } from "zod";
import { router, protectedProcedure, managerProcedure, ownerProcedure } from "../trpc";
import { verifyStoreAccess } from "../middleware/storeAuth";
import { db } from "../db";
import {
  posMenuCategories, posMenuItems, posMenuOptionGroups, posMenuOptions,
  posOrders, posOrderItems, posOrderItemOptions, posPayments,
  posDevices, posDailyReconciliation, posOrderCounters,
} from "../../drizzle/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

// 1) Health (스모크용)
const healthRouter = router({
  ping: protectedProcedure.query(() => ({ ok: true, ts: new Date().toISOString() })),
});

// 2) Menu (카테고리·메뉴·옵션 CRUD — 1차 옵션은 API만)
const menuRouter = router({
  listCategories: protectedProcedure
    .input(z.object({ restaurantId: z.number().int() }))
    .use(verifyStoreAccess)
    .query(async ({ input }) => {
      return db.select().from(posMenuCategories)
        .where(and(eq(posMenuCategories.restaurantId, input.restaurantId)))
        .orderBy(posMenuCategories.displayOrder);
    }),
  upsertCategory: managerProcedure
    .input(z.object({
      id: z.number().int().optional(),
      restaurantId: z.number().int(),
      name: z.string().min(1).max(100),
      displayOrder: z.number().int().default(0),
      isActive: z.boolean().default(true),
    }))
    .use(verifyStoreAccess)
    .mutation(async ({ input }) => { /* TODO: insert/update */ }),
  listItems: protectedProcedure
    .input(z.object({ restaurantId: z.number().int(), categoryId: z.number().int().optional() }))
    .use(verifyStoreAccess)
    .query(async ({ input }) => { /* TODO */ }),
  upsertItem: managerProcedure
    .input(z.object({ /* ... */ }))
    .use(verifyStoreAccess)
    .mutation(async ({ input }) => { /* TODO */ }),
  setSoldOut: managerProcedure
    .input(z.object({ restaurantId: z.number().int(), itemId: z.number().int(), isSoldOut: z.boolean() }))
    .use(verifyStoreAccess)
    .mutation(async ({ input }) => { /* TODO */ }),
});

// 3) Order (주문 생성·조회·상태전이·취소·환불)
const orderRouter = router({
  create: protectedProcedure
    .input(z.object({
      restaurantId: z.number().int(),
      orderMode: z.enum(["prepaid_pickup", "prepaid_table", "postpaid_table"]),
      tableNo: z.string().max(30).optional(),
      pagerNo: z.string().max(30).optional(),
      items: z.array(z.object({
        menuItemId: z.number().int(),
        qty: z.number().int().min(1),
        unitPrice: z.string(),
        note: z.string().max(200).optional(),
        options: z.array(z.object({ name: z.string(), priceDelta: z.string() })).default([]),
      })).min(1),
      discountTotal: z.string().default("0"),
      customerNote: z.string().max(500).optional(),
      idempotencyKey: z.string().uuid().optional(),
    }))
    .use(verifyStoreAccess)
    .mutation(async ({ input, ctx }) => {
      // TODO: 트랜잭션
      // 1. orderNo = 매장별 일일 리셋 (pos_order_counters)
      // 2. uuid = idempotencyKey ?? randomUUID()
      // 3. posOrders insert (orderMode 'postpaid_table'이면 status='open', 그 외 'open' 유지하다 결제 후 'paid')
      // 4. items, options insert
      // 5. subtotal/grandTotal 계산
      // 6. KitchenRouter dispatch (1차: KDS subscription publish는 P3에서. 여기선 데이터만 insert)
    }),
  get: protectedProcedure
    .input(z.object({ restaurantId: z.number().int(), id: z.number().int() }))
    .use(verifyStoreAccess)
    .query(async ({ input }) => { /* TODO */ }),
  list: protectedProcedure
    .input(z.object({
      restaurantId: z.number().int(),
      from: z.string().optional(),
      to: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().int().max(200).default(50),
    }))
    .use(verifyStoreAccess)
    .query(async ({ input }) => { /* TODO */ }),
  markReady: protectedProcedure
    .input(z.object({ restaurantId: z.number().int(), id: z.number().int() }))
    .use(verifyStoreAccess)
    .mutation(async ({ input }) => { /* TODO: status open|paid → ready (전이 검증) */ }),
  markServed: protectedProcedure
    .input(z.object({ restaurantId: z.number().int(), id: z.number().int() }))
    .use(verifyStoreAccess)
    .mutation(async ({ input }) => { /* TODO: ready → served */ }),
  void: managerProcedure
    .input(z.object({
      restaurantId: z.number().int(), id: z.number().int(),
      reason: z.string().min(1).max(200),
    }))
    .use(verifyStoreAccess)
    .mutation(async ({ input }) => { /* TODO: open → voided. 결제 있으면 거부, refund로 가야 함 */ }),
  refund: managerProcedure
    .input(z.object({
      restaurantId: z.number().int(), id: z.number().int(),
      reason: z.string().min(1).max(200),
    }))
    .use(verifyStoreAccess)
    .mutation(async ({ input }) => { /* TODO: paid|ready|served → refunded. 음수 결제 레코드 추가 */ }),
});

// 4) Payment (결제 기록·취소)
const paymentRouter = router({
  record: protectedProcedure
    .input(z.object({
      restaurantId: z.number().int(),
      orderId: z.number().int(),
      method: z.enum(["card","cash","samsungpay","kakaopay","naverpay","gift","external","etc"]),
      amount: z.string(),
      providerType: z.enum(["external_dept_store","terminal_bridge","van_direct","manual"]),
      approvalNo: z.string().max(64).optional(),
      cardBrand: z.string().max(30).optional(),
      providerRef: z.string().max(200).optional(),
    }))
    .use(verifyStoreAccess)
    .mutation(async ({ input, ctx }) => {
      // TODO: 트랜잭션
      // 1. posPayments insert
      // 2. order.grandTotal == sum(payments.amount)이면 order.status 'open'→'paid', paidAt=now
      // 3. external_dept_store 일 때는 approvalNo 선택. 천호점은 미입력 허용
    }),
  voidPayment: managerProcedure
    .input(z.object({ restaurantId: z.number().int(), id: z.number().int() }))
    .use(verifyStoreAccess)
    .mutation(async ({ input }) => { /* TODO: voidedAt=now, order 합계 재계산 */ }),
});

// 5) Device (POS 디바이스 등록·페어링)
const deviceRouter = router({
  list: ownerProcedure
    .input(z.object({ restaurantId: z.number().int() }))
    .use(verifyStoreAccess)
    .query(async ({ input }) => { /* TODO */ }),
  create: ownerProcedure
    .input(z.object({
      restaurantId: z.number().int(),
      name: z.string().min(1).max(100),
      deviceType: z.enum(["staff_counter","staff_table","kiosk","kds"]),
    }))
    .use(verifyStoreAccess)
    .mutation(async ({ input }) => {
      // TODO: 페어링 코드 1회용 발급 (서버 메모리/캐시), 키오스크/KDS만 토큰 필요
    }),
  pair: protectedProcedure
    .input(z.object({ pairingCode: z.string() }))
    .mutation(async ({ input }) => {
      // TODO: 페어링 코드 → 디바이스 토큰 발급 (cookie+localStorage 클라이언트 저장)
    }),
  revoke: ownerProcedure
    .input(z.object({ restaurantId: z.number().int(), id: z.number().int() }))
    .use(verifyStoreAccess)
    .mutation(async ({ input }) => { /* TODO: deviceTokenHash 무효화 */ }),
});

// 6) Reconciliation (일일 대조 — 외부 결제 매장)
const reconciliationRouter = router({
  getOrCreate: protectedProcedure
    .input(z.object({ restaurantId: z.number().int(), date: z.string() }))
    .use(verifyStoreAccess)
    .query(async ({ input }) => {
      // TODO: 해당 날짜 행 없으면 posGross 자동 집계해서 행 생성
    }),
  setExternal: managerProcedure
    .input(z.object({
      restaurantId: z.number().int(),
      date: z.string(),
      externalGross: z.string(),
      note: z.string().max(500).optional(),
    }))
    .use(verifyStoreAccess)
    .mutation(async ({ input }) => { /* TODO: externalGross·diff 갱신 */ }),
  confirm: managerProcedure
    .input(z.object({ restaurantId: z.number().int(), date: z.string() }))
    .use(verifyStoreAccess)
    .mutation(async ({ input, ctx }) => { /* TODO: confirmedByUserId·confirmedAt 기록 */ }),
});

// 7) Settings (POS 활성화·프리셋 적용)
const settingsRouter = router({
  enable: ownerProcedure
    .input(z.object({
      restaurantId: z.number().int(),
      stylePreset: z.enum(["DEPT_PICKUP","SHOP_PICKUP","SHOP_TABLE","COURT_PICKUP","KIOSK_PICKUP"]),
    }))
    .use(verifyStoreAccess)
    .mutation(async ({ input }) => {
      // TODO: 프리셋 매핑 적용 (부록 D), restaurants posEnabled=true
      // 프리셋 → orderMode/paymentProvider/kitchenRouter/reconcileTolerance 자동 주입
    }),
  override: ownerProcedure
    .input(z.object({
      restaurantId: z.number().int(),
      orderMode: z.enum(["prepaid_pickup","prepaid_table","postpaid_table"]).optional(),
      paymentProvider: z.enum(["external_dept_store","terminal_bridge","van_direct","manual"]).optional(),
      kitchenRouter: z.enum(["kds","printer","none"]).optional(),
      reconcileTolerance: z.number().int().optional(),
    }))
    .use(verifyStoreAccess)
    .mutation(async ({ input }) => { /* TODO: 부분 업데이트 */ }),
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
```

**중요**: 위 라우터는 **시그니처와 권한·매장 격리만 단단하게** 잡는 1차 골격. `TODO` 마크된 본문은 P1 이행 중 채운다. 우선순위:
1. `pos.health.ping` (스모크)
2. `pos.settings.enable` (천호점에 적용 가능해야 P2 진입)
3. `pos.menu.upsertCategory` / `pos.menu.upsertItem` / `pos.menu.listCategories` / `pos.menu.listItems`
4. `pos.order.create` / `pos.order.get` / `pos.order.list`
5. `pos.payment.record` (천호점 외부결제 시나리오)
6. `pos.order.markReady` / `markServed` / `void` / `refund`
7. `pos.reconciliation.*`
8. `pos.device.*` (P3 KDS 진입 전까지만)

---

## 5. `server/routers/index.ts` 등록

```ts
import { posRouter } from "./pos";
// ...
export const appRouter = router({
  // ...기존 라우터...
  pos: posRouter,
});
```

---

## 6. 권한·로직 주의사항

- 매장 격리: 모든 mutation/query는 `verifyStoreAccess` + `restaurantId` 명시
- 메뉴 CRUD: `managerProcedure` 이상 (D14)
- 주문 생성/상태 전이(ready/served): `protectedProcedure` (staff 포함)
- 주문 강제 취소(`void`)·환불(`refund`): `managerProcedure` 이상
- 디바이스/설정: `ownerProcedure` 이상 (D9·D14·D18)
- 트랜잭션: `pos.order.create`, `pos.payment.record`, `pos.order.refund`, `pos.order.void`는 반드시 트랜잭션
- 멱등성: `pos.order.create`에 `idempotencyKey` 옵션. 같은 UUID로 두 번 호출 시 1번째 결과 반환
- 주문번호 채번: `pos_order_counters`를 `INSERT ... ON DUPLICATE KEY UPDATE lastSeq=lastSeq+1` 패턴으로 원자적 증분
- 천호점 결제 흐름: `pos.order.create` 후 `pos.payment.record(providerType='external_dept_store')` 호출. `approvalNo` 선택 입력. `paid`로 자동 전이
- 백화점 매장 일일 대조: `pos_daily_reconciliation` 단일행 per (restaurantId, date). 외부금액이 기준, POS는 참고

---

## 7. 검증 절차 (Code 세션에서 실행)

1. `git fetch && git status -sb` — 깨끗한 상태 확인
2. 위 §1~§5 적용
3. `pnpm run build` — TypeScript + Vite + esbuild 통과
4. 로컬에서 자동 마이그레이션 ALTER 문법 검토 (실행은 Railway 배포 시 자동)
5. 커밋 메시지 한글, 임시 파일 작성 후 `git commit --file=<path>`
6. 배포 전 §8 5항 요약 보고 → 사용자 승인 → `git push`
7. Railway 배포 완료 후 prod에서 11개 신규 테이블 + 6컬럼 존재 확인 (READ-ONLY SELECT)
8. 프론트 임의 페이지에서 `trpc.pos.health.ping.useQuery()` 호출 시도 (스모크) — 또는 curl로 tRPC HTTP 호출

---

## 8. 배포 전 5항 요약 보고 템플릿

```
1. 변경 파일:
   - drizzle/schema.ts (+~250 lines)
   - server/index.ts (자동 마이그레이션 ALTER 블록 추가)
   - server/routers/pos.ts (신규)
   - server/routers/index.ts (1줄 추가)
2. 의도: POS Phase 1 도메인 도입. 천호점 파일럿(DEPT_PICKUP)을 위한 스키마+라우터 골격.
3. 영향 범위:
   - DB: 11개 신규 테이블, restaurants 6컬럼
   - tRPC: 신규 'pos' 루트 (sub: health/menu/order/payment/device/reconciliation/settings)
   - UI: 변경 없음
   - 권한: 신규, 기존 권한 영향 없음
4. 리스크:
   - 자동 마이그레이션 ALTER 실패 시 서버 부팅 영향 → IF NOT EXISTS·.catch()로 idempotent 보장
   - 라우터 본문 TODO 다수 → 호출 시 미구현 응답. P1 이행 중 점진 채움
   - 롤백: 신규 테이블·컬럼은 사용 처가 없으므로 그대로 두어도 무해
5. 빌드: pnpm run build 통과 (tsc + vite + esbuild) ✅/❌
```

---

## 9. P1 종료 조건 (요약)

- [ ] 11개 신규 테이블 + 6컬럼이 prod DB에 존재
- [ ] `pos.health.ping` 호출 성공
- [ ] `pos.settings.enable(restaurantId=천호점, stylePreset='DEPT_PICKUP')` 성공
- [ ] `pos.menu.upsertCategory` / `upsertItem` 으로 메뉴 1개 등록 → `listCategories` / `listItems` 로 조회 성공
- [ ] `pos.order.create` 로 주문 1건 생성 → `pos.payment.record(external_dept_store)` 로 결제 기록 → status `paid` 전이 확인
- [ ] `pos.order.markReady` / `markServed` 상태 전이 동작
- [ ] `pos.reconciliation.getOrCreate` / `setExternal` / `confirm` 흐름 동작
- [ ] CLAUDE.md §13 새 기능 추가 패턴 준수 (자동 마이그레이션 + 라우터 등록)

---

## 10. 미해소 이슈 (P1 진행 중에도 풀 수 있음)

- **Q-O13** OKPOS 메뉴 이식 방법 — 1차 운영은 수기 입력으로 시작 가능. 본격 마이그레이션은 P2 UI 진입 전 결정
- **Q-O14** 세금 정책 — `taxType` 기본값 `taxable` 채택. 천호점은 면세품목 거의 없음(추후 메뉴별 변경 가능)
- **Q-O15** 결제 분할/혼합 — 스키마 N건 결제 수용. UI 단일 수단만 1차

---

## 11. 메모

- `pos_print_jobs` 테이블은 1차에서 사용 안 함(KDS 우선, ADR-04). 스키마만 미리 잡아둠.
- 키오스크 페어링 코드는 메모리(또는 짧은 TTL) 캐시로 충분. 영구 저장 불필요.
- 라우터 본문 채우는 PR을 1개 큰 PR로 묶지 말고, 도메인별(menu / order / payment / reconciliation)로 분할하면 리뷰·롤백 쉬움. CLAUDE.md §3 자율 실행 규칙 범위 내.
