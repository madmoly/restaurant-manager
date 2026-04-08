# 스케줄 페이지 개편 설계서

> 작성: 2026-04-04 (Cowork) → Claude Code 실행용

## 현황 진단

### 구조적 문제
- `SchedulePage.tsx` 1,712줄 모놀리스 (LeaveRequestSection, ShiftPresetPanel 포함)
- 주간 뷰 단일 구조 — 월간 개요 없음, 전후 맥락 파악 불가
- 휴무신청/프리셋관리/스케줄그리드가 한 페이지에 혼재 → 스크롤 과다, 정보 위계 불명확
- 배정 모달 4스텝 반복 (날짜 클릭 → 직원 → 프리셋 → 저장) — 다수 배정 시 비효율

### 성능 문제
- `leaveRequests.listMine` + `leaveRequests.list` 동시 호출 (하나만 사용)
- `getShiftPresets` 2회 중복 호출 (메인 + ShiftPresetPanel)
- `getPresetTimes()` 메모이제이션 없이 렌더마다 반복 계산
- `daySchedules.filter()` 인라인 필터링 매 렌더 실행
- 프리셋 목록 렌더링 시 `shiftPresets.find()` 반복 조회

---

## 변경 범위 요약

| 영역 | 파일 | 변경 내용 |
|------|------|----------|
| 프론트 | `SchedulePage.tsx` | 3개 파일로 분리 + 탭 구조 + 월간미니맵 + 빠른배정 |
| 프론트 (신규) | `ScheduleGridTab.tsx` | 주간 그리드 + 월간 미니맵 + 배정/수정 모달 |
| 프론트 (신규) | `LeaveRequestTab.tsx` | 기존 LeaveRequestSection 독립 |
| 프론트 (신규) | `ShiftPresetTab.tsx` | 기존 ShiftPresetPanel 독립 (매니저 전용) |
| 백엔드 | `schedules.ts` 라우터 | `monthlySummary` 프로시저 추가 |
| 스키마 | 변경 없음 | — |

---

## Phase 1: 성능 최적화 (구조 변경 전)

### 1-1. 중복 API 호출 제거

**leaveRequests 조건부 호출:**
```tsx
// Before: 둘 다 항상 실행
const myLeaves = trpc.leaveRequests.listMine.useQuery(...);
const allLeaves = trpc.leaveRequests.list.useQuery(...);

// After: 역할에 따라 하나만
const myLeaves = trpc.leaveRequests.listMine.useQuery(
  { restaurantId, limit: 50 },
  { enabled: restaurantId > 0 && !isManager }  // 직원만
);
const allLeaves = trpc.leaveRequests.list.useQuery(
  { restaurantId, status: "pending", limit: 100 },
  { enabled: restaurantId > 0 && isManager }    // 매니저만
);
```

**getShiftPresets 중복 제거:**
- 메인 컴포넌트에서 한 번만 호출
- ShiftPresetPanel에 `shiftPresets` props로 전달 (+ `refetch` 콜백)

**완료 조건:** 네트워크 탭에서 페이지 로드 시 API 호출 5→3개 확인

### 1-2. 렌더링 최적화

**getPresetTimes 메모이제이션:**
```tsx
const presetTimesMap = useMemo(() => {
  const map = new Map<string, ReturnType<typeof getPresetTimes>>();
  if (!shiftPresets) return map;
  weekDates.forEach(date => {
    const dateStr = fmtDate(date);
    ['full', 'open', 'close', ...customPresetTypes].forEach(preset => {
      map.set(`${preset}_${dateStr}`, getPresetTimes(preset, dateStr));
    });
  });
  return map;
}, [shiftPresets, weekDates, current?.openTime, current?.closeTime]);
```

**daySchedules 필터 메모이제이션:**
```tsx
const activeSchedulesByDate = useMemo(() => {
  const map = new Map<string, ScheduleItem[]>();
  scheduleByDate.forEach((items, dateStr) => {
    map.set(dateStr, items.filter(s => s.status !== "canceled"));
  });
  return map;
}, [scheduleByDate]);
```

**headcount 계산 메모이제이션:**
```tsx
const headcountByDate = useMemo(() => {
  const map = new Map<string, number>();
  activeSchedulesByDate.forEach((items, dateStr) => {
    map.set(dateStr, items.reduce((sum, s) =>
      sum + (s.shiftPreset === "open" || s.shiftPreset === "close" ? 0.5 : 1), 0));
  });
  return map;
}, [activeSchedulesByDate]);
```

