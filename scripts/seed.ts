import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import * as schema from "../drizzle/schema";

const pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(pool, { schema, mode: "default" });

const pw = await bcrypt.hash("1111", 10);

console.log("🌱 Seeding all phases...\n");

// ═══════════════════════════════════════════════════════════════════
// Phase 0: Users + Restaurants + RestaurantUsers
// ═══════════════════════════════════════════════════════════════════
console.log("── Phase 0: Users / Restaurants ──");

await db.insert(schema.users).values({ username: "master", passwordHash: pw, name: "마스터", role: "master", phone: "01056695407" })
  .onDuplicateKeyUpdate({ set: { passwordHash: pw, role: "master" } });
await db.insert(schema.users).values({ username: "admin", passwordHash: pw, name: "관리자", role: "admin", phone: "01012345678" })
  .onDuplicateKeyUpdate({ set: { passwordHash: pw, role: "admin" } });
await db.insert(schema.users).values({ username: "manager1", passwordHash: pw, name: "박점장", role: "employee", phone: "01011112222" })
  .onDuplicateKeyUpdate({ set: { passwordHash: pw } });
await db.insert(schema.users).values({ username: "manager2", passwordHash: pw, name: "이점장", role: "employee", phone: "01033334444" })
  .onDuplicateKeyUpdate({ set: { passwordHash: pw } });
await db.insert(schema.users).values({ username: "staff1", passwordHash: pw, name: "김직원", role: "employee", phone: "01055556666" })
  .onDuplicateKeyUpdate({ set: { passwordHash: pw } });
await db.insert(schema.users).values({ username: "staff2", passwordHash: pw, name: "이직원", role: "employee", phone: "01077778888" })
  .onDuplicateKeyUpdate({ set: { passwordHash: pw } });
await db.insert(schema.users).values({ username: "staff3", passwordHash: pw, name: "최알바", role: "employee", phone: "01099990000" })
  .onDuplicateKeyUpdate({ set: { passwordHash: pw } });
await db.insert(schema.users).values({ username: "staff4", passwordHash: pw, name: "정알바", role: "employee", phone: "01011223344" })
  .onDuplicateKeyUpdate({ set: { passwordHash: pw } });

// user IDs: 1=master, 2=admin, 3=manager1(박점장), 4=manager2(이점장),
//           5=staff1(김직원), 6=staff2(이직원), 7=staff3(최알바), 8=staff4(정알바)

await db.insert(schema.restaurants).values({
  name: "청계산뚝배기수제비 천호점", address: "서울 강동구 천호대로 1023", phone: "02-478-1234",
  monthlyTargetSales: "45000000", openTime: "09:00", closeTime: "22:00",
}).onDuplicateKeyUpdate({ set: { name: "청계산뚝배기수제비 천호점" } });

await db.insert(schema.restaurants).values({
  name: "청계산뚝배기수제비 강남점", address: "서울 강남구 테헤란로 152", phone: "02-555-9876",
  monthlyTargetSales: "55000000", openTime: "10:00", closeTime: "22:00",
}).onDuplicateKeyUpdate({ set: { name: "청계산뚝배기수제비 강남점" } });

// restaurant IDs: 1=천호점, 2=강남점

// 천호점 배정
await db.insert(schema.restaurantUsers).values({ restaurantId: 1, userId: 3, role: "store_manager" })
  .onDuplicateKeyUpdate({ set: { role: "store_manager" } });
await db.insert(schema.restaurantUsers).values({ restaurantId: 1, userId: 5, role: "employee" })
  .onDuplicateKeyUpdate({ set: { role: "employee" } });
await db.insert(schema.restaurantUsers).values({ restaurantId: 1, userId: 7, role: "employee" })
  .onDuplicateKeyUpdate({ set: { role: "employee" } });

// 강남점 배정
await db.insert(schema.restaurantUsers).values({ restaurantId: 2, userId: 4, role: "store_manager" })
  .onDuplicateKeyUpdate({ set: { role: "store_manager" } });
await db.insert(schema.restaurantUsers).values({ restaurantId: 2, userId: 6, role: "employee" })
  .onDuplicateKeyUpdate({ set: { role: "employee" } });
await db.insert(schema.restaurantUsers).values({ restaurantId: 2, userId: 8, role: "employee" })
  .onDuplicateKeyUpdate({ set: { role: "employee" } });

