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

console.log("🗑️  Clearing all existing data...");
await q("SET FOREIGN_KEY_CHECKS = 0");
for (const t of ["notifications","monthly_fixed_costs","purchases","sales","schedules","employee_contracts","restaurant_users","restaurants","users"]) {
  await q(`TRUNCATE TABLE ${t}`);
}
await q("SET FOREIGN_KEY_CHECKS = 1");
console.log("✅ Cleared\n");

// ── 비밀번호 해시 ──────────────────────────────────────
const pw = await bcrypt.hash("demo1234", 10);
const adminPw = await bcrypt.hash("admin1234", 10);

// ── 사용자 생성 ────────────────────────────────────────
console.log("👤 Creating users...");
const userData = [
  // [openId, username, pw, name, role]
  ["u-master",  "master",   adminPw, "마스터관리자", "master"],
  ["u-admin",   "admin",    adminPw, "김관리자",     "admin"],
  // 점장 3명
  ["u-mgr1",    "manager1", pw, "박점장",   "manager"],
  ["u-mgr2",    "manager2", pw, "이점장",   "manager"],
  ["u-mgr3",    "manager3", pw, "최점장",   "manager"],
  // 직원 9명 (매장당 3명)
  ["u-emp1",    "emp1",     pw, "김민준",   "employee"],
  ["u-emp2",    "emp2",     pw, "이수진",   "employee"],
  ["u-emp3",    "emp3",     pw, "박지현",   "employee"],
  ["u-emp4",    "emp4",     pw, "정태호",   "employee"],
  ["u-emp5",    "emp5",     pw, "한소희",   "employee"],
  ["u-emp6",    "emp6",     pw, "윤서연",   "employee"],
  ["u-emp7",    "emp7",     pw, "강민혁",   "employee"],
  ["u-emp8",    "emp8",     pw, "조예린",   "employee"],
  ["u-emp9",    "emp9",     pw, "신동현",   "employee"],
];
for (const [oid, uname, hash, name, role] of userData) {
  await q(
    `INSERT INTO users (openId, username, passwordHash, name, role, isActive, lastSignedIn) VALUES (?,?,?,?,?,1,NOW())`,
    [oid, uname, hash, name, role]
  );
}
const [usrs] = await conn.execute("SELECT id, username FROM users");
const U = Object.fromEntries(usrs.map(u => [u.username, u.id]));
console.log("✅ Users:", Object.keys(U).join(", "));

// ── 매장 생성 ──────────────────────────────────────────
console.log("\n🏪 Creating restaurants...");
await q(`INSERT INTO restaurants (name, address, phone, monthlyTargetSales, targetLaborRatio, targetCostRatio) VALUES
  ('청계산뚝배기수제비 천호점', '서울시 강동구 천호대로 1234', '02-481-3310', '45000000', '28', '72'),
  ('청계산뚝배기수제비 강남점', '서울시 강남구 테헤란로 567', '02-555-3310', '55000000', '25', '70'),
  ('청계산뚝배기수제비 홍대점', '서울시 마포구 홍대입구역 89', '02-333-3310', '38000000', '30', '73')
`);
const [rests] = await conn.execute("SELECT id, name FROM restaurants");
const R = Object.fromEntries(rests.map(r => [r.name, r.id]));
const R1 = R["청계산뚝배기수제비 천호점"];
const R2 = R["청계산뚝배기수제비 강남점"];
const R3 = R["청계산뚝배기수제비 홍대점"];
console.log("✅ Restaurants:", Object.keys(R).join(" | "));

// ── 매장-사용자 연결 ───────────────────────────────────
console.log("\n🔗 Linking users to restaurants...");
const links = [
  [R1, U["manager1"], "manager"],
  [R1, U["emp1"],     "employee"],
  [R1, U["emp2"],     "employee"],
  [R1, U["emp3"],     "employee"],
  [R2, U["manager2"], "manager"],
  [R2, U["emp4"],     "employee"],
  [R2, U["emp5"],     "employee"],
  [R2, U["emp6"],     "employee"],
  [R3, U["manager3"], "manager"],
  [R3, U["emp7"],     "employee"],
  [R3, U["emp8"],     "employee"],
  [R3, U["emp9"],     "employee"],
];
for (const [rId, uId, role] of links) {
  await q(`INSERT INTO restaurant_users (restaurantId, userId, role) VALUES (?,?,?)`, [rId, uId, role]);
}
console.log("✅ Links created");

