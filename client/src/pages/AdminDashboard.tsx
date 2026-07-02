import { useState, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { useAuth } from "../hooks/useAuth";
import { useLocation } from "wouter";
import {
  Store, Users, TrendingUp, TrendingDown, DollarSign, Package,
  AlertTriangle, CheckCircle, ClipboardCheck,
  Bell, ChevronRight, Building2, Filter, LineChart as LineChartIcon,
} from "lucide-react";
import { Card, StatCard, PageHeader } from "@/components/ui/compat";
import { DashboardSkeleton } from "@/components/ui/skeletons";
import { formatKoreanDate } from "@/lib/utils";

// ─── 포맷 헬퍼 ─────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString("ko-KR");
const fmtW = (n: number) => `${fmt(n)}원`;
const fmtShort = (n: number) => {
  if (n >= 100_000_000) return `${Math.round(n / 100_000_000)}억원`;
  if (n >= 10_000) return `${Math.round(n / 10_000)}만원`;
  return `${fmt(n)}원`;
};

// ─── 메인: 대표(admin) 대시보드 ──────────────────────────────────────────────
export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const isMaster = user?.role === "master";
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedGroup, setSelectedGroup] = useState<string>("전체");
  // 이전 달
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  // ─── 단일 집계 API (hooks 위반 없음) ───────────────────────────────────
  const { data: summary, isLoading: loadingSummary } =
    trpc.admin.multiStoreMonthlySummary.useQuery({ year, month });

  const { data: prevSummary } =
    trpc.admin.multiStoreMonthlySummary.useQuery({ year: prevYear, month: prevMonth });

  const { data: allUsers, isLoading: loadingU } = trpc.users.list.useQuery();
  const { data: notifications } = trpc.notifications.listMine.useQuery({ limit: 10 });

  // 영업일 기준: 새벽 3시 이전이면 전날
  const bizToday = new Date(today.getTime() - 3 * 60 * 60 * 1000);
  const todayStr = `${bizToday.getFullYear()}-${String(bizToday.getMonth() + 1).padStart(2, "0")}-${String(bizToday.getDate()).padStart(2, "0")}`;
  const { data: todayStatuses } = trpc.admin.allStoresTodayStatus.useQuery({ date: todayStr });

  // ─── 사업그룹 필터 (master 전용) ──────────────────────────────────────
  const groupNames = useMemo(() => {
    if (!isMaster || !summary?.stores) return [];
    const names = new Set<string>();
    for (const s of summary.stores) {
      names.add((s as any).groupName ?? "미배정");
    }
    return Array.from(names);
  }, [isMaster, summary?.stores]);

  // 필터된 매장 데이터
  const filteredStores = useMemo(() => {
    if (!summary?.stores) return [];
    if (!isMaster || selectedGroup === "전체") return summary.stores;
    return summary.stores.filter((s) =>
      ((s as any).groupName ?? "미배정") === selectedGroup
    );
  }, [summary?.stores, isMaster, selectedGroup]);

  const filteredTodayStatuses = useMemo(() => {
    if (!todayStatuses) return [];
    if (!isMaster || selectedGroup === "전체") return todayStatuses;
    return todayStatuses.filter((s: any) =>
      (s.groupName ?? "미배정") === selectedGroup
    );
  }, [todayStatuses, isMaster, selectedGroup]);

  // ─── 집계 (필터된 매장 기준) ──────────────────────────────────────────
  const isLoading = loadingSummary || loadingU;

  const filteredTotals = useMemo(() => {
    const stores = filteredStores;
    const salesTotal = stores.reduce((a, s) => a + s.salesTotal, 0);
    const purchasesTotal = stores.reduce((a, s) => a + s.purchasesTotal, 0);
    const laborCost = stores.reduce((a, s) => a + s.laborCost, 0);
    const fixedCostTotal = stores.reduce((a, s) => a + s.fixedCostTotal, 0);
    const expensesTotal = stores.reduce((a, s) => a + ((s as any).expensesTotal ?? 0), 0);
    const profit = stores.reduce((a, s) => a + s.profit, 0);
    return {
      salesTotal, purchasesTotal, laborCost, fixedCostTotal, expensesTotal, profit,
      profitRate: salesTotal > 0 ? (profit / salesTotal * 100) : 0,
      costRatio: salesTotal > 0 ? (purchasesTotal / salesTotal * 100) : 0,
      laborRatio: salesTotal > 0 ? (laborCost / salesTotal * 100) : 0,
      fixedRatio: salesTotal > 0 ? (fixedCostTotal / salesTotal * 100) : 0,
      expenseRatio: salesTotal > 0 ? (expensesTotal / salesTotal * 100) : 0,
      storeCount: stores.length,
    };
  }, [filteredStores]);

  const totalSales = filteredTotals.salesTotal;
  const totalPurchases = filteredTotals.purchasesTotal;
  const totalLabor = filteredTotals.laborCost;
  const totalFixed = filteredTotals.fixedCostTotal;
  const totalExpenses = filteredTotals.expensesTotal;
  const totalProfit = filteredTotals.profit;
  const profitRate = filteredTotals.profitRate;
  const storeCount = filteredTotals.storeCount;

  const prevTotalSales = prevSummary?.totals?.salesTotal ?? 0;
  const salesGrowth = prevTotalSales > 0 ? ((totalSales - prevTotalSales) / prevTotalSales * 100) : 0;

  // 월 이동
  const goPrev = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const goNext = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };
  // 알림
  const recentNotifs = (notifications ?? []).slice(0, 5);
  const unreadCount = recentNotifs.filter((n: any) => !n.isRead).length;

  if (isLoading) return <DashboardSkeleton />;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <PageHeader
          title="사업 현황"
          description={`${storeCount}개 매장 · ${allUsers?.length ?? 0}명 사용자 · 오늘 ${todayStr.slice(5).replace("-", "/")}`}
        />
        <div className="flex items-center gap-2">
          <button onClick={goPrev} className="px-2 py-1 rounded hover:bg-accent text-muted-foreground">◀</button>
          <span className="text-sm font-semibold text-foreground min-w-[100px] text-center">
            {year}년 {month}월
          </span>
          <button onClick={goNext} className="px-2 py-1 rounded hover:bg-accent text-muted-foreground">▶</button>
          <button
            onClick={() => setLocation("/store-analysis")}
            className="ml-1 flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border border-primary/30 text-primary hover:bg-primary/5 transition-colors"
          >
            <LineChartIcon size={12} />
            상세 분석
            <ChevronRight size={12} />
          </button>
        </div>
      </div>

      {/* 사업그룹 필터 (master 전용) */}
      {isMaster && groupNames.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={14} className="text-muted-foreground shrink-0" />
          <button
            onClick={() => setSelectedGroup("전체")}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              selectedGroup === "전체"
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            전체
          </button>
          {groupNames.map((gn) => (
            <button
              key={gn}
              onClick={() => setSelectedGroup(gn)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                selectedGroup === gn
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {gn}
            </button>
          ))}
        </div>
      )}

      {/* 전체 매장 금일 현황 */}
      {filteredTodayStatuses && filteredTodayStatuses.length > 0 && (
        <Card className="p-5 ring-1 ring-primary/20 bg-primary/[0.02]">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
            <ClipboardCheck size={14} className="text-primary" />
            {selectedGroup === "전체" ? "전체 매장" : selectedGroup} 금일 현황
            <span className="inline-flex items-center gap-1 ml-1">
              <span className="text-xs font-medium text-primary">{todayStr.slice(5).replace("-", "/")}</span>
              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">오늘</span>
            </span>
          </h3>
          <div className="space-y-2">
            {filteredTodayStatuses.map((s: any) => (
              <div key={s.restaurantId} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/50">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Store size={14} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {s.name}
                      {isMaster && selectedGroup === "전체" && s.groupName && (
                        <span className="text-[10px] text-muted-foreground ml-1.5 font-normal">({s.groupName})</span>
                      )}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${s.isOpenChecked ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                        {s.isOpenChecked ? '오픈✓' : '오픈✗'}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${s.isCloseDone ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                        {s.isCloseDone ? '마감✓' : '미마감'}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{s.staffCount}명 출근</span>
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  {s.midSalesTotal > 0 ? (
                    <>
                      <p className="text-sm font-semibold text-foreground tabular-nums">{fmtShort(s.midSalesTotal)}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {s.midSalesReceipts > 0 && `${s.midSalesReceipts}건 · `}
                        {s.lastMidSalesTime && new Date(s.lastMidSalesTime).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </>
                  ) : s.isCloseDone && s.closingTotal != null ? (
                    <p className="text-sm font-semibold text-foreground tabular-nums">{fmtShort(s.closingTotal)}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">매출 미입력</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* KPI 카드 4개 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<DollarSign size={14} />}
          label="총 매출"
          value={fmtShort(totalSales)}
          unit="원"          trend={prevTotalSales > 0 ? { value: Math.round(salesGrowth * 10) / 10, label: "전월 대비" } : undefined}
        />
        <StatCard
          icon={<Package size={14} />}
          label="총 매입"
          value={fmtShort(totalPurchases)}
          unit="원"
        />
        <StatCard
          icon={<Users size={14} />}
          label="총 인건비"
          value={fmtShort(totalLabor)}
          unit="원"
        />
        <StatCard
          icon={<TrendingUp size={14} />}
          label="영업이익률"
          value={profitRate.toFixed(1)}
          unit="%"
          trend={{ value: Math.round(profitRate * 10) / 10 }}
          className={totalProfit >= 0 ? "border-emerald-500/20" : "border-red-500/20"}
        />
      </div>

      {/* 영업이익 요약 카드 */}
      <Card className={`p-5 ${totalProfit >= 0 ? "border-emerald-200 dark:border-emerald-800" : "border-red-200 dark:border-red-800"}`}>
        <div className="flex items-center gap-2 mb-1">
          {totalProfit >= 0
            ? <TrendingUp size={16} className="text-emerald-600 dark:text-emerald-400" />
            : <TrendingDown size={16} className="text-red-600 dark:text-red-400" />          }
          <span className="text-sm font-medium text-muted-foreground">이번 달 전체 영업이익</span>
        </div>
        <p className={`text-3xl font-bold tabular-nums ${totalProfit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {totalProfit >= 0 ? "+" : ""}{fmt(totalProfit)}
          <span className="text-sm text-muted-foreground ml-1">원</span>
        </p>
        <div className="flex gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
          <span>매출 {fmtW(totalSales)}</span>
          <span>매입 {fmtW(totalPurchases)}</span>
          <span>인건비 {fmtW(totalLabor)}</span>
          <span>고정비 {fmtW(totalFixed)}</span>
          <span>경비 {fmtW(totalExpenses)}</span>
        </div>
        {/* 비율 바 */}
        {totalSales > 0 && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="flex items-center justify-between bg-muted/40 rounded px-2 py-1">
              <span className="text-muted-foreground">매입비율</span>
              <span className="font-medium text-foreground tabular-nums">{filteredTotals.costRatio.toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between bg-muted/40 rounded px-2 py-1">
              <span className="text-muted-foreground">인건비율</span>
              <span className="font-medium text-foreground tabular-nums">{filteredTotals.laborRatio.toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between bg-muted/40 rounded px-2 py-1">
              <span className="text-muted-foreground">고정비율</span>
              <span className="font-medium text-foreground tabular-nums">{filteredTotals.fixedRatio.toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between bg-muted/40 rounded px-2 py-1">
              <span className="text-muted-foreground">순이익률</span>
              <span className={`font-medium tabular-nums ${totalProfit >= 0 ? "text-emerald-600" : "text-red-500"}`}>{profitRate.toFixed(1)}%</span>
            </div>
          </div>
        )}
      </Card>

      {/* 매장 목록 + 알림 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 매장 현황 */}
        <div className="lg:col-span-2">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Store size={14} className="text-primary" />
                매장 현황
              </h3>
              <button
                onClick={() => setLocation("/restaurants")}                className="text-xs text-primary hover:underline flex items-center gap-0.5"
              >
                매장 관리 <ChevronRight size={12} />
              </button>
            </div>
            <div className="space-y-2">
              {filteredStores.map((s) => (
                <div
                  key={s.restaurantId}
                  className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-accent/30 cursor-pointer transition-all"
                  onClick={() => setLocation("/monthly-settlement")}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Store size={14} className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {s.restaurantName}
                        {isMaster && selectedGroup === "전체" && (s as any).groupName && (
                          <span className="text-[10px] text-muted-foreground ml-1.5 font-normal">({(s as any).groupName})</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{s.address || "—"}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-sm font-semibold text-foreground tabular-nums">{fmtShort(s.salesTotal)}</p>
                    <p className={`text-xs tabular-nums ${s.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                      {s.profit >= 0 ? "+" : ""}{s.profitRate.toFixed(1)}%
                    </p>
                  </div>
                </div>
              ))}
              {filteredStores.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">등록된 매장이 없습니다</p>
              )}            </div>
          </Card>
        </div>

        {/* 최근 알림 */}
        <div>
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Bell size={14} className="text-primary" />
                최근 알림
                {unreadCount > 0 && (
                  <span className="ml-1 text-xs bg-destructive/15 text-destructive px-1.5 py-0.5 rounded-full font-medium">
                    {unreadCount}
                  </span>
                )}
              </h3>
            </div>
            <div className="space-y-2">
              {recentNotifs.length > 0 ? recentNotifs.map((n: any) => (
                <div
                  key={n.id}
                  className={`p-2.5 rounded-lg border text-sm ${
                    !n.isRead ? "border-primary/20 bg-primary/5" : "border-border"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <NotifIcon type={n.type} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground truncate">{n.title}</p>                      {n.content && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.content}</p>}
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {formatKoreanDate(n.createdAt, "withTime")}
                      </p>
                    </div>
                  </div>
                </div>
              )) : (
                <p className="text-xs text-muted-foreground text-center py-6">알림이 없습니다</p>
              )}
            </div>
          </Card>
        </div>
      </div>

    </div>
  );
}

// ─── 알림 아이콘 ─────────────────────────────────────────────────────────────
function NotifIcon({ type }: { type: string }) {
  switch (type) {
    case "cost_exceeded":
      return <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />;
    case "target_achieved":
      return <CheckCircle size={14} className="text-emerald-500 shrink-0 mt-0.5" />;
    default:
      return <Bell size={14} className="text-muted-foreground shrink-0 mt-0.5" />;
  }
}
