/**
 * 한국 공휴일 유틸리티 (클라이언트 래퍼)
 * 공휴일 데이터·판별은 @shared/holidays 단일 소스 사용 (대체공휴일 포함)
 */

import { getHolidayName } from "@shared/holidays";

export { getHolidayName, isHoliday, getHolidaysForYear } from "@shared/holidays";

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

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
