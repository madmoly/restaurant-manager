/**
 * shared/dateKST.ts
 *
 * KST(UTC+9) 기준 날짜 유틸리티 — 서버와 클라이언트 모두 이 파일을 참조한다.
 *
 * 배경:
 *   서버는 UTC 환경에서 실행된다. new Date().toISOString().split("T")[0]은
 *   UTC 자정 기준이므로 한국 시간 오전 0시~8시 59분 사이에 날짜가 하루 밀린다.
 *   모든 날짜 계산은 반드시 이 파일의 함수를 사용해야 한다.
 *
 * 규칙:
 *   - 저장/전송은 UTC 타임스탬프(ms) 또는 ISO 문자열
 *   - 날짜 문자열("YYYY-MM-DD") 계산은 KST 기준
 *   - 표시는 프론트에서 로케일 변환
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000; // UTC+9

/**
 * 현재 KST 날짜 문자열 반환 ("YYYY-MM-DD")
 *
 * @example
 * // 서버 UTC 환경에서 오전 1시(KST 오전 10시)
 * todayKST() // → "2026-03-19" (KST 기준 오늘)
 */
export function todayKST(): string {
  return toKSTDateString(new Date());
}

/**
 * Date 객체 또는 타임스탬프를 KST 날짜 문자열로 변환 ("YYYY-MM-DD")
 */
export function toKSTDateString(date: Date | number): string {
  const ms = typeof date === "number" ? date : date.getTime();
  const kstDate = new Date(ms + KST_OFFSET_MS);
  return kstDate.toISOString().split("T")[0];
}

/**
 * KST 기준 특정 날짜의 UTC 시작 시각 (00:00:00 KST = 전날 15:00:00 UTC)
 */
export function kstDayStartUTC(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+09:00`);
}

/**
 * KST 기준 특정 날짜의 UTC 종료 시각 (23:59:59 KST)
 */
export function kstDayEndUTC(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59+09:00`);
}

/**
 * KST 기준 이번 달 첫날 ("YYYY-MM-01")
 */
export function thisMonthKST(): string {
  const today = todayKST();
  return today.slice(0, 7) + "-01";
}

/**
 * "YYYY-MM-DD" 날짜 문자열에서 N일 후 날짜 반환
 */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00+09:00`); // 정오 기준으로 DST 영향 최소화
  d.setDate(d.getDate() + days);
  return toKSTDateString(d);
}

/**
 * 두 날짜 문자열 사이의 일수 차이 (양수: dateB가 더 미래)
 */
export function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(`${dateA}T12:00:00+09:00`).getTime();
  const b = new Date(`${dateB}T12:00:00+09:00`).getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}
