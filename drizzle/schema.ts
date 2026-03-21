import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  date,
  boolean,
  json,
} from "drizzle-orm/mysql-core";

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  // 시스템 역할: master > admin > manager > employee
  role: mysqlEnum("role", ["master", "admin", "manager", "employee", "user"]).default("employee").notNull(),
  // 로그인용 username (직원명)
  username: varchar("username", { length: 100 }),
  // 비밀번호 해시 (자체 로그인용)
  passwordHash: varchar("passwordHash", { length: 255 }),
  phone: varchar("phone", { length: 30 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Restaurants ─────────────────────────────────────────────────────────────
export const restaurants = mysqlTable("restaurants", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  address: varchar("address", { length: 255 }),
  phone: varchar("phone", { length: 30 }),
  // 월 매출 목표 (원)
  monthlyTargetSales: decimal("monthlyTargetSales", { precision: 14, scale: 2 }).default("0"),
  // 인건비 목표 비율 (%)
  targetLaborRatio: decimal("targetLaborRatio", { precision: 5, scale: 2 }).default("30"),
  // 총비용 목표 비율 (%)
  targetCostRatio: decimal("targetCostRatio", { precision: 5, scale: 2 }).default("80"),
  isActive: boolean("isActive").default(true).notNull(),
  // 소프트 삭제 일시 (null이면 활성, 1년 후 자동 영구 삭제)
  deletedAt: timestamp("deletedAt"),
  // 매출 입력 허용 시작 시각 (HH:MM, null이면 제한 없음)
  salesInputStartTime: varchar("salesInputStartTime", { length: 5 }),
  // 매출 입력 허용 종료 시각 (HH:MM, null이면 제한 없음)
  salesInputEndTime: varchar("salesInputEndTime", { length: 5 }),
  // 매장 운영 오픈 시각 (HH:MM, 기본값 09:00) — 스케줄 프리셋 기준
  openTime: varchar("openTime", { length: 5 }).default("09:00"),
  // 매장 운영 마감 시각 (HH:MM, 기본값 22:00) — 스케줄 프리셋 기준
  closeTime: varchar("closeTime", { length: 5 }).default("22:00"),
  // 반차 판별 기준: 전체 운영시간 대비 근무시간 비율(%) 미만이면 반차 (기본값 60)
  halfShiftThreshold: int("halfShiftThreshold").default(60).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Restaurant = typeof restaurants.$inferSelect;
export type InsertRestaurant = typeof restaurants.$inferInsert;

// ─── Restaurant ↔ User (소속/관리 관계) ──────────────────────────────────────
export const restaurantUsers = mysqlTable("restaurant_users", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  userId: int("userId").notNull(),
  // 이 매장에서의 역할: store_manager(점장/부점장), manager(매니저), employee(일반직원)
  role: mysqlEnum("role", ["store_manager", "manager", "employee"]).notNull().default("employee"),
  // 역할 변경 이력 (마지막 변경 사유)
  roleChangedAt: timestamp("roleChangedAt"),
  roleChangedBy: int("roleChangedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RestaurantUser = typeof restaurantUsers.$inferSelect;
export type InsertRestaurantUser = typeof restaurantUsers.$inferInsert;

// ─── Employee Contracts (직원 계약 정보) ──────────────────────────────────────
export const employeeContracts = mysqlTable("employee_contracts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  restaurantId: int("restaurantId").notNull(),
  // 급여 형태
  wageType: mysqlEnum("wageType", ["hourly", "monthly"]).notNull().default("hourly"),
  // 급여액 (시급 or 월급)
  wageAmount: decimal("wageAmount", { precision: 12, scale: 2 }).notNull().default("0"),
  // 직책
  position: varchar("position", { length: 50 }),
  // 계약 시작일
  contractStart: date("contractStart"),
  // 계약 종료일
  contractEnd: date("contractEnd"),
  // 계약 내용 (자유 텍스트)
  contractNote: text("contractNote"),
  // 주 소정 근로 시간
  weeklyHours: decimal("weeklyHours", { precision: 5, scale: 2 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmployeeContract = typeof employeeContracts.$inferSelect;
export type InsertEmployeeContract = typeof employeeContracts.$inferInsert;

// ─── Employee Leaves (연차/대체휴무 발생 및 사용 기록) ─────────────────────────────
export const employeeLeaves = mysqlTable("employee_leaves", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  restaurantId: int("restaurantId").notNull(),
  year: int("year").notNull(),
  // 휴가 유형: annual(연차), substitute(대체휴무), sick(병가), other(기타)
  leaveType: mysqlEnum("leaveType", ["annual", "substitute", "sick", "other"]).notNull().default("annual"),
  // 발생한 연차/휴무 일수
  totalDays: decimal("totalDays", { precision: 5, scale: 1 }).notNull().default("0"),
  // 사용한 연차/휴무 일수
  usedDays: decimal("usedDays", { precision: 5, scale: 1 }).notNull().default("0"),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type EmployeeLeave = typeof employeeLeaves.$inferSelect;
export type InsertEmployeeLeave = typeof employeeLeaves.$inferInsert;

// ─── Schedules (근무 스케줄) ──────────────────────────────────────────────────
export const schedules = mysqlTable("schedules", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),  // NULL 허용 — 임시 근로자는 userId 없음
  tempWorkerName: varchar("tempWorkerName", { length: 100 }),  // 임시/급구 근로자 이름
  tempWageType: mysqlEnum("tempWageType", ["hourly", "daily"]),  // 임시 근로자 임금 유형
  tempWageAmount: decimal("tempWageAmount", { precision: 10, scale: 2 }),  // 임시 근로자 시급/일당
  restaurantId: int("restaurantId").notNull(),
  // 근무 시작 (Unix ms UTC)
  startTime: timestamp("startTime").notNull(),
  // 근무 종료 (Unix ms UTC)
  endTime: timestamp("endTime").notNull(),
  // 상태: scheduled(예정), published(고지됨), completed(근무완료), confirmed(인건비확정), canceled(취소)
  status: mysqlEnum("status", ["draft", "scheduled", "published", "completed", "confirmed", "canceled"]).default("published").notNull(),
  // 근무 프리셋: open(오픈반차), full(종일), close(마감반차), custom(직접입력)
  shiftPreset: mysqlEnum("shiftPreset", ["open", "full", "close", "custom"]).default("custom"),
  // 메모
  note: text("note"),
  // 확정 후 수정 시 사유 기록
  editReason: text("editReason"),
  // 확정 후 수정 시 인건비 재검토 필요 여부
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
export type InsertSchedule = typeof schedules.$inferInsert;

// ─── Schedule Change Requests (스케줄 변경 요청) ─────────────────────────────
export const scheduleChangeRequests = mysqlTable("schedule_change_requests", {
  id: int("id").autoincrement().primaryKey(),
  scheduleId: int("scheduleId").notNull(),
  requestedBy: int("requestedBy").notNull(),
  restaurantId: int("restaurantId").notNull(),
  // 요청 유형: swap(교환), change(시간변경), off(휴무요청)
  requestType: mysqlEnum("requestType", ["swap", "change", "off"]).notNull().default("change"),
  // 요청 사유
  reason: text("reason"),
  // 원하는 시작 시간 (change 타입일 때)
  requestedStartTime: timestamp("requestedStartTime"),
  // 원하는 종료 시간 (change 타입일 때)
  requestedEndTime: timestamp("requestedEndTime"),
  // 교환 대상 스케줄 ID (swap 타입일 때)
  swapTargetScheduleId: int("swapTargetScheduleId"),
  // 처리 상태: pending, approved, rejected
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  // 처리자
  reviewedBy: int("reviewedBy"),
  reviewNote: text("reviewNote"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ScheduleChangeRequest = typeof scheduleChangeRequests.$inferSelect;
export type InsertScheduleChangeRequest = typeof scheduleChangeRequests.$inferInsert;

// ─── Sales (매출) ─────────────────────────────────────────────────────────────
export const sales = mysqlTable("sales", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  saleDate: date("saleDate").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  // 메모 (예: 점심 매출, 저녁 매출)
  note: text("note"),
  // 데이터 출처: manual, pos_brand_a 등
  source: varchar("source", { length: 50 }).default("manual"),
  // POS API 원본 데이터
  rawData: json("rawData"),
  recordedBy: int("recordedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Sale = typeof sales.$inferSelect;
export type InsertSale = typeof sales.$inferInsert;

// ─── Purchases (매입) ─────────────────────────────────────────────────────────
export const purchases = mysqlTable("purchases", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  purchaseDate: date("purchaseDate").notNull(),
  // 거래처명
  vendorName: varchar("vendorName", { length: 100 }),
  // 품목명
  itemName: varchar("itemName", { length: 200 }).notNull(),
  // 비용
  cost: decimal("cost", { precision: 14, scale: 2 }).notNull(),
  // 카테고리: food(식재료), supply(소모품), utility(공과금), other(기타)
  category: mysqlEnum("category", ["food", "supply", "utility", "other"]).default("food"),
  // 명세서 이미지 URL (S3)
  receiptImageUrl: varchar("receiptImageUrl", { length: 500 }),
  receiptImageKey: varchar("receiptImageKey", { length: 300 }),
  note: text("note"),
  source: varchar("source", { length: 50 }).default("manual"),
  rawData: json("rawData"),
  recordedBy: int("recordedBy"),
  // 발주/입고 상태: received(입고완료), ordered(발주중)
  purchaseStatus: mysqlEnum("purchaseStatus", ["received", "ordered"]).default("received").notNull(),
  // 예상 입고일 (발주 상태일 때)
  expectedArrivalDate: date("expectedArrivalDate"),
  // 실제 입고 확인 일시
  arrivedAt: timestamp("arrivedAt"),
  // 입고 확인한 사용자 ID
  arrivedBy: int("arrivedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Purchase = typeof purchases.$inferSelect;
export type InsertPurchase = typeof purchases.$inferInsert;

// ─── Monthly Fixed Costs (월 고정비) ─────────────────────────────────────────
export const monthlyFixedCosts = mysqlTable("monthly_fixed_costs", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  // 적용 월 (YYYY-MM)
  effectiveMonth: varchar("effectiveMonth", { length: 7 }).notNull(),
  // 비용 항목명
  costCategory: varchar("costCategory", { length: 100 }).notNull(),
  // 세부 분류: rent(임대), utility(공과금), fee(수수료), labor_fixed(고정 인건비), other(기타)
  categoryType: mysqlEnum("categoryType", ["rent", "utility", "fee", "labor_fixed", "other"]).default("other"),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  note: text("note"),
  // 적용 기간 (NULL이면 상시)
  startDate: date("startDate"),
  endDate: date("endDate"),
  // 계약 조건에서 자동 생성된 경우 해당 계약 ID (null이면 수동 입력)
  contractId: int("contractId"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MonthlyFixedCost = typeof monthlyFixedCosts.$inferSelect;
export type InsertMonthlyFixedCost = typeof monthlyFixedCosts.$inferInsert;

// ─── Restaurant Contracts (매장 계약 조건) ───────────────────────────────────
export const restaurantContracts = mysqlTable("restaurant_contracts", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  // 계약 유형: rent(임대료), commission(임대수수료), royalty(본사로얄티), investor(투자자지분), other(기타)
  contractType: mysqlEnum("contractType", ["rent", "commission", "royalty", "investor", "other"]).notNull(),
  // 항목명 (예: "강남역 1호점 임대료", "본사 로얄티")
  name: varchar("name", { length: 200 }).notNull(),
  // 계산 방식: fixed(고정금액), ratio(매출비율%)
  calcType: mysqlEnum("calcType", ["fixed", "ratio"]).notNull().default("fixed"),
  // 고정금액 (calcType=fixed일 때 사용)
  fixedAmount: decimal("fixedAmount", { precision: 14, scale: 2 }).default("0"),
  // 매출 대비 비율 % (calcType=ratio일 때 사용)
  ratioPercent: decimal("ratioPercent", { precision: 6, scale: 3 }).default("0"),
  // 계약 시작일
  startDate: date("startDate"),
  // 계약 종료일
  endDate: date("endDate"),
  // 메모
  note: text("note"),
  // 자동으로 월 고정비에 반영 여부
  autoApplyToFixedCost: boolean("autoApplyToFixedCost").default(true).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RestaurantContract = typeof restaurantContracts.$inferSelect;
export type InsertRestaurantContract = typeof restaurantContracts.$inferInsert;

// ─── Employment Electronic Contracts (전자 근로계약서) ──────────────────────────
export const employmentElectronicContracts = mysqlTable("employment_electronic_contracts", {
  id: int("id").autoincrement().primaryKey(),
  // 계약서 고유 토큰 (직원 서명 링크용)
  token: varchar("token", { length: 64 }).notNull().unique(),
  restaurantId: int("restaurantId").notNull(),
  // 직원 userId (null이면 아직 계정 없는 직원)
  employeeId: int("employeeId"),
  // 직원 이름 (계정 없는 경우 직접 입력)
  employeeName: varchar("employeeName", { length: 100 }).notNull(),
  // 직원 연락처
  employeePhone: varchar("employeePhone", { length: 30 }),
  // 직원 생년월일
  employeeBirthdate: varchar("employeeBirthdate", { length: 10 }),
  // 직원 주소
  employeeAddress: text("employeeAddress"),
  // 직책/포지션
  position: varchar("position", { length: 50 }).notNull().default("직원"),
  // 계약 유형: permanent(정규직), fixed_term(기간제), part_time(단시간), daily(일용직)
  contractType: mysqlEnum("contractType", ["permanent", "fixed_term", "part_time", "daily"]).notNull().default("part_time"),
  // 계약 시작일
  contractStart: date("contractStart").notNull(),
  // 계약 종료일 (무기계약 시 null)
  contractEnd: date("contractEnd"),
  // 수습 기간 여부
  hasProbation: boolean("hasProbation").default(false).notNull(),
  // 수습 기간 (개월)
  probationMonths: int("probationMonths").default(0),
  // 근무 장소
  workPlace: varchar("workPlace", { length: 200 }),
  // 담당 업무
  jobDescription: text("jobDescription"),
  // 급여 형태: hourly(시급), monthly(월급)
  wageType: mysqlEnum("wageType", ["hourly", "monthly"]).notNull().default("hourly"),
  // 기본 급여액
  wageAmount: decimal("wageAmount", { precision: 12, scale: 2 }).notNull(),
  // 주 소정 근로시간
  weeklyHours: decimal("weeklyHours", { precision: 5, scale: 2 }).notNull().default("40"),
  // 근무 시작 시각 (HH:MM)
  workStartTime: varchar("workStartTime", { length: 5 }).default("09:00"),
  // 근무 종료 시각 (HH:MM)
  workEndTime: varchar("workEndTime", { length: 5 }).default("18:00"),
  // 휴게시간 (분)
  breakMinutes: int("breakMinutes").default(60),
  // 주휴일
  weeklyHoliday: varchar("weeklyHoliday", { length: 20 }).default("일요일"),
  // 임금 지급일 (매월 N일)
  payDay: int("payDay").default(25),
  // 임금 지급 방법: bank_transfer(계좌이체), cash(현금)
  payMethod: mysqlEnum("payMethod", ["bank_transfer", "cash"]).default("bank_transfer"),
  // 식대 제공 여부
  mealProvided: boolean("mealProvided").default(false).notNull(),
  // 식대 금액 (현금 지급 시)
  mealAllowance: decimal("mealAllowance", { precision: 10, scale: 2 }).default("0"),
  // 4대보험 가입 여부
  socialInsurance: boolean("socialInsurance").default(true).notNull(),
  // 5인 이상 사업장 여부 (연장/야간/휴일 수당 적용)
  over5Employees: boolean("over5Employees").default(false).notNull(),
  // 야간 근무 동의 여부
  nightShiftConsent: boolean("nightShiftConsent").default(false).notNull(),
  // 특약사항
  specialTerms: text("specialTerms"),
  // 계약서 상태: draft(초안), sent(발송됨), signed(서명완료), expired(만료), cancelled(취소)
  status: mysqlEnum("status", ["draft", "sent", "signed", "expired", "cancelled"]).notNull().default("draft"),
  // 발송 일시
  sentAt: timestamp("sentAt"),
  // 직원 서명 일시
  signedAt: timestamp("signedAt"),
  // 직원 서명 데이터 (base64 이미지 또는 텍스트 서명)
  employeeSignature: text("employeeSignature"),
  // 직원 서명 시 IP
  signedIp: varchar("signedIp", { length: 45 }),
  // 갱신 원본 계약서 ID (계약 갱신 시 이전 계약서 참조)
  previousContractId: int("previousContractId"),
  // 계약서 생성자 (점장 userId)
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmploymentElectronicContract = typeof employmentElectronicContracts.$inferSelect;
export type InsertEmploymentElectronicContract = typeof employmentElectronicContracts.$inferInsert;

// ─── Daily Operations (오픈/마감 체크) ──────────────────────────────────────────
export const dailyOperations = mysqlTable("daily_operations", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  // 영업일 (YYYY-MM-DD)
  operationDate: date("operationDate").notNull(),
  // 오픈 체크 일시
  openCheckedAt: timestamp("openCheckedAt"),
  // 오픈 체크한 사용자
  openCheckedBy: int("openCheckedBy"),
  // 오픈 시 출근 인원 수
  openHeadcount: int("openHeadcount").default(0),
  // 오픈 시 예상 인건비 (원)
  openLaborCost: decimal("openLaborCost", { precision: 14, scale: 2 }).default("0"),
  // 마감 체크 일시
  closeCheckedAt: timestamp("closeCheckedAt"),
  // 마감 체크한 사용자
  closeCheckedBy: int("closeCheckedBy"),
  // 마감 시 최종 출근 인원 수
  closeHeadcount: int("closeHeadcount").default(0),
  // 마감 시 최종 인건비 (원)
  closeLaborCost: decimal("closeLaborCost", { precision: 14, scale: 2 }).default("0"),
  // 마감 메모
  closeNote: text("closeNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DailyOperation = typeof dailyOperations.$inferSelect;
export type InsertDailyOperation = typeof dailyOperations.$inferInsert;

// ─── Daily Sales Detail (일 매출 상세) ───────────────────────────────────────
export const dailySalesDetail = mysqlTable("daily_sales_detail", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  // 영업일 (YYYY-MM-DD)
  saleDate: date("saleDate").notNull(),
  // 현금 매출
  cashAmount: decimal("cashAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  // 카드 매출
  cardAmount: decimal("cardAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  // 영수 건수
  receiptCount: int("receiptCount").default(0).notNull(),
  // 할인 금액
  discountAmount: decimal("discountAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  // 기타 매출 합계 (salesOtherItems 합산)
  otherAmount: decimal("otherAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  // 총 매출 (현금+카드+기타-할인)
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  // 입력 상태: draft(임시저장), submitted(제출), confirmed(점장/매니저 확인)
  status: mysqlEnum("status", ["draft", "submitted", "confirmed"]).default("draft").notNull(),
  // 확인한 사용자 (점장/매니저)
  confirmedBy: int("confirmedBy"),
  // 확인 일시
  confirmedAt: timestamp("confirmedAt"),
  // 입력자
  recordedBy: int("recordedBy"),
  // 메모
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DailySalesDetail = typeof dailySalesDetail.$inferSelect;
export type InsertDailySalesDetail = typeof dailySalesDetail.$inferInsert;

// ─── Sales Other Items (기타 매출 항목 - 상품권/카카오페이/쿠폰 등) ─────────────
export const salesOtherItems = mysqlTable("sales_other_items", {
  id: int("id").autoincrement().primaryKey(),
  dailySalesDetailId: int("dailySalesDetailId").notNull(),
  restaurantId: int("restaurantId").notNull(),
  // 항목명 (예: 상품권, 카카오페이, 쿠폰)
  itemName: varchar("itemName", { length: 100 }).notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SalesOtherItem = typeof salesOtherItems.$inferSelect;
export type InsertSalesOtherItem = typeof salesOtherItems.$inferInsert;

// ─── Sales Other Item Templates (자주 쓰는 기타 매출 항목명 저장) ──────────────
export const salesOtherItemTemplates = mysqlTable("sales_other_item_templates", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  itemName: varchar("itemName", { length: 100 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SalesOtherItemTemplate = typeof salesOtherItemTemplates.$inferSelect;
export type InsertSalesOtherItemTemplate = typeof salesOtherItemTemplates.$inferInsert;

// ─── Intermediate Sales (중간 매출) ──────────────────────────────────────────
export const intermediateSales = mysqlTable("intermediate_sales", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  // 영업일 (YYYY-MM-DD)
  saleDate: date("saleDate").notNull(),
  // 중간 매출 총액
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  // 입력 시각
  recordedAt: timestamp("recordedAt").defaultNow().notNull(),
  // 입력자
  recordedBy: int("recordedBy"),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type IntermediateSale = typeof intermediateSales.$inferSelect;
export type InsertIntermediateSale = typeof intermediateSales.$inferInsert;

// ─── Notifications (알림) ─────────────────────────────────────────────────────
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  // 수신자 (null이면 마스터 전체)
  recipientId: int("recipientId"),
  // 알림 유형: schedule_change, cost_exceeded, target_achieved, general
  type: mysqlEnum("type", ["schedule_change", "cost_exceeded", "target_achieved", "general", "schedule_assigned", "schedule_updated", "schedule_deleted"]).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content"),
  // 관련 매장
  restaurantId: int("restaurantId"),
  isRead: boolean("isRead").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

// ─── Counterparties (거래처 통합 관리) ────────────────────────────────────────
// 식재료 공급업체, 온라인스토어, 마트, 수리업체 등을 통합 관리
export const counterparties = mysqlTable("counterparties", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  counterpartyType: mysqlEnum("counterpartyType", ["supplier", "online", "mart", "repair", "other"]).default("supplier").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Counterparty = typeof counterparties.$inferSelect;
export type InsertCounterparty = typeof counterparties.$inferInsert;

// ─── Items (공통 품목 마스터) ─────────────────────────────────────────────────
// 같은 품목을 여러 거래처에서 살 수 있게 하기 위한 기준 테이블
export const items = mysqlTable("items", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  itemType: mysqlEnum("itemType", ["product", "service", "misc"]).default("product").notNull(),
  costingCategory: varchar("costingCategory", { length: 50 }),
  baseUnit: varchar("baseUnit", { length: 30 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Item = typeof items.$inferSelect;
export type InsertItem = typeof items.$inferInsert;

// ─── CounterpartyItems (거래처-품목 매핑) ────────────────────────────────────
// 같은 공통 품목의 거래처별 가격/단위/환산값 저장
export const counterpartyItems = mysqlTable("counterparty_items", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  counterpartyId: int("counterpartyId").notNull(),
  itemId: int("itemId").notNull(),
  // 거래처에서 부르는 품목명 (공통 품목명과 다를 수 있음)
  supplierItemName: varchar("supplierItemName", { length: 100 }),
  purchaseUnit: varchar("purchaseUnit", { length: 30 }),
  conversionToBase: decimal("conversionToBase", { precision: 10, scale: 4 }).default("1"),
  decimalAllowed: boolean("decimalAllowed").default(false).notNull(),
  quantityStep: decimal("quantityStep", { precision: 10, scale: 4 }).default("1"),
  defaultPrice: decimal("defaultPrice", { precision: 14, scale: 2 }),
  lastPrice: decimal("lastPrice", { precision: 14, scale: 2 }),
  // 이 거래처-품목 조합을 기본으로 사용할지 여부
  isPreferred: boolean("isPreferred").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CounterpartyItem = typeof counterpartyItems.$inferSelect;
export type InsertCounterpartyItem = typeof counterpartyItems.$inferInsert;

// ─── PurchaseOrdersV2 (매입 헤더 v2) ─────────────────────────────────────────
// 기존 purchases 테이블은 레거시로 유지, 새 구조는 이 테이블 사용
export const purchaseOrdersV2 = mysqlTable("purchase_orders_v2", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  counterpartyId: int("counterpartyId"),
  purchaseDate: date("purchaseDate").notNull(),
  status: mysqlEnum("status", ["received", "ordered"]).default("received").notNull(),
  note: text("note"),
  attachmentUrl: text("attachmentUrl"),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastModifiedBy: int("lastModifiedBy"),
  lastModifiedAt: timestamp("lastModifiedAt"),
  editHistory: json("editHistory").$type<Array<{userId: number; userName: string; at: string; summary: string}>>()
});

export type PurchaseOrderV2 = typeof purchaseOrdersV2.$inferSelect;
export type InsertPurchaseOrderV2 = typeof purchaseOrdersV2.$inferInsert;

// ─── PurchaseOrderItemsV2 (매입 항목행 v2) ───────────────────────────────────
export const purchaseOrderItemsV2 = mysqlTable("purchase_order_items_v2", {
  id: int("id").autoincrement().primaryKey(),
  purchaseOrderId: int("purchaseOrderId").notNull(),
  // 공통 품목 (nullable — 비정형 항목도 허용)
  itemId: int("itemId"),
  // 거래처-품목 매핑 (nullable)
  counterpartyItemId: int("counterpartyItemId"),
  // 직접 입력한 품목명 (itemId 없을 때 사용)
  rawItemName: varchar("rawItemName", { length: 100 }),
  itemType: mysqlEnum("itemType", ["product", "service", "misc"]).default("product").notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 4 }),
  unitName: varchar("unitName", { length: 30 }),
  conversionToBase: decimal("conversionToBase", { precision: 10, scale: 4 }),
  unitPrice: decimal("unitPrice", { precision: 14, scale: 2 }),
  lineTotal: decimal("lineTotal", { precision: 14, scale: 2 }).notNull(),
  costingCategory: varchar("costingCategory", { length: 50 }),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PurchaseOrderItemV2 = typeof purchaseOrderItemsV2.$inferSelect;
export type InsertPurchaseOrderItemV2 = typeof purchaseOrderItemsV2.$inferInsert;

// ─── Store Closed Days (매장 휴무일) ───────────────────────────────────────────
export const storeClosedDays = mysqlTable("store_closed_days", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  // 휴무일 (YYYY-MM-DD)
  closedDate: date("closedDate").notNull(),
  // 휴무 사유 (예: 연휴, 임시휴업, 정기휴일)
  reason: varchar("reason", { length: 100 }),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type StoreClosedDay = typeof storeClosedDays.$inferSelect;
export type InsertStoreClosedDay = typeof storeClosedDays.$inferInsert;

// ─── Store Weekly Closures (정기 휴무 요일) ─────────────────────────────────
export const storeWeeklyClosures = mysqlTable("store_weekly_closures", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  // 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토
  weekday: int("weekday").notNull(),
  isClosed: boolean("isClosed").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type StoreWeeklyClosure = typeof storeWeeklyClosures.$inferSelect;
export type InsertStoreWeeklyClosure = typeof storeWeeklyClosures.$inferInsert;

// ─── Daily Closing Sales Types (매출 항목 유형 — 매장별 동적 관리) ──────────────
export const dailyClosingSalesTypes = mysqlTable("daily_closing_sales_types", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  typeName: varchar("typeName", { length: 50 }).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type DailyClosingSalesType = typeof dailyClosingSalesTypes.$inferSelect;

// ─── Daily Closing Special Types (매출 특이사항 유형 — 매장별 동적 관리) ─────────
export const dailyClosingSpecialTypes = mysqlTable("daily_closing_special_types", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  typeName: varchar("typeName", { length: 50 }).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type DailyClosingSpecialType = typeof dailyClosingSpecialTypes.$inferSelect;

// ─── Daily Closings (일마감) ─────────────────────────────────────────────────
export const dailyClosings = mysqlTable("daily_closings", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  // 영업일 (YYYY-MM-DD)
  closingDate: date("closingDate").notNull(),
  // 집계 수치 스냅샷
  salesTotal: decimal("salesTotal", { precision: 14, scale: 2 }).default("0").notNull(),
  purchasesTotal: decimal("purchasesTotal", { precision: 14, scale: 2 }).default("0").notNull(),
  laborCost: decimal("laborCost", { precision: 14, scale: 2 }).default("0").notNull(),
  fixedCostShare: decimal("fixedCostShare", { precision: 14, scale: 2 }).default("0").notNull(),
  profit: decimal("profit", { precision: 14, scale: 2 }).default("0").notNull(),
  // 매출 항목별 상세 JSON [{typeName, amount}]
  salesBreakdown: json("salesBreakdown").$type<Array<{typeName: string; amount: number}>>(),
  // 매출 특이사항 JSON [{typeName, amount, note}]
  salesSpecials: json("salesSpecials").$type<Array<{typeName: string; amount: number; note?: string}>>(),
  // 내일 스케줄 확정 여부
  tomorrowScheduleConfirmed: boolean("tomorrowScheduleConfirmed").default(false).notNull(),
  // 스케줄 특이사항
  scheduleNote: text("scheduleNote"),
  // 매입 확인 메모
  purchaseNote: text("purchaseNote"),
  // 발주체크 사진 URL (S3)
  orderCheckPhotoUrl: text("orderCheckPhotoUrl"),
  // 금일 발주 없음 체크
  orderCheckNoOrder: boolean("orderCheckNoOrder").default(false).notNull(),
  // 마감 메모
  note: text("note"),
  // 마감 확정자
  closedBy: int("closedBy"),
  closedAt: timestamp("closedAt").defaultNow().notNull(),
  // 수정 이력
  lastModifiedBy: int("lastModifiedBy"),
  lastModifiedAt: timestamp("lastModifiedAt"),
  // 수정 이력 배열 [{userId, userName, at, summary}]
  editHistory: json("editHistory").$type<Array<{userId: number; userName: string; at: string; summary: string}>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type DailyClosing = typeof dailyClosings.$inferSelect;
export type InsertDailyClosing = typeof dailyClosings.$inferInsert;

// ─── Monthly Closings (월마감) ───────────────────────────────────────────────
export const monthlyClosings = mysqlTable("monthly_closings", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  year: int("year").notNull(),
  month: int("month").notNull(),
  // 집계 수치 스냅샷
  salesTotal: decimal("salesTotal", { precision: 14, scale: 2 }).default("0").notNull(),
  purchasesTotal: decimal("purchasesTotal", { precision: 14, scale: 2 }).default("0").notNull(),
  laborCost: decimal("laborCost", { precision: 14, scale: 2 }).default("0").notNull(),
  fixedCostsTotal: decimal("fixedCostsTotal", { precision: 14, scale: 2 }).default("0").notNull(),
  profit: decimal("profit", { precision: 14, scale: 2 }).default("0").notNull(),
  // 마감 메모
  note: text("note"),
  // 마감 확정자
  closedBy: int("closedBy"),
  closedAt: timestamp("closedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type MonthlyClosing = typeof monthlyClosings.$inferSelect;
export type InsertMonthlyClosing = typeof monthlyClosings.$inferInsert;

// ─── Store Checklist Templates (매장별 체크리스트 템플릿) ────────────────────────
// type: 'open' | 'order' | 'cleaning'
export const storeChecklistTemplates = mysqlTable("store_checklist_templates", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  // 체크리스트 유형: open(오픈), order(발주확인), cleaning(청소)
  checkType: mysqlEnum("checkType", ["open", "order", "cleaning"]).notNull(),
  // 체크 항목 내용
  itemText: varchar("itemText", { length: 200 }).notNull(),
  // 정렬 순서
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type StoreChecklistTemplate = typeof storeChecklistTemplates.$inferSelect;
export type InsertStoreChecklistTemplate = typeof storeChecklistTemplates.$inferInsert;

// ─── Daily Checklist Logs (일별 체크리스트 완료 기록) ────────────────────────────
export const dailyChecklistLogs = mysqlTable("daily_checklist_logs", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  // 영업일 (YYYY-MM-DD)
  logDate: date("logDate").notNull(),
  // 체크리스트 유형: open(오픈), order(발주확인), cleaning(청소)
  checkType: mysqlEnum("checkType", ["open", "order", "cleaning"]).notNull(),
  // 체크된 항목 ID 배열 (storeChecklistTemplates.id 참조)
  checkedItemIds: json("checkedItemIds").$type<number[]>().default([]),
  // 발주확인: 금일 발주 없음 여부
  noOrderToday: boolean("noOrderToday").default(false).notNull(),
  // 완료 처리자
  completedBy: int("completedBy"),
  completedAt: timestamp("completedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type DailyChecklistLog = typeof dailyChecklistLogs.$inferSelect;
export type InsertDailyChecklistLog = typeof dailyChecklistLogs.$inferInsert;

