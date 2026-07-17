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
import { randomUUID, createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, desc, gte, lte, sql } from "drizzle-orm";
import {
  router,
  publicProcedure,
  protectedProcedure,
  masterProcedure,
  storeReadProcedure,
  storeWriteProcedure,
  storeManagerProcedure,
  storeOwnerProcedure,
  posStoreReadProcedure,
  posStoreWriteProcedure,
  posStoreManagerProcedure,
  posStoreOwnerProcedure,
} from "../trpc";
import { db } from "../db";
import {
  restaurants,
  posOrders,
  posOrderItems,
  posOrderItemOptions,
  posPayments,
  posOrderCounters,
  posDailyReconciliation,
  posDevices,
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

// ─── Order 헬퍼 (Phase 1 본문 #3) ─────────────────────────────────────────────

/** KST 기준 'YYYY-MM-DD' 반환. Railway는 UTC 시간대로 동작하므로 +9h 보정. */
function kstDateString(d: Date = new Date()): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** KST 'YYYY-MM-DD'를 UTC date range [start, end)로 변환. 일일 집계용. */
function kstDateRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// ─── Device 페어링 (Phase 1 본문 #6) ─────────────────────────────────────────
// 페어링 코드 메모리 캐시 (5분 TTL, 1회용). Railway 재배포 시 휘발 — 의도된 단순성.
// 사용자가 5분 안에 재발급하면 됨.
const pairingCodes = new Map<
  string,
  { deviceId: number; restaurantId: number; expiresAt: number }
>();

function cleanupExpiredPairingCodes(): void {
  const now = Date.now();
  for (const [code, info] of pairingCodes) {
    if (info.expiresAt < now) pairingCodes.delete(code);
  }
}

function generatePairingCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 매장별 일일 채번 (4자리 zero-pad). 트랜잭션 안에서만 호출.
 * INSERT ... ON DUPLICATE KEY UPDATE lastSeq = lastSeq + 1 패턴으로 원자 증분.
 */
async function nextOrderNo(
  tx: Tx,
  restaurantId: number,
  date: string
): Promise<string> {
  await tx.execute(sql`
    INSERT INTO pos_order_counters (restaurantId, date, lastSeq)
    VALUES (${restaurantId}, ${date}, 1)
    ON DUPLICATE KEY UPDATE lastSeq = lastSeq + 1
  `);
  const [row] = await tx
    .select({ lastSeq: posOrderCounters.lastSeq })
    .from(posOrderCounters)
    .where(
      and(
        eq(posOrderCounters.restaurantId, restaurantId),
        eq(posOrderCounters.date, new Date(date))
      )
    )
    .limit(1);
  if (!row) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "주문번호 채번 실패",
    });
  }
  return String(row.lastSeq).padStart(4, "0");
}

/**
 * 가격 재계산: 클라이언트가 보낸 unitPrice는 무시. 서버가 메뉴 마스터 가격
 * (`pos_menu_items.price` + `pos_menu_options.priceDelta`)으로 재계산.
 * N+1 방지: 메뉴/옵션 일괄 조회.
 */
