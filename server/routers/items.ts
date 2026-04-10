import { z } from "zod";
import { eq, and, like, sql } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure, storeReadProcedure } from "../trpc";
import { db } from "../db";
import { items, counterpartyItems, counterparties, purchaseOrderItemsV2 } from "../../drizzle/schema";

export const itemsRouter = router({
  /** 매장 품목 목록 */
  list: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(items)
        .where(and(eq(items.restaurantId, input.restaurantId), eq(items.isActive, true)))
        .orderBy(items.name);
    }),

  /** 품목 생성 */
  create: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        name: z.string().min(1),
        itemType: z.enum(["product", "service", "misc"]).default("product"),
        costingCategory: z.string().optional(),
        baseUnit: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const [result] = await db.insert(items).values({
        restaurantId: input.restaurantId,
        name: input.name,
        itemType: input.itemType,
        costingCategory: input.costingCategory,
        baseUnit: input.baseUnit,
      }).$returningId();
      return { id: result.id };
    }),

  /** 품목명 유사 검색 */
  searchSimilar: protectedProcedure
    .input(z.object({ restaurantId: z.number(), query: z.string() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(items)
        .where(
          and(
            eq(items.restaurantId, input.restaurantId),
            eq(items.isActive, true),
            like(items.name, `%${input.query}%`),
          ),
        )
        .limit(10);
    }),

  /** 품목 수정 */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        itemType: z.enum(["product", "service", "misc"]).optional(),
        costingCategory: z.string().optional(),
        baseUnit: z.string().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(items).set(data).where(eq(items.id, id));
      return { ok: true };
    }),

  /** 유사 품목 그룹 찾기 (품목관리용) */
  findSimilarGroups: managerProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input }) => {
      // 활성 품목 전체 조회
      const allItems = await db.select({
        id: items.id,
        name: items.name,
        itemType: items.itemType,
        baseUnit: items.baseUnit,
        costingCategory: items.costingCategory,
      }).from(items)
        .where(and(eq(items.restaurantId, input.restaurantId), eq(items.isActive, true)))
        .orderBy(items.name);

      // 각 품목의 거래처 매핑 수 + 매입 사용 수 조회
      const itemIds = allItems.map(i => i.id);
      let cpCounts: Record<number, number> = {};
      let poCounts: Record<number, number> = {};

      if (itemIds.length > 0) {
        const cpRows = await db.select({
          itemId: counterpartyItems.itemId,
          cnt: sql<number>`COUNT(*)`,
        }).from(counterpartyItems)
          .where(sql`${counterpartyItems.itemId} IN (${sql.join(itemIds.map(id => sql`${id}`), sql`, `)})`)
          .groupBy(counterpartyItems.itemId);
        cpCounts = Object.fromEntries(cpRows.map(r => [r.itemId, Number(r.cnt)]));

        const poRows = await db.select({
          itemId: purchaseOrderItemsV2.itemId,
          cnt: sql<number>`COUNT(*)`,
        }).from(purchaseOrderItemsV2)
          .where(sql`${purchaseOrderItemsV2.itemId} IN (${sql.join(itemIds.map(id => sql`${id}`), sql`, `)})`)
          .groupBy(purchaseOrderItemsV2.itemId);
        poCounts = Object.fromEntries(poRows.map(r => [r.itemId!, Number(r.cnt)]));
      }

      // 유사 품목 그룹핑 (한글 초성/공백/특수문자 제거 후 비교)
      const normalize = (s: string) => s.replace(/[\s\-_()（）\/\\·.,·]/g, "").toLowerCase();
      const groups: { key: string; items: typeof allItems }[] = [];
      const used = new Set<number>();

      for (let i = 0; i < allItems.length; i++) {
        if (used.has(allItems[i].id)) continue;
        const norm = normalize(allItems[i].name);
        const group = [allItems[i]];
        used.add(allItems[i].id);

        for (let j = i + 1; j < allItems.length; j++) {
          if (used.has(allItems[j].id)) continue;
          const norm2 = normalize(allItems[j].name);
          // 같은 정규화 결과 OR 하나가 다른 하나를 포함 (길이 3 이상)
          if (norm === norm2 || (norm.length >= 3 && norm2.includes(norm)) || (norm2.length >= 3 && norm.includes(norm2))) {
            group.push(allItems[j]);
            used.add(allItems[j].id);
          }
        }

        if (group.length > 1) {
          groups.push({ key: norm, items: group });
        }
      }

      return {
        totalItems: allItems.length,
        groups: groups.map(g => ({
          items: g.items.map(item => ({
            ...item,
            counterpartyCount: cpCounts[item.id] || 0,
            purchaseCount: poCounts[item.id] || 0,
          })),
        })),
        allItems: allItems.map(item => ({
          ...item,
          counterpartyCount: cpCounts[item.id] || 0,
          purchaseCount: poCounts[item.id] || 0,
        })),
      };
    }),

  /** 품목마스터 + 거래처 매핑 + 기준단위가 통합 조회 */
  listWithMappings: storeReadProcedure
    .query(async ({ input }) => {
      const rows = await db.execute(sql`
        SELECT
          i.id AS itemId,
          i.name AS itemName,
          i.baseUnit,
          i.itemType,
          ci.id AS ciId,
          ci.counterpartyId,
          c.name AS counterpartyName,
          ci.supplierItemName,
          ci.purchaseUnit,
          ci.conversionToBase,
          ci.lastPrice,
          ci.isPreferred,
          CASE WHEN ci.conversionToBase IS NOT NULL AND CAST(ci.conversionToBase AS DECIMAL(10,4)) > 0
            THEN CAST(ci.lastPrice AS DECIMAL(14,4)) / CAST(ci.conversionToBase AS DECIMAL(10,4))
            ELSE ci.lastPrice
          END AS basePricePerUnit,
          (
            SELECT MAX(o.purchaseDate)
            FROM purchase_order_items_v2 oi2
            JOIN purchase_orders_v2 o ON oi2.purchaseOrderId = o.id
            WHERE oi2.counterpartyItemId = ci.id AND o.status = 'received'
          ) AS lastReceivedDate
        FROM items i
        LEFT JOIN counterparty_items ci ON ci.itemId = i.id AND ci.restaurantId = i.restaurantId AND ci.isActive = 1
        LEFT JOIN counterparties c ON ci.counterpartyId = c.id
        WHERE i.restaurantId = ${input.restaurantId}
          AND i.isActive = 1
        ORDER BY i.name ASC
      `);

      // Group by item → mappings
      const map = new Map<number, {
        itemId: number; itemName: string; baseUnit: string | null; itemType: string;
        mappings: any[]; counterpartyCount: number; minBasePrice: number | null;
      }>();

      for (const row of (rows[0] as unknown as any[])) {
        const key = row.itemId as number;
        if (!map.has(key)) {
          map.set(key, {
            itemId: key,
            itemName: row.itemName,
            baseUnit: row.baseUnit,
            itemType: row.itemType,
            mappings: [],
            counterpartyCount: 0,
            minBasePrice: null,
          });
        }
        const entry = map.get(key)!;
        if (row.ciId) {
          const basePrice = row.basePricePerUnit ? Number(row.basePricePerUnit) : null;
          entry.mappings.push({
            ciId: row.ciId,
            counterpartyId: row.counterpartyId,
            counterpartyName: row.counterpartyName || '미지정',
            supplierItemName: row.supplierItemName,
            purchaseUnit: row.purchaseUnit,
            conversionToBase: row.conversionToBase ? Number(row.conversionToBase) : null,
            lastPrice: row.lastPrice ? Number(row.lastPrice) : null,
            basePricePerUnit: basePrice,
            isPreferred: !!row.isPreferred,
            lastReceivedDate: row.lastReceivedDate,
          });
          entry.counterpartyCount++;
          if (basePrice !== null && (entry.minBasePrice === null || basePrice < entry.minBasePrice)) {
            entry.minBasePrice = basePrice;
          }
        }
      }

      // Sort: counterpartyCount DESC, itemName ASC
      return Array.from(map.values()).sort((a, b) =>
        b.counterpartyCount - a.counterpartyCount || a.itemName.localeCompare(b.itemName),
      );
    }),

  /** 품목 합치기 (sourceIds → targetId로 병합) */
  merge: managerProcedure
    .input(z.object({
      targetId: z.number(),
      sourceIds: z.array(z.number()).min(1),
    }))
    .mutation(async ({ input }) => {
      const { targetId, sourceIds } = input;

      // sourceIds에 targetId가 포함되면 제거
      const mergeIds = sourceIds.filter(id => id !== targetId);
      if (mergeIds.length === 0) return { merged: 0 };

      // 1) counterparty_items의 itemId를 targetId로 변경
      for (const srcId of mergeIds) {
        await db.update(counterpartyItems)
          .set({ itemId: targetId })
          .where(eq(counterpartyItems.itemId, srcId));
      }

      // 2) purchase_order_items_v2의 itemId를 targetId로 변경
      for (const srcId of mergeIds) {
        await db.update(purchaseOrderItemsV2)
          .set({ itemId: targetId })
          .where(eq(purchaseOrderItemsV2.itemId, srcId));
      }

      // 3) source 품목들 비활성화
      for (const srcId of mergeIds) {
        await db.update(items)
          .set({ isActive: false })
          .where(eq(items.id, srcId));
      }

      return { merged: mergeIds.length };
    }),
});
