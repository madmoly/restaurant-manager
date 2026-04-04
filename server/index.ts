import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers/index";
import { createContext } from "./trpc";
import path from "path";
import fs from "fs";
import { uploadRouter, UPLOAD_ROOT, startCleanupScheduler } from "./upload";
import { ocrRouter } from "./ocr";
import { exportDatasetToGDrive, isGDriveConfigured } from "./gdrive";
import { runMigrations } from "./migration";
import { loginLimiter, ocrLimiter, errorReportLimiter } from "./rateLimit";

const app = express();
app.use(express.json());

// ─── 자동 마이그레이션: 신규 테이블/컬럼 ──────────────────────────────────────
runMigrations();

// ─── 에러 수집 REST 엔드포인트 (tRPC 의존 없음) ──────────────────────────────
app.post("/api/error-report", errorReportLimiter, async (req, res) => {
  try {
    const { errors } = req.body as { errors: Array<{
      errorType?: string; message: string; stack?: string; url?: string; metadata?: any;
    }> };
    if (!Array.isArray(errors) || errors.length === 0) return res.json({ ok: true });

    const mysql2 = await import("mysql2/promise");
    const conn = await mysql2.createConnection(process.env.DATABASE_URL!);

    try {
      // 쿠키에서 userId 추출 시도
      let userId: number | null = null;
      try {
        const { parse: parseCookie } = await import("cookie");
        const { verifyToken } = await import("./auth");
        const cookies = parseCookie(req.headers.cookie || "");
        const token = cookies["session"];
        if (token) {
          const payload = await verifyToken(token);
          userId = payload?.userId ?? null;
        }
      } catch {}

      const userAgent = req.headers["user-agent"]?.slice(0, 500);

      for (const err of errors.slice(0, 20)) {
        await conn.query(
          `INSERT INTO error_logs (userId, errorType, message, stack, url, userAgent, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            (err.errorType || "client").slice(0, 50),
            (err.message || "unknown").slice(0, 2000),
            err.stack?.slice(0, 5000) || null,
            err.url?.slice(0, 500) || null,
            userAgent || null,
            err.metadata ? JSON.stringify(err.metadata) : null,
          ]
        );
      }
      res.json({ ok: true });
    } finally {
      await conn.end();
    }
  } catch (e: any) {
    console.error("[error-report]", e.message);
    res.json({ ok: false });
  }
});

// ─── 파일 업로드 라우터 + 정적 서빙 ──────────────────────────────────────────
app.use("/api/upload", uploadRouter);
app.use("/api/ocr", ocrLimiter, ocrRouter);
app.use("/uploads", express.static(UPLOAD_ROOT));

// ─── 계약서 이메일 발송 ─────────────────────────────────────────────────────
app.post("/api/contract/send-email", async (req, res) => {
  try {
    const { token, email } = req.body;
    if (!token || !email) return res.status(400).json({ ok: false, message: "token과 email이 필요합니다" });

    // 계약서 조회
    const mysql2 = await import("mysql2/promise");
    const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
    const [rows] = await conn.query(
      "SELECT id, employeeName, affiliatedCompany, status FROM employment_electronic_contracts WHERE token = ? LIMIT 1",
      [token]
    ) as any[];
    await conn.end();

    if (!rows.length) return res.status(404).json({ ok: false, message: "계약서를 찾을 수 없습니다" });
    const contract = rows[0];

    // 계약서 URL 생성
    const baseUrl = process.env.BASE_URL || `https://${req.get("host")}`;
    const contractUrl = `${baseUrl}/sign/${token}`;

    // nodemailer로 발송
    let nodemailer: any;
    try {
      nodemailer = await import("nodemailer");
    } catch (importErr: any) {
      console.error("[contract-email] nodemailer import failed:", importErr.message);
      return res.status(500).json({ ok: false, message: "이메일 모듈 로드 실패. 서버 로그를 확인하세요." });
    }
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (!smtpUser || !smtpPass) {
      return res.status(500).json({ ok: false, message: "이메일 설정(SMTP)이 되어있지 않습니다. 관리자에게 문의하세요." });
    }

    const nm = nodemailer.default || nodemailer;
    const transporter = nm.createTransport({
      service: "gmail",
      auth: { user: smtpUser, pass: smtpPass },
    });

    const statusText = contract.status === "signed" ? "서명 완료된" : "";
    const subject = `[근로계약서] ${contract.employeeName || "직원"}님의 ${statusText}근로계약서`;
    const html = `
      <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #111827; font-size: 18px;">근로계약서</h2>
        <p style="color: #4b5563; font-size: 14px; line-height: 1.6;">
          ${contract.affiliatedCompany ? `<strong>${contract.affiliatedCompany}</strong>의 ` : ""}
          <strong>${contract.employeeName || "직원"}</strong>님의 근로계약서입니다.
        </p>
        <p style="color: #4b5563; font-size: 14px; line-height: 1.6;">
          아래 버튼을 클릭하여 계약서를 확인하실 수 있습니다.
        </p>
        <div style="margin: 24px 0;">
          <a href="${contractUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
            계약서 확인하기
          </a>
        </div>
        <p style="color: #9ca3af; font-size: 12px;">
          이 이메일은 331매장관리 시스템에서 자동 발송되었습니다.
        </p>
      </div>
    `;

    await transporter.sendMail({
      from: `331매장관리 <${smtpUser}>`,
      to: email,
      subject,
      html,
    });

    res.json({ ok: true });
  } catch (e: any) {
    console.error("[contract-email] error:", e.message, e.stack);
    console.error("[contract-email] SMTP_USER set:", !!process.env.SMTP_USER, "SMTP_PASS set:", !!process.env.SMTP_PASS);
    res.status(500).json({ ok: false, message: "이메일 발송에 실패했습니다: " + e.message });
  }
});

// ─── 체크리스트 사진 2주 자동삭제 스케줄러 ───────────────────────────────────
startCleanupScheduler();

// ─── 보건증 만료 자동 알림 스케줄러 (매일 09:00 체크) ─────────────────────────
(async () => {
  const checkHealthCerts = async () => {
    try {
      const mysql2 = await import("mysql2/promise");
      const conn = await mysql2.createConnection(process.env.DATABASE_URL!);

      // 30일 이내 만료 예정 사용자 조회 (이미 알림 보낸 건 제외 - 7일에 1회)
      const [rows] = await conn.query(`
        SELECT u.id, u.name, u.healthCertExpiry, ru.restaurantId
        FROM users u
        JOIN restaurant_users ru ON ru.userId = u.id
        WHERE u.healthCertExpiry IS NOT NULL
          AND u.healthCertExpiry <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
          AND u.healthCertExpiry >= CURDATE()
          AND u.isActive = TRUE
          AND NOT EXISTS (
            SELECT 1 FROM notifications n
            WHERE n.recipientId = u.id
              AND n.type = 'health_cert_expiry'
              AND n.createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
          )
      `) as any[];

      for (const row of rows) {
        const daysLeft = Math.ceil((new Date(row.healthCertExpiry).getTime() - Date.now()) / 86400000);
        const title = daysLeft <= 0
          ? `보건증이 만료되었습니다`
          : `보건증 만료 ${daysLeft}일 전`;
        const content = `${row.name}님의 보건증이 ${row.healthCertExpiry}에 만료됩니다. 갱신이 필요합니다.`;

        // 본인에게 알림
        await conn.query(
          `INSERT INTO notifications (recipientId, type, title, content, restaurantId) VALUES (?, 'health_cert_expiry', ?, ?, ?)`,
          [row.id, title, content, row.restaurantId]
        );

        // 매장 매니저/점장에게도 알림
        const [managers] = await conn.query(`
          SELECT ru2.userId FROM restaurant_users ru2
          WHERE ru2.restaurantId = ? AND ru2.role IN ('owner', 'supervisor', 'store_manager', 'manager') AND ru2.userId != ?
        `, [row.restaurantId, row.id]) as any[];

        for (const mgr of managers) {
          await conn.query(
            `INSERT INTO notifications (recipientId, type, title, content, restaurantId) VALUES (?, 'health_cert_expiry', ?, ?, ?)`,
            [mgr.userId, `${row.name} 보건증 만료 ${daysLeft}일 전`, content, row.restaurantId]
          );
        }
      }

      // admin에게도 전체 만료 요약 (만료 임박자 있을 때만)
      if (rows.length > 0) {
        const [admins] = await conn.query(`SELECT id FROM users WHERE role IN ('master','admin') AND isActive = TRUE`) as any[];
        const summary = rows.map((r: any) => r.name).slice(0, 5).join(', ');
        for (const admin of admins) {
          // 오늘 이미 보낸 건 스킵
          const [existing] = await conn.query(`
            SELECT 1 FROM notifications WHERE recipientId = ? AND type = 'health_cert_expiry' AND createdAt >= CURDATE() LIMIT 1
          `, [admin.id]) as any[];
          if (existing.length === 0) {
            await conn.query(
              `INSERT INTO notifications (recipientId, type, title, content) VALUES (?, 'health_cert_expiry', ?, ?)`,
              [admin.id, `보건증 만료 임박 ${rows.length}명`, `${summary} 등 ${rows.length}명의 보건증이 30일 이내 만료 예정입니다.`]
            );
          }
        }
      }

      await conn.end();
      if (rows.length > 0) console.log(`[health-cert] ${rows.length}명 만료 알림 발송`);
    } catch (e: any) {
      console.error("[health-cert] cron error:", e.message);
    }
  };

  // 서버 시작 시 1회 + 24시간마다 반복
  setTimeout(checkHealthCerts, 10000); // 서버 시작 10초 후
  setInterval(checkHealthCerts, 24 * 60 * 60 * 1000); // 매일
})();

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
      { username: "admin", name: "대표", role: "admin" },
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
      { restaurantId: 1, userId: findId("manager1"), role: "owner" },
      { restaurantId: 2, userId: findId("manager2"), role: "owner" },
      { restaurantId: 1, userId: findId("staff1"), role: "staff" },
      { restaurantId: 2, userId: findId("staff2"), role: "staff" },
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

// tRPC (로그인 Rate Limit)
app.use("/api/trpc/auth.login", loginLimiter);
app.use("/api/trpc/auth.register", loginLimiter);
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext: (opts) => createContext({ req: opts.req }) }));

