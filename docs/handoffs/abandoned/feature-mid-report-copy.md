[abandoned: 2026-05-01 — 사양 표류, 2b로 단순화 진행]

# 일간보고 탭 — 중간정산 보고 복사 버튼

> 작성: 2026-04-19 (Cowork 설계) — 확정
> 대상: Claude Code 세션 (로컬 repo에서 적용 → 빌드 → push)

## 요약

일간보고 탭(MiddayTab) 내 저장된 중간매출 행마다 Copy 버튼을 추가한다.
클릭 시 해당 행의 `recordedAt`을 체크시간으로 하고, 그 시점까지의 누적 매출·객수·운영일지 특이사항·그 시점 근무자를 카톡 붙여넣기용 텍스트로 클립보드에 복사한다.

## 확정 사항

- 범위: MiddayTab 저장된 중간매출 **행별** 복사 (하루 여러 번 체크 → 각각 독립 스냅샷)
- 체크시간 = `intermediateSales.recordedAt` (매출입력시간이 곧 보고기준시간)
- 체크매출/객수 = 해당 스냅샷 시점까지의 **누적 합산** (그 행 이전 행들 포함)
- 운영일지 특이사항 = 해당 시점까지 `note` 있는 행들의 `시간 + 메모`
- 현재 근무자 = 해당 시점 기준 `startTime ≤ recordedAt ≤ endTime`인 스케줄
- 야간 운영 매장 없음 → 오늘 날짜 스케줄만 조회하면 충분
- 별도 "중간정산 보고" Card는 불필요. 행 내부 버튼만.

## 출력 포맷

```
[청계산뚝배기수제비천호점] 2026년 4월 19일 일요일
* 체크시간: 14:30
* 체크매출: 1,180,000원
* 객수: 38건

* 운영일지 특이사항
 -13:10 15:30 단체 8명 예약
 -14:05 에어컨 실외기 이상음 점검요청

* 현재 근무자
  김지웅 점장
  김정란 사원
  남영선 6시간
===========
```

## 변경 범위

| 파일 | 내용 |
|------|------|
| `client/src/pages/DailyOpsPage.tsx` | getRoleLabel 모듈 스코프 승격, CloseTab 내부 중복 제거, MiddayTab에 쿼리·generateMidReportText·행별 Copy 버튼 추가 |

서버/DB 변경 없음. `restaurants.get`, `schedules.getDaySchedules`, `dailyOps.getMidSales` 모두 기존 프로시저 재사용.

---

## 적용 지시 (Code 세션)

### 사전 확인

```bash
cd ~/Documents/Claude/Projects/restaurant-manager
git rev-parse --show-toplevel    # → 같은 경로여야 함
git status -sb
git fetch && git log --oneline @{u}..

# Cowork가 이미 수정을 반영했는지 확인
grep -n "generateMidReportText" client/src/pages/DailyOpsPage.tsx
```

**이미 반영됨** (`generateMidReportText` 2개 이상 hit — 정의 1 + 호출 1 이상): **아래 4단계 스킵 → 바로 빌드/커밋으로.**
**미반영** (0 hit): 아래 4단계를 순서대로 Edit.

### 1단계. `getRoleLabel` 모듈 스코프 승격

**위치**: `calcHeadcountWeight` 함수 직후, `ClosingScheduleSummary` 컴포넌트 직전 (약 3510행 근처).

```diff
   const ratio = (workMinutes / storeMinutes) * 100;
   const threshold = halfShiftThreshold ?? 60;
   return ratio < threshold ? 0.5 : 1;
 }

+/** 스케줄 행의 매장 역할을 한국어 라벨로 변환 */
+function getRoleLabel(s: any): string {
+  const storeRole = s?.storeRole;
+  if (storeRole === 'owner' || storeRole === 'store_manager') return '점장';
+  if (storeRole === 'supervisor' || storeRole === 'manager') return '매니져';
+  return '사원';
+}
+
 function ClosingScheduleSummary({ restaurantId, date }: { restaurantId: number; date: string }) {
```

