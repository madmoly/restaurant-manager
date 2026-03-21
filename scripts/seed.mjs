import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const conn = await mysql.createConnection(DB_URL);

async function q(sql, params = []) {
  const [rows] = await conn.execute(sql, params);
  return rows;
}

console.log("🗑️  Clearing existing data...");
// 기존 데이터 전체 삭제 (외래키 순서 고려)
await q("SET FOREIGN_KEY_CHECKS = 0");
await q("TRUNCATE TABLE notifications");
await q("TRUNCATE TABLE monthly_fixed_costs");
await q("TRUNCATE TABLE purchases");
await q("TRUNCATE TABLE sales");
await q("TRUNCATE TABLE schedules");
await q("TRUNCATE TABLE employee_contracts");
await q("TRUNCATE TABLE restaurant_users");
await q("TRUNCATE TABLE restaurants");
await q("TRUNCATE TABLE users");
await q("SET FOREIGN_KEY_CHECKS = 1");
console.log("✅ Cleared");

// 비밀번호 해시 (통합 1111)
const pw = await bcrypt.hash("1111", 10);

console.log("🌱 Seeding 331매장관리 시스템 test data...");

// ─────────────────────────────────────────────
// 사용자 생성 (아이디: 이름+직급, 비번: 1111)
// ─────────────────────────────────────────────
// 마스터 관리자
await q(`INSERT INTO users (openId, username, passwordHash, name, role, isActive, lastSignedIn) VALUES
  ('master-001', '김지웅마스터', ?, '김지웅', 'master', 1, NOW())
`, [pw]);

// 관리자
await q(`INSERT INTO users (openId, username, passwordHash, name, role, isActive, lastSignedIn) VALUES
  ('admin-001', '김지웅관리자', ?, '김지웅', 'admin', 1, NOW())
`, [pw]);

// 점장
await q(`INSERT INTO users (openId, username, passwordHash, name, role, isActive, lastSignedIn) VALUES
  ('manager-001', '김지웅점장', ?, '김지웅', 'manager', 1, NOW())
`, [pw]);

// 매니저 (employee 권한 + 직책 매니저)
await q(`INSERT INTO users (openId, username, passwordHash, name, role, isActive, lastSignedIn) VALUES
  ('manager-002', '김지웅매니저', ?, '김지웅', 'employee', 1, NOW())
`, [pw]);

// 직원들
const employees = [
  ['emp-001', '이수진사원', '이수진'],
  ['emp-002', '박민준사원', '박민준'],
  ['emp-003', '최유나사원', '최유나'],
  ['emp-004', '정태호사원', '정태호'],
  ['emp-005', '한소희사원', '한소희'],
];
for (const [oid, uname, name] of employees) {
  await q(`INSERT INTO users (openId, username, passwordHash, name, role, isActive, lastSignedIn) VALUES
    (?, ?, ?, ?, 'employee', 1, NOW())
  `, [oid, uname, pw, name]);
}
console.log("✅ Users created");

// ─────────────────────────────────────────────
// 매장 생성
// ─────────────────────────────────────────────
await q(`INSERT INTO restaurants (name, address, phone, monthlyTargetSales, targetLaborRatio, targetCostRatio) VALUES
  ('청계산뚝배기수제비 천호점', '서울시 강동구 천호대로 1234', '02-481-3310', '45000000', '28', '72')
`);
console.log("✅ Restaurant created");

// ID 조회
const [usrs] = await conn.execute("SELECT id, username FROM users");
const userMap = Object.fromEntries(usrs.map(u => [u.username, u.id]));

const [rests] = await conn.execute("SELECT id FROM restaurants LIMIT 1");
const restId = rests[0].id;

// ─────────────────────────────────────────────
// 매장-사용자 연결
// ─────────────────────────────────────────────
const ruInserts = [
  [restId, userMap["김지웅점장"], "manager"],
  [restId, userMap["김지웅매니저"], "employee"],
  [restId, userMap["이수진사원"], "employee"],
  [restId, userMap["박민준사원"], "employee"],
  [restId, userMap["최유나사원"], "employee"],
  [restId, userMap["정태호사원"], "employee"],
  [restId, userMap["한소희사원"], "employee"],
];
for (const [rId, uId, role] of ruInserts) {
  await q(`INSERT INTO restaurant_users (restaurantId, userId, role) VALUES (?, ?, ?)`, [rId, uId, role]);
}
console.log("✅ Restaurant-User links created");