async function resolvePricedItems(
  tx: Tx,
  restaurantId: number,
  items: Array<{
    menuItemId: number;
    qty: number;
    optionIds?: number[];
    note?: string;
  }>
) {
  if (items.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "주문 아이템이 비어있습니다.",
    });
  }
  const menuIds = [...new Set(items.map((i) => i.menuItemId))];
  const menus = await tx
    .select()
    .from(posMenuItems)
    .where(
      and(
        inArray(posMenuItems.id, menuIds),
        eq(posMenuItems.restaurantId, restaurantId),
        isNull(posMenuItems.deletedAt)
      )
    );
  const menuMap = new Map<number, (typeof menus)[number]>();
  for (const m of menus) menuMap.set(m.id, m);

  for (const i of items) {
    const m = menuMap.get(i.menuItemId);
    if (!m) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `메뉴 id=${i.menuItemId}가 본 매장에 없거나 삭제됨`,
      });
    }
    if (m.isSoldOut) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `메뉴 '${m.name}' 품절`,
      });
    }
  }

  const allOptionIds = [
    ...new Set(items.flatMap((i) => i.optionIds ?? [])),
  ];
  const options =
    allOptionIds.length === 0
      ? []
      : await tx
          .select({
            id: posMenuOptions.id,
            name: posMenuOptions.name,
            priceDelta: posMenuOptions.priceDelta,
            optionGroupId: posMenuOptions.optionGroupId,
            menuItemId: posMenuOptionGroups.menuItemId,
          })
          .from(posMenuOptions)
          .innerJoin(
            posMenuOptionGroups,
            eq(posMenuOptionGroups.id, posMenuOptions.optionGroupId)
          )
          .where(
            and(
              inArray(posMenuOptions.id, allOptionIds),
              eq(posMenuOptions.isActive, true)
            )
          );
  const optMap = new Map<number, (typeof options)[number]>();
  for (const o of options) optMap.set(o.id, o);

  const resolved = items.map((i) => {
    const m = menuMap.get(i.menuItemId)!;
    const unitPrice = Number(m.price);
    const itemOptions = (i.optionIds ?? []).map((oid) => {
      const o = optMap.get(oid);
      if (!o) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `옵션 id=${oid} 없음 또는 비활성`,
        });
      }
      if (o.menuItemId !== i.menuItemId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `옵션 id=${oid}이 메뉴 id=${i.menuItemId}와 매칭되지 않음`,
        });
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
      options: itemOptions.map((o) => ({
        name: o.name,
        priceDelta: o.priceDelta.toFixed(2),
      })),
      note: i.note,
    };
  });

  const subtotal = resolved.reduce((s, r) => s + Number(r.lineTotal), 0);
  return { resolved, subtotal };
}

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
      // rest.restaurantId는 storeXxxProcedure가 머지한 값 = ctx.restaurantId. 그대로 사용.
      const [result] = await db.insert(posMenuItems).values(rest);
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
// 결정값 (docs/pos-p1-order-patch.md §0):
//   - 채번: 매장별 일일 리셋 4자리 zero-pad (KST 자정), 전역 UUID는 별도 보존
//   - 가격: 서버가 마스터 가격 재계산 (클라 unitPrice는 받지도 않음)
//   - 초기 상태: 항상 'open' (paid 전이는 payment.record에서)
//   - 멱등성: idempotencyKey 옵션, 안 보내면 서버 randomUUID 생성
const orderItemInputSchema = z.object({
  menuItemId: z.number().int().positive(),
  qty: z.number().int().min(1),
  optionIds: z.array(z.number().int().positive()).default([]),
  note: z.string().max(200).optional(),
});