**완료 조건:** React DevTools Profiler에서 주간 그리드 리렌더 시 불필요한 재계산 없음 확인

---

## Phase 2-1: 탭 분리

### 구조

```
SchedulePage.tsx (탭 라우터 역할, ~100줄)
├── [탭: 스케줄] → ScheduleGridTab.tsx (~900줄)
│   ├── 월간 미니맵 (상단)
│   ├── 주간 그리드
│   ├── 배정 모달
│   └── 수정 모달
├── [탭: 휴무신청] → LeaveRequestTab.tsx (~250줄)
│   ├── 신청 폼 (직원)
│   └── 승인/반려 목록 (매니저)
└── [탭: 근무설정] → ShiftPresetTab.tsx (~350줄)  ← 매니저만 표시
    └── 프리셋 편집기
```

### SchedulePage.tsx (탭 컨테이너)

```tsx
export default function SchedulePage() {
  const { user } = useAuth();
  const { selectedRestaurant: current } = useRestaurant();
  const isManager = isManagerLevel(getEffectiveRole(user?.role ?? "user", current?.storeRole ?? null));

  const [activeTab, setActiveTab] = useState<"schedule" | "leave" | "settings">("schedule");

  // 공통 데이터 (한 번만 fetch)
  const restaurantId = current?.id ?? 0;
  const { data: shiftPresets = [], refetch: refetchPresets } = trpc.restaurants.getShiftPresets.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 }
  );

  const tabs = [
    { key: "schedule", label: "스케줄" },
    { key: "leave", label: "휴무신청" },
    ...(isManager ? [{ key: "settings", label: "근무설정" }] : []),
  ];

  return (
    <div className="p-3 md:p-6 max-w-4xl mx-auto">
      {/* 탭 바 */}
      <div className="flex gap-1 border-b border-border mb-4">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "schedule" && (
        <ScheduleGridTab restaurantId={restaurantId} isManager={isManager}
          shiftPresets={shiftPresets} current={current} />
      )}
      {activeTab === "leave" && (
        <LeaveRequestTab restaurantId={restaurantId} isManager={isManager} />
      )}
      {activeTab === "settings" && isManager && (
        <ShiftPresetTab restaurantId={restaurantId} shiftPresets={shiftPresets}
          onPresetsChange={refetchPresets} />
      )}
    </div>
  );
}
```

### Props 인터페이스

```tsx
// ScheduleGridTab
interface ScheduleGridTabProps {
  restaurantId: number;
  isManager: boolean;
  shiftPresets: ShiftPreset[];
  current: Restaurant | null;
}

// LeaveRequestTab
interface LeaveRequestTabProps {
  restaurantId: number;
  isManager: boolean;
}

// ShiftPresetTab
interface ShiftPresetTabProps {
  restaurantId: number;
  shiftPresets: ShiftPreset[];
  onPresetsChange: () => void;
}
```

### 파일 이동 매핑

| 원본 줄 범위 | 대상 파일 | 내용 |
|-------------|----------|------|
| 1~88 | 공통 (각 파일에 필요한 것만) | 헬퍼, 상수, 타입 |
| 115~316 | `LeaveRequestTab.tsx` | 휴무신청 섹션 |
| 318~657 | `ShiftPresetTab.tsx` | 프리셋 관리 |
| 661~1121 | `ScheduleGridTab.tsx` | 주간 그리드 + 상태 |
| 1130~1488 | `ScheduleGridTab.tsx` | 배정 모달 |
| 1493~1699 | `ScheduleGridTab.tsx` | 수정 모달 |

**공통 타입/헬퍼 → `client/src/lib/scheduleHelpers.ts` 추출:**
- `ScheduleItem`, `StaffItem` 타입
- `getWeekDates()`, `fmtDate()`, `fmtTime()`
- `DAY_NAMES`, `STATUS_LABELS`, `DEFAULT_PRESET_LABELS`, `LEAVE_LABELS`

**완료 조건:**
- 기존 기능 100% 동작 (스케줄 CRUD, 복사, 확정, 휴무신청, 프리셋 관리)
- 탭 전환 시 불필요한 데이터 재요청 없음
- SchedulePage.tsx가 100줄 이하

---

## Phase 2-2: 월간 미니맵

### 서버 API 추가

**`schedules.monthlySummary`** (managerProcedure):

```
Input: { restaurantId: number, year: number, month: number }
Output: Array<{ date: string, headcount: number, hasUnconfirmed: boolean }>
```