console.log("  ✅ Users(8), Restaurants(2), RestaurantUsers(6)");

// ═══════════════════════════════════════════════════════════════════
// Phase 1: Sales + Counterparties + Purchases + FixedCosts + DailyClosing
// ═══════════════════════════════════════════════════════════════════
console.log("── Phase 1: Sales / Counterparties / Purchases / FixedCosts ──");

// 매출 — 최근 3개월 (천호점)
const salesData: { restaurantId: number; saleDate: string; amount: string; note: string; recordedBy: number }[] = [];
const today = new Date();
for (let d = 90; d >= 0; d--) {
  const dt = new Date(today);
  dt.setDate(dt.getDate() - d);
  const dateStr = dt.toISOString().slice(0, 10);
  const dayOfWeek = dt.getDay();
  // 주말 매출 높음, 평일 기본
  const base = dayOfWeek === 0 || dayOfWeek === 6 ? 1800000 : 1400000;
  const variance = Math.floor(Math.random() * 400000) - 200000;
  salesData.push({ restaurantId: 1, saleDate: dateStr, amount: String(base + variance), note: "", recordedBy: 3 });
  // 강남점도
  const base2 = dayOfWeek === 0 || dayOfWeek === 6 ? 2100000 : 1700000;
  const variance2 = Math.floor(Math.random() * 500000) - 250000;
  salesData.push({ restaurantId: 2, saleDate: dateStr, amount: String(base2 + variance2), note: "", recordedBy: 4 });
}
for (const s of salesData) {
  await db.insert(schema.sales).values(s).onDuplicateKeyUpdate({ set: { amount: s.amount } });
}
console.log(`  ✅ Sales(${salesData.length})`);

// 거래처 (천호점)
const cpNames = [
  { name: "농협 하나로마트", type: "mart" as const, contact: "김농협", phone: "02-111-2222" },
  { name: "대한청과", type: "supplier" as const, contact: "박청과", phone: "010-2222-3333" },
  { name: "천호수산", type: "supplier" as const, contact: "이수산", phone: "010-3333-4444" },
  { name: "만능식자재", type: "supplier" as const, contact: "최식자재", phone: "010-4444-5555" },
  { name: "쿠팡", type: "online" as const, contact: "", phone: "" },
  { name: "천호설비수리", type: "repair" as const, contact: "정설비", phone: "010-5555-6666" },
];
for (const cp of cpNames) {
  await db.insert(schema.counterparties).values({
    restaurantId: 1, name: cp.name, counterpartyType: cp.type,
    contactName: cp.contact, contactPhone: cp.phone,
  }).onDuplicateKeyUpdate({ set: { name: cp.name } });
}
// 강남점 거래처
const cpNames2 = [
  { name: "이마트 역삼점", type: "mart" as const, contact: "이마트", phone: "02-666-7777" },
  { name: "서울청과", type: "supplier" as const, contact: "한청과", phone: "010-7777-8888" },
  { name: "강남수산", type: "supplier" as const, contact: "김수산", phone: "010-8888-9999" },
];
for (const cp of cpNames2) {
  await db.insert(schema.counterparties).values({
    restaurantId: 2, name: cp.name, counterpartyType: cp.type,
    contactName: cp.contact, contactPhone: cp.phone,
  }).onDuplicateKeyUpdate({ set: { name: cp.name } });
}
console.log("  ✅ Counterparties(9)");

// 매입 V1 (천호점, 최근 30일)
for (let d = 30; d >= 1; d--) {
  const dt = new Date(today);
  dt.setDate(dt.getDate() - d);
  const dateStr = dt.toISOString().slice(0, 10);
  if (d % 3 === 0) { // 3일에 한 번
    const amt = 200000 + Math.floor(Math.random() * 300000);
    const [result] = await db.insert(schema.purchaseOrders).values({
      restaurantId: 1, counterpartyId: (d % 4) + 1, purchaseDate: dateStr,
      totalAmount: String(amt), createdBy: 3,
    }).$returningId();
    await db.insert(schema.purchaseOrderItems).values({
      purchaseOrderId: result.id, itemName: "식자재 일괄", quantity: "1", unitName: "건",
      unitPrice: String(amt), lineTotal: String(amt), category: "식재료",
    });
  }
}
console.log("  ✅ PurchaseOrders V1 (~10)");

