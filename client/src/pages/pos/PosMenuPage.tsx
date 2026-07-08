import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SquareMenu, Plus, Pencil, Trash2, Settings2, FolderCog, ImageOff,
} from "lucide-react";

const TAX_TYPE_LABEL: Record<string, string> = {
  taxable: "과세",
  exempt: "면세",
  zero: "영세율",
};

function formatWon(price: string | number): string {
  const n = typeof price === "string" ? Number(price) : price;
  if (Number.isNaN(n)) return String(price);
  return `${n.toLocaleString("ko-KR")}원`;
}

/** 서버 정규식(^\d+(\.\d{1,2})?$)에 맞는 가격 문자열인지 검사 */
function isValidPrice(v: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(v);
}

// ─── 메인 페이지 ────────────────────────────────────────────────────────────

export default function PosMenuPage() {
  const { selectedRestaurantId } = useRestaurant();
  const restaurantId = selectedRestaurantId ?? 0;

  const { data: status, isLoading: statusLoading } =
    trpc.pos.settings.getStatus.useQuery(
      { restaurantId },
      { enabled: restaurantId > 0 },
    );
  const posEnabled = status?.posEnabled === true;

  const { data: categories, isLoading: catLoading } =
    trpc.pos.menu.listCategories.useQuery(
      { restaurantId, includeInactive: true },
      { enabled: restaurantId > 0 && posEnabled },
    );
  const { data: items, isLoading: itemLoading } =
    trpc.pos.menu.listItems.useQuery(
      { restaurantId, includeInactive: true },
      { enabled: restaurantId > 0 && posEnabled },
    );

  const utils = trpc.useUtils();
  const setSoldOut = trpc.pos.menu.setSoldOut.useMutation({
    onSuccess() { utils.pos.menu.listItems.invalidate(); },
    onError(e) { toast.error(e.message); },
  });
  const deleteItem = trpc.pos.menu.deleteItem.useMutation({
    onSuccess() { toast.success("메뉴 삭제됨"); utils.pos.menu.listItems.invalidate(); },
    onError(e) { toast.error(e.message); },
  });

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [optionItemId, setOptionItemId] = useState<number | null>(null);

  if (restaurantId <= 0) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-4 text-center text-muted-foreground text-sm">
        매장을 먼저 선택하세요.
      </div>
    );
  }

  if (!statusLoading && !posEnabled) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-4">
        <div className="border border-border rounded-xl bg-card p-8 text-center space-y-2">
          <SquareMenu className="w-8 h-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">POS가 활성화되지 않은 매장입니다</p>
          <p className="text-xs text-muted-foreground">
            마스터 관리자에게 활성화를 요청하세요. 활성화 후 메뉴를 등록할 수 있습니다.
          </p>
        </div>
      </div>
    );
  }

  const cats = categories ?? [];
  const allItems = items ?? [];
  const visibleItems =
    selectedCategoryId === null
      ? allItems
      : allItems.filter((i) => i.categoryId === selectedCategoryId);
  const catName = (id: number | null) =>
    id === null ? "미분류" : (cats.find((c) => c.id === id)?.name ?? "미분류");

  const isLoading = statusLoading || catLoading || itemLoading;

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <SquareMenu className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">POS 메뉴 관리</h1>
          <span className="text-sm text-muted-foreground">{allItems.length}개 메뉴</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setCategoryDialogOpen(true)}>
            <FolderCog className="w-4 h-4 mr-1" /> 카테고리 관리
          </Button>
          <Button
            size="sm"
            onClick={() => { setEditingItemId(null); setItemFormOpen(true); }}
            disabled={cats.length === 0}
          >
            <Plus className="w-4 h-4 mr-1" /> 메뉴 추가
          </Button>
        </div>
      </div>

      {/* 카테고리 필터 칩 */}
      <div className="flex gap-1.5 flex-wrap">
        <button
          className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${selectedCategoryId === null ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-accent"}`}
          onClick={() => setSelectedCategoryId(null)}
        >전체</button>
        {cats.map((c) => (
          <button
            key={c.id}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${selectedCategoryId === c.id ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-accent"} ${!c.isActive ? "opacity-50" : ""}`}
            onClick={() => setSelectedCategoryId(selectedCategoryId === c.id ? null : c.id)}
          >
            {c.name}
            {!c.isActive && <span className="ml-1 text-[10px]">(비활성)</span>}
          </button>
        ))}
      </div>

      {/* 메뉴 목록 */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">로딩 중...</div>
      ) : cats.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <SquareMenu className="w-10 h-10 mx-auto mb-2 text-muted-foreground/50" />
          <p className="text-sm">카테고리가 없습니다</p>
          <p className="text-xs mt-1">먼저 [카테고리 관리]에서 카테고리를 만든 뒤 메뉴를 등록하세요</p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <SquareMenu className="w-10 h-10 mx-auto mb-2 text-muted-foreground/50" />
          <p className="text-sm">
            {allItems.length === 0 ? "등록된 메뉴가 없습니다" : "이 카테고리에 메뉴가 없습니다"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleItems.map((item) => (
            <div
              key={item.id}
              className={`border border-border rounded-xl bg-card p-4 space-y-2.5 ${!item.isActive ? "opacity-60" : ""}`}
            >
              <div className="flex items-start gap-2.5">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="w-12 h-12 rounded-lg object-cover shrink-0 border border-border"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <ImageOff className="w-4 h-4 text-muted-foreground/40" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-sm text-foreground truncate">{item.name}</span>
                    {!item.isActive && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">비활성</Badge>
                    )}
                    {item.taxType !== "taxable" && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {TAX_TYPE_LABEL[item.taxType] ?? item.taxType}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{catName(item.categoryId)}</p>
                  <p className="text-sm font-bold text-foreground mt-1 tabular-nums">
                    {formatWon(item.price)}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border/60">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <Switch
                    checked={item.isSoldOut}
                    disabled={setSoldOut.isPending}
                    onCheckedChange={(v) =>
                      setSoldOut.mutate({ restaurantId, id: item.id, isSoldOut: v })
                    }
                  />
                  <span className={`text-xs ${item.isSoldOut ? "text-red-500 font-medium" : "text-muted-foreground"}`}>
                    {item.isSoldOut ? "품절" : "판매중"}
                  </span>
                </label>
                <div className="flex gap-1">
                  <Button
                    size="sm" variant="ghost" className="h-7 px-2 text-xs"
                    onClick={() => setOptionItemId(item.id)}
                  >
                    <Settings2 className="w-3.5 h-3.5 mr-1" /> 옵션
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-7 px-2 text-xs"
                    onClick={() => { setEditingItemId(item.id); setItemFormOpen(true); }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-500 hover:text-red-600"
                    onClick={() => {
                      if (confirm(`'${item.name}' 메뉴를 삭제하시겠습니까?`)) {
                        deleteItem.mutate({ restaurantId, id: item.id });
                      }
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 카테고리 관리 다이얼로그 */}
      {categoryDialogOpen && (
        <CategoryManageDialog
          restaurantId={restaurantId}
          categories={cats}
          onClose={() => setCategoryDialogOpen(false)}
        />
      )}

      {/* 메뉴 등록/수정 다이얼로그 */}
      {itemFormOpen && (
        <ItemFormDialog
          restaurantId={restaurantId}
          categories={cats}
          defaultCategoryId={selectedCategoryId}
          editItem={editingItemId ? allItems.find((i) => i.id === editingItemId) ?? null : null}
          onClose={() => { setItemFormOpen(false); setEditingItemId(null); }}
        />
      )}

      {/* 옵션 관리 다이얼로그 */}
      {optionItemId !== null && (
        <OptionManageDialog
          restaurantId={restaurantId}
          item={allItems.find((i) => i.id === optionItemId) ?? null}
          onClose={() => setOptionItemId(null)}
        />
      )}
    </div>
  );
}

// ─── 카테고리 관리 다이얼로그 ────────────────────────────────────────────────

function CategoryManageDialog({ restaurantId, categories, onClose }: {
  restaurantId: number;
  categories: Array<{ id: number; name: string; displayOrder: number; isActive: boolean }>;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const invalidate = () => {
    utils.pos.menu.listCategories.invalidate();
    utils.pos.menu.listItems.invalidate();
  };

  const upsert = trpc.pos.menu.upsertCategory.useMutation({
    onSuccess(_d, vars) {
      toast.success(vars.id ? "카테고리 수정됨" : "카테고리 추가됨");
      invalidate();
      setEditingId(null);
      setForm({ name: "", displayOrder: "0", isActive: true });
    },
    onError(e) { toast.error(e.message); },
  });
  const remove = trpc.pos.menu.deleteCategory.useMutation({
    onSuccess() { toast.success("카테고리 삭제됨"); invalidate(); },
    onError(e) { toast.error(e.message); },
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", displayOrder: "0", isActive: true });

  const startEdit = (c: { id: number; name: string; displayOrder: number; isActive: boolean }) => {
    setEditingId(c.id);
    setForm({ name: c.name, displayOrder: String(c.displayOrder), isActive: c.isActive });
  };

  const submit = () => {
    const name = form.name.trim();
    if (!name) { toast.error("카테고리 이름을 입력하세요"); return; }
    const displayOrder = parseInt(form.displayOrder, 10);
    upsert.mutate({
      restaurantId,
      id: editingId ?? undefined,
      name,
      displayOrder: Number.isNaN(displayOrder) ? 0 : displayOrder,
      isActive: form.isActive,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>카테고리 관리</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* 기존 카테고리 목록 */}
          {categories.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">
              카테고리가 없습니다. 아래에서 추가하세요.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {categories.map((c) => (
                <div
                  key={c.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${editingId === c.id ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  <span className="text-xs text-muted-foreground tabular-nums w-6 shrink-0">
                    {c.displayOrder}
                  </span>
                  <span className={`text-sm flex-1 truncate ${!c.isActive ? "text-muted-foreground line-through" : "text-foreground"}`}>
                    {c.name}
                  </span>
                  {!c.isActive && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">비활성</Badge>
                  )}
                  <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => startEdit(c)}>
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-6 px-1.5 text-red-500 hover:text-red-600"
                    onClick={() => {
                      if (confirm(`'${c.name}' 카테고리를 삭제하시겠습니까?\n(활성 메뉴가 있으면 삭제되지 않습니다)`)) {
                        remove.mutate({ restaurantId, id: c.id });
                      }
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* 추가/수정 폼 */}
          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {editingId ? "카테고리 수정" : "새 카테고리"}
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="이름 (예: 음료)"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              />
              <Input
                type="number"
                className="w-20"
                title="표시 순서"
                placeholder="순서"
                value={form.displayOrder}
                onChange={(e) => setForm({ ...form, displayOrder: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                />
                <span className="text-xs text-muted-foreground">활성</span>
              </label>
              <div className="flex gap-2">
                {editingId && (
                  <Button
                    size="sm" variant="outline"
                    onClick={() => {
                      setEditingId(null);
                      setForm({ name: "", displayOrder: "0", isActive: true });
                    }}
                  >
                    취소
                  </Button>
                )}
                <Button size="sm" disabled={upsert.isPending} onClick={submit}>
                  {editingId ? "수정" : "추가"}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>닫기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 메뉴 등록/수정 다이얼로그 ───────────────────────────────────────────────

function ItemFormDialog({ restaurantId, categories, defaultCategoryId, editItem, onClose }: {
  restaurantId: number;
  categories: Array<{ id: number; name: string; isActive: boolean }>;
  defaultCategoryId: number | null;
  editItem: {
    id: number; categoryId: number | null; name: string; price: string;
    imageUrl: string | null; taxType: string; displayOrder: number; isActive: boolean;
  } | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const upsert = trpc.pos.menu.upsertItem.useMutation({
    onSuccess() {
      toast.success(editItem ? "메뉴 수정됨" : "메뉴 등록됨");
      utils.pos.menu.listItems.invalidate();
      onClose();
    },
    onError(e) { toast.error(e.message); },
  });

  const activeCats = categories.filter((c) => c.isActive || c.id === editItem?.categoryId);
  const [form, setForm] = useState({
    categoryId: editItem?.categoryId ?? defaultCategoryId ?? activeCats[0]?.id ?? 0,
    name: editItem?.name ?? "",
    price: editItem ? String(Number(editItem.price)) : "",
    imageUrl: editItem?.imageUrl ?? "",
    taxType: (editItem?.taxType ?? "taxable") as "taxable" | "exempt" | "zero",
    displayOrder: String(editItem?.displayOrder ?? 0),
    isActive: editItem?.isActive ?? true,
  });

  const submit = () => {
    const name = form.name.trim();
    if (!name) { toast.error("메뉴 이름을 입력하세요"); return; }
    const price = form.price.trim();
    if (!isValidPrice(price)) { toast.error("가격은 숫자로 입력하세요 (예: 8500)"); return; }
    if (!form.categoryId) { toast.error("카테고리를 선택하세요"); return; }
    const displayOrder = parseInt(form.displayOrder, 10);
    upsert.mutate({
      restaurantId,
      id: editItem?.id,
      categoryId: form.categoryId,
      name,
      price,
      imageUrl: form.imageUrl.trim() || undefined,
      taxType: form.taxType,
      displayOrder: Number.isNaN(displayOrder) ? 0 : displayOrder,
      isActive: form.isActive,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editItem ? "메뉴 수정" : "메뉴 등록"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div>
            <label className="text-sm font-medium">이름 *</label>
            <Input
              className="mt-1"
              placeholder="예: 아메리카노"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-sm font-medium">가격 (원) *</label>
              <Input
                className="mt-1"
                type="number"
                min={0}
                placeholder="8500"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">카테고리 *</label>
              <Select
                value={form.categoryId ? String(form.categoryId) : undefined}
                onValueChange={(v) => setForm({ ...form, categoryId: Number(v) })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent className="z-[100]">
                  {activeCats.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-sm font-medium">과세 구분</label>
              <Select
                value={form.taxType}
                onValueChange={(v) => setForm({ ...form, taxType: v as typeof form.taxType })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[100]">
                  <SelectItem value="taxable">과세</SelectItem>
                  <SelectItem value="exempt">면세</SelectItem>
                  <SelectItem value="zero">영세율</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">표시 순서</label>
              <Input
                className="mt-1"
                type="number"
                value={form.displayOrder}
                onChange={(e) => setForm({ ...form, displayOrder: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">이미지 URL</label>
            <Input
              className="mt-1"
              placeholder="https:// (선택, 업로드는 추후 지원)"
              value={form.imageUrl}
              onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Switch
              checked={form.isActive}
              onCheckedChange={(v) => setForm({ ...form, isActive: v })}
            />
            <span className="text-sm">판매 목록에 표시 (활성)</span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button disabled={upsert.isPending} onClick={submit}>
            {upsert.isPending ? "저장 중..." : editItem ? "수정" : "등록"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 옵션 관리 다이얼로그 ────────────────────────────────────────────────────

function OptionManageDialog({ restaurantId, item, onClose }: {
  restaurantId: number;
  item: { id: number; name: string } | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: groups, isLoading } = trpc.pos.menu.listOptionGroups.useQuery(
    { restaurantId, menuItemId: item?.id ?? 0 },
    { enabled: !!item },
  );
  const invalidate = () =>
    utils.pos.menu.listOptionGroups.invalidate({ restaurantId, menuItemId: item?.id ?? 0 });

  const upsertGroup = trpc.pos.menu.upsertOptionGroup.useMutation({
    onSuccess(_d, vars) {
      toast.success(vars.id ? "옵션 그룹 수정됨" : "옵션 그룹 추가됨");
      invalidate();
      setGroupForm(null);
    },
    onError(e) { toast.error(e.message); },
  });
  const deleteGroup = trpc.pos.menu.deleteOptionGroup.useMutation({
    onSuccess() { toast.success("옵션 그룹 삭제됨"); invalidate(); },
    onError(e) { toast.error(e.message); },
  });
  const upsertOption = trpc.pos.menu.upsertOption.useMutation({
    onSuccess(_d, vars) {
      toast.success(vars.id ? "옵션 수정됨" : "옵션 추가됨");
      invalidate();
      setOptionForm(null);
    },
    onError(e) { toast.error(e.message); },
  });
  const deleteOption = trpc.pos.menu.deleteOption.useMutation({
    onSuccess() { toast.success("옵션 삭제됨"); invalidate(); },
    onError(e) { toast.error(e.message); },
  });

  // 그룹 폼: null = 닫힘, id undefined = 신규
  const [groupForm, setGroupForm] = useState<{
    id?: number; name: string; minSelect: string; maxSelect: string; isRequired: boolean;
  } | null>(null);
  // 옵션 폼: groupId 필수, id undefined = 신규
  const [optionForm, setOptionForm] = useState<{
    id?: number; groupId: number; name: string; priceDelta: string;
  } | null>(null);

  if (!item) return null;

  const submitGroup = () => {
    if (!groupForm) return;
    const name = groupForm.name.trim();
    if (!name) { toast.error("그룹 이름을 입력하세요"); return; }
    const minSelect = parseInt(groupForm.minSelect, 10);
    const maxSelect = parseInt(groupForm.maxSelect, 10);
    if (Number.isNaN(minSelect) || minSelect < 0) { toast.error("최소 선택 수는 0 이상"); return; }
    if (Number.isNaN(maxSelect) || maxSelect < 1) { toast.error("최대 선택 수는 1 이상"); return; }
    if (minSelect > maxSelect) { toast.error("최소 선택 수가 최대보다 클 수 없습니다"); return; }
    upsertGroup.mutate({
      restaurantId,
      id: groupForm.id,
      menuItemId: item.id,
      name,
      minSelect,
      maxSelect,
      isRequired: groupForm.isRequired,
    });
  };

  const submitOption = () => {
    if (!optionForm) return;
    const name = optionForm.name.trim();
    if (!name) { toast.error("옵션 이름을 입력하세요"); return; }
    const delta = optionForm.priceDelta.trim() || "0";
    if (!/^-?\d+(\.\d{1,2})?$/.test(delta)) { toast.error("추가 금액은 숫자로 입력하세요"); return; }
    upsertOption.mutate({
      restaurantId,
      id: optionForm.id,
      optionGroupId: optionForm.groupId,
      name,
      priceDelta: delta,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>옵션 관리 — {item.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {isLoading ? (
            <p className="text-xs text-muted-foreground text-center py-4">로딩 중...</p>
          ) : (groups ?? []).length === 0 && !groupForm ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              옵션 그룹이 없습니다. (예: "샷 추가", "사이즈")
            </p>
          ) : (
            (groups ?? []).map((g) => (
              <div key={g.id} className="border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold flex-1 truncate">{g.name}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {g.minSelect}~{g.maxSelect}개{g.isRequired ? " · 필수" : ""}
                  </Badge>
                  <Button
                    size="sm" variant="ghost" className="h-6 px-1.5"
                    onClick={() => setGroupForm({
                      id: g.id, name: g.name,
                      minSelect: String(g.minSelect), maxSelect: String(g.maxSelect),
                      isRequired: g.isRequired,
                    })}
                  >
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-6 px-1.5 text-red-500 hover:text-red-600"
                    onClick={() => {
                      if (confirm(`'${g.name}' 그룹과 하위 옵션을 모두 삭제하시겠습니까?`)) {
                        deleteGroup.mutate({ restaurantId, id: g.id });
                      }
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>

                {/* 옵션 목록 */}
                {g.options.length > 0 && (
                  <div className="space-y-1">
                    {g.options.map((o) => (
                      <div key={o.id} className="flex items-center gap-2 pl-2 py-1 rounded hover:bg-accent/50">
                        <span className={`text-xs flex-1 truncate ${!o.isActive ? "text-muted-foreground line-through" : "text-foreground"}`}>
                          {o.name}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {Number(o.priceDelta) === 0 ? "+0원" : `${Number(o.priceDelta) > 0 ? "+" : ""}${Number(o.priceDelta).toLocaleString("ko-KR")}원`}
                        </span>
                        <Button
                          size="sm" variant="ghost" className="h-6 px-1.5"
                          onClick={() => setOptionForm({
                            id: o.id, groupId: g.id, name: o.name,
                            priceDelta: String(Number(o.priceDelta)),
                          })}
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="h-6 px-1.5 text-red-500 hover:text-red-600"
                          onClick={() => {
                            if (confirm(`'${o.name}' 옵션을 삭제하시겠습니까?`)) {
                              deleteOption.mutate({ restaurantId, id: o.id });
                            }
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 옵션 추가/수정 인라인 폼 */}
                {optionForm && optionForm.groupId === g.id ? (
                  <div className="flex gap-2 items-center pt-1">
                    <Input
                      className="h-8 text-xs"
                      placeholder="옵션 이름 (예: 샷 1개)"
                      value={optionForm.name}
                      onChange={(e) => setOptionForm({ ...optionForm, name: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") submitOption(); }}
                    />
                    <Input
                      className="h-8 text-xs w-24"
                      type="number"
                      placeholder="+금액"
                      value={optionForm.priceDelta}
                      onChange={(e) => setOptionForm({ ...optionForm, priceDelta: e.target.value })}
                    />
                    <Button size="sm" className="h-8 shrink-0" disabled={upsertOption.isPending} onClick={submitOption}>
                      {optionForm.id ? "수정" : "추가"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 shrink-0" onClick={() => setOptionForm(null)}>
                      취소
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => setOptionForm({ groupId: g.id, name: "", priceDelta: "0" })}
                  >
                    <Plus className="w-3 h-3 mr-1" /> 옵션 추가
                  </Button>
                )}
              </div>
            ))
          )}

          {/* 그룹 추가/수정 폼 */}
          {groupForm ? (
            <div className="border border-primary/40 rounded-lg p-3 space-y-2 bg-primary/5">
              <p className="text-xs font-medium text-muted-foreground">
                {groupForm.id ? "옵션 그룹 수정" : "새 옵션 그룹"}
              </p>
              <Input
                placeholder="그룹 이름 (예: 사이즈)"
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
              />
              <div className="flex gap-2 items-center">
                <div className="flex-1">
                  <label className="text-[11px] text-muted-foreground">최소 선택</label>
                  <Input
                    type="number" min={0} className="h-8"
                    value={groupForm.minSelect}
                    onChange={(e) => setGroupForm({ ...groupForm, minSelect: e.target.value })}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[11px] text-muted-foreground">최대 선택</label>
                  <Input
                    type="number" min={1} className="h-8"
                    value={groupForm.maxSelect}
                    onChange={(e) => setGroupForm({ ...groupForm, maxSelect: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer select-none pt-4">
                  <Switch
                    checked={groupForm.isRequired}
                    onCheckedChange={(v) => setGroupForm({ ...groupForm, isRequired: v })}
                  />
                  <span className="text-xs text-muted-foreground">필수</span>
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setGroupForm(null)}>취소</Button>
                <Button size="sm" disabled={upsertGroup.isPending} onClick={submitGroup}>
                  {groupForm.id ? "수정" : "추가"}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm" variant="outline" className="w-full"
              onClick={() => setGroupForm({ name: "", minSelect: "0", maxSelect: "1", isRequired: false })}
            >
              <Plus className="w-4 h-4 mr-1" /> 옵션 그룹 추가
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>닫기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
