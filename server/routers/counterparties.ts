import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { counterparties } from "../../drizzle/schema";
import { verifyStoreAccess, requireStoreManager } from "../middleware/storeAuth";

export const counterpartiesRouter = router({
  list: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);
      return db.select().from(counterparties)
        .where(and(eq(counterparties.restaurantId, input.restaurantId), eq(counterparties.isActive, true)))
        .orderBy(counterparties.name);
    }),

  create: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      name: z.string().min(1),
      counterpartyType: z.enum(["supplier", "online", "mart", "repair", "other"]).default("supplier"),
      phone: z.string().optional(),
      address: z.string().optional(),
      contactName: z.string().optional(),
      contactPhone: z.string().optional(),
      note: z.string().optional(),
      // 정산표 OCR 대조용
      settlementBasis: z.enum(["supply", "total", "mixed"]).optional(),
      settlementMatchTolerance: z.number().int().min(0).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireStoreManager(ctx.user.userId, ctx.user.role, input.restaurantId);
      const [result] = await db.insert(counterparties).values(input).$returningId();
      return { id: result.id };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      restaurantId: z.number(),
      name: z.string().optional(),
      counterpartyType: z.enum(["supplier", "online", "mart", "repair", "other"]).optional(),
      phone: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
      contactName: z.string().nullable().optional(),
      contactPhone: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
      // 정산표 OCR 대조용
      settlementBasis: z.enum(["supply", "total", "mixed"]).optional(),
      settlementMatchTolerance: z.number().int().min(0).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireStoreManager(ctx.user.userId, ctx.user.role, input.restaurantId);
      const { id, restaurantId, ...data } = input;
      await db.update(counterparties).set(data).where(and(eq(counterparties.id, id), eq(counterparties.restaurantId, restaurantId)));
      return { ok: true };
    }),

  deactivate: protectedProcedure
    .input(z.object({ id: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await requireStoreManager(ctx.user.userId, ctx.user.role, input.restaurantId);
      await db.update(counterparties).set({ isActive: false }).where(and(eq(counterparties.id, input.id), eq(counterparties.restaurantId, input.restaurantId)));
      return { ok: true };
    }),
});
