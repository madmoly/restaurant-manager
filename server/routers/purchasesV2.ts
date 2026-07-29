import { z } from "zod";
import { eq, and, gte, lte, desc, asc, sql, inArray } from "drizzle-orm";
import { router, storeReadProcedure, storeWriteProcedure, storeManagerProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { db } from "../db";
import {
  purchaseOrdersV2,
  purchaseOrderItemsV2,
  counterpartyItems,
  counterparties,
  items,
  users,
} from "../../drizzle/schema";
import { exportDatasetToGDrive, isGDriveConfigured } from "../gdrive";
import { verifyOperatingDay } from "../middleware/operatingDayGuard";

// 매입 확정 시 비동기로 Drive 업로드 (응답 지연 없음)
function triggerDatasetExport() {
  if (!isGDriveConfigured()) return;
  setTimeout(async () => {
    try {
      const result = await exportDatasetToGDrive("purchase_confirmed");
      if (result.success) {
        console.log(`[GDrive] 매입 확정 트리거: ${result.files.length}개 파일 업로드`);
      }
    } catch (e: any) {
      console.error("[GDrive] 매입 확정 트리거 실패:", e.message);
    }
  }, 5000);
}

export const purchasesV2Router = router({
  /** 월별 매입 전표 목록 */
  listOrdersByMonth: storeReadProcedure
    .input(z.object({ year: z.number(), month: z.number() }))
    .query(async ({ input }) => {
      const mm = String(input.month).padStart(2, "0");
      const startDate = `${input.year}-${mm}-01`;
      const nextY = input.month === 12 ? input.year + 1 : input.year;
      const nextM = input.month === 12 ? 1 : input.month + 1;
      const nextMonthStart = `${nextY}-${String(nextM).padStart(2, "0")}-01`;

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
            sql`${purchaseOrdersV2.purchaseDate} < ${nextMonthStart}`,
          ),
        )
        .orderBy(desc(purchaseOrdersV2.purchaseDate));
    }),

  /** 일별 매입 전표 목록 (발주+입고 모두) */
  listByDate: storeReadProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input }) => {
      const dateStr = input.date; // yyyy-MM-dd
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
            sql`DATE(${purchaseOrdersV2.purchaseDate}) = ${dateStr}`,
          ),
        )
        .orderBy(desc(purchaseOrdersV2.createdAt));
    }),

  /** 전표 상세 항목 — order의 restaurantId 일치 검증 (cross-store 누수 차단) */
  getOrderItems: storeReadProcedure
    .input(z.object({ orderId: z.number() }))
    .query(async ({ input }) => {
      // 1) order 존재 + restaurantId 일치 검증 (NOT_FOUND throw 패턴 통일)
      const [orderExists] = await db
        .select({ id: purchaseOrdersV2.id })
        .from(purchaseOrdersV2)
        .where(and(
          eq(purchaseOrdersV2.id, input.orderId),
          eq(purchaseOrdersV2.restaurantId, input.restaurantId),
        ))
        .limit(1);
      if (!orderExists) {
        throw new TRPCError({ code: "NOT_FOUND", message: "전표를 찾을 수 없습니다" });
      }
      // 2) 항목 조회
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
          supplyAmount: purchaseOrderItemsV2.supplyAmount,
          vatAmount: purchaseOrderItemsV2.vatAmount,
          taxType: purchaseOrderItemsV2.taxType,
          costingCategory: purchaseOrderItemsV2.costingCategory,
          note: purchaseOrderItemsV2.note,
        })
        .from(purchaseOrderItemsV2)
        .leftJoin(items, eq(purchaseOrderItemsV2.itemId, items.id))
        .where(eq(purchaseOrderItemsV2.purchaseOrderId, input.orderId));
    }),

  /** 거래처별 최근 전표 */
  getRecentOrdersByCounterparty: storeReadProcedure
    .input(
      z.object({
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

  /** P1-3: 중복 전표 감지 (동일 날짜+거래처+유사금액 ±5%) */
  checkDuplicate: storeReadProcedure
    .input(z.object({
      counterpartyId: z.number(),
      purchaseDate: z.string(),
      totalAmount: z.number(),
    }))
    .query(async ({ input }) => {
      const lower = input.totalAmount * 0.95;
      const upper = input.totalAmount * 1.05;
      const rows = await db.execute(sql`
        SELECT id, totalAmount, status, createdAt
        FROM purchase_orders_v2
        WHERE restaurantId = ${input.restaurantId}
          AND counterpartyId = ${input.counterpartyId}
          AND purchaseDate = ${input.purchaseDate}
          AND CAST(totalAmount AS DECIMAL(14,2)) BETWEEN ${lower} AND ${upper}
        LIMIT 3
      `);
      const duplicates = (rows[0] as unknown as any[]).map(r => ({
        id: r.id,
        totalAmount: Number(r.totalAmount),
        status: r.status,
        createdAt: r.createdAt,
      }));
      return { hasDuplicate: duplicates.length > 0, duplicates };
    }),

  /** 매입 전표 생성 (헤더 + 항목 + lastPrice 갱신)
   *  발주(ordered): items 없어도 가능 (거래처/사진만으로 등록)
   *  입고(received): 기존과 동일
   */
  createOrder: storeWriteProcedure
    .input(
      z.object({
        counterpartyId: z.number().optional(),
        purchaseDate: z.string(),
        status: z.enum(["received", "ordered"]).default("received"),
        note: z.string().optional(),
        attachmentUrl: z.string().optional(),
        override: z.object({ reason: z.string().min(1) }).optional(),
        items: z.array(
          z.object({
            itemId: z.number().optional(),
            counterpartyItemId: z.number().optional(),
            rawItemName: z.string().optional(),
            itemType: z.enum(["product", "service", "misc"]).default("product"),
            quantity: z.string().optional(),
            unitName: z.string().optional(),
            unitPrice: z.string().optional(),
            lineTotal: z.string().default("0"),
            supplyAmount: z.string().optional(),
            vatAmount: z.string().optional(),
            taxType: z.enum(["taxable", "exempt", "unknown"]).default("unknown"),
            costingCategory: z.string().optional(),
            note: z.string().optional(),
          }),
        ).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await verifyOperatingDay({
        restaurantId: input.restaurantId,
        dateStr: input.purchaseDate,
        override: input.override,
        userId: ctx.user.userId,
        userRole: ctx.user.role,
      });

      const totalAmount = input.items.reduce(
        (sum, item) => sum + parseFloat(item.lineTotal || "0"),
        0,
      );

      // 헤더 삽입
      const [orderResult] = await db
        .insert(purchaseOrdersV2)
        .values({
          restaurantId: input.restaurantId,
          counterpartyId: input.counterpartyId ?? null,
          purchaseDate: new Date(input.purchaseDate),
          status: input.status,
          note: input.note,
          attachmentUrl: input.attachmentUrl,
          totalAmount: String(totalAmount),
          createdBy: ctx.user.userId,
          receivedAt: input.status === "received" ? new Date() : null,
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
            rawItemName: item.rawItemName?.slice(0, 100),
            itemType: item.itemType,
            quantity: item.quantity,
            unitName: item.unitName,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            // 빈 문자열이 DECIMAL 컬럼에 들어가면 MySQL strict mode에서 실패 → null 정규화
            supplyAmount: item.supplyAmount === "" ? null : item.supplyAmount,
            vatAmount: item.vatAmount === "" ? null : item.vatAmount,
            taxType: item.taxType,
            costingCategory: item.costingCategory,
            note: item.note,
          })),
        );

        // counterpartyItems의 lastPrice 갱신 (입고 시에만)
        if (input.status === "received") {
          for (const item of input.items) {
            if (item.counterpartyItemId && item.unitPrice) {
              await db
                .update(counterpartyItems)
                .set({ lastPrice: item.unitPrice })
                .where(eq(counterpartyItems.id, item.counterpartyItemId));
            }

            // P1-2: itemId 있고 counterpartyItemId 없으면 → counterpartyItem 자동 생성
            if (item.itemId && !item.counterpartyItemId && input.counterpartyId) {
              const existing = await db
                .select({ id: counterpartyItems.id })
                .from(counterpartyItems)
                .where(and(
                  eq(counterpartyItems.restaurantId, input.restaurantId),
                  eq(counterpartyItems.counterpartyId, input.counterpartyId),
                  eq(counterpartyItems.itemId, item.itemId),
                ))
                .limit(1);
              if (existing.length === 0) {
                await db.insert(counterpartyItems).values({
                  restaurantId: input.restaurantId,
                  counterpartyId: input.counterpartyId,
                  itemId: item.itemId,
                  supplierItemName: item.rawItemName?.slice(0, 100) || null,
                  purchaseUnit: item.unitName || null,
                  lastPrice: item.unitPrice || null,
                });
              }
            }
          }
          triggerDatasetExport();
        }
      }

      return { id: orderId };
    }),

  /** 발주 → 입고 전환 (품목/금액 갱신 포함) */
  receiveOrder: storeWriteProcedure
    .input(
      z.object({
        id: z.number(),
        totalAmount: z.string().optional(),
        override: z.object({ reason: z.string().min(1) }).optional(),
        items: z.array(
          z.object({
            itemId: z.number().optional(),
            counterpartyItemId: z.number().optional(),
            rawItemName: z.string().optional(),
            itemType: z.enum(["product", "service", "misc"]).default("product"),
            quantity: z.string().optional(),
            unitName: z.string().optional(),
            unitPrice: z.string().optional(),
            lineTotal: z.string().default("0"),
            supplyAmount: z.string().optional(),
            vatAmount: z.string().optional(),
            taxType: z.enum(["taxable", "exempt", "unknown"]).default("unknown"),
            costingCategory: z.string().optional(),
            note: z.string().optional(),
          }),
        ).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 입고일 = 오늘(KST 기준) — 휴무일 가드 대상
      const kstNow = new Date(Date.now() + 9 * 3600000);
      const receivedDate = kstNow.toISOString().slice(0, 10);
      await verifyOperatingDay({
        restaurantId: input.restaurantId,
        dateStr: receivedDate,
        override: input.override,
        userId: ctx.user.userId,
        userRole: ctx.user.role,
      });

      // 기존 발주 조회 — restaurantId 일치 검증 (cross-store 누수 차단)
      const [existing] = await db
        .select()
        .from(purchaseOrdersV2)
        .where(and(
          eq(purchaseOrdersV2.id, input.id),
          eq(purchaseOrdersV2.restaurantId, input.restaurantId),
        ))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "발주를 찾을 수 없습니다" });
      }

      // 품목 교체: 새 items가 있으면 기존 삭제 후 삽입
      if (input.items && input.items.length > 0) {
        await db
          .delete(purchaseOrderItemsV2)
          .where(eq(purchaseOrderItemsV2.purchaseOrderId, input.id));

        await db.insert(purchaseOrderItemsV2).values(
          input.items.map((item) => ({
            purchaseOrderId: input.id,
            itemId: item.itemId,
            counterpartyItemId: item.counterpartyItemId,
            rawItemName: item.rawItemName?.slice(0, 100),
            itemType: item.itemType,
            quantity: item.quantity,
            unitName: item.unitName,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            // 빈 문자열이 DECIMAL 컬럼에 들어가면 MySQL strict mode에서 실패 → null 정규화
            supplyAmount: item.supplyAmount === "" ? null : item.supplyAmount,
            vatAmount: item.vatAmount === "" ? null : item.vatAmount,
            taxType: item.taxType,
            costingCategory: item.costingCategory,
            note: item.note,
          })),
        );

        // lastPrice 갱신
        for (const item of input.items) {
          if (item.counterpartyItemId && item.unitPrice) {
            await db
              .update(counterpartyItems)
              .set({ lastPrice: item.unitPrice })
              .where(eq(counterpartyItems.id, item.counterpartyItemId));
          }
        }
      }

      const newTotal = input.items
        ? input.items.reduce((sum, item) => sum + parseFloat(item.lineTotal || "0"), 0)
        : input.totalAmount ? parseFloat(input.totalAmount) : Number(existing.totalAmount);

      // 이력 기록
      const prevHistory = (existing.editHistory as any[]) ?? [];
      const newEntry = {
        userId: ctx.user.userId,
        userName: ctx.user.username ?? String(ctx.user.userId),
        at: new Date().toISOString(),
        summary: `입고 전환 (${Number(existing.totalAmount).toLocaleString()}원 → ${newTotal.toLocaleString()}원)`,
      };

      await db
        .update(purchaseOrdersV2)
        .set({
          status: "received",
          purchaseDate: receivedDate,
          receivedAt: new Date(),
          totalAmount: String(newTotal),
          lastModifiedBy: ctx.user.userId,
          lastModifiedAt: new Date(),
          editHistory: [...prevHistory, newEntry],
        })
        .where(eq(purchaseOrdersV2.id, input.id));

      triggerDatasetExport();
      return { ok: true };
    }),

  /** 입고 완료 전표의 품목 라인 수정 (delete-all + re-insert, 합계 재계산, lastPrice 갱신) */
  updateReceivedItems: storeWriteProcedure
    .input(
      z.object({
        id: z.number(),
        items: z.array(
          z.object({
            itemId: z.number().optional(),
            counterpartyItemId: z.number().optional(),
            rawItemName: z.string().optional(),
            itemType: z.enum(["product", "service", "misc"]).default("product"),
            quantity: z.string().optional(),
            unitName: z.string().optional(),
            unitPrice: z.string().optional(),
            lineTotal: z.string().default("0"),
            supplyAmount: z.string().optional(),
            vatAmount: z.string().optional(),
            taxType: z.enum(["taxable", "exempt", "unknown"]).default("unknown"),
            costingCategory: z.string().optional(),
            note: z.string().optional(),
          }),
        ).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // restaurantId 일치 검증 (cross-store 누수 차단)
      const [existing] = await db
        .select()
        .from(purchaseOrdersV2)
        .where(and(
          eq(purchaseOrdersV2.id, input.id),
          eq(purchaseOrdersV2.restaurantId, input.restaurantId),
        ))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "전표를 찾을 수 없습니다" });
      }
      // 확정 전표만 대상 (발주는 receiveOrder 경로)
      if (existing.status !== "received") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "입고 완료된 전표만 품목 수정이 가능합니다" });
      }

      // 품목 교체
      await db
        .delete(purchaseOrderItemsV2)
        .where(eq(purchaseOrderItemsV2.purchaseOrderId, input.id));
      await db.insert(purchaseOrderItemsV2).values(
        input.items.map((item) => ({
          purchaseOrderId: input.id,
          itemId: item.itemId,
          counterpartyItemId: item.counterpartyItemId,
          rawItemName: item.rawItemName?.slice(0, 100),
          itemType: item.itemType,
          quantity: item.quantity,
          unitName: item.unitName,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          supplyAmount: item.supplyAmount === "" ? null : item.supplyAmount,
          vatAmount: item.vatAmount === "" ? null : item.vatAmount,
          taxType: item.taxType,
          costingCategory: item.costingCategory,
          note: item.note,
        })),
      );

      // lastPrice 갱신 (received 전제)
      for (const item of input.items) {
        if (item.counterpartyItemId && item.unitPrice) {
          await db
            .update(counterpartyItems)
            .set({ lastPrice: item.unitPrice })
            .where(eq(counterpartyItems.id, item.counterpartyItemId));
        }
      }

      // 합계 재계산 + 이력
      const newTotal = input.items.reduce(
        (sum, it) => sum + parseFloat(it.lineTotal || "0"),
        0,
      );
      const prevHistory = (existing.editHistory as any[]) ?? [];
      const newEntry = {
        userId: ctx.user.userId,
        userName: ctx.user.username ?? String(ctx.user.userId),
        at: new Date().toISOString(),
        summary: `품목 수정 (${Number(existing.totalAmount).toLocaleString()}원 → ${newTotal.toLocaleString()}원)`,
      };

      await db
        .update(purchaseOrdersV2)
        .set({
          totalAmount: String(newTotal),
          lastModifiedBy: ctx.user.userId,
          lastModifiedAt: new Date(),
          editHistory: [...prevHistory, newEntry],
        })
        .where(eq(purchaseOrdersV2.id, input.id));

      triggerDatasetExport();
      return { ok: true, totalAmount: newTotal };
    }),

  /** 전표 헤더 수정 + 수정이력 기록 */
  updateOrder: storeWriteProcedure
    .input(
      z.object({
        id: z.number(),
        counterpartyId: z.number().nullable().optional(),
        purchaseDate: z.string().optional(),
        note: z.string().nullable().optional(),
        status: z.enum(["received", "ordered"]).optional(),
        attachmentUrl: z.string().nullable().optional(),
        totalAmount: z.string().optional(),
        override: z.object({ reason: z.string().min(1) }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, restaurantId, override, ...rest } = input;

      // 기존 전표 조회 — restaurantId 일치 검증 (cross-store 누수 차단)
      const [existing] = await db
        .select()
        .from(purchaseOrdersV2)
        .where(and(
          eq(purchaseOrdersV2.id, id),
          eq(purchaseOrdersV2.restaurantId, restaurantId),
        ))
        .limit(1);
      if (!existing) {
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
      if (rest.purchaseDate && rest.purchaseDate !== existingDateStr) {
        changes.push(`날짜: ${existingDateStr} → ${rest.purchaseDate}`);
        await verifyOperatingDay({
          restaurantId,
          dateStr: rest.purchaseDate,
          override,
          userId: ctx.user.userId,
          userRole: ctx.user.role,
        });
      }
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

      // 발주→입고 전환 시 receivedAt 자동 설정
      if (rest.status === "received" && existing.status === "ordered") {
        updatePayload.receivedAt = new Date();
        triggerDatasetExport();
      }

      if (rest.purchaseDate) {
        updatePayload.purchaseDate = new Date(rest.purchaseDate + "T00:00:00");
      }

      await db.update(purchaseOrdersV2).set(updatePayload).where(eq(purchaseOrdersV2.id, id));
      return { ok: true };
    }),

  /** 전표 삭제 (항목 + 헤더) — 매니저 이상 */
  deleteOrder: storeManagerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      // restaurantId 일치 검증
      const [existing] = await db
        .select({ id: purchaseOrdersV2.id })
        .from(purchaseOrdersV2)
        .where(and(
          eq(purchaseOrdersV2.id, input.id),
          eq(purchaseOrdersV2.restaurantId, input.restaurantId),
        ))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "전표를 찾을 수 없습니다" });
      }
      await db
        .delete(purchaseOrderItemsV2)
        .where(eq(purchaseOrderItemsV2.purchaseOrderId, input.id));
      await db.delete(purchaseOrdersV2).where(eq(purchaseOrdersV2.id, input.id));
      return { ok: true };
    }),

  // ═══════════════════════════════════════════════════════════════════════
  // 매입 분석 API
  // ═══════════════════════════════════════════════════════════════════════

  /** 품목별 거래처 가격비교: 동일 품목(itemId)의 기준단위가 기준 비교 */
  itemPriceComparison: storeReadProcedure
    .query(async ({ input }) => {
      const rows = await db.execute(sql`
        SELECT
          i.id AS itemId,
          i.name AS itemName,
          i.baseUnit,
          c.id AS counterpartyId,
          c.name AS counterpartyName,
          ci.purchaseUnit,
          ci.conversionToBase,
          oi.unitPrice,
          oi.unitName,
          CASE WHEN ci.conversionToBase IS NOT NULL AND CAST(ci.conversionToBase AS DECIMAL(10,4)) > 0
            THEN CAST(oi.unitPrice AS DECIMAL(14,4)) / CAST(ci.conversionToBase AS DECIMAL(10,4))
            ELSE CAST(oi.unitPrice AS DECIMAL(14,4))
          END AS basePricePerUnit,
          o.purchaseDate,
          oi.quantity
        FROM purchase_order_items_v2 oi
        JOIN purchase_orders_v2 o ON oi.purchaseOrderId = o.id
        JOIN items i ON oi.itemId = i.id
        LEFT JOIN counterparties c ON o.counterpartyId = c.id
        LEFT JOIN counterparty_items ci ON oi.counterpartyItemId = ci.id
        WHERE o.restaurantId = ${input.restaurantId}
          AND oi.itemId IS NOT NULL
          AND oi.unitPrice IS NOT NULL
          AND oi.unitPrice != '0'
          AND o.status = 'received'
        ORDER BY i.name, o.purchaseDate DESC
      `);
      // Group by itemId → list of supplier prices
      const map = new Map<number, { itemName: string; baseUnit: string | null; entries: any[] }>();
      for (const row of (rows[0] as unknown as any[])) {
        const key = row.itemId as number;
        if (!map.has(key)) map.set(key, { itemName: row.itemName, baseUnit: row.baseUnit, entries: [] });
        const convBase = Number(row.conversionToBase || 0);
        map.get(key)!.entries.push({
          counterpartyId: row.counterpartyId,
          counterpartyName: row.counterpartyName || '미지정',
          unitPrice: row.unitPrice,
          unitName: row.purchaseUnit || row.unitName,
          basePricePerUnit: Number(row.basePricePerUnit),
          conversionNote: convBase > 0 && convBase !== 1 ? null : '(환산계수 미설정)',
          purchaseDate: row.purchaseDate,
          quantity: row.quantity,
        });
      }
      // Sort: multi-supplier first, then single-supplier
      const result: any[] = [];
      for (const [, { itemName, baseUnit, entries }] of map) {
        const uniqueSuppliers = new Set(entries.map((e: any) => e.counterpartyId));
        if (uniqueSuppliers.size >= 2) {
          const latestBySupplier = new Map<number, any>();
          for (const e of entries) {
            if (!latestBySupplier.has(e.counterpartyId)) {
              latestBySupplier.set(e.counterpartyId, e);
            }
          }
          result.push({ itemName, baseUnit, suppliers: Array.from(latestBySupplier.values()) });
        }
      }
      for (const [, { itemName, baseUnit, entries }] of map) {
        const uniqueSuppliers = new Set(entries.map((e: any) => e.counterpartyId));
        if (uniqueSuppliers.size === 1) {
          result.push({ itemName, baseUnit, suppliers: [entries[0]] });
        }
      }
      return result;
    }),

  /** 시기별 품목 단가 추이: itemId 기준 기준단위가 변화 */
  itemPriceTrend: storeReadProcedure
    .input(z.object({
      months: z.number().default(6),
    }))
    .query(async ({ input }) => {
      const rows = await db.execute(sql`
        SELECT
          i.id AS itemId,
          i.name AS itemName,
          i.baseUnit,
          c.name AS counterpartyName,
          oi.unitPrice,
          ci.purchaseUnit,
          ci.conversionToBase,
          CASE WHEN ci.conversionToBase IS NOT NULL AND CAST(ci.conversionToBase AS DECIMAL(10,4)) > 0
            THEN CAST(oi.unitPrice AS DECIMAL(14,4)) / CAST(ci.conversionToBase AS DECIMAL(10,4))
            ELSE CAST(oi.unitPrice AS DECIMAL(14,4))
          END AS basePricePerUnit,
          DATE_FORMAT(o.purchaseDate, '%Y-%m') AS yearMonth,
          o.purchaseDate
        FROM purchase_order_items_v2 oi
        JOIN purchase_orders_v2 o ON oi.purchaseOrderId = o.id
        JOIN items i ON oi.itemId = i.id
        LEFT JOIN counterparties c ON o.counterpartyId = c.id
        LEFT JOIN counterparty_items ci ON oi.counterpartyItemId = ci.id
        WHERE o.restaurantId = ${input.restaurantId}
          AND oi.itemId IS NOT NULL
          AND oi.unitPrice IS NOT NULL
          AND oi.unitPrice != '0'
          AND o.purchaseDate >= DATE_SUB(CURDATE(), INTERVAL ${input.months} MONTH)
        ORDER BY i.name, o.purchaseDate ASC
      `);
      // Group by itemId → chronological price points
      const map = new Map<number, { itemName: string; baseUnit: string | null; points: any[] }>();
      for (const row of (rows[0] as unknown as any[])) {
        const key = row.itemId as number;
        if (!map.has(key)) map.set(key, { itemName: row.itemName, baseUnit: row.baseUnit, points: [] });
        const basePrice = Number(row.basePricePerUnit);
        map.get(key)!.points.push({
          counterpartyName: row.counterpartyName || '미지정',
          unitPrice: basePrice,
          unitName: row.baseUnit || row.purchaseUnit,
          yearMonth: row.yearMonth,
          purchaseDate: row.purchaseDate,
        });
      }
      return Array.from(map.values()).map(({ itemName, baseUnit, points }) => ({
        itemName,
        baseUnit,
        points,
        minPrice: Math.min(...points.map((p: any) => p.unitPrice)),
        maxPrice: Math.max(...points.map((p: any) => p.unitPrice)),
        latestPrice: points[points.length - 1]?.unitPrice ?? 0,
      }));
    }),

  /** 거래처별 매입/발주 금액 분석 */
  counterpartyAmountAnalysis: storeReadProcedure
    .input(z.object({
      months: z.number().default(3),
    }))
    .query(async ({ input }) => {
      const rows = await db.execute(sql`
        SELECT
          o.counterpartyId,
          c.name AS counterpartyName,
          o.status,
          COUNT(*) AS orderCount,
          SUM(CAST(o.totalAmount AS DECIMAL(14,2))) AS totalAmount,
          DATE_FORMAT(o.purchaseDate, '%Y-%m') AS yearMonth
        FROM purchase_orders_v2 o
        LEFT JOIN counterparties c ON o.counterpartyId = c.id
        WHERE o.restaurantId = ${input.restaurantId}
          AND o.purchaseDate >= DATE_SUB(CURDATE(), INTERVAL ${input.months} MONTH)
        GROUP BY o.counterpartyId, c.name, o.status, DATE_FORMAT(o.purchaseDate, '%Y-%m')
        ORDER BY c.name, DATE_FORMAT(o.purchaseDate, '%Y-%m')
      `);
      // Group by counterparty
      const map = new Map<string, any>();
      for (const row of (rows[0] as unknown as any[])) {
        const key = row.counterpartyName || '미지정';
        if (!map.has(key)) {
          map.set(key, {
            counterpartyId: row.counterpartyId,
            counterpartyName: key,
            totalReceived: 0,
            totalOrdered: 0,
            receivedCount: 0,
            orderedCount: 0,
            monthly: [],
          });
        }
        const entry = map.get(key)!;
        const amount = Number(row.totalAmount || 0);
        const count = Number(row.orderCount || 0);
        if (row.status === 'received') {
          entry.totalReceived += amount;
          entry.receivedCount += count;
        } else {
          entry.totalOrdered += amount;
          entry.orderedCount += count;
        }
        entry.monthly.push({
          yearMonth: row.yearMonth,
          status: row.status,
          amount,
          count,
        });
      }
      return Array.from(map.values()).sort((a, b) => (b.totalReceived + b.totalOrdered) - (a.totalReceived + a.totalOrdered));
    }),

  /** 미입고 발주 전표 목록 (품목 수 포함) */
  pendingOrders: storeReadProcedure
    .query(async ({ input }) => {
      const orders = await db
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

      // 각 발주의 품목 수 조회
      const withItemCount = await Promise.all(
        orders.map(async (order) => {
          const [countRow] = await db
            .select({ cnt: sql<number>`COUNT(*)` })
            .from(purchaseOrderItemsV2)
            .where(eq(purchaseOrderItemsV2.purchaseOrderId, order.id));
          return { ...order, itemCount: Number(countRow?.cnt ?? 0) };
        }),
      );

      return withItemCount;
    }),

  /** 중복 입고/발주 감지 (동일 날짜 + 동일 거래처 + 동일 금액) — 매니저 이상 */
  findDuplicates: storeManagerProcedure
    .input(z.object({
      month: z.string(), // "YYYY-MM"
    }))
    .query(async ({ input }) => {
      const [yStr, mStr] = input.month.split("-");
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10);
      const startDate = `${input.month}-01`;
      const nextY = m === 12 ? y + 1 : y;
      const nextM = m === 12 ? 1 : m + 1;
      const nextMonthStart = `${nextY}-${String(nextM).padStart(2, "0")}-01`;

      // 동일 날짜+거래처+금액+상태 조합으로 그룹핑, 2건 이상인 것만
      const dupes = await db.select({
        purchaseDate: purchaseOrdersV2.purchaseDate,
        counterpartyId: purchaseOrdersV2.counterpartyId,
        totalAmount: purchaseOrdersV2.totalAmount,
        status: purchaseOrdersV2.status,
        cnt: sql<number>`COUNT(*)`,
        ids: sql<string>`GROUP_CONCAT(${purchaseOrdersV2.id} ORDER BY ${purchaseOrdersV2.id})`,
      }).from(purchaseOrdersV2)
        .where(and(
          eq(purchaseOrdersV2.restaurantId, input.restaurantId),
          gte(purchaseOrdersV2.purchaseDate, startDate),
          sql`${purchaseOrdersV2.purchaseDate} < ${nextMonthStart}`,
        ))
        .groupBy(
          purchaseOrdersV2.purchaseDate,
          purchaseOrdersV2.counterpartyId,
          purchaseOrdersV2.totalAmount,
          purchaseOrdersV2.status,
        )
        .having(sql`COUNT(*) >= 2`);

      // 거래처명 매핑
      const cpIds = [...new Set(dupes.map(d => d.counterpartyId).filter(Boolean))] as number[];
      let cpMap: Record<number, string> = {};
      if (cpIds.length > 0) {
        const cps = await db.select({ id: counterparties.id, name: counterparties.name })
          .from(counterparties)
          .where(sql`${counterparties.id} IN (${sql.join(cpIds.map(id => sql`${id}`), sql`, `)})`);
        cpMap = Object.fromEntries(cps.map(c => [c.id, c.name]));
      }

      return dupes.map(d => ({
        purchaseDate: d.purchaseDate,
        counterpartyId: d.counterpartyId,
        counterpartyName: d.counterpartyId ? cpMap[d.counterpartyId] ?? "알 수 없음" : "미지정",
        totalAmount: d.totalAmount,
        status: d.status,
        count: Number(d.cnt),
        ids: String(d.ids).split(",").map(Number),
      }));
    }),

  /** 중복 전표 삭제 (지정된 ID 삭제) — 매니저 이상 */
  deleteDuplicate: storeManagerProcedure
    .input(z.object({ orderId: z.number() }))
    .mutation(async ({ input }) => {
      // restaurantId 일치 검증
      const [existing] = await db
        .select({ id: purchaseOrdersV2.id })
        .from(purchaseOrdersV2)
        .where(and(
          eq(purchaseOrdersV2.id, input.orderId),
          eq(purchaseOrdersV2.restaurantId, input.restaurantId),
        ))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "전표를 찾을 수 없습니다" });
      }
      // 항목 먼저 삭제
      await db.delete(purchaseOrderItemsV2)
        .where(eq(purchaseOrderItemsV2.purchaseOrderId, input.orderId));
      // 전표 삭제
      await db.delete(purchaseOrdersV2)
        .where(eq(purchaseOrdersV2.id, input.orderId));
      return { ok: true };
    }),

  /** 월별 거래처별 매입 요약 (거래처별 합산 + 전표 목록 + 품목 상세) */
  monthlySummaryByCounterparty: storeReadProcedure
    .input(z.object({ year: z.number(), month: z.number() }))
    .query(async ({ input }) => {
      const mm = String(input.month).padStart(2, "0");
      const startDate = `${input.year}-${mm}-01`;
      const nextY = input.month === 12 ? input.year + 1 : input.year;
      const nextM = input.month === 12 ? 1 : input.month + 1;
      const nextMonthStart = `${nextY}-${String(nextM).padStart(2, "0")}-01`;

      // 1) 해당 월 전체 전표 + 품목 조인
      const rows = await db.execute(sql`
        SELECT
          o.id AS orderId,
          o.counterpartyId,
          c.name AS counterpartyName,
          c.counterpartyType,
          o.purchaseDate,
          o.status,
          o.totalAmount,
          o.note AS orderNote,
          oi.id AS itemRowId,
          oi.rawItemName,
          COALESCE(i.name, oi.rawItemName) AS itemName,
          oi.quantity,
          oi.unitName,
          oi.unitPrice,
          oi.lineTotal
        FROM purchase_orders_v2 o
        LEFT JOIN counterparties c ON o.counterpartyId = c.id
        LEFT JOIN purchase_order_items_v2 oi ON oi.purchaseOrderId = o.id
        LEFT JOIN items i ON oi.itemId = i.id
        WHERE o.restaurantId = ${input.restaurantId}
          AND o.purchaseDate >= ${startDate}
          AND o.purchaseDate < ${nextMonthStart}
        ORDER BY c.name, o.purchaseDate DESC, o.id, oi.id
      `);

      // 2) 거래처별 그룹핑
      type OrderEntry = {
        orderId: number;
        purchaseDate: string;
        status: string;
        totalAmount: number;
        note: string | null;
        items: { itemRowId: number; itemName: string; quantity: string | null; unitName: string | null; unitPrice: string | null; lineTotal: string | null }[];
      };
      type CpGroup = {
        counterpartyId: number | null;
        counterpartyName: string;
        counterpartyType: string | null;
        totalAmount: number;
        orderCount: number;
        orders: OrderEntry[];
      };

      const cpMap = new Map<string, CpGroup>();
      const orderMap = new Map<number, OrderEntry>();

      for (const row of (rows[0] as unknown as any[])) {
        const cpKey = row.counterpartyName || "미지정";

        if (!cpMap.has(cpKey)) {
          cpMap.set(cpKey, {
            counterpartyId: row.counterpartyId,
            counterpartyName: cpKey,
            counterpartyType: row.counterpartyType,
            totalAmount: 0,
            orderCount: 0,
            orders: [],
          });
        }
        const cpGroup = cpMap.get(cpKey)!;

        if (!orderMap.has(row.orderId)) {
          const order: OrderEntry = {
            orderId: row.orderId,
            purchaseDate: typeof row.purchaseDate === "string"
              ? row.purchaseDate.substring(0, 10)
              : new Date(row.purchaseDate).toISOString().substring(0, 10),
            status: row.status,
            totalAmount: Number(row.totalAmount || 0),
            note: row.orderNote,
            items: [],
          };
          orderMap.set(row.orderId, order);
          cpGroup.orders.push(order);
          cpGroup.totalAmount += order.totalAmount;
          cpGroup.orderCount += 1;
        }

        const orderEntry = orderMap.get(row.orderId)!;
        if (row.itemRowId) {
          orderEntry.items.push({
            itemRowId: row.itemRowId,
            itemName: row.itemName || row.rawItemName || "품목명 없음",
            quantity: row.quantity,
            unitName: row.unitName,
            unitPrice: row.unitPrice,
            lineTotal: row.lineTotal,
          });
        }
      }

      // 3) 금액순 정렬
      return Array.from(cpMap.values()).sort((a, b) => b.totalAmount - a.totalAmount);
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 발주 메모 API
  // ═══════════════════════════════════════════════════════════════════════════

  /** 발주 메모 생성 */
  createMemo: storeWriteProcedure
    .input(z.object({
      counterpartyId: z.number().optional(),
      counterpartyName: z.string().optional(),
      content: z.string().min(1),
      attachmentUrl: z.string().optional(),
      purchaseDate: z.string().optional(),
    }).refine(d => d.counterpartyId || d.counterpartyName, {
      message: "거래처 선택 또는 직접입력이 필요합니다",
    }))
    .mutation(async ({ input, ctx }) => {
      // 기본 날짜: 오늘 (KST)
      const kstDate = input.purchaseDate ?? new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      const [result] = await db.insert(purchaseOrdersV2).values({
        restaurantId: input.restaurantId,
        counterpartyId: input.counterpartyId ?? null,
        counterpartyName: input.counterpartyName ?? null,
        content: input.content,
        purchaseDate: kstDate,
        status: "memo",
        isReceived: false,
        totalAmount: "0",
        attachmentUrl: input.attachmentUrl ?? null,
        createdBy: ctx.user.userId,
      });
      return { id: result.insertId };
    }),

  /** 날짜별 발주 메모 조회 */
  listMemosByDate: storeReadProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          id: purchaseOrdersV2.id,
          counterpartyId: purchaseOrdersV2.counterpartyId,
          counterpartyNameDirect: purchaseOrdersV2.counterpartyName,
          counterpartyNameJoin: counterparties.name,
          content: purchaseOrdersV2.content,
          attachmentUrl: purchaseOrdersV2.attachmentUrl,
          isReceived: purchaseOrdersV2.isReceived,
          receivedAt: purchaseOrdersV2.receivedAt,
          createdBy: purchaseOrdersV2.createdBy,
          createdByName: users.name,
          createdAt: purchaseOrdersV2.createdAt,
        })
        .from(purchaseOrdersV2)
        .leftJoin(counterparties, eq(purchaseOrdersV2.counterpartyId, counterparties.id))
        .leftJoin(users, eq(purchaseOrdersV2.createdBy, users.id))
        .where(and(
          eq(purchaseOrdersV2.restaurantId, input.restaurantId),
          eq(purchaseOrdersV2.status, "memo"),
          sql`${purchaseOrdersV2.purchaseDate} = ${input.date}`,
        ))
        .orderBy(desc(purchaseOrdersV2.createdAt));

      return rows.map(r => ({
        id: r.id,
        counterpartyId: r.counterpartyId,
        counterpartyName: r.counterpartyNameJoin ?? r.counterpartyNameDirect ?? "미지정",
        content: r.content,
        attachmentUrl: r.attachmentUrl,
        isReceived: r.isReceived,
        receivedAt: r.receivedAt,
        createdBy: r.createdBy,
        createdByName: r.createdByName,
        createdAt: r.createdAt,
      }));
    }),

  /** 입고 확인 토글 */
  toggleReceived: storeWriteProcedure
    .input(z.object({ id: z.number(), isReceived: z.boolean() }))
    .mutation(async ({ input }) => {
      // restaurantId 일치 검증
      const [existing] = await db
        .select({ id: purchaseOrdersV2.id })
        .from(purchaseOrdersV2)
        .where(and(
          eq(purchaseOrdersV2.id, input.id),
          eq(purchaseOrdersV2.restaurantId, input.restaurantId),
        ))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "발주 메모를 찾을 수 없습니다" });
      }
      await db.update(purchaseOrdersV2)
        .set({
          isReceived: input.isReceived,
          receivedAt: input.isReceived ? new Date() : null,
        })
        .where(eq(purchaseOrdersV2.id, input.id));
      return { ok: true };
    }),

  /** 미입고 발주 메모 조회 (리마인더용) */
  listUnreceived: storeReadProcedure
    .query(async ({ input }) => {
      const kstToday = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      const rows = await db
        .select({
          id: purchaseOrdersV2.id,
          counterpartyId: purchaseOrdersV2.counterpartyId,
          counterpartyNameDirect: purchaseOrdersV2.counterpartyName,
          counterpartyNameJoin: counterparties.name,
          content: purchaseOrdersV2.content,
          purchaseDate: purchaseOrdersV2.purchaseDate,
          createdAt: purchaseOrdersV2.createdAt,
        })
        .from(purchaseOrdersV2)
        .leftJoin(counterparties, eq(purchaseOrdersV2.counterpartyId, counterparties.id))
        .where(and(
          eq(purchaseOrdersV2.restaurantId, input.restaurantId),
          eq(purchaseOrdersV2.status, "memo"),
          eq(purchaseOrdersV2.isReceived, false),
          sql`${purchaseOrdersV2.purchaseDate} < ${kstToday}`,
        ))
        .orderBy(desc(purchaseOrdersV2.purchaseDate));

      return rows.map(r => ({
        id: r.id,
        counterpartyName: r.counterpartyNameJoin ?? r.counterpartyNameDirect ?? "미지정",
        content: r.content,
        purchaseDate: r.purchaseDate,
        createdAt: r.createdAt,
      }));
    }),

  /** 미연결 품목 목록 — rawItemName 그룹핑 */
  listUnmatchedItems: storeManagerProcedure
    .query(async ({ input }) => {
      const rows = (await db.execute(sql`
        SELECT
          oi.rawItemName,
          COUNT(*) AS cnt,
          MAX(o.purchaseDate) AS lastPurchaseDate,
          SUBSTRING_INDEX(GROUP_CONCAT(oi.unitName ORDER BY o.purchaseDate DESC SEPARATOR 0x1f), 0x1f, 1) AS unitName,
          SUBSTRING_INDEX(GROUP_CONCAT(CAST(oi.unitPrice AS CHAR) ORDER BY o.purchaseDate DESC SEPARATOR 0x1f), 0x1f, 1) AS lastUnitPrice,
          MIN(c.id) AS counterpartyId,
          MIN(c.name) AS counterpartyName
        FROM purchase_order_items_v2 oi
        JOIN purchase_orders_v2 o ON oi.purchaseOrderId = o.id
        LEFT JOIN counterparties c ON o.counterpartyId = c.id
        WHERE o.restaurantId = ${input.restaurantId}
          AND oi.itemId IS NULL
          AND oi.rawItemName IS NOT NULL
          AND oi.rawItemName != ''
        GROUP BY oi.rawItemName
        ORDER BY cnt DESC, lastPurchaseDate DESC
      `))[0] as any[];
      return rows.map((r: any) => ({
        rawItemName: r.rawItemName as string,
        count: Number(r.cnt),
        lastPurchaseDate: r.lastPurchaseDate instanceof Date
          ? r.lastPurchaseDate.toISOString().split("T")[0]
          : String(r.lastPurchaseDate ?? ""),
        lastUnitPrice: r.lastUnitPrice != null ? Number(r.lastUnitPrice) : null,
        unitName: (r.unitName ?? null) as string | null,
        counterpartyId: r.counterpartyId != null ? Number(r.counterpartyId) : null,
        counterpartyName: (r.counterpartyName ?? null) as string | null,
      }));
    }),

  /** orphan 항목을 기존 품목에 연결 (rawItemName 기준 일괄) */
  relinkByName: storeManagerProcedure
    .input(z.object({
      rawItemName: z.string().min(1),
      itemId: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => {
      const rows = (await db.execute(sql`
        SELECT oi.id, oi.unitName, oi.unitPrice, o.counterpartyId, o.status
        FROM purchase_order_items_v2 oi
        JOIN purchase_orders_v2 o ON oi.purchaseOrderId = o.id
        WHERE o.restaurantId = ${input.restaurantId}
          AND oi.itemId IS NULL
          AND oi.rawItemName = ${input.rawItemName}
        ORDER BY o.purchaseDate DESC
      `))[0] as any[];

      if (rows.length === 0) return { updated: 0 };

      const ids = rows.map((r: any) => Number(r.id));
      await db.update(purchaseOrderItemsV2)
        .set({ itemId: input.itemId })
        .where(inArray(purchaseOrderItemsV2.id, ids));

      const seenCpIds = new Set<number>();
      for (const row of rows) {
        const cpId = row.counterpartyId != null ? Number(row.counterpartyId) : null;
        if (!cpId || row.status !== "received" || seenCpIds.has(cpId)) continue;
        seenCpIds.add(cpId);
        const existing = await db
          .select({ id: counterpartyItems.id })
          .from(counterpartyItems)
          .where(and(
            eq(counterpartyItems.restaurantId, input.restaurantId),
            eq(counterpartyItems.counterpartyId, cpId),
            eq(counterpartyItems.itemId, input.itemId),
          ))
          .limit(1);
        if (existing.length === 0) {
          await db.insert(counterpartyItems).values({
            restaurantId: input.restaurantId,
            counterpartyId: cpId,
            itemId: input.itemId,
            supplierItemName: input.rawItemName,
            purchaseUnit: row.unitName || null,
            lastPrice: row.unitPrice != null ? String(row.unitPrice) : null,
          });
        }
      }

      return { updated: ids.length };
    }),

  /** 신규 품목 생성 후 orphan 연결 */
  createItemAndRelinkByName: storeManagerProcedure
    .input(z.object({
      rawItemName: z.string().min(1),
      newItemName: z.string().min(1),
      itemType: z.enum(["product", "service", "misc"]).default("product"),
      costingCategory: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [result] = await db.insert(items).values({
        restaurantId: input.restaurantId,
        name: input.newItemName,
        itemType: input.itemType,
        costingCategory: input.costingCategory || null,
      }).$returningId();
      const newItemId = result.id;

      const rows = (await db.execute(sql`
        SELECT oi.id, oi.unitName, oi.unitPrice, o.counterpartyId, o.status
        FROM purchase_order_items_v2 oi
        JOIN purchase_orders_v2 o ON oi.purchaseOrderId = o.id
        WHERE o.restaurantId = ${input.restaurantId}
          AND oi.itemId IS NULL
          AND oi.rawItemName = ${input.rawItemName}
        ORDER BY o.purchaseDate DESC
      `))[0] as any[];

      if (rows.length > 0) {
        const ids = rows.map((r: any) => Number(r.id));
        await db.update(purchaseOrderItemsV2)
          .set({ itemId: newItemId })
          .where(inArray(purchaseOrderItemsV2.id, ids));

        const seenCpIds = new Set<number>();
        for (const row of rows) {
          const cpId = row.counterpartyId != null ? Number(row.counterpartyId) : null;
          if (!cpId || row.status !== "received" || seenCpIds.has(cpId)) continue;
          seenCpIds.add(cpId);
          const existing = await db
            .select({ id: counterpartyItems.id })
            .from(counterpartyItems)
            .where(and(
              eq(counterpartyItems.restaurantId, input.restaurantId),
              eq(counterpartyItems.counterpartyId, cpId),
              eq(counterpartyItems.itemId, newItemId),
            ))
            .limit(1);
          if (existing.length === 0) {
            await db.insert(counterpartyItems).values({
              restaurantId: input.restaurantId,
              counterpartyId: cpId,
              itemId: newItemId,
              supplierItemName: input.rawItemName,
              purchaseUnit: row.unitName || null,
              lastPrice: row.unitPrice != null ? String(row.unitPrice) : null,
            });
          }
        }
      }

      return { itemId: newItemId, updated: rows.length };
    }),
});
