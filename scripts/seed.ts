import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import { and, eq } from "drizzle-orm";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import * as schema from "../drizzle/schema";

const pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(pool, { schema, mode: "default" });

// 비밀번호 해시
const pwTutorial = await bcrypt.hash("1111", 10);
const pwMaster = await bcrypt.hash("56695407", 10);
const pwAdmin = await bcrypt.hash("53345366", 10);

const today = new Date();
const dateStr = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };

console.log("🧹 DB 전체 초기화 중...\n");

// ═══════════════════════════════════════════════════════════════════
// DB 전체 초기화 (TRUNCATE → FK 제약 해제 후)
// ═══════════════════════════════════════════════════════════════════
const conn = await mysql.createConnection(process.env.DATABASE_URL!);
await conn.query("SET FOREIGN_KEY_CHECKS = 0");

const [tables] = await conn.query(
  `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
) as any[];
for (const row of tables) {
  await conn.query(`TRUNCATE TABLE \`${row.TABLE_NAME}\``);
  console.log(`  TRUNCATE ${row.TABLE_NAME}`);
}

await conn.query("SET FOREIGN_KEY_CHECKS = 1");
await conn.end();
console.log("\n✅ 전체 테이블 초기화 완료\n");

// ═══════════════════════════════════════════════════════════════════
// Phase 0: Tutorial 사용자 + 매장
// ═══════════════════════════════════════════════════════════════════
console.log("── Phase 0: Tutorial Users / Restaurant ──");

await db.insert(schema.users).values({ username: "master", passwordHash: pwMaster, name: "개발자", role: "master", phone: "01056695407" });
await db.insert(schema.users).values({ username: "admin", passwordHash: pwAdmin, name: "대표", role: "admin", phone: "01053345366" });
await db.insert(schema.users).values({ username: "owner1", passwordHash: pwTutorial, name: "Tutorial 점장", role: "employee", phone: "01011111111", isTutorial: true });
await db.insert(schema.users).values({ username: "supervisor1", passwordHash: pwTutorial, name: "Tutorial 매니져", role: "employee", phone: "01022222222", isTutorial: true });
await db.insert(schema.users).values({ username: "staff1", passwordHash: pwTutorial, name: "Tutorial 직원1", role: "employee", phone: "01033333333", isTutorial: true });
await db.insert(schema.users).values({ username: "staff2", passwordHash: pwTutorial, name: "Tutorial 직원2", role: "employee", phone: "01044444444", isTutorial: true });

// user IDs: 1=master, 2=admin, 3=owner1, 4=supervisor1, 5=staff1, 6=staff2

await db.insert(schema.restaurants).values({
  name: "Tutorial 매장", address: "서울 강남구 테헤란로 123", phone: "02-1234-5678",
  monthlyTargetSales: "45000000", openTime: "09:00", closeTime: "22:00",
  targetLaborRatio: "25", targetCostRatio: "30", isTutorial: true,
});
// restaurantId: 1

// 매장 배정
await db.insert(schema.restaurantUsers).values({ restaurantId: 1, userId: 3, role: "owner" });
await db.insert(schema.restaurantUsers).values({ restaurantId: 1, userId: 4, role: "supervisor" });
await db.insert(schema.restaurantUsers).values({ restaurantId: 1, userId: 5, role: "staff" });
await db.insert(schema.restaurantUsers).values({ restaurantId: 1, userId: 6, role: "staff" });

console.log("  ✅ Users(6), Restaurant(1), RestaurantUsers(4)");

// ═══════════════════════════════════════════════════════════════════
// Phase 1: 매출 3개월
// ═══════════════════════════════════════════════════════════════════
console.log("── Phase 1: Sales (3개월) ──");

const salesData: any[] = [];
for (let d = 90; d >= 0; d--) {
  const dt = daysAgo(d);
  const dow = dt.getDay();
  if (dow === 0) continue; // 일요일 휴무
  const base = dow === 6 ? 1900000 : dow === 5 ? 1700000 : 1400000;
  const variance = Math.floor(Math.random() * 400000) - 200000;
  salesData.push({ restaurantId: 1, saleDate: dateStr(dt), amount: String(base + variance), note: "", recordedBy: 3 });
}
for (const s of salesData) {
  await db.insert(schema.sales).values(s);
}
console.log(`  ✅ Sales(${salesData.length})`);

