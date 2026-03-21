/**
 * 튜토리얼 데이터 시드 스크립트
 * - 기존 더미 데이터 전체 삭제 (마스터/관리자 계정 제외)
 * - 2025년 11~12월, 2026년 1~2월 기간 데이터 생성
 * - 모든 명칭에 "[튜토리얼]" 표시
 */
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL 환경변수 없음");

const conn = await mysql.createConnection(DB_URL);
console.log("✅ DB 연결 성공");

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────
const fmt = (d) => d.toISOString().slice(0, 10); // YYYY-MM-DD
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pw = await bcrypt.hash("1111", 10);

// ─── 1. 기존 데이터 삭제 (마스터/관리자 계정 보존) ────────────────────────────
console.log("\n🗑  기존 데이터 삭제 중...");

await conn.query("DELETE FROM employment_electronic_contracts");
await conn.query("DELETE FROM employee_contracts");
await conn.query("DELETE FROM schedules");
await conn.query("DELETE FROM sales_other_items");
await conn.query("DELETE FROM sales_other_item_templates");
await conn.query("DELETE FROM daily_sales_detail");
await conn.query("DELETE FROM intermediate_sales");
await conn.query("DELETE FROM sales");
await conn.query("DELETE FROM daily_operations");
await conn.query("DELETE FROM purchases");
await conn.query("DELETE FROM monthly_fixed_costs");
await conn.query("DELETE FROM restaurant_contracts");
await conn.query("DELETE FROM restaurant_users");
await conn.query("DELETE FROM notifications");
// 마스터/관리자 계정 보존, 나머지 삭제
await conn.query("DELETE FROM users WHERE role NOT IN ('master', 'admin')");
// 매장 삭제
await conn.query("DELETE FROM restaurants");

console.log("✅ 기존 데이터 삭제 완료");

// ─── 2. 매장 생성 ─────────────────────────────────────────────────────────────
console.log("\n🏪 매장 생성 중...");

await conn.query(`
  INSERT INTO restaurants (id, name, address, phone, monthlyTargetSales, targetLaborRatio, targetCostRatio, isActive)
  VALUES
    (1, '[튜토리얼] 청계산뚝배기 천호점', '서울시 강동구 천호대로 1234', '02-1234-5678', 35000000, 28, 75, 1),
    (2, '[튜토리얼] 청계산뚝배기 강남점', '서울시 강남구 테헤란로 567', '02-9876-5432', 45000000, 26, 72, 1)
`);
console.log("✅ 매장 2개 생성");

// ─── 3. 사용자 생성 ───────────────────────────────────────────────────────────
console.log("\n👤 사용자 생성 중...");

// 마스터/관리자 ID 확인
const [masterRows] = await conn.query("SELECT id FROM users WHERE role = 'master' LIMIT 1");
const [adminRows] = await conn.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
const masterId = masterRows[0]?.id ?? 1;
const adminId = adminRows[0]?.id ?? 2;

// 점장 및 직원 생성
const newUsers = [
  { openId: "u-tutorial-mgr1", name: "[튜토리얼] 박점장", username: "tutorial_mgr1", role: "manager" },
  { openId: "u-tutorial-mgr2", name: "[튜토리얼] 이점장", username: "tutorial_mgr2", role: "manager" },
  { openId: "u-tutorial-emp1", name: "[튜토리얼] 김민준", username: "tutorial_emp1", role: "employee" },
  { openId: "u-tutorial-emp2", name: "[튜토리얼] 이수진", username: "tutorial_emp2", role: "employee" },
  { openId: "u-tutorial-emp3", name: "[튜토리얼] 박지현", username: "tutorial_emp3", role: "employee" },
  { openId: "u-tutorial-emp4", name: "[튜토리얼] 정태호", username: "tutorial_emp4", role: "employee" },
  { openId: "u-tutorial-emp5", name: "[튜토리얼] 한소희", username: "tutorial_emp5", role: "employee" },
  { openId: "u-tutorial-emp6", name: "[튜토리얼] 윤서연", username: "tutorial_emp6", role: "employee" },
];

for (const u of newUsers) {
  await conn.query(
    `INSERT INTO users (openId, name, username, role, passwordHash, isActive, createdAt, updatedAt, lastSignedIn)
     VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW(), NOW())`,
    [u.openId, u.name, u.username, u.role, pw]
  );
}

// 생성된 사용자 ID 조회
const [userRows] = await conn.query("SELECT id, openId FROM users WHERE openId LIKE 'u-tutorial-%' ORDER BY id");
const uMap = {};
for (const u of userRows) uMap[u.openId] = u.id;