// 고정비
const fixedCostData = [
  { restaurantId: 1, costName: "임대료", costType: "monthly" as const, amount: "3500000" },
  { restaurantId: 1, costName: "전기요금", costType: "monthly" as const, amount: "450000" },
  { restaurantId: 1, costName: "가스요금", costType: "monthly" as const, amount: "280000" },
  { restaurantId: 1, costName: "수도요금", costType: "monthly" as const, amount: "120000" },
  { restaurantId: 1, costName: "인터넷/통신", costType: "monthly" as const, amount: "89000" },
  { restaurantId: 1, costName: "보험료", costType: "yearly" as const, amount: "1200000" },
  { restaurantId: 1, costName: "정수기 렌탈", costType: "monthly" as const, amount: "35000" },
  { restaurantId: 2, costName: "임대료", costType: "monthly" as const, amount: "5500000" },
  { restaurantId: 2, costName: "전기요금", costType: "monthly" as const, amount: "520000" },
  { restaurantId: 2, costName: "가스요금", costType: "monthly" as const, amount: "320000" },
  { restaurantId: 2, costName: "관리비", costType: "monthly" as const, amount: "450000" },
];
for (const fc of fixedCostData) {
  await db.insert(schema.fixedCosts).values({ ...fc, createdBy: 1 })
    .onDuplicateKeyUpdate({ set: { amount: fc.amount } });
}
console.log("  ✅ FixedCosts(11)");

// 일마감 매출 유형
const salesTypes = ["홀매출", "배달매출", "포장매출", "기타"];
for (const [i, t] of salesTypes.entries()) {
  await db.insert(schema.dailyClosingSalesTypes).values({ restaurantId: 1, typeName: t, sortOrder: i })
    .onDuplicateKeyUpdate({ set: { typeName: t } });
  await db.insert(schema.dailyClosingSalesTypes).values({ restaurantId: 2, typeName: t, sortOrder: i })
    .onDuplicateKeyUpdate({ set: { typeName: t } });
}
console.log("  ✅ DailyClosingSalesTypes(8)");

// ═══════════════════════════════════════════════════════════════════
// Phase 1-B: Items + CounterpartyItems + PurchasesV2
// ═══════════════════════════════════════════════════════════════════
console.log("── Phase 1-B: Items / CounterpartyItems / PurchasesV2 ──");

const itemNames = [
  { name: "양파", type: "product" as const, cat: "채소", unit: "kg" },
  { name: "대파", type: "product" as const, cat: "채소", unit: "단" },
  { name: "감자", type: "product" as const, cat: "채소", unit: "kg" },
  { name: "밀가루", type: "product" as const, cat: "곡류", unit: "kg" },
  { name: "멸치", type: "product" as const, cat: "건어물", unit: "kg" },
  { name: "다시마", type: "product" as const, cat: "건어물", unit: "kg" },
  { name: "돼지고기 목살", type: "product" as const, cat: "육류", unit: "kg" },
  { name: "소고기 양지", type: "product" as const, cat: "육류", unit: "kg" },
  { name: "두부", type: "product" as const, cat: "가공식품", unit: "모" },
  { name: "참기름", type: "product" as const, cat: "양념", unit: "병" },
  { name: "간장", type: "product" as const, cat: "양념", unit: "L" },
  { name: "고추장", type: "product" as const, cat: "양념", unit: "kg" },
  { name: "설거지용 세제", type: "misc" as const, cat: "소모품", unit: "통" },
  { name: "물티슈", type: "misc" as const, cat: "소모품", unit: "박스" },
];

const itemIds: number[] = [];
for (const it of itemNames) {
  const [result] = await db.insert(schema.items).values({
    restaurantId: 1, name: it.name, itemType: it.type, costingCategory: it.cat, baseUnit: it.unit,
  }).$returningId();
  itemIds.push(result.id);
}
console.log(`  ✅ Items(${itemIds.length})`);

