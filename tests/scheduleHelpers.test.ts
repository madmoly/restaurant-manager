/**
 * 스케줄 화면 헬퍼 단위 테스트
 *
 * 테스트 대상: client/src/lib/scheduleHelpers.ts
 * - makeChipComparator: 날짜 셀 근무 칩 정렬 (실근무 → 직급 → 가나다 → id)
 * - scheduleWorkMinutes: 실근무 분 = (퇴근 - 출근) - 휴게 (정렬 전용)
 */
import { describe, test, expect } from "vitest";
import { makeChipComparator, type ScheduleItem } from "@/lib/scheduleHelpers";

const mk = (o: Partial<ScheduleItem> & { id: number }) => ({
  userId: null, tempWorkerName: null, userName: null, breakMinutes: 0,
  startTime: "2026-08-12T09:00:00", endTime: "2026-08-12T13:00:00",
  status: "confirmed", shiftPreset: null, ...o,
}) as any;

describe("makeChipComparator", () => {
  test("근무시간 → 직급 → 가나다 → 임시근로자 하단", () => {
    const roles = new Map([[1, "staff"], [2, "owner"], [3, "supervisor"], [4, "staff"]]);
    const rows = [
      mk({ id: 1, userId: 1, userName: "김직원", endTime: "2026-08-12T13:00:00" }),          // 4h staff
      mk({ id: 2, userId: 2, userName: "박점장", endTime: "2026-08-12T17:00:00" }),          // 8h owner
      mk({ id: 3, userId: 3, userName: "이매니", endTime: "2026-08-12T17:00:00" }),          // 8h supervisor
      mk({ id: 4, userId: 4, userName: "강직원", endTime: "2026-08-12T13:00:00" }),          // 4h staff
      mk({ id: 5, tempWorkerName: "임시A", endTime: "2026-08-12T21:00:00" }),                 // 12h temp
    ];
    const sorted = [...rows].sort(makeChipComparator(roles)).map(r => r.id);
    expect(sorted).toEqual([2, 3, 4, 1, 5]);
  });

  test("휴게시간이 실근무를 줄인다", () => {
    const a = mk({ id: 1, userId: 1, userName: "가", endTime: "2026-08-12T18:00:00", breakMinutes: 120 }); // 7h
    const b = mk({ id: 2, userId: 2, userName: "나", endTime: "2026-08-12T17:00:00", breakMinutes: 0 });   // 8h
    expect([a, b].sort(makeChipComparator(new Map<number, string>())).map(r => r.id)).toEqual([2, 1]);
  });
});
