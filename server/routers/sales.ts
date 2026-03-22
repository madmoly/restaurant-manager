import { z } from "zod";
import { eq, and, between, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { sales } from "../../drizzle/schema";
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
});
