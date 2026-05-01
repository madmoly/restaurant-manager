# POS P2.2 — 메뉴 관리 화면 + 사이드바 POS 그룹 시작

> 작성: 2026-04-30 (Cowork)
> 대상: Claude Code 세션
> 선행: P2.1 hotfix push (`0013751`). `pos-plan.md` v0.6, `pos-p2-ui-plan.md` v0.1
> 단계: P2.2 — `/pos/menu` 신규 라우트 + 사이드바 "POS" 그룹 첫 진입

---

## 0. 원칙 (메모리 자동 적용)

- **사용자 노출 텍스트는 모두 한글** (`feedback_korean_user_facing.md`). `posLabels.ts` 헬퍼 활용
- **Cowork 직접 수정 금지** — 본 패치 문서 + Code 핸드오프
- 천호점 `restaurantId = 2` (활성 매장)

---

## 1. 목적·범위

활성 매장(`DEPT_PICKUP` 천호점)에서 점장이 메뉴를 등록·수정·삭제할 수 있는 화면.

**범위**
- 신규 라우트 `/pos/menu` (App.tsx)
- 사이드바 "POS" 그룹 신설 — `posEnabled=true` 매장만 노출 (1차 항목: "메뉴 관리")
- 페이지 컴포넌트 + 하위 다이얼로그 컴포넌트

**Out of Scope**
- 메뉴 이미지 업로드 (URL 입력만)
- 옵션 미리보기 컴포넌트 (P2.3 카운터에서)
- 메뉴 import/export
- 카테고리 드래그 정렬 (1차는 displayOrder 숫자 입력)

**완료 조건**
- `pnpm run build` 통과
- 활성 매장 점장으로 `/pos/menu` 접속 시 카테고리·메뉴 CRUD 동작
- 비활성 매장 또는 직원에게는 적절한 안내
- 사이드바 "POS" 그룹은 활성 매장 선택 시에만 노출
- 모든 노출 텍스트 한글

---

## 2. 라우트·사이드바 통합

### 2.1 `client/src/App.tsx` 수정

기존 라우트 구역에 추가:

```tsx
import { PosMenuPage } from "@/pages/PosMenuPage";

// 라우트 정의 영역:
<Route path="/pos/menu" component={PosMenuPage} />
```

권한 체크는 페이지 내부에서. 외부 라우트 가드는 master 전용 페이지처럼 강제하지 않음 (직원도 조회 가능).

### 2.2 `client/src/components/AppLayout.tsx` 사이드바 수정

기존 사이드바 그룹 구조 따라 "POS" 그룹 추가. 노출 조건: `currentRestaurant?.posEnabled === true`.

**문제**: `useRestaurant`가 `posEnabled` 노출하는지 확인. P2.1 PosToggleCard가 `restaurants.list`에서 가져왔으니 RestaurantContext도 노출 가능성 높음. Code가 hook 시그니처 점검 후:

- (a) `useRestaurant().selectedRestaurant?.posEnabled` 가능 → 그대로 사용
- (b) 노출 안 됨 → 별도로 `pos.settings.getStatus.useQuery({ restaurantId })` 호출해서 판정

권장: (a) 노출 안 되면 RestaurantContext 보강하지 말고 (b) 별도 query (사이드바에 inline). 캐시 효과로 한 번만 호출.

```tsx
// AppLayout.tsx 사이드바 영역
const { selectedRestaurantId, selectedRestaurant } = useRestaurant();

// 옵션 (a): selectedRestaurant.posEnabled 직접
const posEnabled = (selectedRestaurant as any)?.posEnabled === true;

// 옵션 (b): 별도 query — selectedRestaurantId 변경 시 자동 갱신
// const { data: posStatus } = trpc.pos.settings.getStatus.useQuery(
//   { restaurantId: selectedRestaurantId ?? 0 },
//   { enabled: !!selectedRestaurantId }
// );
// const posEnabled = posStatus?.posEnabled === true;

{posEnabled && (
  <SidebarGroup label="POS">
    <SidebarItem href="/pos/menu" label="메뉴 관리" />
  </SidebarGroup>
)}
```

기존 사이드바 컴포넌트가 `<SidebarGroup>` / `<SidebarItem>` 형태인지, 아니면 다른 패턴인지 Code가 확인 후 일치시킴.