const mgr1Id = uMap["u-tutorial-mgr1"];
const mgr2Id = uMap["u-tutorial-mgr2"];
const emp1Id = uMap["u-tutorial-emp1"];
const emp2Id = uMap["u-tutorial-emp2"];
const emp3Id = uMap["u-tutorial-emp3"];
const emp4Id = uMap["u-tutorial-emp4"];
const emp5Id = uMap["u-tutorial-emp5"];
const emp6Id = uMap["u-tutorial-emp6"];

console.log(`✅ 사용자 생성: mgr1=${mgr1Id}, mgr2=${mgr2Id}, emp1~3=${emp1Id}~${emp3Id}, emp4~6=${emp4Id}~${emp6Id}`);

// ─── 4. 매장-직원 연결 ────────────────────────────────────────────────────────
await conn.query(`
  INSERT INTO restaurant_users (restaurantId, userId, role)
  VALUES
    (1, ${mgr1Id}, 'manager'),
    (1, ${emp1Id}, 'employee'),
    (1, ${emp2Id}, 'employee'),
    (1, ${emp3Id}, 'employee'),
    (2, ${mgr2Id}, 'manager'),
    (2, ${emp4Id}, 'employee'),
    (2, ${emp5Id}, 'employee'),
    (2, ${emp6Id}, 'employee')
`);
console.log("✅ 매장-직원 연결 완료");

// ─── 5. 직원 계약 정보 ────────────────────────────────────────────────────────
console.log("\n📋 직원 계약 정보 생성 중...");

const empContracts = [
  { userId: mgr1Id, restaurantId: 1, wageType: "monthly", wageAmount: 3200000, position: "점장", weeklyHours: 40, contractStart: "2024-01-01", contractEnd: "2026-12-31" },
  { userId: emp1Id, restaurantId: 1, wageType: "hourly", wageAmount: 10500, position: "홀 직원", weeklyHours: 30, contractStart: "2025-03-01", contractEnd: "2026-02-28" },
  { userId: emp2Id, restaurantId: 1, wageType: "hourly", wageAmount: 10320, position: "주방 보조", weeklyHours: 25, contractStart: "2025-06-01", contractEnd: "2026-05-31" },
  { userId: emp3Id, restaurantId: 1, wageType: "hourly", wageAmount: 11000, position: "주방 직원", weeklyHours: 35, contractStart: "2024-09-01", contractEnd: "2026-08-31" },
  { userId: mgr2Id, restaurantId: 2, wageType: "monthly", wageAmount: 3500000, position: "점장", weeklyHours: 40, contractStart: "2023-07-01", contractEnd: "2026-06-30" },
  { userId: emp4Id, restaurantId: 2, wageType: "hourly", wageAmount: 10800, position: "홀 직원", weeklyHours: 30, contractStart: "2025-01-01", contractEnd: "2025-12-31" },
  { userId: emp5Id, restaurantId: 2, wageType: "hourly", wageAmount: 10320, position: "홀 보조", weeklyHours: 20, contractStart: "2025-08-01", contractEnd: "2026-07-31" },
  { userId: emp6Id, restaurantId: 2, wageType: "hourly", wageAmount: 11500, position: "주방 직원", weeklyHours: 40, contractStart: "2024-04-01", contractEnd: "2026-03-31" },
];

