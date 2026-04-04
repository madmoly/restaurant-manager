import { z } from "zod";
import { eq, and, between, sql } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { sales, dailySalesDetail, salesOtherItems } from "../../drizzle/schema";
import { verifyStoreAccess } from "../middleware/storeAuth";

export const salesRouter = router({
  listByMonth: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const start = new Date(input.year, input.month - 1, 1);
      const end = new Date(input.year, input.month, 0);
      return db.select().from(sales)
        .where(and(eq(sales.restaurantId, input.restaurantId), between(sales.saleDate, start, end)))
        .orderBy(sales.saleDate);
    }),

  listByDate: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db.select().from(sales)
        .where(and(eq(sales.restaurantId, input.restaurantId), eq(sales.saleDate, new Date(input.date))));
    }),

  monthlyTotal: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const start = new Date(input.year, input.month - 1, 1);
      const end = new Date(input.year, input.month, 0);
      const [row] = await db
        .select({ total: sql<string>`COALESCE(SUM(${sales.amount}), 0)` })
        .from(sales)
        .where(and(eq(sales.restaurantId, input.restaurantId), between(sales.saleDate, start, end)));
      return { total: row?.total ?? "0" };
    }),

  create: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      saleDate: z.string(),
      amount: z.string(),
      note: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      const [result] = await db.insert(sales).values({
        restaurantId: input.restaurantId,
        saleDate: new Date(input.saleDate),
        amount: input.amount,
        note: input.note,
        recordedBy: ctx.user.userId,
      }).$returningId();
      return { id: result.id };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      restaurantId: z.number(),
      amount: z.string().optional(),
      note: z.string().optional(),
      saleDate: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      const { id, restaurantId, saleDate, ...rest } = input;
      const data: Record<string, unknown> = { ...rest };
      if (saleDate) data.saleDate = new Date(saleDate);
      await db.update(sales).set(data).where(eq(sales.id, id));
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      await db.delete(sales).where(eq(sales.id, input.id));
      return { ok: true };
    }),

  // ─── 매출 상세 (daily_sales_detail) ───────────────────────────

  getDetail: protectedProcedure
    .input(z.object({ restaurantId: z.number(), saleDate: z.string() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      const [detail] = await db.select().from(dailySalesDetail)
        .where(and(eq(dailySalesDetail.restaurantId, input.restaurantId), eq(dailySalesDetail.saleDate, new Date(input.saleDate))));
      if (!detail) return null;
      const others = await db.select().from(salesOtherItems)
        .where(eq(salesOtherItems.dailySalesDetailId, detail.id));
      return { ...detail, otherItems: others };
    }),

  upsertDetail: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      saleDate: z.string(),
      cashAmount: z.string().default("0"),
      cardAmount: z.string().default("0"),
      giftCardAmount: z.string().default("0"),
      transferAmount: z.string().default("0"),
      transferDepositor: z.string().optional(),
      receiptCount: z.number().default(0),
      discountAmount: z.string().default("0"),
      otherAmount: z.string().default("0"),
      totalAmount: z.string(),
      source: z.enum(["manual", "ocr"]).default("manual"),
      ocrRawData: z.any().optional(),
      note: z.string().optional(),
      otherItems: z.array(z.object({
        itemName: z.string(),
        amount: z.string(),
      })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      const [existing] = await db.select().from(dailySalesDetail)
        .where(and(eq(dailySalesDetail.restaurantId, input.restaurantId), eq(dailySalesDetail.saleDate, new Date(input.saleDate))));

      const data = {
        restaurantId: input.restaurantId,
        saleDate: new Date(input.saleDate),
        cashAmount: input.cashAmount,
        cardAmount: input.cardAmount,
        giftCardAmount: input.giftCardAmount,
        transferAmount: input.transferAmount,
        transferDepositor: input.transferDepositor || null,
        receiptCount: input.receiptCount,
        discountAmount: input.discountAmount,
        otherAmount: input.otherAmount,
        totalAmount: input.totalAmount,
        source: input.source,
        ocrRawData: input.ocrRawData || null,
        note: input.note || null,
        recordedBy: ctx.user.userId,
        status: "draft" as const,
      };

      let detailId: number;

      if (existing) {
        await db.update(dailySalesDetail).set(data).where(eq(dailySalesDetail.id, existing.id));
        detailId = existing.id;
      } else {
        const [result] = await db.insert(dailySalesDetail).values(data).$returningId();
        detailId = result.id;
      }

      // otherItems 처리
      if (input.otherItems) {
        await db.delete(salesOtherItems).where(eq(salesOtherItems.dailySalesDetailId, detailId));
        if (input.otherItems.length > 0) {
          await db.insert(salesOtherItems).values(
            input.otherItems.map(item => ({
              dailySalesDetailId: detailId,
              restaurantId: input.restaurantId,
              itemName: item.itemName,
              amount: item.amount,
            }))
          );
        }
      }

      return { id: detailId, isUpdate: !!existing };
    }),
});
