import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Plus, X, Edit3, Trash2, Pin, Megaphone, DoorOpen, Phone, BookOpen,
  MoreHorizontal, Info, Clock, Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";

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

// ─── 매장 기본정보 섹션 ──────────────────────────────────────────────────────
function StoreBasicInfo({ restaurantId, isManager }: { restaurantId: number; isManager: boolean }) {
  const { selectedRestaurant: current } = useRestaurant();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [openTime, setOpenTime] = useState(current?.openTime ?? "09:00");
  const [closeTime, setCloseTime] = useState(current?.closeTime ?? "22:00");
  const [editingSalesTime, setEditingSalesTime] = useState(false);
  const [salesStartTime, setSalesStartTime] = useState(current?.salesInputStartTime ?? "");
  const [salesEndTime, setSalesEndTime] = useState(current?.salesInputEndTime ?? "");

  const updateMut = trpc.restaurants.update.useMutation({
    onSuccess() {
      toast.success("설정이 변경되었습니다");
      utils.restaurants.list.invalidate();
      utils.restaurants.listMine.invalidate();
      setEditing(false);
      setEditingSalesTime(false);
    },
    onError(e) { toast.error(e.message); },
  });

  const handleSave = () => {
    if (!restaurantId) return;
    updateMut.mutate({ id: restaurantId, openTime, closeTime });
  };

  const handleSaveSalesTime = () => {
    if (!restaurantId) return;
    updateMut.mutate({
      id: restaurantId,
      salesInputStartTime: salesStartTime || null,
      salesInputEndTime: salesEndTime || null,
    });
  };

  if (!current) return null;

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
        <Settings className="w-4 h-4 text-primary" />
        <span className="font-semibold text-sm text-foreground">매장 기본정보</span>
      </div>
      <div className="p-4 space-y-3">
        {/* 매장명 */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">매장명</span>
          <span className="text-sm font-medium text-foreground">{current.name}</span>
        </div>
        {/* 주소 */}
        {current.address && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">주소</span>
            <span className="text-sm text-foreground">{current.address}</span>
          </div>
        )}
        {/* 연락처 */}
        {current.phone && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">연락처</span>
            <span className="text-sm text-foreground">{current.phone}</span>
          </div>
        )}
        {/* 영업시간 */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" /> 영업시간
          </span>
          {!editing ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {current.openTime ?? "09:00"} ~ {current.closeTime ?? "22:00"}
              </span>
              {isManager && (
                <button
                  onClick={() => {
                    setOpenTime(current.openTime ?? "09:00");
                    setCloseTime(current.closeTime ?? "22:00");
                    setEditing(true);
                  }}
                  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <input
                type="time"
                value={openTime}
                onChange={(e) => setOpenTime(e.target.value)}
                className="w-[100px] rounded border border-input bg-background px-2 py-1 text-sm"
              />
              <span className="text-muted-foreground text-xs">~</span>
              <input
                type="time"
                value={closeTime}
                onChange={(e) => setCloseTime(e.target.value)}
                className="w-[100px] rounded border border-input bg-background px-2 py-1 text-sm"
              />
              <Button size="sm" variant="default" onClick={handleSave} disabled={updateMut.isPending} className="h-7 px-2 text-xs">
                저장
              </Button>
              <button onClick={() => setEditing(false)} className="p-1 rounded hover:bg-accent text-muted-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        {/* 매출 입력 허용 시간대 */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" /> 매출입력 시간
          </span>
          {!editingSalesTime ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {current.salesInputStartTime && current.salesInputEndTime
                  ? `${current.salesInputStartTime} ~ ${current.salesInputEndTime}`
                  : "제한 없음"}
              </span>
              {isManager && (
                <button
                  onClick={() => {
                    setSalesStartTime(current.salesInputStartTime ?? "");
                    setSalesEndTime(current.salesInputEndTime ?? "");
                    setEditingSalesTime(true);
                  }}
                  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <input
                type="time"
                value={salesStartTime}
                onChange={(e) => setSalesStartTime(e.target.value)}
                className="w-[100px] rounded border border-input bg-background px-2 py-1 text-sm"
                placeholder="미설정"
              />
              <span className="text-muted-foreground text-xs">~</span>
              <input
                type="time"
                value={salesEndTime}
                onChange={(e) => setSalesEndTime(e.target.value)}
                className="w-[100px] rounded border border-input bg-background px-2 py-1 text-sm"
                placeholder="미설정"
              />
              <Button size="sm" variant="default" onClick={handleSaveSalesTime} disabled={updateMut.isPending} className="h-7 px-2 text-xs">
                저장
              </Button>
              <button
                onClick={() => {
                  // 초기화 (제한 없음으로)
                  setSalesStartTime("");
                  setSalesEndTime("");
                  handleSaveSalesTime();
                }}
                className="p-1 rounded hover:bg-accent text-muted-foreground text-xs"
                title="제한 해제"
              >
                해제
              </button>
              <button onClick={() => setEditingSalesTime(false)} className="p-1 rounded hover:bg-accent text-muted-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        {/* 월 매출 목표 */}
        {current.monthlyTargetSales && Number(current.monthlyTargetSales) > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">월 매출목표</span>
            <span className="text-sm text-foreground">
              {Number(current.monthlyTargetSales).toLocaleString()}원
            </span>
          </div>
        )}
      </div>
      {/* 근무 프리셋 시간 설정 */}
      {isManager && restaurantId > 0 && (
        <ShiftPresetSettings restaurantId={restaurantId} />
      )}
    </div>
  );
}

// ─── 근무 프리셋 시간 설정 ──────────────────────────────────────────────────
const PRESET_TYPES = [
  { value: "open", label: "오픈" },
  { value: "full", label: "풀타임" },
  { value: "close", label: "마감" },
] as const;
const DAY_TYPES = [
  { value: "weekday", label: "평일" },
  { value: "weekend", label: "주말" },
] as const;

type PresetForm = { presetType: string; dayType: string; startTime: string; endTime: string; breakMinutes: number };

function ShiftPresetSettings({ restaurantId }: { restaurantId: number }) {
  const utils = trpc.useUtils();
  const { data: presets, isLoading } = trpc.restaurants.getShiftPresets.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );
  const [editing, setEditing] = useState(false);
  const [forms, setForms] = useState<PresetForm[]>([]);

  const saveMut = trpc.restaurants.saveShiftPresets.useMutation({
    onSuccess() {
      toast.success("근무시간 프리셋이 저장되었습니다");
      utils.restaurants.getShiftPresets.invalidate({ restaurantId });
      setEditing(false);
    },
    onError(e: any) { toast.error(e.message); },
  });

  const startEdit = () => {
    // 기존 데이터로 폼 초기화, 없는 조합은 빈 값
    const initial: PresetForm[] = [];
    for (const pt of PRESET_TYPES) {
      for (const dt of DAY_TYPES) {
        const existing = presets?.find(
          (p: any) => p.presetType === pt.value && p.dayType === dt.value
        );
        initial.push({
          presetType: pt.value,
          dayType: dt.value,
          startTime: existing?.startTime ?? "",
          endTime: existing?.endTime ?? "",
          breakMinutes: existing?.breakMinutes ?? (pt.value === "full" ? 60 : 0),
        });
      }
    }
    setForms(initial);
    setEditing(true);
  };

  const updateForm = (idx: number, field: keyof PresetForm, value: string | number) => {
    setForms((prev) => prev.map((f, i) => (i === idx ? { ...f, [field]: value } : f)));
  };

  const handleSave = () => {
    // startTime, endTime이 모두 입력된 것만 저장
    const valid = forms.filter((f) => f.startTime && f.endTime);
    if (valid.length === 0) {
      toast.error("최소 1개 프리셋의 시간을 입력해주세요");
      return;
    }
    saveMut.mutate({
      restaurantId,
      presets: valid.map((f) => ({
        presetType: f.presetType as "open" | "full" | "close",
        dayType: f.dayType as "weekday" | "weekend",
        startTime: f.startTime,
        endTime: f.endTime,
        breakMinutes: f.breakMinutes,
      })),
    });
  };

  const presetLabel = (type: string) => PRESET_TYPES.find((p) => p.value === type)?.label ?? type;
  const dayLabel = (type: string) => DAY_TYPES.find((d) => d.value === type)?.label ?? type;

  return (
    <div className="border-t border-border">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/20">
        <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
          <Clock className="w-3 h-3" /> 근무 프리셋 시간
        </span>
        {!editing && (
          <button onClick={startEdit} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
            <Edit3 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {!editing ? (
        <div className="px-4 pb-3">
          {isLoading ? (
            <p className="text-xs text-muted-foreground">불러오는 중...</p>
          ) : !presets || presets.length === 0 ? (
            <p className="text-xs text-muted-foreground">미설정 (매장 영업시간 기반 자동 계산)</p>
          ) : (
            <div className="space-y-1">
              {PRESET_TYPES.map((pt) => {
                const rows = presets.filter((p: any) => p.presetType === pt.value);
                if (rows.length === 0) return null;
                return rows.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {pt.label} ({dayLabel(r.dayType)})
                    </span>
                    <span className="font-medium text-foreground">
                      {r.startTime} ~ {r.endTime}
                      {r.breakMinutes > 0 && <span className="text-muted-foreground ml-1">(휴게 {r.breakMinutes}분)</span>}
                    </span>
                  </div>
                ));
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="px-4 pb-3 space-y-2">
          <p className="text-xs text-muted-foreground">비워두면 해당 프리셋은 매장 영업시간 기반으로 자동 계산됩니다.</p>
          {forms.map((f, idx) => (
            <div key={`${f.presetType}-${f.dayType}`} className="flex items-center gap-1.5 text-xs">
              <span className="w-20 font-medium text-foreground shrink-0">
                {presetLabel(f.presetType)} ({dayLabel(f.dayType)})
              </span>
              <input
                type="time"
                value={f.startTime}
                onChange={(e) => updateForm(idx, "startTime", e.target.value)}
                className="w-[90px] rounded border border-input bg-background px-1.5 py-0.5 text-xs"
              />
              <span className="text-muted-foreground">~</span>
              <input
                type="time"
                value={f.endTime}
                onChange={(e) => updateForm(idx, "endTime", e.target.value)}
                className="w-[90px] rounded border border-input bg-background px-1.5 py-0.5 text-xs"
              />
              <span className="text-muted-foreground shrink-0">휴게</span>
              <input
                type="number"
                value={f.breakMinutes}
                onChange={(e) => updateForm(idx, "breakMinutes", Number(e.target.value) || 0)}
                className="w-[50px] rounded border border-input bg-background px-1.5 py-0.5 text-xs text-center"
                min={0}
                max={180}
              />
              <span className="text-muted-foreground">분</span>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="default" onClick={handleSave} disabled={saveMut.isPending} className="h-7 px-3 text-xs">
              저장
            </Button>
            <button onClick={() => setEditing(false)} className="text-xs text-muted-foreground hover:text-foreground">
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

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
      {/* 매장 기본정보 섹션 */}
      <StoreBasicInfo restaurantId={restaurantId} isManager={isManager} />

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
    isPinned: existing?.isPinned ?? false,
  });

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
    if (editId) {
      update.mutate({ id: editId, ...form });
    } else {
      create.mutate({ restaurantId, ...form, cardType: form.cardType as any });
    }
  };

  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 p-5 max-h-[90vh] overflow-y-auto">
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
