# POS P2.1 — 마스터 활성화 토글 + 매장 설정 카드

> 작성: 2026-04-30 (Cowork)
> 대상: Claude Code 세션
> 선행: P1 백엔드 완료 (b60e584). `pos-plan.md` v0.6, `pos-p2-ui-plan.md` v0.1
> 단계: P2.1 — UI 첫 PR. SystemPage + StoreInfoPage에 POS 카드 추가.

---

## 0. 결정값 확정 (사용자 승인)

| Q | 결정 |
|---|---|
| Q-P2-1 라우트 | RestaurantContext 활용 (`/pos/menu` 등 — P2.1은 미적용, P2.2부터) |
| Q-P2-2 카운터 화면 전환 | 단일 컴포넌트 + 내부 상태 (P2.3) |
| Q-P2-3 KDS 인증 | JWT + 디바이스 토큰 둘 다 지원, 1차는 JWT만 (P2.4) |
| Q-P2-4 실시간 갱신 | 5초 polling (P2.4 KDS) |
| Q-P2-5 사이드바 노출 | `posEnabled=true` 매장만 (P2.2부터) |
| Q-P2-6 메뉴 이미지 | imageUrl 텍스트만 (P2.2) |
| Q-P2-7 PR 분할 | 점진 분할 6개 — 본 PR이 P2.1 |

**P2.1 범위**: 마스터 활성화 + 점장 설정 UI. 사이드바 라우트 추가 없음. 다음 PR(P2.2)에서 `/pos/menu` 진입 시 사이드바 그룹 추가.

---

## 1. 목적·범위

**1차 (이 PR)**
- `/system` 페이지에 **POS 활성화 토글 카드** 추가 (master 전용)
- `/store-info` 페이지에 **POS 설정 카드** 추가 (모두 가시, 편집은 manager+)

**Out of Scope (다음 PR)**
- POS 메뉴 관리 화면 (P2.2)
- 사이드바 POS 그룹 (P2.2)
- 카운터/KDS/이력/대조 (P2.3~P2.6)

**완료 조건**
- `pnpm run build` 통과
- master로 `/system` 접속 시 POS 카드 노출 → 매장별 토글 동작
- master 외(점장/직원)로 `/store-info` 접속 시 POS 카드 노출, 활성/비활성 표시
- manager+ 로 활성 매장의 `/store-info`에서 프리셋 변경 + 4축 오버라이드 가능
- 비활성 매장 직원에게는 "마스터에게 활성화 요청" 안내 표시

---

## 2. 신규 컴포넌트 2개

### 2.1 `client/src/components/pos/PosToggleCard.tsx` (신규)

마스터 시스템 페이지에서 사용. 모든 매장 목록 + 토글.

