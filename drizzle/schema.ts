import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  mediumtext,
  timestamp,
  varchar,
  decimal,
  date,
  boolean,
  json,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  username: varchar("username", { length: 100 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 30 }),
  // 숫자만 남긴 정규화 전화번호 (검색/중복체크 인덱스용)
  phoneNormalized: varchar("phoneNormalized", { length: 20 }),
  // 직원 주소 (계약서 서명 시 C군 sync 대상)
  address: text("address"),
  // 시스템 역할: master > admin > user (레거시: manager, employee — 신규 생성 금지)
  role: mysqlEnum("role", ["master", "admin", "user", "manager", "employee"]).default("user").notNull(),
  authProvider: varchar("authProvider", { length: 20 }).default("local"),
  authProviderId: varchar("authProviderId", { length: 255 }),
  isActive: boolean("isActive").default(true).notNull(),
  isTutorial: boolean("isTutorial").default(false).notNull(),
  healthCertUrl: varchar("healthCertUrl", { length: 500 }),
  healthCertExpiry: date("healthCertExpiry"),
  bankBookUrl: varchar("bankBookUrl", { length: 500 }),
  mustChangePassword: boolean("mustChangePassword").default(false).notNull(),
  // SUB대표: 상위 대표(admin) userId. NULL = 최상위 대표 또는 일반 사용자
  parentId: int("parentId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn"),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Business Groups (사업그룹) ──────────────────────────────────────────────
