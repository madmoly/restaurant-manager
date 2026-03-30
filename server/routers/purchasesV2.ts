import { z } from "zod";
import { eq, and, gte, lte, desc, asc, sql } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import {
  purchaseOrdersV2,
  purchaseOrderItemsV2,
  counterpartyItems,
  counterparties,
  items,
  users,
} from "../../drizzle/schema";
import { exportDatasetToGDrive, isGDriveConfigured } from "../gdrive";

// 매입 확정 시 비동기로 Drive 업로드 (응답 지연 없음)
function triggerDatasetExport() {
  if (!isGDriveConfigured()) return;
  setTimeout(async () => {
    try {
      const result = await exportDatasetToGDrive("purchase_confirmed");
      if (result.success) {
        console.log(`[GDrive] 매입 확정 트리거: ${result.files.length}개 파일 업로드`);
      }
    } catch (e: any) {
      console.error("[GDrive] 매입 확정 트리거 실패:", e.message);
    }
  }, 5000);
}

export const purchasesV2Router = router({
  /** 월별 매입 전표 목록 */
  listOrdersByMonth: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input }) => {
      const mm = String(input.month).padStart(2, "0");
      const startDate = `${input.year}-${mm}-01`;
      const endDate = `${input.year}-${mm}-31`;

      return db
        .select({
          id: purchaseOrdersV2.id,
          restaurantId: purchaseOrdersV2.restaurantId,
          counterpartyId: purchaseOrdersV2.counterpartyId,
          counterpartyName: counterparties.name,
          purchaseDate: purchaseOrdersV2.purchaseDate,
          status: purchaseOrdersV2.status,
          note: purchaseOrdersV2.note,
          attachmentUrl: purchaseOrdersV2.attachmentUrl,
          totalAmount: purchaseOrdersV2.totalAmount,
          createdBy: purchaseOrdersV2.createdBy,
          createdByName: users.name,
          createdAt: purchaseOrdersV2.createdAt,
          editHistory: purchaseOrdersV2.editHistory,
        })
        .from(purchaseOrdersV2)
        .leftJoin(counterparties, eq(purchaseOrdersV2.counterpartyId, counterparties.id))
        .leftJoin(users, eq(purchaseOrdersV2.createdBy, users.id))
        .where(
          and(
            eq(purchaseOrdersV2.restaurantId, input.restaurantId),
            gte(purchaseOrdersV2.purchaseDate, new Date(startDate)),
            sql`${purchaseOrdersV2.purchaseDate} <= ${endDate}`,
          ),
        )
        .orderBy(desc(purchaseOrdersV2.purchaseDate));
    }),

  /** 일별 매입 전표 목록 (발주+입고 모두) */
  listByDate: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      const dateStr = input.date; // yyyy-MM-dd
      return db
        .select({
          id: purchaseOrdersV2.id,
          restaurantId: purchaseOrdersV2.restaurantId,
          counterpartyId: purchaseOrdersV2.counterpartyId,
          counterpartyName: counterparties.name,
          purchaseDate: purchaseOrdersV2.purchaseDate,
          receivedAt: purchaseOrdersV2.receivedAt,
          status: purchaseOrdersV2.status,
          note: purchaseOrdersV2.note,
          attachmentUrl: purchaseOrdersV2.attachmentUrl,
          totalAmount: purchaseOrdersV2.totalAmount,
          createdByName: users.name,
          createdAt: purchaseOrdersV2.createdAt,
        })
        .from(purchaseOrdersV2)
        .leftJoin(counterparties, eq(purchaseOrdersV2.counterpartyId, counterparties.id))
        .leftJoin(users, eq(purchaseOrdersV2.createdBy, users.id))
        .where(
          and(
            eq(purchaseOrdersV2.restaurantId, input.restaurantId),
            sql`DATE(${purchaseOrdersV2.purchaseDate}) = ${dateStr}`,
          ),
        )
        .orderBy(desc(purchaseOrdersV2.createdAt));
    }),

  /** 전표 상세 항목 */
  getOrderItems: protectedProcedure
    .input(z.object({ orderId: z.number() }))
    .query(async ({ input }) => {
      return db
        .select({
          id: purchaseOrderItemsV2.id,
          purchaseOrderId: purchaseOrderItemsV2.purchaseOrderId,
          itemId: purchaseOrderItemsV2.itemId,
          counterpartyItemId: purchaseOrderItemsV2.counterpartyItemId,
          rawItemName: purchaseOrderItemsV2.rawItemName,
          itemName: items.name,
          itemType: purchaseOrderItemsV2.itemType,
          quantity: purchaseOrderItemsV2.quantity,
          unitName: purchaseOrderItemsV2.unitName,
          unitPrice: purchaseOrderItemsV2.unitPrice,
          lineTotal: purchaseOrderItemsV2.lineTotal,
          costingCategory: purchaseOrderItemsV2.costingCategory,
          note: purchaseOrderItemsV2.note,
        })
        .from(purchaseOrderItemsV2)
        .leftJoin(items, eq(purchaseOrderItemsV2.itemId, items.id))
        .where(eq(purchaseOrderItemsV2.purchaseOrderId, input.orderId));
    }),

  /** 거래처별 최근 전표 */
  getRecentOrdersByCounterparty: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        counterpartyId: z.number(),
        limit: z.number().default(5),
      }),
    )
    .query(async ({ input }) => {
      return db
        .select()
        .from(purchaseOrdersV2)
        .where(
          and(
            eq(purchaseOrdersV2.restaurantId, input.restaurantId),
            eq(purchaseOrdersV2.counterpartyId, input.counterpartyId),
          ),
        )
        .orderBy(desc(purchaseOrdersV2.purchaseDate))
        .limit(input.limit);
    }),

  /** 매입 전표 생성 (헤더 + 항목 + lastPrice 갱신)
   *  발주(ordered): items 없어도 가능 (거래처/사진만으로 등록)
   *  입고(received): 기존과 동일
   */
  createOrder: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        counterpartyId: z.number(),
        purchaseDate: z.string(),
        status: z.enum(["received", "ordered"]).default("received"),
        note: z.string().optional(),
        attachmentUrl: z.string().optional(),
        items: z.array(
          z.object({
            itemId: z.number().optional(),
            counterpartyItemId: z.number().optional(),
            rawItemName: z.string().optional(),
            itemType: z.enum(["product", "service", "misc"]).default("product"),
            quantity: z.string().optional(),
            unitName: z.string().optional(),
            unitPrice: z.string().optional(),
            lineTotal: z.string().default("0"),
            costingCategory: z.string().optional(),
            note: z.string().optional(),
          }),
        ).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const totalAmount = input.items.reduce(
        (sum, item) => sum + parseFloat(item.lineTotal || "0"),
        0,
      );

      // 헤더 삽입
      const [orderResult] = await db
        .insert(purchaseOrdersV2)
        .values({
          restaurantId: input.restaurantId,
          counterpartyId: input.counterpartyId,
          purchaseDate: new Date(input.purchaseDate),
          status: input.status,
          note: input.note,
          attachmentUrl: input.attachmentUrl,
          totalAmount: String(totalAmount),
          createdBy: ctx.user.userId,
          receivedAt: input.status === "received" ? new Date() : null,
        })
        .$returningId();
      const orderId = orderResult.id;

      // 항목 삽입
      if (input.items.length > 0) {
        await db.insert(purchaseOrderItemsV2).values(
          input.items.map((item) => ({
            purchaseOrderId: orderId,
            itemId: item.itemId,
            counterpartyItemId: item.counterpartyItemId,
            rawItemName: item.rawItemName,
            itemType: item.itemType,
            quantity: item.quantity,
            unitName: item.unitName,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            costingCategory: item.costingCategory,
            note: item.note,
          })),
        );

        // counterpartyItems의 lastPrice 갱신 (입고 시에만)
        if (input.status === "received") {
          for (const item of input.items) {
            if (item.counterpartyItemId && item.unitPrice) {
              await db
                .update(counterpartyItems)
                .set({ lastPrice: item.unitPrice })
                .where(eq(counterpartyItems.id, item.counterpartyItemId));
            }
          }
          triggerDatasetExport();
        }
      }

      return { id: orderId };
    }),

  /** 발주 → 입고 전환 (품목/금액 갱신 포함) */
  receiveOrder: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        totalAmount: z.string().optional(),
        items: z.array(
          z.object({
            itemId: z.number().optional(),
            counterpartyItemId: z.number().optional(),
            rawItemName: z.string().optional(),
            itemType: z.enum(["product", "service", "misc"]).default("product"),
            quantity: z.string().optional(),
            unitName: z.string().optional(),
            unitPrice: z.string().optional(),
            lineTotal: z.string().default("0"),
            costingCategory: z.string().optional(),
            note: z.string().optional(),
          }),
        ).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 기존 발주 조회
      const [existing] = await db
        .select()
        .from(purchaseOrdersV2)
        .where(eq(purchaseOrdersV2.id, input.id))
        .limit(1);
      if (!existing) {
        const { TRPCError } = await import("@trpc/server");
        throw new TRPCError({ code: "NOT_FOUND", message: "발주를 찾을 수 없습니다" });
      }

      // 품목 교체: 새 items가 있으면 기존 삭제 후 삽입
      if (input.items && input.items.length > 0) {
        await db
          .delete(purchaseOrderItemsV2)
          .where(eq(purchaseOrderItemsV2.purchaseOrderId, input.id));

        await db.insert(purchaseOrderItemsV2).values(
          input.items.map((item) => ({
            purchaseOrderId: input.id,
            itemId: item.itemId,
            counterpartyItemId: item.counterpartyItemId,
            rawItemName: item.rawItemName,
            itemType: item.itemType,
            quantity: item.quantity,
            unitName: item.unitName,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            costingCategory: item.costingCategory,
            note: item.note,
          })),
        );

        // lastPrice 갱신
        for (const item of input.items) {
          if (item.counterpartyItemId && item.unitPrice) {
            await db
              .update(counterpartyItems)
              .set({ lastPrice: item.unitPrice })
              .where(eq(counterpartyItems.id, item.counterpartyItemId));
          }
        }
      }

      const newTotal = input.items
        ? input.items.reduce((sum, item) => sum + parseFloat(item.lineTotal || "0"), 0)
        : input.totalAmount ? parseFloat(input.totalAmount) : Number(existing.totalAmount);

      // 이력 기록
      const prevHistory = (existing.editHistory as any[]) ?? [];
      const newEntry = {
        userId: ctx.user.userId,
        userName: ctx.user.username ?? String(ctx.user.userId),
        at: new Date().toISOString(),
        summary: `입고 전환 (${Number(existing.totalAmount).toLocaleString()}원 → ${newTotal.toLocaleString()}원)`,
      };

      await db
        .update(purchaseOrdersV2)
        .set({
          status: "received",
          receivedAt: new Date(),
          totalAmount: String(newTotal),
          lastModifiedBy: ctx.user.userId,
          lastModifiedAt: new Date(),
          editHistory: [...prevHistory, newEntry],
        })
        .where(eq(purchaseOrdersV2.id, input.id));

      triggerDatasetExport();
      return { ok: true };
    }),

  /** 전표 헤더 수정 + 수정이력 기록 */
  updateOrder: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        counterpartyId: z.number().nullable().optional(),
        purchaseDate: z.string().optional(),
        note: z.string().nullable().optional(),
        status: z.enum(["received", "ordered"]).optional(),
        attachmentUrl: z.string().nullable().optional(),
        totalAmount: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;

      // 기존 전표 조회
      const [existing] = await db
        .select()
        .from(purchaseOrdersV2)
        .where(eq(purchaseOrdersV2.id, id))
        .limit(1);
      if (!existing) {
        const { TRPCError } = await import("@trpc/server");
        throw new TRPCError({ code: "NOT_FOUND", message: "전표를 찾을 수 없습니다" });
      }

      // 변경사항 추적
      const prevHistory = (existing.editHistory as any[]) ?? [];
      const changes: string[] = [];
      if (rest.status && rest.status !== existing.status)
        changes.push(`상태: ${existing.status === "received" ? "입고" : "발주"} → ${rest.status === "received" ? "입고" : "발주"}`);
      const existingDateStr =
        existing.purchaseDate instanceof Date
          ? existing.purchaseDate.toISOString().split("T")[0]
          : String(existing.purchaseDate ?? "");
      if (rest.purchaseDate && rest.purchaseDate !== existingDateStr)
        changes.push(`날짜: ${existingDateStr} → ${rest.purchaseDate}`);
      if (rest.note !== undefined && rest.note !== existing.note) changes.push("메모 수정");
      if (rest.totalAmount !== undefined && rest.totalAmount !== existing.totalAmount)
        changes.push(
          `금액: ${Number(existing.totalAmount).toLocaleString()}원 → ${Number(rest.totalAmount).toLocaleString()}원`,
        );

      const newEntry = {
        userId: ctx.user.userId,
        userName: ctx.user.username ?? String(ctx.user.userId),
        at: new Date().toISOString(),
        summary: changes.length > 0 ? changes.join(", ") : "수정",
      };

      const updatePayload: Record<string, any> = {
        ...rest,
        lastModifiedBy: ctx.user.userId,
        lastModifiedAt: new Date(),
        editHistory: [...prevHistory, newEntry],
      };

      // 발주→입고 전환 시 receivedAt 자동 설정
      if (rest.status === "received" && existing.status === "ordered") {
        updatePayload.receivedAt = new Date();
        triggerDatasetExport();
      }

      if (rest.purchaseDate) {
        updatePayload.purchaseDate = new Date(rest.purchaseDate + "T00:00:00");
      }

      await db.update(purchaseOrdersV2).set(updatePayload).where(eq(purchaseOrdersV2.id, id));
      return { ok: true };
    }),

  /** 전표 삭제 (항목 + 헤더) — manager 이상 */
  deleteOrder: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db
        .delete(purchaseOrderItemsV2)
        .where(eq(purchaseOrderItemsV2.purchaseOrderId, input.id));
      await db.delete(purchaseOrdersV2).where(eq(purchaseOrdersV2.id, input.id));
      return { ok: true };
    }),

  // ═══════════════════════════════════════════════════════════════════════
  // 매입 분석 API
  // ═══════════════════════════════════════════════════════════════════════

  /** 품목별 거래처 가격비교: 동일 품목을 납품하는 거래처들의 최근 단가 비교 */
  itemPriceComparison: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input }) => {
      const rows = await db.execute(sql`
        SELECT
          oi.rawItemName,
          c.id AS counterpartyId,
          c.name AS counterpartyName,
          oi.unitPrice,
          oi.unitName,
          o.purchaseDate,
          oi.quantity
        FROM purchase_order_items_v2 oi
        JOIN purchase_orders_v2 o ON oi.purchaseOrderId = o.id
        LEFT JOIN counterparties c ON o.counterpartyId = c.id
        WHERE o.restaurantId = ${input.restaurantId}
          AND oi.rawItemName IS NOT NULL
          AND oi.rawItemName != ''
          AND oi.unitPrice IS NOT NULL
          AND oi.unitPrice != '0'
        ORDER BY oi.rawItemName, o.purchaseDate DESC
      `);
      // Group by item name → list of supplier prices
      const map = new Map<string, any[]>();
      for (const row of (rows[0] as unknown as any[])) {
        const key = row.rawItemName;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({
          counterpartyId: row.counterpartyId,
          counterpartyName: row.counterpartyName || '미지정',
          unitPrice: row.unitPrice,
          unitName: row.unitName,
          purchaseDate: row.purchaseDate,
          quantity: row.quantity,
        });
      }
      // Only items with 2+ suppliers
      const result: any[] = [];
      for (const [itemName, entries] of map) {
        const uniqueSuppliers = new Set(entries.map((e: any) => e.counterpartyId));
        if (uniqueSuppliers.size >= 2) {
          // Latest price per supplier
          const latestBySupplier = new Map<number, any>();
          for (const e of entries) {
            if (!latestBySupplier.has(e.counterpartyId)) {
              latestBySupplier.set(e.counterpartyId, e);
            }
          }
          result.push({
            itemName,
            suppliers: Array.from(latestBySupplier.values()),
          });
        }
      }
      // Also include single-supplier items for reference
      for (const [itemName, entries] of map) {
        const uniqueSuppliers = new Set(entries.map((e: any) => e.counterpartyId));
        if (uniqueSuppliers.size === 1) {
          result.push({
            itemName,
            suppliers: [entries[0]],
          });
        }
      }
      return result;
    }),

  /** 시기별 품목 단가 추이: 특정 기간 내 품목의 단가 변화 */
  itemPriceTrend: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      months: z.number().default(6),
    }))
    .query(async ({ input }) => {
      const rows = await db.execute(sql`
        SELECT
          oi.rawItemName,
          c.name AS counterpartyName,
          oi.unitPrice,
          oi.unitName,
          DATE_FORMAT(o.purchaseDate, '%Y-%m') AS yearMonth,
          o.purchaseDate
        FROM purchase_order_items_v2 oi
        JOIN purchase_orders_v2 o ON oi.purchaseOrderId = o.id
        LEFT JOIN counterparties c ON o.counterpartyId = c.id
        WHERE o.restaurantId = ${input.restaurantId}
          AND oi.rawItemName IS NOT NULL
          AND oi.rawItemName != ''
          AND oi.unitPrice IS NOT NULL
          AND oi.unitPrice != '0'
          AND o.purchaseDate >= DATE_SUB(CURDATE(), INTERVAL ${input.months} MONTH)
        ORDER BY oi.rawItemName, o.purchaseDate ASC
      `);
      // Group by item → chronological price points
      const map = new Map<string, any[]>();
      for (const row of (rows[0] as unknown as any[])) {
        const key = row.rawItemName;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({
          counterpartyName: row.counterpartyName || '미지정',
          unitPrice: Number(row.unitPrice),
          unitName: row.unitName,
          yearMonth: row.yearMonth,
          purchaseDate: row.purchaseDate,
        });
      }
      return Array.from(map.entries()).map(([itemName, points]) => ({
        itemName,
        points,
        minPrice: Math.min(...points.map((p: any) => p.unitPrice)),
        maxPrice: Math.max(...points.map((p: any) => p.unitPrice)),
        latestPrice: points[points.length - 1]?.unitPrice ?? 0,
      }));
    }),

  /** 거래처별 매입/발주 금액 분석 */
  counterpartyAmountAnalysis: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      months: z.number().default(3),
    }))
    .query(async ({ input }) => {
      const rows = await db.execute(sql`
        SELECT
          o.counterpartyId,
          c.name AS counterpartyName,
          o.status,
          COUNT(*) AS orderCount,
          SUM(CAST(o.totalAmount AS DECIMAL(14,2))) AS totalAmount,
          DATE_FORMAT(o.purchaseDate, '%Y-%m') AS yearMonth
        FROM purchase_orders_v2 o
        LEFT JOIN counterparties c ON o.counterpartyId = c.id
        WHERE o.restaurantId = ${input.restaurantId}
          AND o.purchaseDate >= DATE_SUB(CURDATE(), INTERVAL ${input.months} MONTH)
        GROUP BY o.counterpartyId, c.name, o.status, DATE_FORMAT(o.purchaseDate, '%Y-%m')
        ORDER BY c.name, DATE_FORMAT(o.purchaseDate, '%Y-%m')
      `);
      // Group by counterparty
      const map = new Map<string, any>();
      for (const row of (rows[0] as unknown as any[])) {
        const key = row.counterpartyName || '미지정';
        if (!map.has(key)) {
          map.set(key, {
            counterpartyId: row.counterpartyId,
            counterpartyName: key,
            totalReceived: 0,
            totalOrdered: 0,
            receivedCount: 0,
            orderedCount: 0,
            monthly: [],
          });
        }
        const entry = map.get(key)!;
        const amount = Number(row.totalAmount || 0);
        const count = Number(row.orderCount || 0);
        if (row.status === 'received') {
          entry.totalReceived += amount;
          entry.receivedCount += count;
        } else {
          entry.totalOrdered += amount;
          entry.orderedCount += count;
        }
        entry.monthly.push({
          yearMonth: row.yearMonth,
          status: row.status,
          amount,
          count,
        });
      }
      return Array.from(map.values()).sort((a, b) => (b.totalReceived + b.totalOrdered) - (a.totalReceived + a.totalOrdered));
    }),

  /** 미입고 발주 전표 목록 (품목 수 포함) */
  pendingOrders: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input }) => {
      const orders = await db
        .select({
          id: purchaseOrdersV2.id,
          counterpartyId: purchaseOrdersV2.counterpartyId,
          counterpartyName: counterparties.name,
          purchaseDate: purchaseOrdersV2.purchaseDate,
          totalAmount: purchaseOrdersV2.totalAmount,
          note: purchaseOrdersV2.note,
          attachmentUrl: purchaseOrdersV2.attachmentUrl,
          createdAt: purchaseOrdersV2.createdAt,
        })
        .from(purchaseOrdersV2)
        .leftJoin(counterparties, eq(purchaseOrdersV2.counterpartyId, counterparties.id))
        .where(
          and(
            eq(purchaseOrdersV2.restaurantId, input.restaurantId),
            eq(purchaseOrdersV2.status, "ordered"),
          ),
        )
        .orderBy(desc(purchaseOrdersV2.purchaseDate));

      // 각 발주의 품목 수 조회
      const withItemCount = await Promise.all(
        orders.map(async (order) => {
          const [countRow] = await db
            .select({ cnt: sql<number>`COUNT(*)` })
            .from(purchaseOrderItemsV2)
            .where(eq(purchaseOrderItemsV2.purchaseOrderId, order.id));
          return { ...order, itemCount: Number(countRow?.cnt ?? 0) };
        }),
      );

      return withItemCount;
    }),

  /** 중복 입고/발주 감지 (동일 날짜 + 동일 거래처 + 동일 금액) */
  findDuplicates: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      month: z.string(), // "YYYY-MM"
    }))
    .query(async ({ input }) => {
      const startDate = `${input.month}-01`;
      const endDate = `${input.month}-31`;

      // 동일 날짜+거래처+금액+상태 조합으로 그룹핑, 2건 이상인 것만
      const dupes = await db.select({
        purchaseDate: purchaseOrdersV2.purchaseDate,
        counterpartyId: purchaseOrdersV2.counterpartyId,
        totalAmount: purchaseOrdersV2.totalAmount,
        status: purchaseOrdersV2.status,
        cnt: sql<number>`COUNT(*)`,
        ids: sql<string>`GROUP_CONCAT(${purchaseOrdersV2.id} ORDER BY ${purchaseOrdersV2.id})`,
      }).from(purchaseOrdersV2)
        .where(and(
          eq(purchaseOrdersV2.restaurantId, input.restaurantId),
          gte(purchaseOrdersV2.purchaseDate, startDate),
          lte(purchaseOrdersV2.purchaseDate, endDate),
        ))
        .groupBy(
          purchaseOrdersV2.purchaseDate,
          purchaseOrdersV2.counterpartyId,
          purchaseOrdersV2.totalAmount,
          purchaseOrdersV2.status,
        )
        .having(sql`COUNT(*) >= 2`);

      // 거래처명 매핑
      const cpIds = [...new Set(dupes.map(d => d.counterpartyId).filter(Boolean))] as number[];
      let cpMap: Record<number, string> = {};
      if (cpIds.length > 0) {
        const cps = await db.select({ id: counterparties.id, name: counterparties.name })
          .from(counterparties)
          .where(sql`${counterparties.id} IN (${sql.join(cpIds.map(id => sql`${id}`), sql`, `)})`);
        cpMap = Object.fromEntries(cps.map(c => [c.id, c.name]));
      }

      return dupes.map(d => ({
        purchaseDate: d.purchaseDate,
        counterpartyId: d.counterpartyId,
        counterpartyName: d.counterpartyId ? cpMap[d.counterpartyId] ?? "알 수 없음" : "미지정",
        totalAmount: d.totalAmount,
        status: d.status,
        count: Number(d.cnt),
        ids: String(d.ids).split(",").map(Number),
      }));
    }),

  /** 중복 전표 삭제 (지정된 ID 삭제) */
  deleteDuplicate: managerProcedure
    .input(z.object({ orderId: z.number() }))
    .mutation(async ({ input }) => {
      // 항목 먼저 삭제
      await db.delete(purchaseOrderItemsV2)
        .where(eq(purchaseOrderItemsV2.purchaseOrderId, input.orderId));
      // 전표 삭제
      await db.delete(purchaseOrdersV2)
        .where(eq(purchaseOrdersV2.id, input.orderId));
      return { ok: true };
    }),
});