// Production: serve static
if (process.env.NODE_ENV === "production") {
  const distPath = path.resolve(import.meta.dirname, "public");
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.use("*", (_req, res) => res.sendFile(path.resolve(distPath, "index.html")));
  }
}

// ─── DB 자동 백업 스케줄러 (24시간마다) ──────────────────────────────────────
(async () => {
  const runAutoBackup = async () => {
    const startTime = Date.now();
    try {
      const mysql2 = await import("mysql2/promise");
      const fsMod = await import("fs");
      const pathMod = await import("path");
      const conn = await mysql2.createConnection(process.env.DATABASE_URL!);

      const backupDir = pathMod.resolve("backups");
      if (!fsMod.existsSync(backupDir)) fsMod.mkdirSync(backupDir, { recursive: true });

      const now = new Date();
      const fileName = `auto_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.sql`;
      const filePath = pathMod.join(backupDir, fileName);

      const [tables] = await conn.query("SHOW TABLES") as any[];
      const tableNames = tables.map((t: any) => Object.values(t)[0] as string);

      let sqlContent = `-- Auto Backup: ${now.toISOString()}\n-- Tables: ${tableNames.length}\nSET FOREIGN_KEY_CHECKS = 0;\n\n`;
      for (const table of tableNames) {
        const [createResult] = await conn.query(`SHOW CREATE TABLE \`${table}\``) as any[];
        sqlContent += `DROP TABLE IF EXISTS \`${table}\`;\n${createResult[0]["Create Table"]};\n\n`;
        const [rows] = await conn.query(`SELECT * FROM \`${table}\``) as any[];
        if (rows.length > 0) {
          const cols = Object.keys(rows[0]);
          for (const row of rows) {
            const vals = cols.map((c: string) => {
              const v = row[c];
              if (v === null) return "NULL";
              if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace("T", " ")}'`;
              if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "\\'")}'`;
              return `'${String(v).replace(/'/g, "\\'")}'`;
            });
            sqlContent += `INSERT INTO \`${table}\` (${cols.map(c => `\`${c}\``).join(",")}) VALUES (${vals.join(",")});\n`;
          }
          sqlContent += "\n";
        }
      }
      sqlContent += "SET FOREIGN_KEY_CHECKS = 1;\n";

      fsMod.writeFileSync(filePath, sqlContent, "utf8");
      const fileSizeBytes = fsMod.statSync(filePath).size;
      const durationMs = Date.now() - startTime;
      await conn.end();

      // 백업 로그 기록 (raw SQL — drizzle import 안 쓰기 위해)
      const conn2 = await mysql2.createConnection(process.env.DATABASE_URL!);
      await conn2.query(
        `INSERT INTO db_backup_logs (fileName, fileSizeBytes, tableCount, status, durationMs) VALUES (?, ?, ?, 'success', ?)`,
        [fileName, fileSizeBytes, tableNames.length, durationMs]
      );

      // 오래된 백업 삭제 (30일)
      const [settingRows] = await conn2.query(`SELECT settingValue FROM system_settings WHERE settingKey = 'backup_retention_days'`) as any[];
      const retentionDays = parseInt(settingRows?.[0]?.settingValue ?? "30");
      const files = fsMod.readdirSync(backupDir).filter(f => f.endsWith(".sql")).sort();
      const cutoff = new Date(Date.now() - retentionDays * 86400000);
      for (const f of files) {
        const fPath = pathMod.join(backupDir, f);
        const stat = fsMod.statSync(fPath);
        if (stat.mtime < cutoff) {
          fsMod.unlinkSync(fPath);
          console.log(`[backup] deleted old backup: ${f}`);
        }
      }

      await conn2.end();
      console.log(`[backup] auto backup complete: ${fileName} (${(fileSizeBytes / 1024).toFixed(0)}KB, ${(durationMs / 1000).toFixed(1)}s)`);
    } catch (e: any) {
      console.error("[backup] auto backup failed:", e.message);
      try {
        const mysql2 = await import("mysql2/promise");
        const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
        await conn.query(
          `INSERT INTO db_backup_logs (fileName, status, errorMessage, durationMs) VALUES (?, 'failed', ?, ?)`,
          [`failed_auto_${new Date().toISOString()}`, e.message, Date.now() - startTime]
        );
        await conn.end();
      } catch {}
    }
  };

  // 서버 시작 30초 후 1회 + 24시간마다 반복
  setTimeout(runAutoBackup, 30000);
  setInterval(runAutoBackup, 24 * 60 * 60 * 1000);
})();

// ─── Google Drive 학습 데이터셋 자동 업로드 (일 1회) ─────────────────────────
(async () => {
  const runAutoDatasetExport = async () => {
    if (!isGDriveConfigured()) return;
    try {
      console.log("[GDrive] 자동 데이터셋 내보내기 시작...");
      const result = await exportDatasetToGDrive("daily_auto");
      if (result.success) {
        const totalRecords = result.files.reduce((sum, f) => sum + f.records, 0);
        console.log(`[GDrive] 자동 내보내기 완료: ${result.files.length}개 파일, ${totalRecords}건`);
      } else {
        console.error("[GDrive] 자동 내보내기 실패:", result.error);
      }
    } catch (e: any) {
      console.error("[GDrive] 자동 내보내기 에러:", e.message);
    }
  };

  // 서버 시작 60초 후 1회 + 24시간마다 반복
  setTimeout(runAutoDatasetExport, 60000);
  setInterval(runAutoDatasetExport, 24 * 60 * 60 * 1000);
})();

const port = parseInt(process.env.PORT || "3000");
app.listen(port, "0.0.0.0", () => console.log(`Server running on http://localhost:${port}/`));
