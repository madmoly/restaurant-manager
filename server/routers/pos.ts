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
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  router,
  protectedProcedure,
  masterProcedure,
  storeReadProcedure,
  storeWriteProcedure,
  storeManagerProcedure,
  storeOwnerProcedure,
  posStoreReadProcedure,
  posStoreManagerProcedure,
  posStoreOwnerProcedure,
} from "../trpc";
import { db } from "../db";
import {
  restaurants,
  posOrders,
  posMenuCategories,
  posMenuItems,
  posMenuOptionGroups,
  posMenuOptions,
  auditLogs,
} from "../../drizzle/schema";

const NOT_IMPLEMENTED = (where: string) =>
  new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `POS Phase 1 미구현 본문: ${where}`,
  });

// ─── 매장 스타일 프리셋 디폴트 (docs/pos-plan.md 부록 D) ──────────────────────
type StylePreset =
  | "DEPT_PICKUP"
  | "SHOP_PICKUP"
  | "SHOP_TABLE"
  | "COURT_PICKUP"
  | "KIOSK_PICKUP";

const PRESET_DEFAULTS: Record<
  StylePreset,
  {
    posDefaultOrderMode: "prepaid_pickup" | "prepaid_table" | "postpaid_table";
    posPaymentProvider:
      | "external_dept_store"
      | "terminal_bridge"
      | "van_direct"
      | "manual";
    posKitchenRouter: "kds" | "printer" | "none";
    posReconcileTolerance: number;
  }
> = {
  DEPT_PICKUP:  { posDefaultOrderMode: "prepaid_pickup", posPaymentProvider: "external_dept_store", posKitchenRouter: "kds",     posReconcileTolerance: 5000 },
  SHOP_PICKUP:  { posDefaultOrderMode: "prepaid_pickup", posPaymentProvider: "terminal_bridge",     posKitchenRouter: "kds",     posReconcileTolerance: 2000 },
  SHOP_TABLE:   { posDefaultOrderMode: "postpaid_table", posPaymentProvider: "terminal_bridge",     posKitchenRouter: "printer", posReconcileTolerance: 2000 },
  COURT_PICKUP: { posDefaultOrderMode: "prepaid_table",  posPaymentProvider: "terminal_bridge",     posKitchenRouter: "kds",     posReconcileTolerance: 3000 },
  KIOSK_PICKUP: { posDefaultOrderMode: "prepaid_pickup", posPaymentProvider: "terminal_bridge",     posKitchenRouter: "kds",     posReconcileTolerance: 2000 },
};

const stylePresetEnum = z.enum([
  "DEPT_PICKUP",
  "SHOP_PICKUP",
  "SHOP_TABLE",
  "COURT_PICKUP",
  "KIOSK_PICKUP",
]);

// ─── 1) Health (스모크용) ─────────────────────────────────────────────────────
const healthRouter = router({
  ping: protectedProcedure.query(() => ({
    ok: true,
    phase: "P1",
    ts: new Date().toISOString(),
  })),
});

