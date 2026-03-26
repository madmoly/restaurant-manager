import { useState } from "react";
import { trpc } from "../lib/trpc";
import { Card, StatCard, PageHeader } from "@/components/ui/compat";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@shared/permissions";
import {
  AlertTriangle, Monitor, User, Store, Calendar, ChevronDown, ChevronUp,
  Users, Shield, Clock, UserCheck, Database, TrendingUp, DollarSign, ChevronRight,
  Activity, CheckCircle2, AlertCircle, Server, Send, Settings, Megaphone,
  Lock, Unlock, KeyRound, Cpu, HardDrive, Download, RefreshCw,
  AlertOctagon, FileWarning, BarChart3,
} from "lucide-react";
import { toast } from "sonner";

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
const SEVERITY_COLORS: Record<string, string> = {
  error: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};
const fmtShort = (n: number) => {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
  return n.toLocaleString("ko-KR");
};
const fmtDate = (d: string | Date) => {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getMonth() + 1}/${date.getDate()}`;
};
const fmtDateTime = (d: string | Date) => {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const fmtBytes = (b: number) => {
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)}MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)}KB`;
  return `${b}B`;
};

// ═══════════════════════════════════════════════════════════════════════════════
// 메인: 시스템 관리 (7탭)
// ═══════════════════════════════════════════════════════════════════════════════

type Tab = "status" | "announce" | "audit" | "session" | "settings" | "api" | "integrity" | "backup" | "errors" | "errorList";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "status", label: "현황", icon: <Activity size={12} /> },
  { key: "announce", label: "공지", icon: <Megaphone size={12} /> },
  { key: "audit", label: "감사로그", icon: <FileWarning size={12} /> },
  { key: "session", label: "접속관리", icon: <Users size={12} /> },
  { key: "settings", label: "설정", icon: <Settings size={12} /> },
  { key: "api", label: "API", icon: <Cpu size={12} /> },
  { key: "integrity", label: "정합성", icon: <CheckCircle2 size={12} /> },
  { key: "backup", label: "백업", icon: <HardDrive size={12} /> },
  { key: "errors", label: "에러개요", icon: <AlertTriangle size={12} /> },
  { key: "errorList", label: "에러목록", icon: <AlertOctagon size={12} /> },
];