const orderInputSchema = z.object({
  orderMode: z.enum(["prepaid_pickup", "prepaid_table", "postpaid_table"]),
  tableNo: z.string().max(30).optional(),
  pagerNo: z.string().max(30).optional(),
  items: z.array(orderItemInputSchema).min(1),
  discountTotal: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "할인은 숫자(소수점 둘째자리까지)")
    .default("0"),
  customerNote: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

const orderRouter = router({
  // ─── 생성 ────────────────────────────────────────────────────────
  create: posStoreWriteProcedure
    .input(orderInputSchema)
    .mutation(async ({ ctx, input }) => {
      const uuid = input.idempotencyKey ?? randomUUID();

      // 멱등성 사전 체크 (race window는 후속 보강 가능 — UNIQUE(uuid) 제약 활용)
      const [existing] = await db
        .select()
        .from(posOrders)
        .where(eq(posOrders.uuid, uuid))
        .limit(1);
      if (existing) {
        if (existing.restaurantId !== ctx.restaurantId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "idempotencyKey가 다른 매장 주문에 이미 사용됨",
          });
        }
        return {
          ok: true,
          id: existing.id,
          orderNo: existing.orderNo,
          uuid: existing.uuid,
          grandTotal: existing.grandTotal,
          idempotent: true,
        };
      }

      return db.transaction(async (tx) => {
        // 가격 재계산 (서버 마스터 가격) — 클라 unitPrice는 받지도 않음
        const { resolved, subtotal } = await resolvePricedItems(
          tx,
          ctx.restaurantId,
          input.items
        );
        const discountTotal = Number(input.discountTotal);
        const grandTotal = Math.max(0, subtotal - discountTotal);

        // 채번 (KST 자정 리셋, 4자리 zero-pad)
        const date = kstDateString();
        const orderNo = await nextOrderNo(tx, ctx.restaurantId, date);

        // posOrders insert
        const [orderResult] = await tx.insert(posOrders).values({
          uuid,
          restaurantId: ctx.restaurantId,
          orderNo,
          orderMode: input.orderMode,
          tableNo: input.tableNo ?? null,
          pagerNo: input.pagerNo ?? null,
          status: "open",
          subtotal: subtotal.toFixed(2),
          discountTotal: discountTotal.toFixed(2),
          taxTotal: "0", // 1차는 세금 분리 미적용 (P2)
          grandTotal: grandTotal.toFixed(2),
          customerNote: input.customerNote ?? null,
          createdByUserId: ctx.user.userId,
          deviceId: null,
        });
        const orderId = Number(
          (orderResult as { insertId: number }).insertId
        );

        // posOrderItems + posOrderItemOptions insert
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
          const orderItemId = Number(
            (itemResult as { insertId: number }).insertId
          );
          for (const o of r.options) {
            await tx.insert(posOrderItemOptions).values({
              orderItemId,
              optionName: o.name,
              priceDelta: o.priceDelta,
            });
          }
        }

        return {
          ok: true,
          id: orderId,
          orderNo,
          uuid,
          grandTotal: grandTotal.toFixed(2),
          idempotent: false,
        };
      });
    }),

  // ─── 조회 ────────────────────────────────────────────────────────
  get: posStoreReadProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const [order] = await db
        .select()
        .from(posOrders)
        .where(eq(posOrders.id, input.id))
        .limit(1);
      if (!order || order.restaurantId !== ctx.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const items = await db
        .select()
        .from(posOrderItems)
        .where(eq(posOrderItems.orderId, input.id))
        .orderBy(posOrderItems.id);
      const itemIds = items.map((i) => i.id);
      const opts =
        itemIds.length === 0
          ? []
          : await db
              .select()
              .from(posOrderItemOptions)
              .where(inArray(posOrderItemOptions.orderItemId, itemIds));
      const payments = await db
        .select()
        .from(posPayments)
        .where(eq(posPayments.orderId, input.id))
        .orderBy(posPayments.id);
      return {
        ...order,
        items: items.map((it) => ({
          ...it,
          options: opts.filter((o) => o.orderItemId === it.id),
        })),
        payments,
      };
    }),

  list: posStoreReadProcedure
    .input(
      z.object({
        from: z.string().optional(),
        to: z.string().optional(),
        status: z
          .enum(["open", "paid", "ready", "served", "voided", "refunded"])
          .optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const conds = [eq(posOrders.restaurantId, ctx.restaurantId)];
      if (input.from) conds.push(gte(posOrders.createdAt, new Date(input.from)));
      if (input.to) conds.push(lte(posOrders.createdAt, new Date(input.to)));
      if (input.status) conds.push(eq(posOrders.status, input.status));
      return db
        .select()
        .from(posOrders)
        .where(and(...conds))
        .orderBy(desc(posOrders.createdAt))
        .limit(input.limit);
    }),

  // ─── KDS 보드 (④): 조리 대기(paid)/준비완료(ready) + 품목 일괄 조회 ──────
  //   - 3쿼리 고정(orders → items → options)으로 N+1 회피 (⑤ G3와 동일 원칙)
  //   - 정렬: paidAt asc — 주방은 오래된 주문부터 처리
  //   - voided 품목 제외 (조리 대상 아님)
  kdsBoard: posStoreReadProcedure.query(async ({ ctx }) => {
    const orders = await db
      .select()
      .from(posOrders)
      .where(
        and(
          eq(posOrders.restaurantId, ctx.restaurantId),
          inArray(posOrders.status, ["paid", "ready"])
        )
      )
      .orderBy(posOrders.paidAt)
      .limit(100);
    const orderIds = orders.map((o) => o.id);
    const items =
      orderIds.length === 0
        ? []
        : await db
            .select()
            .from(posOrderItems)
            .where(
              and(
                inArray(posOrderItems.orderId, orderIds),
                eq(posOrderItems.status, "active")
              )
            )
            .orderBy(posOrderItems.id);
    const itemIds = items.map((i) => i.id);
    const opts =
      itemIds.length === 0
        ? []
        : await db
            .select()
            .from(posOrderItemOptions)
            .where(inArray(posOrderItemOptions.orderItemId, itemIds));
    return orders.map((o) => ({
      ...o,
      items: items
        .filter((it) => it.orderId === o.id)
        .map((it) => ({
          ...it,
          options: opts.filter((op) => op.orderItemId === it.id),
        })),
    }));
  }),

  // ─── 상태 전이 (paid 진입은 payment.record가 담당) ────────────────
  markReady: posStoreWriteProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [o] = await db
        .select()
        .from(posOrders)
        .where(eq(posOrders.id, input.id))
        .limit(1);
      if (!o || o.restaurantId !== ctx.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (o.status !== "paid") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `현재 상태=${o.status}. paid 상태에서만 ready 전이 가능.`,
        });
      }
      await db
        .update(posOrders)
        .set({ status: "ready", readyAt: new Date() })
        .where(eq(posOrders.id, input.id));
      return { ok: true, status: "ready" as const };
    }),

  markServed: posStoreWriteProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [o] = await db
        .select()
        .from(posOrders)
        .where(eq(posOrders.id, input.id))
        .limit(1);
      if (!o || o.restaurantId !== ctx.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (o.status !== "paid" && o.status !== "ready") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `현재 상태=${o.status}. paid 또는 ready에서만 served 전이 가능.`,
        });
      }
      await db
        .update(posOrders)
        .set({ status: "served", servedAt: new Date() })
        .where(eq(posOrders.id, input.id));
      return { ok: true, status: "served" as const };
    }),

  // ─── 취소 (결제 전만) ────────────────────────────────────────────
  void: posStoreManagerProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().min(1).max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [o] = await db
        .select()
        .from(posOrders)
        .where(eq(posOrders.id, input.id))
        .limit(1);
      if (!o || o.restaurantId !== ctx.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (o.status !== "open") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `현재 상태=${o.status}. open 상태에서만 void 가능. 결제 후에는 refund 사용.`,
        });
      }
      await db
        .update(posOrders)
        .set({
          status: "voided",
          voidedAt: new Date(),
          voidReason: input.reason,
        })
        .where(eq(posOrders.id, input.id));
      return { ok: true, status: "voided" as const };
    }),

  // ─── 환불 (결제 후) ──────────────────────────────────────────────
  refund: posStoreManagerProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().min(1).max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [o] = await db
        .select()
        .from(posOrders)
        .where(eq(posOrders.id, input.id))
        .limit(1);
      if (!o || o.restaurantId !== ctx.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (!["paid", "ready", "served"].includes(o.status)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `현재 상태=${o.status}. paid/ready/served에서만 refund 가능.`,
        });
      }
      return db.transaction(async (tx) => {
        // 기존 활성 결제 합계 조회
        const payments = await tx
          .select()
          .from(posPayments)
          .where(
            and(eq(posPayments.orderId, input.id), isNull(posPayments.voidedAt))
          );
        const positiveSum = payments
          .filter((p) => Number(p.amount) > 0)
          .reduce((s, p) => s + Number(p.amount), 0);
        // 음수 결제 레코드 추가 (전체 환불)
        if (positiveSum > 0) {
          await tx.insert(posPayments).values({
            orderId: input.id,
            method: "etc",
            amount: (-positiveSum).toFixed(2),
            providerType: "manual",
            providerRef: `refund: ${input.reason}`,
            createdByUserId: ctx.user.userId,
          });
        }
        await tx
          .update(posOrders)
          .set({ status: "refunded", voidReason: input.reason })
          .where(eq(posOrders.id, input.id));
        return {
          ok: true,
          status: "refunded" as const,
          refundedAmount: positiveSum.toFixed(2),
        };
      });
    }),
});