// 거래처-품목 매핑 (counterpartyId: 1=농협, 2=대한청과, 3=천호수산, 4=만능식자재)
const cpItemMappings = [
  // 대한청과 → 채소
  { cpId: 2, itemIdx: 0, supName: "양파(특)", pUnit: "망(20kg)", price: "18000" },
  { cpId: 2, itemIdx: 1, supName: "대파(특)", pUnit: "단", price: "3500" },
  { cpId: 2, itemIdx: 2, supName: "감자(대)", pUnit: "망(10kg)", price: "12000" },
  // 천호수산 → 건어물
  { cpId: 3, itemIdx: 4, supName: "국물멸치(상)", pUnit: "kg", price: "28000" },
  { cpId: 3, itemIdx: 5, supName: "다시마(국산)", pUnit: "kg", price: "15000" },
  // 만능식자재 → 다양
  { cpId: 4, itemIdx: 3, supName: "백설 밀가루(중력)", pUnit: "20kg", price: "22000" },
  { cpId: 4, itemIdx: 6, supName: "목살(냉장)", pUnit: "kg", price: "13500" },
  { cpId: 4, itemIdx: 7, supName: "양지(1등급)", pUnit: "kg", price: "42000" },
  { cpId: 4, itemIdx: 8, supName: "두부(풀무원)", pUnit: "모", price: "2200" },
  { cpId: 4, itemIdx: 9, supName: "참기름(방앗간)", pUnit: "320ml", price: "8500" },
  { cpId: 4, itemIdx: 10, supName: "진간장(양조)", pUnit: "1.8L", price: "6500" },
  { cpId: 4, itemIdx: 11, supName: "고추장(해찬들)", pUnit: "3kg", price: "15000" },
  // 농협마트 → 소모품
  { cpId: 1, itemIdx: 12, supName: "주방세제(대용량)", pUnit: "4L", price: "8900" },
  { cpId: 1, itemIdx: 13, supName: "물티슈(80매x10)", pUnit: "박스", price: "12000" },
];

const cpItemIds: number[] = [];
for (const m of cpItemMappings) {
  const [result] = await db.insert(schema.counterpartyItems).values({
    restaurantId: 1, counterpartyId: m.cpId, itemId: itemIds[m.itemIdx],
    supplierItemName: m.supName, purchaseUnit: m.pUnit, lastPrice: m.price,
    defaultPrice: m.price, isPreferred: m.cpId === 4,
  }).$returningId();
  cpItemIds.push(result.id);
}
console.log(`  ✅ CounterpartyItems(${cpItemIds.length})`);

// 매입 V2 (천호점 최근 2주)
let v2Count = 0;
for (let d = 14; d >= 1; d--) {
  const dt = new Date(today);
  dt.setDate(dt.getDate() - d);
  const dateStr = dt.toISOString().slice(0, 10);
  if (d % 2 === 0) {
    // 만능식자재 발주
    const items4 = cpItemMappings.filter(m => m.cpId === 4);
    const selected = items4.slice(0, 3 + Math.floor(Math.random() * 3));
    let total = 0;
    const orderItems: { itemId: number; counterpartyItemId: number; rawItemName: string; quantity: string; unitName: string; unitPrice: string; lineTotal: string; costingCategory: string }[] = [];
    for (const s of selected) {
      const qty = 1 + Math.floor(Math.random() * 5);
      const price = Number(s.price);
      const lt = qty * price;
      total += lt;
      orderItems.push({
        itemId: itemIds[s.itemIdx], counterpartyItemId: cpItemIds[cpItemMappings.indexOf(s)],
        rawItemName: s.supName, quantity: String(qty), unitName: s.pUnit,
        unitPrice: s.price, lineTotal: String(lt), costingCategory: itemNames[s.itemIdx].cat,
      });
    }
    const [ord] = await db.insert(schema.purchaseOrdersV2).values({
      restaurantId: 1, counterpartyId: 4, purchaseDate: dateStr,
      status: "received", totalAmount: String(total), createdBy: 3,
    }).$returningId();
    for (const oi of orderItems) {
      await db.insert(schema.purchaseOrderItemsV2).values({ purchaseOrderId: ord.id, ...oi });
    }
    v2Count++;
  }
  if (d % 5 === 0) {
    // 대한청과 발주
    const lt = 18000 + Math.floor(Math.random() * 20000);
    const [ord] = await db.insert(schema.purchaseOrdersV2).values({
      restaurantId: 1, counterpartyId: 2, purchaseDate: dateStr,
      status: "received", totalAmount: String(lt), createdBy: 3,
    }).$returningId();
    await db.insert(schema.purchaseOrderItemsV2).values({
      purchaseOrderId: ord.id, itemId: itemIds[0], rawItemName: "양파(특)",
      quantity: "1", unitName: "망(20kg)", unitPrice: "18000", lineTotal: String(lt),
      costingCategory: "채소",
    });
    v2Count++;
  }
}
console.log(`  ✅ PurchaseOrdersV2(${v2Count})`);

