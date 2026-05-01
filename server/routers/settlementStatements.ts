import { z } from "zod";
import { eq, and, sql, desc } from "drizzle-orm";
import { router, storeReadProcedure, storeManagerProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { db } from "../db";
import {
  settlementStatementAudits,
  counterparties,
  counterpartyItems,
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

  // counterparty_items는 (counterpartyId, itemId) 단위 alias.
  // 시스템 매입 항목과 (itemId == counterparty_items.itemId) 기준 leftJoin.
  // counterpartyId 조건은 above filter로 이미 보장됨.
  const rows = await db
    .select({
      purchaseOrderId: purchaseOrdersV2.id,
      itemRowId: purchaseOrderItemsV2.id,
      itemId: purchaseOrderItemsV2.itemId,
      rawPurchaseName: purchaseOrderItemsV2.rawItemName,
      masterItemName: items.name,
      supplierItemName: counterpartyItems.supplierItemName,
      quantity: purchaseOrderItemsV2.quantity,
      unitPrice: purchaseOrderItemsV2.unitPrice,
      lineTotal: purchaseOrderItemsV2.lineTotal,
      purchaseDate: purchaseOrdersV2.purchaseDate,
    })
    .from(purchaseOrderItemsV2)
    .innerJoin(purchaseOrdersV2, eq(purchaseOrderItemsV2.purchaseOrderId, purchaseOrdersV2.id))
    .leftJoin(items, eq(purchaseOrderItemsV2.itemId, items.id))
    .leftJoin(
      counterpartyItems,
      and(
        eq(counterpartyItems.itemId, purchaseOrderItemsV2.itemId),
        eq(counterpartyItems.counterpartyId, counterpartyId),
        eq(counterpartyItems.restaurantId, restaurantId)
      )
    )
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
    supplierItemName: r.supplierItemName ?? null,
    masterItemName: r.masterItemName ?? null,
    rawPurchaseName: r.rawPurchaseName ?? null,
    itemName: r.supplierItemName || r.masterItemName || r.rawPurchaseName || "",
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
   *
   * 처리 순서 (spec §3.2):
   *   1) link_alias 액션부터 처리 → counterparty_items 갱신/신규
   *   2) add/update/dismiss 액션 처리 → purchase_orders_v2 / purchase_order_items_v2 반영
   *   3) audit.status='applied', appliedActions 기록
   *   4) 영향받은 전표마다 editHistory에 "정산표 대조 적용" 항목 추가
   *
   * link_alias 정책 (spec §3.3):
   *   - (counterpartyId, itemId) 행이 있으면 supplierItemName 빈 값일 때만 갱신 (덮어쓰기 X)
   *   - 행이 없으면 신규 생성 (supplierItemName=rawItemName, purchaseUnit=spec)
   *   - 동일 supplierItemName이 다른 itemId에 매핑돼 있으면 충돌로 거부
   */
  applySelectedActions: storeManagerProcedure
    .input(
      z.object({
        auditId: z.number(),
        actions: z.array(
          z.object({
            type: z.enum(["link_alias", "add_to_system", "update_amount", "dismiss"]),
            // ocr 항목 (link_alias / add_to_system / update_amount 시 필수)
            ocrItem: parsedItemSchema.optional(),
            // 시스템 항목 식별 (update_amount 시 필수: purchase_order_items_v2.id)
            targetItemRowId: z.number().optional(),
            // 사용자가 선택한 마스터 품목 id (link_alias 시 필수: items.id)
            targetItemId: z.number().optional(),
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
      const restaurantId = ctx.restaurantId;
      const userId = ctx.user.userId;
      const userName = ctx.user.username || String(userId);
      const appliedLog: any[] = [];
      const affectedOrderIds = new Set<number>();

      // 트랜잭션: drizzle MySQL 어댑터 호환을 위해 raw mysql2 conn 사용 (BEGIN/COMMIT)
      const mysql2 = await import("mysql2/promise");
      const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
      try {
        await conn.beginTransaction();

        // ── 1차 패스: link_alias 액션부터 처리 (counterparty_items 갱신/신규) ──
        for (const action of input.actions) {
          if (action.type !== "link_alias") continue;

          if (!action.ocrItem || !action.targetItemId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "link_alias는 ocrItem과 targetItemId가 필요합니다" });
          }
          const rawName = (action.ocrItem.rawItemName || action.ocrItem.itemName || "").trim();
          if (!rawName) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "link_alias: rawItemName이 비어있습니다" });
          }

          // 충돌 검증: 같은 (restaurantId, counterpartyId)에서 동일 supplierItemName이 다른 itemId에 이미 매핑돼 있는지
          const [conflictRows] = await conn.query(
            `SELECT id, itemId FROM counterparty_items
             WHERE restaurantId = ? AND counterpartyId = ? AND supplierItemName = ?
                   AND itemId != ? AND isActive = 1
             LIMIT 1`,
            [restaurantId, counterpartyId, rawName, action.targetItemId]
          );
          const conflictArr = conflictRows as any[];
          if (conflictArr.length > 0) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `'${rawName}'은(는) 이미 다른 품목과 연결되어 있습니다 (itemId=${conflictArr[0].itemId}). 기존 매핑을 먼저 정리해주세요.`,
            });
          }

          // 기존 (counterpartyId, targetItemId) 행 조회
          const [existingRows] = await conn.query(
            `SELECT id, supplierItemName FROM counterparty_items
             WHERE restaurantId = ? AND counterpartyId = ? AND itemId = ? AND isActive = 1
             LIMIT 1`,
            [restaurantId, counterpartyId, action.targetItemId]
          );
          const existingArr = existingRows as any[];

          if (existingArr.length > 0) {
            const existing = existingArr[0];
            if (!existing.supplierItemName) {
              // 빈 값일 때만 채움 (기존 값 덮어쓰기 금지)
              await conn.query(
                `UPDATE counterparty_items SET supplierItemName = ? WHERE id = ?`,
                [rawName, existing.id]
              );
              appliedLog.push({
                type: "link_alias",
                action: "updated",
                cpItemId: existing.id,
                itemId: action.targetItemId,
                supplierItemName: rawName,
                at: new Date().toISOString(),
              });
            } else {
              appliedLog.push({
                type: "link_alias",
                action: "skipped_existing",
                cpItemId: existing.id,
                itemId: action.targetItemId,
                existingSupplierItemName: existing.supplierItemName,
                at: new Date().toISOString(),
              });
            }
          } else {
            // 신규 행 생성
            const [insertRes] = await conn.query(
              `INSERT INTO counterparty_items
                (restaurantId, counterpartyId, itemId, supplierItemName, purchaseUnit, isPreferred, isActive)
               VALUES (?, ?, ?, ?, ?, 0, 1)`,
              [restaurantId, counterpartyId, action.targetItemId, rawName, action.ocrItem.spec ?? null]
            );
            appliedLog.push({
              type: "link_alias",
              action: "created",
              cpItemId: (insertRes as any).insertId,
              itemId: action.targetItemId,
              supplierItemName: rawName,
              at: new Date().toISOString(),
            });
          }
        }

        // ── 2차 패스: add/update/dismiss 액션 처리 ─────────────────────────
        for (const action of input.actions) {
          if (action.type === "link_alias") continue;

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
              `SELECT poi.id, poi.purchaseOrderId
               FROM purchase_order_items_v2 poi
               INNER JOIN purchase_orders_v2 po ON poi.purchaseOrderId = po.id
               WHERE poi.id = ? AND po.restaurantId = ? AND po.counterpartyId = ?`,
              [action.targetItemRowId, restaurantId, counterpartyId]
            );
            const verifyArr = verifyRows as any[];
            if (verifyArr.length === 0) {
              throw new TRPCError({ code: "FORBIDDEN", message: "해당 매입 항목에 접근할 수 없습니다" });
            }
            const parentOrderId: number = verifyArr[0].purchaseOrderId;

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
            await conn.query(
              `UPDATE purchase_orders_v2 SET totalAmount = (
                 SELECT COALESCE(SUM(lineTotal), 0) FROM purchase_order_items_v2 WHERE purchaseOrderId = ?
               ) WHERE id = ?`,
              [parentOrderId, parentOrderId]
            );
            affectedOrderIds.add(parentOrderId);

            appliedLog.push({
              type: "update_amount",
              itemRowId: action.targetItemRowId,
              orderId: parentOrderId,
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
              [restaurantId, counterpartyId, ocr.date]
            );
            let orderId: number | undefined = (existRows as any[])[0]?.id;
            if (!orderId) {
              const [insertRes] = await conn.query(
                `INSERT INTO purchase_orders_v2
                  (restaurantId, counterpartyId, purchaseDate, status, note, totalAmount, createdBy)
                 VALUES (?, ?, ?, 'received', '정산표 대조로 추가', '0', ?)`,
                [restaurantId, counterpartyId, ocr.date, userId]
              );
              orderId = (insertRes as any).insertId as number;
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
            affectedOrderIds.add(orderId);

            appliedLog.push({
              type: "add_to_system",
              orderId,
              ocrItem: ocr,
              at: new Date().toISOString(),
            });
          }
        }

        // ── 3차: audit 상태 업데이트 ───────────────────────────────────────
        await conn.query(
          `UPDATE settlement_statement_audits
           SET status = 'applied', appliedActions = ?, appliedAt = NOW(), reviewedAt = NOW()
           WHERE id = ?`,
          [JSON.stringify(appliedLog), input.auditId]
        );

        // ── 4차: 영향받은 전표마다 editHistory 적재 ──────────────────────
        if (affectedOrderIds.size > 0) {
          const at = new Date().toISOString();
          const summary = `정산표 대조 적용 (audit #${input.auditId})`;
          for (const orderId of affectedOrderIds) {
            const [oldRows] = await conn.query(
              `SELECT editHistory FROM purchase_orders_v2 WHERE id = ?`,
              [orderId]
            );
            const v = (oldRows as any[])[0]?.editHistory;
            const oldHistory: any[] = Array.isArray(v)
              ? v
              : (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);
            const newEntry = { userId, userName, at, summary };
            await conn.query(
              `UPDATE purchase_orders_v2
               SET editHistory = ?, lastModifiedBy = ?, lastModifiedAt = NOW()
               WHERE id = ?`,
              [JSON.stringify([...oldHistory, newEntry]), userId, orderId]
            );
          }
        }

        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        await conn.end();
      }

      return {
        ok: true,
        applied: appliedLog.length,
        affectedOrders: Array.from(affectedOrderIds),
        log: appliedLog,
      };
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