// ─── 4) Payment (결제 기록/취소) ──────────────────────────────────────────────
// 결정값 (docs/pos-p1-payment-patch.md §0):
//   - paid 자동 전이: 활성 결제 합계가 grandTotal과 정확히 일치할 때만. 초과는 거부.
//   - voidPayment 후: paid 상태 + 합계 < grandTotal이면 paid → open 자동 되돌림.
//                     ready/served 상태에서는 voidPayment 거부 (refund 사용).
//   - approvalNo: 모든 providerType에서 옵션 입력 (1차).
const paymentRouter = router({
  // ─── 결제 기록 ──────────────────────────────────────────────
  record: posStoreWriteProcedure
    .input(
      z.object({
        orderId: z.number().int().positive(),
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
        amount: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/, "결제 금액은 양수(소수점 둘째자리까지)"),
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
    .mutation(async ({ ctx, input }) => {
      const amountNum = Number(input.amount);
      if (amountNum <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "결제 금액은 0보다 커야 합니다. 환불은 pos.order.refund 사용.",
        });
      }

      return db.transaction(async (tx) => {
        // 주문 조회 + 매장 일치 검증
        const [order] = await tx
          .select()
          .from(posOrders)
          .where(eq(posOrders.id, input.orderId))
          .limit(1);
        if (!order || order.restaurantId !== ctx.restaurantId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "주문을 찾을 수 없습니다.",
          });
        }

        // 상태 검증: open/paid 만 결제 추가 가능
        // (paid 상태에서 추가 결제는 over-pay이므로 합계 검증에서 거부됨)
        if (order.status !== "open" && order.status !== "paid") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `현재 주문 상태=${order.status}. open 또는 paid 상태에서만 결제 가능.`,
          });
        }

        // 기존 활성 결제 합계
        const existing = await tx
          .select({ amount: posPayments.amount })
          .from(posPayments)
          .where(
            and(
              eq(posPayments.orderId, input.orderId),
              isNull(posPayments.voidedAt)
            )
          );
        const existingTotal = existing.reduce(
          (s, p) => s + Number(p.amount),
          0
        );
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
          createdByUserId: ctx.user.userId,
        });
        const paymentId = Number(
          (pResult as { insertId: number }).insertId
        );

        // 합계 정확히 일치하면 paid 자동 전이
        let newStatus = order.status;
        if (newTotal === grandTotal && order.status === "open") {
          newStatus = "paid";
          await tx
            .update(posOrders)
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
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return db.transaction(async (tx) => {
        // 결제 조회
        const [payment] = await tx
          .select()
          .from(posPayments)
          .where(eq(posPayments.id, input.id))
          .limit(1);
        if (!payment) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "결제 레코드를 찾을 수 없습니다.",
          });
        }
        if (payment.voidedAt) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "이미 취소된 결제입니다.",
          });
        }

        // 주문 조회 + 매장 일치 검증
        const [order] = await tx
          .select()
          .from(posOrders)
          .where(eq(posOrders.id, payment.orderId))
          .limit(1);
        if (!order || order.restaurantId !== ctx.restaurantId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        // ready/served 상태에서는 voidPayment 거부 → refund 사용
        if (order.status === "ready" || order.status === "served") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `현재 상태=${order.status}. 조리/제공 후에는 voidPayment 불가. pos.order.refund 사용.`,
          });
        }

        // 결제 취소
        await tx
          .update(posPayments)
          .set({ voidedAt: new Date() })
          .where(eq(posPayments.id, input.id));

        // 활성 결제 합계 재계산
        const sums = await tx
          .select({ amount: posPayments.amount })
          .from(posPayments)
          .where(
            and(
              eq(posPayments.orderId, payment.orderId),
              isNull(posPayments.voidedAt)
            )
          );
        const total = sums.reduce((s, p) => s + Number(p.amount), 0);
        const grandTotal = Number(order.grandTotal);

        // paid 상태에서 합계 < grandTotal이면 open으로 되돌림
        let newStatus: typeof order.status = order.status;
        if (order.status === "paid" && total < grandTotal) {
          newStatus = "open";
          await tx
            .update(posOrders)
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

// ─── 5) Device (POS 디바이스 등록/페어링) ────────────────────────────────────
// ─── 5) Device (POS 디바이스 등록·페어링·토큰 인증) ─────────────────────────
// 결정값 (docs/pos-p1-device-patch.md §0):
//   - 페어링 코드: 6자리 숫자, 1회용, 5분 TTL, 메모리 캐시
//   - 디바이스 토큰: raw는 클라가 보관, 서버는 SHA-256 해시만 DB 저장
//   - pair / heartbeat: publicProcedure (토큰 자체가 인증)
const deviceRouter = router({
  // ─── 목록 (점장 이상 + 활성화 게이트) ───────────────────────────
  list: posStoreOwnerProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select()
      .from(posDevices)
      .where(eq(posDevices.restaurantId, ctx.restaurantId))
      .orderBy(desc(posDevices.createdAt));
    // hash 자체는 노출 안 함, hasToken boolean으로 변환
    return rows.map(({ deviceTokenHash, ...rest }) => ({
      ...rest,
      hasToken: deviceTokenHash !== null,
    }));
  }),

  // ─── 등록 + 페어링 코드 발급 (점장 이상 + 활성화 게이트) ────────
  create: posStoreOwnerProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        deviceType: z.enum(["staff_counter", "staff_table", "kiosk", "kds"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      cleanupExpiredPairingCodes();

      const [result] = await db.insert(posDevices).values({
        restaurantId: ctx.restaurantId,
        name: input.name,
        deviceType: input.deviceType,
        isActive: true,
      });
      const deviceId = Number((result as { insertId: number }).insertId);

      // 충돌 회피 (확률 매우 낮음)
      let code = generatePairingCode();
      let tries = 0;
      while (pairingCodes.has(code) && tries < 20) {
        code = generatePairingCode();
        tries++;
      }
      if (pairingCodes.has(code)) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "페어링 코드 충돌. 다시 시도하세요.",
        });
      }

      const expiresAt = Date.now() + 5 * 60 * 1000;
      pairingCodes.set(code, {
        deviceId,
        restaurantId: ctx.restaurantId,
        expiresAt,
      });

      return {
        ok: true,
        id: deviceId,
        pairingCode: code,
        expiresInSeconds: 300,
      };
    }),

  // ─── 페어링 (디바이스가 직접 호출, 인증 없음) ──────────────────
  pair: publicProcedure
    .input(
      z.object({
        pairingCode: z.string().regex(/^\d{6}$/, "6자리 숫자"),
      })
    )
    .mutation(async ({ input }) => {
      cleanupExpiredPairingCodes();

      const info = pairingCodes.get(input.pairingCode);
      if (!info) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "페어링 코드가 잘못되었거나 만료되었습니다.",
        });
      }
      pairingCodes.delete(input.pairingCode); // 1회용

      // raw token = uuid-uuid (72자, 충돌 사실상 0)
      const rawToken = `${randomUUID()}-${randomUUID()}`;
      const hash = hashToken(rawToken);

      await db
        .update(posDevices)
        .set({ deviceTokenHash: hash, lastSeenAt: new Date() })
        .where(eq(posDevices.id, info.deviceId));

      const [device] = await db
        .select()
        .from(posDevices)
        .where(eq(posDevices.id, info.deviceId))
        .limit(1);

      return {
        ok: true,
        deviceId: info.deviceId,
        deviceToken: rawToken,
        deviceType: device?.deviceType ?? null,
        restaurantId: info.restaurantId,
      };
    }),

  // ─── 폐기 (점장 이상 + 활성화 게이트) ──────────────────────────
  revoke: posStoreOwnerProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [d] = await db
        .select()
        .from(posDevices)
        .where(eq(posDevices.id, input.id))
        .limit(1);
      if (!d || d.restaurantId !== ctx.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await db
        .update(posDevices)
        .set({ deviceTokenHash: null, isActive: false })
        .where(eq(posDevices.id, input.id));
      return { ok: true };
    }),

  // ─── 디바이스 heartbeat (publicProcedure, 토큰이 인증) ──────────
  heartbeat: publicProcedure
    .input(z.object({ deviceToken: z.string().min(10) }))
    .mutation(async ({ input }) => {
      const hash = hashToken(input.deviceToken);
      const [d] = await db
        .select()
        .from(posDevices)
        .where(eq(posDevices.deviceTokenHash, hash))
        .limit(1);
      if (!d || !d.isActive) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "디바이스 토큰이 잘못되었거나 폐기되었습니다.",
        });
      }
      await db
        .update(posDevices)
        .set({ lastSeenAt: new Date() })
        .where(eq(posDevices.id, d.id));
      return {
        ok: true,
        deviceId: d.id,
        deviceType: d.deviceType,
        restaurantId: d.restaurantId,
        name: d.name,
      };
    }),
});

