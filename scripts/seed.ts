import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import * as schema from "../drizzle/schema";

const pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(pool, { schema, mode: "default" });

const pw = await bcrypt.hash("1111", 10);

console.log("Seeding...");

// ─── Users ────────────────────────────────────────────────────────────────
// master (시스템 최고 관리자)
await db.insert(schema.users).values({ username: "master", passwordHash: pw, name: "마스터", role: "master" })
  .onDuplicateKeyUpdate({ set: { passwordHash: pw, role: "master" } });

// admin (관리자)
await db.insert(schema.users).values({ username: "admin", passwordHash: pw, name: "관리자", role: "admin" })
  .onDuplicateKeyUpdate({ set: { passwordHash: pw, role: "admin" } });

// manager (기본 점장 — employee 시스템 역할, 매장에서 store_manager)
await db.insert(schema.users).values({ username: "manager1", passwordHash: pw, name: "박점장", role: "employee" })
  .onDuplicateKeyUpdate({ set: { passwordHash: pw } });
await db.insert(schema.users).values({ username: "manager2", passwordHash: pw, name: "이점장", role: "employee" })
  .onDuplicateKeyUpdate({ set: { passwordHash: pw } });

// staff (직원)
await db.insert(schema.users).values({ username: "staff1", passwordHash: pw, name: "김직원", role: "employee" })
  .onDuplicateKeyUpdate({ set: { passwordHash: pw } });
await db.insert(schema.users).values({ username: "staff2", passwordHash: pw, name: "이직원", role: "employee" })
  .onDuplicateKeyUpdate({ set: { passwordHash: pw } });

// ─── Restaurants ──────────────────────────────────────────────────────────
await db.insert(schema.restaurants).values({ name: "청계산뚝배기수제비 천호점", address: "서울 강동구 천호대로", phone: "02-1234-5678" })
  .onDuplicateKeyUpdate({ set: { name: "청계산뚝배기수제비 천호점" } });
await db.insert(schema.restaurants).values({ name: "청계산뚝배기수제비 강남점", address: "서울 강남구 테헤란로", phone: "02-9876-5432" })
  .onDuplicateKeyUpdate({ set: { name: "청계산뚝배기수제비 강남점" } });

// ─── Restaurant ↔ User 배정 ──────────────────────────────────────────────
// manager1 → 천호점 점장, manager2 → 강남점 점장
// staff1 → 천호점 직원, staff2 → 강남점 직원
// (ID는 seed 순서에 따라 user 1=master, 2=admin, 3=manager1, 4=manager2, 5=staff1, 6=staff2)
// (restaurant 1=천호점, 2=강남점)
await db.insert(schema.restaurantUsers).values({ restaurantId: 1, userId: 3, role: "store_manager" })
  .onDuplicateKeyUpdate({ set: { role: "store_manager" } });
await db.insert(schema.restaurantUsers).values({ restaurantId: 2, userId: 4, role: "store_manager" })
  .onDuplicateKeyUpdate({ set: { role: "store_manager" } });
await db.insert(schema.restaurantUsers).values({ restaurantId: 1, userId: 5, role: "employee" })
  .onDuplicateKeyUpdate({ set: { role: "employee" } });
await db.insert(schema.restaurantUsers).values({ restaurantId: 2, userId: 6, role: "employee" })
  .onDuplicateKeyUpdate({ set: { role: "employee" } });

console.log("✅ Seed complete");
console.log("   master/1111 (마스터), admin/1111 (관리자)");
console.log("   manager1/1111 (천호점 점장), manager2/1111 (강남점 점장)");
console.log("   staff1/1111 (천호점 직원), staff2/1111 (강남점 직원)");

await pool.end();
process.exit(0);