// ─────────────────────────────────────────────
// 계약 정보
// ─────────────────────────────────────────────
const contracts = [
  [userMap["김지웅점장"],   restId, "monthly",  "4800000", "점장",   "2024-01-01", null, "50"],
  [userMap["김지웅매니저"], restId, "monthly",  "3200000", "매니저", "2024-06-01", null, "45"],
  [userMap["이수진사원"],   restId, "hourly",   "12500",   "홀 서빙", "2025-01-01", null, "40"],
  [userMap["박민준사원"],   restId, "hourly",   "12500",   "홀 서빙", "2025-02-01", null, "35"],
  [userMap["최유나사원"],   restId, "hourly",   "13000",   "주방 보조", "2024-09-01", null, "40"],
  [userMap["정태호사원"],   restId, "hourly",   "12500",   "배달",   "2025-01-15", null, "30"],
  [userMap["한소희사원"],   restId, "hourly",   "12000",   "카운터", "2025-03-01", null, "25"],
];
for (const [uId, rId, wt, wa, pos, cs, ce, wh] of contracts) {
  await q(`INSERT INTO employee_contracts (userId, restaurantId, wageType, wageAmount, position, contractStart, contractEnd, weeklyHours, isActive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`, [uId, rId, wt, wa, pos, cs, ce, wh]);
}
console.log("✅ Contracts created");

// ─────────────────────────────────────────────
// 스케줄 (이번 주 + 다음 주)
// ─────────────────────────────────────────────
const today = new Date();
const weekStart = new Date(today);
weekStart.setDate(today.getDate() - today.getDay());

// 직원별 근무 패턴 정의
const schedulePatterns = [
  // [username, 근무요일(0=일~6=토), startHH, endHH]
  ["김지웅점장",   [1,2,3,4,5,6], "09:00", "20:00"],
  ["김지웅매니저", [1,2,3,4,5],   "10:00", "19:00"],
  ["이수진사원",   [1,2,3,4,5],   "11:00", "17:00"],
  ["박민준사원",   [2,3,4,5,6],   "17:00", "22:00"],
  ["최유나사원",   [1,3,5],       "10:00", "18:00"],
  ["정태호사원",   [2,4,6],       "11:00", "20:00"],
  ["한소희사원",   [1,2,3,4,5,6], "09:00", "14:00"],
];

for (let week = 0; week < 2; week++) {
  for (const [uname, days, start, end] of schedulePatterns) {
    const uid = userMap[uname];
    if (!uid) continue;
    for (const dayOfWeek of days) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + dayOfWeek + week * 7);
      const dateStr = d.toISOString().split("T")[0];
      await q(
        `INSERT INTO schedules (userId, restaurantId, startTime, endTime, status, createdBy) VALUES (?, ?, ?, ?, 'confirmed', ?)`,
        [uid, restId, `${dateStr} ${start}:00`, `${dateStr} ${end}:00`, userMap["김지웅점장"]]
      );
    }
  }
}
console.log("✅ Schedules created (2 weeks)");

// ─────────────────────────────────────────────
// 매출 데이터 (이번 달 1일 ~ 오늘)
// ─────────────────────────────────────────────
const year = today.getFullYear();
const month = today.getMonth() + 1;
const todayDate = today.getDate();

for (let day = 1; day <= todayDate; day++) {
  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // 주말은 매출 높게, 평일은 낮게
  const dow = new Date(dateStr).getDay();
  const base = (dow === 0 || dow === 6) ? 1800000 : 1200000;
  const amount = Math.floor(base + Math.random() * 600000);
  await q(
    `INSERT INTO sales (restaurantId, saleDate, amount, source, recordedBy) VALUES (?, ?, ?, 'manual', ?)`,
    [restId, dateStr, amount.toString(), userMap["김지웅점장"]]
  );
}
console.log("✅ Sales data created");

