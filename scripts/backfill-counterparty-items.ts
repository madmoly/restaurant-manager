/**
 * HF-1: counterparty_items 역생성
 *
 * 매입 이력(purchase_orders_v2 + purchase_order_items_v2)에서
 * 고유 (restaurantId, counterpartyId, itemId) 조합을 추출하여
 * counterparty_items 레코드를 생성.
 *
 * 실행: npx tsx scripts/backfill-counterparty-items.ts [--dry-run]
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const DRY_RUN = process.argv.includes("--dry-run");
const DB_URL =
  "mysql://root:aNrJhlVXGkYZZSEEEOxtflFrwjEimSqQ@caboose.proxy.rlwy.net:11909/railway";

async function main() {
  const conn = await mysql.createConnection(DB_URL);

  // 1) 현황 파악
  const [beforeStats] = (await conn.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN itemId IS NULL THEN 1 ELSE 0 END) AS nullCount
    FROM counterparty_items
  `)) as any[];
  console.log(
    `\n[현황] counterparty_items: ${beforeStats[0].total}건 (itemId NULL: ${beforeStats[0].nullCount})`,
  );

  // 2) 매입 이력에서 고유 (restaurantId, counterpartyId, itemId) 추출
  //    최신 가격·단위·rawItemName을 가져옴
  const [combos] = (await conn.query(`
    SELECT
      o.restaurantId,
      o.counterpartyId,
      oi.itemId,
      c.name AS cpName,
      i.name AS itemName,
      -- 최신 주문 기준 단가/단위/rawItemName
      (
        SELECT oi2.unitPrice
        FROM purchase_order_items_v2 oi2
        JOIN purchase_orders_v2 o2 ON oi2.purchaseOrderId = o2.id
        WHERE o2.restaurantId = o.restaurantId
          AND o2.counterpartyId = o.counterpartyId
          AND oi2.itemId = oi.itemId
        ORDER BY o2.purchaseDate DESC
        LIMIT 1
      ) AS lastPrice,
      (
        SELECT oi2.unitName
        FROM purchase_order_items_v2 oi2
        JOIN purchase_orders_v2 o2 ON oi2.purchaseOrderId = o2.id
        WHERE o2.restaurantId = o.restaurantId
          AND o2.counterpartyId = o.counterpartyId
          AND oi2.itemId = oi.itemId
        ORDER BY o2.purchaseDate DESC
        LIMIT 1
      ) AS purchaseUnit,
      (
        SELECT oi2.rawItemName
        FROM purchase_order_items_v2 oi2
        JOIN purchase_orders_v2 o2 ON oi2.purchaseOrderId = o2.id
        WHERE o2.restaurantId = o.restaurantId
          AND o2.counterpartyId = o.counterpartyId
          AND oi2.itemId = oi.itemId
        ORDER BY o2.purchaseDate DESC
        LIMIT 1
      ) AS supplierItemName,
      COUNT(*) AS orderCount
    FROM purchase_order_items_v2 oi
    JOIN purchase_orders_v2 o ON oi.purchaseOrderId = o.id
    LEFT JOIN counterparties c ON o.counterpartyId = c.id
    LEFT JOIN items i ON oi.itemId = i.id
    WHERE oi.itemId IS NOT NULL
      AND o.counterpartyId IS NOT NULL
    GROUP BY o.restaurantId, o.counterpartyId, oi.itemId
    ORDER BY o.restaurantId, c.name, i.name
  `)) as any[];

  console.log(`[2] 매입 이력 고유 조합: ${(combos as any[]).length}건`);

  // 3) 기존 counterparty_items와 비교 → 없는 것만 INSERT
  let created = 0;
  let skipped = 0;

  for (const combo of combos as any[]) {
    // 이미 존재하는지 확인
    const [existing] = (await conn.query(
      `SELECT id FROM counterparty_items
       WHERE restaurantId = ? AND counterpartyId = ? AND itemId = ?
       LIMIT 1`,
      [combo.restaurantId, combo.counterpartyId, combo.itemId],
    )) as any[];

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    console.log(
      `  ${DRY_RUN ? "[DRY]" : "[INSERT]"} R${combo.restaurantId} | ${combo.cpName} → ${combo.itemName} | ₩${combo.lastPrice} | ${combo.purchaseUnit} | ×${combo.orderCount}`,
    );

    if (!DRY_RUN) {
      await conn.query(
        `INSERT INTO counterparty_items
         (restaurantId, counterpartyId, itemId, supplierItemName, purchaseUnit, lastPrice, isActive, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, 1, NOW())`,
        [
          combo.restaurantId,
          combo.counterpartyId,
          combo.itemId,
          combo.supplierItemName || null,
          combo.purchaseUnit || null,
          combo.lastPrice || null,
        ],
      );
    }
    created++;
  }

  // 4) 결과 보고
  console.log(`\n[결과] ${DRY_RUN ? "(DRY RUN)" : ""}`);
  console.log(`  신규 생성: ${created}건`);
  console.log(`  기존 존재 (skip): ${skipped}건`);

  // 5) 사후 검증
  if (!DRY_RUN) {
    const [afterStats] = (await conn.query(`
      SELECT restaurantId, COUNT(*) AS cnt
      FROM counterparty_items
      WHERE isActive = 1
      GROUP BY restaurantId
    `)) as any[];
    console.log(`\n[사후] counterparty_items:`, afterStats);
  }

  await conn.end();
}

main().catch((e) => {
  console.error("실패:", e);
  process.exit(1);
});
