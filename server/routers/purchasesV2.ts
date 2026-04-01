import { z } from "zod";
import { eq, and, gte, lte, desc, asc, sql } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import {
  purchaseOrdersV2,
  counterparties,
  users,
} from "../../drizzle/schema";

export const purchasesV2Router = router({
  /** 월별 발주 목록 */
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

  /** 일별 발주 목록 */
  listByDate: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      return db
        .select({
          id: purchaseOrdersV2.id,
          restaurantId: purchaseOrdersV2.restaurantId,
          counterpartyId: purchaseOrdersV2.counterpartyId,
          counterpartyName: counterparties.name,
          purchaseDate: purchaseOrdersV2.purchaseDate,
          receivedAt: purchaseOrdersV2.receivedAt,
          status: purchaseOrdersV2.status,
          note: purchaseOrdersV2.note,
          attachmentUrl: purchaseOrdersV2.attachmentUrl,
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
            sql`DATE(${purchaseOrdersV2.purchaseDate}) = ${input.date}`,
          ),
        )
        .orderBy(desc(purchaseOrdersV2.createdAt));
    }),

  /** 발주 등록 (사진 + 메모 + 선택적 거래처/금액) */
  createOrder: protectedProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        purchaseDate: z.string(),
        counterpartyId: z.number().nullable().optional(),
        note: z.string().optional(),
        attachmentUrl: z.string().optional(),
        totalAmount: z.string().optional(), // 선택적 금액 (입고 시 입력 가능)
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const [result] = await db.insert(purchaseOrdersV2).values({
        restaurantId: input.restaurantId,
        purchaseDate: input.purchaseDate,
        counterpartyId: input.counterpartyId || null,
        status: "ordered",
        note: input.note || null,
        attachmentUrl: input.attachmentUrl || null,
        totalAmount: input.totalAmount || "0",
        createdBy: ctx.user.userId,
      });
      return { id: result.insertId };
    }),

  /** 입고 확인 (발주 → 입고, 금액 갱신 가능) */
  confirmReceive: protectedProcedure
    .input(z.object({
      id: z.number(),
      totalAmount: z.string().optional(), // 입고 시 금액 확정
    }))
    .mutation(async ({ input, ctx }) => {
      const updateData: Record<string, any> = {
        status: "received",
        receivedAt: new Date(),
        lastModifiedBy: ctx.user.userId,
        lastModifiedAt: new Date(),
      };
      if (input.totalAmount !== undefined) {
        updateData.totalAmount = input.totalAmount;
      }
      await db
        .update(purchaseOrdersV2)
        .set(updateData)
        .where(eq(purchaseOrdersV2.id, input.id));
      return { success: true };
    }),

  /** 발주 수정 (메모, 사진, 거래처, 금액 변경) */
  updateOrder: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        counterpartyId: z.number().nullable().optional(),
        purchaseDate: z.string().optional(),
        note: z.string().nullable().optional(),
        attachmentUrl: z.string().nullable().optional(),
        totalAmount: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;

      const updatePayload: Record<string, any> = {
        ...rest,
        lastModifiedBy: ctx.user.userId,
        lastModifiedAt: new Date(),
      };

      if (rest.purchaseDate) {
        updatePayload.purchaseDate = new Date(rest.purchaseDate + "T00:00:00");
      }

      await db.update(purchaseOrdersV2).set(updatePayload).where(eq(purchaseOrdersV2.id, id));
      return { ok: true };
    }),

  /** 발주 삭제 — manager 이상 */
  deleteOrder: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(purchaseOrdersV2).where(eq(purchaseOrdersV2.id, input.id));
      return { ok: true };
    }),

  /** 미입고 발주 목록 */
  pendingOrders: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input }) => {
      return db
        .select({
          id: purchaseOrdersV2.id,
          counterpartyId: purchaseOrdersV2.counterpartyId,
          counterpartyName: counterparties.name,
          purchaseDate: purchaseOrdersV2.purchaseDate,
          totalAmount: purchaseOrdersV2.totalAmount,
          note: purchaseOrdersV2.note,
          attachmentUrl: purchaseOrdersV2.attachmentUrl,
          createdAt: purchaseOrdersV2.createdAt,
        })
        .from(purchaseOrdersV2)
        .leftJoin(counterparties, eq(purchaseOrdersV2.counterpartyId, counterparties.id))
        .where(
          and(
            eq(purchaseOrdersV2.restaurantId, input.restaurantId),
            eq(purchaseOrdersV2.status, "ordered"),
          ),
        )
        .orderBy(desc(purchaseOrdersV2.purchaseDate));
    }),

  /** 월별 입고 금액 합계 (수익분석용) */
  monthlyReceivedTotal: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input }) => {
      const mm = String(input.month).padStart(2, "0");
      const startDate = `${input.year}-${mm}-01`;
      const nm = input.month === 12 ? 1 : input.month + 1;
      const ny = input.month === 12 ? input.year + 1 : input.year;
      const endDate = `${ny}-${String(nm).padStart(2, "0")}-01`;

      const [row] = await db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(totalAmount AS DECIMAL(14,2))), 0)`,
          count: sql<number>`COUNT(*)`,
        })
        .from(purchaseOrdersV2)
        .where(
          and(
            eq(purchaseOrdersV2.restaurantId, input.restaurantId),
            eq(purchaseOrdersV2.status, "received"),
            sql`${purchaseOrdersV2.purchaseDate} >= ${startDate}`,
            sql`${purchaseOrdersV2.purchaseDate} < ${endDate}`,
          ),
        );
      return { total: Number(row?.total ?? 0), count: Number(row?.count ?? 0) };
    }),
});
