import { useState, useEffect, useRef } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { resizeImage } from "@/lib/imageResize";
import {
  Plus, X, ChefHat, Edit3, Trash2, Image, ChevronDown, ChevronUp, Search,
  AlertCircle, PackageOpen, Trash,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const CATEGORIES = ["메인", "사이드", "음료", "디저트", "소스/양념", "기타"];

function formatCost(v: number | null | undefined) {
  if (v == null) return null;
  return `₩${Math.round(v).toLocaleString()}`;
}
function formatPct(v: number | null | undefined) {
  if (v == null) return null;
  return `${(v * 100).toFixed(1)}%`;
}
function isStaleDate(dateStr: string | null, days = 60) {
  if (!dateStr) return false;
  return (Date.now() - new Date(dateStr).getTime()) / 86400000 > days;
}

// ── RecipesPage ───────────────────────────────────────────────────────────────
export default function RecipesPage() {
  const { user } = useAuth();
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;
  const isManager =
    user?.role === "master" || user?.role === "admin" ||
    current?.storeRole === "owner" || current?.storeRole === "supervisor";

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("");

  const utils = trpc.useUtils();
  const { data: recipes, isLoading } = trpc.recipes.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  const deleteMut = trpc.recipes.delete.useMutation({
    onSuccess() {
      toast.success("삭제됨");
      utils.recipes.list.invalidate();
    },
    onError(e) { toast.error(e.message); },
  });

  const filtered = (recipes ?? []).filter((r) => {
    if (search && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat && r.category !== filterCat) return false;
    return true;
  });

  const targetCostRatioDecimal = Number((current as any)?.targetCostRatio ?? "80") / 100;

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChefHat className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">레시피 정보</h1>
          <span className="text-sm text-muted-foreground">{filtered.length}건</span>
        </div>
        {isManager && (
          <Button size="sm" onClick={() => { setEditingId(null); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-1" /> 등록
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            className="w-full pl-9 pr-3 py-2 text-sm border border-input rounded-lg bg-background"
            placeholder="메뉴 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="border border-input rounded-lg bg-background px-3 py-2 text-sm"
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
        >
          <option value="">전체</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {recipes?.length === 0 ? "등록된 레시피가 없습니다" : "검색 결과가 없습니다"}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <div key={r.id} className="border border-border rounded-lg bg-card overflow-hidden">
              <button
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
                onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
              >
                {r.imageUrl ? (
                  <img src={r.imageUrl} alt={r.title} className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                    <ChefHat className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground truncate">{r.title}</span>
                    {r.category && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-muted-foreground whitespace-nowrap">
                        {r.category}
                      </span>
                    )}
                  </div>
                  {isManager && (r as any).sellingPrice && (
                    <span className="text-xs text-muted-foreground">
                      판매가 ₩{Number((r as any).sellingPrice).toLocaleString()}
                    </span>
                  )}
                </div>
                {expandedId === r.id
                  ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
              </button>

              {expandedId === r.id && (
                <div className="border-t border-border px-4 py-3 space-y-3">
                  {r.imageUrl && (
                    <img src={r.imageUrl} alt={r.title} className="w-full max-h-64 object-contain rounded-lg bg-muted" />
                  )}
                  {r.content && (
                    <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                      {r.content}
                    </div>
                  )}
                  {isManager && (
                    <RecipeCostPanel recipeId={r.id} targetCostRatio={targetCostRatioDecimal} />
                  )}
                  {isManager && (
                    <div className="flex gap-2 pt-2 border-t border-border">
                      <button
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
                        onClick={() => { setEditingId(r.id); setShowForm(true); }}
                      >
                        <Edit3 className="w-3.5 h-3.5" /> 수정
                      </button>
                      <button
                        className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                        onClick={() => { if (confirm("삭제하시겠습니까?")) deleteMut.mutate({ id: r.id }); }}
                      >
                        <Trash2 className="w-3.5 h-3.5" /> 삭제
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <RecipeFormModal
          restaurantId={restaurantId}
          editId={editingId}
          onClose={() => {
            setShowForm(false);
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}

// ── RecipeCostPanel ───────────────────────────────────────────────────────────
function RecipeCostPanel({ recipeId, targetCostRatio }: {
  recipeId: number;
  targetCostRatio: number;
}) {
  const { data, isLoading } = trpc.recipeIngredients.costPreview.useQuery({ recipeId });

  if (isLoading) {
    return <div className="text-xs text-muted-foreground py-1">원가 계산 중...</div>;
  }
  if (!data || data.ingredients.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-1 flex items-center gap-1">
        <PackageOpen className="w-3.5 h-3.5" />
        재료 미등록 — 수정 버튼으로 재료를 추가하세요
      </div>
    );
  }

  const overTarget = data.costRatio != null && data.costRatio > targetCostRatio;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2 text-xs">
      {/* 재료 목록 */}
      <div className="font-medium text-muted-foreground mb-1">재료 구성</div>
      <div className="space-y-1.5">
        {data.ingredients.map((ing, idx) => (
          <div key={ing.id ?? idx} className="flex items-start gap-1">
            {/* 이름 + 배지 */}
            <span className="flex-1 leading-tight">
              {ing.displayName}
              {ing.isUnmatched && (
                <span className="ml-1 px-1 py-0.5 rounded text-[10px] bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
                  매칭 없음
                </span>
              )}
            </span>
            {/* 수량 + 단위 */}
            <span className="text-muted-foreground whitespace-nowrap tabular-nums">
              {ing.quantity}
              {ing.unitName ? ing.unitName : ""}
              {ing.yieldRate < 0.999 ? ` / 가식부 ${Math.round(ing.yieldRate * 100)}%` : ""}
            </span>
            {/* 행원가 */}
            {ing.isUncalculable ? (
              <span className="text-orange-500 dark:text-orange-400 whitespace-nowrap">단가없음</span>
            ) : ing.rowCost != null ? (
              <div className="text-right whitespace-nowrap">
                <span className="font-medium tabular-nums">{formatCost(ing.rowCost)}</span>
                {ing.sourceCounterparty && ing.sourceCounterparty !== "수동 설정" && (
                  <div className={`text-[10px] ${isStaleDate(ing.lastPurchaseDate) ? "text-orange-500" : "text-muted-foreground"}`}>
                    {ing.sourceCounterparty}
                    {ing.lastPurchaseDate ? ` · ${ing.lastPurchaseDate.slice(0, 7)}` : ""}
                    {isStaleDate(ing.lastPurchaseDate) ? " ⚠" : ""}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {/* 원가 요약 */}
      <div className="border-t border-border/60 pt-2 grid grid-cols-3 gap-x-2 gap-y-1">
        <div>
          <div className="text-muted-foreground">메뉴 총원가</div>
          <div className="font-semibold">
            {data.isIncomplete ? (
              <span className="text-orange-500 flex items-center gap-0.5">
                <AlertCircle className="w-3 h-3" /> 불완전
              </span>
            ) : (formatCost(data.menuTotalCost) ?? "—")}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">
            1인분 원가
            {data.servingYield > 1 && (
              <span className="ml-1 text-[10px]">({data.servingYield}인분 기준)</span>
            )}
          </div>
          <div className="font-semibold">
            {data.isIncomplete ? "—" : (formatCost(data.perServingCost) ?? "—")}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">원가율</div>
          <div className={`font-semibold ${overTarget ? "text-red-500 dark:text-red-400" : ""}`}>
            {data.costRatio != null ? (
              <>{formatPct(data.costRatio)}{overTarget && " ↑"}</>
            ) : data.sellingPrice == null ? (
              <span className="text-muted-foreground font-normal">판매가 미설정</span>
            ) : "—"}
          </div>
        </div>
      </div>

      {data.lossRate > 0 && (
        <div className="text-[10px] text-muted-foreground">
          * 메뉴 로스율 {(data.lossRate * 100).toFixed(0)}% 포함
        </div>
      )}
      {data.isIncomplete && (
        <div className="text-[10px] text-orange-500 dark:text-orange-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          일부 재료의 단가를 찾을 수 없어 원가 합계를 계산할 수 없습니다.
        </div>
      )}
    </div>
  );
}

// ── 재료 행 타입 ────────────────────────────────────────────────────────────────
type LocalIngredient = {
  tempId: string;
  itemId: number | null;
  displayName: string;
  quantity: string;
  unitName: string;
  yieldRatePercent: string;  // "100" = 1.0
};

let _tempCounter = 0;
const newTempId = () => `t${++_tempCounter}`;

// ── ItemSearchInput ───────────────────────────────────────────────────────────
function ItemSearchInput({
  value,
  allItems,
  onChange,
}: {
  value: { itemId: number | null; displayName: string };
  allItems: Array<{ id: number; name: string; baseUnit: string | null }>;
  onChange: (v: { itemId: number | null; displayName: string; baseUnit: string | null }) => void;
}) {
  const [text, setText] = useState(value.displayName);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = text.trim().length > 0
    ? allItems.filter(i => i.name.toLowerCase().includes(text.toLowerCase())).slice(0, 8)
    : allItems.slice(0, 6);

  return (
    <div className="relative" ref={containerRef}>
      <input
        className="w-full rounded border border-input bg-background px-2 py-1 text-xs"
        placeholder="재료명 검색 또는 입력"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          onChange({ itemId: null, displayName: e.target.value, baseUnit: null });
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-20 top-full mt-0.5 left-0 right-0 bg-card border border-border rounded shadow-lg overflow-hidden">
          {filtered.map(item => (
            <button
              key={item.id}
              type="button"
              className="w-full text-left px-2 py-1.5 text-xs hover:bg-accent flex items-center justify-between gap-2"
              onMouseDown={() => {
                onChange({ itemId: item.id, displayName: item.name, baseUnit: item.baseUnit ?? null });
                setText(item.name);
                setOpen(false);
              }}
            >
              <span>{item.name}</span>
              {item.baseUnit && <span className="text-muted-foreground">{item.baseUnit}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── RecipeFormModal ───────────────────────────────────────────────────────────
function RecipeFormModal({ restaurantId, editId, onClose }: {
  restaurantId: number;
  editId: number | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();

  const { data: existing } = trpc.recipes.getById.useQuery(
    { id: editId! },
    { enabled: editId !== null },
  );
  const { data: existingIngredients } = trpc.recipeIngredients.listByRecipe.useQuery(
    { recipeId: editId! },
    { enabled: editId !== null },
  );
  const { data: allItems = [] } = trpc.items.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0, staleTime: 60_000 },
  );

  const [form, setForm] = useState({
    title: "",
    category: "",
    imageUrl: "",
    content: "",
    servingYield: "1",
    sellingPrice: "",
    lossRatePercent: "0",
  });
  const [ingredients, setIngredients] = useState<LocalIngredient[]>([]);
  const [uploading, setUploading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [ingrInitialized, setIngrInitialized] = useState(false);

  // 기본 정보 초기화
  useEffect(() => {
    if (initialized) return;
    if (editId === null) { setInitialized(true); return; }
    if (!existing) return;
    setForm({
      title: existing.title,
      category: existing.category ?? "",
      imageUrl: existing.imageUrl ?? "",
      content: existing.content ?? "",
      servingYield: String(Number((existing as any).servingYield ?? "1")),
      sellingPrice: (existing as any).sellingPrice ? String(Number((existing as any).sellingPrice)) : "",
      lossRatePercent: String(Math.round(Number((existing as any).lossRate ?? "0") * 100)),
    });
    setInitialized(true);
  }, [existing, editId, initialized]);

  // 재료 초기화
  useEffect(() => {
    if (ingrInitialized) return;
    if (editId === null) { setIngrInitialized(true); return; }
    if (!existingIngredients || allItems.length === 0) return;
    setIngredients(existingIngredients.map(ing => {
      const item = ing.itemId ? allItems.find(i => i.id === ing.itemId) : null;
      return {
        tempId: newTempId(),
        itemId: ing.itemId ?? null,
        displayName: item?.name ?? ing.rawName ?? "",
        quantity: String(Number(ing.quantity)),
        unitName: ing.unitName ?? item?.baseUnit ?? "",
        yieldRatePercent: String(Math.round(Number(ing.yieldRate) * 100)),
      };
    }));
    setIngrInitialized(true);
  }, [existingIngredients, allItems, editId, ingrInitialized]);

  const create = trpc.recipes.create.useMutation();
  const update = trpc.recipes.update.useMutation();
  const upsertIngredients = trpc.recipeIngredients.upsert.useMutation();

  const handleImageUpload = async (file: File) => {
    setUploading(true);
    try {
      const resized = await resizeImage(file, { maxSize: 800 });
      const fd = new FormData();
      fd.append("photo", resized);
      const res = await fetch("/api/upload/checklist-photo", { method: "POST", body: fd });
      const { url } = await res.json();
      setForm(f => ({ ...f, imageUrl: url }));
    } catch { toast.error("이미지 업로드 실패"); }
    setUploading(false);
  };

  const addIngredient = () => {
    setIngredients(prev => [
      ...prev,
      { tempId: newTempId(), itemId: null, displayName: "", quantity: "0", unitName: "", yieldRatePercent: "100" },
    ]);
  };

  const removeIngredient = (tempId: string) => {
    setIngredients(prev => prev.filter(i => i.tempId !== tempId));
  };

  const updateIngredient = (tempId: string, patch: Partial<LocalIngredient>) => {
    setIngredients(prev => prev.map(i => i.tempId === tempId ? { ...i, ...patch } : i));
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) { toast.error("메뉴명을 입력해주세요"); return; }
    try {
      const servingYield = Math.max(parseFloat(form.servingYield) || 1, 0.01);
      const sellingPrice = form.sellingPrice ? parseFloat(form.sellingPrice) : null;
      const lossRate = (parseFloat(form.lossRatePercent) || 0) / 100;

      let recipeId: number;
      if (editId) {
        await update.mutateAsync({
          id: editId,
          title: form.title,
          category: form.category || undefined,
          imageUrl: form.imageUrl || undefined,
          content: form.content || undefined,
          servingYield,
          sellingPrice,
          lossRate,
        });
        recipeId = editId;
      } else {
        const result = await create.mutateAsync({
          restaurantId,
          title: form.title,
          category: form.category || undefined,
          imageUrl: form.imageUrl || undefined,
          content: form.content || undefined,
          servingYield,
          sellingPrice,
          lossRate,
        });
        recipeId = result.id;
      }

      // 재료 일괄 저장
      const validIngredients = ingredients.filter(i => i.displayName.trim() || i.itemId);
      await upsertIngredients.mutateAsync({
        recipeId,
        ingredients: validIngredients.map((ing, idx) => ({
          itemId: ing.itemId,
          rawName: ing.itemId ? null : (ing.displayName.trim() || null),
          quantity: Math.max(parseFloat(ing.quantity) || 0, 0),
          unitName: ing.unitName.trim() || null,
          yieldRate: Math.min(Math.max((parseFloat(ing.yieldRatePercent) || 100) / 100, 0.001), 1),
          sortOrder: idx,
        })),
      });

      toast.success(editId ? "수정됨" : "레시피 등록됨");
      utils.recipes.list.invalidate();
      utils.recipeIngredients.costPreview.invalidate({ recipeId });
      onClose();
    } catch (e: any) {
      toast.error(e.message || "저장 실패");
    }
  };

  const isPending = create.isPending || update.isPending || upsertIngredients.isPending;
  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 p-5 max-h-[90vh] overflow-y-auto pb-20 lg:pb-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{editId ? "레시피 수정" : "레시피 등록"}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* 기본 정보 */}
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">메뉴명 *</label>
              <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: 갈비탕" />
            </div>
            <div>
              <label className="text-sm font-medium">분류</label>
              <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">선택 안함</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">사진</label>
              {form.imageUrl ? (
                <div className="relative mt-1">
                  <img src={form.imageUrl} alt="미리보기" className="w-full max-h-48 object-contain rounded-lg bg-muted" />
                  <button
                    className="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white hover:bg-black/70"
                    onClick={() => setForm({ ...form, imageUrl: "" })}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label className="mt-1 flex items-center justify-center gap-2 border-2 border-dashed border-input rounded-lg py-6 cursor-pointer hover:bg-accent/50 transition-colors">
                  <Image className="w-5 h-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{uploading ? "업로드 중..." : "사진 추가"}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])} />
                </label>
              )}
            </div>
            <div>
              <label className="text-sm font-medium">레시피 내용</label>
              <textarea
                className={`${inputCls} min-h-[120px]`}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder={"재료:\n- 갈비 500g\n\n조리법:\n1. ..."}
              />
            </div>
          </div>

          {/* 원가 설정 */}
          <div className="border border-border rounded-lg p-3 space-y-3">
            <div className="text-sm font-medium text-foreground">원가 설정</div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">판매가 (원)</label>
                <input
                  type="number"
                  min="0"
                  className={`${inputCls} text-sm`}
                  value={form.sellingPrice}
                  onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
                  placeholder="없음"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">산출 인분</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.5"
                  className={`${inputCls} text-sm`}
                  value={form.servingYield}
                  onChange={(e) => setForm({ ...form, servingYield: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">메뉴 로스율 (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  className={`${inputCls} text-sm`}
                  value={form.lossRatePercent}
                  onChange={(e) => setForm({ ...form, lossRatePercent: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* 재료 구성 */}
          <div className="border border-border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-foreground">재료 구성</div>
              <button
                type="button"
                onClick={addIngredient}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> 재료 추가
              </button>
            </div>

            {ingredients.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-3">
                재료를 추가하면 원가가 자동 계산됩니다
              </div>
            ) : (
              <>
                {/* 헤더 */}
                <div className="grid grid-cols-[1fr_60px_50px_60px_24px] gap-1 text-[10px] text-muted-foreground px-0.5">
                  <span>재료명</span>
                  <span>수량</span>
                  <span>단위</span>
                  <span>가식부율</span>
                  <span />
                </div>
                {ingredients.map((ing) => (
                  <IngredientRow
                    key={ing.tempId}
                    ing={ing}
                    allItems={allItems as Array<{ id: number; name: string; baseUnit: string | null }>}
                    onChange={(patch) => updateIngredient(ing.tempId, patch)}
                    onDelete={() => removeIngredient(ing.tempId)}
                  />
                ))}
              </>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "저장 중..." : editId ? "수정" : "등록"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── IngredientRow ─────────────────────────────────────────────────────────────
function IngredientRow({
  ing,
  allItems,
  onChange,
  onDelete,
}: {
  ing: LocalIngredient;
  allItems: Array<{ id: number; name: string; baseUnit: string | null }>;
  onChange: (patch: Partial<LocalIngredient>) => void;
  onDelete: () => void;
}) {
  const cellCls = "rounded border border-input bg-background px-1.5 py-1 text-xs w-full";

  return (
    <div className="grid grid-cols-[1fr_60px_50px_60px_24px] gap-1 items-center">
      <ItemSearchInput
        value={{ itemId: ing.itemId, displayName: ing.displayName }}
        allItems={allItems}
        onChange={({ itemId, displayName, baseUnit }) => {
          onChange({
            itemId,
            displayName,
            unitName: ing.unitName || baseUnit || "",
          });
        }}
      />
      <input
        type="number"
        min="0"
        step="any"
        className={cellCls}
        value={ing.quantity}
        onChange={(e) => onChange({ quantity: e.target.value })}
        placeholder="0"
      />
      <input
        className={cellCls}
        value={ing.unitName}
        onChange={(e) => onChange({ unitName: e.target.value })}
        placeholder="g"
      />
      <div className="flex items-center gap-0.5">
        <input
          type="number"
          min="1"
          max="100"
          step="1"
          className={`${cellCls} pr-0`}
          value={ing.yieldRatePercent}
          onChange={(e) => onChange({ yieldRatePercent: e.target.value })}
        />
        <span className="text-[10px] text-muted-foreground">%</span>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="text-muted-foreground hover:text-red-500 flex items-center justify-center"
      >
        <Trash className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
