/**
 * scripts/normalize-legacy-roles.ts
 *
 * 일회성 데이터 정리 — 레거시 역할(manager/employee)을 정식 체계로 보정.
 *
 * Before:
 *   users.role ∈ {master, admin, user, manager(legacy), employee(legacy)}
 *   restaurant_users.role ∈ {owner, supervisor, staff, store_manager(legacy), manager(legacy), employee(legacy)}
 *
 * After:
 *   users.role ∈ {master, admin, user}
 *   restaurant_users.role ∈ {owner, supervisor, staff}
 *
 * 변환 규칙:
 *   users.role='manager' → 'user' + 해당 유저의 restaurant_users.role 갱신 시도 (supervisor)
 *   users.role='employee' → 'user' + 해당 유저의 restaurant_users.role 갱신 시도 (staff)
 *   restaurant_users.role='store_manager' → 'owner'
 *   restaurant_users.role='manager' → 'supervisor'
 *   restaurant_users.role='employee' → 'staff'
 *
 * 실행:
 *   DRY_RUN=1 tsx scripts/normalize-legacy-roles.ts   (건수만 출력)
 *   tsx scripts/normalize-legacy-roles.ts              (실제 적용)
 */
import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const dryRun = process.env.DRY_RUN === "1";
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  console.log(`[normalize-legacy-roles] start (dryRun=${dryRun})`);
  const changes: Record<string, number> = {};

  // ─── 1. restaurant_users.role 정규화 ───
  const [ruLegacy] = await conn.query<any[]>(
    `SELECT id, userId, restaurantId, role FROM restaurant_users WHERE role IN ('store_manager','manager','employee')`,
  );
  changes["ru.store_manager→owner"] = 0;
  changes["ru.manager→supervisor"] = 0;
  changes["ru.employee→staff"] = 0;
  for (const row of ruLegacy) {
    let target: string | null = null;
    if (row.role === "store_manager") { target = "owner"; changes["ru.store_manager→owner"]++; }
    else if (row.role === "manager") { target = "supervisor"; changes["ru.manager→supervisor"]++; }
    else if (row.role === "employee") { target = "staff"; changes["ru.employee→staff"]++; }
    if (target && !dryRun) {
      await conn.query(`UPDATE restaurant_users SET role = ? WHERE id = ?`, [target, row.id]);
    }
  }

  // ─── 2. users.role 정규화 ───
  const [userLegacy] = await conn.query<any[]>(
    `SELECT id, role, name FROM users WHERE role IN ('manager','employee')`,
  );
  changes["user.manager→user"] = 0;
  changes["user.employee→user"] = 0;
  for (const u of userLegacy) {
    if (u.role === "manager") changes["user.manager→user"]++;
    else if (u.role === "employee") changes["user.employee→user"]++;
    if (!dryRun) {
      await conn.query(`UPDATE users SET role = 'user' WHERE id = ?`, [u.id]);
    }
  }

  // ─── 3. 요약 ───
  console.log("\n=== Changes ===");
  for (const [k, v] of Object.entries(changes)) {
    console.log(`  ${k}: ${v}`);
  }

  if (!dryRun && Object.values(changes).some((v) => v > 0)) {
    // bulk audit 로그 (단일 레코드, details에 집계)
    await conn.query(
      `INSERT INTO audit_logs (userId, userName, action, target, details) VALUES (NULL, 'system', 'update', 'normalize_legacy_roles', ?)`,
      [JSON.stringify(changes)],
    );
    console.log("\n[audit] bulk audit log inserted");
  }

  await conn.end();
  console.log("[normalize-legacy-roles] done");
}

main().catch((e) => {
  console.error("[normalize-legacy-roles] error:", e);
  process.exit(1);
});
