import { z } from "zod";
import { eq, and, sql, desc } from "drizzle-orm";
import { router, storeReadProcedure, storeManagerProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { db } from "../db";
import {
  settlementStatementAudits,
  counterparties,
  purchaseOrdersV2,
  purchaseOrderItemsV2,
  items,
} from "../../drizzle/schema";
import {
  compareWithSystem,
  summarizeComparison,
  type ParsedItem,
  type SystemPurchaseItem,
  type ComparisonResult,
} from "../helpers/settlementCompare";

// ─── 입력 스키마 ─────────────────────────────────────────────────────────────
const parsedItemSchema = z.object({
  date: z.string(),
  rawItemName: z.string(),
  itemName: z.string(),
  spec: z.string().nullable().optional(),
  quantity: z.number().nullable().optional(),
  unitPrice: z.number().nullable().optional(),
  lineTotal: z.number(),
  taxType: z.enum(["taxable", "exempt", "unknown"]).default("unknown"),
  uncertain: z.boolean().default(false),
  confidence: z.number().default(0.8),
});

const monthlySummarySchema = z.object({
  salesTotal: z.number().nullable().optional(),
  paymentTotal: z.number().nullable().optional(),
  balance: z.number().nullable().optional(),
});

// ─── 시스템 매입 항목 조회 (한 달치 + 거래처 + lineTotal) ──────────────────
async function loadSystemPurchases(
  restaurantId: number,
  counterpartyId: number,
  yearMonth: string
): Promise<SystemPurchaseItem[]> {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (!year || !month) return [];

  const startDate = `${yearStr}-${monthStr.padStart(2, "0")}-01`;
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  const nextMonthStart = `${nextY}-${String(nextM).padStart(2, "0")}-01`;

  const rows = await db
    .select({
      purchaseOrderId: purchaseOrdersV2.id,
      itemRowId: purchaseOrderItemsV2.id,
      itemId: purchaseOrderItemsV2.itemId,
      rawItemName: purchaseOrderItemsV2.rawItemName,
      masterItemName: items.name,
      quantity: purchaseOrderItemsV2.quantity,
      unitPrice: purchaseOrderItemsV2.unitPrice,
      lineTotal: purchaseOrderItemsV2.lineTotal,
      purchaseDate: purchaseOrdersV2.purchaseDate,
    })
    .from(purchaseOrderItemsV2)
    .innerJoin(purchaseOrdersV2, eq(purchaseOrderItemsV2.purchaseOrderId, purchaseOrdersV2.id))
    .leftJoin(items, eq(purchaseOrderItemsV2.itemId, items.id))
    .where(
      and(
        eq(purchaseOrdersV2.restaurantId, restaurantId),
        eq(purchaseOrdersV2.counterpartyId, counterpartyId),
        sql`${purchaseOrdersV2.purchaseDate} >= ${startDate}`,
        sql`${purchaseOrdersV2.purchaseDate} < ${nextMonthStart}`
      )
    );

  return rows.map((r) => ({
    purchaseOrderId: r.purchaseOrderId,
    itemRowId: r.itemRowId,
    itemId: r.itemId,
    itemName: r.rawItemName || r.masterItemName || "",
    quantity: r.quantity != null ? Number(r.quantity) : null,
    unitPrice: r.unitPrice != null ? Number(r.unitPrice) : null,
    lineTotal: Number(r.lineTotal) || 0,
    date: typeof r.purchaseDate === "string"
      ? r.purchaseDate
      : (r.purchaseDate instanceof Date ? r.purchaseDate.toISOString().slice(0, 10) : ""),
  }));
}

// ─── 거래처 정산 기준 조회 ───────────────────────────────────────────────────
async function loadCounterpartyForCompare(counterpartyId: number) {
  const [cp] = await db
    .select({
      id: counterparties.id,
      name: counterparties.name,
      settlementBasis: counterparties.settlementBasis,
      settlementMatchTolerance: counterparties.settlementMatchTolerance,
    })
    .from(counterparties)
    .where(eq(counterparties.id, counterpartyId))
    .limit(1);
  return cp || null;
}

export const settlementStatementsRouter = router({
  /**
   * 1. compareAndSave (managerProcedure)
   * 클라이언트가 OCR로 추출한 정산표 결과를 받아 시스템 매입과 비교 + audit 저장.
   * 입력: 이미 OCR로 파싱된 결과 (extract-statement 응답 그대로)
   * 출력: { audit, comparison }
   */
  compareAndSave: storeManagerProcedure
    .input(
      z.object({
        counterpartyId: z.number(),
        yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
        imageUrl: z.string().optional(),
        ocrRawData: z.any(),
        items: z.array(parsedItemSchema),
        monthlySummary: monthlySummarySchema,
        counterpartyNameRaw: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const cp = await loadCounterpartyForCompare(input.counterpartyId);
      if (!cp) {
        throw new TRPCError({ code: "NOT_FOUND", message: "거래처를 찾을 수 없습니다" });
      }

      // ParsedItem 배열로 정규화 (zod로 검증된 input.items)
      const ocrItems: ParsedItem[] = input.items.map((it) => ({
        date: it.date,
        rawItemName: it.rawItemName,
        itemName: it.itemName,
        spec: it.spec ?? null,
        quantity: it.quantity ?? null,
        unitPrice: it.unitPrice ?? null,
        lineTotal: it.lineTotal,
        taxType: it.taxType,
        uncertain: it.uncertain,
        confidence: it.confidence,
      }));

      const systemItems = await loadSystemPurchases(
        ctx.restaurantId,
        input.counterpartyId,
        input.yearMonth
      );

      const comparison = compareWithSystem(
        ocrItems,
        systemItems,
        {
          settlementBasis: cp.settlementBasis,
          settlementMatchTolerance: cp.settlementMatchTolerance,
        },
        input.monthlySummary
      );

      // audit 저장
      const [insertResult] = await db.insert(settlementStatementAudits).values({
        restaurantId: ctx.restaurantId,
        counterpartyId: input.counterpartyId,
        counterpartyNameRaw: input.counterpartyNameRaw ?? null,
        yearMonth: input.yearMonth,
        imageUrl: input.imageUrl ?? null,
        ocrRawData: input.ocrRawData ?? {},
        parsedItems: ocrItems as any,
        ocrTotal: String(comparison.monthly.ocr),
        systemTotal: String(comparison.monthly.system),
        diffSummary: summarizeComparison(comparison) as any,
        status: "pending",
        createdBy: ctx.user.userId,
      }).$returningId();

      return {
        auditId: insertResult.id,
        comparison,
        counterparty: {
          id: cp.id,
          name: cp.name,
          settlementBasis: cp.settlementBasis,
          settlementMatchTolerance: cp.settlementMatchTolerance,
        },
      };
    }),

  /**
   * 2. listAudits — 매장+월별 대조 이력 조회
   */
  listAudits: storeReadProcedure
    .input(z.object({ yearMonth: z.string().regex(/^\d{4}-\d{2}$/).optional() }))
    .query(async ({ ctx, input }) => {
      const where = input.yearMonth
        ? and(
            eq(settlementStatementAudits.restaurantId, ctx.restaurantId),
            eq(settlementStatementAudits.yearMonth, input.yearMonth)
          )
        : eq(settlementStatementAudits.restaurantId, ctx.restaurantId);

      return db
        .select({
          id: settlementStatementAudits.id,
          counterpartyId: settlementStatementAudits.counterpartyId,
          counterpartyNameRaw: settlementStatementAudits.counterpartyNameRaw,
          yearMonth: settlementStatementAudits.yearMonth,
          imageUrl: settlementStatementAudits.imageUrl,
          ocrTotal: settlementStatementAudits.ocrTotal,
          systemTotal: settlementStatementAudits.systemTotal,
          diffSummary: settlementStatementAudits.diffSummary,
          status: settlementStatementAudits.status,
          createdBy: settlementStatementAudits.createdBy,
          createdAt: settlementStatementAudits.createdAt,
          appliedAt: settlementStatementAudits.appliedAt,
        })
        .from(settlementStatementAudits)
        .where(where)
        .orderBy(desc(settlementStatementAudits.createdAt));
    }),

  /**
   * 3. getAudit — 단일 대조 이력 조회 + 비교 결과 재계산
   */
  getAudit: storeReadProcedure
    .input(z.object({ auditId: z.number() }))
    .query(async ({ ctx, input }) => {
      const [audit] = await db
        .select()
        .from(settlementStatementAudits)
        .where(
          and(
            eq(settlementStatementAudits.id, input.auditId),
            eq(settlementStatementAudits.restaurantId, ctx.restaurantId)
          )
        )
        .limit(1);
      if (!audit) {
        throw new TRPCError({ code: "NOT_FOUND", message: "대조 이력을 찾을 수 없습니다" });
      }

      let comparison: ComparisonResult | null = null;
      if (audit.counterpartyId && Array.isArray(audit.parsedItems)) {
        const cp = await loadCounterpartyForCompare(audit.counterpartyId);
        if (cp) {
          const systemItems = await loadSystemPurchases(
            ctx.restaurantId,
            audit.counterpartyId,
            audit.yearMonth
          );
          const monthlySummary = (audit.ocrRawData as any)?.monthlySummary ?? {};
          comparison = compareWithSystem(
            audit.parsedItems as ParsedItem[],
            systemItems,
            {
              settlementBasis: cp.settlementBasis,
              settlementMatchTolerance: cp.settlementMatchTolerance,
            },
            monthlySummary
          );
        }
      }

      return { audit, comparison };
    }),

  /**
   * 4. applySelectedActions — 사용자 선택 액션 일괄 적용 (트랜잭션)
   * 처리:
   *   - add_to_system: 시스템에 매입 추가 (같은 일자+거래처 전표 있으면 항목만, 없으면 새 전표)
   *   - update_amount: 기존 항목 lineTotal/unitPrice/quantity 수정
   *   - dismiss: 무시 (액션 로그만)
   * audit.status='applied', appliedActions 기록
   */
  applySelectedActions: storeManagerProcedure
    .input(
      z.object({
        auditId: z.number(),
        actions: z.array(
          z.object({
            type: z.enum(["add_to_system", "update_amount", "dismiss"]),
            // ocr 항목 (add_to_system, update_amount 시 필수)
            ocrItem: parsedItemSchema.optional(),
            // 시스템 항목 식별 (update_amount 시 필수)
            targetItemRowId: z.number().optional(),
            // dismiss 메모
            note: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [audit] = await db
        .select()
        .from(settlementStatementAudits)
        .where(
          and(
            eq(settlementStatementAudits.id, input.auditId),
            eq(settlementStatementAudits.restaurantId, ctx.restaurantId)
          )
        )
        .limit(1);
      if (!audit) {
        throw new TRPCError({ code: "NOT_FOUND", message: "대조 이력을 찾을 수 없습니다" });
      }
      if (!audit.counterpartyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "거래처가 매칭되지 않은 audit은 적용할 수 없습니다" });
      }

      const counterpartyId = audit.counterpartyId;
      const appliedLog: any[] = [];

      // 트랜잭션: db.transaction은 drizzle MySQL 어댑터에 따라 다름.
      // 여기선 raw mysql2 conn으로 BEGIN/COMMIT 사용.
      const mysql2 = await import("mysql2/promise");
      const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
      try {
        await conn.beginTransaction();

        for (const action of input.actions) {
          if (action.type === "dismiss") {
            appliedLog.push({ type: "dismiss", note: action.note ?? null, at: new Date().toISOString() });
            continue;
          }

          if (action.type === "update_amount") {
            if (!action.targetItemRowId || !action.ocrItem) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "update_amount는 targetItemRowId와 ocrItem 필요" });
            }
            // 해당 itemRow가 이 매장+거래처에 속하는지 검증
            const [verifyRows] = await conn.query(
              `SELECT poi.id FROM purchase_order_items_v2 poi
               INNER JOIN purchase_orders_v2 po ON poi.purchaseOrderId = po.id
               WHERE poi.id = ? AND po.restaurantId = ? AND po.counterpartyId = ?`,
              [action.targetItemRowId, ctx.restaurantId, counterpartyId]
            ) as any[];
            if ((verifyRows as any[]).length === 0) {
              throw new TRPCError({ code: "FORBIDDEN", message: "해당 매입 항목에 접근할 수 없습니다" });
            }

            const newLineTotal = action.ocrItem.lineTotal;
            const newUnitPrice = action.ocrItem.unitPrice;
            const newQuantity = action.ocrItem.quantity;

            await conn.query(
              `UPDATE purchase_order_items_v2 SET lineTotal = ?, unitPrice = ?, quantity = ? WHERE id = ?`,
              [
                String(newLineTotal),
                newUnitPrice != null ? String(newUnitPrice) : null,
                newQuantity != null ? String(newQuantity) : null,
                action.targetItemRowId,
              ]
            );

            // 부모 전표 totalAmount 재계산
            const [orderRow] = await conn.query(
              `SELECT purchaseOrderId FROM purchase_order_items_v2 WHERE id = ?`,
              [action.targetItemRowId]
            ) as any[];
            const parentOrderId = (orderRow as any[])[0]?.purchaseOrderId;
            if (parentOrderId) {
              await conn.query(
                `UPDATE purchase_orders_v2 SET totalAmount = (
                   SELECT COALESCE(SUM(lineTotal), 0) FROM purchase_order_items_v2 WHERE purchaseOrderId = ?
                 ) WHERE id = ?`,
                [parentOrderId, parentOrderId]
              );
            }

            appliedLog.push({
              type: "update_amount",
              itemRowId: action.targetItemRowId,
              newLineTotal,
              ocrItem: action.ocrItem,
              at: new Date().toISOString(),
            });
            continue;
          }

          if (action.type === "add_to_system") {
            if (!action.ocrItem) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "add_to_system은 ocrItem 필요" });
            }
            const ocr = action.ocrItem;
            // 같은 일자+거래처 전표가 있으면 그 전표에 항목만 추가, 없으면 새 전표 생성
            const [existRows] = await conn.query(
              `SELECT id FROM purchase_orders_v2
               WHERE restaurantId = ? AND counterpartyId = ? AND DATE(purchaseDate) = ?
               ORDER BY id ASC LIMIT 1`,
              [ctx.restaurantId, counterpartyId, ocr.date]
            ) as any[];
            let orderId = (existRows as any[])[0]?.id;
            if (!orderId) {
              const [insertRes] = await conn.query(
                `INSERT INTO purchase_orders_v2
                  (restaurantId, counterpartyId, purchaseDate, status, note, totalAmount, createdBy)
                 VALUES (?, ?, ?, 'received', '정산표 대조로 추가', '0', ?)`,
                [ctx.restaurantId, counterpartyId, ocr.date, ctx.user.userId]
              ) as any;
              orderId = insertRes.insertId;
            }

            await conn.query(
              `INSERT INTO purchase_order_items_v2
                (purchaseOrderId, rawItemName, itemType, quantity, unitPrice, lineTotal, note)
               VALUES (?, ?, 'product', ?, ?, ?, '정산표 대조로 추가')`,
              [
                orderId,
                ocr.itemName || ocr.rawItemName,
                ocr.quantity != null ? String(ocr.quantity) : null,
                ocr.unitPrice != null ? String(ocr.unitPrice) : null,
                String(ocr.lineTotal),
              ]
            );

            // 부모 전표 totalAmount 재계산
            await conn.query(
              `UPDATE purchase_orders_v2 SET totalAmount = (
                 SELECT COALESCE(SUM(lineTotal), 0) FROM purchase_order_items_v2 WHERE purchaseOrderId = ?
               ) WHERE id = ?`,
              [orderId, orderId]
            );

            appliedLog.push({
              type: "add_to_system",
              orderId,
              ocrItem: ocr,
              at: new Date().toISOString(),
            });
          }
        }

        // audit 상태 업데이트
        await conn.query(
          `UPDATE settlement_statement_audits
           SET status = 'applied', appliedActions = ?, appliedAt = NOW(), reviewedAt = NOW()
           WHERE id = ?`,
          [JSON.stringify(appliedLog), input.auditId]
        );

        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        await conn.end();
      }

      return { ok: true, applied: appliedLog.length, log: appliedLog };
    }),

  /**
   * 5. dismissAudit — 무시 처리
   */
  dismissAudit: storeManagerProcedure
    .input(z.object({ auditId: z.number(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [audit] = await db
        .select({ id: settlementStatementAudits.id })
        .from(settlementStatementAudits)
        .where(
          and(
            eq(settlementStatementAudits.id, input.auditId),
            eq(settlementStatementAudits.restaurantId, ctx.restaurantId)
          )
        )
        .limit(1);
      if (!audit) {
        throw new TRPCError({ code: "NOT_FOUND", message: "대조 이력을 찾을 수 없습니다" });
      }

      await db
        .update(settlementStatementAudits)
        .set({
          status: "dismissed",
          reviewedAt: new Date(),
          appliedActions: input.reason ? [{ type: "dismiss", reason: input.reason, at: new Date().toISOString() }] : null,
        })
        .where(eq(settlementStatementAudits.id, input.auditId));

      return { ok: true };
    }),
});
