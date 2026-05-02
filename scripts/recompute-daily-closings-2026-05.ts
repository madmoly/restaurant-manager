/**
 * Phase 5.5 (1회성, master 권한) — 2026-05 daily_closings 인건비 재산출
 *
 * 트리거 (정책 §3.6):
 *   Phase 5 적용 후 monthlyClosings.sumLaborByCompany의 박제 안전망(ratio 보정)이
 *   cda02e6 이전 박제값(옛 산식, 월급제 시간 비례 포함)과 충돌. ratio가 부풀려져
 *   시급제 amountShifts가 비현실적으로 커지고, 거기에 monthlyTotalCost까지 가산
 *   → 사양 정반대 결과.
 *
 * 대응: 5월 박제값을 신 산식으로 강제 재산출 후 push.
 *
 * 신 산식 (dailyClosings.calculateDay Phase 5와 동일):
 *   - 정규 월급제(`!tempWageType && wageType === "monthly"`) 시프트: wage=0 누적 안 함
 *   - 임시근로자(tempWage*) + 시급제 + 일급제: 시간 × 시급/일급 누적
 *   - profit = salesTotal - purchasesTotal - newLaborCost - fixedCostShare
 *
 * 실행:
 *   pnpm tsx scripts/recompute-daily-closings-2026-05.ts                  # dry-run (default)
 *   pnpm tsx scripts/recompute-daily-closings-2026-05.ts --apply --user=N # 실제 UPDATE + audit_logs
 *
 * --user=N 의 N은 master 사용자 ID (audit_logs.userId 기록용). --apply에 필수.
 *
 * 사양 §3.6 후속:
 *   - 5월 외 과거(2025~2026-04)는 미터치. 옛 산식이라도 옛 박제대로 둠.
 *   - 점장 수동 수정분 손실 가능성: dry-run에서 차이가 큰 row는 별도 검토.
 *   - audit_logs에 row당 1건 기록 (target='daily_closing', action='update',
 *     details={ before, after, reason }).
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const userArg = process.argv.find((a) => a.startsWith("--user="));
const MASTER_USER_ID = userArg ? Number(userArg.slice("--user=".length)) : null;

if (APPLY && (!MASTER_USER_ID || !isFinite(MASTER_USER_ID))) {
  console.error("ERROR: --apply 사용 시 --user=<masterUserId> 필수 (audit_logs 기록용)");
  process.exit(1);
}

const FROM = "2026-05-01";
const TO_EXCL = "2026-06-01";

const conn = await mysql.createConnection(process.env.DATABASE_URL!);

// 1) 5월 박제 daily_closings 조회 (전 매장)
const [closings] = (await conn.query(
  `SELECT id, restaurantId, DATE_FORMAT(closingDate, '%Y-%m-%d') AS dateStr,
          salesTotal, purchasesTotal, laborCost, fixedCostShare, profit
     FROM daily_closings
    WHERE closingDate >= ? AND closingDate < ?
    ORDER BY restaurantId, closingDate`,
  [FROM, TO_EXCL],
)) as any;

console.log(`5월 daily_closings 박제 row: ${closings.length}건 (전 매장, ${FROM} ~ ${TO_EXCL} 미만)`);

if (closings.length === 0) {
  console.log("재산출 대상 없음. push 진행 가능.");
  await conn.end();
  process.exit(0);
}

// 매장별 affiliated_companies (현재는 over5는 산식에 영향 없으나 산식 호환 위해 fetch — 분모 209h 통일)
// 신 산식에서 over5는 분기 분모에 영향 없음 (computeMonthlyStandardHours는 항상 209 반환). Skip.

type RowOut = {
  id: number;
  restaurantId: number;
  dateStr: string;
  oldLabor: number;
  newLabor: number;
  diff: number;
  oldProfit: number;
  newProfit: number;
  shifts: number;
  monthlyExcluded: number; // 정규 월급제 시프트 (제외된 건수)
};

const results: RowOut[] = [];

// 2) row별 신 산식 재산출
for (const c of closings) {
  // KST 해당일의 schedules (status='completed') 조회 + wage_history 시점 매칭
  const [schedRows] = (await conn.query(
    `SELECT s.id AS scheduleId,
            s.startTime, s.endTime, s.breakMinutes,
            s.tempWageType, s.tempWageAmount,
            wh.wageType, wh.wageAmount
       FROM schedules s
       LEFT JOIN employee_wage_history wh
         ON wh.userId = s.userId
        AND wh.restaurantId = s.restaurantId
        AND DATE_FORMAT(CONVERT_TZ(s.startTime, '+00:00', '+09:00'), '%Y-%m-01') >= wh.effectiveFrom
        AND (wh.effectiveTo IS NULL
             OR DATE_FORMAT(CONVERT_TZ(s.startTime, '+00:00', '+09:00'), '%Y-%m-01') < wh.effectiveTo)
      WHERE s.restaurantId = ?
        AND DATE(CONVERT_TZ(s.startTime, '+00:00', '+09:00')) = ?
        AND s.status = 'completed'`,
    [c.restaurantId, c.dateStr],
  )) as any;

  let newLabor = 0;
  let monthlyExcluded = 0;
  for (const r of schedRows) {
    const sDt = new Date(r.startTime);
    const eDt = new Date(r.endTime);
    const gMin = (eDt.getTime() - sDt.getTime()) / 60000;
    const nMin = Math.max(0, gMin - (r.breakMinutes ?? 0));
    const hrs = nMin / 60;

    const isTemp = !!r.tempWageType && !!r.tempWageAmount;
    const isRegularMonthly = !isTemp && r.wageType === "monthly";

    if (isRegularMonthly) {
      monthlyExcluded++;
      continue; // Phase 5: 정규 월급제는 일별 누적 제외
    }

    let wt: string | null = null;
    let wa: number | null = null;
    if (isTemp) {
      wt = String(r.tempWageType);
      wa = Number(r.tempWageAmount);
    } else if (r.wageType && r.wageAmount) {
      wt = String(r.wageType);
      wa = Number(r.wageAmount);
    }
    if (!wt || wa == null || !isFinite(wa) || wa <= 0) continue;

    if (wt === "daily") {
      newLabor += wa;
    } else if (wt === "hourly") {
      newLabor += hrs * wa;
    } else if (wt === "monthly") {
      // 임시근로자(tempWageType=monthly) — 분모 209h 시간 비례
      newLabor += hrs * (wa / 209);
    }
  }
  newLabor = Math.round(newLabor);

  const oldLabor = Math.round(Number(c.laborCost ?? 0));
  const oldProfit = Math.round(Number(c.profit ?? 0));
  const sales = Number(c.salesTotal ?? 0);
  const purchases = Number(c.purchasesTotal ?? 0);
  const fixed = Number(c.fixedCostShare ?? 0);
  const newProfit = Math.round(sales - purchases - newLabor - fixed);

  results.push({
    id: c.id,
    restaurantId: c.restaurantId,
    dateStr: c.dateStr,
    oldLabor,
    newLabor,
    diff: newLabor - oldLabor,
    oldProfit,
    newProfit,
    shifts: schedRows.length,
    monthlyExcluded,
  });
}

// 3) 변경 있는 row만 추출
const changed = results.filter((r) => r.diff !== 0);
const unchanged = results.length - changed.length;

console.log(`\n=== 재산출 요약 ===`);
console.log(`전체 박제 row : ${results.length}`);
console.log(`변경 없음     : ${unchanged}`);
console.log(`변경 있음     : ${changed.length}`);

if (changed.length > 0) {
  const diffs = changed.map((r) => r.diff);
  const sumDiff = diffs.reduce((a, b) => a + b, 0);
  const avgDiff = Math.round(sumDiff / changed.length);
  const maxDecrease = Math.min(...diffs);
  const maxIncrease = Math.max(...diffs);
  console.log(`평균 변경     : ${avgDiff >= 0 ? "+" : ""}${avgDiff.toLocaleString()}원`);
  console.log(`최대 감소     : ${maxDecrease.toLocaleString()}원 (월급제 시프트가 옛 산식에 포함되어 있던 경우)`);
  console.log(`최대 증가     : ${maxIncrease >= 0 ? "+" : ""}${maxIncrease.toLocaleString()}원`);
  console.log(`총 합계 차이  : ${sumDiff >= 0 ? "+" : ""}${sumDiff.toLocaleString()}원`);

  // 매장별 집계
  const byRest = new Map<number, { rows: number; sumDiff: number }>();
  for (const r of changed) {
    const e = byRest.get(r.restaurantId) ?? { rows: 0, sumDiff: 0 };
    e.rows++;
    e.sumDiff += r.diff;
    byRest.set(r.restaurantId, e);
  }
  console.log(`\n=== 매장별 변경 집계 ===`);
  console.table(
    Array.from(byRest.entries()).map(([rid, v]) => ({
      restaurantId: rid,
      changedRows: v.rows,
      sumDiff: v.sumDiff.toLocaleString() + "원",
    })),
  );

  // 상세 (앞 30건)
  console.log(`\n=== 변경 상세 (앞 30건) ===`);
  console.table(
    changed.slice(0, 30).map((r) => ({
      id: r.id,
      restId: r.restaurantId,
      date: r.dateStr,
      oldLabor: r.oldLabor.toLocaleString(),
      newLabor: r.newLabor.toLocaleString(),
      diff: (r.diff >= 0 ? "+" : "") + r.diff.toLocaleString(),
      shifts: r.shifts,
      monthlyExc: r.monthlyExcluded,
    })),
  );

  // 차이 큰 row 경고 (절대값 100,000원 초과 = 점장 수동 수정 의심)
  const bigDiff = changed.filter((r) => Math.abs(r.diff) > 100000);
  if (bigDiff.length > 0) {
    console.log(`\n⚠ 차이 100,000원 초과 row ${bigDiff.length}건 — 점장 수동 수정분일 가능성. 별도 검토 필요:`);
    console.table(
      bigDiff.map((r) => ({
        id: r.id,
        restId: r.restaurantId,
        date: r.dateStr,
        oldLabor: r.oldLabor.toLocaleString(),
        newLabor: r.newLabor.toLocaleString(),
        diff: (r.diff >= 0 ? "+" : "") + r.diff.toLocaleString(),
      })),
    );
  }
}

if (!APPLY) {
  console.log(`\n=== DRY RUN 종료 ===`);
  console.log(`실제 UPDATE 적용은: pnpm tsx scripts/recompute-daily-closings-2026-05.ts --apply --user=<masterUserId>`);
  await conn.end();
  process.exit(0);
}

if (changed.length === 0) {
  console.log(`\n변경 대상 없음 — UPDATE 미실행. 종료.`);
  await conn.end();
  process.exit(0);
}

// 4) APPLY: row별 UPDATE + audit_logs INSERT (트랜잭션 단위 = row 단위)
console.log(`\n=== APPLY 시작 — ${changed.length}건 UPDATE + audit_logs ===`);
let applied = 0;
let failed = 0;
for (const r of changed) {
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE daily_closings SET laborCost = ?, profit = ? WHERE id = ?`,
      [String(r.newLabor), String(r.newProfit), r.id],
    );
    await conn.query(
      `INSERT INTO audit_logs (userId, userName, restaurantId, action, target, targetId, details)
       VALUES (?, ?, ?, 'update', 'daily_closing', ?, ?)`,
      [
        MASTER_USER_ID,
        "master (recompute-2026-05 script)",
        r.restaurantId,
        r.id,
        JSON.stringify({
          before: { laborCost: r.oldLabor, profit: r.oldProfit },
          after: { laborCost: r.newLabor, profit: r.newProfit },
          diff: { laborCost: r.diff, profit: r.newProfit - r.oldProfit },
          shifts: r.shifts,
          monthlyExcluded: r.monthlyExcluded,
          reason: "monthly payroll redesign 2026-05-02 (Phase 5.5 — daily_closings recompute)",
        }),
      ],
    );
    await conn.commit();
    applied++;
  } catch (e) {
    await conn.rollback();
    failed++;
    console.error(`FAIL id=${r.id} restId=${r.restaurantId} date=${r.dateStr}:`, e);
  }
}

console.log(`\nAPPLY 완료 — 적용 ${applied}건 / 실패 ${failed}건`);
await conn.end();
