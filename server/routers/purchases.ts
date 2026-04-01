import { z } from "zod";
import { eq, and, between, sql, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { purchaseOrders, purchaseOrderItems, counterparties, dailyExpenses } from "../../drizzle/schema";
import { verifyStoreAccess, requireStoreManager } from "../middleware/storeAuth";

export const purchasesRouter = router({
  /** 월별 매입 목록 */
  listByMonth: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const start = new Date(input.year, input.month - 1, 1);
      const end = new Date(input.year, input.month, 0);
      const orders = await db.select({
        order: purchaseOrders,
        counterpartyName: counterparties.name,
      })
        .from(purchaseOrders)
        .leftJoin(counterparties, eq(counterparties.id, purchaseOrders.counterpartyId))
        .where(and(
          eq(purchaseOrders.restaurantId, input.restaurantId),
          between(purchaseOrders.purchaseDate, start, end)
        ))
        .orderBy(desc(purchaseOrders.purchaseDate));
      return orders.map(o => ({ ...o.order, counterpartyName: o.counterpartyName }));
    }),

  /** 매입 상세 (항목 포함) */
  getDetail: protectedProcedure
    .input(z.object({ id: z.number(), restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const [order] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, input.id)).limit(1);
      if (!order) return null;
      const items = await db.select().from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.purchaseOrderId, input.id))
        .orderBy(purchaseOrderItems.id);
      return { ...order, items };
    }),

  /** 월간 매입 합계 (v1 매입 + 즉시지출) */
  monthlyTotal: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const start = new Date(input.year, input.month - 1, 1);
      const end = new Date(input.year, input.month, 0);
      const mm = String(input.month).padStart(2, "0");
      const startDate = `${input.year}-${mm}-01`;
      const nm = input.month === 12 ? 1 : input.month + 1;
      const ny = input.month === 12 ? input.year + 1 : input.year;
      const endDate = `${ny}-${String(nm).padStart(2, "0")}-01`;

      // v1 매입 합계
      const [v1Row] = await db
        .select({ total: sql<string>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)` })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.restaurantId, input.restaurantId), between(purchaseOrders.purchaseDate, start, end)));

      // 즉시지출 합계
      const [expRow] = await db
        .select({ total: sql<string>`COALESCE(SUM(CAST(${dailyExpenses.amount} AS DECIMAL(14,2))), 0)` })
        .from(dailyExpenses)
        .where(and(
          eq(dailyExpenses.restaurantId, input.restaurantId),
          sql`${dailyExpenses.date} >= ${startDate}`,
          sql`${dailyExpenses.date} < ${endDate}`,
        ));

      const total = Number(v1Row?.total ?? 0) + Number(expRow?.total ?? 0);
      return { total: String(total) };
    }),

  /** 매입 전표 생성 (헤더 + 항목 한번에) */
  create: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      counterpartyId: z.number().nullable().optional(),
      purchaseDate: z.string(),
      note: z.string().optional(),
      items: z.array(z.object({
        itemName: z.string(),
        quantity: z.string().optional(),
        unitName: z.string().optional(),
        unitPrice: z.string().optional(),
        lineTotal: z.string(),
        category: z.string().optional(),
        note: z.string().optional(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireStoreManager(ctx.user.userId, ctx.user.role, input.restaurantId);
      const totalAmount = input.items.reduce((sum, i) => sum + Number(i.lineTotal), 0).toString();

      const [orderResult] = await db.insert(purchaseOrders).values({
        restaurantId: input.restaurantId,
        counterpartyId: input.counterpartyId ?? null,
        purchaseDate: new Date(input.purchaseDate),
        totalAmount,
        note: input.note,
        createdBy: ctx.user.userId,
      }).$returningId();

      if (input.items.length > 0) {
        await db.insert(purchaseOrderItems).values(
          input.items.map(item => ({
            purchaseOrderId: orderResult.id,
            itemName: item.itemName,
            quantity: item.quantity,
            unitName: item.unitName,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            category: item.category ?? "식재료",
            note: item.note,
          }))
        );
      }

      return { id: orderResult.id };
    }),

  /** 매입 삭제 */
  delete: protectedProcedure
    .input(z.object({ id: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await requireStoreManager(ctx.user.userId, ctx.user.role, input.restaurantId);
      await db.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, input.id));
      await db.delete(purchaseOrders).where(eq(purchaseOrders.id, input.id));
      return { ok: true };
    }),
});