```tsx
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const STYLE_PRESETS = [
  { value: "DEPT_PICKUP",  label: "백화점 선불 셀프픽업" },
  { value: "SHOP_PICKUP",  label: "로드샵 선불 셀프픽업" },
  { value: "SHOP_TABLE",   label: "로드샵 후불 테이블" },
  { value: "COURT_PICKUP", label: "푸드코트 선불 테이블" },
  { value: "KIOSK_PICKUP", label: "키오스크 무인 선불" },
] as const;

type StylePreset = typeof STYLE_PRESETS[number]["value"];

export function PosToggleCard() {
  const { toast } = useToast();
  // restaurants.list — master는 전체 매장 응답
  const { data: restaurants, refetch, isLoading } =
    trpc.restaurants.list.useQuery({});

  const enableMutation = trpc.pos.settings.enable.useMutation({
    onSuccess: () => { refetch(); toast({ title: "POS 활성화 완료" }); },
    onError: (e) => toast({ title: "활성화 실패", description: e.message, variant: "destructive" }),
  });
  const disableMutation = trpc.pos.settings.disable.useMutation({
    onSuccess: () => { refetch(); toast({ title: "POS 비활성화 완료" }); },
    onError: (e) => toast({ title: "비활성화 실패", description: e.message, variant: "destructive" }),
  });

  const [enableTarget, setEnableTarget] = useState<{id: number, name: string} | null>(null);
  const [stylePreset, setStylePreset] = useState<StylePreset>("DEPT_PICKUP");

  if (isLoading) return <Card><CardContent className="py-6">로딩 중...</CardContent></Card>;
  if (!restaurants) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>POS 활성화 관리</CardTitle>
        <CardDescription>매장별로 POS 시스템을 켜고 끕니다. 마스터 전용.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {restaurants.map((r: any) => (
            <div key={r.id} className="flex items-center justify-between p-3 border rounded">
              <div className="flex-1">
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">id: {r.id}</div>
              </div>
              <div className="flex items-center gap-2">
                {r.posEnabled ? (
                  <>
                    <Badge variant="default">활성 {r.posStylePreset && `· ${r.posStylePreset}`}</Badge>
                    <Button
                      size="sm" variant="outline"
                      disabled={disableMutation.isPending}
                      onClick={() => disableMutation.mutate({ restaurantId: r.id })}
                    >
                      비활성화
                    </Button>
                  </>
                ) : (
                  <>
                    <Badge variant="secondary">비활성</Badge>
                    <Button
                      size="sm"
                      onClick={() => { setEnableTarget({id: r.id, name: r.name}); setStylePreset("DEPT_PICKUP"); }}
                    >
                      활성화
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>

      {/* 활성화 다이얼로그 */}
      <Dialog open={!!enableTarget} onOpenChange={(o) => !o && setEnableTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>POS 활성화 — {enableTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm">매장 스타일 프리셋</label>
            <Select value={stylePreset} onValueChange={(v) => setStylePreset(v as StylePreset)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STYLE_PRESETS.map(p => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label} ({p.value})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground">
              프리셋 선택 시 주문 모드·결제 처리기·주방 라우터·허용 오차가 자동 적용됩니다. 점장이 추후 변경 가능.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnableTarget(null)}>취소</Button>
            <Button
              disabled={enableMutation.isPending}
              onClick={() => {
                if (!enableTarget) return;
                enableMutation.mutate(
                  { restaurantId: enableTarget.id, stylePreset },
                  { onSuccess: () => setEnableTarget(null) }
                );
              }}
            >
              활성화 적용
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

### 2.2 `client/src/components/pos/PosSettingsCard.tsx` (신규)

매장 정보 페이지에서 사용. 현재 매장 1개의 POS 설정 보기·편집.

```tsx
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const STYLE_PRESETS = [
  { value: "DEPT_PICKUP",  label: "백화점 선불 셀프픽업" },
  { value: "SHOP_PICKUP",  label: "로드샵 선불 셀프픽업" },
  { value: "SHOP_TABLE",   label: "로드샵 후불 테이블" },
  { value: "COURT_PICKUP", label: "푸드코트 선불 테이블" },
  { value: "KIOSK_PICKUP", label: "키오스크 무인 선불" },
] as const;

interface Props {
  restaurantId: number;
  /** manager 이상이면 편집 가능. 기존 페이지의 권한 판정 결과 전달 */
  canEdit: boolean;
}