// ─── 6) Reconciliation (일일 대조) ────────────────────────────────────────────
// 결정값 (docs/pos-p1-reconciliation-patch.md §0):
//   - posGross: getOrCreate 호출 시 활성 결제(voidedAt IS NULL) KST 해당일 amount 합산
//   - confirm: 임계치(restaurants.posReconcileTolerance) 초과는 경고만, 확정은 통과
//   - confirmed 후 setExternal 거부, master만 unconfirm 가능
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const reconciliationRouter = router({
  // ─── 조회/자동생성 + 자동갱신 ───────────────────────────────────
  getOrCreate: posStoreReadProcedure
    .input(z.object({ date: z.string().regex(dateRegex, "YYYY-MM-DD 형식") }))
    .query(async ({ ctx, input }) => {
      // posGross 자동 집계 — 활성 결제 합산 (KST 해당일)
      const range = kstDateRange(input.date);
      const sums = await db
        .select({ amount: posPayments.amount })
        .from(posPayments)
        .innerJoin(posOrders, eq(posOrders.id, posPayments.orderId))
        .where(
          and(
            eq(posOrders.restaurantId, ctx.restaurantId),
            isNull(posPayments.voidedAt),
            gte(posPayments.createdAt, range.start),
            lte(posPayments.createdAt, range.end)
          )
        );
      const posGrossNum = sums.reduce((s, p) => s + Number(p.amount), 0);
      const posGross = posGrossNum.toFixed(2);

      const dateValue = new Date(input.date);
      const [existing] = await db
        .select()
        .from(posDailyReconciliation)
        .where(
          and(
            eq(posDailyReconciliation.restaurantId, ctx.restaurantId),
            eq(posDailyReconciliation.date, dateValue)
          )
        )
        .limit(1);

      if (existing) {
        // 미확정이면 posGross/diff 자동 갱신, 확정이면 그대로 반환
        if (!existing.confirmedAt) {
          const diff = Number(existing.externalGross) - posGrossNum;
          await db
            .update(posDailyReconciliation)
            .set({ posGross, diff: diff.toFixed(2) })
            .where(eq(posDailyReconciliation.id, existing.id));
          return { ...existing, posGross, diff: diff.toFixed(2) };
        }
        return existing;
      }

      // 신규 생성
      const [result] = await db.insert(posDailyReconciliation).values({
        restaurantId: ctx.restaurantId,
        date: dateValue,
        posGross,
        externalGross: "0",
        diff: (-posGrossNum).toFixed(2),
      });
      const id = Number((result as { insertId: number }).insertId);
      const [created] = await db
        .select()
        .from(posDailyReconciliation)
        .where(eq(posDailyReconciliation.id, id))
        .limit(1);
      return created;
    }),

  // ─── 외부(백화점) 금액 입력 ─────────────────────────────────────
  setExternal: posStoreManagerProcedure
    .input(
      z.object({
        date: z.string().regex(dateRegex),
        externalGross: z.string().regex(/^\d+(\.\d{1,2})?$/),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const dateValue = new Date(input.date);
      const [existing] = await db
        .select()
        .from(posDailyReconciliation)
        .where(
          and(
            eq(posDailyReconciliation.restaurantId, ctx.restaurantId),
            eq(posDailyReconciliation.date, dateValue)
          )
        )
        .limit(1);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "대조 행이 없습니다. 먼저 getOrCreate를 호출하세요.",
        });
      }
      if (existing.confirmedAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "이미 확정된 대조입니다. 마스터에게 unconfirm을 요청하세요.",
        });
      }
      const diff = Number(input.externalGross) - Number(existing.posGross);
      await db
        .update(posDailyReconciliation)
        .set({
          externalGross: input.externalGross,
          diff: diff.toFixed(2),
          ...(input.note !== undefined ? { note: input.note } : {}),
        })
        .where(eq(posDailyReconciliation.id, existing.id));
      return { ok: true, diff: diff.toFixed(2) };
    }),

  // ─── 확정 (임계치 초과는 경고만) ────────────────────────────────
  confirm: posStoreManagerProcedure
    .input(z.object({ date: z.string().regex(dateRegex) }))
    .mutation(async ({ ctx, input }) => {
      const dateValue = new Date(input.date);
      const [existing] = await db
        .select()
        .from(posDailyReconciliation)
        .where(
          and(
            eq(posDailyReconciliation.restaurantId, ctx.restaurantId),
            eq(posDailyReconciliation.date, dateValue)
          )
        )
        .limit(1);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "대조 행이 없습니다.",
        });
      }
      if (existing.confirmedAt) {
        return { ok: true, alreadyConfirmed: true };
      }
      const [r] = await db
        .select({ tolerance: restaurants.posReconcileTolerance })
        .from(restaurants)
        .where(eq(restaurants.id, ctx.restaurantId))
        .limit(1);
      const tolerance = r?.tolerance ?? 0;
      const diffAbs = Math.abs(Number(existing.diff));
      const overTolerance = diffAbs > tolerance;

      await db
        .update(posDailyReconciliation)
        .set({
          confirmedByUserId: ctx.user.userId,
          confirmedAt: new Date(),
        })
        .where(eq(posDailyReconciliation.id, existing.id));

      return {
        ok: true,
        diff: existing.diff,
        tolerance,
        overTolerance,
        warning: overTolerance
          ? `차이(${existing.diff})가 임계치(${tolerance})를 초과했지만 확정되었습니다.`
          : null,
      };
    }),

  // ─── 확정 풀기 (master 전용, 매장 격리 안 함) ────────────────────
  unconfirm: masterProcedure
    .input(
      z.object({
        restaurantId: z.number().int().positive(),
        date: z.string().regex(dateRegex),
      })
    )
    .mutation(async ({ input }) => {
      const dateValue = new Date(input.date);
      const [existing] = await db
        .select()
        .from(posDailyReconciliation)
        .where(
          and(
            eq(posDailyReconciliation.restaurantId, input.restaurantId),
            eq(posDailyReconciliation.date, dateValue)
          )
        )
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (!existing.confirmedAt) {
        return { ok: true, alreadyUnconfirmed: true };
      }
      await db
        .update(posDailyReconciliation)
        .set({ confirmedByUserId: null, confirmedAt: null })
        .where(eq(posDailyReconciliation.id, existing.id));
      return { ok: true };
    }),

  // ─── 월별 이력 조회 ────────────────────────────────────────────
  list: posStoreReadProcedure
    .input(
      z.object({
        from: z.string().regex(dateRegex).optional(),
        to: z.string().regex(dateRegex).optional(),
        limit: z.number().int().min(1).max(200).default(31),
      })
    )
    .query(async ({ ctx, input }) => {
      const conds = [
        eq(posDailyReconciliation.restaurantId, ctx.restaurantId),
      ];
      if (input.from)
        conds.push(gte(posDailyReconciliation.date, new Date(input.from)));
      if (input.to)
        conds.push(lte(posDailyReconciliation.date, new Date(input.to)));
      return db
        .select()
        .from(posDailyReconciliation)
        .where(and(...conds))
        .orderBy(desc(posDailyReconciliation.date))
        .limit(input.limit);
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
