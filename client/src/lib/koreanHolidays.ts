/**
 * 한국 공휴일 유틸리티
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
  "2025-05-05": "부처님오신날", // 4/8 음력 → 5/5 양력 2025
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

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 주어진 날짜가 공휴일이면 명칭 반환, 아니면 null
 */
export function getHolidayName(dateStr: string): string | null {
  // 음력 기반 공휴일 먼저 체크
  if (LUNAR_HOLIDAYS[dateStr]) return LUNAR_HOLIDAYS[dateStr];

  // 양력 고정 공휴일
  const mmdd = dateStr.slice(5); // "MM-DD"
  if (FIXED_HOLIDAYS[mmdd]) return FIXED_HOLIDAYS[mmdd];

  return null;
}

/**
 * 날짜 포맷: "3월 23일 (월)" 형태 + 공휴일이면 명칭 포함
 */
export function formatDateWithHoliday(dateStr: string): {
  display: string;
  holiday: string | null;
  dayName: string;
} {
  const d = new Date(dateStr + "T00:00:00");
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dayIdx = d.getDay();
  const dayName = DAY_NAMES[dayIdx];
  const holiday = getHolidayName(dateStr);

  let display = `${month}월 ${day}일 (${dayName})`;
  if (holiday) display += ` · ${holiday}`;

  return { display, holiday, dayName };
}
