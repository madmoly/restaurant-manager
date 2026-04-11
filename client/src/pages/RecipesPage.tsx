import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { resizeImage } from "@/lib/imageResize";
import {
  Plus, X, ChefHat, Edit3, Trash2, Image, ChevronDown, ChevronUp, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const CATEGORIES = ["메인", "사이드", "음료", "디저트", "소스/양념", "기타"];

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
    onSuccess() { toast.success("삭제됨"); utils.recipes.list.invalidate(); },
    onError(e) { toast.error(e.message); },
  });

  const filtered = (recipes ?? []).filter((r) => {
    if (search && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat && r.category !== filterCat) return false;
    return true;
  });

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 space-y-4">
      {/* 헤더 */}
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

      {/* 검색 + 필터 */}
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

      {/* 목록 */}
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
              {/* 카드 헤더 */}
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
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground truncate">{r.title}</span>
                    {r.category && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-muted-foreground whitespace-nowrap">
                        {r.category}
                      </span>
                    )}
                  </div>
                  {r.content && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{r.content}</p>
                  )}
                </div>
                {expandedId === r.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>

              {/* 펼침 상세 */}
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

      {/* 등록/수정 모달 */}
      {showForm && (
        <RecipeFormModal
          restaurantId={restaurantId}
          editId={editingId}
          onClose={() => { setShowForm(false); setEditingId(null); }}
        />
      )}
    </div>
  );
}

// ─── 등록/수정 모달 ────────────────────────────────────────────────────────────

function RecipeFormModal({ restaurantId, editId, onClose }: {
  restaurantId: number; editId: number | null; onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: existing } = trpc.recipes.getById.useQuery(
    { id: editId! },
    { enabled: editId !== null },
  );

  const [form, setForm] = useState({
    title: "",
    category: "",
    imageUrl: "",
    content: "",
  });
  const [uploading, setUploading] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // 수정 시 기존 데이터 로드
  if (existing && !initialized) {
    setForm({
      title: existing.title,
      category: existing.category ?? "",
      imageUrl: existing.imageUrl ?? "",
      content: existing.content ?? "",
    });
    setInitialized(true);
  }
  if (editId === null && !initialized) {
    setInitialized(true);
  }

  const create = trpc.recipes.create.useMutation({
    onSuccess() { toast.success("레시피 등록됨"); utils.recipes.list.invalidate(); onClose(); },
    onError(e) { toast.error(e.message); },
  });
  const update = trpc.recipes.update.useMutation({
    onSuccess() { toast.success("수정됨"); utils.recipes.list.invalidate(); onClose(); },
    onError(e) { toast.error(e.message); },
  });

  const handleImageUpload = async (file: File) => {
    setUploading(true);
    try {
      const resized = await resizeImage(file, { maxSize: 800 });
      const formData = new FormData();
      formData.append("photo", resized);
      const res = await fetch("/api/upload/checklist-photo", { method: "POST", body: formData });
      const { url } = await res.json();
      setForm((f) => ({ ...f, imageUrl: url }));
    } catch { toast.error("이미지 업로드 실패"); }
    setUploading(false);
  };

  const handleSubmit = () => {
    if (!form.title.trim()) { toast.error("메뉴명을 입력해주세요"); return; }
    if (editId) {
      update.mutate({ id: editId, ...form });
    } else {
      create.mutate({ restaurantId, ...form });
    }
  };

  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 p-5 max-h-[90vh] overflow-y-auto pb-20 lg:pb-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{editId ? "레시피 수정" : "레시피 등록"}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="w-5 h-5" /></button>
        </div>

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
                ><X className="w-4 h-4" /></button>
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
              className={`${inputCls} min-h-[160px]`}
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder={"재료:\n- 갈비 500g\n- 무 200g\n\n조리법:\n1. 갈비를 찬물에 1시간 담가 핏물 제거\n2. ..."}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button onClick={handleSubmit} disabled={create.isPending || update.isPending}>
            {(create.isPending || update.isPending) ? "저장 중..." : editId ? "수정" : "등록"}
          </Button>
        </div>
      </div>
    </div>
  );
}
