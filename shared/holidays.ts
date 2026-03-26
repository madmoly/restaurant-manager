/**
 * 한국 공휴일 유틸리티 (서버+클라이언트 공유)
 * 양력 고정 공휴일 + 음력 변환 공휴일 (2025~2027)
 */

// 양력 고정 공휴일
const FIXED_HOLIDAYS: Record<string, string> = {
  "01-01": "신정",
  "03-01": "삼일절",
  "05-05": "어린이날",
  "06-06": "현충일",
  "08-15": "광복절",
  "10-03": "개천절",
  "10-09": "한글날",
  "12-25": "크리스마스",
};

// 음력 기반 공휴일 (매년 양력 날짜가 다름)
const LUNAR_HOLIDAYS: Record<string, string> = {
  // 2025
  "2025-01-28": "설날 전날",
  "2025-01-29": "설날",
  "2025-01-30": "설날 다음날",
  "2025-05-05": "부처님오신날",
  "2025-10-05": "추석 전날",
  "2025-10-06": "추석",
  "2025-10-07": "추석 다음날",
  // 2026
  "2026-02-16": "설날 전날",
  "2026-02-17": "설날",
  "2026-02-18": "설날 다음날",
  "2026-05-24": "부처님오신날",
  "2026-09-24": "추석 전날",
  "2026-09-25": "추석",
  "2026-09-26": "추석 다음날",
  // 2027
  "2027-02-05": "설날 전날",
  "2027-02-06": "설날",
  "2027-02-07": "설날 다음날",
  "2027-05-13": "부처님오신날",
  "2027-10-14": "추석 전날",
  "2027-10-15": "추석",
  "2027-10-16": "추석 다음날",
};

/**
 * 주어진 날짜가 공휴일이면 명칭 반환, 아니면 null
 */
export function getHolidayName(dateStr: string): string | null {
  if (LUNAR_HOLIDAYS[dateStr]) return LUNAR_HOLIDAYS[dateStr];
  const mmdd = dateStr.slice(5); // "MM-DD"
  if (FIXED_HOLIDAYS[mmdd]) return FIXED_HOLIDAYS[mmdd];
  return null;
}

/**
 * 주어진 날짜가 공휴일인지 boolean 반환
 */
export function isHoliday(dateStr: string): boolean {
  return getHolidayName(dateStr) !== null;
}

/**
 * 특정 연도의 모든 공휴일 목록 반환
 */
export function getHolidaysForYear(year: number): Array<{ date: string; name: string }> {
  const result: Array<{ date: string; name: string }> = [];

  // 양력 고정
  for (const [mmdd, name] of Object.entries(FIXED_HOLIDAYS)) {
    result.push({ date: `${year}-${mmdd}`, name });
  }

  // 음력 기반
  for (const [dateStr, name] of Object.entries(LUNAR_HOLIDAYS)) {
    if (dateStr.startsWith(`${year}-`)) {
      result.push({ date: dateStr, name });
    }
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}
