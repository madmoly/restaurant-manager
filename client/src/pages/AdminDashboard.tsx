import { useState, useEffect } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import AppLayout from "@/components/AppLayout";
import KpiCard from "@/components/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Store, Users, TrendingUp, DollarSign, ShoppingCart, BarChart3, ArrowRight, AlertTriangle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

function fmt(n: number) { return n.toLocaleString("ko-KR") + "원"; }

export default function AdminDashboard() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [initialMonthSet, setInitialMonthSet] = useState(false);

  const restaurantsQuery = trpc.restaurants.listAll.useQuery();

  // 전체 매장 중 첫 번째 매장의 최신 데이터 월 조회
  const firstRestaurantId = restaurantsQuery.data?.[0]?.id;
  const latestMonthQuery = trpc.sales.latestMonth.useQuery(
    { restaurantId: firstRestaurantId! },
    { enabled: !!firstRestaurantId && !initialMonthSet }
  );

  useEffect(() => {
    if (latestMonthQuery.data && !initialMonthSet) {
      setYear(latestMonthQuery.data.year);
      setMonth(latestMonthQuery.data.month);
      setInitialMonthSet(true);
    }
  }, [latestMonthQuery.data, initialMonthSet]);

  const profitQuery = trpc.profitability.allRestaurants.useQuery({ year, month });
  const usersQuery = trpc.users.list.useQuery();
  const notifQuery = trpc.notifications.list.useQuery();

  const data = profitQuery.data ?? [];
  const totalSales = data.reduce((s, r) => s + r.salesTotal, 0);
  const totalCost = data.reduce((s, r) => s + r.totalCost, 0);
  const totalProfit = data.reduce((s, r) => s + r.profit, 0);
  const totalLabor = data.reduce((s, r) => s + r.laborCost, 0);
  const avgCostRatio = data.length > 0 ? data.reduce((s, r) => s + r.costRatio, 0) / data.length : 0;

  const recentNotifs = (notifQuery.data ?? []).slice(0, 5);

  const chartData = data.map(r => ({
    name: r.name.length > 6 ? r.name.slice(0, 6) + "…" : r.name,
    매출: r.salesTotal,
    비용: r.totalCost,
    이익: r.profit,
  }));

  return (
    <AppLayout title="전체 총괄 대시보드" subtitle={`${year}년 ${month}월 기준`}>
      <div className="p-4 lg:p-6 space-y-6">
        {/* 기간 선택 */}
        <div className="flex items-center gap-2">
          <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
            <SelectTrigger className="w-24 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[2024, 2025, 2026].map(y => <SelectItem key={y} value={String(y)}>{y}년</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
            <SelectTrigger className="w-20 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <SelectItem key={m} value={String(m)}>{m}월</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* KPI 카드 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            title="전체 매출"
            value={fmt(totalSales)}
            icon={<DollarSign className="h-5 w-5" />}
            variant="default"
          />
          <KpiCard
            title="전체 이익"
            value={fmt(totalProfit)}
            icon={<TrendingUp className="h-5 w-5" />}
            variant={totalProfit >= 0 ? "success" : "danger"}
          />
          <KpiCard
            title="전체 비용"
            value={fmt(totalCost)}
            icon={<ShoppingCart className="h-5 w-5" />}
            variant="warning"
          />
          <KpiCard
            title="평균 비용율"
            value={`${avgCostRatio.toFixed(1)}%`}
            icon={<BarChart3 className="h-5 w-5" />}
            variant={avgCostRatio > 80 ? "danger" : avgCostRatio > 70 ? "warning" : "success"}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 매장별 성과 차트 */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">매장별 매출/비용/이익</CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 8%)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => (v / 10000).toFixed(0) + "만"} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="매출" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="비용" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="이익" fill="#10b981" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">
                  데이터가 없습니다
                </div>
              )}
            </CardContent>
          </Card>

          {/* 최근 알림 */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">최근 알림</CardTitle>
                <Link href="/notifications">
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                    전체 <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {recentNotifs.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">알림이 없습니다</p>
              ) : recentNotifs.map(n => (
                <div key={n.id} className={cn("flex items-start gap-2 p-2 rounded-lg text-xs", !n.isRead ? "bg-primary/10 border border-primary/20" : "bg-muted/30")}>
                  {n.type === "cost_exceeded" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" /> :
                   n.type === "target_achieved" ? <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" /> :
                   <AlertTriangle className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />}
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{n.title}</p>
                    {n.content && <p className="text-muted-foreground truncate">{n.content}</p>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* 매장별 상세 테이블 */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">매장별 상세 현황</CardTitle>
              <div className="flex gap-2">
                <Link href="/restaurants">
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                    <Store className="h-3 w-3" /> 매장 관리
                  </Button>
                </Link>
                <Link href="/users">
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                    <Users className="h-3 w-3" /> 사용자 관리
                  </Button>
                </Link>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-2 text-xs font-medium text-muted-foreground">매장명</th>
                    <th className="text-right py-2 px-2 text-xs font-medium text-muted-foreground">매출</th>
                    <th className="text-right py-2 px-2 text-xs font-medium text-muted-foreground">매입</th>
                    <th className="text-right py-2 px-2 text-xs font-medium text-muted-foreground">고정비</th>
                    <th className="text-right py-2 px-2 text-xs font-medium text-muted-foreground">인건비</th>
                    <th className="text-right py-2 px-2 text-xs font-medium text-muted-foreground">이익</th>
                    <th className="text-right py-2 px-2 text-xs font-medium text-muted-foreground">비용율</th>
                  </tr>
                </thead>
                <tbody>
                  {data.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-muted-foreground text-xs">데이터가 없습니다</td></tr>
                  ) : data.map(r => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 px-2 font-medium">{r.name}</td>
                      <td className="py-2.5 px-2 text-right text-primary font-medium">{fmt(r.salesTotal)}</td>
                      <td className="py-2.5 px-2 text-right text-amber-400">{fmt(r.purchasesTotal)}</td>
                      <td className="py-2.5 px-2 text-right text-orange-400">{fmt(r.fixedCostsTotal)}</td>
                      <td className="py-2.5 px-2 text-right text-purple-400">{fmt(r.laborCost)}</td>
                      <td className={cn("py-2.5 px-2 text-right font-semibold", r.profit >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {r.profit >= 0 ? "+" : ""}{fmt(r.profit)}
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <Badge className={cn("text-xs border",
                          r.costRatio > 90 ? "bg-red-500/20 text-red-400 border-red-500/30" :
                          r.costRatio > 80 ? "bg-amber-500/20 text-amber-400 border-amber-500/30" :
                          "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                        )}>
                          {r.costRatio.toFixed(1)}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {data.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30">
                      <td className="py-2.5 px-2 font-bold text-xs">합계</td>
                      <td className="py-2.5 px-2 text-right font-bold text-primary text-xs">{fmt(totalSales)}</td>
                      <td className="py-2.5 px-2 text-right font-bold text-amber-400 text-xs">{fmt(data.reduce((s, r) => s + r.purchasesTotal, 0))}</td>
                      <td className="py-2.5 px-2 text-right font-bold text-orange-400 text-xs">{fmt(data.reduce((s, r) => s + r.fixedCostsTotal, 0))}</td>
                      <td className="py-2.5 px-2 text-right font-bold text-purple-400 text-xs">{fmt(totalLabor)}</td>
                      <td className={cn("py-2.5 px-2 text-right font-bold text-xs", totalProfit >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {totalProfit >= 0 ? "+" : ""}{fmt(totalProfit)}
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <Badge className={cn("text-xs border",
                          avgCostRatio > 90 ? "bg-red-500/20 text-red-400 border-red-500/30" :
                          avgCostRatio > 80 ? "bg-amber-500/20 text-amber-400 border-amber-500/30" :
                          "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                        )}>
                          {avgCostRatio.toFixed(1)}%
                        </Badge>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
