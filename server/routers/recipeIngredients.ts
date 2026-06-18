import { z } from "zod";
import { eq, asc, sql, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { recipeIngredients, recipes, items } from "../../drizzle/schema";
import { verifyStoreAccess } from "../middleware/storeAuth";

export const recipeIngredientsRouter = router({
  /** 레시피 재료 목록 조회 */
  listByRecipe: protectedProcedure
    .input(z.object({ recipeId: z.number() }))
    .query(async ({ input, ctx }) => {
      const [recipe] = await db
        .select({ restaurantId: recipes.restaurantId })
        .from(recipes)
        .where(eq(recipes.id, input.recipeId))
        .limit(1);
      if (!recipe) throw new TRPCError({ code: "NOT_FOUND" });
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, recipe.restaurantId);
      return db
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, input.recipeId))
        .orderBy(asc(recipeIngredients.sortOrder), asc(recipeIngredients.id));
    }),

  /** 재료 일괄 저장 (기존 삭제 후 재삽입) */
  upsert: managerProcedure
    .input(z.object({
      recipeId: z.number(),
      ingredients: z.array(z.object({
        itemId: z.number().nullable().optional(),
        rawName: z.string().max(100).nullable().optional(),
        quantity: z.number().min(0),
        unitName: z.string().max(30).nullable().optional(),
        yieldRate: z.number().min(0.001).max(1).default(1),
        sortOrder: z.number().int().default(0),
        note: z.string().nullable().optional(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      const [recipe] = await db
        .select({ restaurantId: recipes.restaurantId })
        .from(recipes)
        .where(eq(recipes.id, input.recipeId))
        .limit(1);
      if (!recipe) throw new TRPCError({ code: "NOT_FOUND" });
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, recipe.restaurantId, true);

      await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, input.recipeId));

      if (input.ingredients.length > 0) {
        await db.insert(recipeIngredients).values(
          input.ingredients.map((ing, idx) => ({
            restaurantId: recipe.restaurantId,
            recipeId: input.recipeId,
            itemId: ing.itemId ?? null,
            rawName: ing.rawName ?? null,
            quantity: String(ing.quantity),
            unitName: ing.unitName ?? null,
            yieldRate: String(ing.yieldRate),
            sortOrder: ing.sortOrder ?? idx,
            note: ing.note ?? null,
          })),
        );
      }
      return { ok: true };
    }),

  /** 동적 원가 계산 (조회 시 현재 단가 기준) */
  costPreview: managerProcedure
    .input(z.object({ recipeId: z.number() }))
    .query(async ({ input, ctx }) => {
      const [recipe] = await db
        .select()
        .from(recipes)
        .where(eq(recipes.id, input.recipeId))
        .limit(1);
      if (!recipe) throw new TRPCError({ code: "NOT_FOUND" });
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, recipe.restaurantId);

      const ingRows = await db
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, input.recipeId))
        .orderBy(asc(recipeIngredients.sortOrder), asc(recipeIngredients.id));

      const servingYield = Math.max(Number(recipe.servingYield ?? "1"), 0.001);
      const lossRate = Number(recipe.lossRate ?? "0");
      const sellingPrice = recipe.sellingPrice ? Number(recipe.sellingPrice) : null;

      if (ingRows.length === 0) {
        return {
          ingredients: [],
          menuTotalCost: null as null,
          perServingCost: null as null,
          costRatio: null as null,
          isIncomplete: false,
          servingYield,
          sellingPrice,
          lossRate,
        };
      }

      // 매칭된 item id 목록
      const matchedItemIds = ingRows
        .filter(r => r.itemId != null)
        .map(r => r.itemId!);

      // item 이름 + 수동단가 조회
      const itemNameMap: Record<number, string> = {};
      const itemManualMap: Record<number, number | null> = {};
      if (matchedItemIds.length > 0) {
        const itemRows = await db
          .select({ id: items.id, name: items.name, costPerBaseManual: items.costPerBaseManual })
          .from(items)
          .where(inArray(items.id, matchedItemIds));
        for (const row of itemRows) {
          itemNameMap[row.id] = row.name;
          itemManualMap[row.id] = row.costPerBaseManual ? Number(row.costPerBaseManual) : null;
        }
      }

      // 거래처별 g당단가 — MAX(COALESCE(lastPrice,defaultPrice)/conversionToBase) 기준
      type PricingRow = {
        itemId: number;
        counterpartyName: string;
        pricePerBase: number;
        lastPurchaseDate: string | null;
      };
      const pricingMap: Record<number, PricingRow> = {};

      if (matchedItemIds.length > 0) {
        const idsSql = sql.join(
          matchedItemIds.map(id => sql`${id}`),
          sql`, `,
        );
        const rows = await db.execute(sql`
          SELECT
            ci.itemId,
            c.name AS counterpartyName,
            CAST(COALESCE(ci.lastPrice, ci.defaultPrice) AS DECIMAL(14,4))
              / CAST(ci.conversionToBase AS DECIMAL(10,4)) AS pricePerBase,
            (
              SELECT DATE_FORMAT(MAX(po.purchaseDate), '%Y-%m-%d')
              FROM purchase_orders_v2 po
              JOIN purchase_order_items_v2 poi ON poi.purchaseOrderId = po.id
              WHERE poi.counterpartyItemId = ci.id AND po.status = 'received'
            ) AS lastPurchaseDate
          FROM counterparty_items ci
          JOIN counterparties c ON ci.counterpartyId = c.id
          WHERE ci.restaurantId = ${recipe.restaurantId}
            AND ci.isActive = 1
            AND ci.itemId IN (${idsSql})
            AND ci.conversionToBase IS NOT NULL
            AND CAST(ci.conversionToBase AS DECIMAL(10,4)) > 0
            AND COALESCE(ci.lastPrice, ci.defaultPrice) IS NOT NULL
          ORDER BY ci.itemId ASC, pricePerBase DESC
        `);
        for (const row of (rows[0] as unknown as any[])) {
          const itemId = Number(row.itemId);
          if (!pricingMap[itemId]) {
            pricingMap[itemId] = {
              itemId,
              counterpartyName: String(row.counterpartyName),
              pricePerBase: Number(row.pricePerBase),
              lastPurchaseDate: row.lastPurchaseDate ? String(row.lastPurchaseDate) : null,
            };
          }
        }
      }

      // 행별 원가 계산
      let hasNull = false;
      const enriched = ingRows.map(ing => {
        const isUnmatched = ing.itemId == null;
        const itemName = ing.itemId != null ? (itemNameMap[ing.itemId] ?? null) : null;
        const displayName = itemName ?? ing.rawName ?? "(이름 없음)";

        if (isUnmatched) {
          hasNull = true;
          return {
            id: ing.id,
            itemId: null as null,
            displayName,
            rawName: ing.rawName,
            quantity: Number(ing.quantity),
            unitName: ing.unitName,
            yieldRate: Number(ing.yieldRate),
            pricePerBase: null as null,
            sourceCounterparty: null as null,
            lastPurchaseDate: null as null,
            rowCost: null as null,
            isUnmatched: true,
            isUncalculable: false,
          };
        }

        const itemId = ing.itemId!;
        const manual = itemManualMap[itemId] ?? null;
        let pricePerBase: number | null = null;
        let sourceCounterparty: string | null = null;
        let lastPurchaseDate: string | null = null;

        if (manual != null) {
          pricePerBase = manual;
          sourceCounterparty = "수동 설정";
        } else if (pricingMap[itemId]) {
          pricePerBase = pricingMap[itemId].pricePerBase;
          sourceCounterparty = pricingMap[itemId].counterpartyName;
          lastPurchaseDate = pricingMap[itemId].lastPurchaseDate;
        }

        const isUncalculable = pricePerBase == null;
        if (isUncalculable) hasNull = true;

        const yr = Number(ing.yieldRate) > 0 ? Number(ing.yieldRate) : 1;
        const rowCost = !isUncalculable
          ? (Number(ing.quantity) / yr) * pricePerBase!
          : null;

        return {
          id: ing.id,
          itemId: ing.itemId,
          displayName,
          rawName: ing.rawName,
          quantity: Number(ing.quantity),
          unitName: ing.unitName,
          yieldRate: Number(ing.yieldRate),
          pricePerBase,
          sourceCounterparty,
          lastPurchaseDate,
          rowCost,
          isUnmatched: false,
          isUncalculable,
        };
      });

      // 합계
      const knownCosts = enriched.map(r => r.rowCost).filter(c => c != null) as number[];
      const partialSum = knownCosts.reduce((a, b) => a + b, 0);
      const menuTotalCost = hasNull ? null : partialSum * (1 + lossRate);
      const perServingCost =
        menuTotalCost != null && servingYield > 0 ? menuTotalCost / servingYield : null;
      const costRatio =
        perServingCost != null && sellingPrice != null && sellingPrice > 0
          ? perServingCost / sellingPrice
          : null;

      return {
        ingredients: enriched,
        menuTotalCost,
        perServingCost,
        costRatio,
        isIncomplete: hasNull,
        servingYield,
        sellingPrice,
        lossRate,
      };
    }),
});
