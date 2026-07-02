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
app.use(express.json({ limit: "10mb" }));

// ─── 자동 마이그레이션: 신규 테이블/컬럼 ──────────────────────────────────────
(async () => {
  try {
    const mysql2 = await import("mysql2/promise");
    const conn = await mysql2.createConnection(process.env.DATABASE_URL!);

    // 헬퍼: 컬럼 존재 여부 확인 후 추가
    // 개별 실패는 로그만 남기고 계속 — 한 구문의 throw가 이후 마이그레이션 전체를 중단시키면
    // 배포 코드와 DB 스키마가 어긋난 채 서비스됨 (2026-07-02 contractOffDays 누락 장애)
    const addColumnIfNotExists = async (table: string, column: string, definition: string) => {
      try {
        const [rows] = await conn.query(
          `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
          [table, column]
        ) as any[];
        if (rows[0].cnt === 0) {
          await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
          console.log(`[migrate] added ${table}.${column}`);
        }
      } catch (e: any) {
        console.error(`[migrate] FAILED ${table}.${column}:`, e.message);
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
      await conn.query(`ALTER TABLE users MODIFY COLUMN role ENUM('master','admin','user','manager','employee') NOT NULL DEFAULT 'user'`);
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
    // 재설계 2026-05-02 (Phase B 보강): weeklyOffDays SSOT를 restaurant_users로 일원화
    await addColumnIfNotExists("restaurant_users", "weeklyOffDays", "INT NOT NULL DEFAULT 1");
    await addColumnIfNotExists("employee_contracts", "weeklyOffDays", "INT DEFAULT 1");
    // 2026-07-02: 주당 휴무 → 계약휴무일수(월, 4~15) 전환. nullable additive + 1회 백필 후 코드 ?? 4 폴백
    await addColumnIfNotExists("restaurant_users", "contractOffDays", "INT DEFAULT NULL");
    await addColumnIfNotExists("employee_contracts", "contractOffDays", "INT DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "contractOffDays", "INT DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotContractOffDays", "INT DEFAULT NULL");
    // 가드형 1회 백필: 주당 휴무 → 계약휴무일수 환산(×4.345, 4~15 clamp). IS NULL 가드로 재배포 시 0행.
    // employee_contracts는 폐기 테이블이라 백필 대상 제외.
    await conn.query(`
      UPDATE restaurant_users
         SET contractOffDays = LEAST(15, GREATEST(4, ROUND(COALESCE(weeklyOffDays,1)*4.345)))
       WHERE contractOffDays IS NULL
    `).catch(() => {});
    await conn.query(`
      UPDATE employment_electronic_contracts
         SET snapshotContractOffDays = LEAST(15, GREATEST(4, ROUND(COALESCE(snapshotWeeklyOffDays,1)*4.345)))
       WHERE snapshotContractOffDays IS NULL AND snapshotWeeklyOffDays IS NOT NULL
    `).catch(() => {});

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
    // includeNda, includePrivacyConsent: 재설계 2026-05-02에서 폐기 (항상 첨부). ADD 호출 제거 — 매 부팅 ADD→DROP 사이클 방지.

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
    // 적용 기간: 생성일 이후만 일일운영에 표시, 삭제(비활성) 시 해당일부터 미적용
    await addColumnIfNotExists("store_checklist_templates", "effectiveFrom", "DATE DEFAULT NULL");
    await addColumnIfNotExists("store_checklist_templates", "effectiveTo", "DATE DEFAULT NULL");
    await addColumnIfNotExists("store_checklist_templates", "deactivatedBy", "INT DEFAULT NULL");

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

    // daily_checklist_logs: 중복 로그 정리 + UNIQUE(restaurantId, logDate, targetTab)
    //   - 경쟁 조건으로 같은 (매장, 날짜, 탭)에 여러 로그가 생기는 것을 차단
    //   - 운영캘린더 total이 중복 누적되어 영원히 "미완료"로 보이는 2차 버그 방지
    try {
      // (a) 중복 행 정리 — 가장 최근 업데이트된 행만 남김
      await conn.query(`
        DELETE d1 FROM daily_checklist_logs d1
        INNER JOIN daily_checklist_logs d2
          ON d1.restaurantId = d2.restaurantId
         AND d1.logDate = d2.logDate
         AND d1.targetTab <=> d2.targetTab
         AND (d1.updatedAt < d2.updatedAt OR (d1.updatedAt = d2.updatedAt AND d1.id < d2.id))
      `);
      // (b) targetTab NULL 보정 (UNIQUE가 NULL 복수행을 허용하는 MySQL 특성 감안, 방어적 default)
      await conn.query(`UPDATE daily_checklist_logs SET targetTab = 'open' WHERE targetTab IS NULL`);
      // (c) UNIQUE 인덱스 추가 (이미 존재하면 무시)
      const [idxRows] = await conn.query(
        `SELECT COUNT(*) as cnt FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daily_checklist_logs'
           AND INDEX_NAME = 'uniq_daily_checklist_logs_rest_date_tab'`
      ) as any[];
      if (idxRows[0].cnt === 0) {
        await conn.query(`
          ALTER TABLE daily_checklist_logs
          ADD UNIQUE INDEX uniq_daily_checklist_logs_rest_date_tab (restaurantId, logDate, targetTab)
        `);
        console.log("[migrate] daily_checklist_logs UNIQUE index added");
      }
    } catch (e: any) {
      console.log("[migrate] daily_checklist_logs UNIQUE:", e.message);
    }

    // store_closed_days: 중복 휴무일 행 정리 + UNIQUE(restaurantId, closedDate)
    //   - 같은 매장/날짜에 휴무 지정이 중복 생성되는 것을 방지
    try {
      await conn.query(`
        DELETE d1 FROM store_closed_days d1
        INNER JOIN store_closed_days d2
          ON d1.restaurantId = d2.restaurantId
         AND d1.closedDate = d2.closedDate
         AND d1.id < d2.id
      `);
      const [scdIdxRows] = await conn.query(
        `SELECT COUNT(*) as cnt FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_closed_days'
           AND INDEX_NAME = 'uniq_store_closed_days_rest_date'`
      ) as any[];
      if (scdIdxRows[0].cnt === 0) {
        await conn.query(`
          ALTER TABLE store_closed_days
          ADD UNIQUE INDEX uniq_store_closed_days_rest_date (restaurantId, closedDate)
        `);
        console.log("[migrate] store_closed_days UNIQUE index added");
      }
    } catch (e: any) {
      console.log("[migrate] store_closed_days UNIQUE:", e.message);
    }

    // notifications type ENUM 확장 (health_cert_expiry 추가)
    try {
      await conn.query(`ALTER TABLE notifications MODIFY COLUMN type ENUM('schedule_change','cost_exceeded','target_achieved','general','schedule_assigned','schedule_updated','schedule_deleted','health_cert_expiry') NOT NULL`);
      console.log("[migrate] notifications.type ENUM updated");
    } catch (e: any) {
      if (!e.message.includes("Duplicate")) console.log("[migrate] notifications type:", e.message);
    }

    // 고정비: costType enum 확장 (quarterly, sales_ratio, profit_ratio 추가) + attachmentUrl 컬럼
    try {
      await conn.query(`ALTER TABLE fixed_costs MODIFY COLUMN costType ENUM('monthly','yearly','one_time','quarterly','sales_ratio','profit_ratio') NOT NULL DEFAULT 'monthly'`);
      console.log("[migrate] fixed_costs.costType enum 확장 완료");
    } catch (e: any) {
      console.log("[migrate] fixed_costs costType:", e.message);
    }
    await addColumnIfNotExists("fixed_costs", "attachmentUrl", "VARCHAR(500) DEFAULT NULL");
    await addColumnIfNotExists("fixed_costs", "category", "VARCHAR(50) DEFAULT '기타'");
    await addColumnIfNotExists("fixed_costs", "startMonth", "VARCHAR(7) DEFAULT NULL");
    await addColumnIfNotExists("fixed_costs", "endMonth", "VARCHAR(7) DEFAULT NULL");
    // 기존 데이터 startMonth 백필: createdAt 기반 YYYY-MM
    try {
      await conn.query(`UPDATE fixed_costs SET startMonth = DATE_FORMAT(createdAt, '%Y-%m') WHERE startMonth IS NULL AND isActive = 1`);
      console.log("[migrate] fixed_costs.startMonth backfilled");
    } catch (e: any) {
      console.log("[migrate] fixed_costs startMonth backfill:", e.message);
    }

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
    // 사업군 식별 컬러 (#RRGGBB) — 없으면 프론트에서 이름 해시 fallback
    await conn.query(`
      ALTER TABLE business_groups ADD COLUMN color VARCHAR(7) DEFAULT NULL
    `).catch(() => {});
    // noWeeklyHolidayPay: 재설계 2026-05-02에서 폐기 (주15h 자동 분기). ADD 호출 제거 — 매 부팅 ADD→DROP 사이클 방지.
    // 은행/계좌 분리: bankName 컬럼 신규. bankAccount는 계좌번호만 보관.
    await conn.query(`
      ALTER TABLE employee_contracts ADD COLUMN bankName VARCHAR(50) DEFAULT NULL
    `).catch(() => {});
    await conn.query(`
      ALTER TABLE employment_electronic_contracts ADD COLUMN bankName VARCHAR(50) DEFAULT NULL
    `).catch(() => {});
    await conn.query(`
      ALTER TABLE employment_electronic_contracts ADD COLUMN snapshotBankName VARCHAR(50) DEFAULT NULL
    `).catch(() => {});
    // 기존 bankAccount 데이터 자동 분리 (idempotent: bankName이 비어있고 bankAccount에 공백 포함일 때만)
    // 패턴: "하나은행 175-18-515110" → bankName="하나은행", bankAccount="175-18-515110"
    await conn.query(`
      UPDATE employee_contracts
      SET bankName = TRIM(SUBSTRING_INDEX(bankAccount, ' ', 1)),
          bankAccount = TRIM(SUBSTRING(bankAccount, LOCATE(' ', bankAccount) + 1))
      WHERE bankName IS NULL
        AND bankAccount IS NOT NULL
        AND LOCATE(' ', bankAccount) > 0
    `).catch(() => {});
    await conn.query(`
      UPDATE employment_electronic_contracts
      SET bankName = TRIM(SUBSTRING_INDEX(employeeBankAccount, ' ', 1)),
          employeeBankAccount = TRIM(SUBSTRING(employeeBankAccount, LOCATE(' ', employeeBankAccount) + 1))
      WHERE bankName IS NULL
        AND employeeBankAccount IS NOT NULL
        AND LOCATE(' ', employeeBankAccount) > 0
    `).catch(() => {});
    await conn.query(`
      UPDATE employment_electronic_contracts
      SET snapshotBankName = TRIM(SUBSTRING_INDEX(snapshotBankAccount, ' ', 1)),
          snapshotBankAccount = TRIM(SUBSTRING(snapshotBankAccount, LOCATE(' ', snapshotBankAccount) + 1))
      WHERE snapshotBankName IS NULL
        AND snapshotBankAccount IS NOT NULL
        AND LOCATE(' ', snapshotBankAccount) > 0
    `).catch(() => {});
    // 월마감에 즉시지출 합계 컬럼
    await conn.query(`
      ALTER TABLE monthly_closings ADD COLUMN expensesTotal DECIMAL(14,2) NOT NULL DEFAULT 0
    `).catch(() => {});
    await conn.query(`
      ALTER TABLE monthly_closings ADD COLUMN fixedCostsTotal DECIMAL(14,2) NOT NULL DEFAULT 0
    `).catch(() => {});
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

    // 5) 기본 체크리스트 시드 — 최초 1회만 기존 매장 전체에 시드
    //    이후 신규 매장은 restaurants.create 에서 직접 시드
    //    (system_settings의 플래그로 가드하여 매 부팅마다 풀스캔 발생 방지)
    try {
      const [flagRows] = await conn.query(
        `SELECT settingValue FROM system_settings WHERE settingKey = 'initial_checklist_seed_done' LIMIT 1`
      ) as any[];
      const done = flagRows[0]?.settingValue === "true";

      if (!done) {
        const { seedDefaultChecklistsForRestaurant } = await import("./seedChecklists");
        const [restaurants] = await conn.query(`SELECT id FROM restaurants`) as any[];
        for (const store of restaurants) {
          const added = await seedDefaultChecklistsForRestaurant(conn as any, store.id);
          if (added > 0) console.log(`[migrate] seeded ${added} default checklists for restaurant ${store.id}`);
        }
        await conn.query(
          `INSERT INTO system_settings (settingKey, settingValue, description)
           VALUES ('initial_checklist_seed_done', 'true', '기존 매장 기본 체크리스트 초기 시드 완료 플래그')
           ON DUPLICATE KEY UPDATE settingValue = 'true'`
        );
        console.log("[migrate] initial checklist seed completed, flag set");
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

    // ─── 임시근로자 계좌/연락처 컬럼 ───
    await addColumnIfNotExists("schedules", "tempBankAccount", "VARCHAR(100) DEFAULT NULL");
    await addColumnIfNotExists("schedules", "tempPhone", "VARCHAR(30) DEFAULT NULL");

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

    // employee_contracts: bankAccount/residentNumber. socialInsurance는 재설계 2026-05-02에서 폐기 (taxMode로 대체) — ADD 호출 제거.
    await addColumnIfNotExists("employee_contracts", "bankAccount", "VARCHAR(100) DEFAULT NULL");
    await addColumnIfNotExists("employee_contracts", "residentNumber", "VARCHAR(20) DEFAULT NULL");

    // employment_electronic_contracts에 employeePhone, bankAccount, residentNumber 추가
    await addColumnIfNotExists("employment_electronic_contracts", "employeePhone", "VARCHAR(30) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "employeeBankAccount", "VARCHAR(100) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "employeeResidentNumber", "VARCHAR(20) DEFAULT NULL");

    // users에 bankBookUrl 추가
    await addColumnIfNotExists("users", "bankBookUrl", "VARCHAR(500) DEFAULT NULL");

    // 월정산 증빙 이미지 테이블
    await conn.query(`
      CREATE TABLE IF NOT EXISTS settlement_images (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        year INT NOT NULL,
        month INT NOT NULL,
        counterpartyId INT DEFAULT NULL,
        imageUrl TEXT NOT NULL,
        note VARCHAR(200) DEFAULT NULL,
        uploadedBy INT DEFAULT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_settlement_store_month (restaurantId, year, month)
      )
    `);
    await addColumnIfNotExists("settlement_images", "claimedAmount", "INT DEFAULT NULL");

    // employment_electronic_contracts에 weeklyOffDays 추가
    await addColumnIfNotExists("employment_electronic_contracts", "weeklyOffDays", "INT DEFAULT 1");

    // 사업주 프리셋 테이블
    await conn.query(`
      CREATE TABLE IF NOT EXISTS employer_presets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        companyName VARCHAR(100) NOT NULL,
        businessNumber VARCHAR(30) DEFAULT NULL,
        isDefault BOOLEAN DEFAULT FALSE NOT NULL,
        createdBy INT DEFAULT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_employer_presets_restaurant (restaurantId)
      )
    `).catch(() => {});

    // expense_categories (매장별 커스텀 지출 카테고리)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS expense_categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        sortOrder INT NOT NULL DEFAULT 0,
        isActive BOOLEAN NOT NULL DEFAULT TRUE,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ec_restaurant (restaurantId)
      )
    `).catch(() => {});

    // daily_expenses (즉시지출 기록)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS daily_expenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        date DATE NOT NULL,
        categoryId INT NULL,
        category VARCHAR(50) NULL,
        title VARCHAR(200) NOT NULL,
        amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        note TEXT NULL,
        attachmentUrl TEXT NULL,
        createdBy INT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_de_restaurant_date (restaurantId, date)
      )
    `).catch(() => {});

    // ─── daily_expenses 레거시 스키마 보정 ───
    // 과거 reverted 커밋(974c3ed/666cf81)이 만든 구 스키마(expenseDate DATE, category ENUM, createdBy NOT NULL)를
    // 현재 스키마(date DATE, category VARCHAR NULL, createdBy NULL)로 정규화한다.
    // CREATE TABLE IF NOT EXISTS 는 기존 테이블을 건드리지 않으므로, 컬럼 단위로 조정해야 함.
    try {
      const [cols] = await conn.query(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_TYPE
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daily_expenses'`
      ) as any[];
      const byName = new Map<string, any>((cols as any[]).map((c: any) => [c.COLUMN_NAME, c]));

      // 1) expenseDate → date 이관
      if (byName.has("expenseDate") && !byName.has("date")) {
        await conn.query(`ALTER TABLE daily_expenses CHANGE COLUMN \`expenseDate\` \`date\` DATE NOT NULL`);
        console.log("[migrate] daily_expenses: renamed expenseDate → date");
      } else if (byName.has("expenseDate") && byName.has("date")) {
        // 두 컬럼이 동시에 존재하는 희귀 상황: 구 컬럼의 값을 새 컬럼으로 백필 후 드롭
        await conn.query(`UPDATE daily_expenses SET \`date\` = \`expenseDate\` WHERE \`date\` IS NULL OR \`date\` = '0000-00-00'`);
        await conn.query(`ALTER TABLE daily_expenses DROP COLUMN \`expenseDate\``);
        console.log("[migrate] daily_expenses: backfilled date from expenseDate, dropped expenseDate");
      } else if (!byName.has("date")) {
        // 두 컬럼 모두 없으면 신규로 추가
        await conn.query(`ALTER TABLE daily_expenses ADD COLUMN \`date\` DATE NOT NULL DEFAULT (CURRENT_DATE)`);
        console.log("[migrate] daily_expenses: added missing date column");
      }

      // 2) category ENUM → VARCHAR(50) NULL (커스텀 카테고리명 저장용)
      const catCol = byName.get("category");
      if (catCol && String(catCol.DATA_TYPE).toLowerCase() === "enum") {
        await conn.query(`ALTER TABLE daily_expenses MODIFY COLUMN \`category\` VARCHAR(50) NULL`);
        console.log("[migrate] daily_expenses: category ENUM → VARCHAR(50) NULL");
      }

      // 3) createdBy NOT NULL → NULL 허용
      const createdByCol = byName.get("createdBy");
      if (createdByCol && String(createdByCol.IS_NULLABLE).toUpperCase() === "NO") {
        await conn.query(`ALTER TABLE daily_expenses MODIFY COLUMN \`createdBy\` INT NULL`);
        console.log("[migrate] daily_expenses: createdBy → NULL");
      }

      // 4) categoryId 없으면 추가 (이미 666cf81 경로에서 추가되었을 수 있지만 idempotent)
      if (!byName.has("categoryId")) {
        await conn.query(`ALTER TABLE daily_expenses ADD COLUMN \`categoryId\` INT NULL`);
        console.log("[migrate] daily_expenses: added categoryId");
      }
    } catch (e: any) {
      console.error("[migrate] daily_expenses normalize failed:", e?.message);
    }

    // counterparty_items.isActive 추가
    await addColumnIfNotExists("counterparty_items", "isActive", "BOOLEAN NOT NULL DEFAULT true");

    // restaurants: 시재금 고정값
    await addColumnIfNotExists("restaurants", "fixedCashRegister", "INT NOT NULL DEFAULT 200000");

    // daily_sales_detail: OCR 매출 전표 관련 컬럼
    await addColumnIfNotExists("daily_sales_detail", "source", "VARCHAR(20) DEFAULT 'manual' NOT NULL");
    await addColumnIfNotExists("daily_sales_detail", "ocrRawData", "JSON DEFAULT NULL");

    // ─── 발주 메모 재설계: purchaseOrdersV2 컬럼 추가 ───
    await addColumnIfNotExists("purchase_orders_v2", "content", "TEXT DEFAULT NULL");
    await addColumnIfNotExists("purchase_orders_v2", "counterpartyName", "VARCHAR(100) DEFAULT NULL");
    await addColumnIfNotExists("purchase_orders_v2", "isReceived", "BOOLEAN NOT NULL DEFAULT FALSE");
    // status enum에 'memo' 추가 (기존 received/ordered + memo)
    await conn.query(`ALTER TABLE purchase_orders_v2 MODIFY COLUMN status ENUM('received','ordered','memo') NOT NULL DEFAULT 'received'`).catch(() => {});

    // ─── 계정·직원관리 재설계: users.phoneNormalized ───
    await addColumnIfNotExists("users", "phoneNormalized", "VARCHAR(20) DEFAULT NULL");
    await conn.query(
      `CREATE INDEX idx_users_phone_normalized ON users(phoneNormalized)`
    ).catch(() => {}); // 이미 존재하면 무시

    // 기존 전화번호 → phoneNormalized 일괄 백필 (NULL인 것만)
    await conn.query(
      `UPDATE users SET phoneNormalized = REGEXP_REPLACE(phone, '[^0-9]', '') WHERE phoneNormalized IS NULL AND phone IS NOT NULL AND phone != ''`
    ).catch((e: any) => { console.error("[migrate] phoneNormalized backfill:", e.message); });

    // ─── 전자 근로계약서 스냅샷 필드 (서명 시점 박제) ───
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotName", "VARCHAR(100) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotPhone", "VARCHAR(30) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotAddress", "TEXT DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotResidentNumber", "VARCHAR(20) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotBankAccount", "VARCHAR(100) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotWage", "DECIMAL(12,2) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotWageType", "VARCHAR(20) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotWeeklyHours", "DECIMAL(5,2) DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotWeeklyOffDays", "INT DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotContractStart", "DATE DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotContractEnd", "DATE DEFAULT NULL");
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotAffiliatedCompany", "VARCHAR(100) DEFAULT NULL");

    // users 테이블에 address 필드 (직원 정보에 필요)
    await addColumnIfNotExists("users", "address", "TEXT DEFAULT NULL");

    // 재입사 추적용: restaurant_users.rehiredAt
    await addColumnIfNotExists("restaurant_users", "rehiredAt", "TIMESTAMP NULL DEFAULT NULL");

    // 계약서 status enum에 'superseded' 추가 (신 계약서 서명 시 이전 active 계약서 상태)
    await conn.query(
      `ALTER TABLE employment_electronic_contracts MODIFY COLUMN status ENUM('draft','sent','signed','expired','cancelled','superseded') NOT NULL DEFAULT 'draft'`
    ).catch(() => {});

    // employeeSignature: TEXT(64KB) → MEDIUMTEXT(16MB) 확장 (서명 base64 PNG 저장용)
    await conn.query(
      `ALTER TABLE employment_electronic_contracts MODIFY COLUMN employeeSignature MEDIUMTEXT`
    ).catch(() => {});

    // ─── 에러 로그 분류/집계 컬럼 (2026-04-09 추가) ─────────────────────────
    await addColumnIfNotExists("error_logs", "fingerprint", "VARCHAR(64) DEFAULT NULL");
    await addColumnIfNotExists("error_logs", "severity", "VARCHAR(4) DEFAULT NULL");
    await addColumnIfNotExists("error_logs", "category", "VARCHAR(32) DEFAULT NULL");
    await addColumnIfNotExists("error_logs", "occurrenceCount", "INT NOT NULL DEFAULT 1");
    await addColumnIfNotExists("error_logs", "firstSeenAt", "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP");
    await addColumnIfNotExists("error_logs", "lastSeenAt", "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP");
    await addColumnIfNotExists("error_logs", "affectedUserCount", "INT NOT NULL DEFAULT 1");
    await addColumnIfNotExists("error_logs", "affectedRestaurantCount", "INT NOT NULL DEFAULT 0");
    await addColumnIfNotExists("error_logs", "status", "VARCHAR(16) NOT NULL DEFAULT 'new'");
    await addColumnIfNotExists("error_logs", "autoAction", "VARCHAR(32) DEFAULT NULL");
    await addColumnIfNotExists("error_logs", "notifiedAt", "TIMESTAMP NULL DEFAULT NULL");
    await addColumnIfNotExists("error_logs", "resolvedAt", "TIMESTAMP NULL DEFAULT NULL");
    await addColumnIfNotExists("error_logs", "resolvedBy", "INT DEFAULT NULL");
    // fingerprint 인덱스 (그룹 조회 + upsert 속도)
    try {
      await conn.query(`CREATE INDEX idx_error_fingerprint ON error_logs (fingerprint)`);
    } catch (e: any) {
      if (!e.message.includes("Duplicate")) console.log("[migrate] idx_error_fingerprint:", e.message);
    }
    try {
      await conn.query(`CREATE INDEX idx_error_status_severity ON error_logs (status, severity)`);
    } catch (e: any) {
      if (!e.message.includes("Duplicate")) console.log("[migrate] idx_error_status_severity:", e.message);
    }
    // notifications.type ENUM에 'error_alert' 추가
    try {
      await conn.query(`ALTER TABLE notifications MODIFY COLUMN type ENUM('schedule_change','cost_exceeded','target_achieved','general','schedule_assigned','schedule_updated','schedule_deleted','health_cert_expiry','system_announcement','error_alert') NOT NULL`);
    } catch (e: any) {
      if (!e.message.includes("Duplicate")) console.log("[migrate] notifications.type error_alert:", e.message);
    }

    // ─── Phase 1: 급여이력 (employee_wage_history) + restaurant_users.contractMigrated ───
    // 시점별 급여 단가 저장. 월 1일 기준 [effectiveFrom, effectiveTo) 구간. effectiveTo=NULL이 현재 유효.
    await conn.query(`
      CREATE TABLE IF NOT EXISTS employee_wage_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        restaurantId INT NOT NULL,
        wageType ENUM('hourly','monthly') NOT NULL,
        wageAmount DECIMAL(12,2) NOT NULL,
        effectiveFrom DATE NOT NULL,
        effectiveTo DATE NULL,
        sourceContractId INT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY uniq_user_rest_from (userId, restaurantId, effectiveFrom),
        INDEX idx_user_rest (userId, restaurantId)
      )
    `).catch(() => {});
    await addColumnIfNotExists("restaurant_users", "contractMigrated", "BOOLEAN NOT NULL DEFAULT false");

    // ─── POS Phase 1 (2026-04-19): restaurants 6컬럼 + 12개 테이블 ───────────
    await addColumnIfNotExists("restaurants", "posEnabled", "BOOLEAN NOT NULL DEFAULT FALSE");
    await addColumnIfNotExists(
      "restaurants",
      "posStylePreset",
      "ENUM('DEPT_PICKUP','SHOP_PICKUP','SHOP_TABLE','COURT_PICKUP','KIOSK_PICKUP') NULL"
    );
    await addColumnIfNotExists(
      "restaurants",
      "posDefaultOrderMode",
      "ENUM('prepaid_pickup','prepaid_table','postpaid_table') NULL"
    );
    await addColumnIfNotExists(
      "restaurants",
      "posPaymentProvider",
      "ENUM('external_dept_store','terminal_bridge','van_direct','manual') NULL"
    );
    await addColumnIfNotExists(
      "restaurants",
      "posKitchenRouter",
      "ENUM('kds','printer','none') NULL"
    );
    await addColumnIfNotExists("restaurants", "posReconcileTolerance", "INT NOT NULL DEFAULT 0");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS pos_menu_categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        displayOrder INT NOT NULL DEFAULT 0,
        isActive BOOLEAN NOT NULL DEFAULT TRUE,
        deletedAt TIMESTAMP NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_pos_menu_cat_rest (restaurantId, displayOrder)
      )
    `).catch(() => {});

    await conn.query(`
      CREATE TABLE IF NOT EXISTS pos_menu_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        categoryId INT NULL,
        name VARCHAR(150) NOT NULL,
        price DECIMAL(12,2) NOT NULL DEFAULT 0,
        imageUrl VARCHAR(500) NULL,
        recipeId INT NULL,
        taxType ENUM('taxable','exempt','zero') NOT NULL DEFAULT 'taxable',
        isSoldOut BOOLEAN NOT NULL DEFAULT FALSE,
        isActive BOOLEAN NOT NULL DEFAULT TRUE,
        displayOrder INT NOT NULL DEFAULT 0,
        deletedAt TIMESTAMP NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_pos_menu_item_rest (restaurantId, categoryId, displayOrder),
        INDEX idx_pos_menu_item_active (restaurantId, isActive, deletedAt)
      )
    `).catch(() => {});

    await conn.query(`
      CREATE TABLE IF NOT EXISTS pos_menu_option_groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        menuItemId INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        minSelect INT NOT NULL DEFAULT 0,
        maxSelect INT NOT NULL DEFAULT 1,
        isRequired BOOLEAN NOT NULL DEFAULT FALSE,
        displayOrder INT NOT NULL DEFAULT 0,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_pos_optgrp_item (menuItemId)
      )
    `).catch(() => {});

    await conn.query(`
      CREATE TABLE IF NOT EXISTS pos_menu_options (
        id INT AUTO_INCREMENT PRIMARY KEY,
        optionGroupId INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        priceDelta DECIMAL(10,2) NOT NULL DEFAULT 0,
        displayOrder INT NOT NULL DEFAULT 0,
        isActive BOOLEAN NOT NULL DEFAULT TRUE,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_pos_opt_group (optionGroupId)
      )
    `).catch(() => {});

    await conn.query(`
      CREATE TABLE IF NOT EXISTS pos_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uuid VARCHAR(36) NOT NULL,
        restaurantId INT NOT NULL,
        orderNo VARCHAR(16) NOT NULL,
        orderMode ENUM('prepaid_pickup','prepaid_table','postpaid_table') NOT NULL,
        tableNo VARCHAR(30) NULL,
        pagerNo VARCHAR(30) NULL,
        status ENUM('open','paid','ready','served','voided','refunded') NOT NULL DEFAULT 'open',
        subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
        discountTotal DECIMAL(12,2) NOT NULL DEFAULT 0,
        taxTotal DECIMAL(12,2) NOT NULL DEFAULT 0,
        grandTotal DECIMAL(12,2) NOT NULL DEFAULT 0,
        customerNote VARCHAR(500) NULL,
        voidReason VARCHAR(200) NULL,
        createdByUserId INT NOT NULL,
        deviceId INT NULL,
        openedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        paidAt TIMESTAMP NULL,
        readyAt TIMESTAMP NULL,
        servedAt TIMESTAMP NULL,
        voidedAt TIMESTAMP NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_pos_order_uuid (uuid),
        INDEX idx_pos_order_rest_status (restaurantId, status, openedAt),
        INDEX idx_pos_order_rest_created (restaurantId, createdAt)
      )
    `).catch(() => {});

    await conn.query(`
      CREATE TABLE IF NOT EXISTS pos_order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        orderId INT NOT NULL,
        menuItemId INT NULL,
        menuItemNameSnapshot VARCHAR(150) NOT NULL,
        unitPrice DECIMAL(12,2) NOT NULL,
        qty INT NOT NULL DEFAULT 1,
        lineDiscount DECIMAL(10,2) NOT NULL DEFAULT 0,
        lineTotal DECIMAL(12,2) NOT NULL,
        status ENUM('active','voided') NOT NULL DEFAULT 'active',
        note VARCHAR(200) NULL,
        voidedAt TIMESTAMP NULL,
        voidedByUserId INT NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_pos_orderitem_order (orderId)
      )
    `).catch(() => {});

    await conn.query(`
      CREATE TABLE IF NOT EXISTS pos_order_item_options (
        id INT AUTO_INCREMENT PRIMARY KEY,
        orderItemId INT NOT NULL,
        optionName VARCHAR(100) NOT NULL,
        priceDelta DECIMAL(10,2) NOT NULL DEFAULT 0,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_pos_orderitemopt_item (orderItemId)
      )
    `).catch(() => {});

    await conn.query(`
      CREATE TABLE IF NOT EXISTS pos_payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        orderId INT NOT NULL,
        method ENUM('card','cash','samsungpay','kakaopay','naverpay','gift','external','etc') NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        approvalNo VARCHAR(64) NULL,
        cardBrand VARCHAR(30) NULL,
        providerType ENUM('external_dept_store','terminal_bridge','van_direct','manual') NOT NULL DEFAULT 'manual',
        providerRef VARCHAR(200) NULL,
        createdByUserId INT NOT NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        voidedAt TIMESTAMP NULL,
        INDEX idx_pos_payment_order (orderId)
      )
    `).catch(() => {});

    await conn.query(`
      CREATE TABLE IF NOT EXISTS pos_devices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        deviceType ENUM('staff_counter','staff_table','kiosk','kds') NOT NULL,
        deviceTokenHash VARCHAR(255) NULL,
        isActive BOOLEAN NOT NULL DEFAULT TRUE,
        lastSeenAt TIMESTAMP NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_pos_device_rest (restaurantId, deviceType)
      )
    `).catch(() => {});

    await conn.query(`
      CREATE TABLE IF NOT EXISTS pos_print_jobs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        orderId INT NOT NULL,
        printerType ENUM('kitchen','receipt') NOT NULL,
        payload JSON NOT NULL,
        status ENUM('pending','printed','failed') NOT NULL DEFAULT 'pending',
        attempts INT NOT NULL DEFAULT 0,
        errorMsg VARCHAR(500) NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        printedAt TIMESTAMP NULL,
        failedAt TIMESTAMP NULL,
        INDEX idx_pos_printjob_rest_status (restaurantId, status, createdAt)
      )
    `).catch(() => {});

    await conn.query(`
      CREATE TABLE IF NOT EXISTS pos_daily_reconciliation (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        date DATE NOT NULL,
        posGross DECIMAL(14,2) NOT NULL DEFAULT 0,
        externalGross DECIMAL(14,2) NOT NULL DEFAULT 0,
        diff DECIMAL(14,2) NOT NULL DEFAULT 0,
        note VARCHAR(500) NULL,
        confirmedByUserId INT NULL,
        confirmedAt TIMESTAMP NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_pos_recon_rest_date (restaurantId, date)
      )
    `).catch(() => {});

    await conn.query(`
      CREATE TABLE IF NOT EXISTS pos_order_counters (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        date DATE NOT NULL,
        lastSeq INT NOT NULL DEFAULT 0,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_pos_ordercnt_rest_date (restaurantId, date)
      )
    `).catch(() => {});

    // ─── 정산표 OCR 대조 (2026-05-01) ─────────────────────────────────────────
    // counterparties: 정산 기준 플래그 + 합계 비교 허용 오차
    await addColumnIfNotExists(
      "counterparties",
      "settlementBasis",
      "ENUM('supply','total','mixed') NOT NULL DEFAULT 'supply'"
    );
    await addColumnIfNotExists(
      "counterparties",
      "settlementMatchTolerance",
      "INT NOT NULL DEFAULT 100"
    );

    // settlement_statement_audits: 대조 이력 보존 (중복 적용 방지 + 사후 감사)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS settlement_statement_audits (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        counterpartyId INT,
        counterpartyNameRaw VARCHAR(100),
        yearMonth VARCHAR(7) NOT NULL,
        imageUrl VARCHAR(500),
        ocrRawData JSON NOT NULL,
        parsedItems JSON NOT NULL,
        ocrTotal DECIMAL(14,2),
        systemTotal DECIMAL(14,2),
        diffSummary JSON,
        status ENUM('pending','reviewed','applied','dismissed') NOT NULL DEFAULT 'pending',
        appliedActions JSON,
        createdBy INT NOT NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewedAt TIMESTAMP NULL,
        appliedAt TIMESTAMP NULL,
        INDEX idx_settlement_rest_month (restaurantId, yearMonth),
        INDEX idx_settlement_counterparty (counterpartyId)
      )
    `).catch(() => {});

    // ─── 재설계 2026-05-02: 계약·직원·인건비 데이터 모델 일괄 재구성 ─────────────
    //   사양: docs/redesign_2026-05-02_계약_직원_인건비.md §6
    //   원칙: DELETE 5건은 테스트 단계 1회 한정. 운영 진입 후 절대 재실행 금지.
    //   가드: system_settings 키로 1회 적용 박제 → 키 존재 시 DELETE/시드 skip.
    //         CREATE/ALTER는 idempotent하므로 항상 실행.
    const REDESIGN_KEY = "redesign_2026_05_02_applied";
    let redesignApplied = false;
    try {
      const [appliedRows] = (await conn.query(
        `SELECT settingValue FROM system_settings WHERE settingKey = ?`,
        [REDESIGN_KEY]
      )) as any[];
      redesignApplied = appliedRows.length > 0;
    } catch {
      redesignApplied = false;
    }

    // 1) affiliated_companies 신규 테이블 (idempotent)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS affiliated_companies (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        companyName VARCHAR(100) NOT NULL,
        businessNumber VARCHAR(20),
        over5Employees BOOLEAN NOT NULL DEFAULT FALSE,
        isDefault BOOLEAN NOT NULL DEFAULT FALSE,
        createdBy INT NOT NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_restaurant_company (restaurantId, companyName)
      )
    `).catch(() => {});

    // 2) employment_electronic_contracts ALTER (신규 컬럼 추가 — idempotent)
    await addColumnIfNotExists("employment_electronic_contracts", "hireDate", "DATE NULL");
    await addColumnIfNotExists(
      "employment_electronic_contracts",
      "hourlyWageIncludesHolidayPay",
      "BOOLEAN NOT NULL DEFAULT TRUE"
    );
    await addColumnIfNotExists(
      "employment_electronic_contracts",
      "taxMode",
      "VARCHAR(30) NOT NULL DEFAULT 'social_insurance'"
    );
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotHireDate", "DATE NULL");
    await addColumnIfNotExists(
      "employment_electronic_contracts",
      "snapshotOver5Employees",
      "BOOLEAN NULL"
    );
    await addColumnIfNotExists(
      "employment_electronic_contracts",
      "snapshotTaxMode",
      "VARCHAR(30) NULL"
    );

    // 3) payDay default 25 → 20 (신규 INSERT만 영향, 기존 row는 박제값 유지)
    await conn.query(
      `ALTER TABLE employment_electronic_contracts ALTER COLUMN payDay SET DEFAULT 20`
    ).catch(() => {});

    // 4) 폐기 컬럼 DROP — IF EXISTS로 idempotent
    //    employment_electronic_contracts: socialInsurance, noWeeklyHolidayPay, includeNda, includePrivacyConsent
    //    employee_contracts: socialInsurance, noWeeklyHolidayPay
    for (const col of ["socialInsurance", "noWeeklyHolidayPay", "includeNda", "includePrivacyConsent"]) {
      await conn
        .query(`ALTER TABLE employment_electronic_contracts DROP COLUMN \`${col}\``)
        .catch(() => {});
    }
    for (const col of ["socialInsurance", "noWeeklyHolidayPay"]) {
      await conn.query(`ALTER TABLE employee_contracts DROP COLUMN \`${col}\``).catch(() => {});
    }

    // 5) users.hireDate DROP (이미 없을 수 있음 — IF EXISTS 효과로 catch)
    await conn.query(`ALTER TABLE users DROP COLUMN hireDate`).catch(() => {});

    // 6) DELETE 5건 + 시드 — 1회 한정. 가드 키 존재 시 skip.
    if (!redesignApplied) {
      console.log("[migrate:redesign-2026-05-02] applying one-shot DELETE + seed...");
      try {
        await conn.query(`DELETE FROM employment_electronic_contracts`);
        await conn.query(`DELETE FROM employee_contracts`);
        await conn.query(`DELETE FROM employee_wage_history`);
        await conn.query(`DELETE FROM leave_transactions`);
        await conn.query(`DELETE FROM employee_leaves`);

        // employer_presets → affiliated_companies 시드 (over5Employees=false 기본)
        // createdBy NOT NULL 보호: COALESCE로 master fallback
        await conn.query(`
          INSERT IGNORE INTO affiliated_companies
            (restaurantId, companyName, businessNumber, over5Employees, isDefault, createdBy)
          SELECT
            ep.restaurantId,
            ep.companyName,
            ep.businessNumber,
            FALSE,
            ep.isDefault,
            COALESCE(ep.createdBy, (SELECT id FROM users WHERE role='master' ORDER BY id LIMIT 1))
          FROM employer_presets ep
        `);

        // 가드 키 박제
        await conn.query(
          `INSERT INTO system_settings (settingKey, settingValue, description)
           VALUES (?, ?, '재설계 2026-05-02 마이그레이션 1회 적용 표시 — 절대 삭제 금지')
           ON DUPLICATE KEY UPDATE settingValue = VALUES(settingValue)`,
          [REDESIGN_KEY, JSON.stringify({ appliedAt: new Date().toISOString() })]
        );
        console.log("[migrate:redesign-2026-05-02] DELETE + seed complete");
      } catch (e: any) {
        console.error("[migrate:redesign-2026-05-02] one-shot block failed:", e.message);
      }
    } else {
      console.log("[migrate:redesign-2026-05-02] already applied (skip DELETE + seed)");
    }

    // ─── 재설계 2026-05-02 Phase E: 운영 데이터 SSOT 확장 ─────────────────────
    //   사양: docs/redesign_2026-05-02_운영데이터_SSOT_확장.md §6
    //   - restaurant_users에 운영 데이터 15 컬럼 추가 (idempotent ALTER)
    //   - employment_electronic_contracts에 신규 박제 11 컬럼 추가 (idempotent ALTER)
    //   - employee_contracts 테이블 DROP (1회 한정, 가드 키 보호)
    const REDESIGN_E_KEY = "redesign_2026_05_02_extended_applied";
    let redesignEApplied = false;
    try {
      const [appliedRows] = (await conn.query(
        `SELECT settingValue FROM system_settings WHERE settingKey = ?`,
        [REDESIGN_E_KEY]
      )) as any[];
      redesignEApplied = appliedRows.length > 0;
    } catch {
      redesignEApplied = false;
    }

    // 1) restaurant_users 운영 데이터 15 컬럼 (idempotent)
    await addColumnIfNotExists("restaurant_users", "position", "VARCHAR(50) NULL");
    await addColumnIfNotExists("restaurant_users", "contractType", "VARCHAR(20) NULL DEFAULT 'part_time'");
    await addColumnIfNotExists("restaurant_users", "contractStart", "DATE NULL");
    await addColumnIfNotExists("restaurant_users", "contractEnd", "DATE NULL");
    await addColumnIfNotExists("restaurant_users", "workStartTime", "VARCHAR(5) DEFAULT '09:00'");
    await addColumnIfNotExists("restaurant_users", "workEndTime", "VARCHAR(5) DEFAULT '18:00'");
    await addColumnIfNotExists("restaurant_users", "breakMinutes", "INT DEFAULT 60");
    await addColumnIfNotExists("restaurant_users", "weeklyHoliday", "VARCHAR(20) DEFAULT '일요일'");
    await addColumnIfNotExists("restaurant_users", "weeklyHours", "DECIMAL(5,2) DEFAULT 40");
    await addColumnIfNotExists(
      "restaurant_users",
      "taxMode",
      "VARCHAR(30) NOT NULL DEFAULT 'social_insurance'"
    );
    await addColumnIfNotExists(
      "restaurant_users",
      "hourlyWageIncludesHolidayPay",
      "BOOLEAN NOT NULL DEFAULT TRUE"
    );
    await addColumnIfNotExists("restaurant_users", "mealProvided", "BOOLEAN NOT NULL DEFAULT FALSE");
    await addColumnIfNotExists("restaurant_users", "mealAllowance", "DECIMAL(10,2) DEFAULT 0");
    await addColumnIfNotExists(
      "restaurant_users",
      "nightShiftConsent",
      "BOOLEAN NOT NULL DEFAULT FALSE"
    );
    await addColumnIfNotExists("restaurant_users", "specialTerms", "TEXT NULL");

    // 2) employment_electronic_contracts 신규 박제 11 컬럼 (idempotent)
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotPosition", "VARCHAR(50) NULL");
    await addColumnIfNotExists(
      "employment_electronic_contracts",
      "snapshotContractType",
      "VARCHAR(20) NULL"
    );
    await addColumnIfNotExists(
      "employment_electronic_contracts",
      "snapshotWorkStartTime",
      "VARCHAR(5) NULL"
    );
    await addColumnIfNotExists(
      "employment_electronic_contracts",
      "snapshotWorkEndTime",
      "VARCHAR(5) NULL"
    );
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotBreakMinutes", "INT NULL");
    await addColumnIfNotExists(
      "employment_electronic_contracts",
      "snapshotWeeklyHoliday",
      "VARCHAR(20) NULL"
    );
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotMealProvided", "BOOLEAN NULL");
    await addColumnIfNotExists(
      "employment_electronic_contracts",
      "snapshotMealAllowance",
      "DECIMAL(10,2) NULL"
    );
    await addColumnIfNotExists(
      "employment_electronic_contracts",
      "snapshotNightShiftConsent",
      "BOOLEAN NULL"
    );
    await addColumnIfNotExists("employment_electronic_contracts", "snapshotSpecialTerms", "TEXT NULL");
    await addColumnIfNotExists(
      "employment_electronic_contracts",
      "snapshotHourlyWageIncludesHolidayPay",
      "BOOLEAN NULL"
    );

    // 3) employee_contracts DROP — 가드 키 보호. 1회 한정.
    //   사양 §6: 테스트 단계라 데이터 손실 무관. 운영 진입 후 절대 재실행 금지.
    if (!redesignEApplied) {
      console.log("[migrate:redesign-2026-05-02-E] applying one-shot DROP TABLE + guard key...");
      try {
        await conn.query(`DROP TABLE IF EXISTS employee_contracts`);
        await conn.query(
          `INSERT INTO system_settings (settingKey, settingValue, description)
           VALUES (?, ?, '재설계 2026-05-02 Phase E (운영 SSOT 확장) 마이그레이션 1회 적용 표시 — 절대 삭제 금지')
           ON DUPLICATE KEY UPDATE settingValue = VALUES(settingValue)`,
          [REDESIGN_E_KEY, JSON.stringify({ appliedAt: new Date().toISOString() })]
        );
        console.log("[migrate:redesign-2026-05-02-E] DROP TABLE complete");
      } catch (e: any) {
        console.error("[migrate:redesign-2026-05-02-E] one-shot block failed:", e.message);
      }
    } else {
      console.log("[migrate:redesign-2026-05-02-E] already applied (skip DROP TABLE)");
    }

    // ─── 피드백/버그 제보 테이블 ──────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS user_feedbacks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        restaurantId INT NULL,
        type ENUM('bug','suggestion') NOT NULL DEFAULT 'bug',
        title VARCHAR(200) NOT NULL,
        content TEXT NOT NULL,
        screenshotBase64 MEDIUMTEXT NULL,
        status ENUM('pending','reviewed','resolved') NOT NULL DEFAULT 'pending',
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(id),
        INDEX idx_feedback_user (userId),
        INDEX idx_feedback_status (status, createdAt)
      )
    `).catch(() => {});

    // ─── 레시피 원가 계산 (2026-06-18) ───────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS recipe_ingredients (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurantId INT NOT NULL,
        recipeId INT NOT NULL,
        itemId INT NULL,
        rawName VARCHAR(100) NULL,
        quantity DECIMAL(10,4) NOT NULL DEFAULT 1,
        unitName VARCHAR(30) NULL,
        yieldRate DECIMAL(5,4) NOT NULL DEFAULT 1.0000,
        sortOrder INT NOT NULL DEFAULT 0,
        note TEXT NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ri_recipe (recipeId),
        INDEX idx_ri_restaurant (restaurantId)
      )
    `).catch(() => {});
    await addColumnIfNotExists("recipes", "servingYield", "DECIMAL(10,2) NOT NULL DEFAULT 1");
    await addColumnIfNotExists("recipes", "sellingPrice", "DECIMAL(14,2) NULL");
    await addColumnIfNotExists("recipes", "lossRate", "DECIMAL(5,4) NOT NULL DEFAULT 0");
    await addColumnIfNotExists("items", "costPerBaseManual", "DECIMAL(14,4) NULL");
    await addColumnIfNotExists("items", "costingCategory", "VARCHAR(50) DEFAULT NULL");
    await addColumnIfNotExists("items", "baseUnit", "VARCHAR(30) DEFAULT NULL");
    await addColumnIfNotExists("purchase_order_items_v2", "costingCategory", "VARCHAR(50) DEFAULT NULL");
    await addColumnIfNotExists("api_usage_logs", "timingBreakdown", "VARCHAR(120) NULL");

    await conn.end();
    console.log("[migrate] all migrations complete");
  } catch (e: any) {
    console.error("[migrate] error:", e.message);
  }
})();

