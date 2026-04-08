# 수정 지시: 근무 스케줄 총원 — 반차 0.5명 카운트

> 작성: 2026-04-05 (Cowork)

## 문제

일간보고 탭의 `ClosingScheduleSummary` 컴포넌트에서 근무 스케줄 총원을 `daySchedules.length`로 단순 카운트함.
반차(halfShift) 근무자도 1명으로 카운트되어 실제 투입 인력 대비 과대 표시.

**현재:** 풀타임 2 + 오픈(반차) 2 = **4명** (잘못됨)
**기대:** 풀타임 2 + 반차 2×0.5 = **3명**

## 반차 판별 기준

이미 `restaurants.halfShiftThreshold` (기본값 60, 단위: %)가 존재함.

```
근무비율 = (endTime - startTime) / (closeTime - openTime) × 100
근무비율 < halfShiftThreshold → 반차 (0.5명)
근무비율 >= halfShiftThreshold → 1명
```

## 변경 대상

### 1. `client/src/pages/DailyOpsPage.tsx` — `ClosingScheduleSummary` 컴포넌트 (3064행~)

**변경 내용:**

1. 매장 `openTime`, `closeTime`, `halfShiftThreshold` 값 확보
   - 이미 DailyOpsPage 내에서 매장 정보를 쿼리하고 있으면 props로 전달
   - 없으면 `trpc.restaurants.getById` 또는 기존 쿼리에서 가져옴

2. 각 스케줄의 가중치(headcountWeight) 계산 함수 추가:
   ```typescript
   function calcHeadcountWeight(
     startTime: Date | string,
     endTime: Date | string,
     openTime: string,    // "09:30" 등
     closeTime: string,   // "20:00" 등
     halfShiftThreshold: number  // 60
   ): number {
     const workMinutes = (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000;
     const [oh, om] = openTime.split(':').map(Number);
     const [ch, cm] = closeTime.split(':').map(Number);
     const totalMinutes = (ch * 60 + cm) - (oh * 60 + om);
     if (totalMinutes <= 0) return 1; // 안전장치
     const ratio = (workMinutes / totalMinutes) * 100;
     return ratio < halfShiftThreshold ? 0.5 : 1;
   }
   ```

3. 총원 계산 변경:
   ```typescript
   // AS-IS
   const total = daySchedules.length;

   // TO-BE
   const headcount = daySchedules.reduce((sum, s) =>
     sum + calcHeadcountWeight(s.startTime, s.endTime, openTime, closeTime, halfShiftThreshold), 0);
   ```

4. 표시 변경:
   ```typescript
   // AS-IS
   <span>({total}명)</span>

   // TO-BE (정수면 "3명", 소수면 "3.5명")
   <span>({Number.isInteger(headcount) ? headcount : headcount.toFixed(1)}명)</span>
   ```

5. 개별 스케줄 항목에 반차 라벨 추가:
   - `SHIFT_LABELS`에 추가 불필요 (자동 판별이므로)
   - 시간 표시 옆에 반차 여부 표시:
   ```typescript
   const isHalf = calcHeadcountWeight(s.startTime, s.endTime, openTime, closeTime, halfShiftThreshold) === 0.5;
   // ...
   {s.shiftPreset && <span>({SHIFT_LABELS[s.shiftPreset] ?? s.shiftPreset})</span>}
   {isHalf && <span className="text-orange-500 text-xs ml-1">(반차)</span>}
   ```

6. "전체 완료 처리" 버튼의 건수도 동일 기준 적용 여부 확인:
   - 현재: `전체 완료 처리 (4건)` — 이건 실제 처리 건수이므로 **레코드 수 그대로 유지** (변경 불필요)

### 2. 같은 로직이 필요한 다른 위치 (확인 후 적용)

- `OpsCalendarPage.tsx` 93행: `스케줄 ({data.schedules.length}명)` → 동일 반차 가중치 적용
- `ManagerDashboard.tsx` 162행: 출근 인원 표시 — 이건 `openHeadcount` (수동입력)이므로 변경 불필요

## 영향 범위

- 프론트엔드만 변경 (서버 API 변경 없음)
- `restaurants` 테이블의 기존 `halfShiftThreshold` 활용

## 완료 조건

- [ ] 반차 근무자가 0.5명으로 카운트되어 총원에 반영됨
- [ ] 반차 근무자 옆에 `(반차)` 라벨 표시됨
- [ ] 풀타임/일반 근무는 기존과 동일하게 1명으로 카운트
- [ ] OpsCalendarPage의 스케줄 인원도 동일 기준 적용
- [ ] 빌드 성공 확인