// ═══════════════════════════════════════════════════════════════════
// Phase 2: Schedules + DailyOps + Checklists + Contracts
// ═══════════════════════════════════════════════════════════════════
console.log("── Phase 2: Schedules / DailyOps / Checklists ──");

// 근로계약
const contracts = [
  { userId: 5, restaurantId: 1, wageType: "hourly" as const, wageAmount: "10030", position: "홀", weeklyHours: "40" },
  { userId: 7, restaurantId: 1, wageType: "hourly" as const, wageAmount: "10030", position: "주방보조", weeklyHours: "24" },
  { userId: 6, restaurantId: 2, wageType: "hourly" as const, wageAmount: "10030", position: "홀", weeklyHours: "40" },
  { userId: 8, restaurantId: 2, wageType: "hourly" as const, wageAmount: "10030", position: "홀", weeklyHours: "20" },
  { userId: 3, restaurantId: 1, wageType: "monthly" as const, wageAmount: "3000000", position: "점장", weeklyHours: "48" },
  { userId: 4, restaurantId: 2, wageType: "monthly" as const, wageAmount: "3200000", position: "점장", weeklyHours: "48" },
];
for (const c of contracts) {
  await db.insert(schema.employeeContracts).values({
    ...c, contractStart: "2026-01-01",
  }).onDuplicateKeyUpdate({ set: { wageAmount: c.wageAmount } });
}
console.log("  ✅ EmployeeContracts(6)");

// 스케줄 — 이번 주 + 다음 주 (천호점)
const getMonday = (offset: number) => {
  const d = new Date(today);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) + offset * 7;
  d.setDate(diff);
  return d;
};

let schedCount = 0;
for (const weekOff of [0, 1]) { // 이번주, 다음주
  const mon = getMonday(weekOff);
  for (let dayOff = 0; dayOff < 7; dayOff++) {
    const dt = new Date(mon);
    dt.setDate(dt.getDate() + dayOff);
    const dayOfWeek = dt.getDay();
    if (dayOfWeek === 0) continue; // 일요일 휴무

    // 김직원: 풀타임 09-18
    const s1Start = new Date(dt); s1Start.setHours(9, 0, 0, 0);
    const s1End = new Date(dt); s1End.setHours(18, 0, 0, 0);
    await db.insert(schema.schedules).values({
      userId: 5, restaurantId: 1, startTime: s1Start, endTime: s1End,
      status: weekOff === 0 ? "published" : "draft", shiftPreset: "full", createdBy: 3,
    });
    schedCount++;

    // 최알바: 파트타임 (화목토만)
    if (dayOfWeek === 2 || dayOfWeek === 4 || dayOfWeek === 6) {
      const s2Start = new Date(dt); s2Start.setHours(11, 0, 0, 0);
      const s2End = new Date(dt); s2End.setHours(15, 0, 0, 0);
      await db.insert(schema.schedules).values({
        userId: 7, restaurantId: 1, startTime: s2Start, endTime: s2End,
        status: weekOff === 0 ? "published" : "draft", shiftPreset: "custom", createdBy: 3,
      });
      schedCount++;
    }

    // 박점장: 매일
    const s3Start = new Date(dt); s3Start.setHours(8, 30, 0, 0);
    const s3End = new Date(dt); s3End.setHours(21, 0, 0, 0);
    await db.insert(schema.schedules).values({
      userId: 3, restaurantId: 1, startTime: s3Start, endTime: s3End,
      status: weekOff === 0 ? "published" : "draft", shiftPreset: "full", createdBy: 3,
    });
    schedCount++;
  }
}
console.log(`  ✅ Schedules(${schedCount})`);

// 정기휴무 — 일요일
await db.insert(schema.storeWeeklyClosures).values({ restaurantId: 1, weekday: 0, isClosed: true })
  .onDuplicateKeyUpdate({ set: { isClosed: true } });
