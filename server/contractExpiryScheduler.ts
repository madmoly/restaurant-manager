/**
 * 계약 만료 알림 스케줄러
 * - 매일 오전 9시 실행
 * - D-90(3개월), D-30(1개월) 알림 발송
 * - 수습(월단위 최대 3개월) → 1년 계약직 전환 안내 포함
 */
import { getDb } from "./db";
import { employmentElectronicContracts, restaurants } from "../drizzle/schema";
import { notifyOwner } from "./_core/notification";
import { eq, and, gte, lte, isNotNull } from "drizzle-orm";

// 날짜 차이 계산 (일 단위)
function daysDiff(targetDate: Date, fromDate: Date = new Date()): number {
  const from = new Date(fromDate);
  from.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

// 수습 여부 판단 (contractType이 fixed_term이고 기간이 3개월 이하)
function isProbation(contract: typeof employmentElectronicContracts.$inferSelect): boolean {
  if (!contract.contractEnd || !contract.contractStart) return false;
  const start = new Date(contract.contractStart);
  const end = new Date(contract.contractEnd);
  const diffMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return contract.contractType === "fixed_term" && diffMonths <= 3;
}

export async function checkContractExpiry(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // 서명 완료된 기간제 계약서 중 종료일이 있는 것 조회
    const contracts = await db.select({
      contract: employmentElectronicContracts,
      restaurantName: restaurants.name,
    })
      .from(employmentElectronicContracts)
      .leftJoin(restaurants, eq(employmentElectronicContracts.restaurantId, restaurants.id))
      .where(
        and(
          eq(employmentElectronicContracts.status, "signed"),
          isNotNull(employmentElectronicContracts.contractEnd)
        )
      );

    const today = new Date();
    const notifications: string[] = [];

    for (const row of contracts) {
      const { contract, restaurantName } = row;
      if (!contract.contractEnd) continue;

      const endDate = new Date(contract.contractEnd);
      const days = daysDiff(endDate, today);
      const probation = isProbation(contract);
      const storeName = restaurantName ?? "매장";

      // D-90 알림 (3개월 전)
      if (days === 90) {
        const msg = probation
          ? `[계약 만료 D-90] ${storeName} · ${contract.employeeName}\n수습기간 종료 3개월 전입니다. 정식 1년 계약직 전환 여부를 검토하세요.\n만료일: ${String(contract.contractEnd).slice(0, 10)}`
          : `[계약 만료 D-90] ${storeName} · ${contract.employeeName}\n근로계약 만료 3개월 전입니다. 계약 갱신 여부를 검토하세요.\n만료일: ${String(contract.contractEnd).slice(0, 10)}`;
        notifications.push(msg);
        await notifyOwner({
          title: `⏰ 계약 만료 D-90 — ${contract.employeeName} (${storeName})`,
          content: msg,
        });
      }

      // D-60 알림 (수습 → 정식 전환 안내)
      if (days === 60 && probation) {
        const msg = `[수습 전환 안내 D-60] ${storeName} · ${contract.employeeName}\n수습기간 종료 2개월 전입니다. 1년 계약직 전환 계약서를 준비하세요.\n수습 만료일: ${String(contract.contractEnd).slice(0, 10)}`;
        notifications.push(msg);
        await notifyOwner({
          title: `📋 수습→정식 전환 안내 D-60 — ${contract.employeeName} (${storeName})`,
          content: msg,
        });
      }

      // D-30 알림 (1개월 전)
      if (days === 30) {
        const msg = probation
          ? `[수습 만료 D-30] ${storeName} · ${contract.employeeName}\n수습기간 종료 1개월 전입니다. 1년 계약직 전환 계약서를 즉시 발송하세요.\n수습 만료일: ${String(contract.contractEnd).slice(0, 10)}`
          : `[계약 만료 D-30] ${storeName} · ${contract.employeeName}\n근로계약 만료 1개월 전입니다. 계약 갱신 또는 종료 의사를 직원에게 통보하세요.\n만료일: ${String(contract.contractEnd).slice(0, 10)}`;
        notifications.push(msg);
        await notifyOwner({
          title: `🚨 계약 만료 D-30 — ${contract.employeeName} (${storeName})`,
          content: msg,
        });
      }

      // D-7 알림 (최종 경고)
      if (days === 7) {
        const msg = `[계약 만료 D-7] ${storeName} · ${contract.employeeName}\n계약 만료 7일 전입니다. 즉시 조치가 필요합니다.\n만료일: ${String(contract.contractEnd).slice(0, 10)}`;
        notifications.push(msg);
        await notifyOwner({
          title: `🔴 계약 만료 D-7 — ${contract.employeeName} (${storeName})`,
          content: msg,
        });
      }
    }

    if (notifications.length > 0) {
      console.log(`[ContractExpiry] ${today.toISOString()} — ${notifications.length}건 알림 발송 완료`);
    }
  } catch (err) {
    console.error("[ContractExpiry] 스케줄러 오류:", err);
  }
}

// 매일 오전 9시 실행 (한국 시간 기준 UTC+9 → UTC 00:00)
export function startContractExpiryScheduler(): void {
  const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24시간

  // 다음 오전 9시(KST)까지 대기
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setUTCHours(0, 0, 0, 0); // UTC 00:00 = KST 09:00
  if (now >= nextRun) {
    nextRun.setUTCDate(nextRun.getUTCDate() + 1);
  }
  const delay = nextRun.getTime() - now.getTime();

  console.log(`[ContractExpiry] 스케줄러 시작 — 첫 실행: ${nextRun.toISOString()} (${Math.round(delay / 1000 / 60)}분 후)`);

  setTimeout(() => {
    checkContractExpiry();
    setInterval(checkContractExpiry, INTERVAL_MS);
  }, delay);
}
