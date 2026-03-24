import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers/index";
import { createContext } from "./trpc";
import path from "path";
import fs from "fs";
import { uploadRouter, UPLOAD_ROOT, startCleanupScheduler } from "./upload";
import { ocrRouter } from "./ocr";

const app = express();
app.use(express.json());

// ─── 자동 마이그레이션: 신규 테이블 생성 ──────────────────────────────────────
(async () => {
  try {
    const mysql2 = await import("mysql2/promise");
    const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS leave_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        restaurantId INT NOT NULL,
        leaveDate DATE NOT NULL,
        leaveType ENUM('dayoff','half_morning','half_evening') NOT NULL DEFAULT 'dayoff',
        reason TEXT,
        status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
        reviewedBy INT,
        reviewNote TEXT,
        reviewedAt TIMESTAMP NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_leave_user (userId, restaurantId),
        INDEX idx_leave_date (leaveDate, restaurantId)
      )
    `);
    // users 테이블에 보건증 컬럼 추가
    await conn.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS healthCertUrl VARCHAR(500) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS healthCertExpiry DATE DEFAULT NULL
    `).catch(() => {}); // 이미 존재하면 무시

    // restaurant_users에 소속회사 컬럼 추가
    await conn.query(`
      ALTER TABLE restaurant_users
        ADD COLUMN IF NOT EXISTS affiliatedCompany VARCHAR(100) DEFAULT NULL
    `).catch(() => {}); // 이미 존재하면 무시

    // employment_electronic_contracts에 소속회사 컬럼 추가
    await conn.query(`
      ALTER TABLE employment_electronic_contracts
        ADD COLUMN IF NOT EXISTS affiliatedCompany VARCHAR(100) DEFAULT NULL
    `).catch(() => {}); // 이미 존재하면 무시

    await conn.end();
    console.log("[migrate] leave_requests + healthCert + affiliatedCompany ensured");
  } catch (e: any) {
    console.error("[migrate] error:", e.message);
  }
})();

// ─── 파일 업로드 라우터 + 정적 서빙 ──────────────────────────────────────────
app.use("/api/upload", uploadRouter);
app.use("/api/ocr", ocrRouter);
app.use("/uploads", express.static(UPLOAD_ROOT));

// ─── 체크리스트 사진 2주 자동삭제 스케줄러 ───────────────────────────────────
startCleanupScheduler();