await db.insert(schema.storeWeeklyClosures).values({ restaurantId: 2, weekday: 0, isClosed: true })
  .onDuplicateKeyUpdate({ set: { isClosed: true } });
console.log("  ✅ StoreWeeklyClosures(2)");

// 체크리스트 템플릿
const checkTemplates = [
  { type: "open" as const, items: ["전기/가스 점검", "식재료 해동 확인", "홀 청소 상태 확인", "POS 부팅 확인", "출입문 개방"] },
  { type: "order" as const, items: ["부족 식재료 파악", "거래처 주문 전화/문자", "배달 도착 확인", "재고 정리"] },
  { type: "cleaning" as const, items: ["주방 바닥 청소", "후드 필터 세척", "화장실 청소", "테이블/의자 정리", "쓰레기 배출"] },
];
let tmplCount = 0;
for (const tmpl of checkTemplates) {
  for (const [i, text] of tmpl.items.entries()) {
    await db.insert(schema.storeChecklistTemplates).values({
      restaurantId: 1, checkType: tmpl.type, itemText: text, sortOrder: i, createdBy: 3,
    });
    tmplCount++;
  }
}
console.log(`  ✅ StoreChecklistTemplates(${tmplCount})`);

// 일일운영 (최근 7일 오픈체크 기록)
for (let d = 7; d >= 1; d--) {
  const dt = new Date(today);
  dt.setDate(dt.getDate() - d);
  const dateStr = dt.toISOString().slice(0, 10);
  if (dt.getDay() === 0) continue; // 일요일 건너뜀
  const openTime = new Date(dt); openTime.setHours(8, 45, 0, 0);
  const closeTime = new Date(dt); closeTime.setHours(22, 10, 0, 0);
  await db.insert(schema.dailyOperations).values({
    restaurantId: 1, operationDate: dateStr,
    openCheckedAt: openTime, openCheckedBy: 3, openHeadcount: 3,
    closeCheckedAt: d > 1 ? closeTime : null, closeCheckedBy: d > 1 ? 3 : null, closeHeadcount: d > 1 ? 2 : 0,
  });
}
console.log("  ✅ DailyOperations(~6)");

// ═══════════════════════════════════════════════════════════════════
// Phase 3: ElectronicContracts + Notifications + MonthlyClosings + RestaurantContracts
// ═══════════════════════════════════════════════════════════════════
console.log("── Phase 3: Contracts / Notifications / MonthlyClosings ──");

// 매장 계약 조건
await db.insert(schema.restaurantContracts).values({
  restaurantId: 1, contractType: "rent", name: "천호점 임대차계약",
  calcType: "fixed", fixedAmount: "3500000", startDate: "2025-06-01", endDate: "2027-05-31",
  note: "보증금 5천만원, 월세 350만원", createdBy: 1,
}).onDuplicateKeyUpdate({ set: { name: "천호점 임대차계약" } });

await db.insert(schema.restaurantContracts).values({
  restaurantId: 2, contractType: "commission", name: "강남점 수수료계약",
  calcType: "ratio", ratioPercent: "8.5", startDate: "2025-09-01", endDate: "2027-08-31",
  note: "매출의 8.5% 수수료", createdBy: 1,
}).onDuplicateKeyUpdate({ set: { name: "강남점 수수료계약" } });
console.log("  ✅ RestaurantContracts(2)");

// 전자 근로계약서
const crypto = await import("crypto");
const eContracts = [
  { employeeId: 5, employeeName: "김직원", phone: "01055556666", position: "홀서빙", contractType: "part_time" as const, wageType: "hourly" as const, wageAmount: "10030", status: "signed" as const },
  { employeeId: 7, employeeName: "최알바", phone: "01099990000", position: "주방보조", contractType: "part_time" as const, wageType: "hourly" as const, wageAmount: "10030", status: "sent" as const },
  { employeeId: 6, employeeName: "이직원", phone: "01077778888", position: "홀서빙", contractType: "part_time" as const, wageType: "hourly" as const, wageAmount: "10030", status: "draft" as const },
];
for (const ec of eContracts) {
  await db.insert(schema.employmentElectronicContracts).values({
    token: crypto.randomBytes(32).toString("hex"),
    restaurantId: ec.employeeId <= 7 ? 1 : 2,
    employeeId: ec.employeeId, employeeName: ec.employeeName, employeePhone: ec.phone,
    position: ec.position, contractType: ec.contractType, contractStart: "2026-01-01",
    wageType: ec.wageType, wageAmount: ec.wageAmount, weeklyHours: "40",
    status: ec.status, createdBy: 1,
    signedAt: ec.status === "signed" ? new Date("2026-01-02") : null,
    sentAt: ec.status !== "draft" ? new Date("2026-01-01") : null,
  });
}
console.log("  ✅ EmploymentElectronicContracts(3)");