export default function SystemPage() {
  const [tab, setTab] = useState<Tab>("status");

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Monitor className="w-5 h-5" /> 시스템 관리
        </h1>
      </div>

      {/* 탭 바 — 스크롤 가능 */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map(t => (
          <Button
            key={t.key}
            variant={tab === t.key ? "default" : "outline"}
            size="sm"
            className="text-xs shrink-0 gap-1"
            onClick={() => setTab(t.key)}
          >
            {t.icon} {t.label}
          </Button>
        ))}
      </div>

      {tab === "status" && <SystemStatusTab />}
      {tab === "announce" && <AnnouncementTab />}
      {tab === "audit" && <AuditLogTab />}
      {tab === "session" && <SessionTab />}
      {tab === "settings" && <SettingsTab />}
      {tab === "api" && <ApiUsageTab />}
      {tab === "integrity" && <IntegrityTab />}
      {tab === "backup" && <BackupTab />}
      {tab === "errors" && <ErrorOverviewTab />}
      {tab === "errorList" && <ErrorListTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 탭1: 시스템 현황
// ═══════════════════════════════════════════════════════════════════════════════

function SystemStatusTab() {
  const today = new Date();
  const [year] = useState(today.getFullYear());
  const [month] = useState(today.getMonth() + 1);

  const { data: sysStatus, isLoading: loadingSys } = trpc.admin.systemStatus.useQuery();
  const { data: bizSummary, isLoading: loadingBiz } = trpc.admin.multiStoreMonthlySummary.useQuery({ year, month });
  const { data: notifications } = trpc.notifications.listMine.useQuery({ limit: 5 });

  if (loadingSys || loadingBiz) {
    return <div className="space-y-4 animate-pulse"><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[1,2,3,4].map(i => <div key={i} className="h-20 bg-muted rounded-lg" />)}</div></div>;
  }

  const u = sysStatus?.users;
  const s = sysStatus?.stores;
  const biz = bizSummary?.totals;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<Users size={14} />} label="전체 사용자" value={String(u?.total ?? 0)} unit="명" trend={{ value: u?.active ?? 0, label: "활성" }} />
        <StatCard icon={<Store size={14} />} label="매장" value={String(s?.active ?? 0)} unit="개" />
        <StatCard icon={<DollarSign size={14} />} label="이번 달 총매출" value={fmtShort(biz?.salesTotal ?? 0)} unit="원" />
        <StatCard icon={<TrendingUp size={14} />} label="영업이익률" value={(biz?.profitRate ?? 0).toFixed(1)} unit="%" className={(biz?.profit ?? 0) >= 0 ? "border-emerald-500/20" : "border-red-500/20"} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4"><Shield size={14} className="text-primary" /> 역할별 사용자 분포</h3>
          <div className="space-y-3">
            <RoleRow label="대표 (admin)" count={u?.admins ?? 0} color="bg-blue-500" total={u?.total ?? 1} />
            <RoleRow label="점장 (owner)" count={u?.managers ?? 0} color="bg-emerald-500" total={u?.total ?? 1} />
            <RoleRow label="직원 (staff)" count={u?.employees ?? 0} color="bg-slate-500" total={u?.total ?? 1} />
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4"><Clock size={14} className="text-primary" /> 최근 접속</h3>
          <div className="space-y-2">
            {(sysStatus?.recentLogins ?? []).map((login: any) => (
              <div key={login.id} className="flex items-center justify-between p-2.5 rounded-lg border border-border">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center"><UserCheck size={12} className="text-primary" /></div>
                  <div><p className="text-sm font-medium text-foreground">{login.name}</p><p className="text-xs text-muted-foreground">{ROLE_LABELS[login.role] ?? login.role}</p></div>
                </div>
                <p className="text-xs text-muted-foreground">{login.lastSignedIn ? new Date(login.lastSignedIn).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4"><Database size={14} className="text-primary" /> 매장별 현황</h3>
            <div className="space-y-2">
              {(bizSummary?.stores ?? []).map((store: any) => {
                const staffCount = sysStatus?.storeStaffCounts?.find((sc: any) => sc.restaurantId === store.restaurantId)?.count ?? 0;
                return (
                  <div key={store.restaurantId} className="flex items-center justify-between p-3 rounded-lg border border-border">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-2 h-8 rounded-full ${store.isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
                      <div className="min-w-0"><p className="text-sm font-medium text-foreground truncate">{store.restaurantName}</p><p className="text-xs text-muted-foreground">직원 {staffCount}명 · 일마감 {store.closedDays}/{store.daysInMonth}일</p></div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-sm font-semibold text-foreground tabular-nums">{fmtShort(store.salesTotal)}원</p>
                      <p className={`text-xs tabular-nums ${store.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>{store.profit >= 0 ? "+" : ""}{store.profitRate.toFixed(1)}%</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2"><Activity size={14} className="text-primary" /> 시스템 알림</h3>
          <div className="space-y-2">
            {(notifications ?? []).slice(0, 5).map((n: any) => (
              <div key={n.id} className={`p-2.5 rounded-lg border text-sm ${!n.isRead ? "border-primary/20 bg-primary/5" : "border-border"}`}>
                <div className="flex items-start gap-2">
                  {n.type === "cost_exceeded" ? <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" /> : <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />}
                  <div className="min-w-0 flex-1"><p className="text-xs font-medium text-foreground truncate">{n.title}</p><p className="text-[10px] text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p></div>
                </div>
              </div>
            ))}
            {(!notifications || notifications.length === 0) && <p className="text-xs text-muted-foreground text-center py-6">알림 없음</p>}
          </div>
        </Card>
      </div>

      {/* 인프라 스펙 */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
          <Server size={14} className="text-primary" /> Railway 인프라 스펙 (Hobby Plan)
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-lg border border-border bg-muted/30">
            <p className="text-muted-foreground mb-1">플랜 / 월 구독</p>
            <p className="font-semibold text-foreground">Hobby · $5/월</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">포함 크레딧 $5/월</p>
          </div>
          <div className="p-3 rounded-lg border border-border bg-muted/30">
            <p className="text-muted-foreground mb-1">서비스당 CPU / RAM</p>
            <p className="font-semibold text-foreground">최대 48 vCPU / 48 GB</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">$20/vCPU · $10/GB/월</p>
          </div>
          <div className="p-3 rounded-lg border border-border bg-muted/30">
            <p className="text-muted-foreground mb-1">볼륨 스토리지</p>
            <p className="font-semibold text-foreground">최대 5 GB/서비스</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">$0.15/GB/월 · 10볼륨/프로젝트</p>
          </div>
          <div className="p-3 rounded-lg border border-border bg-muted/30">
            <p className="text-muted-foreground mb-1">네트워크 / 이미지</p>
            <p className="font-semibold text-foreground">$0.05/GB egress</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">이미지 최대 100GB · 보존 72시간</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-lg border border-border bg-muted/30">
            <p className="text-muted-foreground mb-1">DB (MySQL 8)</p>
            <p className="font-semibold text-foreground">Railway 내장 MySQL</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">볼륨 5GB 한도 · 별도 스토리지 $0.15/GB/월</p>
          </div>
          <div className="p-3 rounded-lg border border-border bg-muted/30">
            <p className="text-muted-foreground mb-1">배포 방식</p>
            <p className="font-semibold text-foreground">GitHub main push → 자동 빌드/배포</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">볼륨 삭제 시 48시간 복구 가능</p>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          * 실 사용량 기반 과금. 포함 크레딧($5) 초과분만 청구. Hobby 리밋 초과 시 Pro($20/월) 업그레이드 필요.
        </p>
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 탭2: 공지사항 발송
// ═══════════════════════════════════════════════════════════════════════════════

function AnnouncementTab() {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [restaurantId, setRestaurantId] = useState<number | undefined>(undefined);

  const { data: stores } = trpc.restaurants.list.useQuery();
  const { data: recent } = trpc.system.recentAnnouncements.useQuery();
  const sendMut = trpc.system.sendAnnouncement.useMutation({
    onSuccess(data) { toast.success(`공지 발송 완료 (${data.sent}명)`); setTitle(""); setContent(""); },
    onError(err) { toast.error(err.message); },
  });

  return (
    <>
      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Megaphone size={14} className="text-primary" /> 공지사항 발송</h3>
        <div>
          <label className="text-xs text-muted-foreground">대상</label>
          <select
            className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground"
            value={restaurantId ?? "all"}
            onChange={e => setRestaurantId(e.target.value === "all" ? undefined : Number(e.target.value))}
          >
            <option value="all">전체 사용자</option>
            {stores?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">제목 *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="공지 제목" className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">내용</label>
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="상세 내용 (선택)" rows={3} className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground resize-none" />
        </div>
        <Button size="sm" className="gap-1.5" disabled={!title.trim() || sendMut.isPending} onClick={() => sendMut.mutate({ title: title.trim(), content: content.trim() || undefined, restaurantId })}>
          <Send size={13} /> 발송
        </Button>
      </Card>

      {/* 최근 발송 이력 */}
      {recent && recent.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">최근 발송 이력</h3>
          <div className="space-y-2">
            {recent.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between p-2.5 rounded-lg border border-border text-sm">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{(r.details as any)?.title ?? "공지"}</p>
                  <p className="text-[10px] text-muted-foreground">{(r.details as any)?.recipientCount ?? 0}명 · {r.userName}</p>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">{fmtDateTime(r.createdAt)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 탭3: 감사 로그
// ═══════════════════════════════════════════════════════════════════════════════

function AuditLogTab() {
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const LIMIT = 30;

  const { data: summary } = trpc.system.auditSummary.useQuery();
  const { data: logs } = trpc.system.auditList.useQuery({ limit: LIMIT, offset });

  const ACTION_LABELS: Record<string, string> = { create: "생성", update: "수정", delete: "삭제" };

  return (
    <>
      {summary && (
        <div className="grid grid-cols-3 gap-2">
          <Card className="p-3 text-center"><p className="text-xs text-muted-foreground">7일간 변경</p><p className="text-xl font-bold text-foreground tabular-nums">{summary.total7d}<span className="text-xs text-muted-foreground ml-0.5">건</span></p></Card>
          <Card className="p-3 text-center"><p className="text-xs text-muted-foreground">액션 유형</p><p className="text-xl font-bold text-foreground tabular-nums">{summary.byAction.length}<span className="text-xs text-muted-foreground ml-0.5">종</span></p></Card>
          <Card className="p-3 text-center"><p className="text-xs text-muted-foreground">대상 유형</p><p className="text-xl font-bold text-foreground tabular-nums">{summary.byTarget.length}<span className="text-xs text-muted-foreground ml-0.5">종</span></p></Card>
        </div>
      )}

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">감사 로그 ({logs?.total ?? 0}건)</h3>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>이전</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={(logs?.rows.length ?? 0) < LIMIT} onClick={() => setOffset(offset + LIMIT)}>다음</Button>
          </div>
        </div>
        <div className="space-y-1">
          {logs?.rows.map((log: any) => (
            <div key={log.id} className="border border-border/50 rounded-lg overflow-hidden">
              <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-muted/30 transition-colors" onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}>
                <Badge variant="secondary" className="text-[10px] shrink-0">{ACTION_LABELS[log.action] ?? log.action}</Badge>
                <span className="text-xs text-foreground truncate flex-1">{log.target}{log.targetId ? `#${log.targetId}` : ""}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{log.userName ?? "시스템"}</span>
                <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{fmtDateTime(log.createdAt)}</span>
                {expandedId === log.id ? <ChevronUp className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
              </button>
              {expandedId === log.id && log.details && (
                <div className="px-3 py-2 border-t border-border/30 bg-muted/20">
                  <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all max-h-40 overflow-auto">{JSON.stringify(log.details, null, 2)}</pre>
                </div>
              )}
            </div>
          ))}
          {logs?.rows.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">감사 로그가 없습니다</p>}
        </div>
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 탭4: 세션/접속 관리
// ═══════════════════════════════════════════════════════════════════════════════

function SessionTab() {
  const utils = trpc.useUtils();
  const { data: sessions } = trpc.system.activeSessions.useQuery();

  const deactivateMut = trpc.system.deactivateUser.useMutation({
    onSuccess() { toast.success("사용자 비활성화 완료"); utils.system.activeSessions.invalidate(); },
    onError(e) { toast.error(e.message); },
  });
  const reactivateMut = trpc.system.reactivateUser.useMutation({
    onSuccess() { toast.success("사용자 재활성화 완료"); utils.system.activeSessions.invalidate(); },
    onError(e) { toast.error(e.message); },
  });
  const resetPwMut = trpc.system.resetPassword.useMutation({
    onSuccess() { toast.success("비밀번호 초기화 완료 (1111)"); },
    onError(e) { toast.error(e.message); },
  });

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4"><Users size={14} className="text-primary" /> 사용자 접속 관리</h3>
      <div className="space-y-1.5">
        {sessions?.map((u: any) => {
          const isActive = u.isActive;
          const lastLogin = u.lastSignedIn ? fmtDateTime(u.lastSignedIn) : "미접속";
          return (
            <div key={u.id} className={`flex items-center justify-between p-3 rounded-lg border ${isActive ? "border-border" : "border-red-200 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10"}`}>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`w-2 h-2 rounded-full shrink-0 ${isActive ? "bg-emerald-500" : "bg-red-400"}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{u.name} <span className="text-muted-foreground font-normal">@{u.username}</span></p>
                  <p className="text-[10px] text-muted-foreground">{ROLE_LABELS[u.role] ?? u.role} · 최근: {lastLogin}</p>
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1" onClick={() => resetPwMut.mutate({ userId: u.id })} disabled={resetPwMut.isPending}>
                  <KeyRound size={11} /> 비번초기화
                </Button>
                {isActive ? (
                  <Button variant="ghost" size="sm" className="h-7 text-[10px] text-red-500 gap-1" onClick={() => deactivateMut.mutate({ userId: u.id })} disabled={deactivateMut.isPending}>
                    <Lock size={11} /> 비활성화
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" className="h-7 text-[10px] text-emerald-600 gap-1" onClick={() => reactivateMut.mutate({ userId: u.id })} disabled={reactivateMut.isPending}>
                    <Unlock size={11} /> 활성화
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 탭5: 시스템 설정
// ═══════════════════════════════════════════════════════════════════════════════

function SettingsTab() {
  const utils = trpc.useUtils();
  const { data: settings } = trpc.system.getSettings.useQuery();
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const updateMut = trpc.system.updateSetting.useMutation({
    onSuccess() { toast.success("설정 저장 완료"); utils.system.getSettings.invalidate(); setEditKey(null); },
    onError(e) { toast.error(e.message); },
  });

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4"><Settings size={14} className="text-primary" /> 시스템 설정</h3>
      <div className="space-y-2">
        {settings?.map((s: any) => (
          <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{s.settingKey}</p>
              <p className="text-[10px] text-muted-foreground">{s.description || "-"}</p>
            </div>
            {editKey === s.settingKey ? (
              <div className="flex items-center gap-1.5 shrink-0 ml-3">
                <input value={editValue} onChange={e => setEditValue(e.target.value)} className="w-32 px-2 py-1 border border-border rounded text-xs bg-background text-foreground" />
                <Button size="sm" className="h-7 text-xs" onClick={() => updateMut.mutate({ key: s.settingKey, value: editValue })} disabled={updateMut.isPending}>저장</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditKey(null)}>취소</Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <Badge variant="secondary" className="text-xs tabular-nums">{s.settingValue}</Badge>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditKey(s.settingKey); setEditValue(s.settingValue ?? ""); }}>수정</Button>
              </div>
            )}
          </div>
        ))}
        {(!settings || settings.length === 0) && <p className="text-xs text-muted-foreground text-center py-6">설정 항목이 없습니다</p>}
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 탭6: API 사용량
// ═══════════════════════════════════════════════════════════════════════════════

function ApiUsageTab() {
  const [days, setDays] = useState(30);
  const { data: summary } = trpc.system.apiUsageSummary.useQuery({ days });

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">기간:</span>
        {[7, 14, 30].map(d => (
          <Button key={d} variant={days === d ? "default" : "outline"} size="sm" className="h-7 text-xs" onClick={() => setDays(d)}>{d}일</Button>
        ))}
      </div>

      {summary?.byType && summary.byType.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {summary.byType.map((t: any) => (
            <Card key={t.apiType} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-foreground capitalize">{t.apiType}</h4>
                <Badge variant="secondary" className="text-xs tabular-nums">{t.count}회</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-[10px] text-muted-foreground">성공</p><p className="text-sm font-bold text-emerald-600 tabular-nums">{t.successCount}</p></div>
                <div><p className="text-[10px] text-muted-foreground">실패</p><p className="text-sm font-bold text-red-500 tabular-nums">{t.failCount}</p></div>
                <div><p className="text-[10px] text-muted-foreground">평균응답</p><p className="text-sm font-bold text-foreground tabular-nums">{t.avgResponseMs}ms</p></div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-8 text-center"><p className="text-sm text-muted-foreground">API 사용 기록이 없습니다</p></Card>
      )}

      {/* 일별 추이 */}
      {summary?.dailyTrend && summary.dailyTrend.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5"><BarChart3 size={14} /> 일별 API 호출</h3>
          <div className="flex items-end gap-1 h-20">
            {(() => {
              const grouped = summary.dailyTrend.reduce((acc: any, d: any) => {
                acc[d.date] = (acc[d.date] || 0) + d.count;
                return acc;
              }, {} as Record<string, number>);
              const entries = Object.entries(grouped) as [string, number][];
              const max = Math.max(...entries.map(([, v]) => v), 1);
              return entries.map(([date, count]) => (
                <div key={date} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-muted-foreground tabular-nums">{count}</span>
                  <div className="w-full bg-primary/60 rounded-t transition-all" style={{ height: `${Math.max((count / max) * 100, 4)}%` }} />
                  <span className="text-[8px] text-muted-foreground/60 tabular-nums">{String(date).slice(5)}</span>
                </div>
              ));
            })()}
          </div>
        </Card>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 탭7: 데이터 정합성
// ═══════════════════════════════════════════════════════════════════════════════

function IntegrityTab() {
  const { data, isLoading, refetch } = trpc.system.dataIntegrityCheck.useQuery();

  if (isLoading) return <div className="animate-pulse space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted rounded-lg" />)}</div>;

  const issues = data?.issues ?? [];
  const errors = issues.filter(i => i.severity === "error");
  const warnings = issues.filter(i => i.severity === "warning");
  const infos = issues.filter(i => i.severity === "info");

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="grid grid-cols-3 gap-2 flex-1">
          <Card className="p-3 text-center"><p className="text-xs text-muted-foreground">오류</p><p className="text-xl font-bold text-red-500 tabular-nums">{errors.length}</p></Card>
          <Card className="p-3 text-center"><p className="text-xs text-muted-foreground">경고</p><p className="text-xl font-bold text-amber-500 tabular-nums">{warnings.length}</p></Card>
          <Card className="p-3 text-center"><p className="text-xs text-muted-foreground">정보</p><p className="text-xl font-bold text-blue-500 tabular-nums">{infos.length}</p></Card>
        </div>
        <Button variant="outline" size="sm" className="ml-3 gap-1 shrink-0" onClick={() => refetch()}>
          <RefreshCw size={12} /> 재검사
        </Button>
      </div>

      {issues.length === 0 ? (
        <Card className="p-8 text-center">
          <CheckCircle2 size={32} className="text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground">모든 데이터 정합성 양호</p>
          <p className="text-xs text-muted-foreground mt-1">{data?.storeCount ?? 0}개 매장 검사 완료</p>
        </Card>
      ) : (
        <Card className="p-4">
          <div className="space-y-1.5">
            {issues.map((issue, i) => (
              <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-lg border border-border">
                <Badge className={`text-[10px] shrink-0 ${SEVERITY_COLORS[issue.severity]}`}>{issue.severity === "error" ? "오류" : issue.severity === "warning" ? "경고" : "정보"}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">[{issue.store}] {issue.message}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="text-[10px] text-muted-foreground text-right">검사 시각: {data?.checkedAt ? fmtDateTime(data.checkedAt) : "-"}</p>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 탭8: DB 백업
// ═══════════════════════════════════════════════════════════════════════════════

function BackupTab() {
  const utils = trpc.useUtils();
  const { data: backups } = trpc.system.backupList.useQuery();
  const triggerMut = trpc.system.triggerBackup.useMutation({
    onSuccess(data) {
      if (data.ok) toast.success(`백업 완료: ${(data as any).fileName}`);
      else toast.error(`백업 실패: ${(data as any).error}`);
      utils.system.backupList.invalidate();
    },
    onError(e) { toast.error(e.message); },
  });

  return (
    <>
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><HardDrive size={14} className="text-primary" /> DB 백업</h3>
            <p className="text-xs text-muted-foreground mt-1">자동 백업 24시간 주기 · 수동 백업도 가능</p>
          </div>
          <Button size="sm" className="gap-1.5" disabled={triggerMut.isPending} onClick={() => triggerMut.mutate()}>
            <Download size={13} /> {triggerMut.isPending ? "백업 중..." : "지금 백업"}
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">백업 이력</h3>
        {(!backups || backups.length === 0) ? (
          <p className="text-xs text-muted-foreground text-center py-6">백업 기록이 없습니다</p>
        ) : (
          <div className="space-y-1.5">
            {backups.map((b: any) => (
              <div key={b.id} className={`flex items-center justify-between p-2.5 rounded-lg border ${b.status === "success" ? "border-border" : "border-red-200 dark:border-red-900/30"}`}>
                <div className="flex items-center gap-2 min-w-0">
                  {b.status === "success" ? <CheckCircle2 size={14} className="text-emerald-500 shrink-0" /> : <AlertCircle size={14} className="text-red-500 shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{b.fileName}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {b.status === "success"
                        ? `${b.tableCount}개 테이블 · ${fmtBytes(b.fileSizeBytes ?? 0)} · ${(b.durationMs / 1000).toFixed(1)}초`
                        : b.errorMessage}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{fmtDateTime(b.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 탭9: 에러 개요 (기존)
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
      <div className="grid grid-cols-3 gap-2">
        <ErrorStatCard label="24시간" value={summary.data?.last24h ?? 0} />
        <ErrorStatCard label="7일" value={summary.data?.last7d ?? 0} />
        <ErrorStatCard label="유형" value={summary.data?.byType?.length ?? 0} sub="종류" />
      </div>
      {summary.data?.byType && summary.data.byType.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> 유형별 (최근 7일)</h3>
          <div className="flex gap-2 flex-wrap">
            {summary.data.byType.map((t: any) => (
              <span key={t.errorType} className={`text-xs px-2 py-1 rounded-full font-medium ${ERROR_TYPE_COLORS[t.errorType] ?? "bg-muted text-muted-foreground"}`}>{ERROR_TYPE_LABELS[t.errorType] ?? t.errorType} {t.count}건</span>
            ))}
          </div>
        </Card>
      )}
      {trend.data && trend.data.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> 일별 에러 추이 (14일)</h3>
          <div className="flex items-end gap-1 h-20">
            {trend.data.map((d: any) => {
              const h = Math.max((d.count / maxTrend) * 100, 4);
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-muted-foreground tabular-nums">{d.count}</span>
                  <div className="w-full bg-red-400/70 dark:bg-red-500/50 rounded-t transition-all" style={{ height: `${h}%` }} />
                  <span className="text-[8px] text-muted-foreground/60 tabular-nums">{String(d.date).slice(5)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">집계 기간:</span>
        {[7, 14, 30].map(d => (<Button key={d} variant={days === d ? "default" : "outline"} size="sm" className="h-7 text-xs" onClick={() => setDays(d)}>{d}일</Button>))}
      </div>
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5"><Store className="w-3.5 h-3.5" /> 매장별 에러 ({days}일)</h3>
        {byRestaurant.data?.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">에러 없음</p> : (
          <div className="space-y-1.5">{byRestaurant.data?.map((r: any) => (
            <div key={r.restaurantId ?? "null"} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
              <span className="text-sm text-foreground">{r.restaurantName ?? "미지정"}</span>
              <div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">마지막: {r.lastError ? fmtDate(r.lastError) : "-"}</span><span className="text-sm font-bold text-red-500 tabular-nums">{r.count}건</span></div>
            </div>
          ))}</div>
        )}
      </Card>
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> 사용자별 에러 ({days}일)</h3>
        {byUser.data?.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">에러 없음</p> : (
          <div className="space-y-1.5">{byUser.data?.map((u: any) => (
            <div key={u.userId ?? "null"} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
              <span className="text-sm text-foreground">{u.userName ?? u.username ?? "비로그인"}</span>
              <div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">마지막: {u.lastError ? fmtDate(u.lastError) : "-"}</span><span className="text-sm font-bold text-red-500 tabular-nums">{u.count}건</span></div>
            </div>
          ))}</div>
        )}
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 탭10: 에러 목록 (기존)
// ═══════════════════════════════════════════════════════════════════════════════

function ErrorListTab() {
  const [listOffset, setListOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const LIMIT = 30;
  const errorList = trpc.errorLogs.list.useQuery({ limit: LIMIT, offset: listOffset });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">전체 에러 로그 ({errorList.data?.total ?? 0}건)</h3>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={listOffset === 0} onClick={() => setListOffset(Math.max(0, listOffset - LIMIT))}>이전</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={(errorList.data?.rows.length ?? 0) < LIMIT} onClick={() => setListOffset(listOffset + LIMIT)}>다음</Button>
        </div>
      </div>
      <div className="space-y-1">
        {errorList.data?.rows.map((e: any) => (
          <div key={e.id} className="border border-border/50 rounded-lg overflow-hidden">
            <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-muted/30 transition-colors" onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${ERROR_TYPE_COLORS[e.errorType] ?? "bg-muted text-muted-foreground"}`}>{ERROR_TYPE_LABELS[e.errorType] ?? e.errorType}</span>
              <span className="text-xs text-foreground truncate flex-1">{e.message}</span>
              <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{fmtDateTime(e.createdAt)}</span>
              {expandedId === e.id ? <ChevronUp className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
            </button>
            {expandedId === e.id && (
              <div className="px-3 py-2 border-t border-border/30 bg-muted/20 text-xs space-y-1.5">
                <div className="flex gap-4 text-muted-foreground"><span>ID: {e.id}</span><span>User: {e.userId ?? "-"}</span><span>매장: {e.restaurantId ?? "-"}</span></div>
                {e.url && <p className="text-muted-foreground truncate">URL: {e.url}</p>}
                {e.stack && <pre className="text-[10px] text-muted-foreground bg-muted/40 p-2 rounded overflow-x-auto max-h-40 whitespace-pre-wrap break-all">{e.stack}</pre>}
                {e.metadata && <pre className="text-[10px] text-muted-foreground bg-muted/40 p-2 rounded overflow-x-auto max-h-24 whitespace-pre-wrap break-all">{JSON.stringify(e.metadata, null, 2)}</pre>}
              </div>
            )}
          </div>
        ))}
        {errorList.data?.rows.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">에러 로그가 없습니다</p>}
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
      <div className="flex justify-between text-sm mb-1"><span className="text-muted-foreground">{label}</span><span className="font-medium text-foreground tabular-nums">{count}명</span></div>
      <div className="h-2 bg-muted rounded-full overflow-hidden"><div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.max(pct, 2)}%` }} /></div>
    </div>
  );
}

function ErrorStatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card className="p-3 text-center">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-bold text-foreground tabular-nums">{value}<span className="text-xs text-muted-foreground ml-0.5">{sub ?? "건"}</span></p>
    </Card>
  );
}