### 2단계. CloseTab 내부 중복 정의 제거

**위치**: CloseTab 내부 `generateReportText` 직전의 arrow function 형태 `getRoleLabel` (약 3054행 근처).

```diff
-  const getRoleLabel = (s: any): string => {
-    const storeRole = s.storeRole;
-    if (storeRole === 'owner' || storeRole === 'store_manager') return '점장';
-    if (storeRole === 'supervisor' || storeRole === 'manager') return '매니져';
-    return '사원';
-  };
-
   const generateReportText = (): string => {
```

### 3단계. MiddayTab에 쿼리 추가

**위치**: `midSalesQuery` 바로 다음, `saveMidSalesMutation` 직전.

```diff
   const midSalesQuery = trpc.dailyOps.getMidSales.useQuery({
     restaurantId,
     date,
   });

+  // ── 중간정산 보고용 데이터 ──
+  const restaurantQuery = trpc.restaurants.get.useQuery(
+    { id: restaurantId },
+    { enabled: restaurantId > 0 },
+  );
+  const daySchedulesQuery = trpc.schedules.getDaySchedules.useQuery(
+    { restaurantId, date },
+    { enabled: restaurantId > 0 },
+  );
+
   const saveMidSalesMutation = trpc.dailyOps.saveMidSales.useMutation({
```

### 4단계. `generateMidReportText` 추가 + 행별 Copy 버튼

**4-1. `const midSales = midSalesQuery.data || [];` 직후에 함수 삽입.**

```tsx
  // 중간정산 보고 텍스트 생성 — snapshot(저장된 중간매출 1건)의 recordedAt을 체크시간으로 사용
  const generateMidReportText = (snapshot: any): string => {
    const rest = restaurantQuery.data;
    const restName = rest?.name ?? '매장';

    const dt = new Date(date + 'T12:00:00');
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dateStr = `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 ${dayNames[dt.getDay()]}요일`;

    const recordedAt = new Date(snapshot.recordedAt);
    const hh = String(recordedAt.getHours()).padStart(2, '0');
    const mm = String(recordedAt.getMinutes()).padStart(2, '0');
    const checkTime = `${hh}:${mm}`;
    const checkpointMs = recordedAt.getTime();

    const upto = midSales.filter((m: any) => new Date(m.recordedAt).getTime() <= checkpointMs);
    const checkAmount = upto.reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
    const checkReceipts = upto.reduce((s: number, m: any) => s + Number(m.receiptCount || 0), 0);

    const noteLines = upto
      .filter((m: any) => m.note && String(m.note).trim())
      .map((m: any) => {
        const t = m.recordedAt ? fmtTs(m.recordedAt) : '';
        return ` -${t ? t + ' ' : ''}${m.note}`;
      });

    const schedules = (daySchedulesQuery.data ?? []).filter((s: any) => s.status !== 'canceled');
    const currentWorkers = schedules.filter((s: any) => {
      const st = new Date(s.startTime).getTime();
      const et = new Date(s.endTime).getTime();
      return st <= checkpointMs && checkpointMs <= et;
    });

    const lines: string[] = [];
    lines.push(`[${restName}] ${dateStr}`);
    lines.push(`* 체크시간: ${checkTime}`);
    lines.push(`* 체크매출: ${fmtNum(checkAmount)}원`);
    lines.push(`* 객수: ${checkReceipts}건`);
    lines.push('');
    lines.push(`* 운영일지 특이사항`);
    if (noteLines.length > 0) {
      lines.push(...noteLines);
    } else {
      lines.push(' -없음');
    }
    lines.push('');
    lines.push(`* 현재 근무자`);
    if (currentWorkers.length > 0) {
      for (const s of currentWorkers) {
        const name = s.userName ?? s.tempWorkerName ?? '미배정';
        const w = calcHeadcountWeight(
          s.startTime,
          s.endTime,
          rest?.openTime,
          rest?.closeTime,
          rest?.halfShiftThreshold,
        );
        if (w === 0.5) {
          const hours = ((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3600000)
            .toFixed(1)
            .replace(/\.0$/, '');
          lines.push(`  ${name} ${hours}시간`);
        } else {
          lines.push(`  ${name} ${getRoleLabel(s)}`);
        }
      }
    } else {
      lines.push(`  없음`);
    }
    lines.push('===========');
    return lines.join('\n');
  };
```

