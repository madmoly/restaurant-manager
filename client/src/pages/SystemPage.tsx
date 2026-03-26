import { useState } from "react";
import { trpc } from "../lib/trpc";
import { Card } from "@/components/ui/compat";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Monitor, User, Store, Calendar, ChevronDown, ChevronUp } from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  client: "클라이언트",
  api: "API",
  render: "렌더링",
  network: "네트워크",
};

const TYPE_COLORS: Record<string, string> = {
  client: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  api: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  render: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  network: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

export default function SystemPage() {
  const [days, setDays] = useState(7);
  const [tab, setTab] = useState<"overview" | "list">("overview");
  const [listOffset, setListOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const LIMIT = 30;

  const summary = trpc.errorLogs.recentSummary.useQuery();
  const byRestaurant = trpc.errorLogs.summaryByRestaurant.useQuery({ days });
  const byUser = trpc.errorLogs.summaryByUser.useQuery({ days });
  const trend = trpc.errorLogs.dailyTrend.useQuery({ days: 14 });
  const errorList = trpc.errorLogs.list.useQuery(
    { limit: LIMIT, offset: listOffset },
    { enabled: tab === "list" },
  );

  const maxTrend = Math.max(...(trend.data?.map(d => d.count) ?? [1]));

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Monitor className="w-5 h-5" /> 시스템 관리
        </h1>
        <div className="flex gap-1">
          <Button
            variant={tab === "overview" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("overview")}
          >
            개요
          </Button>
          <Button
            variant={tab === "list" ? "default" : "outline"}
            size="sm"
            onClick={() => { setTab("list"); setListOffset(0); }}
          >
            에러 목록
          </Button>
        </div>
      </div>

      {tab === "overview" && (
        <>
          {/* 요약 카드 */}
          <div className="grid grid-cols-3 gap-2">
            <StatCard label="24시간" value={summary.data?.last24h ?? 0} />
            <StatCard label="7일" value={summary.data?.last7d ?? 0} />
            <StatCard
              label="유형"
              value={summary.data?.byType?.length ?? 0}
              sub="종류"
            />
          </div>

          {/* 유형별 분포 */}
          {summary.data?.byType && summary.data.byType.length > 0 && (
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> 유형별 (최근 7일)
              </h3>
              <div className="flex gap-2 flex-wrap">
                {summary.data.byType.map((t: any) => (
                  <span
                    key={t.errorType}
                    className={`text-xs px-2 py-1 rounded-full font-medium ${TYPE_COLORS[t.errorType] ?? "bg-muted text-muted-foreground"}`}
                  >
                    {TYPE_LABELS[t.errorType] ?? t.errorType} {t.count}건
                  </span>
                ))}
              </div>
            </Card>
          )}

          {/* 일별 추이 */}
          {trend.data && trend.data.length > 0 && (
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" /> 일별 에러 추이 (14일)
              </h3>
              <div className="flex items-end gap-1 h-20">
                {trend.data.map((d: any) => {
                  const h = Math.max((d.count / maxTrend) * 100, 4);
                  const dateStr = String(d.date).slice(5); // MM-DD
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5">
                      <span className="text-[9px] text-muted-foreground tabular-nums">{d.count}</span>
                      <div
                        className="w-full bg-red-400/70 dark:bg-red-500/50 rounded-t transition-all"
                        style={{ height: `${h}%` }}
                        title={`${d.date}: ${d.count}건`}
                      />
                      <span className="text-[8px] text-muted-foreground/60 tabular-nums">{dateStr}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* 기간 선택 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">집계 기간:</span>
            {[7, 14, 30].map(d => (
              <Button
                key={d}
                variant={days === d ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setDays(d)}
              >
                {d}일
              </Button>
            ))}
          </div>

          {/* 매장별 */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5" /> 매장별 에러 ({days}일)
            </h3>
            {byRestaurant.data?.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">에러 없음</p>
            ) : (
              <div className="space-y-1.5">
                {byRestaurant.data?.map((r: any) => (
                  <div key={r.restaurantId ?? "null"} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                    <span className="text-sm text-foreground">{r.restaurantName ?? "미지정"}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        마지막: {r.lastError ? fmtDate(r.lastError) : "-"}
                      </span>
                      <span className="text-sm font-bold text-red-500 tabular-nums">{r.count}건</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* 사용자별 */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" /> 사용자별 에러 ({days}일)
            </h3>
            {byUser.data?.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">에러 없음</p>
            ) : (
              <div className="space-y-1.5">
                {byUser.data?.map((u: any) => (
                  <div key={u.userId ?? "null"} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                    <span className="text-sm text-foreground">{u.userName ?? u.username ?? "비로그인"}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        마지막: {u.lastError ? fmtDate(u.lastError) : "-"}
                      </span>
                      <span className="text-sm font-bold text-red-500 tabular-nums">{u.count}건</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {tab === "list" && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">
              전체 에러 로그 ({errorList.data?.total ?? 0}건)
            </h3>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={listOffset === 0}
                onClick={() => setListOffset(Math.max(0, listOffset - LIMIT))}
              >
                이전
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={(errorList.data?.rows.length ?? 0) < LIMIT}
                onClick={() => setListOffset(listOffset + LIMIT)}
              >
                다음
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            {errorList.data?.rows.map((e: any) => (
              <div key={e.id} className="border border-border/50 rounded-lg overflow-hidden">
                <button
                  className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                >
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${TYPE_COLORS[e.errorType] ?? "bg-muted text-muted-foreground"}`}>
                    {TYPE_LABELS[e.errorType] ?? e.errorType}
                  </span>
                  <span className="text-xs text-foreground truncate flex-1">{e.message}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{fmtDateTime(e.createdAt)}</span>
                  {expandedId === e.id ? <ChevronUp className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
                </button>
                {expandedId === e.id && (
                  <div className="px-3 py-2 border-t border-border/30 bg-muted/20 text-xs space-y-1.5">
                    <div className="flex gap-4 text-muted-foreground">
                      <span>ID: {e.id}</span>
                      <span>User: {e.userId ?? "-"}</span>
                      <span>매장: {e.restaurantId ?? "-"}</span>
                    </div>
                    {e.url && <p className="text-muted-foreground truncate">URL: {e.url}</p>}
                    {e.stack && (
                      <pre className="text-[10px] text-muted-foreground bg-muted/40 p-2 rounded overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
                        {e.stack}
                      </pre>
                    )}
                    {e.metadata && (
                      <pre className="text-[10px] text-muted-foreground bg-muted/40 p-2 rounded overflow-x-auto max-h-24 whitespace-pre-wrap break-all">
                        {JSON.stringify(e.metadata, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
            {errorList.data?.rows.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">에러 로그가 없습니다</p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card className="p-3 text-center">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-bold text-foreground tabular-nums">
        {value}<span className="text-xs text-muted-foreground ml-0.5">{sub ?? "건"}</span>
      </p>
    </Card>
  );
}

function fmtDate(d: string | Date) {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function fmtDateTime(d: string | Date) {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
