/**
 * P0-1: purchase_order_items_v2.itemId NULL 레코드 역매핑
 *
 * rawItemName → items.name fuzzy match로 itemId 연결
 * score ≥ 0.7 → 자동 UPDATE
 * score < 0.7 → 로그 출력 (수동 확인용)
 *
 * 실행: npx tsx scripts/backfill-item-ids.ts [--dry-run]
 */
import "dotenv/config";
import mysql from "mysql2/promise";

// ─── fuzzyScore / normalizeKorean (server/ocr.ts에서 복사) ──────────────────
function normalizeKorean(s: string): string {
  return s
    .replace(/\s+/g, "")
    .replace(/[()（）\[\]]/g, "")
    .toLowerCase();
}

function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function fuzzyScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return shorter / longer;
  }
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / maxLen;
}

// ─── Main ───────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  // 1) 현황 파악
  const [beforeStats] = (await conn.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN itemId IS NULL THEN 1 ELSE 0 END) AS nullCount
    FROM purchase_order_items_v2
  `)) as any[];
  const total = Number(beforeStats[0].total);
  const nullBefore = Number(beforeStats[0].nullCount);
  console.log(
    `\n[현황] 전체: ${total}, itemId NULL: ${nullBefore} (${((nullBefore / total) * 100).toFixed(1)}%)`,
  );

  if (nullBefore === 0) {
    console.log("NULL 레코드 없음. 종료.");
    await conn.end();
    return;
  }

  // 2) NULL 레코드 + restaurantId 조회
  const [nullRows] = (await conn.query(`
    SELECT
      oi.id,
      oi.rawItemName,
      o.restaurantId
    FROM purchase_order_items_v2 oi
    JOIN purchase_orders_v2 o ON oi.purchaseOrderId = o.id
    WHERE oi.itemId IS NULL
      AND oi.rawItemName IS NOT NULL
      AND oi.rawItemName != ''
  `)) as any[];

  // 3) 매장별 items 마스터 캐시
  const restaurantIds = [...new Set((nullRows as any[]).map((r) => r.restaurantId))];
  const itemsByRestaurant = new Map<number, { id: number; name: string; norm: string }[]>();

  for (const rid of restaurantIds) {
    const [rows] = (await conn.query(
      `SELECT id, name FROM items WHERE restaurantId = ? AND isActive = 1`,
      [rid],
    )) as any[];
    itemsByRestaurant.set(
      rid,
      (rows as any[]).map((r) => ({
        id: r.id,
        name: r.name,
        norm: normalizeKorean(r.name),
      })),
    );
  }

  // 4) fuzzy match + UPDATE
  let matched = 0;
  let unmatched = 0;
  const unmatchedLog: { id: number; rawItemName: string; bestScore: number; bestMatch: string }[] = [];

  for (const row of nullRows as any[]) {
    const rawNorm = normalizeKorean(row.rawItemName);
    const candidates = itemsByRestaurant.get(row.restaurantId) || [];

    let bestScore = 0;
    let bestItem: { id: number; name: string } | null = null;

    for (const item of candidates) {
      const score = fuzzyScore(rawNorm, item.norm);
      if (score > bestScore) {
        bestScore = score;
        bestItem = item;
      }
    }

    if (bestScore >= 0.7 && bestItem) {
      if (!DRY_RUN) {
        await conn.query(
          `UPDATE purchase_order_items_v2 SET itemId = ? WHERE id = ?`,
          [bestItem.id, row.id],
        );
      }
      matched++;
    } else {
      unmatched++;
      unmatchedLog.push({
        id: row.id,
        rawItemName: row.rawItemName,
        bestScore: Math.round(bestScore * 100) / 100,
        bestMatch: bestItem?.name || "(없음)",
      });
    }
  }

  // 5) 결과 보고
  console.log(`\n[결과] ${DRY_RUN ? "(DRY RUN)" : ""}`);
  console.log(`  매칭 성공 (≥0.7): ${matched}`);
  console.log(`  매칭 실패 (<0.7): ${unmatched}`);

  if (unmatchedLog.length > 0) {
    console.log(`\n[미매칭 상위 50건]`);
    unmatchedLog
      .sort((a, b) => b.bestScore - a.bestScore)
      .slice(0, 50)
      .forEach((r) => {
        console.log(
          `  id=${r.id} "${r.rawItemName}" → best: "${r.bestMatch}" (${r.bestScore})`,
        );
      });
  }

  // 6) 사후 검증
  if (!DRY_RUN) {
    const [afterStats] = (await conn.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN itemId IS NULL THEN 1 ELSE 0 END) AS nullCount
      FROM purchase_order_items_v2
    `)) as any[];
    const nullAfter = Number(afterStats[0].nullCount);
    const totalAfter = Number(afterStats[0].total);
    console.log(
      `\n[사후] itemId NULL: ${nullAfter}/${totalAfter} (${((nullAfter / totalAfter) * 100).toFixed(1)}%)`,
    );
    if (nullAfter / totalAfter <= 0.1) {
      console.log("✓ 목표 달성 (≤10%)");
    } else {
      console.log("⚠ 목표 미달 (>10%) — 수동 매핑 필요");
    }
  }

  await conn.end();
}

main().catch((e) => {
  console.error("실패:", e);
  process.exit(1);
});
