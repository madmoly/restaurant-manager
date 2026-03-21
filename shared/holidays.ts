/**
 * 대한민국 법정 공휴일 데이터 (2024~2027)
 * 대체공휴일 포함 (공휴일이 일요일/토요일에 겹칠 경우 다음 월요일)
 * 출처: 관공서의 공휴일에 관한 규정 (대통령령)
 */

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
  isSubstitute?: boolean; // 대체공휴일 여부
}

const HOLIDAYS_2024: Holiday[] = [
  { date: "2024-01-01", name: "신정" },
  { date: "2024-02-09", name: "설날 연휴" },
  { date: "2024-02-10", name: "설날" },
  { date: "2024-02-11", name: "설날 연휴" },
  { date: "2024-02-12", name: "설날 대체공휴일", isSubstitute: true },
  { date: "2024-03-01", name: "삼일절" },
  { date: "2024-04-10", name: "국회의원 선거일" },
  { date: "2024-05-05", name: "어린이날" },
  { date: "2024-05-06", name: "어린이날 대체공휴일", isSubstitute: true },
  { date: "2024-05-15", name: "부처님오신날" },
  { date: "2024-06-06", name: "현충일" },
  { date: "2024-08-15", name: "광복절" },
  { date: "2024-09-16", name: "추석 연휴" },
  { date: "2024-09-17", name: "추석" },
  { date: "2024-09-18", name: "추석 연휴" },
  { date: "2024-10-03", name: "개천절" },
  { date: "2024-10-09", name: "한글날" },
  { date: "2024-12-25", name: "성탄절" },
];

const HOLIDAYS_2025: Holiday[] = [
  { date: "2025-01-01", name: "신정" },
  { date: "2025-01-28", name: "설날 연휴" },
  { date: "2025-01-29", name: "설날" },
  { date: "2025-01-30", name: "설날 연휴" },
  { date: "2025-03-01", name: "삼일절" },
  { date: "2025-03-03", name: "삼일절 대체공휴일", isSubstitute: true },
  { date: "2025-05-05", name: "어린이날" },
  { date: "2025-05-06", name: "부처님오신날" },
  { date: "2025-06-06", name: "현충일" },
  { date: "2025-08-15", name: "광복절" },
  { date: "2025-10-03", name: "개천절" },
  { date: "2025-10-05", name: "추석 연휴" },
  { date: "2025-10-06", name: "추석" },
  { date: "2025-10-07", name: "추석 연휴" },
  { date: "2025-10-08", name: "추석 대체공휴일", isSubstitute: true },
  { date: "2025-10-09", name: "한글날" },
  { date: "2025-12-25", name: "성탄절" },
];

const HOLIDAYS_2026: Holiday[] = [
  { date: "2026-01-01", name: "신정" },
  { date: "2026-02-16", name: "설날 연휴" },
  { date: "2026-02-17", name: "설날" },
  { date: "2026-02-18", name: "설날 연휴" },
  { date: "2026-03-01", name: "삼일절" },
  { date: "2026-03-02", name: "삼일절 대체공휴일", isSubstitute: true },
  { date: "2026-05-05", name: "어린이날" },
  { date: "2026-05-24", name: "부처님오신날" },
  { date: "2026-05-25", name: "부처님오신날 대체공휴일", isSubstitute: true },
  { date: "2026-06-06", name: "현충일" },
  { date: "2026-08-15", name: "광복절" },
  { date: "2026-08-17", name: "광복절 대체공휴일", isSubstitute: true },
  { date: "2026-09-24", name: "추석 연휴" },
  { date: "2026-09-25", name: "추석" },
  { date: "2026-09-26", name: "추석 연휴" },
  { date: "2026-10-03", name: "개천절" },
  { date: "2026-10-05", name: "개천절 대체공휴일", isSubstitute: true },
  { date: "2026-10-09", name: "한글날" },
  { date: "2026-12-25", name: "성탄절" },
];

const HOLIDAYS_2027: Holiday[] = [
  { date: "2027-01-01", name: "신정" },
  { date: "2027-02-06", name: "설날 연휴" },
  { date: "2027-02-07", name: "설날" },
  { date: "2027-02-08", name: "설날 연휴" },
  { date: "2027-03-01", name: "삼일절" },
  { date: "2027-05-05", name: "어린이날" },
  { date: "2027-05-13", name: "부처님오신날" },
  { date: "2027-06-06", name: "현충일" },
  { date: "2027-08-15", name: "광복절" },
  { date: "2027-08-16", name: "광복절 대체공휴일", isSubstitute: true },
  { date: "2027-09-14", name: "추석 연휴" },
  { date: "2027-09-15", name: "추석" },
  { date: "2027-09-16", name: "추석 연휴" },
  { date: "2027-10-03", name: "개천절" },
  { date: "2027-10-04", name: "개천절 대체공휴일", isSubstitute: true },
  { date: "2027-10-09", name: "한글날" },
  { date: "2027-10-11", name: "한글날 대체공휴일", isSubstitute: true },
  { date: "2027-12-25", name: "성탄절" },
];

const ALL_HOLIDAYS: Record<number, Holiday[]> = {
  2024: HOLIDAYS_2024,
  2025: HOLIDAYS_2025,
  2026: HOLIDAYS_2026,
  2027: HOLIDAYS_2027,
};

/**
 * 특정 연도의 공휴일 목록 반환
 */
export function getHolidaysByYear(year: number): Holiday[] {
  return ALL_HOLIDAYS[year] ?? [];
}

/**
 * 특정 월의 공휴일 목록 반환
 */
export function getHolidaysByMonth(year: number, month: number): Holiday[] {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return getHolidaysByYear(year).filter(h => h.date.startsWith(prefix));
}

/**
 * 날짜 문자열(YYYY-MM-DD)이 공휴일인지 확인
 */
export function isHoliday(dateStr: string): Holiday | undefined {
  const year = parseInt(dateStr.slice(0, 4));
  return getHolidaysByYear(year).find(h => h.date === dateStr);
}

/**
 * 날짜 범위 내 공휴일 목록 반환
 */
export function getHolidaysInRange(startDate: string, endDate: string): Holiday[] {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();

  const result: Holiday[] = [];
  for (let y = startYear; y <= endYear; y++) {
    const holidays = getHolidaysByYear(y);
    for (const h of holidays) {
      if (h.date >= startDate && h.date <= endDate) {
        result.push(h);
      }
    }
  }
  return result;
}
