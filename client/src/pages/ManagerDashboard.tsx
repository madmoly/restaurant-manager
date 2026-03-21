import { useState, useEffect } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { todayKST, addDays, toKSTDateString } from "@/lib/dateKST";
import { useAuth } from "@/_core/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import KpiCard from "@/components/KpiCard";
import CostGauge from "@/components/CostGauge";
import QuickSalesModal from "@/components/QuickSalesModal";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { DollarSign, TrendingUp, ShoppingCart, Users, Calendar, ArrowRight, BarChart3, FileText, Zap, AlertTriangle, CheckCircle2, Clock, LockKeyhole, Unlock, Sparkles, ClipboardList, Package, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function fmt(n: number) { return n.toLocaleString("ko-KR") + "원"; }
function fmtDate(d: Date) { return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" }); }

export default function ManagerDashboard() {
  const { user } = useAuth();
  const now = new Date();
  const todayStr = todayKST();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [quickSalesOpen, setQuickSalesOpen] = useState(false);
  const [initialMonthSet, setInitialMonthSet] = useState(false);
  const [showDailyClose, setShowDailyClose] = useState(false);
  const [dailyCloseNote, setDailyCloseNote] = useState("");

  const { restaurants, selectedRestaurantId, selectedRestaurant } = useRestaurant();
  const activeRestaurantId = selectedRestaurantId;

  const storeRoleQuery = trpc.restaurants.getMyStoreRole.useQuery(
    { restaurantId: activeRestaurantId! },
    { enabled: !!activeRestaurantId && !!user }
  );
  const storeRole = storeRoleQuery.data;
  const canViewLaborCost = storeRole === "store_manager" || user?.role === "admin" || user?.role === "master";
  const isManager = storeRole === "store_manager" || storeRole === "manager" || user?.role === "admin" || user?.role === "master" || user?.role === "manager";

  const latestMonthQuery = trpc.sales.latestMonth.useQuery(
    { restaurantId: activeRestaurantId! },
    { enabled: !!activeRestaurantId && !initialMonthSet }
  );

  useEffect(() => {
    if (latestMonthQuery.data && !initialMonthSet) {
      setYear(latestMonthQuery.data.year);
      setMonth(latestMonthQuery.data.month);
      setInitialMonthSet(true);
    }
  }, [latestMonthQuery.data, initialMonthSet]);

  useEffect(() => {
    setInitialMonthSet(false);
  }, [activeRestaurantId]);

  const profitQuery = trpc.profitability.monthly.useQuery(
    { restaurantId: activeRestaurantId!, year, month },
    { enabled: !!activeRestaurantId, refetchInterval: 60000 }
  );
  const dailyQuery = trpc.profitability.daily.useQuery(
    { restaurantId: activeRestaurantId!, date: todayStr },
    { enabled: !!activeRestaurantId, refetchInterval: 60000 }
  );
  const todayScheduleQuery = trpc.schedules.listByRestaurantAndRange.useQuery(
    { restaurantId: activeRestaurantId!, startDate: todayStr, endDate: addDays(todayStr, 7) },
    { enabled: !!activeRestaurantId }
  );
  // 오늘 일마감 상태 조회
  const dailyClosingQuery = trpc.dailyClosings.get.useQuery(
    { restaurantId: activeRestaurantId!, date: todayStr },
    { enabled: !!activeRestaurantId && isManager }
  );
  // 오늘 체크리스트 완료 요약
  const checklistSummaryQuery = trpc.storeChecklists.getDailySummary.useQuery(
    { restaurantId: activeRestaurantId!, logDate: todayStr },
    { enabled: !!activeRestaurantId }
  );

  const utils = trpc.useUtils();
  const dailyCloseMutation = trpc.dailyClosings.close.useMutation({
    onSuccess: (data) => {
      toast.success("일마감이 완료되었습니다.");
      utils.dailyClosings.get.invalidate();
      utils.profitability.daily.invalidate();
      setShowDailyClose(false);
      setDailyCloseNote("");
    },
    onError: (e) => toast.error(e.message),
  });

  const tomorrowStr = addDays(todayStr, 1);

  const p = profitQuery.data;
  const d = dailyQuery.data;
  const dc = dailyClosingQuery.data;
  const activeRestaurant = selectedRestaurant;

  const pieData = p ? [
    { name: "매입비", value: p.purchasesTotal, color: "#d97706" },
    { name: "고정비", value: p.fixedCostsTotal, color: "#0ea5e9" },
    ...(canViewLaborCost ? [{ name: "인건비", value: p.laborCost, color: "#a78bfa" }] : []),
    { name: "순이익", value: Math.max(0, p.profit), color: "#34d399" },
  ].filter(i => i.value > 0) : [];

  const upcomingDates = Array.from({ length: 7 }, (_, i) => addDays(todayStr, i));

  const schedules = todayScheduleQuery.data ?? [];

  const quickMenuItems = [
    { label: "스케줄 관리", href: "/schedule", icon: <Calendar className="h-4 w-4" />, color: "text-blue-600" },
    { label: "직원 관리", href: "/staff", icon: <Users className="h-4 w-4" />, color: "text-green-600" },
    { label: "일일 운영", href: "/daily-ops", icon: <ShoppingCart className="h-4 w-4" />, color: "text-amber-600" },
    { label: "고정비 관리", href: "/fixed-costs", icon: <FileText className="h-4 w-4" />, color: "text-orange-600" },
    { label: "수익성 분석", href: "/profitability", icon: <BarChart3 className="h-4 w-4" />, color: "text-purple-600" },
  ];

  return (
    <AppLayout title={activeRestaurant?.name ?? "매장 대시보드"} subtitle={`${year}년 ${month}월 수익성 현황`}>
      <div className="p-4 lg:p-6 space-y-5">
        {/* 헤더 컨트롤 */}
        <div className="flex flex-wrap items-center gap-2">
          {activeRestaurant && restaurants.length > 1 && (
            <span className="text-sm font-medium text-muted-foreground">{activeRestaurant.name}</span>
          )}
          <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
            <SelectTrigger className="w-24 h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[2024, 2025, 2026].map(y => <SelectItem key={y} value={String(y)}>{y}년</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
            <SelectTrigger className="w-20 h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <SelectItem key={m} value={String(m)}>{m}월</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2">
            {activeRestaurantId && (
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 gap-1.5 text-xs font-semibold"
                onClick={() => setQuickSalesOpen(true)}
              >
                <Zap className="h-3.5 w-3.5" />
                매출 입력
              </Button>
            )}
            {/* 일마감 버튼 (매니저 이상) — 전용 페이지로 이동 */}
            {isManager && activeRestaurantId && (
              <Link href="/daily-ops">
                <Button
                  size="sm"
                  variant={dc ? "outline" : "default"}
                  className={cn("h-8 gap-1.5 text-xs font-semibold", dc ? "border-emerald-500/50 text-emerald-400" : "bg-blue-600 hover:bg-blue-700 text-white")}
                >
                  {dc ? <><CheckCircle2 className="h-3.5 w-3.5" />일마감 완료</> : <><LockKeyhole className="h-3.5 w-3.5" />일마감</>}
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* 일마감 완료 배너 */}
        {dc && (
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-400">오늘 일마감 완료</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {fmtDate(new Date(todayStr))} 마감 확정
                    </p>
                  </div>
                </div>
                <div className={cn("grid gap-3 text-right", canViewLaborCost ? "grid-cols-4" : "grid-cols-3")}>
                  <div>
                    <p className="text-xs text-muted-foreground">매출</p>
                    <p className="text-sm font-bold text-emerald-400">{fmt(Number(dc.salesTotal))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">매입</p>
                    <p className="text-sm font-bold text-amber-400">{fmt(Number(dc.purchasesTotal))}</p>
                  </div>
                  {canViewLaborCost && (
                    <div>
                      <p className="text-xs text-muted-foreground">인건비</p>
                      <p className="text-sm font-bold text-purple-400">{fmt(Number(dc.laborCost))}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">순이익</p>
                    <p className={cn("text-sm font-bold", Number(dc.profit) >= 0 ? "text-emerald-400" : "text-red-400")}>{fmt(Number(dc.profit))}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 당일 실시간 현황 (일마감 전) */}
        {!dc && d && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-primary mb-2">오늘 실시간 현황 ({now.toLocaleDateString("ko-KR")})</p>
                  <div className={cn("grid gap-3", canViewLaborCost ? "grid-cols-3" : "grid-cols-2")}>
                    <div>
                      <p className="text-xs text-muted-foreground">당일 매출</p>
                      <p className="text-base sm:text-lg font-bold text-primary">{fmt(d.salesTotal)}</p>
                    </div>
                    {canViewLaborCost && (
                      <div>
                        <p className="text-xs text-muted-foreground">당일 인건비</p>
                        <p className="text-base sm:text-lg font-bold text-purple-400">{fmt(d.laborCost ?? 0)}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-muted-foreground">인건비율</p>
                      <p className={cn("text-base sm:text-lg font-bold", d.laborRatio > (p?.targetLaborRatio ?? 30) ? "text-red-400" : "text-emerald-400")}>
                        {d.laborRatio.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>
                <Badge className={cn("text-xs px-2.5 py-1 shrink-0", d.laborRatio > (p?.targetLaborRatio ?? 30) ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30")}>
                  {d.laborRatio > (p?.targetLaborRatio ?? 30) ? "⚠ 목표 초과" : "✓ 정상"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}

        {/* KPI 카드 */}
        <div className={cn("grid gap-3", canViewLaborCost ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2 lg:grid-cols-3")}>
          <KpiCard title="월 매출" value={p ? fmt(p.salesTotal) : "-"} icon={<DollarSign className="h-5 w-5" />} variant="default" subtitle={p ? `목표 ${fmt(p.monthlyTargetSales)}` : undefined} />
          <KpiCard title="월 순이익" value={p ? fmt(p.profit) : "-"} icon={<TrendingUp className="h-5 w-5" />} variant={p ? (p.profit >= 0 ? "success" : "danger") : "default"} subtitle="매출 - 전체비용" />
          <KpiCard title="월 매입비" value={p ? fmt(p.purchasesTotal) : "-"} icon={<ShoppingCart className="h-5 w-5" />} variant="warning" subtitle="실제 매입 합산" />
          {canViewLaborCost && (
            <KpiCard title="월 인건비" value={p ? fmt(p.laborCost) : "-"} icon={<Users className="h-5 w-5" />} variant="default" subtitle="스케줄 기반 계산" />
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 비용 비율 게이지 */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">비용 비율 현황</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {p ? (
                <>
                  <CostGauge label="총 비용율" value={p.costRatio} target={p.targetCostRatio} />
                  <CostGauge label="인건비율" value={p.laborRatio} target={p.targetLaborRatio} />
                  <CostGauge label="매입비율" value={p.purchaseRatio} target={40} />
                  <CostGauge label="고정비율" value={p.fixedRatio} target={20} />
                </>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">데이터 없음</p>
              )}
            </CardContent>
          </Card>

          {/* 비용 구조 도넛 차트 */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">비용 구조</CardTitle>
            </CardHeader>
            <CardContent>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => fmt(v)}
                      contentStyle={{ background: "oklch(0.18 0.022 155)", border: "1px solid oklch(1 0 0 / 13%)", borderRadius: 8, fontSize: 12, color: "oklch(0.92 0.012 145)" }}
                      itemStyle={{ color: "oklch(0.92 0.012 145)" }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, color: "oklch(0.88 0.015 148)" }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">데이터 없음</div>
              )}
            </CardContent>
          </Card>

          {/* 빠른 메뉴 */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">빠른 메뉴</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {activeRestaurantId && (
                <button
                  onClick={() => setQuickSalesOpen(true)}
                  className="w-full flex items-center justify-between p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-2.5">
                    <Zap className="h-4 w-4 text-emerald-400" />
                    <span className="text-sm font-medium text-emerald-400">오늘 매출 입력</span>
                  </div>
                  <span className="text-xs text-emerald-400 font-medium bg-emerald-500/20 px-2 py-0.5 rounded-full">바로 입력</span>
                </button>
              )}
              {quickMenuItems.map(item => (
                <Link key={item.href} href={item.href}>
                  <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-accent transition-colors cursor-pointer group">
                    <div className="flex items-center gap-2.5">
                      <span className={item.color}>{item.icon}</span>
                      <span className="text-sm font-medium">{item.label}</span>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* 오늘 체크리스트 완료율 위젯 */}
        {(() => {
          const cs = checklistSummaryQuery.data;
          if (!cs) return null;
          const hasAny = cs.open !== null || cs.order !== null || cs.cleaning !== null;
          if (!hasAny) return null;

          const items = [
            { key: "open",     label: "오픈",   icon: <Sparkles className="h-3.5 w-3.5" />,     data: cs.open,     color: "emerald" },
            { key: "order",    label: "발주",   icon: <Package className="h-3.5 w-3.5" />,      data: cs.order,    color: "blue" },
            { key: "cleaning", label: "청소",   icon: <ClipboardList className="h-3.5 w-3.5" />, data: cs.cleaning, color: "amber" },
          ].filter(i => i.data !== null) as Array<{ key: string; label: string; icon: React.ReactNode; data: { total: number; checked: number; completed: boolean }; color: string }>;

          const allDone = items.every(i => i.data.completed);
          const anyPending = items.some(i => !i.data.completed);

          const colorMap: Record<string, string> = {
            emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
            blue:    "text-blue-400 bg-blue-500/10 border-blue-500/20",
            amber:   "text-amber-400 bg-amber-500/10 border-amber-500/20",
          };
          const doneColorMap: Record<string, string> = {
            emerald: "text-emerald-400",
            blue:    "text-blue-400",
            amber:   "text-amber-400",
          };

          return (
            <Card className={cn("border", allDone ? "border-emerald-500/30 bg-emerald-500/5" : anyPending ? "border-amber-500/30 bg-amber-500/5" : "border-border")}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    {allDone
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      : <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />}
                    <div>
                      <p className={cn("text-sm font-semibold", allDone ? "text-emerald-400" : "text-amber-400")}>
                        {allDone ? "오늘 체크리스트 전체 완료" : "체크리스트 미완료 항목 있음"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">일일 운영 페이지에서 체크하세요</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {items.map(item => (
                      <div
                        key={item.key}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border",
                          item.data.completed ? colorMap[item.color] : "text-muted-foreground bg-muted/30 border-border"
                        )}
                      >
                        {item.data.completed
                          ? <CheckCircle2 className="h-3 w-3" />
                          : <Circle className="h-3 w-3" />}
                        <span className={cn(item.data.completed ? doneColorMap[item.color] : "")}>{item.label}</span>
                        <span className="opacity-70">{item.data.checked}/{item.data.total}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* 내일 스케줄 점검 카드 */}
        {(() => {
          const tomorrowSchedules = schedules.filter((s: any) => s.workDate === tomorrowStr);
          const draftCount = tomorrowSchedules.filter((s: any) => s.status === "draft").length;
          const publishedCount = tomorrowSchedules.filter((s: any) => s.status === "published" || s.status === "confirmed").length;
          const hasIssue = tomorrowSchedules.length === 0 || draftCount > 0;
          return (
            <Card className={cn("border", hasIssue ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5")}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {hasIssue
                      ? <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                      : <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />}
                    <div>
                      <p className={cn("text-sm font-semibold", hasIssue ? "text-amber-400" : "text-emerald-400")}>
                        내일 스케줄 점검 ({new Date(tomorrowStr + "T12:00:00+09:00").toLocaleDateString("ko-KR", { month: "short", day: "numeric" })})
                      </p>
                      {tomorrowSchedules.length === 0 ? (
                        <p className="text-xs text-muted-foreground mt-0.5">등록된 스케줄이 없습니다.</p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          총 {tomorrowSchedules.length}명 ·
                          {publishedCount > 0 && <span className="text-blue-400"> 고지됨 {publishedCount}명</span>}
                          {draftCount > 0 && <span className="text-amber-400"> 초안 {draftCount}명 (고지 필요)</span>}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 text-right shrink-0">
                    {tomorrowSchedules.slice(0, 3).map((s: any) => (
                      <div key={s.id} className="flex items-center gap-1.5 text-xs">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-foreground font-medium">{s.userName}</span>
                        <span className="text-muted-foreground">{s.startTimeStr}~{s.endTimeStr}</span>
                      </div>
                    ))}
                    {tomorrowSchedules.length > 3 && (
                      <p className="text-xs text-muted-foreground">+{tomorrowSchedules.length - 3}명 더</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* 향후 7일 스케줄 */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4" /> 향후 7일 스케줄
              </CardTitle>
              {activeRestaurantId && (
                <Link href="/schedule">
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">전체 보기 <ArrowRight className="h-3 w-3" /></Button>
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-2">
              {upcomingDates.map(date => {
                const daySchedules = schedules.filter((s: any) => s.workDate === date);
                const dd = new Date(date);
                const isToday = date === todayStr;
                return (
                  <div key={date} className={cn("rounded-lg p-2 text-xs", isToday ? "bg-primary/10 border border-primary/30" : "bg-muted/30")}>
                    <p className={cn("font-semibold mb-1.5", isToday ? "text-primary" : "text-foreground")}>
                      {dd.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                      {isToday && <span className="ml-1 text-primary/70">(오늘)</span>}
                    </p>
                    {daySchedules.length === 0 ? (
                      <p className="text-muted-foreground">없음</p>
                    ) : daySchedules.slice(0, 3).map((s: any) => (
                      <div key={s.id} className="mb-1 leading-tight">
                        <p className="font-medium truncate">{s.userName}</p>
                        <p className="text-muted-foreground">{s.startTimeStr}~{s.endTimeStr}</p>
                      </div>
                    ))}
                    {daySchedules.length > 3 && <p className="text-muted-foreground">+{daySchedules.length - 3}명</p>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 매출 빠른 입력 모달 */}
      {activeRestaurantId && (
        <QuickSalesModal
          open={quickSalesOpen}
          onClose={() => setQuickSalesOpen(false)}
          restaurantId={activeRestaurantId}
          restaurantName={activeRestaurant?.name}
        />
      )}

      {/* 일마감 다이얼로그 */}
      <Dialog open={showDailyClose} onOpenChange={setShowDailyClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LockKeyhole className="h-4 w-4" />
              일마감 — {fmtDate(new Date(todayStr))}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* 오늘 집계 미리보기 */}
            <div className="rounded-lg bg-muted/40 p-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground mb-3">오늘 집계 — 마감 확정 전 추정값</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">매출</p>
                  <p className="text-base font-bold text-emerald-400">{d ? fmt(d.salesTotal) : "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">매입 (추정, 매출 30%)</p>
                  <p className="text-base font-bold text-amber-400">{d ? fmt(Math.round(d.salesTotal * 0.3)) : "-"}</p>
                </div>
                {canViewLaborCost && (
                  <div>
                    <p className="text-xs text-muted-foreground">인건비</p>
                    <p className="text-base font-bold text-purple-400">{d ? fmt(d.laborCost ?? 0) : "-"}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">인건비율</p>
                  <p className={cn("text-base font-bold", d && d.laborRatio > (p?.targetLaborRatio ?? 30) ? "text-red-400" : "text-emerald-400")}>
                    {d ? d.laborRatio.toFixed(1) + "%" : "-"}
                  </p>
                </div>
              </div>
            </div>
            {dc && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg p-3">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                이미 마감된 날입니다. 재마감하면 기존 데이터를 덮어씁니다.
              </div>
            )}
            <div>
              <Label className="text-xs">메모 (선택)</Label>
              <Textarea
                value={dailyCloseNote}
                onChange={e => setDailyCloseNote(e.target.value)}
                placeholder="특이사항, 이벤트, 날씨 등 메모를 남길 수 있습니다."
                className="mt-1 text-sm resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDailyClose(false)}>취소</Button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
              onClick={() => activeRestaurantId && dailyCloseMutation.mutate({
                restaurantId: activeRestaurantId,
                date: todayStr,
                note: dailyCloseNote || undefined,
              })}
              disabled={dailyCloseMutation.isPending}
            >
              <LockKeyhole className="h-3.5 w-3.5" />
              {dailyCloseMutation.isPending ? "마감 중..." : "일마감 확정"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
