import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatKoreanDate } from "@/lib/utils";
import { X, Bug, Lightbulb, ChevronDown } from "lucide-react";

type StatusFilter = "all" | "pending" | "reviewed" | "resolved";

const STATUS_LABELS: Record<string, string> = {
  pending: "접수됨",
  reviewed: "검토중",
  resolved: "완료",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
  reviewed: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  resolved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
};

const TYPE_LABELS: Record<string, string> = {
  bug: "오류",
  suggestion: "건의",
};

export default function FeedbackListPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<number | null>(null);

  const { data, isLoading, refetch } = trpc.feedback.list.useQuery({
    status: statusFilter,
    limit: 100,
    offset: 0,
  });

  const updateStatus = trpc.feedback.updateStatus.useMutation({
    onSuccess: () => refetch(),
  });

  const rows = data ?? [];
  const selectedItem = rows.find((r) => r.id === selected);

  return (
    <div className="px-4 md:px-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-foreground">피드백 / 버그 제보</h1>
        <p className="text-sm text-muted-foreground mt-0.5">사용자가 제출한 피드백 목록</p>
      </div>

      {/* 상태 필터 */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(["all", "pending", "reviewed", "resolved"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-lg border transition-all",
              statusFilter === s
                ? "bg-primary/10 text-primary border-primary/30"
                : "border-border text-muted-foreground hover:bg-accent/50"
            )}
          >
            {s === "all" ? "전체" : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="flex gap-4">
        {/* 목록 */}
        <div className="flex-1 min-w-0 space-y-2">
          {isLoading && (
            <p className="text-sm text-muted-foreground py-8 text-center">불러오는 중...</p>
          )}
          {!isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">피드백이 없습니다</p>
          )}
          {rows.map((row) => (
            <div
              key={row.id}
              onClick={() => setSelected(row.id === selected ? null : row.id)}
              className={cn(
                "p-3 rounded-xl border cursor-pointer transition-all",
                selected === row.id
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-card hover:border-border/80 hover:bg-accent/30"
              )}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-muted-foreground">
                  {row.type === "bug" ? (
                    <Bug className="h-3.5 w-3.5 text-destructive/70" />
                  ) : (
                    <Lightbulb className="h-3.5 w-3.5 text-primary/70" />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                      {TYPE_LABELS[row.type] ?? row.type}
                    </span>
                    <Badge className={cn("text-[10px] px-1.5 py-0 h-4 border font-medium", STATUS_COLORS[row.status] ?? "")}>
                      {STATUS_LABELS[row.status] ?? row.status}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                      {formatKoreanDate(row.createdAt, "withTime")}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-foreground mt-1 truncate">{row.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {row.userName ?? row.username ?? "알 수 없음"}
                    {row.restaurantName && <> · {row.restaurantName}</>}
                  </p>
                </div>
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", selected === row.id && "rotate-180")} />
              </div>
            </div>
          ))}
        </div>

        {/* 상세 드로어 */}
        {selectedItem && (
          <div className="w-[340px] shrink-0 rounded-xl border border-border bg-card p-4 space-y-3 sticky top-4 self-start max-h-[calc(100vh-160px)] overflow-y-auto">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {selectedItem.type === "bug" ? (
                  <Bug className="h-4 w-4 text-destructive/70 shrink-0" />
                ) : (
                  <Lightbulb className="h-4 w-4 text-primary/70 shrink-0" />
                )}
                <span className="text-[11px] text-muted-foreground font-medium">
                  {TYPE_LABELS[selectedItem.type]}
                </span>
              </div>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <p className="text-sm font-semibold text-foreground">{selectedItem.title}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {selectedItem.userName ?? selectedItem.username}
                {selectedItem.restaurantName && <> · {selectedItem.restaurantName}</>}
                {" · "}{formatKoreanDate(selectedItem.createdAt, "withTime")}
              </p>
            </div>

            <div className="text-sm text-foreground whitespace-pre-wrap bg-muted/40 rounded-lg p-3 leading-relaxed">
              {selectedItem.content}
            </div>

            {selectedItem.screenshotBase64 && (
              <div>
                <p className="text-[11px] text-muted-foreground font-medium mb-1.5">첨부 스크린샷</p>
                <img
                  src={selectedItem.screenshotBase64}
                  alt="스크린샷"
                  className="w-full rounded-lg border border-border"
                />
              </div>
            )}

            {/* 상태 변경 */}
            <div>
              <p className="text-[11px] text-muted-foreground font-medium mb-2">상태 변경</p>
              <div className="flex gap-1.5 flex-wrap">
                {(["pending", "reviewed", "resolved"] as const).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={selectedItem.status === s ? "default" : "outline"}
                    className="text-xs h-7 px-2"
                    disabled={updateStatus.isPending}
                    onClick={() => updateStatus.mutate({ id: selectedItem.id, status: s })}
                  >
                    {STATUS_LABELS[s]}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
