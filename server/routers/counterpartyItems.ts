import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { counterpartyItems, items, counterparties } from "../../drizzle/schema";

export const counterpartyItemsRouter = router({
  /** 거래처별 품목 매핑 목록 (품목 정보 JOIN) */
  listByCounterparty: protectedProcedure
    .input(z.object({ counterpartyId: z.number() }))
    .query(async ({ input }) => {
      return db
        .select({
          id: counterpartyItems.id,
          counterpartyId: counterpartyItems.counterpartyId,
          itemId: counterpartyItems.itemId,
          itemName: items.name,
          itemType: items.itemType,
          supplierItemName: counterpartyItems.supplierItemName,
          purchaseUnit: counterpartyItems.purchaseUnit,
          conversionToBase: counterpartyItems.conversionToBase,
          decimalAllowed: counterpartyItems.decimalAllowed,
          quantityStep: counterpartyItems.quantityStep,
          defaultPrice: counterpartyItems.defaultPrice,
          lastPrice: counterpartyItems.lastPrice,
          isPreferred: counterpartyItems.isPreferred,
          costingCategory: items.costingCategory,
          baseUnit: items.baseUnit,
        })
        .from(counterpartyItems)
        .innerJoin(items, eq(counterpartyItems.itemId, items.id))
        .where(eq(counterpartyItems.counterpartyId, input.counterpartyId))
        .orderBy(counterpartyItems.isPreferred, items.name);
    }),

  /** 거래처-품목 매핑 생성 */
  create: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        counterpartyId: z.number(),
        itemId: z.number(),
        supplierItemName: z.string().optional(),
        purchaseUnit: z.string().optional(),
        conversionToBase: z.string().optional(),
        decimalAllowed: z.boolean().default(false),
        quantityStep: z.string().optional(),
        defaultPrice: z.string().optional(),
        isPreferred: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const [result] = await db.insert(counterpartyItems).values({
        restaurantId: input.restaurantId,
        counterpartyId: input.counterpartyId,
        itemId: input.itemId,
        supplierItemName: input.supplierItemName,
        purchaseUnit: input.purchaseUnit,
        conversionToBase: input.conversionToBase,
        decimalAllowed: input.decimalAllowed,
        quantityStep: input.quantityStep,
        defaultPrice: input.defaultPrice,
        isPreferred: input.isPreferred,
      }).$returningId();
      return { id: result.id };
    }),

  /** 기존 품목에 연결 (품목 ID 변경) */
  linkToExistingItem: protectedProcedure
    .input(z.object({ counterpartyItemId: z.number(), itemId: z.number() }))
    .mutation(async ({ input }) => {
      await db
        .update(counterpartyItems)
        .set({ itemId: input.itemId })
        .where(eq(counterpartyItems.id, input.counterpartyItemId));
      return { ok: true };
    }),

  /** 매핑 수정 */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        supplierItemName: z.string().optional(),
        purchaseUnit: z.string().optional(),
        conversionToBase: z.string().optional(),
        decimalAllowed: z.boolean().optional(),
        quantityStep: z.string().optional(),
        defaultPrice: z.string().optional(),
        isPreferred: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(counterpartyItems).set(data).where(eq(counterpartyItems.id, id));
      return { ok: true };
    }),

  /** 매핑 삭제 */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(counterpartyItems).where(eq(counterpartyItems.id, input.id));
      return { ok: true };
    }),
});
