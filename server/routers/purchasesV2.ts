import { z } from "zod";
import { eq, and, gte, desc, sql } from "drizzle-orm";
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

  /** 일별 매입 전표 목록 */
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
          status: purchaseOrdersV2.status,
          note: purchaseOrdersV2.note,
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

  /** 매입 전표 생성 (헤더 + 항목 + lastPrice 갱신) */
  createOrder: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        counterpartyId: z.number().optional(),
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
            lineTotal: z.string(),
            costingCategory: z.string().optional(),
            note: z.string().optional(),
          }),
        ),
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

        // counterpartyItems의 lastPrice 갱신
        for (const item of input.items) {
          if (item.counterpartyItemId && item.unitPrice) {
            await db
              .update(counterpartyItems)
              .set({ lastPrice: item.unitPrice })
              .where(eq(counterpartyItems.id, item.counterpartyItemId));
          }
        }
      }

      return { id: orderId };
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
});
