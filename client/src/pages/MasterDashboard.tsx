import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useLocation } from "wouter";
import {
  Server, Users, Store, Shield, Activity, Clock,
  ChevronRight, AlertCircle, CheckCircle2, UserCheck,
  Database, TrendingUp, DollarSign, UserPlus, Building2,
  Plus, ChevronDown, ChevronUp, Briefcase,
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

  // 영업일 기준: 새벽 3시 이전이면 전날
  const bizToday = new Date(today.getTime() - 3 * 60 * 60 * 1000);
  const todayStr = `${bizToday.getFullYear()}-${String(bizToday.getMonth() + 1).padStart(2, "0")}-${String(bizToday.getDate()).padStart(2, "0")}`;
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
            <RoleRow label="일반 사용자" count={u?.users ?? 0} color="bg-slate-500" total={u?.total ?? 1} />
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
                { label: "매장 관리", href: "/restaurants", icon: <Store size={14} /> },                { label: "월정산", href: "/monthly-settlement", icon: <TrendingUp size={14} /> },
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

      {/* 사업그룹 관리 */}
      <BusinessGroupManager />
    </div>
  );
}

// ─── 사업그룹 관리 패널 ──────────────────────────────────────────────────────
function BusinessGroupManager() {
  const utils = trpc.useUtils();
  const { data: groups, isLoading } = trpc.businessGroups.list.useQuery();
  const { data: storeOwnerData } = trpc.restaurants.listAllWithOwner.useQuery();

  const createMut = trpc.businessGroups.create.useMutation({
    onSuccess: () => {
      utils.businessGroups.list.invalidate();
      utils.restaurants.listAllWithOwner.invalidate();
      setShowCreate(false);
      setCreateForm({ groupName: "", username: "", password: "", name: "", phone: "" });
    },
  });
  const assignMut = trpc.businessGroups.assignStore.useMutation({
    onSuccess: () => {
      utils.businessGroups.list.invalidate();
      utils.restaurants.listAllWithOwner.invalidate();
    },
  });

  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [createForm, setCreateForm] = useState({
    groupName: "", username: "", password: "", name: "", phone: "",
  });

  // 미배정 매장 목록
  const unassignedStores = (storeOwnerData?.stores ?? []).filter(
    (s) => !s.isTutorial && !s.ownerAdminId
  );

  const handleCreate = () => {
    createMut.mutate({
      groupName: createForm.groupName,
      newAdmin: {
        username: createForm.username,
        password: createForm.password,
        name: createForm.name,
        phone: createForm.phone || undefined,
      },
    });
  };

  const handleAssign = (restaurantId: number, groupIdStr: string) => {
    const groupId = groupIdStr === "" ? null : Number(groupIdStr);
    assignMut.mutate({ restaurantId, groupId });
  };

  return (
    <Card className="p-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Briefcase size={14} className="text-primary" />
          사업그룹 관리
        </h3>
        <Button variant="outline" size="sm" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "취소" : <><Plus size={12} className="mr-1" /> 사업그룹 생성</>}
        </Button>
      </div>

      {/* 생성 폼 */}
      {showCreate && (
        <div className="p-4 mb-4 rounded-lg border border-primary/20 bg-primary/5 space-y-3">
          <p className="text-xs font-semibold text-foreground">새 사업그룹 + 대표 계정 생성</p>
          <input
            placeholder="사업그룹명 (예: 홍길동 사업그룹)"
            value={createForm.groupName}
            onChange={(e) => setCreateForm((f) => ({ ...f, groupName: e.target.value }))}
            className="w-full text-sm border border-border rounded px-2.5 py-1.5 bg-background text-foreground"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="대표 아이디"
              value={createForm.username}
              onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
              className="text-sm border border-border rounded px-2.5 py-1.5 bg-background text-foreground"
            />
            <input
              placeholder="비밀번호"
              type="password"
              value={createForm.password}
              onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
              className="text-sm border border-border rounded px-2.5 py-1.5 bg-background text-foreground"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="대표 이름"
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              className="text-sm border border-border rounded px-2.5 py-1.5 bg-background text-foreground"
            />
            <input
              placeholder="전화번호 (선택)"
              value={createForm.phone}
              onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
              className="text-sm border border-border rounded px-2.5 py-1.5 bg-background text-foreground"
            />
          </div>
          <Button
            size="sm"
            className="w-full"
            disabled={
              !createForm.groupName || !createForm.username || !createForm.password || !createForm.name || createMut.isPending
            }
            onClick={handleCreate}
          >
            {createMut.isPending ? "생성 중..." : "사업그룹 생성"}
          </Button>
          {createMut.error && <p className="text-xs text-red-500">{createMut.error.message}</p>}
        </div>
      )}

      {/* 그룹 목록 */}
      {isLoading ? (
        <p className="text-xs text-muted-foreground text-center py-6">불러오는 중...</p>
      ) : (
        <div className="space-y-2">
          {(groups ?? []).map((g: any) => {
            const isExpanded = expandedId === g.id;
            return (
              <div key={g.id} className="rounded-lg border border-border overflow-hidden">
                {/* 그룹 요약 행 */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : g.id)}
                  className="w-full flex items-center justify-between p-3 hover:bg-accent/30 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-2 h-10 rounded-full ${g.isActive ? "bg-primary" : "bg-muted"}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-foreground truncate">{g.name}</p>
                        {!g.isActive && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium shrink-0">
                            Tutorial
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        대표: {g.admin?.name ?? "—"} (@{g.admin?.username ?? "—"})
                        {g.subAdminCount > 0 && ` · SUB대표 ${g.subAdminCount}명`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">
                        매장 <span className="font-semibold text-foreground">{g.storeCount}</span>개
                        {" · "}직원 <span className="font-semibold text-foreground">{g.staffCount}</span>명
                      </p>
                    </div>
                    {isExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                  </div>
                </button>

                {/* 펼침 상세 */}
                {isExpanded && (
                  <div className="px-4 pb-3 border-t border-border/50 bg-accent/10">
                    {/* 소속 매장 */}
                    <p className="text-[10px] font-semibold text-muted-foreground mt-3 mb-1.5 uppercase tracking-wide">소속 매장</p>
                    {g.stores.length > 0 ? (
                      <div className="space-y-1">
                        {g.stores.map((s: any) => (
                          <div key={s.id} className="flex items-center justify-between py-1.5 px-2 rounded bg-background/50">
                            <div className="flex items-center gap-2">
                              <Store size={12} className="text-muted-foreground" />
                              <span className="text-xs text-foreground">{s.name}</span>
                            </div>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${s.isActive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-gray-100 text-gray-500"}`}>
                              {s.isActive ? "활성" : "비활성"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground py-2">소속 매장 없음</p>
                    )}

                    {/* 대표 정보 */}
                    <p className="text-[10px] font-semibold text-muted-foreground mt-3 mb-1.5 uppercase tracking-wide">대표 정보</p>
                    <div className="py-1.5 px-2 rounded bg-background/50 text-xs text-foreground">
                      {g.admin?.name} · @{g.admin?.username} · {g.admin?.phone ?? "전화번호 없음"}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {(!groups || groups.length === 0) && !showCreate && (
            <p className="text-xs text-muted-foreground text-center py-6">등록된 사업그룹이 없습니다</p>
          )}
        </div>
      )}

      {/* 미배정 매장 */}
      {unassignedStores.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border/50">
          <p className="text-xs font-semibold text-muted-foreground mb-2">미배정 매장 ({unassignedStores.length}개)</p>
          <div className="space-y-1.5">
            {unassignedStores.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-2.5 rounded-lg border border-dashed border-border">
                <div className="flex items-center gap-2">
                  <Store size={12} className="text-muted-foreground" />
                  <span className="text-xs text-foreground">{s.name}</span>
                </div>
                <select
                  defaultValue=""
                  onChange={(e) => handleAssign(s.id, e.target.value)}
                  className="text-[11px] border border-border rounded px-2 py-1 bg-background text-foreground min-w-[120px]"
                >
                  <option value="">그룹 선택...</option>
                  {(groups ?? []).map((g: any) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
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