// ─────────────────────────────────────────────
// 매입 데이터 (이번 달)
// ─────────────────────────────────────────────
const purchaseItems = [
  ["농협유통(주)", "돼지고기 삼겹살 10kg", "food", 280000, "01"],
  ["농협유통(주)", "소고기 불고기용 5kg", "food", 320000, "01"],
  ["한국식자재마트", "야채류(배추,무,파)", "food", 95000, "03"],
  ["한국식자재마트", "두부 및 묵 류", "food", 45000, "03"],
  ["CJ대한통운", "수제비 밀가루 20kg", "food", 68000, "05"],
  ["GS리테일", "일회용 용기 및 포장재", "supply", 120000, "05"],
  ["한전", "전기요금", "utility", 380000, "10"],
  ["도시가스", "가스요금", "utility", 210000, "10"],
  ["이마트 트레이더스", "식용유 18L", "food", 85000, "12"],
  ["농협유통(주)", "돼지고기 목살 8kg", "food", 240000, "15"],
  ["한국식자재마트", "고추장/된장/간장", "food", 78000, "15"],
  ["GS리테일", "청소용품 및 위생용품", "supply", 65000, "18"],
];
for (const [vendor, item, cat, cost, dd] of purchaseItems) {
  const day = parseInt(dd);
  if (day > todayDate) continue;
  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  await q(
    `INSERT INTO purchases (restaurantId, purchaseDate, vendorName, itemName, cost, category, source, recordedBy) VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)`,
    [restId, dateStr, vendor, item, cost.toString(), cat, userMap["김지웅점장"]]
  );
}
console.log("✅ Purchases created");

// ─────────────────────────────────────────────
// 월 고정비
// ─────────────────────────────────────────────
const effectiveMonth = `${year}-${String(month).padStart(2, "0")}`;
const fixedCosts = [
  ["매장 임대료",     "rent",    4200000],
  ["관리비",          "fee",     180000],
  ["인터넷/전화",     "utility", 88000],
  ["POS 시스템 이용료","other",   55000],
  ["배달앱 수수료",   "fee",     320000],
  ["기타 잡비",       "other",   150000],
];
for (const [cat, catType, amount] of fixedCosts) {
  await q(
    `INSERT INTO monthly_fixed_costs (restaurantId, effectiveMonth, costCategory, categoryType, amount, createdBy) VALUES (?, ?, ?, ?, ?, ?)`,
    [restId, effectiveMonth, cat, catType, amount.toString(), userMap["김지웅관리자"]]
  );
}
console.log("✅ Fixed costs created");

// ─────────────────────────────────────────────
// 알림
// ─────────────────────────────────────────────
await q(`INSERT INTO notifications (type, title, content, restaurantId, isRead) VALUES
  ('general', '331매장관리 시스템 시작', '청계산뚝배기수제비 천호점 관리 시스템이 시작되었습니다.', ?, 0),
  ('general', '이번 달 매출 목표 안내', '3월 매출 목표는 4,500만원입니다. 현재 달성률을 확인하세요.', ?, 0)
`, [restId, restId]);
console.log("✅ Notifications created");

await conn.end();

console.log("\n🎉 Seeding complete!");
console.log("\n📋 ─────────────────────────────────────────");
console.log("   331매장관리 시스템 테스트 계정 안내");
console.log("   매장: 청계산뚝배기수제비 천호점");
console.log("   통합 비밀번호: 1111");
console.log("─────────────────────────────────────────");
console.log("  역할       | 아이디");
console.log("─────────────────────────────────────────");
console.log("  마스터관리자 | 김지웅마스터");
console.log("  관리자      | 김지웅관리자");
console.log("  점장        | 김지웅점장");
console.log("  매니저(사원)| 김지웅매니저");
console.log("  사원        | 이수진사원");
console.log("  사원        | 박민준사원");
console.log("  사원        | 최유나사원");
console.log("  사원        | 정태호사원");
console.log("  사원        | 한소희사원");
console.log("─────────────────────────────────────────\n");
