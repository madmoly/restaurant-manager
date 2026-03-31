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

const app = express();
app.use(express.json());

// ─── 자동 마이그레이션: 신규 테이블/컬럼 ──────────────────────────────────────
(async () => {
  try {
    const mysql2 = await import("mysql2/promise");
    const conn = await mysql2.createConnection(process.env.DATABASE_URL!);

    // 헬퍼: 컬럼 존재 여부 확인 후 추가
    const addColumnIfNotExists = async (table: string, column: string, definition: string) => {
      const [rows] = await conn.query(
        `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
      ) as any[];
      if (rows[0].cnt === 0) {
        await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
        console.log(`[migrate] added ${table}.${column}`);
      }
    };

    // leave_requests 테이블
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

    // error_logs 테이블 (에러 자동 수집)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS error_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT,
        restaurantId INT,
        errorType VARCHAR(50) NOT NULL DEFAULT 'client',
        message TEXT NOT NULL,
        stack TEXT,
        url VARCHAR(500),
        userAgent VARCHAR(500),
        metadata JSON,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_error_created (createdAt),
        INDEX idx_error_type (errorType)
      )
    `);

    // users.role ENUM 확장: 'user' → 'master','admin','manager','employee' 모두 포함
    try {
      await conn.query(`ALTER TABLE users MODIFY COLUMN role ENUM('master','admin','manager','employee','user') NOT NULL DEFAULT 'employee'`);
      console.log("[migrate] users.role ENUM updated");
    } catch (e: any) {
      if (!e.message.includes("Duplicate")) console.log("[migrate] role ENUM:", e.message);
    }

    // users 테이블 컬럼 추가
    await addColumnIfNotExists("users", "healthCertUrl", "VARCHAR(500) DEFAULT NULL");
    await addColumnIfNotExists("users", "healthCertExpiry", "DATE DEFAULT NULL");

    // restaurant_users 소속회사
    await addColumnIfNotExists("restaurant_users", "affiliatedCompany", "VARCHAR(100) DEFAULT NULL");
    await addColumnIfNotExists("restaurant_users", "hireDate", "DATE DEFAULT NULL");
    await addColumnIfNotExists("restaurant_users", "resignedAt", "DATE DEFAULT NULL");
    await addColumnIfNotExists("restaurant_users", "resignReason", "VARCHAR(200) DEFAULT NULL");
    await addColumnIfNotExists("employee_contracts", "weeklyOffDays", "INT DEFAULT 1");

    // employment_electronic_contracts 소속회사 + 사업자등록번호 + 근무장소 주소
    await addColumnIfNotExists("employment_electronic_contracts", "affiliatedCompany", "VARCHAR(100) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "employerBusinessNumber", "VARCHAR(20) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "workPlaceAddress", "VARCHAR(300) DEFAULT NULL");
    // 포괄임금 구성항목
    await addColumnIfNotExists("employment_electronic_contracts", "annualSalary", "DECIMAL(14,2) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "basePay", "DECIMAL(12,2) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "fixedOvertimeHours", "DECIMAL(6,2) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "fixedOvertimePay", "DECIMAL(12,2) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "fixedHolidayHours", "DECIMAL(6,2) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "fixedHolidayPay", "DECIMAL(12,2) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "annualLeavePay", "DECIMAL(12,2) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "hourlyWage", "DECIMAL(10,2) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "monthlyContractHours", "DECIMAL(6,2) DEFAULT NULL");

    // 계좌이체 입금자명
    await addColumnIfNotExists("daily_sales_detail", "transferDepositor", "VARCHAR(100) DEFAULT NULL");

    // 중간매출 영수건수
    await addColumnIfNotExists("intermediate_sales", "receiptCount", "INT DEFAULT 0");

    // ─── 역할 체계 재정의: store_manager→owner, manager→supervisor, employee→staff ───
    try {
      await conn.query(`ALTER TABLE restaurant_users MODIFY COLUMN role ENUM('manager','sub_manager','employee','store_manager','owner','supervisor','staff') NOT NULL DEFAULT 'staff'`);
      // 기존 데이터 변환
      await conn.query(`UPDATE restaurant_users SET role = 'owner' WHERE role = 'store_manager'`);
      await conn.query(`UPDATE restaurant_users SET role = 'supervisor' WHERE role IN ('manager', 'sub_manager')`);
      await conn.query(`UPDATE restaurant_users SET role = 'staff' WHERE role = 'employee'`);
      console.log("[migrate] restaurant_users.role updated to new naming");
    } catch (e: any) {
      if (!e.message.includes("Duplicate")) console.log("[migrate] role rename:", e.message);
    }

    // 체크리스트 개편: 태그 + 반복/특정날짜 컬럼
    await addColumnIfNotExists("store_checklist_templates", "tags", "JSON DEFAULT NULL");
    await addColumnIfNotExists("store_checklist_templates", "repeatType", "ENUM('none','daily','weekly') DEFAULT 'none'");
    await addColumnIfNotExists("store_checklist_templates", "repeatDays", "JSON DEFAULT NULL");
    await addColumnIfNotExists("store_checklist_templates", "specificDate", "DATE DEFAULT NULL");
    await addColumnIfNotExists("store_checklist_templates", "isHighlight", "BOOLEAN DEFAULT FALSE");

    // repeatType enum 확장: monthly 추가 + none→daily 변환 + specificDate→monthly 변환
    try {
      await conn.query(`ALTER TABLE store_checklist_templates MODIFY COLUMN repeatType ENUM('none','daily','weekly','monthly') DEFAULT 'daily'`);
      // none → daily (의미 동일)
      await conn.query(`UPDATE store_checklist_templates SET repeatType = 'daily' WHERE repeatType = 'none' AND specificDate IS NULL`);
      // specificDate 있는 항목 → monthly (매월 해당 일자 반복으로 변환)
      await conn.query(`UPDATE store_checklist_templates SET repeatType = 'monthly', repeatDays = JSON_ARRAY(DAY(specificDate)) WHERE repeatType = 'none' AND specificDate IS NOT NULL`);
      console.log("[migrate] repeatType: none→daily, specificDate→monthly 변환 완료");
    } catch (e: any) {
      console.log("[migrate] repeatType enum 확장:", e.message);
    }

    // 체크리스트 로그: targetTab 컬럼 추가 + 기존 데이터 마이그레이션
    await addColumnIfNotExists("daily_checklist_logs", "targetTab", "VARCHAR(20) DEFAULT NULL");
    // 기존 checkType → targetTab 매핑 (한번만 실행됨: targetTab이 NULL인 행만)
    try {
      await conn.query(`
        UPDATE daily_checklist_logs SET targetTab = CASE
          WHEN checkType = 'open' THEN 'open'
          WHEN checkType = 'order' THEN 'purchase'
          WHEN checkType IN ('cleaning','hygiene','inventory','other') THEN 'close'
          ELSE 'open'
        END
        WHERE targetTab IS NULL
      `);
      console.log("[migrate] daily_checklist_logs.targetTab backfilled");
    } catch (e: any) {
      console.log("[migrate] targetTab backfill:", e.message);
    }

    // notifications type ENUM 확장 (health_cert_expiry 추가)
    try {
      await conn.query(`ALTER TABLE notifications MODIFY COLUMN type ENUM('schedule_change','cost_exceeded','target_achieved','general','schedule_assigned','schedule_updated','schedule_deleted','health_cert_expiry') NOT NULL`);
      console.log("[migrate] notifications.type ENUM updated");
    } catch (e: any) {
      if (!e.message.includes("Duplicate")) console.log("[migrate] notifications type:", e.message);
    }

    // 고정비: costType enum 확장 (quarterly, sales_ratio 추가) + attachmentUrl 컬럼
    try {
      await conn.query(`ALTER TABLE fixed_costs MODIFY COLUMN costType ENUM('monthly','yearly','one_time','quarterly','sales_ratio') NOT NULL DEFAULT 'monthly'`);
      console.log("[migrate] fixed_costs.costType enum 확장 완료");
    } catch (e: any) {
      console.log("[migrate] fixed_costs costType:", e.message);
    }
    await addColumnIfNotExists("fixed_costs", "attachmentUrl", "VARCHAR(500) DEFAULT NULL");

    // ─── Phase 4: 시스템 관리 테이블 ─────────────────────────────────────────
    // 감사 로그
    await conn.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT,
        userName VARCHAR(100),
        restaurantId INT,
        action VARCHAR(50) NOT NULL,
        target VARCHAR(50) NOT NULL,
        targetId INT,
        details JSON,
        ipAddress VARCHAR(45),
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_created (createdAt),
        INDEX idx_audit_user (userId),
        INDEX idx_audit_target (target, targetId)
      )
    `);

    // 시스템 설정
    await conn.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        settingKey VARCHAR(100) NOT NULL UNIQUE,
        settingValue TEXT,
        description VARCHAR(255),
        updatedBy INT,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 기본 설정값 삽입 (이미 있으면 무시)
    await conn.query(`
      INSERT IGNORE INTO system_settings (settingKey, settingValue, description) VALUES
      ('leave_min_days', '5', '휴무신청 최소 사전 일수'),
      ('ocr_model', 'claude-sonnet-4-20250514', 'OCR에 사용하는 Claude 모델'),
      ('default_latitude', '37.5665', '기본 위도 (서울)'),
      ('default_longitude', '126.9780', '기본 경도 (서울)'),
      ('backup_retention_days', '30', 'DB 백업 보관 일수'),
      ('backup_interval_hours', '24', 'DB 자동 백업 주기 (시간)')
    `);

    // API 사용량 로그
    await conn.query(`
      CREATE TABLE IF NOT EXISTS api_usage_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        apiType VARCHAR(50) NOT NULL,
        endpoint VARCHAR(255),
        userId INT,
        restaurantId INT,
        requestPayloadSize INT,
        responseTimeMs INT,
        success BOOLEAN NOT NULL DEFAULT TRUE,
        errorMessage TEXT,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_api_type (apiType),
        INDEX idx_api_created (createdAt)
      )
    `);

    // DB 백업 로그
    await conn.query(`
      CREATE TABLE IF NOT EXISTS db_backup_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        fileName VARCHAR(255) NOT NULL,
        fileSizeBytes INT,
        tableCount INT,
        status VARCHAR(20) NOT NULL DEFAULT 'success',
        errorMessage TEXT,
        durationMs INT,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_backup_created (createdAt)
      )
    `);

    // notifications type ENUM 확장 (system_announcement 추가)
    try {
      await conn.query(`ALTER TABLE notifications MODIFY COLUMN type ENUM('schedule_change','cost_exceeded','target_achieved','general','schedule_assigned','schedule_updated','schedule_deleted','health_cert_expiry','system_announcement') NOT NULL`);
      console.log("[migrate] notifications.type: system_announcement 추가");
    } catch (e: any) {
      if (!e.message.includes("Duplicate")) console.log("[migrate] notifications type:", e.message);
    }

    // ─── OCR 수정 데이터 축적 테이블 ─────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS counterparty_ocr_profiles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        counterpartyId INT NOT NULL,
        documentType VARCHAR(50),
        columnOrder VARCHAR(255),
        frequentItems JSON,
        sampleCount INT NOT NULL DEFAULT 0,
        lastUsedAt TIMESTAMP NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE INDEX idx_ocr_profile_cp (counterpartyId)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS ocr_corrections (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        counterpartyId INT,
        imageUrl TEXT NOT NULL,
        originalItems JSON,
        correctedItems JSON,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ocr_restaurant (restaurantId),
        INDEX idx_ocr_counterparty (counterpartyId)
      )
    `);

    // ─── Tutorial 플래그 ──────────────────────────────────────────────────────
    await addColumnIfNotExists("users", "isTutorial", "BOOLEAN NOT NULL DEFAULT FALSE");
    await addColumnIfNotExists("restaurants", "isTutorial", "BOOLEAN NOT NULL DEFAULT FALSE");

    // ─── 대표 기준 매장 소유권 + SUB대표 ─────────────────────────────────────
    await addColumnIfNotExists("restaurants", "ownerAdminId", "INT DEFAULT NULL");
    await addColumnIfNotExists("users", "parentId", "INT DEFAULT NULL");
    // 기존 실매장(isTutorial=false)에 ownerAdminId 미설정 시 기본 admin 배정
    await conn.query(`
      UPDATE restaurants SET ownerAdminId = (
        SELECT id FROM users WHERE role = 'admin' AND isTutorial = 0 ORDER BY id LIMIT 1
      ) WHERE isTutorial = 0 AND ownerAdminId IS NULL
    `).catch(() => {});

    // ─── 발주/입고 분할: receivedAt 컬럼 추가 ─────────────────────────────────
    await addColumnIfNotExists("purchase_orders_v2", "receivedAt", "TIMESTAMP DEFAULT NULL");
    // 기존 received 상태 주문 → receivedAt을 updatedAt으로 백필
    await conn.query(`
      UPDATE purchase_orders_v2 SET receivedAt = updatedAt
      WHERE status = 'received' AND receivedAt IS NULL
    `).catch(() => {});

    // ─── Phase 5: 초대코드 + 비밀번호 강제변경 ─────────────────────────────────
    // users.mustChangePassword
    await addColumnIfNotExists("users", "mustChangePassword", "BOOLEAN NOT NULL DEFAULT FALSE");

    // 매장 초대코드 테이블
    await conn.query(`
      CREATE TABLE IF NOT EXISTS restaurant_invites (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        code VARCHAR(20) NOT NULL UNIQUE,
        invite_role ENUM('staff','supervisor','owner') NOT NULL DEFAULT 'staff',
        createdBy INT NOT NULL,
        usedBy INT,
        usedAt TIMESTAMP NULL,
        expiresAt TIMESTAMP NOT NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_invite_code (code),
        INDEX idx_invite_restaurant (restaurantId)
      )
    `);

    // invite_role ENUM 확장 (owner 추가)
    try {
      await conn.query(`ALTER TABLE restaurant_invites MODIFY COLUMN invite_role ENUM('staff','supervisor','owner') NOT NULL DEFAULT 'staff'`);
    } catch (e: any) {
      if (!e.message.includes("Duplicate")) console.log("[migrate] invite_role enum:", e.message);
    }

    // ─── Phase 6: 대체휴무/연차 상세 이력 ─────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS leave_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        restaurantId INT NOT NULL,
        year INT NOT NULL,
        leave_tx_type ENUM('annual','substitute') NOT NULL,
        tx_type ENUM('earn','use') NOT NULL,
        days DECIMAL(5,1) NOT NULL DEFAULT 1,
        holidayDate DATE,
        holidayName VARCHAR(50),
        scheduleId INT,
        useDate DATE,
        note TEXT,
        createdBy INT,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_leave_tx_user (userId, restaurantId, year),
        INDEX idx_leave_tx_holiday (holidayDate)
      )
    `);

    // ─── 레시피 게시판 ───────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS recipes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        title VARCHAR(200) NOT NULL,
        category VARCHAR(50),
        imageUrl VARCHAR(500),
        content TEXT,
        sortOrder INT NOT NULL DEFAULT 0,
        isPublished BOOLEAN NOT NULL DEFAULT TRUE,
        createdBy INT NOT NULL,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_recipes_restaurant (restaurantId)
      )
    `);

    // ─── 매장 업무정보 카드 ─────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS store_info_cards (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        cardType VARCHAR(30) NOT NULL,
        title VARCHAR(200) NOT NULL,
        content TEXT,
        imageUrl VARCHAR(500),
        sortOrder INT NOT NULL DEFAULT 0,
        isPinned BOOLEAN NOT NULL DEFAULT FALSE,
        isPublished BOOLEAN NOT NULL DEFAULT TRUE,
        createdBy INT NOT NULL,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_info_cards_restaurant (restaurantId)
      )
    `);

    // ─── 사업그룹 (대표+매장+직원 최상위 조직 단위) ──────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS business_groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        adminId INT NOT NULL,
        description VARCHAR(500),
        isActive BOOLEAN NOT NULL DEFAULT TRUE,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_bg_admin (adminId)
      )
    `);
    // 기존 admin 중 business_groups 미등록 → 자동 백필 (이름 = admin.name + " 사업그룹")
    await conn.query(`
      INSERT INTO business_groups (name, adminId)
      SELECT CONCAT(u.name, ' 사업그룹'), u.id
      FROM users u
      WHERE u.role = 'admin' AND u.parentId IS NULL AND u.isTutorial = 0
        AND NOT EXISTS (SELECT 1 FROM business_groups bg WHERE bg.adminId = u.id)
    `).catch(() => {});

    // ─── 기존 admin 계정 username 변경: → 331admin ─────────────────────────────
    await conn.query(`
      UPDATE users SET username = '331admin'
      WHERE role = 'admin' AND isTutorial = 0 AND parentId IS NULL
        AND username != '331admin'
      ORDER BY id ASC LIMIT 1
    `).catch(() => {});

    // ─── Tutorial 데이터 강제 격리 ─────────────────────────────────────────────
    // 0) Tutorial 사용자/매장의 isTutorial 플래그 강제 설정 (시드 이후 누락 대응)
    await conn.query(`
      UPDATE users SET isTutorial = 1
      WHERE username IN ('owner1','supervisor1','staff1','staff2','tutorial_admin')
        AND isTutorial = 0
    `).catch(() => {});
    await conn.query(`
      UPDATE restaurants SET isTutorial = 1
      WHERE name LIKE 'Tutorial%' AND isTutorial = 0
    `).catch(() => {});

    // 1) Tutorial 전용 admin 생성 (없으면)
    await conn.query(`
      INSERT INTO users (username, passwordHash, name, role, isTutorial, isActive)
      SELECT 'tutorial_admin', '$2a$10$placeholder_hash_not_for_login', 'Tutorial', 'admin', 1, 0
      FROM dual
      WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'tutorial_admin')
    `).catch(() => {});

    // 2) Tutorial 사업그룹 생성 (없으면)
    await conn.query(`
      INSERT INTO business_groups (name, adminId, description, isActive)
      SELECT 'Tutorial', u.id, '튜토리얼 데이터 격리용 사업그룹 — 실 집계에서 자동 제외', 0
      FROM users u
      WHERE u.username = 'tutorial_admin'
        AND NOT EXISTS (SELECT 1 FROM business_groups bg WHERE bg.adminId = u.id)
    `).catch(() => {});

    // 3) Tutorial 매장 → tutorial_admin 소유로 배정
    await conn.query(`
      UPDATE restaurants
      SET ownerAdminId = (SELECT id FROM users WHERE username = 'tutorial_admin' LIMIT 1)
      WHERE isTutorial = 1 AND (ownerAdminId IS NULL OR ownerAdminId != (
        SELECT id FROM users WHERE username = 'tutorial_admin' LIMIT 1
      ))
    `).catch(() => {});

    // 4) Tutorial 유저 parentId → tutorial_admin (아직 미설정인 tutorial 유저)
    await conn.query(`
      UPDATE users
      SET parentId = (SELECT id FROM (SELECT id FROM users WHERE username = 'tutorial_admin') t)
      WHERE isTutorial = 1 AND role != 'admin' AND parentId IS NULL
    `).catch(() => {});

    // 4-b) Tutorial 유저 → Tutorial 매장 restaurant_users 배정 (점장/매니져/직원 종속)
    await conn.query(`
      INSERT INTO restaurant_users (restaurantId, userId, role)
      SELECT r.id, u.id,
        CASE u.username
          WHEN 'owner1' THEN 'owner'
          WHEN 'supervisor1' THEN 'supervisor'
          ELSE 'staff'
        END
      FROM users u
      CROSS JOIN restaurants r
      WHERE u.isTutorial = 1 AND u.role != 'admin'
        AND r.isTutorial = 1
        AND NOT EXISTS (
          SELECT 1 FROM restaurant_users ru WHERE ru.userId = u.id AND ru.restaurantId = r.id
        )
    `).catch(() => {});

    // 5-0) 사업자 그룹명 확정: 331컴퍼니 / Tutorial
    await conn.query(`
      UPDATE business_groups bg
      JOIN users u ON bg.adminId = u.id
      SET bg.name = '331컴퍼니'
      WHERE u.username = '331admin' AND bg.name != '331컴퍼니'
    `).catch(() => {});
    await conn.query(`
      UPDATE business_groups bg
      JOIN users u ON bg.adminId = u.id
      SET bg.name = 'Tutorial'
      WHERE u.username = 'tutorial_admin' AND bg.name != 'Tutorial'
    `).catch(() => {});

    // 5-a) schedules 테이블에 breakMinutes 컬럼 추가 (MySQL 8: IF NOT EXISTS 미지원)
    await conn.query(`
      ALTER TABLE schedules ADD COLUMN breakMinutes INT DEFAULT 0
    `).catch(() => {}); // 이미 존재하면 Duplicate column → 무시

    // 5) 기본 체크리스트 시드 — 매장별로 체크리스트가 없으면 기본 항목 등록
    try {
      const [restaurants] = await conn.query(`SELECT id FROM restaurants`) as any[];
      const defaultTemplates: { targetTab: string; checkType: string; itemText: string; sortOrder: number }[] = [
        // 오픈 체크리스트
        { targetTab: 'open', checkType: 'open', itemText: '매장 조명 및 간판 점등', sortOrder: 1 },
        { targetTab: 'open', checkType: 'open', itemText: '에어컨/난방 및 환기 시스템 가동', sortOrder: 2 },
        { targetTab: 'open', checkType: 'open', itemText: '홀 테이블/의자 정리 및 세팅', sortOrder: 3 },
        { targetTab: 'open', checkType: 'open', itemText: '화장실 청소 및 비품(휴지/비누) 확인', sortOrder: 4 },
        { targetTab: 'open', checkType: 'open', itemText: '식재료 유통기한 및 상태 확인', sortOrder: 5 },
        { targetTab: 'open', checkType: 'open', itemText: 'POS 시스템 정상 작동 확인', sortOrder: 6 },
        { targetTab: 'open', checkType: 'open', itemText: '전일 마감 사항 인수인계 확인', sortOrder: 7 },
        // 매입 체크리스트
        { targetTab: 'purchase', checkType: 'order', itemText: '금일 발주서/입고 예정 확인', sortOrder: 1 },
        { targetTab: 'purchase', checkType: 'order', itemText: '입고 식재료 수량 검수', sortOrder: 2 },
        { targetTab: 'purchase', checkType: 'order', itemText: '유통기한 및 신선도 확인', sortOrder: 3 },
        { targetTab: 'purchase', checkType: 'order', itemText: '냉장/냉동 보관 온도 확인', sortOrder: 4 },
        { targetTab: 'purchase', checkType: 'order', itemText: '전표/명세서 대조 및 보관', sortOrder: 5 },
        // 일간보고 체크리스트
        { targetTab: 'midday', checkType: 'other', itemText: '중간 매출 현황 기록', sortOrder: 1 },
        { targetTab: 'midday', checkType: 'other', itemText: '주요 식재료 재고 현황 확인', sortOrder: 2 },
        { targetTab: 'midday', checkType: 'other', itemText: '피크타임 인원 배치 확인', sortOrder: 3 },
        { targetTab: 'midday', checkType: 'other', itemText: '고객 클레임/특이사항 기록', sortOrder: 4 },
        // 마감 체크리스트
        { targetTab: 'close', checkType: 'cleaning', itemText: '당일 매출 정산 (현금/카드/이체 확인)', sortOrder: 1 },
        { targetTab: 'close', checkType: 'cleaning', itemText: '냉장/냉동고 온도 기록 확인', sortOrder: 2 },
        { targetTab: 'close', checkType: 'cleaning', itemText: '주방 청소 및 정리 완료', sortOrder: 3 },
        { targetTab: 'close', checkType: 'cleaning', itemText: '홀 청소 및 테이블 정리', sortOrder: 4 },
        { targetTab: 'close', checkType: 'cleaning', itemText: '쓰레기 분리수거 및 반출', sortOrder: 5 },
        { targetTab: 'close', checkType: 'cleaning', itemText: '가스 밸브 차단 확인', sortOrder: 6 },
        { targetTab: 'close', checkType: 'cleaning', itemText: '전기 점검 (불필요 기기 OFF)', sortOrder: 7 },
        { targetTab: 'close', checkType: 'cleaning', itemText: '문단속 및 보안 확인', sortOrder: 8 },
      ];

      for (const store of restaurants) {
        let added = 0;
        for (const t of defaultTemplates) {
          // 탭+항목명 기준 중복 체크 — isActive 무관, 존재하면 재생성 안 함
          const [dup] = await conn.query(
            `SELECT COUNT(*) as cnt FROM store_checklist_templates WHERE restaurantId = ? AND targetTab = ? AND itemText = ?`,
            [store.id, t.targetTab, t.itemText]
          ) as any[];
          if (dup[0].cnt > 0) continue;
          await conn.query(
            `INSERT INTO store_checklist_templates (restaurantId, targetTab, checkType, itemText, requirementType, sortOrder, repeatType, isActive) VALUES (?, ?, ?, ?, 'none', ?, 'daily', 1)`,
            [store.id, t.targetTab, t.checkType, t.itemText, t.sortOrder]
          );
          added++;
        }
        if (added > 0) console.log(`[migrate] seeded ${added} default checklists for restaurant ${store.id}`);
      }
    } catch (e: any) {
      console.log("[migrate] checklist seed skipped:", e.message);
    }

    // ─── schedules 누락 컬럼 추가 ───
    await addColumnIfNotExists("schedules", "payrollRecheckRequired", "BOOLEAN NOT NULL DEFAULT FALSE");

    // ─── schedules.shiftPreset: enum → varchar 변환 ───
    try {
      const [cols] = await conn.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schedules' AND COLUMN_NAME = 'shiftPreset'`
      ) as any[];
      if (cols[0] && cols[0].COLUMN_TYPE.startsWith("enum")) {
        await conn.query(`ALTER TABLE schedules MODIFY COLUMN shiftPreset VARCHAR(30) DEFAULT 'custom'`);
        console.log("[migrate] schedules.shiftPreset enum → varchar(30)");
      }
    } catch (e: any) {
      console.log("[migrate] shiftPreset conversion skipped:", e.message);
    }

    // ─── 매장별 근무 프리셋 시간 테이블 ───
    await conn.query(`
      CREATE TABLE IF NOT EXISTS restaurant_shift_presets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        presetType VARCHAR(30) NOT NULL,
        dayType VARCHAR(20) NOT NULL DEFAULT 'weekday',
        label VARCHAR(30) NOT NULL DEFAULT '',
        startTime VARCHAR(5) NOT NULL,
        endTime VARCHAR(5) NOT NULL,
        breakMinutes INT NOT NULL DEFAULT 0,
        isCustom BOOLEAN NOT NULL DEFAULT FALSE,
        sortOrder INT NOT NULL DEFAULT 0,
        isActive BOOLEAN NOT NULL DEFAULT TRUE,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_store_preset_day (restaurantId, presetType, dayType)
      )
    `);
    // 프리셋 테이블 신규 컬럼 추가 (기존 테이블 호환)
    await addColumnIfNotExists("restaurant_shift_presets", "label", "VARCHAR(30) NOT NULL DEFAULT ''");
    await addColumnIfNotExists("restaurant_shift_presets", "isCustom", "BOOLEAN NOT NULL DEFAULT FALSE");
    await addColumnIfNotExists("restaurant_shift_presets", "sortOrder", "INT NOT NULL DEFAULT 0");
    await addColumnIfNotExists("restaurant_shift_presets", "isActive", "BOOLEAN NOT NULL DEFAULT TRUE");
    try {
      await conn.query(`ALTER TABLE restaurant_shift_presets MODIFY COLUMN presetType VARCHAR(30) NOT NULL`);
    } catch (e: any) { /* already done */ }

    // 거래처 세부정보 컬럼 추가
    await addColumnIfNotExists("counterparties", "phone", "VARCHAR(30) DEFAULT NULL");
    await addColumnIfNotExists("counterparties", "address", "VARCHAR(200) DEFAULT NULL");

    await conn.end();
    console.log("[migrate] all migrations complete");
  } catch (e: any) {
    console.error("[migrate] error:", e.message);
  }
})();

// ─── 에러 수집 REST 엔드포인트 (tRPC 의존 없음) ──────────────────────────────
app.post("/api/error-report", async (req, res) => {
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
app.use("/api/ocr", ocrRouter);
app.use("/uploads", express.static(UPLOAD_ROOT));

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