// ─── 2) Menu (카테고리/메뉴/옵션) ──────────────────────────────────────────────
// posStoreRead/ManagerProcedure 사용 → 매장 격리 + posEnabled 활성화 게이트.
// 모든 mutation은 categoryId/menuItemId/optionGroupId의 매장 일치 검증.
const menuRouter = router({
  // ─── 카테고리 ────────────────────────────────────────────────────
  listCategories: posStoreReadProcedure
    .input(
      z.object({
        includeInactive: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const conds = [
        eq(posMenuCategories.restaurantId, ctx.restaurantId),
        isNull(posMenuCategories.deletedAt),
      ];
      if (!input.includeInactive) {
        conds.push(eq(posMenuCategories.isActive, true));
      }
      return db
        .select()
        .from(posMenuCategories)
        .where(and(...conds))
        .orderBy(posMenuCategories.displayOrder, posMenuCategories.id);
    }),

  upsertCategory: posStoreManagerProcedure
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        name: z.string().min(1).max(100),
        displayOrder: z.number().int().default(0),
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.id) {
        const [existing] = await db
          .select()
          .from(posMenuCategories)
          .where(eq(posMenuCategories.id, input.id))
          .limit(1);
        if (
          !existing ||
          existing.restaurantId !== ctx.restaurantId ||
          existing.deletedAt
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "카테고리를 찾을 수 없습니다.",
          });
        }
        await db
          .update(posMenuCategories)
          .set({
            name: input.name,
            displayOrder: input.displayOrder,
            isActive: input.isActive,
          })
          .where(eq(posMenuCategories.id, input.id));
        return { ok: true, id: input.id, created: false };
      }
      const [result] = await db.insert(posMenuCategories).values({
        restaurantId: ctx.restaurantId,
        name: input.name,
        displayOrder: input.displayOrder,
        isActive: input.isActive,
      });
      return {
        ok: true,
        id: Number((result as { insertId: number }).insertId),
        created: true,
      };
    }),

  deleteCategory: posStoreManagerProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select()
        .from(posMenuCategories)
        .where(eq(posMenuCategories.id, input.id))
        .limit(1);
      if (!existing || existing.restaurantId !== ctx.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const items = await db
        .select({ id: posMenuItems.id })
        .from(posMenuItems)
        .where(
          and(
            eq(posMenuItems.categoryId, input.id),
            isNull(posMenuItems.deletedAt)
          )
        )
        .limit(1);
      if (items.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "이 카테고리에 활성 메뉴가 있습니다. 먼저 메뉴를 삭제하거나 다른 카테고리로 옮기세요.",
        });
      }
      await db
        .update(posMenuCategories)
        .set({ deletedAt: new Date() })
        .where(eq(posMenuCategories.id, input.id));
      return { ok: true };
    }),

  // ─── 메뉴 항목 ────────────────────────────────────────────────────
  listItems: posStoreReadProcedure
    .input(
      z.object({
        categoryId: z.number().int().positive().optional(),
        includeInactive: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const conds = [
        eq(posMenuItems.restaurantId, ctx.restaurantId),
        isNull(posMenuItems.deletedAt),
      ];
      if (input.categoryId !== undefined) {
        conds.push(eq(posMenuItems.categoryId, input.categoryId));
      }
      if (!input.includeInactive) {
        conds.push(eq(posMenuItems.isActive, true));
      }
      return db
        .select()
        .from(posMenuItems)
        .where(and(...conds))
        .orderBy(posMenuItems.displayOrder, posMenuItems.id);
    }),

  upsertItem: posStoreManagerProcedure
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        categoryId: z.number().int().positive().optional(),
        name: z.string().min(1).max(150),
        price: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/, "가격은 숫자(소수점 둘째자리까지)"),
        imageUrl: z.string().max(500).optional(),
        recipeId: z.number().int().positive().optional(),
        taxType: z.enum(["taxable", "exempt", "zero"]).default("taxable"),
        displayOrder: z.number().int().default(0),
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.categoryId !== undefined) {
        const [cat] = await db
          .select()
          .from(posMenuCategories)
          .where(eq(posMenuCategories.id, input.categoryId))
          .limit(1);
        if (
          !cat ||
          cat.restaurantId !== ctx.restaurantId ||
          cat.deletedAt
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "카테고리가 이 매장과 일치하지 않거나 삭제되었습니다.",
          });
        }
      }

      if (input.id) {
        const [existing] = await db
          .select()
          .from(posMenuItems)
          .where(eq(posMenuItems.id, input.id))
          .limit(1);
        if (
          !existing ||
          existing.restaurantId !== ctx.restaurantId ||
          existing.deletedAt
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "메뉴를 찾을 수 없습니다.",
          });
        }
        const { id, ...patch } = input;
        await db.update(posMenuItems).set(patch).where(eq(posMenuItems.id, id));
        return { ok: true, id, created: false };
      }
      const { id: _omit, ...rest } = input;
      const [result] = await db.insert(posMenuItems).values({
        restaurantId: ctx.restaurantId,
        ...rest,
      });
      return {
        ok: true,
        id: Number((result as { insertId: number }).insertId),
        created: true,
      };
    }),

  setSoldOut: posStoreManagerProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        isSoldOut: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select()
        .from(posMenuItems)
        .where(eq(posMenuItems.id, input.id))
        .limit(1);
      if (
        !existing ||
        existing.restaurantId !== ctx.restaurantId ||
        existing.deletedAt
      ) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await db
        .update(posMenuItems)
        .set({ isSoldOut: input.isSoldOut })
        .where(eq(posMenuItems.id, input.id));
      return { ok: true, isSoldOut: input.isSoldOut };
    }),

  deleteItem: posStoreManagerProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select()
        .from(posMenuItems)
        .where(eq(posMenuItems.id, input.id))
        .limit(1);
      if (!existing || existing.restaurantId !== ctx.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await db
        .update(posMenuItems)
        .set({ deletedAt: new Date() })
        .where(eq(posMenuItems.id, input.id));
      return { ok: true };
    }),

  // ─── 옵션 그룹/옵션 (API만, UI는 2차 — Q-O11) ─────────────────────
  listOptionGroups: posStoreReadProcedure
    .input(z.object({ menuItemId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const [item] = await db
        .select()
        .from(posMenuItems)
        .where(eq(posMenuItems.id, input.menuItemId))
        .limit(1);
      if (!item || item.restaurantId !== ctx.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const groups = await db
        .select()
        .from(posMenuOptionGroups)
        .where(eq(posMenuOptionGroups.menuItemId, input.menuItemId))
        .orderBy(posMenuOptionGroups.displayOrder, posMenuOptionGroups.id);
      const groupIds = groups.map((g) => g.id);
      const options =
        groupIds.length === 0
          ? []
          : await db
              .select()
              .from(posMenuOptions)
              .where(inArray(posMenuOptions.optionGroupId, groupIds))
              .orderBy(posMenuOptions.displayOrder, posMenuOptions.id);
      return groups.map((g) => ({
        ...g,
        options: options.filter((o) => o.optionGroupId === g.id),
      }));
    }),

  upsertOptionGroup: posStoreManagerProcedure
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        menuItemId: z.number().int().positive(),
        name: z.string().min(1).max(100),
        minSelect: z.number().int().min(0).default(0),
        maxSelect: z.number().int().min(1).default(1),
        isRequired: z.boolean().default(false),
        displayOrder: z.number().int().default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [item] = await db
        .select()
        .from(posMenuItems)
        .where(eq(posMenuItems.id, input.menuItemId))
        .limit(1);
      if (!item || item.restaurantId !== ctx.restaurantId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "메뉴가 이 매장과 일치하지 않습니다.",
        });
      }
      if (input.minSelect > input.maxSelect) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "minSelect > maxSelect",
        });
      }
      if (input.id) {
        const [existing] = await db
          .select()
          .from(posMenuOptionGroups)
          .where(eq(posMenuOptionGroups.id, input.id))
          .limit(1);
        if (!existing || existing.menuItemId !== input.menuItemId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const { id, ...patch } = input;
        await db
          .update(posMenuOptionGroups)
          .set(patch)
          .where(eq(posMenuOptionGroups.id, id));
        return { ok: true, id, created: false };
      }
      const { id: _omit, ...insertVals } = input;
      const [result] = await db
        .insert(posMenuOptionGroups)
        .values(insertVals);
      return {
        ok: true,
        id: Number((result as { insertId: number }).insertId),
        created: true,
      };
    }),

  deleteOptionGroup: posStoreManagerProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [group] = await db
        .select({
          id: posMenuOptionGroups.id,
          menuItemId: posMenuOptionGroups.menuItemId,
        })
        .from(posMenuOptionGroups)
        .where(eq(posMenuOptionGroups.id, input.id))
        .limit(1);
      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const [item] = await db
        .select({ restaurantId: posMenuItems.restaurantId })
        .from(posMenuItems)
        .where(eq(posMenuItems.id, group.menuItemId))
        .limit(1);
      if (!item || item.restaurantId !== ctx.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // 옵션 → 그룹 순 hard delete (옵션 스냅샷이 주문라인에 있어 무관)
      await db.transaction(async (tx) => {
        await tx
          .delete(posMenuOptions)
          .where(eq(posMenuOptions.optionGroupId, input.id));
        await tx
          .delete(posMenuOptionGroups)
          .where(eq(posMenuOptionGroups.id, input.id));
      });
      return { ok: true };
    }),

  upsertOption: posStoreManagerProcedure
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        optionGroupId: z.number().int().positive(),
        name: z.string().min(1).max(100),
        priceDelta: z
          .string()
          .regex(/^-?\d+(\.\d{1,2})?$/)
          .default("0"),
        displayOrder: z.number().int().default(0),
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // 옵션 그룹 → 메뉴 → 매장 일치 검증
      const [group] = await db
        .select({ menuItemId: posMenuOptionGroups.menuItemId })
        .from(posMenuOptionGroups)
        .where(eq(posMenuOptionGroups.id, input.optionGroupId))
        .limit(1);
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });
      const [item] = await db
        .select({ restaurantId: posMenuItems.restaurantId })
        .from(posMenuItems)
        .where(eq(posMenuItems.id, group.menuItemId))
        .limit(1);
      if (!item || item.restaurantId !== ctx.restaurantId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "옵션 그룹이 이 매장과 일치하지 않습니다.",
        });
      }
      if (input.id) {
        const [existing] = await db
          .select()
          .from(posMenuOptions)
          .where(eq(posMenuOptions.id, input.id))
          .limit(1);
        if (!existing || existing.optionGroupId !== input.optionGroupId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const { id, ...patch } = input;
        await db
          .update(posMenuOptions)
          .set(patch)
          .where(eq(posMenuOptions.id, id));
        return { ok: true, id, created: false };
      }
      const { id: _omit, ...insertVals } = input;
      const [result] = await db.insert(posMenuOptions).values(insertVals);
      return {
        ok: true,
        id: Number((result as { insertId: number }).insertId),
        created: true,
      };
    }),

  deleteOption: posStoreManagerProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [opt] = await db
        .select({
          id: posMenuOptions.id,
          optionGroupId: posMenuOptions.optionGroupId,
        })
        .from(posMenuOptions)
        .where(eq(posMenuOptions.id, input.id))
        .limit(1);
      if (!opt) throw new TRPCError({ code: "NOT_FOUND" });
      const [group] = await db
        .select({ menuItemId: posMenuOptionGroups.menuItemId })
        .from(posMenuOptionGroups)
        .where(eq(posMenuOptionGroups.id, opt.optionGroupId))
        .limit(1);
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });
      const [item] = await db
        .select({ restaurantId: posMenuItems.restaurantId })
        .from(posMenuItems)
        .where(eq(posMenuItems.id, group.menuItemId))
        .limit(1);
      if (!item || item.restaurantId !== ctx.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await db.delete(posMenuOptions).where(eq(posMenuOptions.id, input.id));
      return { ok: true };
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
// 권한 분리:
//   - enable / disable      : master 전용 (시스템 차원에서 매장 POS 켜고 끔)
//   - applyPreset / override: storeOwner + 활성화 게이트 (점장이 본인 매장 미세조정)
//   - getStatus             : storeRead (활성화 여부 자체 확인용 — 게이트 없음)
const settingsRouter = router({
  // 1) 활성화 (master 전용)
  enable: masterProcedure
    .input(
      z.object({
        restaurantId: z.number().int().positive(),
        stylePreset: stylePresetEnum.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [target] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, input.restaurantId))
        .limit(1);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "매장을 찾을 수 없습니다." });
      }
      if (target.posEnabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "이미 POS가 활성화된 매장입니다. 변경하려면 applyPreset/override를 사용하세요.",
        });
      }
      const patch: Record<string, unknown> = { posEnabled: true };
      if (input.stylePreset) {
        patch.posStylePreset = input.stylePreset;
        Object.assign(patch, PRESET_DEFAULTS[input.stylePreset]);
      }
      await db
        .update(restaurants)
        .set(patch)
        .where(eq(restaurants.id, input.restaurantId));

      await db
        .insert(auditLogs)
        .values({
          userId: ctx.user.userId,
          restaurantId: input.restaurantId,
          action: "pos.settings.enable",
          target: "restaurant",
          targetId: input.restaurantId,
          details: { stylePreset: input.stylePreset ?? null },
        })
        .catch(() => {});

      return {
        ok: true,
        restaurantId: input.restaurantId,
        stylePreset: input.stylePreset ?? null,
      };
    }),

  // 2) 비활성화 (master 전용, 미완료 주문 있으면 거부)
  disable: masterProcedure
    .input(z.object({ restaurantId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [target] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, input.restaurantId))
        .limit(1);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "매장을 찾을 수 없습니다." });
      }
      if (!target.posEnabled) {
        return { ok: true, alreadyDisabled: true };
      }

      const openOrders = await db
        .select({ id: posOrders.id })
        .from(posOrders)
        .where(
          and(
            eq(posOrders.restaurantId, input.restaurantId),
            inArray(posOrders.status, ["open", "paid", "ready"])
          )
        );
      if (openOrders.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `미완료 주문이 ${openOrders.length}건 있어 비활성화할 수 없습니다. 모든 주문을 마감(served) 또는 취소 후 다시 시도하세요.`,
        });
      }

      await db
        .update(restaurants)
        .set({ posEnabled: false })
        .where(eq(restaurants.id, input.restaurantId));

      await db
        .insert(auditLogs)
        .values({
          userId: ctx.user.userId,
          restaurantId: input.restaurantId,
          action: "pos.settings.disable",
          target: "restaurant",
          targetId: input.restaurantId,
          details: null,
        })
        .catch(() => {});

      return { ok: true };
    }),

  // 3) 프리셋 재적용 (storeOwner + 활성화 게이트)
  applyPreset: posStoreOwnerProcedure
    .input(z.object({ stylePreset: stylePresetEnum }))
    .mutation(async ({ ctx, input }) => {
      const defaults = PRESET_DEFAULTS[input.stylePreset];
      await db
        .update(restaurants)
        .set({ posStylePreset: input.stylePreset, ...defaults })
        .where(eq(restaurants.id, ctx.restaurantId));

      await db
        .insert(auditLogs)
        .values({
          userId: ctx.user.userId,
          restaurantId: ctx.restaurantId,
          action: "pos.settings.applyPreset",
          target: "restaurant",
          targetId: ctx.restaurantId,
          details: { stylePreset: input.stylePreset, defaults },
        })
        .catch(() => {});

      return { ok: true, stylePreset: input.stylePreset, ...defaults };
    }),

  // 4) 부분 미세조정 (storeOwner + 활성화 게이트)
  override: posStoreOwnerProcedure
    .input(
      z.object({
        posDefaultOrderMode: z
          .enum(["prepaid_pickup", "prepaid_table", "postpaid_table"])
          .optional(),
        posPaymentProvider: z
          .enum(["external_dept_store", "terminal_bridge", "van_direct", "manual"])
          .optional(),
        posKitchenRouter: z.enum(["kds", "printer", "none"]).optional(),
        posReconcileTolerance: z.number().int().min(0).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const fields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) {
        if (v !== undefined && k !== "restaurantId") fields[k] = v;
      }
      if (Object.keys(fields).length === 0) {
        return { ok: true, noop: true };
      }
      await db
        .update(restaurants)
        .set(fields)
        .where(eq(restaurants.id, ctx.restaurantId));

      await db
        .insert(auditLogs)
        .values({
          userId: ctx.user.userId,
          restaurantId: ctx.restaurantId,
          action: "pos.settings.override",
          target: "restaurant",
          targetId: ctx.restaurantId,
          details: fields,
        })
        .catch(() => {});

      return { ok: true, applied: fields };
    }),

  // 5) 상태 조회 (storeRead, 게이트 없음 — 활성화 여부 자체 확인용)
  getStatus: storeReadProcedure.query(async ({ ctx }) => {
    const [r] = await db
      .select({
        posEnabled: restaurants.posEnabled,
        posStylePreset: restaurants.posStylePreset,
        posDefaultOrderMode: restaurants.posDefaultOrderMode,
        posPaymentProvider: restaurants.posPaymentProvider,
        posKitchenRouter: restaurants.posKitchenRouter,
        posReconcileTolerance: restaurants.posReconcileTolerance,
      })
      .from(restaurants)
      .where(eq(restaurants.id, ctx.restaurantId))
      .limit(1);
    if (!r) {
      throw new TRPCError({ code: "NOT_FOUND", message: "매장을 찾을 수 없습니다." });
    }
    return r;
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