// ─── 에러 수집 REST 엔드포인트 (tRPC 의존 없음) ──────────────────────────────
// 분류 · fingerprint upsert · 임계치 평가 · master 알림 파이프라인
import {
  computeFingerprint, detectCategory, detectSeverity,
  escalateIfNeeded, shouldNotify,
} from "./errorClassifier";

// 메모리 rate limit (IP+fingerprint 기준, 1분 버킷)
const RATE_BUCKET = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_PER_MIN = 30;
function rateLimitCheck(key: string): boolean {
  const now = Date.now();
  const entry = RATE_BUCKET.get(key);
  if (!entry || now > entry.resetAt) {
    RATE_BUCKET.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_PER_MIN) return false;
  return true;
}
// 주기적 청소 (10분마다)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of RATE_BUCKET.entries()) {
    if (now > v.resetAt) RATE_BUCKET.delete(k);
  }
}, 10 * 60 * 1000).unref?.();

// PII 마스킹 (서버 2차 방어선, 클라에서 1차 수행)
function maskPii(s: string | null | undefined): string | null {
  if (!s) return s ?? null;
  return s
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>")
    .replace(/\b01[016789]-?\d{3,4}-?\d{4}\b/g, "<phone>")
    .replace(/\b\d{6}-?[1-4]\d{6}\b/g, "<rrn>")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <token>")
    .replace(/"password"\s*:\s*"[^"]*"/g, '"password":"<masked>"');
}

