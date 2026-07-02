import { useState, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { useAuth } from "../hooks/useAuth";
import {
  TrendingUp, BarChart3, Filter, Store, Wallet,
  ArrowUpDown,
} from "lucide-react";
import { Card, PageHeader } from "@/components/ui/compat";
import { DashboardSkeleton } from "@/components/ui/skeletons";
import { Checkbox } from "@/components/ui/checkbox";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { formatKRW, formatCompactKRW, formatPercent, cn } from "@/lib/utils";

const LINE_COLORS = ["#4f46e5", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#8b5cf6", "#ef4444", "#84cc16"];

type ViewMode = "store" | "group";
type SortKey = "salesTotal" | "profit" | "profitRate" | "laborRatio" | "costRatio" | "closingRate";

export default function StoreAnalysisPage() {
  const { user } = useAuth();
  const isMaster = user?.role === "master";
  const today = new Date();

  // ─── 공통 컨트롤 ────────────────────────────────────────────────────────
  const [endYear, setEndYear] = useState(today.getFullYear());
  const [endMonth, setEndMonth] = useState(today.getMonth() + 1);
  const [months, setMonths] = useState<6 | 12>(6);
  const [selectedGroup, setSelectedGroup] = useState<string>("전체");
  const [manualSelectedIds, setManualSelectedIds] = useState<Set<number> | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("store");
  const [sortKey, setSortKey] = useState<SortKey>("salesTotal");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [pieStoreId, setPieStoreId] = useState<number | null>(null);

  const goPrevMonth = () => {
    if (endMonth === 1) { setEndYear((y) => y - 1); setEndMonth(12); }
    else setEndMonth((m) => m - 1);
  };
  const goNextMonth = () => {
    if (endMonth === 12) { setEndYear((y) => y + 1); setEndMonth(1); }
    else setEndMonth((m) => m + 1);
  };

  // ─── 데이터 조회 ────────────────────────────────────────────────────────
  const { data: trends, isLoading: loadingTrends } =
    trpc.analysis.storeTrends.useQuery({ endYear, endMonth, months });
  const { data: targetData, isLoading: loadingTarget } =
    trpc.analysis.targetAttainment.useQuery({ year: endYear, month: endMonth });
  const { data: healthData, isLoading: loadingHealth } =
    trpc.analysis.operationalHealth.useQuery({ year: endYear, month: endMonth });

  const isLoading = loadingTrends || loadingTarget || loadingHealth;

  // ─── 매장 디렉토리 (이름/그룹명) ────────────────────────────────────────
  const storeDirectory = useMemo(() => {
    const map = new Map<number, { name: string; groupName: string | null }>();
    for (const s of targetData ?? []) {
      map.set(s.restaurantId, { name: s.restaurantName, groupName: s.groupName });
    }
    return map;
  }, [targetData]);

  const groupNames = useMemo(() => {
    if (!isMaster) return [];
    const names = new Set<string>();
    for (const [, info] of storeDirectory) names.add(info.groupName ?? "미배정");
    return Array.from(names);
  }, [isMaster, storeDirectory]);

  const availableStores = useMemo(() => {
    return Array.from(storeDirectory.entries())
      .filter(([, info]) => !isMaster || selectedGroup === "전체" || (info.groupName ?? "미배정") === selectedGroup)
      .map(([id, info]) => ({ id, ...info }));
  }, [storeDirectory, isMaster, selectedGroup]);

  const selectedIds = useMemo(() => {
    if (manualSelectedIds) {
      const availSet = new Set(availableStores.map((s) => s.id));
      return new Set([...manualSelectedIds].filter((id) => availSet.has(id)));
    }
    return new Set(availableStores.map((s) => s.id));
  }, [manualSelectedIds, availableStores]);

  const toggleStore = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setManualSelectedIds(next);
  };

  const selectGroup = (gn: string) => {
    setSelectedGroup(gn);
    setManualSelectedIds(null);
  };

  // ─── ① 월별 추이 데이터 가공 ────────────────────────────────────────────
  const isMobile = typeof window !== "undefined" && window.innerWidth < 1024;
  const forceCombined = viewMode === "store" && selectedIds.size > 3 && isMobile;

  const trendSeriesKeys = useMemo(() => {
    if (!trends) return [];
    if (viewMode === "group") return groupNames.length > 0 ? groupNames : ["전체"];
    if (forceCombined) return ["선택 매장 합계"];
    return availableStores.filter((s) => selectedIds.has(s.id)).map((s) => s.name);
  }, [trends, viewMode, groupNames, forceCombined, availableStores, selectedIds]);

  const trendChartData = useMemo(() => {
    if (!trends) return { sales: [], profitRate: [] };
    const salesRows: any[] = [];
    const profitRows: any[] = [];

    for (const m of trends.months) {
      const label = `${String(m.year).slice(2)}/${m.month}`;
      const salesRow: any = { label };
      const laborRow: any = { label };
      const denomAgg: Record<string, { sales: number; profit: number; confirmed: boolean }> = {};

      const relevantStores = m.stores.filter((s) => selectedIds.has(s.restaurantId));

      if (viewMode === "group") {
        for (const s of relevantStores) {
          const key = s.groupName ?? "미배정";
          if (!denomAgg[key]) denomAgg[key] = { sales: 0, profit: 0, confirmed: true };
          denomAgg[key].sales += s.salesTotal;
          denomAgg[key].profit += s.profit;
          denomAgg[key].confirmed = denomAgg[key].confirmed && s.confirmed;
        }
      } else if (forceCombined) {
        const key = "선택 매장 합계";
        denomAgg[key] = { sales: 0, profit: 0, confirmed: true };
        for (const s of relevantStores) {
          denomAgg[key].sales += s.salesTotal;
          denomAgg[key].profit += s.profit;
          denomAgg[key].confirmed = denomAgg[key].confirmed && s.confirmed;
        }
      } else {
        for (const s of relevantStores) {
          const key = storeDirectory.get(s.restaurantId)?.name ?? `#${s.restaurantId}`;
          denomAgg[key] = { sales: s.salesTotal, profit: s.profit, confirmed: s.confirmed };
        }
      }

      for (const [key, v] of Object.entries(denomAgg)) {
        salesRow[key] = v.confirmed ? v.sales : null;
        laborRow[key] = v.confirmed ? (v.sales > 0 ? (v.profit / v.sales * 100) : 0) : null;
      }
      salesRow.__anyUnconfirmed = Object.values(denomAgg).some((v) => !v.confirmed);
      salesRows.push(salesRow);
      profitRows.push({ ...laborRow, __anyUnconfirmed: salesRow.__anyUnconfirmed });
    }
    return { sales: salesRows, profitRate: profitRows };
  }, [trends, viewMode, forceCombined, selectedIds, storeDirectory]);

  // 월별 합계 미니 테이블
  const monthlyTotals = useMemo(() => {
    if (!trends) return [];
    return trends.months.map((m) => {
      const relevant = m.stores.filter((s) => selectedIds.has(s.restaurantId));
      const anyUnconfirmed = relevant.some((s) => !s.confirmed);
      const sum = relevant.reduce((acc, s) => ({
        salesTotal: acc.salesTotal + s.salesTotal,
        purchasesTotal: acc.purchasesTotal + s.purchasesTotal,
        laborCost: acc.laborCost + s.laborCost,
        fixedCostTotal: acc.fixedCostTotal + s.fixedCostTotal,
        expensesTotal: acc.expensesTotal + s.expensesTotal,
        profit: acc.profit + s.profit,
      }), { salesTotal: 0, purchasesTotal: 0, laborCost: 0, fixedCostTotal: 0, expensesTotal: 0, profit: 0 });
      return {
        year: m.year, month: m.month, anyUnconfirmed,
        ...sum,
        profitRate: sum.salesTotal > 0 ? (sum.profit / sum.salesTotal * 100) : 0,
      };
    });
  }, [trends, selectedIds]);

  // ─── ③ 매장간 비교/랭킹 ──────────────────────────────────────────────
  const currentMonthTrend = trends?.months[trends.months.length - 1];

  const rankingRows = useMemo(() => {
    if (!currentMonthTrend) return [];
    const healthByStore = new Map((healthData ?? []).map((h) => [h.restaurantId, h]));
    const targetByStore = new Map((targetData ?? []).map((t) => [t.restaurantId, t]));

    const storeRows = currentMonthTrend.stores
      .filter((s) => selectedIds.has(s.restaurantId))
      .map((s) => {
        const dir = storeDirectory.get(s.restaurantId);
        const health = healthByStore.get(s.restaurantId);
        const target = targetByStore.get(s.restaurantId);
        return {
          key: String(s.restaurantId),
          name: dir?.name ?? `#${s.restaurantId}`,
          groupName: dir?.groupName ?? "미배정",
          salesTotal: s.salesTotal,
          profit: s.profit,
          profitRate: s.profitRate,
          laborRatio: target?.laborRatio ?? 0,
          costRatio: target?.costRatio ?? 0,
          closingRate: health?.closingRate ?? 0,
          confirmed: s.confirmed,
        };
      });

    if (viewMode !== "group") return storeRows;

    const byGroup = new Map<string, typeof storeRows>();
    for (const r of storeRows) {
      if (!byGroup.has(r.groupName)) byGroup.set(r.groupName, []);
      byGroup.get(r.groupName)!.push(r);
    }
    return Array.from(byGroup.entries()).map(([gn, rows]) => {
      const salesTotal = rows.reduce((a, r) => a + r.salesTotal, 0);
      const profit = rows.reduce((a, r) => a + r.profit, 0);
      const laborCostSum = rows.reduce((a, r) => a + (r.laborRatio / 100) * r.salesTotal, 0);
      const costSum = rows.reduce((a, r) => a + (r.costRatio / 100) * r.salesTotal, 0);
      const closingRateAvg = rows.length > 0 ? rows.reduce((a, r) => a + r.closingRate, 0) / rows.length : 0;
      return {
        key: gn,
        name: gn,
        groupName: gn,
        salesTotal,
        profit,
        profitRate: salesTotal > 0 ? (profit / salesTotal * 100) : 0,
        laborRatio: salesTotal > 0 ? (laborCostSum / salesTotal * 100) : 0,
        costRatio: salesTotal > 0 ? (costSum / salesTotal * 100) : 0,
        closingRate: closingRateAvg,
        confirmed: rows.every((r) => r.confirmed),
      };
    });
  }, [currentMonthTrend, selectedIds, storeDirectory, healthData, targetData, viewMode]);

  const medianProfitRate = useMemo(() => {
    if (rankingRows.length === 0) return 0;
    const sorted = [...rankingRows].map((r) => r.profitRate).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }, [rankingRows]);

  const sortedRankingRows = useMemo(() => {
    const rows = [...rankingRows];
    rows.sort((a, b) => (a[sortKey] - b[sortKey]) * (sortDir === "asc" ? 1 : -1));
    return rows;
  }, [rankingRows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  // 비용 구성비 파이 (선택 매장 기준, 미선택 시 필터된 전체 합)
  const pieData = useMemo(() => {
    if (!currentMonthTrend) return [];
    const target = pieStoreId != null
      ? currentMonthTrend.stores.find((s) => s.restaurantId === pieStoreId)
      : null;
    const source = target ?? currentMonthTrend.stores
      .filter((s) => selectedIds.has(s.restaurantId))
      .reduce((acc, s) => ({
        restaurantId: -1, groupName: null, confirmed: true,
        salesTotal: acc.salesTotal + s.salesTotal,
        purchasesTotal: acc.purchasesTotal + s.purchasesTotal,
        laborCost: acc.laborCost + s.laborCost,
        fixedCostTotal: acc.fixedCostTotal + s.fixedCostTotal,
        expensesTotal: acc.expensesTotal + s.expensesTotal,
        profit: 0, profitRate: 0,
      }), { restaurantId: -1, groupName: null, confirmed: true, salesTotal: 0, purchasesTotal: 0, laborCost: 0, fixedCostTotal: 0, expensesTotal: 0, profit: 0, profitRate: 0 });

    return [
      { name: "매입비", value: source.purchasesTotal, color: "#7c3aed" },
      { name: "인건비", value: source.laborCost, color: "#ec4899" },
      { name: "고정비", value: source.fixedCostTotal, color: "#f59e0b" },
      { name: "경비", value: source.expensesTotal, color: "#06b6d4" },
    ].filter((d) => d.value > 0);
  }, [currentMonthTrend, pieStoreId, selectedIds]);

  if (isLoading && !trends) return <DashboardSkeleton />;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="매장 분석" description="월별 추이 · 목표 대비 · 매장간 비교 · 운영 건전성" />

      {/* 공통 컨트롤 */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button onClick={goPrevMonth} className="px-2 py-1 rounded hover:bg-accent text-muted-foreground">◀</button>
            <span className="text-sm font-semibold text-foreground min-w-[100px] text-center">
              {endYear}년 {endMonth}월 기준
            </span>
            <button onClick={goNextMonth} className="px-2 py-1 rounded hover:bg-accent text-muted-foreground">▶</button>
          </div>
          <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
            {([6, 12] as const).map((mo) => (
              <button
                key={mo}
                onClick={() => setMonths(mo)}
                className={cn(
                  "text-xs px-3 py-1.5 rounded-md font-medium transition-colors",
                  months === mo ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                )}
              >
                {mo}개월
              </button>
            ))}
          </div>
          {isMaster && groupNames.length > 1 && (
            <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
              {(["store", "group"] as const).map((vm) => (
                <button
                  key={vm}
                  onClick={() => setViewMode(vm)}
                  className={cn(
                    "text-xs px-3 py-1.5 rounded-md font-medium transition-colors",
                    viewMode === vm ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                  )}
                >
                  {vm === "store" ? "매장별" : "그룹별"}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 사업그룹 필터 (master 전용) */}
        {isMaster && groupNames.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={14} className="text-muted-foreground shrink-0" />
            <button
              onClick={() => selectGroup("전체")}
              className={cn(
                "text-xs px-3 py-1.5 rounded-full border transition-colors",
                selectedGroup === "전체" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              전체
            </button>
            {groupNames.map((gn) => (
              <button
                key={gn}
                onClick={() => selectGroup(gn)}
                className={cn(
                  "text-xs px-3 py-1.5 rounded-full border transition-colors",
                  selectedGroup === gn ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-accent"
                )}
              >
                {gn}
              </button>
            ))}
          </div>
        )}

        {/* 매장 멀티셀렉트 */}
        {viewMode === "store" && (
          <div className="flex items-center gap-3 flex-wrap pt-1 border-t border-border/50">
            <Store size={14} className="text-muted-foreground shrink-0" />
            {availableStores.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                <Checkbox checked={selectedIds.has(s.id)} onCheckedChange={() => toggleStore(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        )}
      </Card>

      {/* ① 월별 추이 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-primary" />
            매출 추이
          </h3>
          {trendChartData.sales.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trendChartData.sales}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" className="text-xs" />
                <YAxis tickFormatter={(v) => formatCompactKRW(v)} className="text-xs" />
                <Tooltip
                  formatter={(value: number) => (value == null ? "미확정" : formatKRW(value))}
                  contentStyle={{ backgroundColor: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: "8px" }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {trendSeriesKeys.map((key, i) => (
                  <Line key={key} type="monotone" dataKey={key} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} connectNulls dot={{ r: 3 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">데이터가 없습니다</p>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
            <BarChart3 size={14} className="text-primary" />
            영업이익률 추이
          </h3>
          {trendChartData.profitRate.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trendChartData.profitRate}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" className="text-xs" />
                <YAxis tickFormatter={(v) => `${v}%`} className="text-xs" />
                <Tooltip
                  formatter={(value: number) => (value == null ? "미확정" : formatPercent(value))}
                  contentStyle={{ backgroundColor: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: "8px" }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {trendSeriesKeys.map((key, i) => (
                  <Line key={key} type="monotone" dataKey={key} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} connectNulls dot={{ r: 3 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">데이터가 없습니다</p>
          )}
        </Card>
      </div>

      {/* 월별 합계 미니 테이블 */}
      <Card className="p-5 overflow-x-auto">
        <h3 className="text-sm font-semibold text-foreground mb-3">월별 합계</h3>
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 px-3 font-medium">월</th>
              <th className="py-2 px-3 font-medium text-right">매출</th>
              <th className="py-2 px-3 font-medium text-right">매입</th>
              <th className="py-2 px-3 font-medium text-right">인건비</th>
              <th className="py-2 px-3 font-medium text-right">고정비</th>
              <th className="py-2 px-3 font-medium text-right">경비</th>
              <th className="py-2 px-3 font-medium text-right">이익</th>
              <th className="py-2 px-3 font-medium text-right">이익률</th>
            </tr>
          </thead>
          <tbody>
            {monthlyTotals.map((m) => (
              <tr key={`${m.year}-${m.month}`} className="border-b border-border/50">
                <td className="py-2 px-3 font-medium text-foreground">
                  {m.year}.{m.month}
                  {m.anyUnconfirmed && (
                    <span className="ml-1.5 text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full" title="월마감 미이행 매장 포함">
                      미확정 포함
                    </span>
                  )}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">{formatKRW(m.salesTotal)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{formatKRW(m.purchasesTotal)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{formatKRW(m.laborCost)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{formatKRW(m.fixedCostTotal)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{formatKRW(m.expensesTotal)}</td>
                <td className={cn("py-2 px-3 text-right font-semibold tabular-nums", m.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
                  {m.profit >= 0 ? "+" : ""}{formatKRW(m.profit)}
                </td>
                <td className={cn("py-2 px-3 text-right tabular-nums", m.profitRate >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
                  {formatPercent(m.profitRate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* ③ 매장간 비교/랭킹 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card className="p-5 overflow-x-auto">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
              <BarChart3 size={14} className="text-primary" />
              {viewMode === "group" ? "그룹간 비교" : "매장간 비교"} · {endYear}.{endMonth}
            </h3>

            {/* 데스크탑 테이블 */}
            <table className="w-full text-sm min-w-[560px] hidden md:table">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 px-3 font-medium">{viewMode === "group" ? "그룹" : "매장"}</th>
                  {([
                    ["salesTotal", "매출"], ["profit", "이익"], ["profitRate", "이익률"],
                    ["laborRatio", "인건비율"], ["costRatio", "매입비율"], ["closingRate", "일마감이행률"],
                  ] as [SortKey, string][]).map(([key, label]) => (
                    <th key={key} className="py-2 px-3 font-medium text-right cursor-pointer select-none" onClick={() => toggleSort(key)}>
                      <span className="inline-flex items-center gap-1 justify-end">
                        {label}
                        <ArrowUpDown size={10} className={cn(sortKey === key ? "text-primary" : "text-muted-foreground/40")} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRankingRows.map((r) => {
                  const isOutlier = r.profitRate <= medianProfitRate - 10;
                  const restaurantId = viewMode === "store" ? Number(r.key) : null;
                  return (
                    <tr
                      key={r.key}
                      onClick={() => restaurantId != null && setPieStoreId(restaurantId)}
                      className={cn(
                        "border-b border-border/50 transition-colors",
                        viewMode === "store" && "cursor-pointer hover:bg-accent/30",
                        pieStoreId === restaurantId && "bg-primary/5",
                        isOutlier && "bg-red-50 dark:bg-red-950/20"
                      )}
                    >
                      <td className="py-2.5 px-3 font-medium text-foreground">
                        {r.name}
                        {!r.confirmed && <span className="ml-1 text-[10px] text-muted-foreground">(미확정)</span>}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{formatKRW(r.salesTotal)}</td>
                      <td className={cn("py-2.5 px-3 text-right font-semibold tabular-nums", r.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
                        {r.profit >= 0 ? "+" : ""}{formatKRW(r.profit)}
                      </td>
                      <td className={cn("py-2.5 px-3 text-right tabular-nums", r.profitRate >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
                        {formatPercent(r.profitRate)}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{formatPercent(r.laborRatio)}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{formatPercent(r.costRatio)}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{formatPercent(r.closingRate, 0)}</td>
                    </tr>
                  );
                })}
                {sortedRankingRows.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">데이터가 없습니다</td></tr>
                )}
              </tbody>
            </table>

            {/* 모바일 카드 리스트 */}
            <div className="space-y-2 md:hidden">
              {sortedRankingRows.map((r) => {
                const isOutlier = r.profitRate <= medianProfitRate - 10;
                const restaurantId = viewMode === "store" ? Number(r.key) : null;
                return (
                  <div
                    key={r.key}
                    onClick={() => restaurantId != null && setPieStoreId(restaurantId)}
                    className={cn(
                      "p-3 rounded-lg border border-border",
                      isOutlier && "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{r.name}</span>
                      <span className={cn("text-sm font-semibold tabular-nums", r.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
                        {formatPercent(r.profitRate)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                      <span>매출 {formatCompactKRW(r.salesTotal)}원</span>
                      <span>인건비율 {formatPercent(r.laborRatio)}</span>
                      <span>매입비율 {formatPercent(r.costRatio)}</span>
                      <span>일마감 {formatPercent(r.closingRate, 0)}</span>
                    </div>
                  </div>
                );
              })}
              {sortedRankingRows.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">데이터가 없습니다</p>
              )}
            </div>
          </Card>
        </div>

        {/* 비용 구성비 */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
            <Wallet size={14} className="text-primary" />
            비용 구성비
            {pieStoreId != null && (
              <button onClick={() => setPieStoreId(null)} className="ml-auto text-[11px] text-primary hover:underline">
                전체 보기
              </button>
            )}
          </h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={45}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip formatter={(value: number) => formatKRW(value)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">데이터가 없습니다</p>
          )}
        </Card>
      </div>
    </div>
  );
}