// 일매출 상세 (홀/배달/포장)
const salesTypes = ["홀매출", "배달매출", "포장매출", "기타"];
for (const [i, t] of salesTypes.entries()) {
  await db.insert(schema.dailyClosingSalesTypes).values({ restaurantId: 1, typeName: t, sortOrder: i });
}
console.log("  ✅ DailyClosingSalesTypes(4)");

// ═══════════════════════════════════════════════════════════════════
// Phase 1-B: 거래처 + 품목 + 매입
// ═══════════════════════════════════════════════════════════════════
console.log("── Phase 1-B: Counterparties / Items / Purchases ──");

const cpData = [
  { name: "Tutorial 식자재", type: "supplier" as const, contact: "김식자재", phone: "010-1111-0001" },
  { name: "Tutorial 청과", type: "supplier" as const, contact: "박청과", phone: "010-1111-0002" },
  { name: "Tutorial 수산", type: "supplier" as const, contact: "이수산", phone: "010-1111-0003" },
  { name: "Tutorial 마트", type: "mart" as const, contact: "최마트", phone: "010-1111-0004" },
  { name: "Tutorial 소모품", type: "supplier" as const, contact: "정소모", phone: "010-1111-0005" },
];
for (const cp of cpData) {
  await db.insert(schema.counterparties).values({ restaurantId: 1, name: cp.name, counterpartyType: cp.type, contactName: cp.contact, contactPhone: cp.phone });
}
// cpIds: 1=식자재, 2=청과, 3=수산, 4=마트, 5=소모품
console.log("  ✅ Counterparties(5)");

const itemData = [
  { name: "양파", cat: "채소", unit: "kg" },
  { name: "대파", cat: "채소", unit: "단" },
  { name: "감자", cat: "채소", unit: "kg" },
  { name: "밀가루", cat: "곡류", unit: "kg" },
  { name: "멸치", cat: "건어물", unit: "kg" },
  { name: "다시마", cat: "건어물", unit: "kg" },
  { name: "돼지고기 목살", cat: "육류", unit: "kg" },
  { name: "소고기 양지", cat: "육류", unit: "kg" },
  { name: "두부", cat: "가공식품", unit: "모" },
  { name: "참기름", cat: "양념", unit: "병" },
  { name: "간장", cat: "양념", unit: "L" },
  { name: "물티슈", cat: "소모품", unit: "박스" },
];
const itemIds: number[] = [];
for (const it of itemData) {
  const [result] = await db.insert(schema.items).values({
    restaurantId: 1, name: it.name, itemType: "product", costingCategory: it.cat, baseUnit: it.unit,
  }).$returningId();
  itemIds.push(result.id);
}
console.log(`  ✅ Items(${itemIds.length})`);

// 거래처-품목 매핑
const cpItemMap = [
  { cpId: 1, idx: 6, sup: "목살(냉장)", pUnit: "kg", price: "13500" },
  { cpId: 1, idx: 7, sup: "양지(1등급)", pUnit: "kg", price: "42000" },
  { cpId: 1, idx: 3, sup: "밀가루(중력)", pUnit: "20kg", price: "22000" },
  { cpId: 1, idx: 8, sup: "두부(풀무원)", pUnit: "모", price: "2200" },
  { cpId: 1, idx: 9, sup: "참기름(방앗간)", pUnit: "320ml", price: "8500" },
  { cpId: 1, idx: 10, sup: "진간장(양조)", pUnit: "1.8L", price: "6500" },
  { cpId: 2, idx: 0, sup: "양파(특)", pUnit: "망(20kg)", price: "18000" },
  { cpId: 2, idx: 1, sup: "대파(특)", pUnit: "단", price: "3500" },
  { cpId: 2, idx: 2, sup: "감자(대)", pUnit: "망(10kg)", price: "12000" },
  { cpId: 3, idx: 4, sup: "국물멸치(상)", pUnit: "kg", price: "28000" },
  { cpId: 3, idx: 5, sup: "다시마(국산)", pUnit: "kg", price: "15000" },
  { cpId: 5, idx: 11, sup: "물티슈(80매x10)", pUnit: "박스", price: "12000" },
];
const cpItemIds: number[] = [];
for (const m of cpItemMap) {
  const [r] = await db.insert(schema.counterpartyItems).values({
    restaurantId: 1, counterpartyId: m.cpId, itemId: itemIds[m.idx],
    supplierItemName: m.sup, purchaseUnit: m.pUnit, lastPrice: m.price, defaultPrice: m.price,
    isPreferred: m.cpId === 1,
  }).$returningId();
  cpItemIds.push(r.id);
}
console.log(`  ✅ CounterpartyItems(${cpItemIds.length})`);