---

## 3. 페이지 컴포넌트

### 3.1 `client/src/pages/PosMenuPage.tsx` 신규

**레이아웃**: 데스크톱 좌우 분할(좌 1/3 카테고리, 우 2/3 메뉴), 모바일 위아래.

**상태**:
- `selectedCategoryId: number | null` — 우측 패널이 어떤 카테고리의 메뉴를 보여줄지
- 다이얼로그 열림 상태들

**권한·게이트 분기**:
- 매장 미선택 → "매장을 먼저 선택하세요" 안내
- 비활성 매장 → "POS가 이 매장에 활성화되지 않았습니다. 마스터 관리자에게 요청하세요." 안내 (PosSettingsCard와 동일 패턴)
- 활성 매장 + staff → 카드만 보임, 추가/편집 버튼 숨김
- 활성 매장 + manager+ → 모든 기능

**호출**:
- `pos.menu.listCategories({ restaurantId, includeInactive: true })` (manager+) 또는 `false` (staff — 여기는 1차에서 manager+만 진입한다고 가정해도 무방, includeInactive 자유)
- `pos.menu.upsertCategory`, `deleteCategory`
- `pos.menu.listItems({ restaurantId, categoryId, includeInactive: true })`
- `pos.menu.upsertItem`, `deleteItem`, `setSoldOut`
- `pos.menu.listOptionGroups`, `upsertOptionGroup`, `deleteOptionGroup`, `upsertOption`, `deleteOption`

**핵심 코드 골격**:

```tsx
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useRestaurant } from "@/hooks/useRestaurant";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/compat";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CategoryFormDialog } from "@/components/pos/CategoryFormDialog";
import { MenuItemFormDialog } from "@/components/pos/MenuItemFormDialog";
import { MenuOptionsDialog } from "@/components/pos/MenuOptionsDialog";
import { ConfirmDialog } from "@/components/pos/ConfirmDialog";

export function PosMenuPage() {
  const { user } = useAuth();
  const { selectedRestaurantId, selectedRestaurant } = useRestaurant();
  const RID = selectedRestaurantId ?? 0;

  // 권한 판정 (StoreInfoPage 패턴 따름)
  const isManager =
    user?.role === "master" || user?.role === "admin" ||
    ["owner", "supervisor", "store_manager", "manager"].includes(
      (selectedRestaurant as any)?.storeRole ?? ""
    );

  // 활성화 상태 조회 — 게이트 우회 위해 try-catch 패턴
  const { data: posStatus, isError: posStatusError } =
    trpc.pos.settings.getStatus.useQuery(
      { restaurantId: RID },
      { enabled: RID > 0, retry: false }
    );

  const posEnabled = posStatus?.posEnabled === true;

  // 매장 미선택
  if (!RID) return (
    <Card className="p-8 text-center text-muted-foreground">
      매장을 먼저 선택하세요.
    </Card>
  );
  // 비활성 매장
  if (!posEnabled) return (
    <Card className="p-8 text-center">
      <Badge variant="secondary">비활성</Badge>
      <p className="mt-3 text-muted-foreground">
        POS가 이 매장에 활성화되지 않았습니다. <strong>마스터 관리자</strong>에게 요청하세요.
      </p>
    </Card>
  );

  // ─── 본 화면 ──────────────────────────────────────────────
  const [selectedCatId, setSelectedCatId] = useState<number | null>(null);
  const [categoryDialog, setCategoryDialog] = useState<{ open: boolean; editing?: any }>({ open: false });
  const [itemDialog, setItemDialog] = useState<{ open: boolean; editing?: any }>({ open: false });
  const [optionsDialog, setOptionsDialog] = useState<{ open: boolean; itemId?: number; itemName?: string }>({ open: false });
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; type?: 'category' | 'item'; id?: number; name?: string }>({ open: false });

  const { data: categories, refetch: refetchCats } =
    trpc.pos.menu.listCategories.useQuery({ restaurantId: RID, includeInactive: true });
  const { data: items, refetch: refetchItems } =
    trpc.pos.menu.listItems.useQuery(
      { restaurantId: RID, categoryId: selectedCatId ?? undefined, includeInactive: true },
      { enabled: selectedCatId !== null }
    );

  const setSoldOut = trpc.pos.menu.setSoldOut.useMutation({
    onSuccess: () => { refetchItems(); toast.success("품절 상태 변경됨"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteCategoryMut = trpc.pos.menu.deleteCategory.useMutation({
    onSuccess: () => { refetchCats(); setDeleteConfirm({ open: false }); toast.success("카테고리 삭제됨"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteItemMut = trpc.pos.menu.deleteItem.useMutation({
    onSuccess: () => { refetchItems(); setDeleteConfirm({ open: false }); toast.success("메뉴 삭제됨"); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">메뉴 관리</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 좌측: 카테고리 */}
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">카테고리</h2>
            {isManager && (
              <Button size="sm" onClick={() => setCategoryDialog({ open: true })}>
                + 추가
              </Button>
            )}
          </div>
          <div className="space-y-1">
            {categories?.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">카테고리가 없습니다</p>
            )}
            {categories?.map(c => (
              <div
                key={c.id}
                className={`flex items-center justify-between p-2 rounded cursor-pointer ${
                  selectedCatId === c.id ? "bg-primary/10 border border-primary" : "hover:bg-muted"
                }`}
                onClick={() => setSelectedCatId(c.id)}
              >
                <div>
                  <span className="font-medium">{c.name}</span>
                  {!c.isActive && <Badge variant="secondary" className="ml-2 text-xs">비활성</Badge>}
                </div>
                {isManager && (
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" onClick={() => setCategoryDialog({ open: true, editing: c })}>편집</Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleteConfirm({ open: true, type: 'category', id: c.id, name: c.name })}>삭제</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* 우측: 메뉴 항목 */}
        <Card className="lg:col-span-2 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">
              {selectedCatId
                ? `${categories?.find(c => c.id === selectedCatId)?.name ?? ""} 메뉴`
                : "메뉴를 보려면 좌측 카테고리를 선택하세요"}
            </h2>
            {isManager && selectedCatId && (
              <Button size="sm" onClick={() => setItemDialog({ open: true })}>
                + 메뉴 추가
              </Button>
            )}
          </div>
          {selectedCatId && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {items?.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center col-span-full">메뉴가 없습니다</p>
              )}
              {items?.map(it => (
                <div key={it.id} className="border rounded p-3 space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium">
                        {it.name}
                        {it.isSoldOut && <Badge variant="destructive" className="ml-2 text-xs">품절</Badge>}
                        {!it.isActive && <Badge variant="secondary" className="ml-2 text-xs">비활성</Badge>}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {Number(it.price).toLocaleString()}원
                      </div>
                    </div>
                  </div>
                  {isManager && (
                    <div className="flex gap-1 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => setItemDialog({ open: true, editing: it })}>편집</Button>
                      <Button size="sm" variant="outline" onClick={() => setOptionsDialog({ open: true, itemId: it.id, itemName: it.name })}>옵션</Button>
                      <Button size="sm" variant="outline"
                        onClick={() => setSoldOut.mutate({ restaurantId: RID, id: it.id, isSoldOut: !it.isSoldOut })}>
                        {it.isSoldOut ? "판매 재개" : "품절 처리"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleteConfirm({ open: true, type: 'item', id: it.id, name: it.name })}>삭제</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* 다이얼로그들 */}
      <CategoryFormDialog
        open={categoryDialog.open}
        editing={categoryDialog.editing}
        restaurantId={RID}
        onClose={() => setCategoryDialog({ open: false })}
        onSaved={() => { refetchCats(); setCategoryDialog({ open: false }); }}
      />
      <MenuItemFormDialog
        open={itemDialog.open}
        editing={itemDialog.editing}
        restaurantId={RID}
        defaultCategoryId={selectedCatId ?? undefined}
        categories={categories ?? []}
        onClose={() => setItemDialog({ open: false })}
        onSaved={() => { refetchItems(); setItemDialog({ open: false }); }}
      />
      <MenuOptionsDialog
        open={optionsDialog.open}
        restaurantId={RID}
        menuItemId={optionsDialog.itemId}
        menuItemName={optionsDialog.itemName}
        onClose={() => setOptionsDialog({ open: false })}
      />
      <ConfirmDialog
        open={deleteConfirm.open}
        title={deleteConfirm.type === 'category' ? "카테고리 삭제" : "메뉴 삭제"}
        description={`'${deleteConfirm.name}'을(를) 삭제하시겠습니까?${
          deleteConfirm.type === 'category' ? " 활성 메뉴가 있으면 삭제되지 않습니다." : ""
        }`}
        confirmLabel="삭제"
        confirmVariant="destructive"
        onCancel={() => setDeleteConfirm({ open: false })}
        onConfirm={() => {
          if (deleteConfirm.type === 'category' && deleteConfirm.id) {
            deleteCategoryMut.mutate({ restaurantId: RID, id: deleteConfirm.id });
          } else if (deleteConfirm.type === 'item' && deleteConfirm.id) {
            deleteItemMut.mutate({ restaurantId: RID, id: deleteConfirm.id });
          }
        }}
      />
    </div>
  );
}
```