**4-2. 저장된 중간매출 리스트 행의 Trash 버튼을 Copy+Trash로 교체.**

기존:
```tsx
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMidSalesMutation.mutate({ id: sale.id, restaurantId })}
                    disabled={deleteMidSalesMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
```

교체:
```tsx
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      title="이 시점의 중간정산 보고 복사"
                      onClick={() => {
                        const text = generateMidReportText(sale);
                        navigator.clipboard.writeText(text).then(() => {
                          toast.success('중간정산 보고가 클립보드에 복사되었습니다');
                        }).catch(() => {
                          toast.error('복사 실패');
                        });
                      }}
                    >
                      <Copy className="w-4 h-4 text-blue-600" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMidSalesMutation.mutate({ id: sale.id, restaurantId })}
                      disabled={deleteMidSalesMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
```

※ `Copy` 아이콘은 파일 상단 `lucide-react` import에 이미 포함(마감탭 보고 복사용) — 추가 import 불필요.

---

## 검증

```bash
pnpm run build
```

오류 없으면 OK.

## 커밋

```bash
cat > /tmp/commitmsg <<'EOF'
일간보고 탭에 중간정산 보고 복사 기능 추가

저장된 중간매출 행마다 Copy 버튼을 추가. 클릭 시 해당 행의
recordedAt을 체크시간으로 하여 매장명·그 시점까지 누적 매출·객수·
운영일지 특이사항·그 시점 근무자를 카톡 붙여넣기용 텍스트로
클립보드에 복사한다.

getRoleLabel을 모듈 스코프로 끌어올려 CloseTab/MiddayTab 공용으로
사용하도록 정리.
EOF

git add client/src/pages/DailyOpsPage.tsx
git commit --file=/tmp/commitmsg
```

## Push 전 의무 요약 (§4 5항)

1. **변경 파일**: `client/src/pages/DailyOpsPage.tsx` 단일 (`git diff --stat`으로 확인)
2. **변경 의도**: 일간보고 탭에서 피크 체크 후 현장 상황을 카톡으로 바로 전달하기 위한 스냅샷 보고 복사 기능
3. **영향 범위**: UI만. tRPC/DB 변경 없음 (기존 프로시저 재사용)
4. **리스크**: 낮음. 기존 중간매출 저장/삭제 동작은 변경 없음. 야간 운영 매장은 없는 것으로 확인됨
5. **빌드 결과**: `pnpm run build` 통과 (위 단계에서 확인)

사용자 승인 후:

```bash
git push origin main
```

Railway 자동 배포 확인.

## 완료 조건

- [ ] 저장된 중간매출 행 우측에 파란색 Copy 버튼 표시
- [ ] 클릭 시 해당 행 `recordedAt`을 체크시간으로 한 보고 텍스트가 클립보드에 복사됨
- [ ] 체크매출/객수는 그 시점까지의 누적 합산
- [ ] 특이사항은 그 시점까지 `note` 있는 행들만 `시간 + 메모` 형태로 나열
- [ ] 현재 근무자는 그 시점 근무 중인 사람만 (반차는 `N시간`, 그 외 역할 라벨)
- [ ] toast로 복사 완료 알림
- [ ] 빌드 통과 + main push + Railway 재배포 확인