// 대표(admin) + 소속 매장 + 소속 직원을 묶는 최상위 조직 단위.
// restaurants.ownerAdminId = businessGroups.adminId 로 매장 귀속.
export const businessGroups = mysqlTable("business_groups", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  // 대표(admin) userId — 그룹의 소유자
  adminId: int("adminId").notNull(),
  description: varchar("description", { length: 500 }),
  // 사업군 식별 컬러 (#RRGGBB). null이면 프론트에서 이름 해시 fallback.
  color: varchar("color", { length: 7 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BusinessGroup = typeof businessGroups.$inferSelect;
export type InsertBusinessGroup = typeof businessGroups.$inferInsert;

// ─── Restaurants ─────────────────────────────────────────────────────────────
export const restaurants = mysqlTable("restaurants", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  address: varchar("address", { length: 255 }),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  phone: varchar("phone", { length: 30 }),
  monthlyTargetSales: decimal("monthlyTargetSales", { precision: 14, scale: 2 }).default("0"),
  targetLaborRatio: decimal("targetLaborRatio", { precision: 5, scale: 2 }).default("30"),
  targetCostRatio: decimal("targetCostRatio", { precision: 5, scale: 2 }).default("80"),
  openTime: varchar("openTime", { length: 5 }).default("09:00"),
  closeTime: varchar("closeTime", { length: 5 }).default("22:00"),
  // 반차 판별 기준: 전체 운영시간 대비 근무시간 비율(%) 미만이면 반차
  halfShiftThreshold: int("halfShiftThreshold").default(60).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  isTutorial: boolean("isTutorial").default(false).notNull(),
  // 소유 대표 userId (NULL = tutorial/미배정, 설정 시 해당 대표만 합산에 포함)
  ownerAdminId: int("ownerAdminId"),
  // 소프트 삭제 일시 (null이면 활성)
  deletedAt: timestamp("deletedAt"),
  // 매출 입력 허용 시간대 (null이면 제한 없음)
  salesInputStartTime: varchar("salesInputStartTime", { length: 5 }),
  salesInputEndTime: varchar("salesInputEndTime", { length: 5 }),
  fixedCashRegister: int("fixedCashRegister").default(200000).notNull(),
  // ─── POS 설정 (Phase 1, 2026-04-19) ─────────────────────────────────────────
  posEnabled: boolean("posEnabled").default(false).notNull(),
  posStylePreset: mysqlEnum("posStylePreset", [
    "DEPT_PICKUP",
    "SHOP_PICKUP",
    "SHOP_TABLE",
    "COURT_PICKUP",
    "KIOSK_PICKUP",
  ]),
  posDefaultOrderMode: mysqlEnum("posDefaultOrderMode", [
    "prepaid_pickup",
    "prepaid_table",
    "postpaid_table",
  ]),
  posPaymentProvider: mysqlEnum("posPaymentProvider", [
    "external_dept_store",
    "terminal_bridge",
    "van_direct",
    "manual",
  ]),
  posKitchenRouter: mysqlEnum("posKitchenRouter", ["kds", "printer", "none"]),
  posReconcileTolerance: int("posReconcileTolerance").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Restaurant = typeof restaurants.$inferSelect;
export type InsertRestaurant = typeof restaurants.$inferInsert;

// ─── Restaurant ↔ User ───────────────────────────────────────────────────────
export const restaurantUsers = mysqlTable(
  "restaurant_users",
  {
    id: int("id").autoincrement().primaryKey(),
    restaurantId: int("restaurantId").notNull(),
    userId: int("userId").notNull(),
    // 매장 내 역할: owner(점장), supervisor(매니져), staff(직원)
  role: mysqlEnum("role", ["owner", "supervisor", "staff", "store_manager", "manager", "employee"]).notNull().default("staff"),
    affiliatedCompany: varchar("affiliatedCompany", { length: 100 }),
    hireDate: date("hireDate"),
    // [DEPRECATED 2026-07-02] 주당 휴무일수. 편집 동결 → contractOffDays로 대체(파생 가이드 표시에만 사용)
    weeklyOffDays: int("weeklyOffDays").default(1).notNull(),
    // 계약휴무일수(월) — SSOT (2026-07-02). 범위 4~15. nullable + 코드 ?? 4 폴백, 1회 백필
    contractOffDays: int("contractOffDays"),
    // 재입사 처리 시 기록 (퇴사 → 복귀)
    rehiredAt: timestamp("rehiredAt"),
    resignedAt: date("resignedAt"),
    resignReason: varchar("resignReason", { length: 200 }),
    roleChangedAt: timestamp("roleChangedAt"),
    roleChangedBy: int("roleChangedBy"),
    // Phase 2 급여이력 전환 플래그: 전자계약서 서명으로 wage_history가 생성되면 true
    contractMigrated: boolean("contractMigrated").default(false).notNull(),
    // ── Phase E (2026-05-02): 운영 데이터 SSOT 확장 (15 컬럼) ──
    // 직위·계약
    position: varchar("position", { length: 50 }),
    contractType: mysqlEnum("contractType", ["permanent", "fixed_term", "part_time", "daily"]).default("part_time"),
    contractStart: date("contractStart"),
    contractEnd: date("contractEnd"),
    // 근무
    workStartTime: varchar("workStartTime", { length: 5 }).default("09:00"),
    workEndTime: varchar("workEndTime", { length: 5 }).default("18:00"),
    breakMinutes: int("breakMinutes").default(60), // 계약 축: 소정근로 표준 휴게 (스케줄 축 schedules.breakMinutes와 별개)
    weeklyHoliday: varchar("weeklyHoliday", { length: 20 }).default("일요일"),
    weeklyHours: decimal("weeklyHours", { precision: 5, scale: 2 }).default("40"),
    // 세무
    taxMode: varchar("taxMode", { length: 30 }).default("social_insurance").notNull(),
    hourlyWageIncludesHolidayPay: boolean("hourlyWageIncludesHolidayPay").default(true).notNull(),
    // 기타
    mealProvided: boolean("mealProvided").default(false).notNull(),
    mealAllowance: decimal("mealAllowance", { precision: 10, scale: 2 }).default("0"),
    nightShiftConsent: boolean("nightShiftConsent").default(false).notNull(),
    specialTerms: text("specialTerms"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uniq_rest_user").on(t.restaurantId, t.userId)]
);

export type RestaurantUser = typeof restaurantUsers.$inferSelect;

// ─── Sales ───────────────────────────────────────────────────────────────────
export const sales = mysqlTable("sales", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  saleDate: date("saleDate").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  note: text("note"),
  source: varchar("source", { length: 50 }).default("manual"),
  recordedBy: int("recordedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Sale = typeof sales.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 1: 매입/거래처 + 고정비 + 일마감 + 수익성
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Counterparties (거래처) ─────────────────────────────────────────────────
export const counterparties = mysqlTable("counterparties", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  counterpartyType: mysqlEnum("counterpartyType", ["supplier", "online", "mart", "repair", "other"])
    .default("supplier").notNull(),
  phone: varchar("phone", { length: 30 }),
  address: varchar("address", { length: 200 }),
  contactName: varchar("contactName", { length: 50 }),
  contactPhone: varchar("contactPhone", { length: 30 }),
  note: text("note"),
  // 정산표 OCR 대조: 비교 기준 (supply=공급가, total=공급가+부가세, mixed=항목별 자동판정)
  settlementBasis: mysqlEnum("settlementBasis", ["supply", "total", "mixed"]).default("supply").notNull(),
  // 합계 비교 허용 오차(원). 기본 100원 (원단위 절상/절사 흡수)
  settlementMatchTolerance: int("settlementMatchTolerance").default(100).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Counterparty = typeof counterparties.$inferSelect;

// ─── Purchase Orders (매입 전표) ─────────────────────────────────────────────
export const purchaseOrders = mysqlTable("purchase_orders", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  counterpartyId: int("counterpartyId"),
  purchaseDate: date("purchaseDate").notNull(),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  note: text("note"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;

// ─── Purchase Order Items (매입 항목) ────────────────────────────────────────
export const purchaseOrderItems = mysqlTable("purchase_order_items", {
  id: int("id").autoincrement().primaryKey(),
  purchaseOrderId: int("purchaseOrderId").notNull(),
  itemName: varchar("itemName", { length: 100 }).notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 2 }),
  unitName: varchar("unitName", { length: 30 }),
  unitPrice: decimal("unitPrice", { precision: 14, scale: 2 }),
  lineTotal: decimal("lineTotal", { precision: 14, scale: 2 }).notNull(),
  category: varchar("category", { length: 50 }).default("식재료"),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;

// ─── Fixed Costs (고정비) ────────────────────────────────────────────────────
export const fixedCosts = mysqlTable("fixed_costs", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  costName: varchar("costName", { length: 100 }).notNull(),
  // monthly: 월 고정, yearly: 연간(월할), quarterly: 분기별(3개월할),
  // sales_ratio: 매출대비 %, profit_ratio: 월순이익대비 % (closed-form, 적자월 0)
  costType: mysqlEnum("costType", ["monthly", "yearly", "one_time", "quarterly", "sales_ratio", "profit_ratio"]).default("monthly").notNull(),
  category: varchar("category", { length: 50 }).default("기타"),  // 임대료, 관리비, 보험, 로열티/수수료, 유틸리티, 기타
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  // yearly→12분할, quarterly→3분할, sales_ratio→amount는 매출 % 값, profit_ratio→월순이익 % 값
  startMonth: varchar("startMonth", { length: 7 }),   // YYYY-MM, 적용 시작월 (NULL=무기한)
  endMonth: varchar("endMonth", { length: 7 }),        // YYYY-MM, 적용 종료월 (NULL=무기한)
  effectiveMonth: varchar("effectiveMonth", { length: 7 }), // YYYY-MM (레거시, 신규에서 미사용)
  attachmentUrl: varchar("attachmentUrl", { length: 500 }),  // 첨부파일 URL
  note: text("note"),
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FixedCost = typeof fixedCosts.$inferSelect;

// ─── Daily Closing Sales Types (매출 항목 유형) ──────────────────────────────
export const dailyClosingSalesTypes = mysqlTable("daily_closing_sales_types", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  typeName: varchar("typeName", { length: 50 }).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DailyClosingSalesType = typeof dailyClosingSalesTypes.$inferSelect;

// ─── Daily Closings (일마감) ─────────────────────────────────────────────────
export const dailyClosings = mysqlTable("daily_closings", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  closingDate: date("closingDate").notNull(),
  // 스냅샷 수치
  salesTotal: decimal("salesTotal", { precision: 14, scale: 2 }).default("0").notNull(),
  purchasesTotal: decimal("purchasesTotal", { precision: 14, scale: 2 }).default("0").notNull(),
  laborCost: decimal("laborCost", { precision: 14, scale: 2 }).default("0").notNull(),
  fixedCostShare: decimal("fixedCostShare", { precision: 14, scale: 2 }).default("0").notNull(),
  profit: decimal("profit", { precision: 14, scale: 2 }).default("0").notNull(),
  // 매출 항목별 상세
  salesBreakdown: json("salesBreakdown").$type<Array<{ typeName: string; amount: number }>>(),
  note: text("note"),
  closedBy: int("closedBy"),
  closedAt: timestamp("closedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DailyClosing = typeof dailyClosings.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2: 스케줄 + 일일운영 + 체크리스트
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Employee Contracts (직원 계약 정보) ──────────────────────────────────────
// employee_contracts 폐기됨 (재설계 2026-05-02 Phase E):
// SSOT는 restaurant_users + wage_history로 일원화.
// 의미 중복 해소 차원에서 테이블 자체 DROP. 자동 마이그레이션은 server/index.ts.

// ─── Employee Wage History (급여이력) ────────────────────────────────────────
// 시점별 급여 단가. 월 1일 기준 [effectiveFrom, effectiveTo) 구간으로 유효.
// effectiveTo = NULL 이면 현재 유효(open). 신 전자계약서 서명 시 open row를 닫고 신 row 생성.
// 인건비 계산: schedule.startTime의 월 1일이 구간에 들어가는 row의 wageAmount 사용.
// sourceContractId: 기원 전자계약서 id. 백필 row는 NULL.
export const employeeWageHistory = mysqlTable(
  "employee_wage_history",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    restaurantId: int("restaurantId").notNull(),
    wageType: mysqlEnum("wageType", ["hourly", "monthly"]).notNull(),
    wageAmount: decimal("wageAmount", { precision: 12, scale: 2 }).notNull(),
    effectiveFrom: date("effectiveFrom").notNull(),
    effectiveTo: date("effectiveTo"),
    sourceContractId: int("sourceContractId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uniq_user_rest_from").on(t.userId, t.restaurantId, t.effectiveFrom),
    index("idx_user_rest").on(t.userId, t.restaurantId),
  ],
);

export type EmployeeWageHistory = typeof employeeWageHistory.$inferSelect;

// ─── Employee Leaves (연차/대체휴무) ─────────────────────────────────────────
export const employeeLeaves = mysqlTable("employee_leaves", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  restaurantId: int("restaurantId").notNull(),
  year: int("year").notNull(),
  leaveType: mysqlEnum("leaveType", ["annual", "substitute", "sick", "other"]).notNull().default("annual"),
  totalDays: decimal("totalDays", { precision: 5, scale: 1 }).notNull().default("0"),
  usedDays: decimal("usedDays", { precision: 5, scale: 1 }).notNull().default("0"),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmployeeLeave = typeof employeeLeaves.$inferSelect;

// ─── Schedules (근무 스케줄) ──────────────────────────────────────────────────
export const schedules = mysqlTable("schedules", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),  // NULL = 임시 근로자
  tempWorkerName: varchar("tempWorkerName", { length: 100 }),
  tempWageType: mysqlEnum("tempWageType", ["hourly", "daily"]),
  tempWageAmount: decimal("tempWageAmount", { precision: 10, scale: 2 }),
  tempBankAccount: varchar("tempBankAccount", { length: 100 }),
  tempPhone: varchar("tempPhone", { length: 30 }),
  restaurantId: int("restaurantId").notNull(),
  startTime: timestamp("startTime").notNull(),
  endTime: timestamp("endTime").notNull(),
  // draft(초안) → confirmed(확정/직원공개) → completed(완료/지출반영), canceled(취소)
  // DB enum에 published/scheduled 잔존 (하위호환), 신규 코드에서는 사용하지 않음
  status: mysqlEnum("status", ["draft", "scheduled", "published", "completed", "confirmed", "canceled"]).default("draft").notNull(),
  shiftPreset: varchar("shiftPreset", { length: 30 }).default("custom"),
  breakMinutes: int("breakMinutes").default(0), // 스케줄 축: 시프트별 실적 휴게 (계약 축 restaurant_users.breakMinutes와 별개, 미입력 시 법정 기준 자동)
  note: text("note"),
  editReason: text("editReason"),
  payrollRecheckRequired: boolean("payrollRecheckRequired").default(false).notNull(),
  createdBy: int("createdBy"),
  completedBy: int("completedBy"),
  confirmedBy: int("confirmedBy"),
  publishedAt: timestamp("publishedAt"),
  completedAt: timestamp("completedAt"),
  confirmedAt: timestamp("confirmedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Schedule = typeof schedules.$inferSelect;

// ─── Schedule Change Requests (스케줄 변경 요청) ─────────────────────────────
export const scheduleChangeRequests = mysqlTable("schedule_change_requests", {
  id: int("id").autoincrement().primaryKey(),
  scheduleId: int("scheduleId").notNull(),
  requestedBy: int("requestedBy").notNull(),
  restaurantId: int("restaurantId").notNull(),
  requestType: mysqlEnum("requestType", ["swap", "change", "off"]).notNull().default("change"),
  reason: text("reason"),
  requestedStartTime: timestamp("requestedStartTime"),
  requestedEndTime: timestamp("requestedEndTime"),
  swapTargetScheduleId: int("swapTargetScheduleId"),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  reviewedBy: int("reviewedBy"),
  reviewNote: text("reviewNote"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ScheduleChangeRequest = typeof scheduleChangeRequests.$inferSelect;

// ─── Leave Requests (휴무/반차 사전 신청) ────────────────────────────────────────
export const leaveRequests = mysqlTable("leave_requests", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  restaurantId: int("restaurantId").notNull(),
  leaveDate: date("leaveDate").notNull(),
  leaveType: mysqlEnum("leaveType", ["dayoff", "half_morning", "half_evening"]).notNull().default("dayoff"),
  reason: text("reason"),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  reviewedBy: int("reviewedBy"),
  reviewNote: text("reviewNote"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LeaveRequest = typeof leaveRequests.$inferSelect;

// ─── Daily Operations (오픈/마감 체크) ──────────────────────────────────────────
export const dailyOperations = mysqlTable("daily_operations", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  operationDate: date("operationDate").notNull(),
  openCheckedAt: timestamp("openCheckedAt"),
  openCheckedBy: int("openCheckedBy"),
  openHeadcount: int("openHeadcount").default(0),
  openLaborCost: decimal("openLaborCost", { precision: 14, scale: 2 }).default("0"),
  closeCheckedAt: timestamp("closeCheckedAt"),
  closeCheckedBy: int("closeCheckedBy"),
  closeHeadcount: int("closeHeadcount").default(0),
  closeLaborCost: decimal("closeLaborCost", { precision: 14, scale: 2 }).default("0"),
  closeNote: text("closeNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DailyOperation = typeof dailyOperations.$inferSelect;

// ─── Daily Sales Detail (일 매출 상세) ───────────────────────────────────────
export const dailySalesDetail = mysqlTable("daily_sales_detail", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  saleDate: date("saleDate").notNull(),
  cashAmount: decimal("cashAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  cardAmount: decimal("cardAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  giftCardAmount: decimal("giftCardAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  transferAmount: decimal("transferAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  transferDepositor: varchar("transferDepositor", { length: 100 }),
  receiptCount: int("receiptCount").default(0).notNull(),
  discountAmount: decimal("discountAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  otherAmount: decimal("otherAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  status: mysqlEnum("status", ["draft", "submitted", "confirmed"]).default("draft").notNull(),
  confirmedBy: int("confirmedBy"),
  confirmedAt: timestamp("confirmedAt"),
  recordedBy: int("recordedBy"),
  note: text("note"),
  source: varchar("source", { length: 20 }).default("manual").notNull(),
  ocrRawData: json("ocrRawData").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DailySalesDetail = typeof dailySalesDetail.$inferSelect;

// ─── Sales Other Items (기타 매출 항목) ─────────────────────────────────────
export const salesOtherItems = mysqlTable("sales_other_items", {
  id: int("id").autoincrement().primaryKey(),
  dailySalesDetailId: int("dailySalesDetailId").notNull(),
  restaurantId: int("restaurantId").notNull(),
  itemName: varchar("itemName", { length: 100 }).notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SalesOtherItem = typeof salesOtherItems.$inferSelect;

// ─── Sales Other Item Templates (기타 매출 항목 템플릿) ──────────────────────
export const salesOtherItemTemplates = mysqlTable("sales_other_item_templates", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  itemName: varchar("itemName", { length: 100 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SalesOtherItemTemplate = typeof salesOtherItemTemplates.$inferSelect;

// ─── Intermediate Sales (중간 매출) ──────────────────────────────────────────
export const intermediateSales = mysqlTable("intermediate_sales", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  saleDate: date("saleDate").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  receiptCount: int("receiptCount").default(0),
  recordedAt: timestamp("recordedAt").defaultNow().notNull(),
  recordedBy: int("recordedBy"),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type IntermediateSale = typeof intermediateSales.$inferSelect;

// ─── Store Closed Days (매장 휴무일) ───────────────────────────────────────────
export const storeClosedDays = mysqlTable("store_closed_days", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  closedDate: date("closedDate").notNull(),
  reason: varchar("reason", { length: 100 }),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type StoreClosedDay = typeof storeClosedDays.$inferSelect;

// ─── Store Weekly Closures (정기 휴무 요일) ─────────────────────────────────
export const storeWeeklyClosures = mysqlTable("store_weekly_closures", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  weekday: int("weekday").notNull(), // 0=일, 1=월, ...6=토
  isClosed: boolean("isClosed").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type StoreWeeklyClosure = typeof storeWeeklyClosures.$inferSelect;

// ─── Store Checklist Templates (체크리스트 템플릿) ────────────────────────────
export const storeChecklistTemplates = mysqlTable("store_checklist_templates", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  checkType: mysqlEnum("checkType", ["open", "order", "cleaning", "hygiene", "inventory", "other"]).notNull(),
  // 일일운영 탭 매핑: open→오픈, purchase→매입, midday→일간보고, close→마감
  targetTab: varchar("targetTab", { length: 20 }).default("open").notNull(),
  itemText: varchar("itemText", { length: 200 }).notNull(),
  requirementType: mysqlEnum("requirementType", ["none", "text_input", "camera_photo"]).default("none").notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  // 업무관리 개편: 태그 + 반복/특정날짜
  tags: json("tags").$type<string[]>().default([]),
  repeatType: mysqlEnum("repeatType", ["none", "daily", "weekly", "monthly"]).default("daily"),
  repeatDays: json("repeatDays").$type<number[]>().default([]),  // weekly: 0=일~6=토, monthly: 1~31일
  specificDate: date("specificDate"),  // 레거시 (monthly 전환 후 미사용)
  isHighlight: boolean("isHighlight").default(false),
  // 적용 기간: 생성일 이후만 일일운영에 표시, 삭제(비활성) 시 해당일부터 미적용
  effectiveFrom: date("effectiveFrom"),   // NULL = 제한없음(기존 데이터 호환)
  effectiveTo: date("effectiveTo"),       // NULL = 무기한 활성
  deactivatedBy: int("deactivatedBy"),    // 비활성 처리한 사용자
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type StoreChecklistTemplate = typeof storeChecklistTemplates.$inferSelect;

// ─── Checked Item (체크 항목 응답 데이터) ────────────────────────────────────────
export interface CheckedItemData {
  itemId: number;
  answer?: string;       // text_input 요구사항 응답
  photoUrl?: string;     // camera_photo 요구사항 사진 경로
}

// ─── Daily Checklist Logs (일별 체크리스트 기록) ────────────────────────────────
export const dailyChecklistLogs = mysqlTable("daily_checklist_logs", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  logDate: date("logDate").notNull(),
  checkType: mysqlEnum("checkType", ["open", "order", "cleaning", "hygiene", "inventory", "other"]).notNull(),
  targetTab: varchar("targetTab", { length: 20 }),
  checkedItemIds: json("checkedItemIds").$type<number[]>().default([]),
  checkedItems: json("checkedItems").$type<CheckedItemData[]>().default([]),
  noOrderToday: boolean("noOrderToday").default(false).notNull(),
  completedBy: int("completedBy"),
  completedAt: timestamp("completedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DailyChecklistLog = typeof dailyChecklistLogs.$inferSelect;

// ─── Daily Order Images (일별 발주 이미지) ──────────────────────────────────
export const dailyOrderImages = mysqlTable("daily_order_images", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  imageDate: date("imageDate").notNull(),
  imageUrl: text("imageUrl").notNull(),
  note: varchar("note", { length: 200 }),
  uploadedBy: int("uploadedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DailyOrderImage = typeof dailyOrderImages.$inferSelect;

// ─── Daily Sales Special Items (매출 특이사항 — 할인/외상/미입금 등) ────────
export const dailySalesSpecialItems = mysqlTable("daily_sales_special_items", {
  id: int("id").autoincrement().primaryKey(),
  dailySalesDetailId: int("dailySalesDetailId").notNull(),
  restaurantId: int("restaurantId").notNull(),
  typeName: varchar("typeName", { length: 50 }).notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DailySalesSpecialItem = typeof dailySalesSpecialItems.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 1-B: 매입 V2 + 거래처/품목 마스터
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Items (공통 품목 마스터) ─────────────────────────────────────────────────
export const items = mysqlTable("items", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  itemType: mysqlEnum("itemType", ["product", "service", "misc"]).default("product").notNull(),
  costingCategory: varchar("costingCategory", { length: 50 }),
  baseUnit: varchar("baseUnit", { length: 30 }),
  isActive: boolean("isActive").default(true).notNull(),
  costPerBaseManual: decimal("costPerBaseManual", { precision: 14, scale: 4 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Item = typeof items.$inferSelect;

// ─── CounterpartyItems (거래처-품목 매핑) ────────────────────────────────────
export const counterpartyItems = mysqlTable("counterparty_items", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  counterpartyId: int("counterpartyId").notNull(),
  itemId: int("itemId").notNull(),
  supplierItemName: varchar("supplierItemName", { length: 100 }),
  purchaseUnit: varchar("purchaseUnit", { length: 30 }),
  conversionToBase: decimal("conversionToBase", { precision: 10, scale: 4 }).default("1"),
  decimalAllowed: boolean("decimalAllowed").default(false).notNull(),
  quantityStep: decimal("quantityStep", { precision: 10, scale: 4 }).default("1"),
  defaultPrice: decimal("defaultPrice", { precision: 14, scale: 2 }),
  lastPrice: decimal("lastPrice", { precision: 14, scale: 2 }),
  isPreferred: boolean("isPreferred").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CounterpartyItem = typeof counterpartyItems.$inferSelect;

// ─── PurchaseOrdersV2 (매입 헤더 v2) ─────────────────────────────────────────
// purchaseDate = 발주일 (정산 귀속 기준), receivedAt = 입고 확인 시점
export const purchaseOrdersV2 = mysqlTable("purchase_orders_v2", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  counterpartyId: int("counterpartyId"),
  purchaseDate: date("purchaseDate").notNull(), // 발주일 = 정산 귀속 기준
  receivedAt: timestamp("receivedAt"),          // 입고 확인 시점 (NULL = 미입고)
  status: mysqlEnum("status", ["received", "ordered", "memo"]).default("received").notNull(),
  note: text("note"),
  content: text("content"),
  counterpartyName: varchar("counterpartyName", { length: 100 }),
  isReceived: boolean("isReceived").default(false).notNull(),
  attachmentUrl: text("attachmentUrl"),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastModifiedBy: int("lastModifiedBy"),
  lastModifiedAt: timestamp("lastModifiedAt"),
  editHistory: json("editHistory").$type<Array<{ userId: number; userName: string; at: string; summary: string }>>(),
});

export type PurchaseOrderV2 = typeof purchaseOrdersV2.$inferSelect;

// ─── PurchaseOrderItemsV2 (매입 항목행 v2) ───────────────────────────────────
export const purchaseOrderItemsV2 = mysqlTable("purchase_order_items_v2", {
  id: int("id").autoincrement().primaryKey(),
  purchaseOrderId: int("purchaseOrderId").notNull(),
  itemId: int("itemId"),
  counterpartyItemId: int("counterpartyItemId"),
  rawItemName: varchar("rawItemName", { length: 100 }),
  itemType: mysqlEnum("itemType", ["product", "service", "misc"]).default("product").notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 4 }),
  unitName: varchar("unitName", { length: 30 }),
  conversionToBase: decimal("conversionToBase", { precision: 10, scale: 4 }),
  unitPrice: decimal("unitPrice", { precision: 14, scale: 2 }),
  lineTotal: decimal("lineTotal", { precision: 14, scale: 2 }).notNull(), // 공급가+부가세 (기존 정의 유지)
  // 과세/면세 세구분 (2026-07-29): NULL = 미분류 (0=면세 확정과 구분해야 함)
  supplyAmount: decimal("supplyAmount", { precision: 14, scale: 2 }),
  vatAmount: decimal("vatAmount", { precision: 14, scale: 2 }),
  taxType: mysqlEnum("taxType", ["taxable", "exempt", "unknown"]).default("unknown").notNull(),
  costingCategory: varchar("costingCategory", { length: 50 }),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PurchaseOrderItemV2 = typeof purchaseOrderItemsV2.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3: 전자계약 + 알림 + 월마감
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Restaurant Contracts (매장 계약 조건) ───────────────────────────────────
export const restaurantContracts = mysqlTable("restaurant_contracts", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  contractType: mysqlEnum("contractType", ["rent", "commission", "royalty", "investor", "other"]).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  calcType: mysqlEnum("calcType", ["fixed", "ratio"]).notNull().default("fixed"),
  fixedAmount: decimal("fixedAmount", { precision: 14, scale: 2 }).default("0"),
  ratioPercent: decimal("ratioPercent", { precision: 6, scale: 3 }).default("0"),
  startDate: date("startDate"),
  endDate: date("endDate"),
  note: text("note"),
  autoApplyToFixedCost: boolean("autoApplyToFixedCost").default(true).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RestaurantContract = typeof restaurantContracts.$inferSelect;

// ─── Employment Electronic Contracts (전자 근로계약서) ──────────────────────────
export const employmentElectronicContracts = mysqlTable("employment_electronic_contracts", {
  id: int("id").autoincrement().primaryKey(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  restaurantId: int("restaurantId").notNull(),
  employeeId: int("employeeId"),
  employeeName: varchar("employeeName", { length: 100 }).notNull(),
  employeePhone: varchar("employeePhone", { length: 30 }),
  employeeBirthdate: varchar("employeeBirthdate", { length: 10 }),
  employeeAddress: text("employeeAddress"),
  position: varchar("position", { length: 50 }).notNull().default("직원"),
  contractType: mysqlEnum("contractType", ["permanent", "fixed_term", "part_time", "daily"]).notNull().default("part_time"),
  contractStart: date("contractStart").notNull(),
  contractEnd: date("contractEnd"),
  hasProbation: boolean("hasProbation").default(false).notNull(),
  probationMonths: int("probationMonths").default(0),
  workPlace: varchar("workPlace", { length: 200 }),
  jobDescription: text("jobDescription"),
  wageType: mysqlEnum("wageType", ["hourly", "monthly"]).notNull().default("hourly"),
  wageAmount: decimal("wageAmount", { precision: 12, scale: 2 }).notNull(),
  weeklyHours: decimal("weeklyHours", { precision: 5, scale: 2 }).notNull().default("40"),
  workStartTime: varchar("workStartTime", { length: 5 }).default("09:00"),
  workEndTime: varchar("workEndTime", { length: 5 }).default("18:00"),
  breakMinutes: int("breakMinutes").default(60), // 계약 축: 계약서 스냅샷용 소정근로 표준 휴게
  weeklyHoliday: varchar("weeklyHoliday", { length: 20 }).default("일요일"),
  weeklyOffDays: int("weeklyOffDays").default(1), // [DEPRECATED 2026-07-02] 주당 휴무일수 → contractOffDays
  contractOffDays: int("contractOffDays"), // 계약휴무일수(월) 4~15 (2026-07-02)
  payDay: int("payDay").default(20),
  payMethod: mysqlEnum("payMethod", ["bank_transfer", "cash"]).default("bank_transfer"),
  mealProvided: boolean("mealProvided").default(false).notNull(),
  mealAllowance: decimal("mealAllowance", { precision: 10, scale: 2 }).default("0"),
  // 4대보험(social_insurance) / 사업소득 3.3%(biz_income_3_3) — 둘 중 하나 필수
  taxMode: varchar("taxMode", { length: 30 }).default("social_insurance").notNull(),
  // 시급제일 때만 의미: true=시급에 주휴포함, false=주휴 별도(주15h 이상이면 자동가산)
  hourlyWageIncludesHolidayPay: boolean("hourlyWageIncludesHolidayPay").default(true).notNull(),
  // 입사일 (계약서 박제용 — SSOT는 restaurant_users.hireDate)
  hireDate: date("hireDate"),
  // 5인 미만/이상은 소속회사(affiliated_companies) 마스터에서 자동 산정. 폼 입력 X. 서명 시점 박제용
  over5Employees: boolean("over5Employees").default(false).notNull(),
  affiliatedCompany: varchar("affiliatedCompany", { length: 100 }),
  employerBusinessNumber: varchar("employerBusinessNumber", { length: 20 }),
  workPlaceAddress: varchar("workPlaceAddress", { length: 300 }),
  // ── 포괄임금 구성항목 (월급제) ──
  annualSalary: decimal("annualSalary", { precision: 14, scale: 2 }),           // 연봉
  basePay: decimal("basePay", { precision: 12, scale: 2 }),                     // 기본급
  fixedOvertimeHours: decimal("fixedOvertimeHours", { precision: 6, scale: 2 }),// 고정연장시간
  fixedOvertimePay: decimal("fixedOvertimePay", { precision: 12, scale: 2 }),   // 고정연장수당
  fixedHolidayHours: decimal("fixedHolidayHours", { precision: 6, scale: 2 }), // 고정휴일시간
  fixedHolidayPay: decimal("fixedHolidayPay", { precision: 12, scale: 2 }),     // 고정휴일수당
  annualLeavePay: decimal("annualLeavePay", { precision: 12, scale: 2 }),       // 포괄연차수당
  hourlyWage: decimal("hourlyWage", { precision: 10, scale: 2 }),               // 통상시급
  monthlyContractHours: decimal("monthlyContractHours", { precision: 6, scale: 2 }), // 월소정+주휴시간
  // 부속서류(NDA, 개인정보수집동의서)는 서명 시 항상 첨부. 컬럼 폐기됨.
  nightShiftConsent: boolean("nightShiftConsent").default(false).notNull(),
  specialTerms: text("specialTerms"),
  status: mysqlEnum("status", ["draft", "sent", "signed", "expired", "cancelled", "superseded"]).notNull().default("draft"),
  sentAt: timestamp("sentAt"),
  signedAt: timestamp("signedAt"),
  employeeSignature: mediumtext("employeeSignature"),
  signedIp: varchar("signedIp", { length: 45 }),
  // ── 직원이 서명 시 입력 ──
  bankName: varchar("bankName", { length: 50 }), // 은행명 (계약서 본문에 박힘)
  employeeBankAccount: varchar("employeeBankAccount", { length: 100 }), // 계좌번호 (은행명 분리됨)
  employeeResidentNumber: varchar("employeeResidentNumber", { length: 20 }), // 주민등록번호
  previousContractId: int("previousContractId"),
  // ── 서명 시점 스냅샷 (박제 — 서명 후 불변) ──
  snapshotName: varchar("snapshotName", { length: 100 }),
  snapshotPhone: varchar("snapshotPhone", { length: 30 }),
  snapshotAddress: text("snapshotAddress"),
  snapshotResidentNumber: varchar("snapshotResidentNumber", { length: 20 }),
  snapshotBankName: varchar("snapshotBankName", { length: 50 }),
  snapshotBankAccount: varchar("snapshotBankAccount", { length: 100 }),
  snapshotWage: decimal("snapshotWage", { precision: 12, scale: 2 }),
  snapshotWageType: varchar("snapshotWageType", { length: 20 }),
  snapshotWeeklyHours: decimal("snapshotWeeklyHours", { precision: 5, scale: 2 }),
  snapshotWeeklyOffDays: int("snapshotWeeklyOffDays"), // [DEPRECATED 2026-07-02] → snapshotContractOffDays
  snapshotContractOffDays: int("snapshotContractOffDays"), // 계약휴무일수 박제 (2026-07-02)
  snapshotContractStart: date("snapshotContractStart"),
  snapshotContractEnd: date("snapshotContractEnd"),
  snapshotAffiliatedCompany: varchar("snapshotAffiliatedCompany", { length: 100 }),
  // 신규 박제 (재설계 2026-05-02)
  snapshotHireDate: date("snapshotHireDate"),
  snapshotOver5Employees: boolean("snapshotOver5Employees"),
  snapshotTaxMode: varchar("snapshotTaxMode", { length: 30 }),
  // ── Phase E (2026-05-02): 운영 SSOT 확장 박제 11 컬럼 ──
  snapshotPosition: varchar("snapshotPosition", { length: 50 }),
  snapshotContractType: varchar("snapshotContractType", { length: 20 }),
  snapshotWorkStartTime: varchar("snapshotWorkStartTime", { length: 5 }),
  snapshotWorkEndTime: varchar("snapshotWorkEndTime", { length: 5 }),
  snapshotBreakMinutes: int("snapshotBreakMinutes"),
  snapshotWeeklyHoliday: varchar("snapshotWeeklyHoliday", { length: 20 }),
  snapshotMealProvided: boolean("snapshotMealProvided"),
  snapshotMealAllowance: decimal("snapshotMealAllowance", { precision: 10, scale: 2 }),
  snapshotNightShiftConsent: boolean("snapshotNightShiftConsent"),
  snapshotSpecialTerms: text("snapshotSpecialTerms"),
  snapshotHourlyWageIncludesHolidayPay: boolean("snapshotHourlyWageIncludesHolidayPay"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmploymentElectronicContract = typeof employmentElectronicContracts.$inferSelect;

// ─── Notifications (알림) ─────────────────────────────────────────────────────
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  recipientId: int("recipientId"),
  type: mysqlEnum("type", [
    "schedule_change", "cost_exceeded", "target_achieved", "general",
    "schedule_assigned", "schedule_updated", "schedule_deleted",
    "health_cert_expiry", "system_announcement",
  ]).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content"),
  restaurantId: int("restaurantId"),
  isRead: boolean("isRead").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;

// ─── Monthly Closings (월마감) ───────────────────────────────────────────────
export const monthlyClosings = mysqlTable("monthly_closings", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  year: int("year").notNull(),
  month: int("month").notNull(),
  salesTotal: decimal("salesTotal", { precision: 14, scale: 2 }).default("0").notNull(),
  purchasesTotal: decimal("purchasesTotal", { precision: 14, scale: 2 }).default("0").notNull(),
  laborCost: decimal("laborCost", { precision: 14, scale: 2 }).default("0").notNull(),
  fixedCostsTotal: decimal("fixedCostsTotal", { precision: 14, scale: 2 }).default("0").notNull(),
  expensesTotal: decimal("expensesTotal", { precision: 14, scale: 2 }).default("0").notNull(),
  profit: decimal("profit", { precision: 14, scale: 2 }).default("0").notNull(),
  note: text("note"),
  closedBy: int("closedBy"),
  closedAt: timestamp("closedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MonthlyClosing = typeof monthlyClosings.$inferSelect;

// ─── Daily Closing Special Types (매출 특이사항 유형) ─────────
export const dailyClosingSpecialTypes = mysqlTable("daily_closing_special_types", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  typeName: varchar("typeName", { length: 50 }).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DailyClosingSpecialType = typeof dailyClosingSpecialTypes.$inferSelect;

// ─── Counterparty OCR Profiles (거래처별 OCR 프로파일) ───────────────────────
// 거래처↔전표 양식은 고정관계 — 양식 유형, 열 구조, 자주 쓰는 품목/단가를 저장
// OCR 시 이 데이터를 프롬프트에 주입하여 정확도 향상
export const counterpartyOcrProfiles = mysqlTable("counterparty_ocr_profiles", {
  id: int("id").autoincrement().primaryKey(),
  counterpartyId: int("counterpartyId").notNull(),
  documentType: varchar("documentType", { length: 50 }),  // 거래명세표, 거래명세서, 영수증 등
  columnOrder: varchar("columnOrder", { length: 255 }),    // 열 순서 (예: "품목|수량|단가|공급가액")
  // 자주 등장하는 품목 목록 (JSON: [{name, avgPrice, unit}])
  frequentItems: json("frequentItems"),
  sampleCount: int("sampleCount").default(0).notNull(),    // 누적 처리 건수
  lastUsedAt: timestamp("lastUsedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CounterpartyOcrProfile = typeof counterpartyOcrProfiles.$inferSelect;

// ─── OCR Corrections (사용자 수정 이력) ─────────────────────────────────────
// 사용자가 OCR 결과를 수정한 기록 → 학습 데이터로 활용
export const ocrCorrections = mysqlTable("ocr_corrections", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  counterpartyId: int("counterpartyId"),
  imageUrl: varchar("imageUrl", { length: 500 }).notNull(),
  originalItems: json("originalItems").notNull(),    // OCR 원본 결과
  correctedItems: json("correctedItems").notNull(),  // 사용자 수정 결과
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OcrCorrection = typeof ocrCorrections.$inferSelect;

// ─── 에러 로그 ────────────────────────────────────────────────────────────────
export const errorLogs = mysqlTable("error_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  restaurantId: int("restaurantId"),
  errorType: varchar("errorType", { length: 50 }).notNull().default("client"),
  message: text("message").notNull(),
  stack: text("stack"),
  url: varchar("url", { length: 500 }),
  userAgent: varchar("userAgent", { length: 500 }),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  // ─── 분류 · 집계 · 상태 (2026-04-09 추가) ────────────────────────────────
  fingerprint: varchar("fingerprint", { length: 64 }),       // sha1(errorType+normalize(message)+topFrame)
  severity: varchar("severity", { length: 4 }),              // P0|P1|P2|P3
  category: varchar("category", { length: 32 }),             // auth|db|ocr|trpc|ui|network|permission|unknown
  occurrenceCount: int("occurrenceCount").default(1).notNull(),
  firstSeenAt: timestamp("firstSeenAt").defaultNow(),
  lastSeenAt: timestamp("lastSeenAt").defaultNow(),
  affectedUserCount: int("affectedUserCount").default(1).notNull(),
  affectedRestaurantCount: int("affectedRestaurantCount").default(0).notNull(),
  status: varchar("status", { length: 16 }).default("new").notNull(), // new|acknowledged|auto_mitigated|resolved|ignored
  autoAction: varchar("autoAction", { length: 32 }),
  notifiedAt: timestamp("notifiedAt"),
  resolvedAt: timestamp("resolvedAt"),
  resolvedBy: int("resolvedBy"),
});
export type ErrorLog = typeof errorLogs.$inferSelect;

// ─── 감사 로그 (Audit Log) ────────────────────────────────────────────────────
export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  userName: varchar("userName", { length: 100 }),
  restaurantId: int("restaurantId"),
  action: varchar("action", { length: 50 }).notNull(), // create, update, delete
  target: varchar("target", { length: 50 }).notNull(), // sales, schedule, staff, restaurant, etc.
  targetId: int("targetId"),
  details: json("details"), // { before: {...}, after: {...} }
  ipAddress: varchar("ipAddress", { length: 45 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type AuditLog = typeof auditLogs.$inferSelect;

// ─── Settlement Statement Audits (월매입정산표 OCR 대조 이력) ────────────────
// 거래처가 발행한 월정산표를 OCR로 읽어 시스템 매입과 대조한 결과를 보존.
// 같은 정산표 중복 적용 방지 + 사후 감사용.
export const settlementStatementAudits = mysqlTable("settlement_statement_audits", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  counterpartyId: int("counterpartyId"),
  // OCR이 읽은 거래처명 원문 (매칭 실패 시 보존)
  counterpartyNameRaw: varchar("counterpartyNameRaw", { length: 100 }),
  yearMonth: varchar("yearMonth", { length: 7 }).notNull(), // 'YYYY-MM'
  imageUrl: varchar("imageUrl", { length: 500 }),
  // OCR 원본 응답 전체
  ocrRawData: json("ocrRawData").notNull(),
  // 정규화된 항목 배열
  parsedItems: json("parsedItems").notNull(),
  ocrTotal: decimal("ocrTotal", { precision: 14, scale: 2 }),
  systemTotal: decimal("systemTotal", { precision: 14, scale: 2 }),
  // 비교 결과 요약 {dateMismatches, itemMismatches, missingInSystem, missingInStatement}
  diffSummary: json("diffSummary"),
  status: mysqlEnum("status", ["pending", "reviewed", "applied", "dismissed"]).default("pending").notNull(),
  // 사용자가 적용한 액션 로그
  appliedActions: json("appliedActions"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  reviewedAt: timestamp("reviewedAt"),
  appliedAt: timestamp("appliedAt"),
});

export type SettlementStatementAudit = typeof settlementStatementAudits.$inferSelect;

// ─── 시스템 설정 ──────────────────────────────────────────────────────────────
export const systemSettings = mysqlTable("system_settings", {
  id: int("id").autoincrement().primaryKey(),
  settingKey: varchar("settingKey", { length: 100 }).notNull().unique(),
  settingValue: text("settingValue"),
  description: varchar("description", { length: 255 }),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SystemSetting = typeof systemSettings.$inferSelect;

// ─── API 사용량 로그 ──────────────────────────────────────────────────────────
export const apiUsageLogs = mysqlTable("api_usage_logs", {
  id: int("id").autoincrement().primaryKey(),
  apiType: varchar("apiType", { length: 50 }).notNull(), // ocr, geocoding
  endpoint: varchar("endpoint", { length: 255 }),
  userId: int("userId"),
  restaurantId: int("restaurantId"),
  requestPayloadSize: int("requestPayloadSize"),
  responseTimeMs: int("responseTimeMs"),
  success: boolean("success").default(true).notNull(),
  errorMessage: text("errorMessage"),
  timingBreakdown: varchar("timingBreakdown", { length: 120 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ApiUsageLog = typeof apiUsageLogs.$inferSelect;

// ─── DB 백업 로그 ─────────────────────────────────────────────────────────────
export const dbBackupLogs = mysqlTable("db_backup_logs", {
  id: int("id").autoincrement().primaryKey(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileSizeBytes: int("fileSizeBytes"),
  tableCount: int("tableCount"),
  status: varchar("status", { length: 20 }).notNull().default("success"), // success, failed
  errorMessage: text("errorMessage"),
  durationMs: int("durationMs"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type DbBackupLog = typeof dbBackupLogs.$inferSelect;

// ─── 매장 초대 코드 ───────────────────────────────────────────────────────────
export const restaurantInvites = mysqlTable("restaurant_invites", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  role: mysqlEnum("invite_role", ["staff", "supervisor", "owner"]).notNull().default("staff"),
  createdBy: int("createdBy").notNull(),
  usedBy: int("usedBy"),
  usedAt: timestamp("usedAt"),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type RestaurantInvite = typeof restaurantInvites.$inferSelect;

// ─── 대체휴무/연차 상세 이력 ────────────────────────────────────────────────────
export const leaveTransactions = mysqlTable("leave_transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  restaurantId: int("restaurantId").notNull(),
  year: int("year").notNull(),
  leaveType: mysqlEnum("leave_tx_type", ["annual", "substitute"]).notNull(),
  // earn = 발생, use = 소진
  txType: mysqlEnum("tx_type", ["earn", "use"]).notNull(),
  days: decimal("days", { precision: 5, scale: 1 }).notNull().default("1"),
  // 대체휴무: 어떤 공휴일 근무로 발생했는지
  holidayDate: date("holidayDate"),         // 공휴일 날짜
  holidayName: varchar("holidayName", { length: 50 }), // 공휴일명
  scheduleId: int("scheduleId"),            // 관련 스케줄 ID
  // 소진: 언제 사용했는지
  useDate: date("useDate"),                 // 소진일
  note: text("note"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type LeaveTransaction = typeof leaveTransactions.$inferSelect;

// ─── 레시피 게시판 ────────────────────────────────────────────────────────────
export const recipes = mysqlTable("recipes", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  title: varchar("title", { length: 200 }).notNull(),           // 메뉴명
  category: varchar("category", { length: 50 }),                 // 분류 (메인, 사이드, 음료 등)
  imageUrl: varchar("imageUrl", { length: 500 }),                // 대표 사진
  content: text("content"),                                       // 레시피 본문 (재료, 조리법 등)
  sortOrder: int("sortOrder").default(0).notNull(),
  isPublished: boolean("isPublished").default(true).notNull(),
  // ─── 원가 계산 (2026-06-18) ──────────────────────────────────────────────
  servingYield: decimal("servingYield", { precision: 10, scale: 2 }).notNull().default("1"),
  sellingPrice: decimal("sellingPrice", { precision: 14, scale: 2 }),
  lossRate: decimal("lossRate", { precision: 5, scale: 4 }).notNull().default("0"),
  createdBy: int("createdBy").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Recipe = typeof recipes.$inferSelect;

// ─── 레시피 재료행 ────────────────────────────────────────────────────────────
export const recipeIngredients = mysqlTable("recipe_ingredients", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  recipeId: int("recipeId").notNull(),
  itemId: int("itemId"),
  rawName: varchar("rawName", { length: 100 }),
  quantity: decimal("quantity", { precision: 10, scale: 4 }).notNull().default("1"),
  unitName: varchar("unitName", { length: 30 }),
  yieldRate: decimal("yieldRate", { precision: 5, scale: 4 }).notNull().default("1.0000"),
  sortOrder: int("sortOrder").notNull().default(0),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("idx_ri_recipe").on(t.recipeId),
  index("idx_ri_restaurant").on(t.restaurantId),
]);
export type RecipeIngredient = typeof recipeIngredients.$inferSelect;

// ─── 매장 업무정보 (카드형) ───────────────────────────────────────────────────
export const storeInfoCards = mysqlTable("store_info_cards", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  cardType: varchar("cardType", { length: 30 }).notNull(),       // notice, access, contact, etc.
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content"),                                       // 본문 (마크다운 or 일반 텍스트)
  imageUrl: varchar("imageUrl", { length: 500 }),
  sortOrder: int("sortOrder").default(0).notNull(),
  isPinned: boolean("isPinned").default(false).notNull(),
  isPublished: boolean("isPublished").default(true).notNull(),
  createdBy: int("createdBy").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type StoreInfoCard = typeof storeInfoCards.$inferSelect;

// ─── 매장별 근무 프리셋 시간 ─────────────────────────────────────────────────
export const restaurantShiftPresets = mysqlTable("restaurant_shift_presets", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  presetType: varchar("presetType", { length: 30 }).notNull(),   // open, full, close, 또는 커스텀 키
  dayType: varchar("dayType", { length: 20 }).notNull().default("weekday"), // weekday, weekend
  label: varchar("label", { length: 30 }).notNull().default(""),  // UI 표시명
  startTime: varchar("startTime", { length: 5 }).notNull(),       // HH:MM
  endTime: varchar("endTime", { length: 5 }).notNull(),           // HH:MM
  breakMinutes: int("breakMinutes").default(0).notNull(),
  isCustom: boolean("isCustom").default(false).notNull(),          // 기본 vs 사용자 정의
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type RestaurantShiftPreset = typeof restaurantShiftPresets.$inferSelect;

// ─── 월정산 증빙 이미지 ─────────────────────────────────────────────────────
export const settlementImages = mysqlTable("settlement_images", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  year: int("year").notNull(),
  month: int("month").notNull(),
  counterpartyId: int("counterpartyId"),              // NULL = 기타/전체
  imageUrl: text("imageUrl").notNull(),
  claimedAmount: int("claimedAmount"),                // 정산서 기재 금액 (원)
  note: varchar("note", { length: 200 }),
  uploadedBy: int("uploadedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SettlementImage = typeof settlementImages.$inferSelect;

// ─── 사업주 프리셋 (계약서 사업주 태그) ─────────────────────────────────────────
export const employerPresets = mysqlTable("employer_presets", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  companyName: varchar("companyName", { length: 100 }).notNull(),
  businessNumber: varchar("businessNumber", { length: 30 }),  // 사업자등록번호
  isDefault: boolean("isDefault").default(false).notNull(),    // 기본 선택 여부
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type EmployerPreset = typeof employerPresets.$inferSelect;

// ─── 소속회사 마스터 (5인 미만/이상 + 사업장 단위 박제 — 재설계 2026-05-02) ───
// employer_presets 후속. 한 매장에 여러 소속회사 등록 가능, 회사별로 5인 미만/이상 토글.
// 계약서 작성 시 affiliated_companies에서 선택 → over5Employees 자동 결정 → 서명 시점 박제.
// 시드: server/index.ts 마이그레이션이 employer_presets에서 over5Employees=false 로 복제.
export const affiliatedCompanies = mysqlTable(
  "affiliated_companies",
  {
    id: int("id").autoincrement().primaryKey(),
    restaurantId: int("restaurantId").notNull(),
    companyName: varchar("companyName", { length: 100 }).notNull(),
    businessNumber: varchar("businessNumber", { length: 20 }),
    over5Employees: boolean("over5Employees").default(false).notNull(),
    isDefault: boolean("isDefault").default(false).notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [uniqueIndex("uniq_restaurant_company").on(t.restaurantId, t.companyName)]
);
export type AffiliatedCompany = typeof affiliatedCompanies.$inferSelect;
export type InsertAffiliatedCompany = typeof affiliatedCompanies.$inferInsert;

// ─── 즉시지출 카테고리 ────────────────────────────────────────────────────────
export const expenseCategories = mysqlTable("expense_categories", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ExpenseCategory = typeof expenseCategories.$inferSelect;

// ─── 즉시지출 기록 ──────────────────────────────────────────────────────────
export const dailyExpenses = mysqlTable("daily_expenses", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  date: date("date").notNull(),
  categoryId: int("categoryId"),                                // expense_categories 참조
  category: varchar("category", { length: 50 }),                // 레거시 호환
  title: varchar("title", { length: 200 }).notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).default("0").notNull(),
  note: text("note"),
  attachmentUrl: text("attachmentUrl"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type DailyExpense = typeof dailyExpenses.$inferSelect;

// ─── POS: Menu (Phase 1, 2026-04-19) ─────────────────────────────────────────
export const posMenuCategories = mysqlTable(
  "pos_menu_categories",
  {
    id: int("id").autoincrement().primaryKey(),
    restaurantId: int("restaurantId").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    displayOrder: int("displayOrder").default(0).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    deletedAt: timestamp("deletedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("idx_pos_menu_cat_rest").on(t.restaurantId, t.displayOrder)]
);
export type PosMenuCategory = typeof posMenuCategories.$inferSelect;
export type InsertPosMenuCategory = typeof posMenuCategories.$inferInsert;

export const posMenuItems = mysqlTable(
  "pos_menu_items",
  {
    id: int("id").autoincrement().primaryKey(),
    restaurantId: int("restaurantId").notNull(),
    categoryId: int("categoryId"),
    name: varchar("name", { length: 150 }).notNull(),
    price: decimal("price", { precision: 12, scale: 2 }).notNull().default("0"),
    imageUrl: varchar("imageUrl", { length: 500 }),
    recipeId: int("recipeId"),
    taxType: mysqlEnum("taxType", ["taxable", "exempt", "zero"]).default("taxable").notNull(),
    isSoldOut: boolean("isSoldOut").default(false).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    displayOrder: int("displayOrder").default(0).notNull(),
    deletedAt: timestamp("deletedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    index("idx_pos_menu_item_rest").on(t.restaurantId, t.categoryId, t.displayOrder),
    index("idx_pos_menu_item_active").on(t.restaurantId, t.isActive, t.deletedAt),
  ]
);
export type PosMenuItem = typeof posMenuItems.$inferSelect;
export type InsertPosMenuItem = typeof posMenuItems.$inferInsert;

export const posMenuOptionGroups = mysqlTable(
  "pos_menu_option_groups",
  {
    id: int("id").autoincrement().primaryKey(),
    menuItemId: int("menuItemId").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    minSelect: int("minSelect").default(0).notNull(),
    maxSelect: int("maxSelect").default(1).notNull(),
    isRequired: boolean("isRequired").default(false).notNull(),
    displayOrder: int("displayOrder").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_pos_optgrp_item").on(t.menuItemId)]
);
export type PosMenuOptionGroup = typeof posMenuOptionGroups.$inferSelect;
export type InsertPosMenuOptionGroup = typeof posMenuOptionGroups.$inferInsert;

export const posMenuOptions = mysqlTable(
  "pos_menu_options",
  {
    id: int("id").autoincrement().primaryKey(),
    optionGroupId: int("optionGroupId").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    priceDelta: decimal("priceDelta", { precision: 10, scale: 2 }).default("0").notNull(),
    displayOrder: int("displayOrder").default(0).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_pos_opt_group").on(t.optionGroupId)]
);
export type PosMenuOption = typeof posMenuOptions.$inferSelect;
export type InsertPosMenuOption = typeof posMenuOptions.$inferInsert;

// ─── POS: Orders ─────────────────────────────────────────────────────────────
export const posOrders = mysqlTable(
  "pos_orders",
  {
    id: int("id").autoincrement().primaryKey(),
    uuid: varchar("uuid", { length: 36 }).notNull(),
    restaurantId: int("restaurantId").notNull(),
    orderNo: varchar("orderNo", { length: 16 }).notNull(),
    orderMode: mysqlEnum("orderMode", [
      "prepaid_pickup",
      "prepaid_table",
      "postpaid_table",
    ]).notNull(),
    tableNo: varchar("tableNo", { length: 30 }),
    pagerNo: varchar("pagerNo", { length: 30 }),
    status: mysqlEnum("status", [
      "open",
      "paid",
      "ready",
      "served",
      "voided",
      "refunded",
    ]).notNull().default("open"),
    subtotal: decimal("subtotal", { precision: 12, scale: 2 }).default("0").notNull(),
    discountTotal: decimal("discountTotal", { precision: 12, scale: 2 }).default("0").notNull(),
    taxTotal: decimal("taxTotal", { precision: 12, scale: 2 }).default("0").notNull(),
    grandTotal: decimal("grandTotal", { precision: 12, scale: 2 }).default("0").notNull(),
    customerNote: varchar("customerNote", { length: 500 }),
    voidReason: varchar("voidReason", { length: 200 }),
    createdByUserId: int("createdByUserId").notNull(),
    deviceId: int("deviceId"),
    openedAt: timestamp("openedAt").defaultNow().notNull(),
    paidAt: timestamp("paidAt"),
    readyAt: timestamp("readyAt"),
    servedAt: timestamp("servedAt"),
    voidedAt: timestamp("voidedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    uniqueIndex("uniq_pos_order_uuid").on(t.uuid),
    index("idx_pos_order_rest_status").on(t.restaurantId, t.status, t.openedAt),
    index("idx_pos_order_rest_created").on(t.restaurantId, t.createdAt),
  ]
);
export type PosOrder = typeof posOrders.$inferSelect;
export type InsertPosOrder = typeof posOrders.$inferInsert;

export const posOrderItems = mysqlTable(
  "pos_order_items",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("orderId").notNull(),
    menuItemId: int("menuItemId"),
    menuItemNameSnapshot: varchar("menuItemNameSnapshot", { length: 150 }).notNull(),
    unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
    qty: int("qty").notNull().default(1),
    lineDiscount: decimal("lineDiscount", { precision: 10, scale: 2 }).default("0").notNull(),
    lineTotal: decimal("lineTotal", { precision: 12, scale: 2 }).notNull(),
    status: mysqlEnum("status", ["active", "voided"]).default("active").notNull(),
    note: varchar("note", { length: 200 }),
    voidedAt: timestamp("voidedAt"),
    voidedByUserId: int("voidedByUserId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_pos_orderitem_order").on(t.orderId)]
);
export type PosOrderItem = typeof posOrderItems.$inferSelect;
export type InsertPosOrderItem = typeof posOrderItems.$inferInsert;

export const posOrderItemOptions = mysqlTable(
  "pos_order_item_options",
  {
    id: int("id").autoincrement().primaryKey(),
    orderItemId: int("orderItemId").notNull(),
    optionName: varchar("optionName", { length: 100 }).notNull(),
    priceDelta: decimal("priceDelta", { precision: 10, scale: 2 }).default("0").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_pos_orderitemopt_item").on(t.orderItemId)]
);
export type PosOrderItemOption = typeof posOrderItemOptions.$inferSelect;
export type InsertPosOrderItemOption = typeof posOrderItemOptions.$inferInsert;

// ─── POS: Payments ───────────────────────────────────────────────────────────
export const posPayments = mysqlTable(
  "pos_payments",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("orderId").notNull(),
    method: mysqlEnum("method", [
      "card",
      "cash",
      "samsungpay",
      "kakaopay",
      "naverpay",
      "gift",
      "external",
      "etc",
    ]).notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    approvalNo: varchar("approvalNo", { length: 64 }),
    cardBrand: varchar("cardBrand", { length: 30 }),
    providerType: mysqlEnum("providerType", [
      "external_dept_store",
      "terminal_bridge",
      "van_direct",
      "manual",
    ]).notNull().default("manual"),
    providerRef: varchar("providerRef", { length: 200 }),
    createdByUserId: int("createdByUserId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    voidedAt: timestamp("voidedAt"),
  },
  (t) => [index("idx_pos_payment_order").on(t.orderId)]
);
export type PosPayment = typeof posPayments.$inferSelect;
export type InsertPosPayment = typeof posPayments.$inferInsert;

// ─── POS: Devices ────────────────────────────────────────────────────────────
export const posDevices = mysqlTable(
  "pos_devices",
  {
    id: int("id").autoincrement().primaryKey(),
    restaurantId: int("restaurantId").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    deviceType: mysqlEnum("deviceType", [
      "staff_counter",
      "staff_table",
      "kiosk",
      "kds",
    ]).notNull(),
    deviceTokenHash: varchar("deviceTokenHash", { length: 255 }),
    isActive: boolean("isActive").default(true).notNull(),
    lastSeenAt: timestamp("lastSeenAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_pos_device_rest").on(t.restaurantId, t.deviceType)]
);
export type PosDevice = typeof posDevices.$inferSelect;
export type InsertPosDevice = typeof posDevices.$inferInsert;

// ─── POS: Print Jobs (브릿지 에이전트 폴링용, 1차 미사용) ──────────────────────
export const posPrintJobs = mysqlTable(
  "pos_print_jobs",
  {
    id: int("id").autoincrement().primaryKey(),
    restaurantId: int("restaurantId").notNull(),
    orderId: int("orderId").notNull(),
    printerType: mysqlEnum("printerType", ["kitchen", "receipt"]).notNull(),
    payload: json("payload").notNull(),
    status: mysqlEnum("status", ["pending", "printed", "failed"]).default("pending").notNull(),
    attempts: int("attempts").default(0).notNull(),
    errorMsg: varchar("errorMsg", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    printedAt: timestamp("printedAt"),
    failedAt: timestamp("failedAt"),
  },
  (t) => [index("idx_pos_printjob_rest_status").on(t.restaurantId, t.status, t.createdAt)]
);
export type PosPrintJob = typeof posPrintJobs.$inferSelect;
export type InsertPosPrintJob = typeof posPrintJobs.$inferInsert;

// ─── POS: Daily Reconciliation (외부 결제 매장 일일 대조) ────────────────────
export const posDailyReconciliation = mysqlTable(
  "pos_daily_reconciliation",
  {
    id: int("id").autoincrement().primaryKey(),
    restaurantId: int("restaurantId").notNull(),
    date: date("date").notNull(),
    posGross: decimal("posGross", { precision: 14, scale: 2 }).default("0").notNull(),
    externalGross: decimal("externalGross", { precision: 14, scale: 2 }).default("0").notNull(),
    diff: decimal("diff", { precision: 14, scale: 2 }).default("0").notNull(),
    note: varchar("note", { length: 500 }),
    confirmedByUserId: int("confirmedByUserId"),
    confirmedAt: timestamp("confirmedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [uniqueIndex("uniq_pos_recon_rest_date").on(t.restaurantId, t.date)]
);
export type PosDailyReconciliation = typeof posDailyReconciliation.$inferSelect;
export type InsertPosDailyReconciliation = typeof posDailyReconciliation.$inferInsert;

// ─── POS: Order No Counter (매장별 일일 리셋) ────────────────────────────────
export const posOrderCounters = mysqlTable(
  "pos_order_counters",
  {
    id: int("id").autoincrement().primaryKey(),
    restaurantId: int("restaurantId").notNull(),
    date: date("date").notNull(),
    lastSeq: int("lastSeq").default(0).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [uniqueIndex("uniq_pos_ordercnt_rest_date").on(t.restaurantId, t.date)]
);
export type PosOrderCounter = typeof posOrderCounters.$inferSelect;
export type InsertPosOrderCounter = typeof posOrderCounters.$inferInsert;

// ─── 피드백/버그 제보 ────────────────────────────────────────────────────────
export const userFeedbacks = mysqlTable("user_feedbacks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  restaurantId: int("restaurantId"),
  type: mysqlEnum("type", ["bug", "suggestion"]).notNull().default("bug"),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content").notNull(),
  screenshotBase64: mediumtext("screenshotBase64"),
  status: mysqlEnum("status", ["pending", "reviewed", "resolved"]).notNull().default("pending"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type UserFeedback = typeof userFeedbacks.$inferSelect;