### 3.2 `client/src/components/pos/CategoryFormDialog.tsx` 신규

```tsx
// props: open, editing?, restaurantId, onClose, onSaved
// 필드: name (varchar 100), displayOrder (int, default 0), isActive (bool, default true)
// upsertCategory mutation 호출
```

단순 폼 — Input 3개 + 저장/취소.

### 3.3 `client/src/components/pos/MenuItemFormDialog.tsx` 신규

```tsx
// props: open, editing?, restaurantId, defaultCategoryId?, categories, onClose, onSaved
// 필드:
//   name (text 150)
//   price (string regex /^\d+(\.\d{1,2})?$/, 입력은 천단위 콤마 표시)
//   categoryId (라디오 카드 — categories 활성만)
//   taxType (라디오: 과세/면세/영세) — 라벨: '과세'/'면세'/'영세 0%'
//   displayOrder (int)
//   isActive (체크박스)
//   imageUrl (text 500, 선택)
//   recipeId (선택, 1차 미사용)
// upsertItem mutation 호출
```

가격 입력 UX: 사용자가 "4500" 입력 → 화면에 "4,500"으로 보여주되 서버에는 "4500" 전송. blur 시 검증.

taxType 라벨 (한글):
- `taxable` → "과세"
- `exempt` → "면세"
- `zero` → "영세 (0%)"

→ `posLabels.ts`에 `TAX_TYPE_LABEL` 추가:
```ts
export const TAX_TYPE_LABEL: Record<string, string> = {
  taxable: "과세",
  exempt:  "면세",
  zero:    "영세 (0%)",
};
```

### 3.4 `client/src/components/pos/MenuOptionsDialog.tsx` 신규

```tsx
// props: open, restaurantId, menuItemId?, menuItemName?, onClose
// 내부:
//   - listOptionGroups query (groups + nested options)
//   - "옵션 그룹 추가" 버튼
//   - 각 그룹 카드: 이름, minSelect/maxSelect/isRequired 인라인 편집, 옵션 리스트, "옵션 추가"
//   - 그룹 삭제 / 옵션 삭제 버튼 (확인)
```

세부 컴포넌트 분할 자유. 한 다이얼로그에 다 넣되 그룹별 카드 쌓기.

### 3.5 `client/src/components/pos/ConfirmDialog.tsx` 신규

기존 코드베이스에 ConfirmDialog 재사용 가능한 게 있을 수도. 있으면 재사용, 없으면 신규 (단순 yes/no 다이얼로그).

```tsx
// props: open, title, description, confirmLabel?, confirmVariant?, onCancel, onConfirm
```

---

## 4. `posLabels.ts` 보강

```ts
// 기존 매핑 + 추가:
export const TAX_TYPE_LABEL: Record<string, string> = {
  taxable: "과세",
  exempt:  "면세",
  zero:    "영세 (0%)",
};
```

PosMenuPage / MenuItemFormDialog에서 활용.

---

## 5. 검증 절차

### 5.1 빌드
- `pnpm run build` 통과
- `npx tsc --noEmit | grep -i 'pos/Menu\|PosMenuPage'` → 0 errors

### 5.2 prod 시연

배포 후 천호점 점장 계정으로:

1. 사이드바 "POS" 그룹 노출 확인 (`posEnabled=true`)
2. "메뉴 관리" 클릭 → /pos/menu 진입
3. "+ 카테고리 추가" → 이름 "음료" 입력 → 저장 → 좌측 리스트에 추가
4. 카테고리 선택 → "+ 메뉴 추가" → 이름 "아메리카노", 가격 4500, taxType 과세 → 저장
5. 우측 메뉴 카드에 "아메리카노 4,500원" 표시
6. "옵션" 클릭 → 옵션 그룹 추가 "사이즈" / 옵션 추가 "Tall 0", "Grande +500"
7. "품절 처리" → 배지 변경 → "판매 재개"
8. 편집 → 이름 변경 → 저장 → 갱신 확인
9. 삭제 (확인 다이얼로그 후 soft delete)
10. 카테고리 삭제 (활성 메뉴 0건 확인 후 통과)
11. 직원 계정으로 다시 로그인 → 같은 페이지 → 추가/편집 버튼 모두 숨김 + 조회만
12. 비활성 매장 (광명AK 등) 점장 계정 → "비활성" 안내 화면

비활성 매장 점장 계정이 없으면 master로 광명AK 활성화 한 후 다시 비활성화 흐름은 생략. 점장이 천호점 외 매장 진입은 거의 없음.

### 5.3 사이드바 노출 확인
- 천호점 선택: "POS" 그룹 노출
- 비활성 매장 선택: "POS" 그룹 숨김

---

## 6. 5항 보고 템플릿

```
1. 변경 파일:
   - client/src/pages/PosMenuPage.tsx (신규)
   - client/src/components/pos/CategoryFormDialog.tsx (신규)
   - client/src/components/pos/MenuItemFormDialog.tsx (신규)
   - client/src/components/pos/MenuOptionsDialog.tsx (신규)
   - client/src/components/pos/ConfirmDialog.tsx (신규 또는 기존 재사용)
   - client/src/lib/posLabels.ts (TAX_TYPE_LABEL 추가)
   - client/src/App.tsx (라우트 1줄 추가)
   - client/src/components/AppLayout.tsx (사이드바 POS 그룹 추가, posEnabled 조건부)
2. 의도: P2.2 — 메뉴 관리 화면 + 사이드바 POS 그룹 시작.
3. 영향 범위:
   - 신규 라우트 /pos/menu (manager+ 편집, staff 조회)
   - 사이드바: 활성 매장에서만 POS 그룹 노출
   - tRPC: pos.menu.* 12 endpoint 모두 활용
   - DB / 백엔드: 변경 없음
4. 리스크:
   - useRestaurant의 posEnabled 노출 여부 — Code 점검 후 (a)/(b) 선택
   - 사이드바 컴포넌트 패턴 일치 — 기존 그룹 정확히 따름
   - 가격 입력 UX (콤마 표시) — 1차 단순 처리, blur 검증
   - 메뉴 삭제 후 옵션 그룹/옵션 cascade — 이미 백엔드에서 처리되지만 확인
   - 롤백: 라우트·사이드바 1줄씩 revert, 신규 컴포넌트 디렉토리 삭제
5. 빌드: pnpm run build ✅
```

---

## 7. 짚을 점

- **모든 노출 텍스트 한글** — `posLabels.ts` 매핑 활용. 영어 enum 직노출 금지
- **shadcn Dialog 안 라디오 카드** 패턴 유지 (P2.1 hotfix와 일관)
- **권한 분기**: P2.1과 동일 패턴 (`isManager` 변수)
- **활성화 게이트 안내**: 비활성 매장 진입 시 PosSettingsCard 비활성 안내와 동일한 메시지·시각
- **카테고리 삭제 거부 메시지**: 백엔드 응답("이 카테고리에 활성 메뉴가 있습니다...")을 토스트로 그대로 노출
- **옵션 그룹 hard delete 확인**: `MenuOptionsDialog`에서 그룹 삭제 시 "옵션도 함께 삭제됩니다" 안내

---

## 8. 후속 PR

- P2.3 카운터 5화면 (`/pos/counter`) — 사이드바에 "주문 입력" 메뉴 추가
- 본 PR이 P2 UI 패턴(사이드바 그룹·게이트 안내·권한 분기) 정착시킴. 후속 PR은 패턴 그대로 적용