// ── 계약 정보 ──────────────────────────────────────────
console.log("\n📄 Creating contracts...");
const contracts = [
  [U["manager1"], R1, "monthly", "4800000", "점장",     "2024-01-01", "50"],
  [U["manager2"], R2, "monthly", "5200000", "점장",     "2024-03-01", "50"],
  [U["manager3"], R3, "monthly", "4500000", "점장",     "2024-06-01", "50"],
  [U["emp1"],     R1, "hourly",  "12500",   "홀서빙",   "2025-01-01", "40"],
  [U["emp2"],     R1, "hourly",  "12500",   "주방보조", "2025-02-01", "35"],
  [U["emp3"],     R1, "hourly",  "13000",   "카운터",   "2024-09-01", "30"],
  [U["emp4"],     R2, "hourly",  "13000",   "홀서빙",   "2025-01-15", "40"],
  [U["emp5"],     R2, "hourly",  "12500",   "주방보조", "2025-02-01", "35"],
  [U["emp6"],     R2, "monthly", "2800000", "주방장",   "2024-07-01", "45"],
  [U["emp7"],     R3, "hourly",  "12000",   "홀서빙",   "2025-03-01", "30"],
  [U["emp8"],     R3, "hourly",  "12500",   "배달",     "2025-01-01", "35"],
  [U["emp9"],     R3, "hourly",  "13000",   "주방보조", "2024-11-01", "40"],
];
for (const [uId, rId, wt, wa, pos, cs, wh] of contracts) {
  await q(
    `INSERT INTO employee_contracts (userId, restaurantId, wageType, wageAmount, position, contractStart, weeklyHours, isActive) VALUES (?,?,?,?,?,?,?,1)`,
    [uId, rId, wt, wa, pos, cs, wh]
  );
}
console.log("✅ Contracts created");

// ── 스케줄 (이번주 + 다음주) ───────────────────────────
console.log("\n📅 Creating schedules...");
const today = new Date();
const weekStart = new Date(today);
weekStart.setDate(today.getDate() - today.getDay());

// 매장별 직원 스케줄 패턴 [userId, 근무요일[], 시작, 종료]
const patterns = [
  // 천호점
  [U["manager1"], [1,2,3,4,5,6], "09:00", "20:00", R1],
  [U["emp1"],     [1,2,3,4,5],   "10:00", "17:00", R1],
  [U["emp2"],     [2,3,4,5,6],   "17:00", "22:00", R1],
  [U["emp3"],     [1,3,5,6],     "09:00", "15:00", R1],
  // 강남점
  [U["manager2"], [1,2,3,4,5,6], "09:00", "21:00", R2],
  [U["emp4"],     [1,2,3,4,5],   "11:00", "18:00", R2],
  [U["emp5"],     [3,4,5,6],     "16:00", "22:00", R2],
  [U["emp6"],     [1,2,3,4,5,6], "09:00", "18:00", R2],
  // 홍대점
  [U["manager3"], [1,2,3,4,5,6], "10:00", "21:00", R3],
  [U["emp7"],     [1,2,4,5,6],   "11:00", "17:00", R3],
  [U["emp8"],     [2,3,4,5,6],   "17:00", "22:00", R3],
  [U["emp9"],     [1,3,5],       "10:00", "19:00", R3],
];

for (let week = 0; week < 2; week++) {
  for (const [uId, days, start, end, rId] of patterns) {
    for (const dow of days) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + dow + week * 7);
      const ds = d.toISOString().split("T")[0];
      const mgr = rId === R1 ? U["manager1"] : rId === R2 ? U["manager2"] : U["manager3"];
      await q(
        `INSERT INTO schedules (userId, restaurantId, startTime, endTime, status, createdBy) VALUES (?,?,?,?,'confirmed',?)`,
        [uId, rId, `${ds} ${start}:00`, `${ds} ${end}:00`, mgr]
      );
    }
  }
}
console.log("✅ Schedules created (2 weeks)");