// 매입 V2 — 3개월 (2~3일 간격, 거래처 순환)
let v2Count = 0;
for (let d = 90; d >= 1; d--) {
  const dt = daysAgo(d);
  if (dt.getDay() === 0) continue;
  const ds = dateStr(dt);

  // 식자재: 3일마다
  if (d % 3 === 0) {
    const items1 = cpItemMap.filter(m => m.cpId === 1);
    const sel = items1.slice(0, 2 + Math.floor(Math.random() * 3));
    let total = 0;
    const ois: any[] = [];
    for (const s of sel) {
      const qty = 1 + Math.floor(Math.random() * 4);
      const lt = qty * Number(s.price);
      total += lt;
      ois.push({ itemId: itemIds[s.idx], counterpartyItemId: cpItemIds[cpItemMap.indexOf(s)], rawItemName: s.sup, quantity: String(qty), unitName: s.pUnit, unitPrice: s.price, lineTotal: String(lt), costingCategory: itemData[s.idx].cat });
    }
    const [ord] = await db.insert(schema.purchaseOrdersV2).values({ restaurantId: 1, counterpartyId: 1, purchaseDate: ds, status: "received", totalAmount: String(total), createdBy: 3 }).$returningId();
    for (const oi of ois) await db.insert(schema.purchaseOrderItemsV2).values({ purchaseOrderId: ord.id, ...oi });
    v2Count++;
  }

  // 청과: 4일마다
  if (d % 4 === 0) {
    const lt = 18000 + Math.floor(Math.random() * 15000);
    const [ord] = await db.insert(schema.purchaseOrdersV2).values({ restaurantId: 1, counterpartyId: 2, purchaseDate: ds, status: "received", totalAmount: String(lt), createdBy: 3 }).$returningId();
    await db.insert(schema.purchaseOrderItemsV2).values({ purchaseOrderId: ord.id, itemId: itemIds[0], rawItemName: "양파(특)", quantity: "1", unitName: "망(20kg)", unitPrice: "18000", lineTotal: String(lt), costingCategory: "채소" });
    v2Count++;
  }

  // 수산: 7일마다
  if (d % 7 === 0) {
    const lt = 28000 + Math.floor(Math.random() * 20000);
    const [ord] = await db.insert(schema.purchaseOrdersV2).values({ restaurantId: 1, counterpartyId: 3, purchaseDate: ds, status: "received", totalAmount: String(lt), createdBy: 3 }).$returningId();
    await db.insert(schema.purchaseOrderItemsV2).values({ purchaseOrderId: ord.id, itemId: itemIds[4], rawItemName: "국물멸치(상)", quantity: "1", unitName: "kg", unitPrice: "28000", lineTotal: String(lt), costingCategory: "건어물" });
    v2Count++;
  }
}
console.log(`  ✅ PurchaseOrdersV2(${v2Count})`);

// 고정비
const fixedCosts = [
  { costName: "임대료", costType: "monthly" as const, amount: "3500000" },
  { costName: "전기요금", costType: "monthly" as const, amount: "450000" },
  { costName: "가스요금", costType: "monthly" as const, amount: "280000" },
  { costName: "수도요금", costType: "monthly" as const, amount: "120000" },
  { costName: "인터넷/통신", costType: "monthly" as const, amount: "89000" },
  { costName: "보험료", costType: "yearly" as const, amount: "1200000" },
  { costName: "정수기 렌탈", costType: "monthly" as const, amount: "35000" },
];
for (const fc of fixedCosts) {
  await db.insert(schema.fixedCosts).values({ restaurantId: 1, ...fc, createdBy: 1 });
}
console.log("  ✅ FixedCosts(7)");

// ═══════════════════════════════════════════════════════════════════
// Phase 2: 스케줄 + 운영 + 계약 + 체크리스트
// ═══════════════════════════════════════════════════════════════════
console.log("── Phase 2: Schedules / DailyOps / Contracts ──");

