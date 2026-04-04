/**
 * 자동 마이그레이션: 신규 테이블/컬럼/인덱스
 * server/index.ts에서 서버 시작 전 호출
 */
export async function runMigrations() {
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
    await addColumnIfNotExists("employment_electronic_contracts", "includeNda", "BOOLEAN NOT NULL DEFAULT FALSE");
    await addColumnIfNotExists("employment_electronic_contracts", "includePrivacyConsent", "BOOLEAN NOT NULL DEFAULT FALSE");

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

    // employee_contracts에 socialInsurance, bankAccount, residentNumber 추가
    await addColumnIfNotExists("employee_contracts", "socialInsurance", "BOOLEAN DEFAULT TRUE");
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

    // ─── 성능 인덱스 추가 ───────────────────────────────────────────────
    const createIndexIfNotExists = async (table: string, indexName: string, columns: string) => {
      const [rows] = await conn.query(
        `SELECT COUNT(*) as cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [table, indexName]
      ) as any[];
      if (rows[0].cnt === 0) {
        await conn.query(`CREATE INDEX \`${indexName}\` ON \`${table}\` (${columns})`);
        console.log(`[migrate] created index ${indexName} on ${table}`);
      }
    };

    // 매출: 매장+날짜 조회
    await createIndexIfNotExists("sales", "idx_sales_rest_date", "restaurantId, saleDate");
    // 일일마감: 매장+날짜
    await createIndexIfNotExists("daily_closings", "idx_dc_rest_date", "restaurantId, closingDate");
    // 월간마감: 매장+연월
    await createIndexIfNotExists("monthly_closings", "idx_mc_rest_ym", "restaurantId, year, month");
    // 스케줄: 매장+날짜+상태
    await createIndexIfNotExists("schedules", "idx_sched_rest_date", "restaurantId, workDate");
    await createIndexIfNotExists("schedules", "idx_sched_status", "status");
    // 일일운영: 매장+날짜
    await createIndexIfNotExists("daily_operations", "idx_do_rest_date", "restaurantId, operationDate");
    // 매입v2: 매장+날짜+상태
    await createIndexIfNotExists("purchase_orders_v2", "idx_pov2_rest_date", "restaurantId, orderDate");
    await createIndexIfNotExists("purchase_orders_v2", "idx_pov2_status", "status");
    // 고정비: 매장+연월
    await createIndexIfNotExists("fixed_costs", "idx_fc_rest_ym", "restaurantId, year, month");
    // 알림: 사용자+읽음
    await createIndexIfNotExists("notifications", "idx_notif_user_read", "userId, isRead");
    // 에러로그: 생성일
    await createIndexIfNotExists("error_logs", "idx_errlog_created", "createdAt");
    // 체크리스트로그: 매장+날짜
    await createIndexIfNotExists("daily_checklist_logs", "idx_dcl_rest_date", "restaurantId, logDate");
    // 매장사용자: 사용자ID (역방향 조회)
    await createIndexIfNotExists("restaurant_users", "idx_ru_userid", "userId");
    // 근로계약: 매장+사용자
    await createIndexIfNotExists("employee_contracts", "idx_ec_rest_user", "restaurantId, userId");

    await conn.end();
    console.log("[migrate] all migrations complete");
  } catch (e: any) {
    console.error("[migrate] error:", e.message);
  }
}
