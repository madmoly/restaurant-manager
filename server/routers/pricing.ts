import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { counterpartyItems, counterparties } from "../../drizzle/schema";

export const pricingRouter = router({
  /** 거래처-품목의 최근 단가 */
  getLastPriceByCounterpartyItem: protectedProcedure
    .input(z.object({ counterpartyItemId: z.number() }))
    .query(async ({ input }) => {
      const [row] = await db
        .select({
          lastPrice: counterpartyItems.lastPrice,
          defaultPrice: counterpartyItems.defaultPrice,
        })
        .from(counterpartyItems)
        .where(eq(counterpartyItems.id, input.counterpartyItemId));
      return row ?? null;
    }),

  /** 동일 품목에 대한 거래처별 단가 비교 */
  getRecentComparisonByItem: protectedProcedure
    .input(z.object({ restaurantId: z.number(), itemId: z.number() }))
    .query(async ({ input }) => {
      return db
        .select({
          counterpartyId: counterpartyItems.counterpartyId,
          counterpartyName: counterparties.name,
          counterpartyType: counterparties.counterpartyType,
          purchaseUnit: counterpartyItems.purchaseUnit,
          lastPrice: counterpartyItems.lastPrice,
          defaultPrice: counterpartyItems.defaultPrice,
          isPreferred: counterpartyItems.isPreferred,
        })
        .from(counterpartyItems)
        .innerJoin(counterparties, eq(counterpartyItems.counterpartyId, counterparties.id))
        .where(
          and(
            eq(counterpartyItems.restaurantId, input.restaurantId),
            eq(counterpartyItems.itemId, input.itemId),
            eq(counterparties.isActive, true),
          ),
        )
        .orderBy(counterpartyItems.lastPrice);
    }),
});