for (const c of empContracts) {
  await conn.query(
    `INSERT INTO employee_contracts (userId, restaurantId, wageType, wageAmount, position, weeklyHours, contractStart, contractEnd, isActive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [c.userId, c.restaurantId, c.wageType, c.wageAmount, c.position, c.weeklyHours, c.contractStart, c.contractEnd]
  );
}
console.log("✅ 직원 계약 정보 생성 완료");

// ─── 6. 매장 계약 조건 ────────────────────────────────────────────────────────
console.log("\n🏢 매장 계약 조건 생성 중...");

await conn.query(`
  INSERT INTO restaurant_contracts (restaurantId, contractType, name, calcType, fixedAmount, ratioPercent, startDate, endDate, autoApplyToFixedCost, isActive, createdBy)
  VALUES
    (1, 'rent',    '[튜토리얼] 천호점 임대료',        'fixed', 4500000, 0,   '2024-01-01', '2026-12-31', 1, 1, ${masterId}),
    (1, 'royalty', '[튜토리얼] 천호점 본사 로얄티',   'ratio', 0,       3.5, '2024-01-01', '2026-12-31', 1, 1, ${masterId}),
    (2, 'rent',    '[튜토리얼] 강남점 임대료',        'fixed', 7200000, 0,   '2023-07-01', '2026-06-30', 1, 1, ${masterId}),
    (2, 'royalty', '[튜토리얼] 강남점 본사 로얄티',   'ratio', 0,       3.5, '2023-07-01', '2026-06-30', 1, 1, ${masterId})
`);
console.log("✅ 매장 계약 조건 생성 완료");

// ─── 7. 월 고정비 (4개월) ─────────────────────────────────────────────────────
console.log("\n💰 월 고정비 생성 중...");

const months = ["2025-11", "2025-12", "2026-01", "2026-02"];

const cheonhoFC = [
  { costCategory: "[튜토리얼] 임대료",         categoryType: "rent",    amount: 4500000 },
  { costCategory: "[튜토리얼] 본사 로얄티",    categoryType: "fee",     amount: 1225000 },
  { costCategory: "[튜토리얼] 전기요금",       categoryType: "utility", amount: 380000 },
  { costCategory: "[튜토리얼] 가스요금",       categoryType: "utility", amount: 290000 },
  { costCategory: "[튜토리얼] 수도요금",       categoryType: "utility", amount: 85000 },
  { costCategory: "[튜토리얼] 인터넷/전화",    categoryType: "utility", amount: 55000 },
  { costCategory: "[튜토리얼] 화재보험",       categoryType: "other",   amount: 42000 },
  { costCategory: "[튜토리얼] 청소/위생용역",  categoryType: "other",   amount: 150000 },
];

const gangnamFC = [
  { costCategory: "[튜토리얼] 임대료",         categoryType: "rent",    amount: 7200000 },
  { costCategory: "[튜토리얼] 본사 로얄티",    categoryType: "fee",     amount: 1575000 },
  { costCategory: "[튜토리얼] 전기요금",       categoryType: "utility", amount: 520000 },
  { costCategory: "[튜토리얼] 가스요금",       categoryType: "utility", amount: 410000 },
  { costCategory: "[튜토리얼] 수도요금",       categoryType: "utility", amount: 120000 },
  { costCategory: "[튜토리얼] 인터넷/전화",    categoryType: "utility", amount: 75000 },
  { costCategory: "[튜토리얼] 화재보험",       categoryType: "other",   amount: 68000 },
  { costCategory: "[튜토리얼] 청소/위생용역",  categoryType: "other",   amount: 220000 },
];

for (const month of months) {
  for (const fc of cheonhoFC) {
    await conn.query(
      `INSERT INTO monthly_fixed_costs (restaurantId, effectiveMonth, costCategory, categoryType, amount, createdBy)
       VALUES (1, ?, ?, ?, ?, ?)`,
      [month, fc.costCategory, fc.categoryType, fc.amount, masterId]
    );
  }
  for (const fc of gangnamFC) {
    await conn.query(
      `INSERT INTO monthly_fixed_costs (restaurantId, effectiveMonth, costCategory, categoryType, amount, createdBy)
       VALUES (2, ?, ?, ?, ?, ?)`,
      [month, fc.costCategory, fc.categoryType, fc.amount, masterId]
    );
  }
}
console.log("✅ 월 고정비 생성 완료 (4개월 × 2매장)");

// ─── 8. 매출 데이터 생성 ──────────────────────────────────────────────────────
console.log("\n📊 매출 데이터 생성 중...");

const monthSeasonFactor = { "2025-11": 0.85, "2025-12": 1.2, "2026-01": 1.0, "2026-02": 0.9 };

const startDate = new Date("2025-11-01");
const endDate = new Date("2026-02-28");

let salesCount = 0;

for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
  const dateStr = fmt(d);
  const month = dateStr.slice(0, 7);
  const dow = d.getDay();
  const isWeekend = dow === 0 || dow === 6;
  const seasonFactor = monthSeasonFactor[month] ?? 1.0;

  // 천호점
  const chBase = isWeekend ? rand(1300000, 1800000) : rand(800000, 1200000);
  const chTotal = Math.round(chBase * seasonFactor / 10000) * 10000;
  const chCash = Math.round(chTotal * (rand(15, 25) / 100) / 1000) * 1000;
  const chCard = chTotal - chCash;
  const chReceipts = rand(isWeekend ? 60 : 35, isWeekend ? 95 : 65);

  await conn.query(
    "INSERT INTO sales (restaurantId, saleDate, amount, source, recordedBy) VALUES (?, ?, ?, 'manual', ?)",
    [1, dateStr, chTotal, mgr1Id]
  );
  await conn.query(
    `INSERT INTO daily_sales_detail (restaurantId, saleDate, cashAmount, cardAmount, receiptCount, discountAmount, otherAmount, totalAmount, status, recordedBy)
     VALUES (1, ?, ?, ?, ?, 0, 0, ?, 'confirmed', ?)`,
    [dateStr, chCash, chCard, chReceipts, chTotal, mgr1Id]
  );

  // 강남점
  const gnBase = isWeekend ? rand(1700000, 2300000) : rand(1100000, 1600000);
  const gnTotal = Math.round(gnBase * seasonFactor / 10000) * 10000;
  const gnCash = Math.round(gnTotal * (rand(10, 20) / 100) / 1000) * 1000;
  const gnCard = gnTotal - gnCash;
  const gnReceipts = rand(isWeekend ? 80 : 50, isWeekend ? 130 : 90);

  await conn.query(
    "INSERT INTO sales (restaurantId, saleDate, amount, source, recordedBy) VALUES (?, ?, ?, 'manual', ?)",
    [2, dateStr, gnTotal, mgr2Id]
  );
  await conn.query(
    `INSERT INTO daily_sales_detail (restaurantId, saleDate, cashAmount, cardAmount, receiptCount, discountAmount, otherAmount, totalAmount, status, recordedBy)
     VALUES (2, ?, ?, ?, ?, 0, 0, ?, 'confirmed', ?)`,
    [dateStr, gnCash, gnCard, gnReceipts, gnTotal, mgr2Id]
  );

  salesCount += 2;
}

console.log(`✅ 매출 데이터 생성 완료 (${salesCount}건)`);

// ─── 9. 매입 데이터 생성 ──────────────────────────────────────────────────────
console.log("\n🛒 매입 데이터 생성 중...");

const vendors = {
  1: [
    { vendor: "[튜토리얼] 한국식자재유통", items: [
      { name: "국내산 돼지뼈 (20kg)", cat: "food", min: 85000, max: 110000 },
      { name: "감자 (10kg)",          cat: "food", min: 18000, max: 25000 },
      { name: "대파 (5kg)",           cat: "food", min: 12000, max: 18000 },
      { name: "두부 (10모)",          cat: "food", min: 15000, max: 20000 },
    ]},
    { vendor: "[튜토리얼] 서울청과", items: [
      { name: "애호박 (10개)",  cat: "food", min: 22000, max: 32000 },
      { name: "고추 (1kg)",     cat: "food", min: 8000,  max: 14000 },
      { name: "마늘 (3kg)",     cat: "food", min: 18000, max: 28000 },
    ]},
    { vendor: "[튜토리얼] 동원수산", items: [
      { name: "바지락 (5kg)",  cat: "food", min: 35000, max: 50000 },
      { name: "건새우 (1kg)",  cat: "food", min: 28000, max: 38000 },
    ]},
    { vendor: "[튜토리얼] 클린마트", items: [
      { name: "주방세제 (5L)",        cat: "supply", min: 25000, max: 35000 },
      { name: "일회용 장갑 (100매)",  cat: "supply", min: 8000,  max: 12000 },
      { name: "위생봉투 (100매)",     cat: "supply", min: 6000,  max: 9000  },
    ]},
  ],
  2: [
    { vendor: "[튜토리얼] 한국식자재유통", items: [
      { name: "국내산 돼지뼈 (20kg)", cat: "food", min: 85000, max: 110000 },
      { name: "감자 (10kg)",          cat: "food", min: 18000, max: 25000 },
      { name: "대파 (5kg)",           cat: "food", min: 12000, max: 18000 },
      { name: "두부 (10모)",          cat: "food", min: 15000, max: 20000 },
    ]},
    { vendor: "[튜토리얼] 강남청과", items: [
      { name: "애호박 (10개)",  cat: "food", min: 24000, max: 35000 },
      { name: "고추 (1kg)",     cat: "food", min: 9000,  max: 15000 },
      { name: "마늘 (3kg)",     cat: "food", min: 20000, max: 30000 },
      { name: "양파 (5kg)",     cat: "food", min: 12000, max: 18000 },
    ]},
    { vendor: "[튜토리얼] 강남수산", items: [
      { name: "바지락 (5kg)",  cat: "food", min: 38000, max: 55000 },
      { name: "건새우 (1kg)",  cat: "food", min: 30000, max: 42000 },
      { name: "멸치 (2kg)",    cat: "food", min: 22000, max: 32000 },
    ]},
    { vendor: "[튜토리얼] 클린마트", items: [
      { name: "주방세제 (5L)",        cat: "supply", min: 25000, max: 35000 },
      { name: "일회용 장갑 (100매)",  cat: "supply", min: 8000,  max: 12000 },
      { name: "위생봉투 (100매)",     cat: "supply", min: 6000,  max: 9000  },
      { name: "행주 (10장)",          cat: "supply", min: 15000, max: 22000 },
    ]},
  ],
};

let purchaseCount = 0;
for (const [restaurantId, vendorList] of Object.entries(vendors)) {
  const rId = parseInt(restaurantId);
  const recordedBy = rId === 1 ? mgr1Id : mgr2Id;

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = fmt(d);
    const dow = d.getDay();
    // 월/수/금에 주로 매입 발생
    const purchaseProb = [0.15, 0.7, 0.15, 0.7, 0.15, 0.7, 0.1][dow];
    if (Math.random() > purchaseProb) continue;

    const vendorCount = rand(1, 2);
    const shuffled = [...vendorList].sort(() => Math.random() - 0.5).slice(0, vendorCount);

    for (const v of shuffled) {
      const itemCount = rand(1, Math.min(3, v.items.length));
      const items = [...v.items].sort(() => Math.random() - 0.5).slice(0, itemCount);

      for (const item of items) {
        const cost = rand(item.min, item.max);
        await conn.query(
          `INSERT INTO purchases (restaurantId, purchaseDate, vendorName, itemName, cost, category, purchaseStatus, recordedBy)
           VALUES (?, ?, ?, ?, ?, ?, 'received', ?)`,
          [rId, dateStr, v.vendor, item.name, cost, item.cat, recordedBy]
        );
        purchaseCount++;
      }
    }
  }
}

console.log(`✅ 매입 데이터 생성 완료 (${purchaseCount}건)`);

// ─── 10. 스케줄 데이터 생성 ───────────────────────────────────────────────────
console.log("\n📅 스케줄 데이터 생성 중...");

const schedulePatterns = {
  [mgr1Id]: { rId: 1, days: [1,2,3,4,5,6], startH: 9,  endH: 22 },
  [emp1Id]: { rId: 1, days: [1,2,3,4,5],   startH: 11, endH: 20 },
  [emp2Id]: { rId: 1, days: [2,3,4,5,6],   startH: 14, endH: 22 },
  [emp3Id]: { rId: 1, days: [1,3,5,6,0],   startH: 10, endH: 18 },
  [mgr2Id]: { rId: 2, days: [1,2,3,4,5,6], startH: 9,  endH: 22 },
  [emp4Id]: { rId: 2, days: [1,2,3,4,5],   startH: 11, endH: 20 },
  [emp5Id]: { rId: 2, days: [2,3,4,5,6],   startH: 14, endH: 22 },
  [emp6Id]: { rId: 2, days: [1,3,5,6,0],   startH: 10, endH: 18 },
};

let scheduleCount = 0;
for (const [userId, pattern] of Object.entries(schedulePatterns)) {
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (!pattern.days.includes(dow)) continue;

    const status = Math.random() < 0.04 ? "change_requested" : "confirmed";

    // KST → UTC (KST = UTC+9)
    const startTime = new Date(d);
    startTime.setUTCHours(pattern.startH - 9, 0, 0, 0);
    const endTime = new Date(d);
    endTime.setUTCHours(pattern.endH - 9, 0, 0, 0);

    await conn.query(
      `INSERT INTO schedules (userId, restaurantId, startTime, endTime, status, createdBy)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [parseInt(userId), pattern.rId, startTime, endTime, status, pattern.rId === 1 ? mgr1Id : mgr2Id]
    );
    scheduleCount++;
  }
}

console.log(`✅ 스케줄 데이터 생성 완료 (${scheduleCount}건)`);

// ─── 완료 ─────────────────────────────────────────────────────────────────────
await conn.end();
console.log("\n🎉 튜토리얼 데이터 시드 완료!");
console.log("  - 매장: 2개 ([튜토리얼] 청계산뚝배기 천호점/강남점)");
console.log("  - 사용자: 점장 2명 + 직원 6명 (비밀번호: 1111)");
console.log("  - 기간: 2025-11-01 ~ 2026-02-28 (4개월)");
console.log(`  - 매출: ${salesCount}건 (일별 2매장)`);
console.log(`  - 매입: ${purchaseCount}건`);
console.log(`  - 스케줄: ${scheduleCount}건`);
console.log("  - 고정비: 4개월 × 2매장 × 8항목 = 64건");