쿼리:
```sql
SELECT
  DATE(startTime) as date,
  SUM(CASE
    WHEN shiftPreset IN ('open','close') THEN 0.5
    ELSE 1
  END) as headcount,
  MAX(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as hasUnconfirmed
FROM schedules
WHERE restaurantId = ?
  AND YEAR(startTime) = ? AND MONTH(startTime) = ?
  AND status != 'canceled'
GROUP BY DATE(startTime)
```

### 프론트 UI (ScheduleGridTab 상단)

```
┌─────────────────────────────────────┐
│  ◀  2026년 4월  ▶                    │
│  월  화  수  목  금  토  일           │
│       1   2   3   4   5   6         │
│      ■3  ●2  ●3  ○0  ■3  ●2        │
│   7   8   9  10  11  12  13         │
│  ●2  ■3  ●3  ●3  ○0  ■2  ●2        │
│  14  15  16  17  18  19  20         │
│  ●2  [3] ●3  ●3  ●2  ■3  ●2  ←현재주│
│  21  22  23  24  25  26  27         │
│  ●2  ●3  ●3  ●2  ○0  ●2  ●2        │
│  28  29  30                          │
│  ●2  ●3  ●2                          │
└─────────────────────────────────────┘
```

**범례:**
- ○ = 0명 (빈 날) — `text-red-500` 강조
- ● = 배정 있음, 모두 확정 — `text-green-600`
- ■ = 초안 포함 — `text-amber-500`
- [n] = 현재 주 해당일 하이라이트
- 숫자 = headcount

**인터랙션:**
- 날짜 클릭 → 해당 주로 `baseDate` 이동 (주간 그리드 갱신)
- 월 전환 → `monthlySummary` 재요청
- 접기/펼치기 토글 (모바일에서 기본 접힘, 매니저만 표시)

**데이터 캐싱:**
- `staleTime: 60_000` (1분) — 스케줄 CRUD 후 invalidate
- 현재 월 + 인접 월(전/후) 프리페치

**완료 조건:**
- 미니맵에서 날짜 클릭 시 주간 그리드가 해당 주로 이동
- 0명인 날이 빨간색으로 즉시 식별 가능
- 초안 있는 날이 노란색으로 구분

---

## Phase 2-3: 빠른 배정 모드

### 현재 흐름 (4스텝 × N회 반복)
```
날짜 클릭 → 모달 열림 → 직원 선택 → 프리셋 선택 → 저장 → 모달 닫힘
(다음 날짜에 같은 직원 배정하려면 처음부터 반복)
```

### 개선: 직원 먼저 선택 → 날짜 여러개 터치

**UI 변경:**
1. 헤더에 **"빠른 배정"** 토글 버튼 추가 (매니저 전용)
2. 토글 ON 시:
   - 직원 선택 드롭다운 + 프리셋 선택이 **상단 고정 바**로 표시
   - 주간 그리드의 각 날짜 셀에 **"+" 체크 영역** 활성화
   - 날짜 셀 터치/클릭 → 즉시 `quickAssign` 호출 (모달 없이)
   - 성공 시 해당 셀에 바로 카드 추가 (optimistic update)
   - 다음 날짜도 연속 터치 가능
3. 토글 OFF 시: 기존 모달 방식 유지

**빠른 배정 바 (sticky):**
```
┌──────────────────────────────────────────┐
│ 👤 [김직원 ▼]  ⏰ [풀타임 ▼]  [배정모드 OFF] │
└──────────────────────────────────────────┘
```

**빠른 배정 활성 시 그리드 셀:**
```
┌─────────────┐
│ 월 7일 (2명) │
│ ┌──────────┐│
│ │홍길동 풀 확││
│ │김직원 오 초││
│ └──────────┘│
│ [+ 배정하기] │  ← 터치 시 즉시 quickAssign
└─────────────┘
```

**상태 관리:**
```tsx
const [quickMode, setQuickMode] = useState(false);
const [quickUserId, setQuickUserId] = useState<number>(0);
const [quickPreset, setQuickPreset] = useState<string>("full");

const handleQuickDateClick = (dateStr: string) => {
  if (!quickMode || !quickUserId) return;
  quickAssign.mutate({
    restaurantId,
    userId: quickUserId,
    workDate: dateStr,
    preset: quickPreset,
  });
};
```

