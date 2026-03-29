import { useState, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { useLocation } from "wouter";
import {
  Store, Users, TrendingUp, TrendingDown, DollarSign, Package,
  AlertTriangle, CheckCircle, ClipboardCheck,
  Wallet, Receipt, Bell, ChevronRight, BarChart3,
} from "lucide-react";
import { Card, StatCard, PageHeader } from "@/components/ui/compat";
import { DashboardSkeleton } from "@/components/ui/skeletons";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";

// ─── 포맷 헬퍼 ─────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString("ko-KR");
const fmtW = (n: number) => `₩${fmt(n)}`;
const fmtShort = (n: number) => {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
  return fmt(n);
};

// ─── 메인: 대표(admin) 대시보드 ──────────────────────────────────────────────
export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
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

  const todayStr = today.toISOString().slice(0, 10);
  const { data: todayStatuses } = trpc.admin.allStoresTodayStatus.useQuery({ date: todayStr });

  // ─── 집계 ──────────────────────────────────────────────────────────────
  const isLoading = loadingSummary || loadingU;

  const t = summary?.totals;
  const totalSales = t?.salesTotal ?? 0;
  const totalPurchases = t?.purchasesTotal ?? 0;
  const totalLabor = t?.laborCost ?? 0;
  const totalFixed = t?.fixedCostTotal ?? 0;
  const totalProfit = t?.profit ?? 0;
  const profitRate = t?.profitRate ?? 0;
  const storeCount = t?.storeCount ?? 0;

  const prevTotalSales = prevSummary?.totals?.salesTotal ?? 0;
  const salesGrowth = prevTotalSales > 0 ? ((totalSales - prevTotalSales) / prevTotalSales * 100) : 0;
  // 매장별 매출 데이터 (차트용)
  const storeRevenueData = useMemo(() => {
    if (!summary?.stores) return [];
    return [...summary.stores]
      .sort((a, b) => b.salesTotal - a.salesTotal)
      .map((s) => ({
        name: s.restaurantName,
        매출: s.salesTotal,
        매입: s.purchasesTotal,
      }));
  }, [summary?.stores]);

  // 비용 구성 (파이 차트)
  const costBreakdown = useMemo(() => [
    { name: "매입비", value: totalPurchases, color: "#7c3aed" },
    { name: "인건비", value: totalLabor, color: "#ec4899" },
    { name: "고정비", value: totalFixed, color: "#f59e0b" },
  ].filter(d => d.value > 0), [totalPurchases, totalLabor, totalFixed]);

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
          description={`${storeCount}개 매장 · ${allUsers?.length ?? 0}명 사용자`}
        />
        <div className="flex items-center gap-2">
          <button onClick={goPrev} className="px-2 py-1 rounded hover:bg-accent text-muted-foreground">◀</button>
          <span className="text-sm font-semibold text-foreground min-w-[100px] text-center">
            {year}년 {month}월
          </span>
          <button onClick={goNext} className="px-2 py-1 rounded hover:bg-accent text-muted-foreground">▶</button>
        </div>
      </div>

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
          trend={{ value: totalProfit >= 0 ? Math.abs(profitRate) : -Math.abs(profitRate) }}
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
        </div>
      </Card>

      {/* 차트 영역 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 매장별 매출 비교 */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <BarChart3 size={14} className="text-primary" />
              매장별 매출 비교
            </h3>
          </div>
          {storeRevenueData.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(200, storeRevenueData.length * 40)}>
              <BarChart data={storeRevenueData} layout="vertical" margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" tickFormatter={(v) => fmtShort(v)} className="text-xs" />                <YAxis type="category" dataKey="name" width={80} className="text-xs" />
                <Tooltip
                  formatter={(value: number) => fmtW(value)}
                  contentStyle={{ backgroundColor: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: "8px" }}
                />
                <Bar dataKey="매출" fill="#4f46e5" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">매출 데이터가 없습니다</p>
          )}
        </Card>

        {/* 비용 구성비 */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Wallet size={14} className="text-primary" />
              비용 구성비
            </h3>
          </div>
          {costBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={costBreakdown}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"                  outerRadius={100}
                  innerRadius={50}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {costBreakdown.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => fmtW(value)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">비용 데이터가 없습니다</p>
          )}
        </Card>
      </div>

      {/* 전체 매장 금일 현황 */}
      {todayStatuses && todayStatuses.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
            <ClipboardCheck size={14} className="text-primary" />
            전체 매장 금일 현황
            <span className="text-xs font-normal text-muted-foreground ml-1">{todayStr}</span>
          </h3>
          <div className="space-y-2">
            {todayStatuses.map((s: any) => (
              <div key={s.restaurantId} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/50">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Store size={14} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
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
                      <p className="text-sm font-semibold text-foreground tabular-nums">{fmtShort(s.midSalesTotal)}원</p>
                      <p className="text-[10px] text-muted-foreground">
                        {s.midSalesReceipts > 0 && `${s.midSalesReceipts}건 · `}
                        {s.lastMidSalesTime && new Date(s.lastMidSalesTime).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </>
                  ) : s.isCloseDone && s.closingTotal != null ? (
                    <p className="text-sm font-semibold text-foreground tabular-nums">{fmtShort(s.closingTotal)}원</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">매출 미입력</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

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
              {(summary?.stores ?? []).map((s) => (
                <div
                  key={s.restaurantId}
                  className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-accent/30 cursor-pointer transition-all"
                  onClick={() => setLocation("/profitability")}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Store size={14} className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{s.restaurantName}</p>
                      <p className="text-xs text-muted-foreground truncate">{s.address || "—"}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-sm font-semibold text-foreground tabular-nums">{fmtShort(s.salesTotal)}원</p>
                    <p className={`text-xs tabular-nums ${s.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                      {s.profit >= 0 ? "+" : ""}{s.profitRate.toFixed(1)}%
                    </p>
                  </div>
                </div>
              ))}
              {(!summary?.stores || summary.stores.length === 0) && (
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
                        {new Date(n.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
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

      {/* 매장별 상세 테이블 (데스크탑) */}
      <Card className="p-5 hidden lg:block">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Receipt size={14} className="text-primary" />
          매장별 손익 상세
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 px-3 font-medium">매장</th>
                <th className="py-2 px-3 font-medium text-right">매출</th>
                <th className="py-2 px-3 font-medium text-right">매입</th>
                <th className="py-2 px-3 font-medium text-right">인건비</th>                <th className="py-2 px-3 font-medium text-right">고정비</th>
                <th className="py-2 px-3 font-medium text-right">영업이익</th>
                <th className="py-2 px-3 font-medium text-right">이익률</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.stores ?? []).map((s) => (
                <tr key={s.restaurantId} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                  <td className="py-2.5 px-3 font-medium text-foreground">{s.restaurantName}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{fmt(s.salesTotal)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{fmt(s.purchasesTotal)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{fmt(s.laborCost)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{fmt(s.fixedCostTotal)}</td>
                  <td className={`py-2.5 px-3 text-right font-semibold tabular-nums ${s.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                    {s.profit >= 0 ? "+" : ""}{fmt(s.profit)}
                  </td>
                  <td className={`py-2.5 px-3 text-right tabular-nums ${s.profitRate >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                    {s.profitRate.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
            {(summary?.stores?.length ?? 0) > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border font-semibold text-foreground">
                  <td className="py-2.5 px-3">합계</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{fmt(totalSales)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{fmt(totalPurchases)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{fmt(totalLabor)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{fmt(totalFixed)}</td>                  <td className={`py-2.5 px-3 text-right tabular-nums ${totalProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                    {totalProfit >= 0 ? "+" : ""}{fmt(totalProfit)}
                  </td>
                  <td className={`py-2.5 px-3 text-right tabular-nums ${profitRate >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                    {profitRate.toFixed(1)}%
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
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
