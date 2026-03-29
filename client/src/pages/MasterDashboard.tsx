import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useLocation } from "wouter";
import {
  Server, Users, Store, Shield, Activity, Clock,
  ChevronRight, AlertCircle, CheckCircle2, UserCheck,
  Database, TrendingUp, DollarSign, UserPlus, Building2,
} from "lucide-react";
import { Card, StatCard, PageHeader } from "@/components/ui/compat";
import { Button } from "@/components/ui/button";
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

      {/* 매장 소유권 + SUB대표 관리 */}
      <OwnershipManager />
    </div>
  );
}

// ─── 매장 소유권 + SUB대표 관리 패널 ──────────────────────────────────────────
function OwnershipManager() {
  const utils = trpc.useUtils();
  const { data } = trpc.restaurants.listAllWithOwner.useQuery();
  const { data: subAdmins } = trpc.users.listSubAdmins.useQuery();
  const updateOwnerMut = trpc.restaurants.updateOwner.useMutation({
    onSuccess: () => utils.restaurants.listAllWithOwner.invalidate(),
  });
  const createSubAdminMut = trpc.users.createSubAdmin.useMutation({
    onSuccess: () => {
      utils.users.listSubAdmins.invalidate();
      setShowForm(false);
      setForm({ username: "", password: "", name: "", phone: "" });
    },
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", name: "", phone: "" });

  if (!data) return null;

  const adminMap = new Map(data.admins.map(a => [a.id, a]));
  const realStores = data.stores.filter(s => !s.isTutorial);
  const tutorialStores = data.stores.filter(s => s.isTutorial);

  const handleOwnerChange = (restaurantId: number, val: string) => {
    const ownerAdminId = val === "" ? null : Number(val);
    updateOwnerMut.mutate({ restaurantId, ownerAdminId });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 매장 소유권 */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
          <Building2 size={14} className="text-primary" />
          매장 소유권 관리
        </h3>
        <div className="space-y-2">
          {realStores.map(store => {
            const owner = store.ownerAdminId ? adminMap.get(store.ownerAdminId) : null;
            return (
              <div key={store.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{store.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {owner ? `${owner.name}${owner.parentId ? ' (SUB)' : ''}` : '미배정'}
                  </p>
                </div>
                <select
                  value={store.ownerAdminId ?? ""}
                  onChange={(e) => handleOwnerChange(store.id, e.target.value)}
                  className="text-xs border border-border rounded px-2 py-1 bg-background text-foreground min-w-[100px]"
                >
                  <option value="">미배정</option>
                  {data.admins.filter(a => !a.parentId).map(a => (
                    <option key={a.id} value={a.id}>{a.name} (대표)</option>
                  ))}
                </select>
              </div>
            );
          })}
          {tutorialStores.length > 0 && (
            <div className="pt-2 border-t border-border/50">
              <p className="text-[10px] text-muted-foreground mb-1">Tutorial 매장 ({tutorialStores.length}개) — 합산 제외</p>
              {tutorialStores.map(s => (
                <p key={s.id} className="text-xs text-muted-foreground pl-2">• {s.name}</p>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* SUB대표 관리 */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <UserPlus size={14} className="text-primary" />
            SUB대표 관리
          </h3>
          <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? "취소" : "+ 추가"}
          </Button>
        </div>

        {showForm && (
          <div className="p-3 mb-3 rounded-lg border border-primary/20 bg-primary/5 space-y-2">
            <input placeholder="아이디" value={form.username} onChange={e => setForm(f => ({...f, username: e.target.value}))}
              className="w-full text-sm border border-border rounded px-2.5 py-1.5 bg-background text-foreground" />
            <input placeholder="비밀번호" type="password" value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))}
              className="w-full text-sm border border-border rounded px-2.5 py-1.5 bg-background text-foreground" />
            <input placeholder="이름" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
              className="w-full text-sm border border-border rounded px-2.5 py-1.5 bg-background text-foreground" />
            <input placeholder="전화번호 (선택)" value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))}
              className="w-full text-sm border border-border rounded px-2.5 py-1.5 bg-background text-foreground" />
            <Button
              size="sm"
              className="w-full"
              disabled={!form.username || !form.password || !form.name || createSubAdminMut.isPending}
              onClick={() => createSubAdminMut.mutate({
                username: form.username, password: form.password, name: form.name,
                phone: form.phone || undefined,
              })}
            >
              {createSubAdminMut.isPending ? "생성 중..." : "SUB대표 생성"}
            </Button>
            {createSubAdminMut.error && (
              <p className="text-xs text-red-500">{createSubAdminMut.error.message}</p>
            )}
          </div>
        )}

        <div className="space-y-2">
          {(subAdmins ?? []).map((sa: any) => {
            const parent = sa.parentId ? adminMap.get(sa.parentId) : null;
            return (
              <div key={sa.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div>
                  <p className="text-sm font-medium text-foreground">{sa.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    @{sa.username} · {parent ? `상위: ${parent.name}` : '독립'}
                  </p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${sa.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' : 'bg-gray-100 text-gray-500'}`}>
                  {sa.isActive ? '활성' : '비활성'}
                </span>
              </div>
            );
          })}
          {(!subAdmins || subAdmins.length === 0) && !showForm && (
            <p className="text-xs text-muted-foreground text-center py-4">등록된 SUB대표가 없습니다</p>
          )}
        </div>
      </Card>
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