**Optimistic Update:**
```tsx
const quickAssign = trpc.schedules.quickAssign.useMutation({
  onMutate: async (vars) => {
    await utils.schedules.listByRestaurant.cancel();
    const prev = utils.schedules.listByRestaurant.getData({ restaurantId, from: weekStart, to: weekEnd });
    // optimistic 추가
    utils.schedules.listByRestaurant.setData(
      { restaurantId, from: weekStart, to: weekEnd },
      (old) => [...(old ?? []), {
        id: Date.now(), // temp id
        userId: vars.userId,
        userName: staffList.find(s => s.userId === vars.userId)?.name ?? "",
        startTime: `${vars.workDate}T09:00:00`,
        endTime: `${vars.workDate}T18:00:00`,
        status: "draft",
        shiftPreset: vars.preset,
        // ... 기타 필드
      }]
    );
    return { prev };
  },
  onError: (err, vars, ctx) => {
    if (ctx?.prev) {
      utils.schedules.listByRestaurant.setData(
        { restaurantId, from: weekStart, to: weekEnd }, ctx.prev
      );
    }
    toast.error(err.message);
  },
  onSettled: () => invalidate(),
  onSuccess: () => toast.success("배정됨"),
});
```

**기존 모달 방식과 공존:**
- 빠른배정 OFF → 기존 `openAssignModal()` 동작 유지
- 빠른배정 ON → 날짜 클릭 시 모달 대신 즉시 배정
- 임시근로자, 커스텀 시간 입력은 기존 모달에서만 (빠른배정은 정규 직원 + 프리셋만)

**완료 조건:**
- 빠른배정 모드에서 5명 × 7일 = 35건 배정이 모달 없이 연속 터치로 가능
- 중복 배정 시 서버에서 에러 → optimistic update 롤백 확인
- 기존 모달 방식도 그대로 동작

---

## Phase 3: 인접 주 프리페치 (Phase 2 완료 후)

```tsx
// 현재 주 로드 완료 시 전/후 주 백그라운드 프리페치
useEffect(() => {
  if (!isLoading && restaurantId > 0) {
    const prevWeekStart = fmtDate(new Date(weekDates[0].getTime() - 7 * 86400000));
    const prevWeekEnd = fmtDate(new Date(weekDates[0].getTime() - 86400000)) + "T23:59:59";
    const nextWeekStart = fmtDate(new Date(weekDates[6].getTime() + 86400000));
    const nextWeekEnd = fmtDate(new Date(weekDates[6].getTime() + 7 * 86400000)) + "T23:59:59";

    utils.schedules.listByRestaurant.prefetch({ restaurantId, from: prevWeekStart, to: prevWeekEnd });
    utils.schedules.listByRestaurant.prefetch({ restaurantId, from: nextWeekStart, to: nextWeekEnd });
  }
}, [weekStart, isLoading]);
```

---

## 실행 순서 (Claude Code용)

### Step 1: 공통 추출 + 성능 최적화
1. `client/src/lib/scheduleHelpers.ts` 생성 — 타입, 헬퍼, 상수 추출
2. `SchedulePage.tsx`에서 leaveRequests 조건부 호출 적용
3. `SchedulePage.tsx`에서 getShiftPresets 중복 제거
4. `useMemo` 최적화 적용 (presetTimes, activeSchedules, headcount)
5. 빌드 확인

### Step 2: 탭 분리
1. `LeaveRequestTab.tsx` 생성 — 기존 LeaveRequestSection 이동
2. `ShiftPresetTab.tsx` 생성 — 기존 ShiftPresetPanel 이동 (props 기반)
3. `ScheduleGridTab.tsx` 생성 — 주간 그리드 + 모달 이동
4. `SchedulePage.tsx`를 탭 컨테이너로 리팩토링
5. 전체 기능 동작 확인

### Step 3: 월간 미니맵
1. `schedules.ts`에 `monthlySummary` 프로시저 추가
2. `ScheduleGridTab.tsx`에 월간 미니맵 컴포넌트 추가
3. 날짜 클릭 → 주 이동 연결
4. monthlySummary invalidation 연결 (스케줄 CRUD 후)

### Step 4: 빠른 배정
1. `ScheduleGridTab.tsx`에 빠른배정 상태 + 상단 바 추가
2. 그리드 셀 클릭 핸들러 분기 (quickMode on/off)
3. optimistic update 구현
4. 기존 모달 방식 공존 확인

### Step 5: 프리페치 + 최종 검증
1. 인접 주 프리페치 적용
2. 전체 시나리오 테스트
   - 매니저: 스케줄 CRUD, 복사, 확정, 빠른배정, 미니맵, 탭 전환
   - 직원: 스케줄 조회, 휴무신청
   - 모바일/데스크탑 레이아웃