export function PosSettingsCard({ restaurantId, canEdit }: Props) {
  const { toast } = useToast();
  const { data, refetch, isLoading } = trpc.pos.settings.getStatus.useQuery({ restaurantId });

  const applyPresetMutation = trpc.pos.settings.applyPreset.useMutation({
    onSuccess: () => { refetch(); toast({ title: "프리셋 적용 완료" }); },
    onError: (e) => toast({ title: "프리셋 적용 실패", description: e.message, variant: "destructive" }),
  });
  const overrideMutation = trpc.pos.settings.override.useMutation({
    onSuccess: () => { refetch(); toast({ title: "설정 갱신 완료" }); },
    onError: (e) => toast({ title: "설정 갱신 실패", description: e.message, variant: "destructive" }),
  });

  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string>("DEPT_PICKUP");
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [tolerance, setTolerance] = useState<string>("");

  if (isLoading) return <Card><CardContent className="py-6">로딩 중...</CardContent></Card>;

  const enabled = data?.posEnabled === true;

  return (
    <Card>
      <CardHeader>
        <CardTitle>POS 설정</CardTitle>
        <CardDescription>이 매장의 POS 활성화 상태와 프리셋·세부 설정.</CardDescription>
      </CardHeader>
      <CardContent>
        {!enabled ? (
          <div className="space-y-2">
            <Badge variant="secondary">비활성</Badge>
            <p className="text-sm text-muted-foreground">
              POS가 이 매장에 활성화되지 않았습니다. <strong>마스터 관리자</strong>에게 활성화를 요청하세요.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="default">활성</Badge>
              {data?.posStylePreset && <Badge variant="outline">{data.posStylePreset}</Badge>}
            </div>
            <dl className="text-sm grid grid-cols-2 gap-y-1">
              <dt className="text-muted-foreground">주문 모드</dt><dd>{data?.posDefaultOrderMode ?? "-"}</dd>
              <dt className="text-muted-foreground">결제 처리</dt><dd>{data?.posPaymentProvider ?? "-"}</dd>
              <dt className="text-muted-foreground">주방 라우터</dt><dd>{data?.posKitchenRouter ?? "-"}</dd>
              <dt className="text-muted-foreground">대조 허용 오차</dt><dd>{data?.posReconcileTolerance ?? 0}원</dd>
            </dl>
            {canEdit && (
              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={() => {
                  setSelectedPreset(data?.posStylePreset ?? "DEPT_PICKUP");
                  setPresetDialogOpen(true);
                }}>
                  프리셋 변경
                </Button>
                <Button size="sm" variant="outline" onClick={() => {
                  setTolerance(String(data?.posReconcileTolerance ?? 0));
                  setOverrideDialogOpen(true);
                }}>
                  세부 설정
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* 프리셋 변경 다이얼로그 */}
      <Dialog open={presetDialogOpen} onOpenChange={setPresetDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>매장 스타일 프리셋 변경</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Select value={selectedPreset} onValueChange={setSelectedPreset}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STYLE_PRESETS.map(p => (
                  <SelectItem key={p.value} value={p.value}>{p.label} ({p.value})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              프리셋을 변경하면 주문 모드·결제·주방·허용오차가 모두 새 값으로 덮어씁니다. 기존 미세조정은 사라집니다.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPresetDialogOpen(false)}>취소</Button>
            <Button
              disabled={applyPresetMutation.isPending}
              onClick={() => {
                applyPresetMutation.mutate(
                  { restaurantId, stylePreset: selectedPreset as any },
                  { onSuccess: () => setPresetDialogOpen(false) }
                );
              }}
            >
              적용
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 세부 설정(오버라이드) 다이얼로그 */}
      <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>POS 세부 설정</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <label className="text-sm">대조 허용 오차 (원)</label>
            <Input
              type="number" min={0} value={tolerance}
              onChange={(e) => setTolerance(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              일일 대조에서 차이가 이 금액 이내면 정상으로 표시. 초과 시 경고만 (확정은 가능).
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideDialogOpen(false)}>취소</Button>
            <Button
              disabled={overrideMutation.isPending}
              onClick={() => {
                const t = parseInt(tolerance, 10);
                if (Number.isNaN(t) || t < 0) {
                  toast({ title: "잘못된 값", variant: "destructive" });
                  return;
                }
                overrideMutation.mutate(
                  { restaurantId, posReconcileTolerance: t },
                  { onSuccess: () => setOverrideDialogOpen(false) }
                );
              }}
            >
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

---

## 3. 페이지 통합

### 3.1 `client/src/pages/SystemPage.tsx` 수정

기존 파일에 `<PosToggleCard />` 추가.

```tsx
import { PosToggleCard } from "@/components/pos/PosToggleCard";

// 기존 SystemPage 컴포넌트 내부 적당한 위치에:
<PosToggleCard />
```

**주의**:
- 기존 SystemPage는 master 권한 페이지 (App.tsx 라우트). `PosToggleCard`는 내부에서 master 가정.
- 기존 카드들과 시각적 일관성 유지 (간격·grid 패턴).

### 3.2 `client/src/pages/StoreInfoPage.tsx` 수정

기존 파일에 `<PosSettingsCard />` 추가. 매장 컨텍스트와 권한 판정.

```tsx
import { PosSettingsCard } from "@/components/pos/PosSettingsCard";
import { useRestaurant } from "@/hooks/useRestaurant";
import { useAuth } from "@/hooks/useAuth";

// 컴포넌트 내부:
const { currentRestaurant } = useRestaurant();
const { user } = useAuth();

// 권한 판정 — 기존 패턴 따름
// effectiveRole이 'manager' 이상이면 편집 가능
const canEdit = ["master", "admin", "manager"].includes(user?.effectiveRole ?? "");

// 적당한 위치 (기존 카드들 사이 또는 끝):
{currentRestaurant && (
  <PosSettingsCard
    restaurantId={currentRestaurant.id}
    canEdit={canEdit}
  />
)}
```

**주의**:
- `currentRestaurant` 또는 `currentRestaurantId` — 기존 hook이 어떻게 노출하는지 Code가 확인 후 일치
- `useAuth().user.effectiveRole` 또는 `user.role + restaurantUsers.role` 조합 — 기존 매장 페이지에서 매니저 판정을 어떻게 하는지 확인 후 동일 패턴

---

## 4. 검증 절차

### 4.1 빌드
- `pnpm run build` 통과

### 4.2 prod 시연 (수동)

배포 후 master로 로그인:

1. `/system` 접속 → "POS 활성화 관리" 카드 노출 확인
2. 천호점 row → "활성" 배지 + "DEPT_PICKUP" + "비활성화" 버튼
3. 광명AK 등 비활성 매장 → "비활성화" 배지 + "활성화" 버튼
4. 비활성 매장 "활성화" 클릭 → 다이얼로그 → 프리셋 선택 → 적용 → 응답 토스트 확인 → 카드 갱신
5. 활성 매장 "비활성화" → 미완료 주문 0건이면 통과, 있으면 에러 토스트

owner(점장) 계정으로 다시 로그인 (천호점):

6. `/store-info` 접속 → "POS 설정" 카드 노출 확인
7. 활성 + DEPT_PICKUP 배지 + 4축 dl 표시
8. "프리셋 변경" → SHOP_PICKUP 적용 → 4축 자동 변경 확인 → 다시 DEPT_PICKUP 복원
9. "세부 설정" → tolerance 7000 → 저장 → 갱신 확인 → 5000으로 원복

직원(staff) 계정으로:

10. `/store-info` → 카드 노출되되 "프리셋 변경"·"세부 설정" 버튼 숨김 (canEdit=false)

비활성 매장 점장 (광명AK 등):

11. `/store-info` → "비활성" + "마스터 관리자에게 활성화 요청" 안내 표시

### 4.3 Cowork 자율 시연 가능 부분
- API 호출만 하는 시나리오 (UI 클릭 없이 동작 검증)는 P1 시연으로 대체 (이미 통과)
- UI 자체 시연은 사용자 또는 Cowork이 Claude in Chrome으로 페이지 이동·스크린샷 확인 가능

---

## 5. 5항 보고 템플릿

```
1. 변경 파일:
   - client/src/components/pos/PosToggleCard.tsx (신규, ~120 lines)
   - client/src/components/pos/PosSettingsCard.tsx (신규, ~150 lines)
   - client/src/pages/SystemPage.tsx (PosToggleCard import + 카드 배치)
   - client/src/pages/StoreInfoPage.tsx (PosSettingsCard import + 카드 배치)
2. 의도: P2.1 — 마스터 활성화 토글 + 매장 설정 UI. 백엔드 P1과 1:1 매핑.
3. 영향 범위:
   - UI: SystemPage(master), StoreInfoPage(전체) 2개 페이지에 카드 추가
   - tRPC 호출: pos.settings.* 5개 endpoint 모두 사용
   - 권한: master는 enable/disable, manager+는 applyPreset/override, staff는 read-only
   - 새 라우트 없음, 사이드바 변경 없음
   - DB: 변경 없음
4. 리스크:
   - 기존 페이지 컴포넌트 구조와의 시각적 일관성 — Code가 통합 시 기존 카드 패턴 따름
   - useAuth/useRestaurant 훅의 정확한 시그니처 — Code가 기존 패턴 확인 후 일치
   - vite 빌드 사이즈 증가 — 카드 2개 + Dialog 사용. 영향 미미 추정
   - 롤백: 카드 import 제거로 즉시 무력화
5. 빌드: pnpm run build ✅
```

---

## 6. 후속 PR 가이드

본 PR 통과 → **P2.2 메뉴 관리** (`/pos/menu` 신규 라우트, 사이드바 POS 그룹 시작)

P2.2부터는 다음 작업 동반:
- `App.tsx`에 `/pos/menu` 라우트 추가
- `AppLayout.tsx` 사이드바에 "POS" 그룹 (matched매장 `posEnabled=true`만 표시)
- 신규 페이지 `client/src/pages/PosMenuPage.tsx`

---

## 7. 메모

- **shadcn/ui 컴포넌트**: Card, Button, Badge, Select, Dialog, Input, Toast — 모두 기존 27개에 포함됨
- **권한 판정**: StoreInfoPage 기존 패턴 따름. master/admin/manager 동시 편집 가능 처리
- **`restaurants.list` 응답 필드**: P1 시연 시 `posEnabled`, `posStylePreset` 포함 확인됨. 그대로 사용
- **에러 처리**: tRPC mutation에서 onError 토스트. 비활성화 시 "미완료 주문 N건" 메시지 그대로 사용자에게 노출
- **로딩 상태**: `isPending` 활용. 버튼 disabled로 중복 클릭 방지
