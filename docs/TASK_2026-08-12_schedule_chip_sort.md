# TASK: 날짜 셀 근무 칩 자동 정렬

> 작성: 2026-08-12 Cowork(설계) → Claude Code 핸드오프
> 대상 파일: `client/src/pages/ScheduleGridTab.tsx`, `client/src/lib/scheduleHelpers.ts`
> 서버·스키마 변경 없음 (`listByRestaurant`의 `orderBy(schedules.startTime)`는 그대로 두고 클라이언트에서 재정렬)

## 사용자 결정 사항 (2026-08-12 확정)

1. 정렬 대상 = **날짜 셀 근무 칩 목록만**. 배정 모달·빠른배정 드롭다운은 이번 범위 밖.
2. 정렬 순서 = **근무시간 긴 순 → 직급 높은 순 → 가나다순**.
3. 임시근로자는 **맨 아래 고정** (직급 개념 없음).

## Cowork 판단 (사용자 확인 없이 정한 것 — 이견 있으면 되돌릴 것)

- **'근무시간' = 실근무 분** = `(endTime - startTime) - (breakMinutes ?? 0)`. 총 체류시간이 아님.
- `userId == null` 인 행(임시근로자 + '미배정' 행)을 하단 그룹으로 묶는다. `tempWorkerName` 유무가 아니라 `userId` 기준 — 미배정 행도 같이 내려간다.
- staffList에 없는 userId(퇴사자의 과거 스케줄)는 직급 rank 0 = staff보다 아래, 임시근로자보다는 위.

---

## S1. `client/src/lib/scheduleHelpers.ts` — 정렬 헬퍼 추가

```ts
/** 매장 내 직급 서열. 값이 클수록 상단. 레거시 store_manager·manager는 supervisor 급. */
export const STORE_ROLE_RANK: Record<string, number> = {
  owner: 3,
  supervisor: 2,
  store_manager: 2,
  manager: 2,
  staff: 1,
};

/** 실근무 분 = (퇴근 - 출근) - 휴게. 정렬 전용(급여 계산에 쓰지 말 것). */
export function scheduleWorkMinutes(s: { startTime: string | Date; endTime: string | Date; breakMinutes: number | null }): number {
  const start = new Date(s.startTime).getTime();
  const end = new Date(s.endTime).getTime();
  if (!isFinite(start) || !isFinite(end)) return 0;
  const span = Math.max(0, Math.round((end - start) / 60000));
  return Math.max(0, span - (s.breakMinutes ?? 0));
}

/**
 * 날짜 셀 근무 칩 정렬 비교자 생성.
 * 순서: 정규직원 먼저 → 실근무 긴 순 → 직급 높은 순 → 이름 가나다 → id(완전 결정성)
 */
export function makeChipComparator(roleByUserId: Map<number, string>) {
  return (a: ScheduleItem, b: ScheduleItem): number => {
    const aTemp = a.userId == null ? 1 : 0;
    const bTemp = b.userId == null ? 1 : 0;
    if (aTemp !== bTemp) return aTemp - bTemp;

    const aw = scheduleWorkMinutes(a);
    const bw = scheduleWorkMinutes(b);
    if (aw !== bw) return bw - aw;

    const aRank = a.userId != null ? (STORE_ROLE_RANK[roleByUserId.get(a.userId) ?? ""] ?? 0) : 0;
    const bRank = b.userId != null ? (STORE_ROLE_RANK[roleByUserId.get(b.userId) ?? ""] ?? 0) : 0;
    if (aRank !== bRank) return bRank - aRank;

    const aName = a.userName ?? a.tempWorkerName ?? "";
    const bName = b.userName ?? b.tempWorkerName ?? "";
    const byName = aName.localeCompare(bName, "ko");
    if (byName !== 0) return byName;

    return a.id - b.id;
  };
}
```

## S2. `ScheduleGridTab.tsx` — 정렬 적용

**S2-1. 직급 Map 추가** (기존 `staffNameById` L507~511 바로 아래)
```ts
const staffRoleById = useMemo(() => {
  const m = new Map<number, string>();
  (staffList as StaffItem[]).forEach((s) => m.set(s.userId, s.storeRole));
  return m;
}, [staffList]);
```