// Phase E (2026-05-02): employee_contracts 폐기.
// 임금은 wage_history에 시드. 운영 데이터(position, weeklyHours)는 restaurant_users에 직접.
const contracts = [
  { userId: 3, restaurantId: 1, wageType: "monthly" as const, wageAmount: "3000000", position: "점장", weeklyHours: "48" },
  { userId: 4, restaurantId: 1, wageType: "monthly" as const, wageAmount: "2500000", position: "매니져", weeklyHours: "44" },
  { userId: 5, restaurantId: 1, wageType: "hourly" as const, wageAmount: "10030", position: "홀서빙", weeklyHours: "40" },
  { userId: 6, restaurantId: 1, wageType: "hourly" as const, wageAmount: "10030", position: "주방보조", weeklyHours: "24" },
];
for (const c of contracts) {
  // wage_history (임금 SSOT)
  await db.insert(schema.employeeWageHistory).values({
    userId: c.userId,
    restaurantId: c.restaurantId,
    wageType: c.wageType,
    wageAmount: c.wageAmount,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    sourceContractId: null,
  } as any);
  // restaurant_users 운영 데이터
  await db
    .update(schema.restaurantUsers)
    .set({
      position: c.position,
      weeklyHours: c.weeklyHours,
      contractStart: "2026-01-01",
    })
    .where(and(
      eq(schema.restaurantUsers.userId, c.userId),
      eq(schema.restaurantUsers.restaurantId, c.restaurantId),
    ));
}
console.log("  ✅ Wage History + Operational Data (4)");

// 스케줄 (이번주 + 다음주)
const getMonday = (off: number) => {
  const d = new Date(today);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) + off * 7;
  d.setDate(diff);
  return d;
};
let schedCount = 0;
for (const weekOff of [0, 1]) {
  const mon = getMonday(weekOff);
  for (let dayOff = 0; dayOff < 7; dayOff++) {
    const dt = new Date(mon);
    dt.setDate(dt.getDate() + dayOff);
    if (dt.getDay() === 0) continue;

    // 점장 매일 08:30-21:00
    const s1s = new Date(dt); s1s.setHours(8, 30, 0, 0);
    const s1e = new Date(dt); s1e.setHours(21, 0, 0, 0);
    await db.insert(schema.schedules).values({ userId: 3, restaurantId: 1, startTime: s1s, endTime: s1e, status: weekOff === 0 ? "published" : "draft", shiftPreset: "full", createdBy: 3 });
    schedCount++;

    // 매니져 매일 09:00-18:00
    const s4s = new Date(dt); s4s.setHours(9, 0, 0, 0);
    const s4e = new Date(dt); s4e.setHours(18, 0, 0, 0);
    await db.insert(schema.schedules).values({ userId: 4, restaurantId: 1, startTime: s4s, endTime: s4e, status: weekOff === 0 ? "published" : "draft", shiftPreset: "full", createdBy: 3 });
    schedCount++;

    // 직원1 풀타임 09:00-18:00
    const s2s = new Date(dt); s2s.setHours(9, 0, 0, 0);
    const s2e = new Date(dt); s2e.setHours(18, 0, 0, 0);
    await db.insert(schema.schedules).values({ userId: 5, restaurantId: 1, startTime: s2s, endTime: s2e, status: weekOff === 0 ? "published" : "draft", shiftPreset: "full", createdBy: 3 });
    schedCount++;

    // 직원2 파트타임 (화목토)
    if (dt.getDay() === 2 || dt.getDay() === 4 || dt.getDay() === 6) {
      const s3s = new Date(dt); s3s.setHours(11, 0, 0, 0);
      const s3e = new Date(dt); s3e.setHours(15, 0, 0, 0);
      await db.insert(schema.schedules).values({ userId: 6, restaurantId: 1, startTime: s3s, endTime: s3e, status: weekOff === 0 ? "published" : "draft", shiftPreset: "custom", createdBy: 3 });
      schedCount++;
    }
  }
}
console.log(`  ✅ Schedules(${schedCount})`);

// 정기휴무 (일요일)
await db.insert(schema.storeWeeklyClosures).values({ restaurantId: 1, weekday: 0, isClosed: true });
console.log("  ✅ StoreWeeklyClosures(1)");

// 체크리스트 템플릿
const chkTmpls = [
  { type: "open" as const, items: ["전기/가스 점검", "식재료 해동 확인", "홀 청소 상태 확인", "POS 부팅 확인", "출입문 개방"] },
  { type: "order" as const, items: ["부족 식재료 파악", "거래처 주문 전화/문자", "배달 도착 확인", "재고 정리"] },
  { type: "cleaning" as const, items: ["주방 바닥 청소", "후드 필터 세척", "화장실 청소", "테이블/의자 정리", "쓰레기 배출"] },
];
let tmplCnt = 0;
for (const t of chkTmpls) {
  for (const [i, text] of t.items.entries()) {
    await db.insert(schema.storeChecklistTemplates).values({ restaurantId: 1, checkType: t.type, itemText: text, sortOrder: i, createdBy: 3 });
    tmplCnt++;
  }
}
console.log(`  ✅ StoreChecklistTemplates(${tmplCnt})`);

