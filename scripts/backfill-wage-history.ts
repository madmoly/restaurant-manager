/**
 * Phase 1 — 급여이력 백필 (1회성)
 *
 * employee_contracts (isActive=true)의 현재 급여를 employee_wage_history로 이관.
 * effectiveFrom='2020-01-01', effectiveTo=NULL (열린 구간), sourceContractId=NULL (백필 표식).
 *
 * 기본은 DRY RUN. 실제 INSERT하려면:
 *   tsx scripts/backfill-wage-history.ts --apply
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");

const conn = await mysql.createConnection(process.env.DATABASE_URL!);

const [beforeRows] = (await conn.query(
  "SELECT COUNT(*) AS n FROM employee_wage_history",
)) as any;
console.log("BEFORE employee_wage_history count:", beforeRows[0].n);

const [candidates] = (await conn.query(`
  SELECT ec.userId, ec.restaurantId, ec.wageType, ec.wageAmount
    FROM employee_contracts ec
   WHERE ec.isActive = true
     AND NOT EXISTS (
       SELECT 1 FROM employee_wage_history wh
        WHERE wh.userId = ec.userId AND wh.restaurantId = ec.restaurantId
     )
`)) as any;

console.log(`CANDIDATES to insert: ${candidates.length}`);

if (candidates.length === 0) {
  console.log("백필할 대상 없음.");
  await conn.end();
  process.exit(0);
}

if (!APPLY) {
  console.log("\n=== DRY RUN (첫 10건 샘플) ===");
  console.table(candidates.slice(0, 10));
  console.log("\n실제 적용은 `--apply` 플래그와 함께 재실행.");
  await conn.end();
  process.exit(0);
}

const [result] = (await conn.query(`
  INSERT INTO employee_wage_history
    (userId, restaurantId, wageType, wageAmount, effectiveFrom, effectiveTo, sourceContractId)
  SELECT ec.userId, ec.restaurantId, ec.wageType, ec.wageAmount,
         '2020-01-01', NULL, NULL
    FROM employee_contracts ec
   WHERE ec.isActive = true
     AND NOT EXISTS (
       SELECT 1 FROM employee_wage_history wh
        WHERE wh.userId = ec.userId AND wh.restaurantId = ec.restaurantId
     )
`)) as any;

console.log("INSERTED rows:", result.affectedRows);

const [afterRows] = (await conn.query(
  "SELECT COUNT(*) AS n FROM employee_wage_history",
)) as any;
console.log("AFTER employee_wage_history count:", afterRows[0].n);

await conn.end();
