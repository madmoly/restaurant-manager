import { z } from "zod";
import { eq, and, asc, desc } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import { storeInfoCards } from "../../drizzle/schema";

const CARD_TYPES = ["notice", "access", "contact", "rule", "other"] as const;

export const storeInfoRouter = router({
  /** 매장 업무정보 카드 목록 */
  list: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(storeInfoCards)
        .where(and(
          eq(storeInfoCards.restaurantId, input.restaurantId),
          eq(storeInfoCards.isPublished, true),
        ))
        .orderBy(desc(storeInfoCards.isPinned), asc(storeInfoCards.sortOrder), desc(storeInfoCards.createdAt));
    }),

  /** 카드 등록 (매니져 이상) */
  create: managerProcedure
    .input(z.object({
      restaurantId: z.number(),
      cardType: z.enum(CARD_TYPES),
      title: z.string().min(1),
      content: z.string().optional(),
      imageUrl: z.string().optional(),
      isPinned: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [result] = await db.insert(storeInfoCards).values({
        restaurantId: input.restaurantId,
        cardType: input.cardType,
        title: input.title,
        content: input.content ?? null,
        imageUrl: input.imageUrl ?? null,
        isPinned: input.isPinned ?? false,
        createdBy: ctx.user.id,
      });
      return { id: result.insertId };
    }),

  /** 카드 수정 */
  update: managerProcedure
    .input(z.object({
      id: z.number(),
      cardType: z.enum(CARD_TYPES).optional(),
      title: z.string().min(1).optional(),
      content: z.string().optional(),
      imageUrl: z.string().optional(),
      isPinned: z.boolean().optional(),
      sortOrder: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(storeInfoCards).set(data).where(eq(storeInfoCards.id, id));
      return { ok: true };
    }),

  /** 카드 삭제 (soft) */
  delete: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.update(storeInfoCards).set({ isPublished: false }).where(eq(storeInfoCards.id, input.id));
      return { ok: true };
    }),
});