// ── 매출 데이터 (이번달 1일~오늘) ─────────────────────
console.log("\n💰 Creating sales data...");
const yr = today.getFullYear();
const mo = today.getMonth() + 1;
const todayD = today.getDate();

for (let day = 1; day <= todayD; day++) {
  const ds = `${yr}-${String(mo).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  const dow = new Date(ds).getDay();
  const isWeekend = dow === 0 || dow === 6;

  const sales = [
    [R1, isWeekend ? 1900000 : 1300000, U["manager1"]],
    [R2, isWeekend ? 2400000 : 1700000, U["manager2"]],
    [R3, isWeekend ? 1500000 : 1000000, U["manager3"]],
  ];
  for (const [rId, base, mgr] of sales) {
    const amt = Math.floor(base + Math.random() * 400000 - 200000);
    await q(
      `INSERT INTO sales (restaurantId, saleDate, amount, source, recordedBy) VALUES (?,?,?,'manual',?)`,
      [rId, ds, amt.toString(), mgr]
    );
  }
}
console.log("✅ Sales created");

// ── 매입 데이터 ────────────────────────────────────────
console.log("\n🛒 Creating purchases...");
const purchaseData = [
  // [restaurantId, day, vendor, item, cost, category, recordedBy]
  [R1, 1,  "농협유통(주)",     "돼지고기 삼겹살 10kg",    280000, "food",    U["manager1"]],
  [R1, 3,  "한국식자재마트",   "야채류(배추·무·파)",       95000,  "food",    U["manager1"]],
  [R1, 5,  "GS리테일",        "일회용 용기·포장재",       120000, "supply",  U["manager1"]],
  [R1, 10, "한전",            "전기요금",                 380000, "utility", U["manager1"]],
  [R1, 10, "도시가스",        "가스요금",                 210000, "utility", U["manager1"]],
  [R1, 15, "농협유통(주)",     "돼지고기 목살 8kg",        240000, "food",    U["manager1"]],
  [R1, 18, "이마트트레이더스", "식용유 18L·양념류",        145000, "food",    U["manager1"]],
  [R2, 1,  "농협유통(주)",     "소고기 불고기용 5kg",      420000, "food",    U["manager2"]],
  [R2, 3,  "한국식자재마트",   "두부·묵류·채소",           88000,  "food",    U["manager2"]],
  [R2, 5,  "CJ대한통운",      "수제비 밀가루 20kg",        68000,  "food",    U["manager2"]],
  [R2, 10, "한전",            "전기요금",                 450000, "utility", U["manager2"]],
  [R2, 12, "GS리테일",        "청소·위생용품",             75000,  "supply",  U["manager2"]],
  [R2, 15, "농협유통(주)",     "돼지고기 삼겹살 12kg",     336000, "food",    U["manager2"]],
  [R3, 2,  "농협유통(주)",     "돼지고기 앞다리 8kg",      200000, "food",    U["manager3"]],
  [R3, 5,  "한국식자재마트",   "고추장·된장·간장",          78000,  "food",    U["manager3"]],
  [R3, 8,  "GS리테일",        "포장재·소모품",             65000,  "supply",  U["manager3"]],
  [R3, 10, "한전",            "전기요금",                 290000, "utility", U["manager3"]],
  [R3, 15, "이마트트레이더스", "식재료 일괄",              185000, "food",    U["manager3"]],
];
for (const [rId, day, vendor, item, cost, cat, mgr] of purchaseData) {
  if (day > todayD) continue;
  const ds = `${yr}-${String(mo).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  await q(
    `INSERT INTO purchases (restaurantId, purchaseDate, vendorName, itemName, cost, category, source, recordedBy) VALUES (?,?,?,?,?,?,'manual',?)`,
    [rId, ds, vendor, item, cost.toString(), cat, mgr]
  );
}
console.log("✅ Purchases created");

// ── 월 고정비 ──────────────────────────────────────────
console.log("\n📋 Creating fixed costs...");
const effMonth = `${yr}-${String(mo).padStart(2,"0")}`;
const fixedCosts = [
  [R1, "매장 임대료",      "rent",    4200000],
  [R1, "관리비",           "fee",     180000],
  [R1, "인터넷/전화",      "utility", 88000],
  [R1, "POS 이용료",       "other",   55000],
  [R1, "배달앱 수수료",    "fee",     320000],
  [R1, "기타 잡비",        "other",   150000],
  [R2, "매장 임대료",      "rent",    6500000],
  [R2, "관리비",           "fee",     250000],
  [R2, "인터넷/전화",      "utility", 95000],
  [R2, "POS 이용료",       "other",   55000],
  [R2, "배달앱 수수료",    "fee",     480000],
  [R2, "기타 잡비",        "other",   200000],
  [R3, "매장 임대료",      "rent",    3800000],
  [R3, "관리비",           "fee",     160000],
  [R3, "인터넷/전화",      "utility", 80000],
  [R3, "POS 이용료",       "other",   55000],
  [R3, "배달앱 수수료",    "fee",     260000],
  [R3, "기타 잡비",        "other",   120000],
];
for (const [rId, cat, catType, amount] of fixedCosts) {
  await q(
    `INSERT INTO monthly_fixed_costs (restaurantId, effectiveMonth, costCategory, categoryType, amount, createdBy) VALUES (?,?,?,?,?,?)`,
    [rId, effMonth, cat, catType, amount.toString(), U["admin"]]
  );
}
console.log("✅ Fixed costs created");

// ── 알림 ───────────────────────────────────────────────
console.log("\n🔔 Creating notifications...");
await q(`INSERT INTO notifications (type, title, content, restaurantId, isRead) VALUES
  ('general',       '331매장관리 시스템 튜토리얼', '교육용 데모 계정으로 모든 기능을 체험해보세요.', NULL, 0),
  ('cost_exceeded', '강남점 인건비 경고',           '강남점 이번 달 인건비율이 목표(25%)를 초과했습니다. 확인이 필요합니다.', ?, 0),
  ('general',       '천호점 매출 목표 달성',        '천호점이 이번 달 매출 목표 90%를 달성했습니다!', ?, 0),
  ('general',       '스케줄 변경 요청',             '박민준 직원이 3월 5일 스케줄 변경을 요청했습니다.', ?, 0)
`, [R2, R1, R1]);
console.log("✅ Notifications created");

await conn.end();

// ── 결과 출력 ──────────────────────────────────────────
console.log(`
╔══════════════════════════════════════════════════════════╗
║          331매장관리 시스템 - 튜토리얼 계정 안내          ║
╠══════════════════════════════════════════════════════════╣
║  매장 1: 청계산뚝배기수제비 천호점                        ║
║  매장 2: 청계산뚝배기수제비 강남점                        ║
║  매장 3: 청계산뚝배기수제비 홍대점                        ║
╠══════════════════════════════════════════════════════════╣
║  역할          아이디       비밀번호   진입 화면           ║
║  ─────────────────────────────────────────────────────  ║
║  마스터관리자  master       admin1234  전체 총괄 대시보드  ║
║  관리자        admin        admin1234  전체 총괄 대시보드  ║
║  점장(천호점)  manager1     demo1234   천호점 대시보드     ║
║  점장(강남점)  manager2     demo1234   강남점 대시보드     ║
║  점장(홍대점)  manager3     demo1234   홍대점 대시보드     ║
║  직원(천호점)  emp1         demo1234   개인 대시보드       ║
║  직원(천호점)  emp2         demo1234   개인 대시보드       ║
║  직원(천호점)  emp3         demo1234   개인 대시보드       ║
║  직원(강남점)  emp4         demo1234   개인 대시보드       ║
║  직원(강남점)  emp5         demo1234   개인 대시보드       ║
║  직원(강남점)  emp6         demo1234   개인 대시보드       ║
║  직원(홍대점)  emp7         demo1234   개인 대시보드       ║
║  직원(홍대점)  emp8         demo1234   개인 대시보드       ║
║  직원(홍대점)  emp9         demo1234   개인 대시보드       ║
╚══════════════════════════════════════════════════════════╝
`);
