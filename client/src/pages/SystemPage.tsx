import { useState } from "react";
import { trpc } from "../lib/trpc";
import { Card, StatCard, PageHeader } from "@/components/ui/compat";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@shared/permissions";
import {
  AlertTriangle, Monitor, User, Store, Calendar, ChevronDown, ChevronUp,
  Users, Shield, Clock, UserCheck, Database, TrendingUp, DollarSign, ChevronRight,
  Activity, CheckCircle2, AlertCircle, Server,
} from "lucide-react";

// ─── 상수 ───────────────────────────────────────────────────────────────────
const ERROR_TYPE_LABELS: Record<string, string> = {
  client: "클라이언트", api: "API", render: "렌더링", network: "네트워크",
};
const ERROR_TYPE_COLORS: Record<string, string> = {
  client: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  api: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  render: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  network: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};
const fmtShort = (n: number) => {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
  return n.toLocaleString("ko-KR");
};

// ═══════════════════════════════════════════════════════════════════════════════
// 메인: 시스템 관리 (3탭)
// ═══════════════════════════════════════════════════════════════════════════════

type Tab = "status" | "errors" | "errorList";

export default function SystemPage() {
  const [tab, setTab] = useState<Tab>("status");

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Monitor className="w-5 h-5" /> 시스템 관리
        </h1>
        <div className="flex gap-1">
          {([
            { key: "status", label: "시스템 현황" },
            { key: "errors", label: "에러 개요" },
            { key: "errorList", label: "에러 목록" },
          ] as { key: Tab; label: string }[]).map(t => (
            <Button
              key={t.key}
              variant={tab === t.key ? "default" : "outline"}
              size="sm"
              className="text-xs"
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {tab === "status" && <SystemStatusTab />}
      {tab === "errors" && <ErrorOverviewTab />}
      {tab === "errorList" && <ErrorListTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 탭1: 시스템 현황 (기존 MasterDashboard 내용)
// ═══════════════════════════════════════════════════════════════════════════════

function SystemStatusTab() {
  const today = new Date();
  const [year] = useState(today.getFullYear());
  const [month] = useState(today.getMonth() + 1);

  const { data: sysStatus, isLoading: loadingSys } = trpc.admin.systemStatus.useQuery();
  const { data: bizSummary, isLoading: loadingBiz } = trpc.admin.multiStoreMonthlySummary.useQuery({ year, month });
  const { data: notifications } = trpc.notifications.listMine.useQuery({ limit: 5 });

  if (loadingSys || loadingBiz) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[1,2,3,4].map(i => <div key={i} className="h-20 bg-muted rounded-lg" />)}</div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{[1,2].map(i => <div key={i} className="h-48 bg-muted rounded-lg" />)}</div>
      </div>
    );
  }

  const u = sysStatus?.users;
  const s = sysStatus?.stores;
  const biz = bizSummary?.totals;

  return (
    <>
      {/* 시스템 KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<Users size={14} />} label="전체 사용자" value={String(u?.total ?? 0)} unit="명" trend={{ value: u?.active ?? 0, label: "활성" }} />
        <StatCard icon={<Store size={14} />} label="매장" value={String(s?.active ?? 0)} unit="개" trend={s?.archived ? { value: -(s.archived), label: "아카이브" } : undefined} />
        <StatCard icon={<DollarSign size={14} />} label="이번 달 총매출" value={fmtShort(biz?.salesTotal ?? 0)} unit="원" />
        <StatCard icon={<TrendingUp size={14} />} label="영업이익률" value={(biz?.profitRate ?? 0).toFixed(1)} unit="%" className={(biz?.profit ?? 0) >= 0 ? "border-emerald-500/20" : "border-red-500/20"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 역할별 분포 */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
            <Shield size={14} className="text-primary" /> 역할별 사용자 분포
          </h3>
          <div className="space-y-3">
            <RoleRow label="대표 (admin)" count={u?.admins ?? 0} color="bg-blue-500" total={u?.total ?? 1} />
            <RoleRow label="점장 (owner)" count={u?.managers ?? 0} color="bg-emerald-500" total={u?.total ?? 1} />
            <RoleRow label="직원 (staff)" count={u?.employees ?? 0} color="bg-slate-500" total={u?.total ?? 1} />
          </div>
        </Card>

        {/* 최근 접속 */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
            <Clock size={14} className="text-primary" /> 최근 접속 사용자
          </h3>
          <div className="space-y-2">
            {(sysStatus?.recentLogins ?? []).map((login: any) => (
              <div key={login.id} className="flex items-center justify-between p-2.5 rounded-lg border border-border">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                    <UserCheck size={12} className="text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{login.name}</p>
                    <p className="text-xs text-muted-foreground">{ROLE_LABELS[login.role] ?? login.role}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {login.lastSignedIn
                    ? new Date(login.lastSignedIn).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                    : "—"}
                </p>
              </div>
            ))}
            {(!sysStatus?.recentLogins || sysStatus.recentLogins.length === 0) && (
              <p className="text-xs text-muted-foreground text-center py-4">접속 기록이 없습니다</p>
            )}
          </div>
        </Card>
      </div>

      {/* 매장별 현황 + 알림 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
              <Database size={14} className="text-primary" /> 매장별 현황
            </h3>
            <div className="space-y-2">
              {(bizSummary?.stores ?? []).map((store: any) => {
                const staffCount = sysStatus?.storeStaffCounts?.find((sc: any) => sc.restaurantId === store.restaurantId)?.count ?? 0;
                return (
                  <div key={store.restaurantId} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent/30 transition-all">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-2 h-8 rounded-full ${store.isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{store.restaurantName}</p>
                        <p className="text-xs text-muted-foreground">직원 {staffCount}명 · 일마감 {store.closedDays}/{store.daysInMonth}일</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-sm font-semibold text-foreground tabular-nums">{fmtShort(store.salesTotal)}원</p>
                      <p className={`text-xs tabular-nums ${store.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                        {store.profit >= 0 ? "+" : ""}{store.profitRate.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                );
              })}
              {(!bizSummary?.stores || bizSummary.stores.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-6">등록된 매장이 없습니다</p>
              )}
            </div>
          </Card>
        </div>

        <div>
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Activity size={14} className="text-primary" /> 시스템 알림
            </h3>
            <div className="space-y-2">
              {(notifications ?? []).slice(0, 5).map((n: any) => (
                <div key={n.id} className={`p-2.5 rounded-lg border text-sm ${!n.isRead ? "border-primary/20 bg-primary/5" : "border-border"}`}>
                  <div className="flex items-start gap-2">
                    {n.type === "cost_exceeded"
                      ? <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                      : <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground truncate">{n.title}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {new Date(n.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              {(!notifications || notifications.length === 0) && (
                <p className="text-xs text-muted-foreground text-center py-6">알림 없음</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 탭2: 에러 개요
// ═══════════════════════════════════════════════════════════════════════════════

function ErrorOverviewTab() {
  const [days, setDays] = useState(7);

  const summary = trpc.errorLogs.recentSummary.useQuery();
  const byRestaurant = trpc.errorLogs.summaryByRestaurant.useQuery({ days });
  const byUser = trpc.errorLogs.summaryByUser.useQuery({ days });
  const trend = trpc.errorLogs.dailyTrend.useQuery({ days: 14 });

  const maxTrend = Math.max(...(trend.data?.map((d: any) => d.count) ?? [1]));

  return (
    <>
      {/* 요약 */}
      <div className="grid grid-cols-3 gap-2">
        <ErrorStatCard label="24시간" value={summary.data?.last24h ?? 0} />
        <ErrorStatCard label="7일" value={summary.data?.last7d ?? 0} />
        <ErrorStatCard label="유형" value={summary.data?.byType?.length ?? 0} sub="종류" />
      </div>

      {/* 유형별 분포 */}
      {summary.data?.byType && summary.data.byType.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> 유형별 (최근 7일)
          </h3>
          <div className="flex gap-2 flex-wrap">
            {summary.data.byType.map((t: any) => (
              <span key={t.errorType} className={`text-xs px-2 py-1 rounded-full font-medium ${ERROR_TYPE_COLORS[t.errorType] ?? "bg-muted text-muted-foreground"}`}>
                {ERROR_TYPE_LABELS[t.errorType] ?? t.errorType} {t.count}건
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
              const dateStr = String(d.date).slice(5);
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-muted-foreground tabular-nums">{d.count}</span>
                  <div className="w-full bg-red-400/70 dark:bg-red-500/50 rounded-t transition-all" style={{ height: `${h}%` }} title={`${d.date}: ${d.count}건`} />
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
          <Button key={d} variant={days === d ? "default" : "outline"} size="sm" className="h-7 text-xs" onClick={() => setDays(d)}>
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
                  <span className="text-xs text-muted-foreground">마지막: {r.lastError ? fmtDate(r.lastError) : "-"}</span>
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
                  <span className="text-xs text-muted-foreground">마지막: {u.lastError ? fmtDate(u.lastError) : "-"}</span>
                  <span className="text-sm font-bold text-red-500 tabular-nums">{u.count}건</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 탭3: 에러 목록
// ═══════════════════════════════════════════════════════════════════════════════

function ErrorListTab() {
  const [listOffset, setListOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const LIMIT = 30;

  const errorList = trpc.errorLogs.list.useQuery({ limit: LIMIT, offset: listOffset });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">
          전체 에러 로그 ({errorList.data?.total ?? 0}건)
        </h3>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={listOffset === 0}
            onClick={() => setListOffset(Math.max(0, listOffset - LIMIT))}>이전</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={(errorList.data?.rows.length ?? 0) < LIMIT}
            onClick={() => setListOffset(listOffset + LIMIT)}>다음</Button>
        </div>
      </div>

      <div className="space-y-1">
        {errorList.data?.rows.map((e: any) => (
          <div key={e.id} className="border border-border/50 rounded-lg overflow-hidden">
            <button
              className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-muted/30 transition-colors"
              onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
            >
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${ERROR_TYPE_COLORS[e.errorType] ?? "bg-muted text-muted-foreground"}`}>
                {ERROR_TYPE_LABELS[e.errorType] ?? e.errorType}
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
                  <pre className="text-[10px] text-muted-foreground bg-muted/40 p-2 rounded overflow-x-auto max-h-40 whitespace-pre-wrap break-all">{e.stack}</pre>
                )}
                {e.metadata && (
                  <pre className="text-[10px] text-muted-foreground bg-muted/40 p-2 rounded overflow-x-auto max-h-24 whitespace-pre-wrap break-all">{JSON.stringify(e.metadata, null, 2)}</pre>
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
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 공용 하위 컴포넌트
// ═══════════════════════════════════════════════════════════════════════════════

function RoleRow({ label, count, color, total }: { label: string; count: number; color: string; total: number }) {
  const pct = total > 0 ? (count / total * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground tabular-nums">{count}명</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  );
}

function ErrorStatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
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
