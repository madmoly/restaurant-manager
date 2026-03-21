import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, Circle, Sparkles, ClipboardList, CheckSquare, Save } from "lucide-react";
import { cn } from "@/lib/utils";

type CheckType = "open" | "order" | "cleaning";

const CHECK_TYPE_CONFIG: Record<CheckType, { label: string; icon: React.ReactNode; color: string; bgColor: string }> = {
  open:     { label: "오픈 체크리스트",   icon: <Sparkles className="h-4 w-4" />,      color: "text-emerald-400", bgColor: "bg-emerald-500/10 border-emerald-500/20" },
  order:    { label: "발주 체크리스트",   icon: <ClipboardList className="h-4 w-4" />, color: "text-blue-400",    bgColor: "bg-blue-500/10 border-blue-500/20" },
  cleaning: { label: "청소 체크리스트",   icon: <CheckSquare className="h-4 w-4" />,   color: "text-amber-400",   bgColor: "bg-amber-500/10 border-amber-500/20" },
};

interface DailyChecklistCardProps {
  restaurantId: number;
  checkType: CheckType;
  todayStr: string;
  noOrderToday?: boolean;
}

export default function DailyChecklistCard({ restaurantId, checkType, todayStr, noOrderToday }: DailyChecklistCardProps) {
  const utils = trpc.useUtils();
  const cfg = CHECK_TYPE_CONFIG[checkType];

  // 템플릿 목록 조회
  const templatesQuery = trpc.storeChecklists.list.useQuery(
    { restaurantId, checkType },
    { enabled: restaurantId > 0 }
  );

  // 오늘 체크 기록 조회
  const logQuery = trpc.storeChecklists.getDailyLog.useQuery(
    { restaurantId, logDate: todayStr, checkType },
    { enabled: restaurantId > 0 }
  );

  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [saved, setSaved] = useState(false);

  // 기존 기록이 있으면 불러오기
  useEffect(() => {
    if (logQuery.data?.checkedItemIds) {
      const ids = logQuery.data.checkedItemIds as number[];
      setCheckedIds(new Set(ids));
      setSaved(true);
    }
  }, [logQuery.data]);

  const saveMutation = trpc.storeChecklists.saveDailyLog.useMutation({
    onSuccess: () => {
      utils.storeChecklists.getDailyLog.invalidate();
      setSaved(true);
      toast.success("체크리스트가 저장되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });

  const templates = templatesQuery.data ?? [];

  if (templates.length === 0) return null;

  const toggleItem = (id: number) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSaved(false);
  };

  const allChecked = templates.length > 0 && templates.every(t => checkedIds.has(t.id));
  const checkedCount = templates.filter(t => checkedIds.has(t.id)).length;

  const handleSave = () => {
    saveMutation.mutate({
      restaurantId,
      logDate: todayStr,
      checkType,
      checkedItemIds: Array.from(checkedIds),
      noOrderToday: noOrderToday ?? false,
    });
  };

  // 발주 체크에서 오늘 발주 없음 선택 시
  if (checkType === "order" && noOrderToday) {
    return (
      <div className={cn("rounded-lg border p-3 flex items-center gap-2 text-sm", cfg.bgColor)}>
        <span className={cfg.color}>{cfg.icon}</span>
        <span className={cn("font-medium", cfg.color)}>오늘 발주 없음 — 체크리스트 생략</span>
      </div>
    );
  }

  return (
    <Card className={cn("border", allChecked ? "border-emerald-500/30" : "border-border/60")}>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <span className={cfg.color}>{cfg.icon}</span>
          <span>{cfg.label}</span>
          <Badge
            variant="outline"
            className={cn("ml-auto text-xs", allChecked ? "border-emerald-500/40 text-emerald-400" : "border-border")}
          >
            {checkedCount}/{templates.length}
          </Badge>
          {allChecked && (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" />완료
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-2">
        {templates.map(item => (
          <button
            key={item.id}
            onClick={() => toggleItem(item.id)}
            className={cn(
              "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors text-left",
              checkedIds.has(item.id)
                ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                : "bg-muted/30 text-foreground/80 border border-transparent hover:bg-muted/50"
            )}
          >
            {checkedIds.has(item.id)
              ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" />
            }
            <span>{item.itemText}</span>
          </button>
        ))}
        <Button
          size="sm"
          variant={saved ? "outline" : "default"}
          className={cn("w-full mt-1 gap-1.5 text-xs h-8", saved && "text-emerald-400 border-emerald-500/30")}
          onClick={handleSave}
          disabled={saveMutation.isPending}
        >
          <Save className="h-3 w-3" />
          {saved ? "저장됨 (재저장)" : "체크 저장"}
        </Button>
      </CardContent>
    </Card>
  );
}
