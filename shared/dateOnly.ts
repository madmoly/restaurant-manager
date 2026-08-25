/**
 * DATE 컬럼 값을 "YYYY-MM-DD"로 정규화한다. 서버·클라이언트 공용.
 *
 * store_closed_days.closedDate 같은 MySQL DATE 컬럼은 경유 경로에 따라 형태가 다르다.
 * - Drizzle 직접 조회: JS Date (mysql2가 dateStrings 미설정이라 Date로 파싱)
 * - tRPC 응답: transformer가 없어 JSON 직렬화되며 "2026-08-10T00:00:00.000Z" 문자열
 * - 일부 경로: 이미 "2026-08-10"
 *
 * 세 형태를 그대로 비교하면 조용히 어긋난다. 실제로 운영일지 휴무일 판정이
 * 문자열 분기에서 자르지 않아 항상 false였다. 비교 전에 반드시 이 함수를 거칠 것.
 */
export function toDateOnly(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // Date-like (직렬화 경계에서 넘어온 객체)
  const iso = (v as any)?.toISOString?.();
  return typeof iso === "string" ? iso.slice(0, 10) : null;
}