app.post("/api/error-report", async (req, res) => {
  try {
    const { errors } = req.body as { errors: Array<{
      errorType?: string; message: string; stack?: string; url?: string; metadata?: any;
    }> };
    if (!Array.isArray(errors) || errors.length === 0) return res.json({ ok: true });

    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
               || req.socket.remoteAddress || "unknown";

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
      // master user ids (알림 수신자) - 1회 조회
      let masterIds: number[] = [];
      try {
        const [mrows] = await conn.query(`SELECT id FROM users WHERE role = 'master'`) as any[];
        masterIds = (mrows as any[]).map((r) => r.id);
      } catch {}

      for (const err of errors.slice(0, 20)) {
        const errorType = (err.errorType || "client").slice(0, 50);
        const message = maskPii((err.message || "unknown").slice(0, 2000)) || "unknown";
        const stack = maskPii(err.stack?.slice(0, 5000) || null);
        const url = err.url?.slice(0, 500) || null;

        // rate limit per (ip + fingerprint)
        const fingerprint = computeFingerprint({ errorType, message, stack });
        const rateKey = `${ip}:${fingerprint}`;
        if (!rateLimitCheck(rateKey)) {
          // 차단 시 기존 row의 count만 증가 (본문 저장 안 함)
          await conn.query(
            `UPDATE error_logs SET occurrenceCount = occurrenceCount + 1, lastSeenAt = NOW() WHERE fingerprint = ? ORDER BY id DESC LIMIT 1`,
            [fingerprint]
          );
          continue;
        }

        const category = detectCategory({ errorType, message, url });
        let severity = detectSeverity({ category, message, url });

        // 기존 fingerprint row 조회 (status='ignored'면 skip)
        const [existRows] = await conn.query(
          `SELECT id, status, severity, firstSeenAt FROM error_logs WHERE fingerprint = ? ORDER BY id DESC LIMIT 1`,
          [fingerprint]
        ) as any[];
        const existing = (existRows as any[])[0];

        if (existing?.status === "ignored" || existing?.status === "resolved") {
          // 무시/해결된 에러는 카운트만 올리고 끝
          await conn.query(
            `UPDATE error_logs SET occurrenceCount = occurrenceCount + 1, lastSeenAt = NOW() WHERE id = ?`,
            [existing.id]
          );
          continue;
        }

        // 집계: 최근 5분/1시간 동일 fingerprint 건수 + 영향 매장 수
        const [aggRows] = await conn.query(
          `SELECT
             SUM(CASE WHEN createdAt >= NOW() - INTERVAL 5 MINUTE THEN 1 ELSE 0 END) AS c5,
             SUM(CASE WHEN createdAt >= NOW() - INTERVAL 60 MINUTE THEN 1 ELSE 0 END) AS c60,
             COUNT(DISTINCT restaurantId) AS rcnt,
             COUNT(DISTINCT userId) AS ucnt
           FROM error_logs WHERE fingerprint = ?`,
          [fingerprint]
        ) as any[];
        const agg = (aggRows as any[])[0] || {};
        severity = escalateIfNeeded(severity, {
          count5m: Number(agg.c5) || 0,
          count1h: Number(agg.c60) || 0,
          affectedRestaurants: Number(agg.rcnt) || 0,
        });

        if (existing) {
          // 업서트 (같은 fingerprint 그룹 row 갱신)
          await conn.query(
            `UPDATE error_logs
               SET occurrenceCount = occurrenceCount + 1,
                   lastSeenAt = NOW(),
                   severity = ?,
                   category = ?,
                   message = ?,
                   stack = ?,
                   url = ?,
                   userAgent = ?,
                   userId = COALESCE(userId, ?),
                   affectedUserCount = GREATEST(affectedUserCount, ?),
                   affectedRestaurantCount = GREATEST(affectedRestaurantCount, ?)
             WHERE id = ?`,
            [
              severity, category, message, stack, url, userAgent || null,
              userId, Number(agg.ucnt) || 1, Number(agg.rcnt) || 0,
              existing.id,
            ]
          );
        } else {
          // 신규 row
          await conn.query(
            `INSERT INTO error_logs
               (userId, errorType, message, stack, url, userAgent, metadata,
                fingerprint, severity, category, occurrenceCount, firstSeenAt, lastSeenAt,
                affectedUserCount, affectedRestaurantCount, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW(), 1, 0, 'new')`,
            [
              userId, errorType, message, stack, url, userAgent || null,
              err.metadata ? JSON.stringify(err.metadata) : null,
              fingerprint, severity, category,
            ]
          );
        }

        // 마스터 알림 (P0/P1만, 그룹당 30분 throttle)
        if (shouldNotify(severity, !existing) && masterIds.length > 0) {
          const [throttleRows] = await conn.query(
            `SELECT notifiedAt FROM error_logs WHERE fingerprint = ? ORDER BY id DESC LIMIT 1`,
            [fingerprint]
          ) as any[];
          const lastNotified = (throttleRows as any[])[0]?.notifiedAt as Date | null;
          const THROTTLE_MS = 30 * 60 * 1000;
          if (!lastNotified || Date.now() - new Date(lastNotified).getTime() > THROTTLE_MS) {
            const title = `[${severity}] ${category} 에러 발생`;
            const content = `${message.slice(0, 180)}${message.length > 180 ? "…" : ""}\n발생: ${Number(agg.c60) || 1}건/1시간, 영향매장 ${Number(agg.rcnt) || 0}`;
            try {
              for (const mid of masterIds) {
                await conn.query(
                  `INSERT INTO notifications (recipientId, type, title, content, isRead, createdAt)
                   VALUES (?, 'error_alert', ?, ?, FALSE, NOW())`,
                  [mid, title.slice(0, 200), content]
                );
              }
              await conn.query(
                `UPDATE error_logs SET notifiedAt = NOW() WHERE fingerprint = ? ORDER BY id DESC LIMIT 1`,
                [fingerprint]
              );
            } catch (e: any) {
              console.error("[error-report notify]", e.message);
            }
          }
        }
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