// 일일운영 (최근 7일)
for (let d = 7; d >= 1; d--) {
  const dt = daysAgo(d);
  if (dt.getDay() === 0) continue;
  const ds = dateStr(dt);
  const openT = new Date(dt); openT.setHours(8, 45, 0, 0);
  const closeT = new Date(dt); closeT.setHours(22, 10, 0, 0);
  await db.insert(schema.dailyOperations).values({
    restaurantId: 1, operationDate: ds,
    openCheckedAt: openT, openCheckedBy: 3, openHeadcount: 4,
    closeCheckedAt: d > 1 ? closeT : null, closeCheckedBy: d > 1 ? 3 : null, closeHeadcount: d > 1 ? 2 : 0,
  });
}
console.log("  ✅ DailyOperations(~6)");

// ═══════════════════════════════════════════════════════════════════
// Phase 3: 계약 + 알림 + 마감 + 레시피 + 업무정보
// ═══════════════════════════════════════════════════════════════════
console.log("── Phase 3: Contracts / Closings / Recipes / StoreInfo ──");

// 매장 계약
await db.insert(schema.restaurantContracts).values({
  restaurantId: 1, contractType: "rent", name: "Tutorial 매장 임대차계약",
  calcType: "fixed", fixedAmount: "3500000", startDate: "2025-06-01", endDate: "2027-05-31",
  note: "보증금 5천만원, 월세 350만원", createdBy: 1,
});
console.log("  ✅ RestaurantContracts(1)");

// 전자 근로계약서
const crypto = await import("crypto");
await db.insert(schema.employmentElectronicContracts).values({
  token: crypto.randomBytes(32).toString("hex"),
  restaurantId: 1, employeeId: 5, employeeName: "Tutorial 직원1", employeePhone: "01033333333",
  position: "홀서빙", contractType: "part_time", contractStart: "2026-01-01",
  wageType: "hourly", wageAmount: "10030", weeklyHours: "40",
  status: "signed", createdBy: 1, signedAt: new Date("2026-01-02"), sentAt: new Date("2026-01-01"),
});
await db.insert(schema.employmentElectronicContracts).values({
  token: crypto.randomBytes(32).toString("hex"),
  restaurantId: 1, employeeId: 6, employeeName: "Tutorial 직원2", employeePhone: "01044444444",
  position: "주방보조", contractType: "part_time", contractStart: "2026-01-01",
  wageType: "hourly", wageAmount: "10030", weeklyHours: "24",
  status: "sent", createdBy: 1, sentAt: new Date("2026-01-01"),
});
console.log("  ✅ EmploymentElectronicContracts(2)");

// 알림
const notiData = [
  { recipientId: 3, type: "schedule_change" as const, title: "Tutorial 직원1 스케줄 변경 요청", content: "3/20(목) 09:00-18:00 → 11:00-20:00 변경 요청", restaurantId: 1 },
  { recipientId: 3, type: "cost_exceeded" as const, title: "3월 식재료비 예산 초과 경고", content: "현재 식재료비 1,250만원 / 목표 1,200만원 (104%)", restaurantId: 1 },
  { recipientId: 1, type: "target_achieved" as const, title: "Tutorial 매장 3월 매출 목표 달성!", content: "현재 매출 4,620만원 / 목표 4,500만원 (102.7%)", restaurantId: 1 },
  { recipientId: 5, type: "schedule_assigned" as const, title: "3/24(월) 근무 배정", content: "09:00-18:00 풀타임 근무 배정되었습니다", restaurantId: 1 },
];
for (const n of notiData) await db.insert(schema.notifications).values(n);
console.log("  ✅ Notifications(4)");

// 월마감 (1~2월)
for (const m of [1, 2]) {
  await db.insert(schema.monthlyClosings).values({
    restaurantId: 1, year: 2026, month: m,
    salesTotal: m === 1 ? "42500000" : "39800000",
    purchasesTotal: m === 1 ? "12800000" : "11500000",
    laborCost: m === 1 ? "8200000" : "8000000",
    fixedCostsTotal: "4474000",
    profit: m === 1 ? "17026000" : "15826000",
    closedBy: 1,
  });
}
console.log("  ✅ MonthlyClosings(2)");

