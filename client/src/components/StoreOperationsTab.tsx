import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Clock, TimerOff, Plus, Trash2, GripVertical, CheckSquare, ClipboardList, Sparkles
} from "lucide-react";

type CheckType = "open" | "order" | "cleaning";

const CHECK_TYPE_CONFIG: Record<CheckType, { label: string; icon: React.ReactNode; color: string }> = {
  open:     { label: "오픈 체크리스트",   icon: <Sparkles className="h-4 w-4" />,      color: "text-emerald-400" },
  order:    { label: "발주 체크리스트",   icon: <ClipboardList className="h-4 w-4" />, color: "text-blue-400" },
  cleaning: { label: "청소 체크리스트",   icon: <CheckSquare className="h-4 w-4" />,   color: "text-amber-400" },
};

interface StoreOperationsTabProps {
  restaurantId: number;
  salesInputStartTime: string;
  salesInputEndTime: string;
  onSalesTimeChange: (start: string, end: string) => void;
  onSalesTimeSave: () => void;
  isSaving: boolean;
}

export default function StoreOperationsTab({
  restaurantId,
  salesInputStartTime,
  salesInputEndTime,
  onSalesTimeChange,
  onSalesTimeSave,
  isSaving,
}: StoreOperationsTabProps) {
  const utils = trpc.useUtils();
  const [activeCheckType, setActiveCheckType] = useState<CheckType>("open");
  const [newItemText, setNewItemText] = useState("");

  const templatesQuery = trpc.storeChecklists.listAll.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 }
  );

  const createMutation = trpc.storeChecklists.create.useMutation({
    onSuccess: () => {
      utils.storeChecklists.listAll.invalidate();
      utils.storeChecklists.list.invalidate();
      setNewItemText("");
      toast.success("항목이 추가되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.storeChecklists.delete.useMutation({
    onSuccess: () => {
      utils.storeChecklists.listAll.invalidate();
      utils.storeChecklists.list.invalidate();
      toast.success("항목이 삭제되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });

  const templates = templatesQuery.data ?? [];
  const filteredTemplates = templates.filter(t => t.checkType === activeCheckType && t.isActive);

  const handleAddItem = () => {
    if (!newItemText.trim()) return;
    createMutation.mutate({
      restaurantId,
      checkType: activeCheckType,
      itemText: newItemText.trim(),
      sortOrder: filteredTemplates.length,
    });
  };

  return (
    <div className="space-y-5">
      {/* ── 매출 입력 허용 시간 ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-border/60 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <TimerOff className="h-4 w-4 text-amber-400" />
          <span className="text-xs font-semibold">매출 입력 허용 시간</span>
          <span className="text-xs text-muted-foreground">(비워두면 제한 없음)</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">시작 시간</Label>
            <Input
              type="time"
              className="mt-1 h-9 text-sm"
              value={salesInputStartTime}
              onChange={e => onSalesTimeChange(e.target.value, salesInputEndTime)}
            />
          </div>
          <div>
            <Label className="text-xs">종료 시간</Label>
            <Input
              type="time"
              className="mt-1 h-9 text-sm"
              value={salesInputEndTime}
              onChange={e => onSalesTimeChange(salesInputStartTime, e.target.value)}
            />
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="w-full h-8 text-xs gap-1"
          onClick={onSalesTimeSave}
          disabled={isSaving}
        >
          <Clock className="h-3 w-3" /> 시간 설정 저장
        </Button>
      </div>

      {/* ── 체크리스트 유형 탭 ──────────────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground mb-2">업무 체크리스트 관리</div>
        <div className="flex gap-1 mb-3">
          {(["open", "order", "cleaning"] as CheckType[]).map(type => {
            const cfg = CHECK_TYPE_CONFIG[type];
            return (
              <button
                key={type}
                onClick={() => setActiveCheckType(type)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  activeCheckType === type
                    ? "bg-primary/20 text-primary border border-primary/40"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted/60 border border-transparent"
                }`}
              >
                <span className={activeCheckType === type ? cfg.color : ""}>{cfg.icon}</span>
                {cfg.label}
                <Badge variant="outline" className="ml-0.5 h-4 px-1 text-[10px]">
                  {templates.filter(t => t.checkType === type && t.isActive).length}
                </Badge>
              </button>
            );
          })}
        </div>

        {/* 현재 선택된 체크리스트 항목 목록 */}
        <div className="rounded-lg border border-border/60 p-3 space-y-2 min-h-[120px]">
          {templatesQuery.isLoading ? (
            <div className="text-xs text-muted-foreground text-center py-4">로딩 중...</div>
          ) : filteredTemplates.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              등록된 항목이 없습니다. 아래에서 추가하세요.
            </div>
          ) : (
            filteredTemplates.map((item, idx) => (
              <div key={item.id} className="flex items-center gap-2 group">
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                <span className="text-xs flex-1 text-foreground/90">{idx + 1}. {item.itemText}</span>
                <button
                  onClick={() => deleteMutation.mutate({ id: item.id })}
                  disabled={deleteMutation.isPending}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/20 text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* 새 항목 추가 */}
        <div className="flex gap-2 mt-2">
          <Input
            placeholder={`${CHECK_TYPE_CONFIG[activeCheckType].label} 항목 입력...`}
            value={newItemText}
            onChange={e => setNewItemText(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAddItem()}
            className="h-8 text-xs flex-1"
          />
          <Button
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={handleAddItem}
            disabled={createMutation.isPending || !newItemText.trim()}
          >
            <Plus className="h-3 w-3" /> 추가
          </Button>
        </div>
      </div>
    </div>
  );
}
