/**
 * client/src/lib/dateKST.ts
 *
 * KST(UTC+9) 기준 날짜 유틸리티 — 클라이언트 전용 래퍼.
 * 브라우저는 시스템 타임존을 따르므로 서버와 동일한 KST 오프셋을 명시적으로 적용한다.
 *
 * 규칙:
 *   - 날짜 문자열("YYYY-MM-DD") 계산은 KST 기준
 *   - 표시는 toLocaleString() 등 브라우저 로케일 변환 사용
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000; // UTC+9

/**
 * 현재 KST 날짜 문자열 반환 ("YYYY-MM-DD")
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
 * KST 기준 이번 달 "YYYY-MM" 반환
 */
export function thisMonthKST(): string {
  return todayKST().slice(0, 7);
}

/**
 * "YYYY-MM-DD" 날짜 문자열에서 N일 후 날짜 반환
 */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return toKSTDateString(d);
}
