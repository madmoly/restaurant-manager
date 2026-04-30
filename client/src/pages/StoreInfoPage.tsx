import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Plus, X, Edit3, Trash2, Pin, Megaphone, DoorOpen, Phone, BookOpen,
  MoreHorizontal, Info, ImagePlus, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PosSettingsCard } from "@/components/pos/PosSettingsCard";

const CARD_TYPES = [
  { value: "notice", label: "공지", icon: Megaphone, color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800" },
  { value: "access", label: "출입방법", icon: DoorOpen, color: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800" },
  { value: "contact", label: "연락처", icon: Phone, color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800" },
  { value: "rule", label: "규정/매뉴얼", icon: BookOpen, color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800" },
  { value: "other", label: "기타", icon: MoreHorizontal, color: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-800" },
] as const;

function getCardType(val: string) {
  return CARD_TYPES.find((t) => t.value === val) ?? CARD_TYPES[4];
}

// ─── 메인 페이지 ────────────────────────────────────────────────────────────

export default function StoreInfoPage() {
  const { user } = useAuth();
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;
  const isManager =
    user?.role === "master" || user?.role === "admin" ||
    current?.storeRole === "owner" || current?.storeRole === "supervisor";

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string>("");

  const utils = trpc.useUtils();
  const { data: cards, isLoading } = trpc.storeInfo.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  const deleteMut = trpc.storeInfo.delete.useMutation({
    onSuccess() { toast.success("삭제됨"); utils.storeInfo.list.invalidate(); },
    onError(e) { toast.error(e.message); },
  });

  const togglePin = trpc.storeInfo.update.useMutation({
    onSuccess() { utils.storeInfo.list.invalidate(); },
  });

  const filtered = (cards ?? []).filter((c) => {
    if (filterType && c.cardType !== filterType) return false;
    return true;
  });

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 space-y-4">
      {/* POS 설정 카드 — 매장이 선택돼있을 때만 */}
      {restaurantId > 0 && (
        <PosSettingsCard restaurantId={restaurantId} canEdit={isManager} />
      )}

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Info className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">업무정보</h1>
          <span className="text-sm text-muted-foreground">{filtered.length}건</span>
        </div>
        {isManager && (
          <Button size="sm" onClick={() => { setEditingId(null); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-1" /> 등록
          </Button>
        )}
      </div>

      {/* 유형 필터 */}
      <div className="flex gap-1.5 flex-wrap">
        <button
          className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${!filterType ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-accent"}`}
          onClick={() => setFilterType("")}
        >전체</button>
        {CARD_TYPES.map((t) => (
          <button
            key={t.value}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${filterType === t.value ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-accent"}`}
            onClick={() => setFilterType(filterType === t.value ? "" : t.value)}
          >{t.label}</button>
        ))}
      </div>

      {/* 카드 목록 */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Info className="w-10 h-10 mx-auto mb-2 text-muted-foreground/50" />
          <p>{cards?.length === 0 ? "등록된 업무정보가 없습니다" : "필터 결과가 없습니다"}</p>
          {isManager && cards?.length === 0 && (
            <p className="text-xs mt-1">공지, 매장 출입방법, 거래처 연락처 등을 카드로 등록하세요</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const ct = getCardType(c.cardType);
            const IconComp = ct.icon;
            return (
              <div key={c.id} className={`border rounded-lg p-4 space-y-2 ${ct.color}`}>
                <div className="flex items-start gap-2">
                  <IconComp className="w-4.5 h-4.5 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{c.title}</span>
                      {c.isPinned && <Pin className="w-3 h-3 text-current opacity-60" />}
                      <span className="text-[10px] opacity-60">{ct.label}</span>
                    </div>
                    {c.imageUrl && (
                      <img
                        src={c.imageUrl}
                        alt=""
                        className="mt-2 rounded-md max-h-48 object-contain cursor-pointer"
                        onClick={() => window.open(c.imageUrl!, "_blank")}
                      />
                    )}
                    {c.content && (
                      <div className="mt-1.5 text-sm whitespace-pre-wrap leading-relaxed opacity-90">
                        {c.content}
                      </div>
                    )}
                  </div>
                </div>

                {isManager && (
                  <div className="flex gap-2 pt-2 border-t border-current/10">
                    <button
                      className="flex items-center gap-1 text-[11px] opacity-70 hover:opacity-100 px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5"
                      onClick={() => togglePin.mutate({ id: c.id, isPinned: !c.isPinned })}
                    >
                      <Pin className="w-3 h-3" /> {c.isPinned ? "고정 해제" : "상단 고정"}
                    </button>
                    <button
                      className="flex items-center gap-1 text-[11px] opacity-70 hover:opacity-100 px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5"
                      onClick={() => { setEditingId(c.id); setShowForm(true); }}
                    >
                      <Edit3 className="w-3 h-3" /> 수정
                    </button>
                    <button
                      className="flex items-center gap-1 text-[11px] text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                      onClick={() => { if (confirm("삭제하시겠습니까?")) deleteMut.mutate({ id: c.id }); }}
                    >
                      <Trash2 className="w-3 h-3" /> 삭제
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 등록/수정 모달 */}
      {showForm && (
        <InfoCardFormModal
          restaurantId={restaurantId}
          editId={editingId}
          cards={cards ?? []}
          onClose={() => { setShowForm(false); setEditingId(null); }}
        />
      )}
    </div>
  );
}

// ─── 등록/수정 모달 ────────────────────────────────────────────────────────────

function InfoCardFormModal({ restaurantId, editId, cards, onClose }: {
  restaurantId: number; editId: number | null; cards: any[]; onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const existing = editId ? cards.find((c) => c.id === editId) : null;

  const [form, setForm] = useState({
    cardType: existing?.cardType ?? "notice",
    title: existing?.title ?? "",
    content: existing?.content ?? "",
    imageUrl: existing?.imageUrl ?? "",
    isPinned: existing?.isPinned ?? false,
  });
  const [uploading, setUploading] = useState(false);

  const create = trpc.storeInfo.create.useMutation({
    onSuccess() { toast.success("등록됨"); utils.storeInfo.list.invalidate(); onClose(); },
    onError(e) { toast.error(e.message); },
  });
  const update = trpc.storeInfo.update.useMutation({
    onSuccess() { toast.success("수정됨"); utils.storeInfo.list.invalidate(); onClose(); },
    onError(e) { toast.error(e.message); },
  });

  const handleSubmit = () => {
    if (!form.title.trim()) { toast.error("제목을 입력해주세요"); return; }
    const payload = {
      cardType: form.cardType as any,
      title: form.title,
      content: form.content || undefined,
      imageUrl: form.imageUrl || undefined,
      isPinned: form.isPinned,
    };
    if (editId) {
      update.mutate({ id: editId, ...payload });
    } else {
      create.mutate({ restaurantId, ...payload });
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("이미지 파일만 가능합니다"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("5MB 이하만 가능합니다"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const res = await fetch("/api/upload/store-info-image", { method: "POST", body: fd });
      const data = await res.json();
      if (data.url) {
        setForm((prev) => ({ ...prev, imageUrl: data.url }));
      } else {
        toast.error(data.error || "업로드 실패");
      }
    } catch {
      toast.error("업로드 중 오류 발생");
    } finally {
      setUploading(false);
    }
  };

  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 p-5 max-h-[90vh] overflow-y-auto pb-20 lg:pb-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{editId ? "정보 수정" : "업무정보 등록"}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">유형</label>
            <div className="mt-1 flex gap-1.5 flex-wrap">
              {CARD_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${form.cardType === t.value ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-accent"}`}
                  onClick={() => setForm({ ...form, cardType: t.value })}
                >{t.label}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">제목 *</label>
            <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={form.cardType === "contact" ? "예: 주요 거래처 연락처" : form.cardType === "access" ? "예: 매장 출입 방법" : "제목 입력"} />
          </div>

          <div>
            <label className="text-sm font-medium">내용</label>
            <textarea
              className={`${inputCls} min-h-[120px]`}
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder={
                form.cardType === "contact"
                  ? "식자재: 김사장 010-1234-5678\n음료: 박대리 010-9876-5432\n정비: ..."
                  : form.cardType === "access"
                  ? "1. 정문 비밀번호: 1234#\n2. 후문은 카드키 사용\n3. ..."
                  : "내용을 입력하세요"
              }
            />
          </div>

          <div>
            <label className="text-sm font-medium">사진</label>
            {form.imageUrl ? (
              <div className="mt-1 relative inline-block">
                <img src={form.imageUrl} alt="" className="rounded-md max-h-40 object-contain" />
                <button
                  type="button"
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                  onClick={() => setForm({ ...form, imageUrl: "" })}
                ><X className="w-3 h-3" /></button>
              </div>
            ) : (
              <label className={`mt-1 flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-4 cursor-pointer hover:bg-accent/50 transition-colors ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
                {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5 text-muted-foreground" />}
                <span className="text-sm text-muted-foreground">{uploading ? "업로드 중..." : "사진 추가"}</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
              </label>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.isPinned} onChange={(e) => setForm({ ...form, isPinned: e.target.checked })}
              className="rounded border-input" />
            <span className="text-sm">상단 고정</span>
          </label>
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