// 알림
const notiData = [
  { recipientId: 3, type: "schedule_change" as const, title: "김직원 스케줄 변경 요청", content: "3/20(목) 09:00-18:00 → 11:00-20:00 변경 요청", restaurantId: 1 },
  { recipientId: 3, type: "cost_exceeded" as const, title: "3월 식재료비 예산 초과 경고", content: "현재 식재료비 1,250만원 / 목표 1,200만원 (104%)", restaurantId: 1 },
  { recipientId: 1, type: "target_achieved" as const, title: "천호점 3월 매출 목표 달성!", content: "현재 매출 4,620만원 / 목표 4,500만원 (102.7%)", restaurantId: 1 },
  { recipientId: 5, type: "schedule_assigned" as const, title: "3/24(월) 근무 배정", content: "09:00-18:00 풀타임 근무 배정되었습니다", restaurantId: 1 },
  { recipientId: 3, type: "general" as const, title: "시스템 업데이트 안내", content: "매입V2 기능이 추가되었습니다. 거래처별 품목 등록 후 사용해주세요.", restaurantId: null },
  { recipientId: 4, type: "schedule_updated" as const, title: "이직원 스케줄 수정", content: "3/21(금) 근무시간이 10:00-19:00으로 수정되었습니다", restaurantId: 2 },
];
for (const n of notiData) {
  await db.insert(schema.notifications).values(n);
}
console.log("  ✅ Notifications(6)");

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
  await db.insert(schema.monthlyClosings).values({
    restaurantId: 2, year: 2026, month: m,
    salesTotal: m === 1 ? "51200000" : "48700000",
    purchasesTotal: m === 1 ? "15300000" : "14100000",
    laborCost: m === 1 ? "9500000" : "9200000",
    fixedCostsTotal: "6790000",
    profit: m === 1 ? "19610000" : "18610000",
    closedBy: 1,
  });
}
console.log("  ✅ MonthlyClosings(4)");

// 일마감 (최근 7일, 천호점)
for (let d = 7; d >= 1; d--) {
  const dt = new Date(today);
  dt.setDate(dt.getDate() - d);
  if (dt.getDay() === 0) continue;
  const dateStr = dt.toISOString().slice(0, 10);
  const salesTotal = 1300000 + Math.floor(Math.random() * 500000);
  const purchasesTotal = 150000 + Math.floor(Math.random() * 200000);
  await db.insert(schema.dailyClosings).values({
    restaurantId: 1, closingDate: dateStr,
    salesTotal: String(salesTotal), purchasesTotal: String(purchasesTotal),
    laborCost: "280000", fixedCostShare: "149000",
    profit: String(salesTotal - purchasesTotal - 280000 - 149000),
    salesBreakdown: [
      { typeName: "홀매출", amount: Math.floor(salesTotal * 0.6) },
      { typeName: "배달매출", amount: Math.floor(salesTotal * 0.25) },
      { typeName: "포장매출", amount: Math.floor(salesTotal * 0.15) },
    ],
    closedBy: 3,
  });
}
console.log("  ✅ DailyClosings(~6)");

// ═══════════════════════════════════════════════════════════════════
console.log("\n🎉 Seed complete!\n");
console.log("계정 정보 (비밀번호 모두 1111):");
console.log("  master  — 마스터 (시스템 최고관리자)");
console.log("  admin   — 관리자");
console.log("  manager1 — 박점장 (천호점 점장)");
console.log("  manager2 — 이점장 (강남점 점장)");
console.log("  staff1  — 김직원 (천호점 홀)");
console.log("  staff2  — 이직원 (강남점 홀)");
console.log("  staff3  — 최알바 (천호점 주방보조)");
console.log("  staff4  — 정알바 (강남점 홀)");

await pool.end();
process.exit(0);
