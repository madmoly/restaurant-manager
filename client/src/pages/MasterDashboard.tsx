import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useLocation } from "wouter";
import {
  Server, Users, Store, Shield, Activity, Clock,
  ChevronRight, AlertCircle, CheckCircle2, UserCheck,
  Database, TrendingUp, DollarSign,
} from "lucide-react";
import { Card, StatCard, PageHeader } from "@/components/ui/compat";
import { DashboardSkeleton } from "@/components/ui/skeletons";
import { ROLE_LABELS } from "@shared/permissions";

// ─── 포맷 헬퍼 ─────────────────────────────────────────────────────────────
const fmtShort = (n: number) => {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
  return n.toLocaleString("ko-KR");
};

// ─── 메인: 개발자(master) 대시보드 ───────────────────────────────────────────
export default function MasterDashboard() {
  const [, setLocation] = useLocation();
  const today = new Date();
  const [year] = useState(today.getFullYear());
  const [month] = useState(today.getMonth() + 1);

  // 시스템 현황
  const { data: sysStatus, isLoading: loadingSys } = trpc.admin.systemStatus.useQuery();

  // 이번 달 사업 요약
  const { data: bizSummary, isLoading: loadingBiz } =    trpc.admin.multiStoreMonthlySummary.useQuery({ year, month });

  const todayStr = today.toISOString().slice(0, 10);
  const { data: todayStatuses } = trpc.admin.allStoresTodayStatus.useQuery({ date: todayStr });

  const { data: notifications } = trpc.notifications.listMine.useQuery({ limit: 5 });

  const isLoading = loadingSys || loadingBiz;
  if (isLoading) return <DashboardSkeleton />;

  const u = sysStatus?.users;
  const s = sysStatus?.stores;
  const biz = bizSummary?.totals;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* 헤더 */}
      <PageHeader
        title="시스템 관리"
        description={`${year}년 ${month}월 · 개발자 콘솔`}
      />

      {/* 시스템 KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Users size={14} />}
          label="전체 사용자"
          value={String(u?.total ?? 0)}
          unit="명"
          trend={{ value: u?.active ?? 0, label: "활성" }}
        />
        <StatCard          icon={<Store size={14} />}
          label="매장"
          value={String(s?.active ?? 0)}
          unit="개"
          trend={s?.archived ? { value: -(s.archived), label: "아카이브" } : undefined}
        />
        <StatCard
          icon={<DollarSign size={14} />}
          label="이번 달 총매출"
          value={fmtShort(biz?.salesTotal ?? 0)}
          unit="원"
        />
        <StatCard
          icon={<TrendingUp size={14} />}
          label="영업이익률"
          value={(biz?.profitRate ?? 0).toFixed(1)}
          unit="%"
          className={(biz?.profit ?? 0) >= 0 ? "border-emerald-500/20" : "border-red-500/20"}
        />
      </div>

      {/* 메인 그리드 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 사용자 분포 */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Shield size={14} className="text-primary" />
              역할별 사용자 분포            </h3>
            <button
              onClick={() => setLocation("/users")}
              className="text-xs text-primary hover:underline flex items-center gap-0.5"
            >
              사용자 관리 <ChevronRight size={12} />
            </button>
          </div>
          <div className="space-y-3">
            <RoleRow label="대표 (admin)" count={u?.admins ?? 0} color="bg-blue-500" total={u?.total ?? 1} />
            <RoleRow label="점장 (owner)" count={u?.managers ?? 0} color="bg-emerald-500" total={u?.total ?? 1} />
            <RoleRow label="직원 (staff)" count={u?.employees ?? 0} color="bg-slate-500" total={u?.total ?? 1} />
          </div>
        </Card>

        {/* 최근 로그인 */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Clock size={14} className="text-primary" />
              최근 접속 사용자
            </h3>
          </div>
          <div className="space-y-2">
            {(sysStatus?.recentLogins ?? []).map((login: any) => (
              <div key={login.id} className="flex items-center justify-between p-2.5 rounded-lg border border-border">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                    <UserCheck size={12} className="text-primary" />                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{login.name}</p>
                    <p className="text-xs text-muted-foreground">{ROLE_LABELS[login.role] ?? login.role}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {login.lastSignedIn
                    ? new Date(login.lastSignedIn).toLocaleDateString("ko-KR", {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                      })
                    : "—"
                  }
                </p>
              </div>
            ))}
            {(!sysStatus?.recentLogins || sysStatus.recentLogins.length === 0) && (
              <p className="text-xs text-muted-foreground text-center py-4">접속 기록이 없습니다</p>
            )}
          </div>
        </Card>
      </div>

      {/* 전체 매장 금일 현황 */}
      {todayStatuses && todayStatuses.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
            <Activity size={14} className="text-primary" />
            전체 매장 금일 현황
            <span className="text-xs font-normal text-muted-foreground ml-1">{todayStr}</span>
          </h3>
          <div className="space-y-2">
            {todayStatuses.map((st: any) => (
              <div key={st.restaurantId} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/50">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Store size={14} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{st.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${st.isOpenChecked ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                        {st.isOpenChecked ? '오픈✓' : '오픈✗'}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${st.isCloseDone ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                        {st.isCloseDone ? '마감✓' : '미마감'}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{st.staffCount}명 출근</span>
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  {st.midSalesTotal > 0 ? (
                    <>
                      <p className="text-sm font-semibold text-foreground tabular-nums">{fmtShort(st.midSalesTotal)}원</p>
                      <p className="text-[10px] text-muted-foreground">
                        {st.midSalesReceipts > 0 && `${st.midSalesReceipts}건 · `}
                        {st.lastMidSalesTime && new Date(st.lastMidSalesTime).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </>
                  ) : st.isCloseDone && st.closingTotal != null ? (
                    <p className="text-sm font-semibold text-foreground tabular-nums">{fmtShort(st.closingTotal)}원</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">매출 미입력</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 매장 현황 + 시스템 알림 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 매장별 직원 배정 현황 */}
        <div className="lg:col-span-2">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Database size={14} className="text-primary" />
                매장별 현황
              </h3>
              <button
                onClick={() => setLocation("/restaurants")}
                className="text-xs text-primary hover:underline flex items-center gap-0.5"
              >
                매장 관리 <ChevronRight size={12} />
              </button>
            </div>
            <div className="space-y-2">
              {(bizSummary?.stores ?? []).map((store) => {
                const staffCount = sysStatus?.storeStaffCounts?.find(
                  (sc: any) => sc.restaurantId === store.restaurantId
                )?.count ?? 0;

                return (
                  <div
                    key={store.restaurantId}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent/30 transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-2 h-8 rounded-full ${store.isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{store.restaurantName}</p>
                        <p className="text-xs text-muted-foreground">
                          직원 {staffCount}명 · 일마감 {store.closedDays}/{store.daysInMonth}일
                        </p>                      </div>
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

        {/* 시스템 알림/이벤트 */}
        <div>
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Activity size={14} className="text-primary" />
              시스템 알림
            </h3>
            <div className="space-y-2">
              {(notifications ?? []).slice(0, 5).map((n: any) => (
                <div key={n.id} className={`p-2.5 rounded-lg border text-sm ${!n.isRead ? "border-primary/20 bg-primary/5" : "border-border"}`}>
                  <div className="flex items-start gap-2">                    {n.type === "cost_exceeded"
                      ? <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                      : <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                    }
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

          {/* 빠른 이동 */}
          <Card className="p-5 mt-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Server size={14} className="text-primary" />
              빠른 이동
            </h3>
            <div className="space-y-1.5">
              {[
                { label: "사용자 관리", href: "/users", icon: <Users size={14} /> },
                { label: "매장 관리", href: "/restaurants", icon: <Store size={14} /> },                { label: "수익 분석", href: "/profitability", icon: <TrendingUp size={14} /> },
                { label: "스케줄", href: "/schedule", icon: <Clock size={14} /> },
              ].map((item) => (
                <button
                  key={item.href}
                  onClick={() => setLocation(item.href)}
                  className="w-full flex items-center gap-2.5 p-2.5 rounded-lg border border-border hover:bg-accent/50 hover:border-primary/30 transition-all text-left"
                >
                  <span className="text-muted-foreground">{item.icon}</span>
                  <span className="text-sm text-foreground">{item.label}</span>
                  <ChevronRight size={12} className="ml-auto text-muted-foreground" />
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── 역할 분포 바 ────────────────────────────────────────────────────────────
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