**S2-2. `activeSchedulesByDate` (L547~553)에서 정렬**
```ts
// before
const activeSchedulesByDate = useMemo(() => {
  const map = new Map<string, ScheduleItem[]>();
  scheduleByDate.forEach((items, dateStr) => {
    map.set(dateStr, items.filter(s => s.status !== "canceled"));
  });
  return map;
}, [scheduleByDate]);

// after
const activeSchedulesByDate = useMemo(() => {
  const cmp = makeChipComparator(staffRoleById);
  const map = new Map<string, ScheduleItem[]>();
  scheduleByDate.forEach((items, dateStr) => {
    // filter가 새 배열을 반환하므로 in-place sort 안전 (원본 pages 불변)
    map.set(dateStr, items.filter(s => s.status !== "canceled").sort(cmp));
  });
  return map;
}, [scheduleByDate, staffRoleById]);
```

**S2-3. import 추가**: `makeChipComparator` (필요 시 `STORE_ROLE_RANK`, `scheduleWorkMinutes`는 헬퍼 내부에서만 사용)

## S3. 건드리면 안 되는 곳

- `server/routers/schedules.ts` `listByRestaurant`의 `.orderBy(schedules.startTime)` — 다른 소비처(월정산·근무현황·엑셀 export)가 시간순을 전제한다. **서버 정렬 변경 금지**.
- `scheduleByDate`(L534) — `allDay` 확정 버튼 판정용. 정렬 불필요, 그대로 둘 것.
- `headcountByDate`(L555) — 합계 계산이라 순서 무관. 변경 없음.
- `scheduleWorkMinutes`는 정렬 전용. 급여·근로시간 집계는 서버 `server/helpers/` 경로가 SSOT — 이 함수를 급여 쪽에 재사용하지 말 것.

## S4. 알려진 부작용 (인지 사항)

- **칩이 더 이상 출근시간순이 아니다.** 10~22시 마감조가 09~13시 오픈조 위에 온다. 사용자 확정 사항.
- **정렬 근거가 화면에 안 보이는 경우가 있다.** 현재 칩 2번째 줄은 프리셋이 있으면 라벨("오픈"/"마감")만 표시하고 시간을 감춘다. 근무시간 순 정렬인데 시간이 안 보이면 순서가 임의로 보인다. 필요하면 후속 과제로 (a) 프리셋 칩에도 압축 시간 병기 또는 (b) 셀 헤더에 "근무시간순" 라벨 표기.
- 배정 모달·빠른배정 드롭다운의 직원 순서는 여전히 DB 반환 순서(`restaurants.getStaff`에 `orderBy` 없음)라 그리드와 다르다. 후속 과제 후보.
- `staffList` 로딩 전 1프레임 동안 직급 rank가 전부 0 → 근무시간·가나다만으로 정렬된 뒤 재정렬된다. 깜빡임 우려 시 `staffList.length === 0`이면 정렬 스킵으로 처리 가능(현재 스펙은 미적용).

## 완료 조건

- 같은 날짜 셀에서 근무시간이 긴 직원이 위, 동일 시간이면 점장 → 매니져 → 직원 순, 그것도 같으면 가나다순.
- 임시근로자 칩은 항상 정규 직원 아래.
- 취소 건은 여전히 미표시, 인원수(N명) 값 불변, 확정 버튼 노출 조건 불변.
- 같은 데이터로 재렌더 시 순서가 흔들리지 않음(id tiebreak).

## 테스트 (신규, `tests/scheduleHelpers.test.ts`에 추가)

```ts
const mk = (o: Partial<ScheduleItem> & { id: number }) => ({
  userId: null, tempWorkerName: null, userName: null, breakMinutes: 0,
  startTime: "2026-08-12T09:00:00", endTime: "2026-08-12T13:00:00",
  status: "confirmed", shiftPreset: null, ...o,
}) as any;

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
  expect([a, b].sort(makeChipComparator(new Map())).map(r => r.id)).toEqual([2, 1]);
});
```

## 커밋 메시지 초안

```
feat(schedule): 날짜 셀 근무 칩 자동 정렬 (근무시간·직급·가나다)

- 실근무 긴 순 → 직급(owner>supervisor>staff) → 이름 가나다 → id
- 임시근로자·미배정 행은 하단 그룹 고정
- 서버 orderBy(startTime)는 유지, 클라이언트 파생 정렬만 추가
```

---

## 진행 로그

- 2026-08-12 Code — S1 헬퍼(STORE_ROLE_RANK / scheduleWorkMinutes / makeChipComparator) + S2 staffRoleById·activeSchedulesByDate 정렬 + S4 테스트 2건 구현. build 통과, vitest 5 files / 109 tests 통과. 서버·스키마 변경 0건 / 미해결: S4 인지사항(프리셋 칩에 시간 미표시로 정렬 근거가 화면에 안 보이는 경우)은 후속 과제로 남김
