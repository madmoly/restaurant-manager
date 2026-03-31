import { useState, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/hooks/useAuth";
import {
  ClipboardList, Plus, X, Check, Calendar, Repeat,
  Trash2, Edit3, ChevronDown, ChevronUp, Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

const TARGET_TABS = [
  { key: "open" as const, label: "오픈" },
  { key: "purchase" as const, label: "매입" },
  { key: "midday" as const, label: "일간보고" },
  { key: "close" as const, label: "마감" },
];

type TargetTab = "open" | "purchase" | "midday" | "close";

type Template = {
  id: number; itemText: string; checkType: string;
  targetTab: string | null;
  requirementType: string; sortOrder: number; isActive: boolean;
  repeatType: string | null;
  repeatDays: number[] | null; specificDate?: string | null;
  isHighlight: boolean | null;
};

export default function TaskManagementPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const { user } = useAuth();
  const restaurantId = current?.id ?? 0;

  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [filterTab, setFilterTab] = useState<TargetTab | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // form state
  const [formText, setFormText] = useState("");
  const [formTargetTab, setFormTargetTab] = useState<TargetTab>("open");
  const [formRepeatType, setFormRepeatType] = useState<"daily" | "weekly" | "monthly">("daily");
  const [formRepeatDays, setFormRepeatDays] = useState<number[]>([]);
  const [formIsHighlight, setFormIsHighlight] = useState(false);
  const [formReqType, setFormReqType] = useState<"none" | "text_input" | "camera_photo">("none");

  const utils = trpc.useUtils();
  const { data: templates = [], isLoading } = trpc.storeChecklists.listAllTemplates.useQuery(
    { restaurantId, targetTab: filterTab ?? undefined },
    { enabled: restaurantId > 0 },
  );
  const createMut = trpc.storeChecklists.createTemplate.useMutation({
    onSuccess: () => { utils.storeChecklists.listAllTemplates.invalidate(); resetForm(); },
  });
  const updateMut = trpc.storeChecklists.updateTemplate.useMutation({
    onSuccess: () => { utils.storeChecklists.listAllTemplates.invalidate(); resetForm(); },
  });
  const deleteMut = trpc.storeChecklists.deleteTemplate.useMutation({
    onSuccess: () => { toast.success("삭제되었습니다"); utils.storeChecklists.listAllTemplates.invalidate(); },
    onError: (e: any) => { toast.error("삭제 실패: " + (e.message || "알 수 없는 오류")); },
  });

  const resetForm = () => {
    setFormText(""); setFormTargetTab("open");
    setFormRepeatType("daily"); setFormRepeatDays([]);
    setFormIsHighlight(false);
    setFormReqType("none"); setShowAdd(false); setEditId(null);
  };

  const startEdit = (t: Template) => {
    setEditId(t.id); setShowAdd(true);
    setFormText(t.itemText);
    setFormTargetTab((t.targetTab as TargetTab) ?? "open");
    setFormRepeatType(((t.repeatType === "none" || !t.repeatType) ? "daily" : t.repeatType) as any);
    setFormRepeatDays(t.repeatDays ?? []);
    setFormIsHighlight(t.isHighlight ?? false);
    setFormReqType((t.requirementType as any) ?? "none");
  };

  const handleSave = () => {
    if (!formText.trim()) return;
    const payload = {
      itemText: formText.trim(),
      targetTab: formTargetTab,
      repeatType: formRepeatType as any,
      repeatDays: (formRepeatType === "weekly" || formRepeatType === "monthly") ? formRepeatDays : [],
      isHighlight: formIsHighlight,
      requirementType: formReqType as any,
    };
    if (editId) {
      updateMut.mutate({ id: editId, restaurantId, ...payload });
    } else {
      createMut.mutate({ restaurantId, ...payload });
    }
  };

  // 필터링
  const filtered = useMemo(() => {
    return (templates as Template[]).sort((a, b) => a.sortOrder - b.sortOrder);
  }, [templates]);

  const tabLabel = (tab: string | null) =>
    TARGET_TABS.find(t => t.key === tab)?.label ?? tab ?? "미지정";

  if (!restaurantId) return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
          <ClipboardList className="w-5 h-5" /> 내 매장 업무관리
        </h1>
        <Button size="sm" onClick={() => { resetForm(); setShowAdd(true); }}>
          <Plus className="w-4 h-4 mr-1" /> 업무 추가
        </Button>
      </div>

      {/* 탭 필터 */}
      <div className="flex gap-1.5 overflow-x-auto">
        <button
          onClick={() => setFilterTab(null)}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${!filterTab ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:bg-accent"}`}
        >전체</button>
        {TARGET_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilterTab(filterTab === tab.key ? null : tab.key)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${filterTab === tab.key ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:bg-accent"}`}
          >{tab.label}</button>
        ))}
      </div>

      {/* 업무 목록 */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {filterTab ? "조건에 맞는 업무가 없습니다" : "등록된 업무가 없습니다"}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <div
              key={t.id}
              className={`bg-card border rounded-lg overflow-hidden transition-colors ${t.isHighlight ? "border-amber-400/50 bg-amber-50/30 dark:bg-amber-950/10" : "border-border"}`}
            >
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {t.isHighlight && <Star className="w-3.5 h-3.5 text-amber-500 shrink-0 fill-amber-500" />}
                    <span className="text-sm font-medium text-foreground">{t.itemText}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium">
                      {tabLabel(t.targetTab)}
                    </span>
                    {(t.repeatType === "daily" || !t.repeatType || t.repeatType === "none") && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 flex items-center gap-0.5">
                        <Repeat className="w-2.5 h-2.5" /> 매일
                      </span>
                    )}
                    {t.repeatType === "weekly" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 flex items-center gap-0.5">
                        <Repeat className="w-2.5 h-2.5" /> 주{(t.repeatDays ?? []).map(d => DAY_NAMES[d]).join("·")}
                      </span>
                    )}
                    {t.repeatType === "monthly" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 flex items-center gap-0.5">
                        <Calendar className="w-2.5 h-2.5" /> 매월 {(t.repeatDays ?? []).join("·")}일
                      </span>
                    )}
                  </div>
                </div>
                {expandedId === t.id ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
              </div>

              {expandedId === t.id && (
                <div className="px-4 pb-3 pt-0 border-t border-border/50 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    요구: {t.requirementType === "text_input" ? "텍스트입력" : t.requirementType === "camera_photo" ? "사진촬영" : "없음"}
                  </span>
                  <div className="flex-1" />
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => startEdit(t)}>
                    <Edit3 className="w-3 h-3 mr-1" /> 수정
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive"
                    disabled={deleteMut.isPending}
                    onClick={() => { if (confirm("이 업무를 삭제하시겠습니까?")) deleteMut.mutate({ id: t.id, restaurantId }); }}>
                    <Trash2 className="w-3 h-3 mr-1" /> {deleteMut.isPending ? "삭제 중..." : "삭제"}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 추가/수정 모달 */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={resetForm} />
          <div className="relative bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md mx-auto p-5 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">{editId ? "업무 수정" : "새 업무 추가"}</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resetForm}><X className="w-4 h-4" /></Button>
            </div>

            {/* 탭 (어느 탭에 표시할지) */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">표시 탭</label>
              <div className="flex gap-1.5">
                {TARGET_TABS.map(tab => (
                  <button key={tab.key} onClick={() => setFormTargetTab(tab.key)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${formTargetTab === tab.key ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
                  >{tab.label}</button>
                ))}
              </div>
            </div>

            {/* 업무명 */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">업무 내용</label>
              <input className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" placeholder="예: 냉장고 온도 확인" value={formText} onChange={e => setFormText(e.target.value)} />
            </div>

            {/* 반복 설정 */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">반복 유형</label>
              <div className="flex gap-1.5 flex-wrap">
                {([
                  { key: "daily", label: "매일" },
                  { key: "weekly", label: "주간" },
                  { key: "monthly", label: "월간" },
                ] as const).map(rt => (
                  <button key={rt.key} onClick={() => {
                    setFormRepeatType(rt.key);
                    if (rt.key === "daily") setFormRepeatDays([]);
                  }}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${formRepeatType === rt.key ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
                  >{rt.label}</button>
                ))}
              </div>
              {formRepeatType === "weekly" && (
                <div className="mt-2">
                  <p className="text-[10px] text-muted-foreground mb-1">반복 요일 선택</p>
                  <div className="flex gap-1.5">
                    {DAY_NAMES.map((name, i) => (
                      <button key={i} onClick={() => setFormRepeatDays(prev => prev.includes(i) ? prev.filter(d => d !== i) : [...prev, i])}
                        className={`w-8 h-8 rounded-full text-xs font-medium border transition-colors ${formRepeatDays.includes(i) ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
                      >{name}</button>
                    ))}
                  </div>
                </div>
              )}
              {formRepeatType === "monthly" && (
                <div className="mt-2">
                  <p className="text-[10px] text-muted-foreground mb-1">반복 날짜 선택 (매월)</p>
                  <div className="flex gap-1 flex-wrap">
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                      <button key={day} onClick={() => setFormRepeatDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b))}
                        className={`w-8 h-8 rounded text-xs font-medium border transition-colors ${formRepeatDays.includes(day) ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
                      >{day}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 강조 & 요구사항 */}
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={formIsHighlight} onChange={e => setFormIsHighlight(e.target.checked)} className="rounded" />
                <Star className="w-3.5 h-3.5 text-amber-500" /> 강조 표시
              </label>
              <select className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background"
                value={formReqType} onChange={e => setFormReqType(e.target.value as any)}>
                <option value="none">요구사항 없음</option>
                <option value="text_input">텍스트 입력</option>
                <option value="camera_photo">사진 촬영</option>
              </select>
            </div>

            {/* 저장 */}
            <Button className="w-full" onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
              {editId ? "수정 완료" : "업무 추가"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