// 일마감 (최근 14일)
for (let d = 14; d >= 1; d--) {
  const dt = daysAgo(d);
  if (dt.getDay() === 0) continue;
  const ds = dateStr(dt);
  const salesTotal = 1300000 + Math.floor(Math.random() * 500000);
  const purchasesTotal = 150000 + Math.floor(Math.random() * 200000);
  await db.insert(schema.dailyClosings).values({
    restaurantId: 1, closingDate: ds,
    salesTotal: String(salesTotal), purchasesTotal: String(purchasesTotal),
    laborCost: "280000", fixedCostShare: "149000",
    profit: String(salesTotal - purchasesTotal - 280000 - 149000),
    salesBreakdown: [
      { typeName: "홀매출", amount: Math.floor(salesTotal * 0.55) },
      { typeName: "배달매출", amount: Math.floor(salesTotal * 0.28) },
      { typeName: "포장매출", amount: Math.floor(salesTotal * 0.17) },
    ],
    closedBy: 3,
  });
}
console.log("  ✅ DailyClosings(~12)");

// 레시피
const recipes = [
  { title: "수제비", category: "메인", content: "## 재료\n밀가루 500g, 감자 2개, 양파 1개, 대파 1대, 멸치육수 2L\n\n## 조리법\n1. 밀가루에 물을 넣고 반죽하여 30분 숙성\n2. 멸치육수를 끓이고 감자, 양파를 넣는다\n3. 반죽을 얇게 뜯어 넣고 대파를 올린다\n4. 간장으로 간을 맞추고 5분 더 끓인다" },
  { title: "김치찌개", category: "메인", content: "## 재료\n김치 300g, 돼지고기 목살 200g, 두부 1모, 대파 1대\n\n## 조리법\n1. 돼지고기를 먼저 볶다가 김치를 넣고 같이 볶는다\n2. 물 800ml를 넣고 끓인다\n3. 두부를 넣고 대파를 올린다\n4. 10분 더 끓여 완성" },
  { title: "된장찌개", category: "사이드", content: "## 재료\n된장 3큰술, 두부 1모, 감자 1개, 양파 반개, 대파 1대\n\n## 조리법\n1. 멸치육수를 끓인다\n2. 된장을 풀고 감자, 양파를 넣는다\n3. 두부를 넣고 5분 끓인다\n4. 대파를 올려 완성" },
];
for (const [i, r] of recipes.entries()) {
  await db.insert(schema.recipes).values({ restaurantId: 1, title: r.title, category: r.category, content: r.content, sortOrder: i, isPublished: true, createdBy: 3 });
}
console.log("  ✅ Recipes(3)");

// 업무정보 카드
const infoCards = [
  { cardType: "guide" as const, title: "오픈 업무 절차", content: "1. 조명/에어컨 켜기\n2. POS 부팅 확인\n3. 식재료 해동 상태 확인\n4. 홀 테이블 세팅\n5. 출입문 오픈\n6. 배달앱 영업 시작", isPinned: true },
  { cardType: "guide" as const, title: "마감 업무 절차", content: "1. 배달앱 영업 종료\n2. POS 마감 정산\n3. 잔여 식재료 냉장 보관\n4. 주방 청소 및 소독\n5. 쓰레기 배출\n6. 가스/전기 차단\n7. 출입문 잠금", isPinned: true },
];
for (const [i, c] of infoCards.entries()) {
  await db.insert(schema.storeInfoCards).values({ restaurantId: 1, ...c, sortOrder: i, createdBy: 3 });
}
console.log("  ✅ StoreInfoCards(2)");

// ═══════════════════════════════════════════════════════════════════
console.log("\n🎉 Tutorial Seed 완료!\n");
console.log("Tutorial 계정 (비밀번호 1111):");
console.log("  owner1      — Tutorial 점장 (매장 전권)");
console.log("  supervisor1 — Tutorial 매니져 (운영 실행)");
console.log("  staff1      — Tutorial 직원1 (풀타임)");
console.log("  staff2      — Tutorial 직원2 (파트타임)");
console.log("\n관리자 계정:");
console.log("  master — 개발자 (비밀번호: 별도)");
console.log("  admin  — 대표 (비밀번호: 별도)");

await pool.end();
process.exit(0);