// ─── DB 초기화 (1회용) ────────────────────────────────────────────────────────
app.get("/api/init", async (_req, res) => {
  try {
    const mysql2 = await import("mysql2/promise");
    const bcrypt = await import("bcryptjs");
    const conn = await mysql2.createConnection(process.env.DATABASE_URL!);

    // 1. 기존 테이블 제거
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    await conn.query(`DROP TABLE IF EXISTS
      daily_closings, daily_closing_sales_types,
      fixed_costs, purchase_order_items, purchase_orders, counterparties,
      sales, restaurant_users, restaurants, users`);
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");

    // 2. Phase 0 테이블
    await conn.query(`
      CREATE TABLE users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        passwordHash VARCHAR(255) NOT NULL,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(320),
        phone VARCHAR(30),
        role ENUM('admin','user') NOT NULL DEFAULT 'user',
        authProvider VARCHAR(20) DEFAULT 'local',
        authProviderId VARCHAR(255),
        isActive BOOLEAN NOT NULL DEFAULT TRUE,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        lastSignedIn TIMESTAMP NULL
      )
    `);

    await conn.query(`
      CREATE TABLE restaurants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        address VARCHAR(255),
        phone VARCHAR(30),
        monthlyTargetSales DECIMAL(14,2) DEFAULT 0,
        targetLaborRatio DECIMAL(5,2) DEFAULT 30,
        targetCostRatio DECIMAL(5,2) DEFAULT 80,
        openTime VARCHAR(5) DEFAULT '09:00',
        closeTime VARCHAR(5) DEFAULT '22:00',
        isActive BOOLEAN NOT NULL DEFAULT TRUE,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE restaurant_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        userId INT NOT NULL,
        role ENUM('manager','sub_manager','employee') NOT NULL DEFAULT 'employee',
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_rest_user (restaurantId, userId)
      )
    `);

    await conn.query(`
      CREATE TABLE sales (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        saleDate DATE NOT NULL,
        amount DECIMAL(14,2) NOT NULL,
        note TEXT,
        source VARCHAR(50) DEFAULT 'manual',
        recordedBy INT,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // 3. Phase 1 테이블
    await conn.query(`
      CREATE TABLE counterparties (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        counterpartyType ENUM('supplier','online','mart','repair','other') NOT NULL DEFAULT 'supplier',
        contactName VARCHAR(50),
        contactPhone VARCHAR(30),
        note TEXT,
        isActive BOOLEAN NOT NULL DEFAULT TRUE,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_counterparties_rest (restaurantId)
      )
    `);

    await conn.query(`
      CREATE TABLE purchase_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        counterpartyId INT,
        purchaseDate DATE NOT NULL,
        totalAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
        note TEXT,
        createdBy INT NOT NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_po_rest_date (restaurantId, purchaseDate)
      )
    `);

    await conn.query(`
      CREATE TABLE purchase_order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        purchaseOrderId INT NOT NULL,
        itemName VARCHAR(100) NOT NULL,
        quantity DECIMAL(10,2),
        unitName VARCHAR(30),
        unitPrice DECIMAL(14,2),
        lineTotal DECIMAL(14,2) NOT NULL,
        category VARCHAR(50) DEFAULT '식재료',
        note TEXT,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_poi_order (purchaseOrderId)
      )
    `);

    await conn.query(`
      CREATE TABLE fixed_costs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        costName VARCHAR(100) NOT NULL,
        costType ENUM('monthly','yearly','one_time') NOT NULL DEFAULT 'monthly',
        amount DECIMAL(14,2) NOT NULL,
        effectiveMonth VARCHAR(7),
        note TEXT,
        isActive BOOLEAN NOT NULL DEFAULT TRUE,
        createdBy INT,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_fc_rest (restaurantId)
      )
    `);

    await conn.query(`
      CREATE TABLE daily_closing_sales_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        typeName VARCHAR(50) NOT NULL,
        sortOrder INT NOT NULL DEFAULT 0,
        isActive BOOLEAN NOT NULL DEFAULT TRUE,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_dcst_rest (restaurantId)
      )
    `);

    await conn.query(`
      CREATE TABLE daily_closings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        closingDate DATE NOT NULL,
        salesTotal DECIMAL(14,2) NOT NULL DEFAULT 0,
        purchasesTotal DECIMAL(14,2) NOT NULL DEFAULT 0,
        laborCost DECIMAL(14,2) NOT NULL DEFAULT 0,
        fixedCostShare DECIMAL(14,2) NOT NULL DEFAULT 0,
        profit DECIMAL(14,2) NOT NULL DEFAULT 0,
        salesBreakdown JSON,
        note TEXT,
        closedBy INT,
        closedAt TIMESTAMP NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_dc_rest_date (restaurantId, closingDate)
      )
    `);

    // 4. 시드 데이터
    const pw = await bcrypt.hash("1111", 10);

    const seedUsers = [
      { username: "admin", name: "관리자", role: "admin" },
      { username: "manager1", name: "박점장", role: "user" },
      { username: "manager2", name: "이점장", role: "user" },
      { username: "staff1", name: "김직원", role: "user" },
      { username: "staff2", name: "이직원", role: "user" },
    ];

    for (const u of seedUsers) {
      await conn.query(
        "INSERT INTO users (username, passwordHash, name, role) VALUES (?, ?, ?, ?)",
        [u.username, pw, u.name, u.role]
      );
    }

    await conn.query(
      "INSERT INTO restaurants (id, name, address, phone, monthlyTargetSales) VALUES (1, ?, ?, ?, ?)",
      ["테스트 천호점", "서울 강동구 천호대로", "02-1234-5678", "50000000"]
    );
    await conn.query(
      "INSERT INTO restaurants (id, name, address, phone, monthlyTargetSales) VALUES (2, ?, ?, ?, ?)",
      ["테스트 강남점", "서울 강남구 테헤란로", "02-9876-5432", "80000000"]
    );

    const [users] = await conn.query("SELECT id, username FROM users") as any[];
    const findId = (un: string) => users.find((u: any) => u.username === un)?.id;

    const assignments = [
      { restaurantId: 1, userId: findId("manager1"), role: "manager" },
      { restaurantId: 2, userId: findId("manager2"), role: "manager" },
      { restaurantId: 1, userId: findId("staff1"), role: "employee" },
      { restaurantId: 2, userId: findId("staff2"), role: "employee" },
    ];

    for (const a of assignments) {
      if (!a.userId) continue;
      await conn.query(
        "INSERT INTO restaurant_users (restaurantId, userId, role) VALUES (?, ?, ?)",
        [a.restaurantId, a.userId, a.role]
      );
    }

    // Phase 1 시드: 거래처 + 고정비 + 샘플 매입/매출
    const mgr1Id = findId("manager1");
    const mgr2Id = findId("manager2");

    // 거래처
    await conn.query("INSERT INTO counterparties (restaurantId, name, counterpartyType) VALUES (1, '한우농장', 'supplier'), (1, '쿠팡', 'online'), (1, '하나마트', 'mart')");
    await conn.query("INSERT INTO counterparties (restaurantId, name, counterpartyType) VALUES (2, '신선식품', 'supplier'), (2, '이마트', 'mart')");

    // 고정비
    await conn.query("INSERT INTO fixed_costs (restaurantId, costName, costType, amount, createdBy) VALUES (1, '임대료', 'monthly', 3000000, ?), (1, '관리비', 'monthly', 500000, ?), (1, '정수기', 'monthly', 50000, ?)", [mgr1Id, mgr1Id, mgr1Id]);
    await conn.query("INSERT INTO fixed_costs (restaurantId, costName, costType, amount, createdBy) VALUES (2, '임대료', 'monthly', 5000000, ?), (2, '관리비', 'monthly', 800000, ?)", [mgr2Id, mgr2Id]);

    // 샘플 매출 (이번 달)
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    for (let d = 1; d <= Math.min(now.getDate(), 20); d++) {
      const dateStr = `${ym}-${String(d).padStart(2, "0")}`;
      const amt1 = Math.round(1500000 + Math.random() * 1000000);
      const amt2 = Math.round(2000000 + Math.random() * 1500000);
      await conn.query("INSERT INTO sales (restaurantId, saleDate, amount, recordedBy) VALUES (1, ?, ?, ?), (2, ?, ?, ?)", [dateStr, amt1, mgr1Id, dateStr, amt2, mgr2Id]);
    }

    // 샘플 매입
    for (let d = 1; d <= Math.min(now.getDate(), 15); d += 3) {
      const dateStr = `${ym}-${String(d).padStart(2, "0")}`;
      const poAmt = Math.round(200000 + Math.random() * 300000);
      await conn.query("INSERT INTO purchase_orders (restaurantId, counterpartyId, purchaseDate, totalAmount, createdBy) VALUES (1, 1, ?, ?, ?)", [dateStr, poAmt, mgr1Id]);
    }

    const [finalUsers] = await conn.query("SELECT id, username, name, role FROM users");
    const [finalStores] = await conn.query("SELECT id, name FROM restaurants");
    const [finalAssign] = await conn.query("SELECT ru.restaurantId, u.username, ru.role FROM restaurant_users ru JOIN users u ON u.id = ru.userId");

    await conn.end();
    res.json({ ok: true, users: finalUsers, restaurants: finalStores, assignments: finalAssign });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// tRPC
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext: (opts) => createContext({ req: opts.req }) }));

// Production: serve static
if (process.env.NODE_ENV === "production") {
  const distPath = path.resolve(import.meta.dirname, "public");
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.use("*", (_req, res) => res.sendFile(path.resolve(distPath, "index.html")));
  }
}

const port = parseInt(process.env.PORT || "3000");
app.listen(port, "0.0.0.0", () => console.log(`Server running on http://localhost:${port}/`));
