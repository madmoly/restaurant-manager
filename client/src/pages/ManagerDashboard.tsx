import { useRestaurant } from "@/contexts/RestaurantContext";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, EmptyState } from "@/components/ui/compat";
import { DashboardSkeleton } from "@/components/ui/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Store, TrendingUp, TrendingDown, Users, CheckCircle2, XCircle,
  Clock, ShoppingCart, Receipt, CalendarDays, Bell, ChevronRight,
  ClipboardCheck, AlertCircle, Minus, FileWarning,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function ManagerDashboard() {
  const { selectedRestaurant: current, restaurants: stores, isLoading: storesLoading } = useRestaurant();
  const [, setLocation] = useLocation();

  const today = new Date();
  // KST 영업일 기준 (새벽 3시 이전이면 전날)
  const toKSTDateStr = (d: Date) => {
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  };
  const toBizDateStr = (d: Date) => {
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const biz = new Date(kst.getTime() - 3 * 60 * 60 * 1000); // 3시간 빼서 영업일 기준
    return biz.toISOString().slice(0, 10);
  };
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const todayStr = toBizDateStr(today);
  // 영업일 기준 날짜 객체 (표시용)
  const bizDate = new Date(todayStr + "T12:00:00+09:00");
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const bizDateLabel = `${bizDate.getMonth() + 1}월 ${bizDate.getDate()}일 ${dayNames[bizDate.getDay()]}요일`;

  const restaurantId = current?.id ?? 0;
  const enabled = restaurantId > 0;

  // ─── 월간 요약 데이터 (수익분석과 동일한 settlementData) ────────────────
  const { data: settlement, isLoading: settlementLoading } = trpc.monthlyClosings.settlementData.useQuery(
    { restaurantId, year, month }, { enabled }
  );

  // ─── 금일 운영 데이터 ────────────────────────────────────────────────────
  const { data: dailyOps, isLoading: dailyOpsLoading } = trpc.dailyOps.getByDate.useQuery(
    { restaurantId, date: todayStr }, { enabled }
  );
  const { data: dailyClosing, isLoading: dailyClosingLoading } = trpc.dailyClosings.getByDate.useQuery(
    { restaurantId, date: todayStr }, { enabled }
  );

  // ─── 스케줄 (7일) ────────────────────────────────────────────────────────
  const { data: upcoming, isLoading: upcomingLoading } = trpc.schedules.getUpcoming7Days.useQuery(
    { restaurantId }, { enabled }
  );

  // ─── 중간매출 ───────────────────────────────────────────────────────────
  const { data: midSalesData, isLoading: midSalesLoading } = trpc.dailyOps.getMidSales.useQuery(
    { restaurantId, date: todayStr }, { enabled }
  );

  // ─── 이번 달 운영일지 누락 ────────────────────────────────────────────────
  const { data: logGaps, isLoading: logGapsLoading } = trpc.dailyOps.getMonthlyLogGaps.useQuery(
    { restaurantId, year, month }, { enabled }
  );

  // ─── 알림 ────────────────────────────────────────────────────────────────
  const { data: notifications } = trpc.notifications.listMine.useQuery({ limit: 5 });
  const { data: unreadCountData } = trpc.notifications.unreadCount.useQuery();

  // ─── 미입�� 발주 리마인더 ─────────────────────────
  const unreceivedQuery = trpc.purchasesV2.listUnreceived.useQuery(
    { restaurantId },
    { enabled },
  );
  const toggleReceivedMut = trpc.purchasesV2.toggleReceived.useMutation({
    onSuccess() { unreceivedQuery.refetch(); },
  });

  if (storesLoading) return <DashboardSkeleton />;

  if (!current) {
    // 매장 자체가 없는 경우 vs 매장은 있지만 미선택인 경우 분기
    if ((stores ?? []).length === 0) {
      return (
        <EmptyState
          icon={<Store size={40} />}
          title="배정된 매장이 없습니다"
          description="관리자에게 매장 배정을 요청하세요"
        />
      );
    }
    return (
      <EmptyState
        icon={<Store size={40} />}
        title="매장을 먼저 선택하세요"
        description="상단 헤더 또는 사이드바의 매장 선택기에서 매장을 선택하면 대시보드가 표시됩니다"
      />
    );
  }

  // ─── 계산 (수익분석 settlementData 권위값 그대로 사용) ─────────────────────
  const inc = settlement?.income;
  const mtr = settlement?.metrics;
  const salesNum = Number(inc?.salesTotal ?? 0);
  const purchasesNum = Number(inc?.purchasesTotal ?? 0);
  const laborNum = Number(inc?.laborCost ?? 0);
  const fixedNum = Number(inc?.fixedCostsTotal ?? 0);    // 비례 포함
  const expensesNum = Number(inc?.expensesTotal ?? 0);   // 경비
  const profitNum = Number(inc?.profit ?? 0);            // 서버 산식
  const profitRate = salesNum > 0 ? (profitNum / salesNum * 100).toFixed(1) : "0.0";
  const costRatio = mtr?.costRatio ?? 0;
  const laborRatio = mtr?.laborRatio ?? 0;
  const profitRatio = mtr?.profitRatio ?? 0;

  // 오픈 체크 상태
  const isOpenChecked = !!dailyOps?.openCheckedAt;
  const openTime = dailyOps?.openCheckedAt
    ? new Date(dailyOps.openCheckedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : null;

  // 일마감 상태
  const isClosed = !!dailyClosing;

  // 오늘 출근자 (KST 기준)
  const todaySchedules = (upcoming ?? []).filter(s => {
    const d = toKSTDateStr(new Date(s.startTime));
    return d === todayStr;
  });
  const todayStaffCount = todaySchedules.length;

  // 5일 스케줄 (오늘 포함)
  const fiveDaySchedule = buildFiveDaySchedule(upcoming ?? [], todayStr);

  // 읽지 않은 알림 (전체 개수 — 목록은 최근 5건만 표시)
  const unreadCount = unreadCountData?.count ?? 0;

  return (
    <div className="px-4 py-4 space-y-4 max-w-lg mx-auto">
      {/* ─── 헤더 ─── */}
      <div>
        <h1 className="text-base font-bold">{current.name}</h1>
        <p className="text-xs text-muted-foreground">{year}년 {month}월 현황</p>
      </div>

      {/* ─── 미입고 발주 리마인더 ─── */}
      {(unreceivedQuery.data ?? []).length > 0 && (
        <Card className="p-3 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <div className="flex items-center gap-2 mb-2">
            <ShoppingCart size={14} className="text-amber-600" />
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">미입고 발주 {(unreceivedQuery.data ?? []).length}건</span>
          </div>
          <div className="space-y-1.5">
            {(unreceivedQuery.data ?? []).slice(0, 3).map((item: any) => (
              <div key={item.id} className="flex items-center justify-between text-xs">
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{item.counterpartyName}</span>
                  <span className="text-muted-foreground ml-1 truncate">{item.content?.slice(0, 20)}</span>
                </div>
                <button
                  onClick={() => toggleReceivedMut.mutate({ restaurantId, id: item.id, isReceived: true })}
                  disabled={toggleReceivedMut.isPending}
                  className="shrink-0 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 hover:bg-amber-200"
                >
                  입고확인
                </button>
              </div>
            ))}
            {(unreceivedQuery.data ?? []).length > 3 && (
              <button onClick={() => setLocation('/daily-ops')} className="text-[10px] text-amber-600 dark:text-amber-400 hover:underline">
                +{(unreceivedQuery.data ?? []).length - 3}건 더보기
              </button>
            )}
          </div>
        </Card>
      )}

      {/* ─── 이번 달 운영일지 누락 ─── */}
      <Card className="p-3">
        <h2 className="text-sm font-semibold mb-2">운영일지</h2>
        {logGapsLoading ? (
          <Skeleton className="h-4 w-2/3" />
        ) : (logGaps?.gaps.length ?? 0) === 0 ? (
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">운영일지 누락없음</span>
            <span className="text-[10px] text-muted-foreground ml-auto">영업일 {logGaps?.checkedDays ?? 0}일 확인</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 mb-1">
              <FileWarning size={14} className="text-amber-600 shrink-0" />
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                운영일지 미작성 {logGaps!.totalGapTabs}건 ({logGaps!.gaps.length}일)
              </span>
            </div>
            {logGaps!.gaps.slice(0, 5).map((g) => (
              <button
                key={g.date}
                onClick={() => setLocation(`/daily-ops?date=${g.date}&tab=${g.tabs[0]}`)}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors text-left"
              >
                <span className="text-xs font-medium text-foreground w-20 shrink-0">{formatGapDate(g.date)}</span>
                <span className="flex flex-wrap gap-1 flex-1 min-w-0">
                  {g.tabs.map((t) => (
                    <span
                      key={t}
                      role="link"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); setLocation(`/daily-ops?date=${g.date}&tab=${t}`); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          setLocation(`/daily-ops?date=${g.date}&tab=${t}`);
                        }
                      }}
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900"
                    >
                      {TAB_LABELS[t] ?? t}
                    </span>
                  ))}
                </span>
                <ChevronRight size={12} className="text-muted-foreground/50 shrink-0" />
              </button>
            ))}
            {logGaps!.gaps.length > 5 && (
              <button
                onClick={() => setLocation('/ops-calendar')}
                className="text-[10px] text-amber-600 dark:text-amber-400 hover:underline"
              >
                +{logGaps!.gaps.length - 5}일 더보기
              </button>
            )}
          </div>
        )}
      </Card>

      {/* ─── 섹션 1: 이번 달 수익 요약 ─── */}
      {settlementLoading ? (
        <Card className="p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">이번 달 수익</h2>
            <Skeleton className="h-4 w-12" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}
          </div>
          <Skeleton className="h-4 w-1/2" />
        </Card>
      ) : (
      <Card className="p-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">이번 달 수익</h2>
          <div className={cn(
            "flex items-center gap-1 text-sm font-bold",
            profitNum >= 0 ? "text-emerald-500" : "text-red-500"
          )}>
            {profitNum >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {profitRate}%
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="매출" value={salesNum} color="text-emerald-400" />
          <MiniStat label={`매입 (${costRatio}%)`} value={purchasesNum} color="text-orange-400" />
          <MiniStat label={`인건비 (${laborRatio}%)`} value={laborNum} color="text-blue-400" />
          <MiniStat label="고정비" value={fixedNum} color="text-muted-foreground" />
        </div>
        {expensesNum > 0 && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <MiniStat label="경비" value={expensesNum} color="text-cyan-400" />
          </div>
        )}
        <div className="mt-2 pt-2 border-t border-border flex items-center justify-between">
          <span className="text-xs text-muted-foreground">순이익 ({profitRatio}%)</span>
          <span className={cn(
            "text-sm font-bold",
            profitNum >= 0 ? "text-emerald-500" : "text-red-500"
          )}>
            {profitNum >= 0 ? "+" : ""}{formatKRW(profitNum)}원
          </span>
        </div>
      </Card>
      )}

      {/* ─── 섹션 2: 매장 상황 ─── */}
      <Card className="p-3">
        <h2 className="text-sm font-semibold mb-3">{bizDateLabel} 매장 상황</h2>
        <div className="space-y-2">
          {/* 출근 인원 */}
          <StatusRow
            icon={<Users size={14} />}
            label="출근 인원"
            value={`${todayStaffCount}명`}
            status={todayStaffCount > 0 ? "ok" : "warn"}
            loading={upcomingLoading}
            onClick={() => setLocation("/schedule")}
          />
          {/* 오픈 체크 */}
          <StatusRow
            icon={<CheckCircle2 size={14} />}
            label="오픈 체크"
            value={isOpenChecked ? `완료 ${openTime}` : "미완료"}
            status={isOpenChecked ? "ok" : "warn"}
            loading={dailyOpsLoading}
            onClick={() => setLocation("/daily-ops")}
          />
          {/* 중간 매출 */}
          <StatusRow
            icon={<Receipt size={14} />}
            label="중간 매출"
            value={midSalesData && midSalesData.length > 0
              ? (() => {
                  const latest = midSalesData[midSalesData.length - 1] as any;
                  const totalAmt = midSalesData.reduce((s: number, m: any) => s + Number(m.amount), 0);
                  const totalReceipts = midSalesData.reduce((s: number, m: any) => s + (m.receiptCount || 0), 0);
                  const time = new Date(latest.recordedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                  return `${time} ${formatKRW(totalAmt)}원${totalReceipts > 0 ? ` (${totalReceipts}건)` : ''}`;
                })()
              : "입력 없음"}
            status={midSalesData && midSalesData.length > 0 ? "ok" : "neutral"}
            loading={midSalesLoading}
            onClick={() => setLocation("/daily-ops")}
          />
          {/* 매입 현황 */}
          <StatusRow
            icon={<ShoppingCart size={14} />}
            label="금일 매입"
            value={dailyClosing ? formatKRW(Number(dailyClosing.purchasesTotal ?? 0)) + "원" : "—"}
            status="neutral"
            loading={dailyClosingLoading}
            onClick={() => setLocation("/purchases")}
          />
          {/* 일마감 */}
          <StatusRow
            icon={<ClipboardCheck size={14} />}
            label="일마감"
            value={isClosed ? "마감 완료" : "미마감"}
            status={isClosed ? "ok" : "warn"}
            loading={dailyClosingLoading}
            onClick={() => setLocation("/daily-ops")}
          />
        </div>
      </Card>

      {/* ─── 섹션 3: 향후 5일 스케줄 ─── */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">향후 스케줄</h2>
          <button
            className="text-xs text-primary flex items-center gap-0.5"
            onClick={() => setLocation("/schedule")}
          >
            전체 보기 <ChevronRight size={12} />
          </button>
        </div>
        <div className="space-y-1.5">
          {fiveDaySchedule.map((day) => (
            <div
              key={day.date}
              className={cn(
                "flex items-center gap-3 px-2 py-1.5 rounded-lg text-xs",
                day.isToday && "bg-primary/10"
              )}
            >
              <div className="w-14 shrink-0">
                <span className={cn(
                  "font-semibold",
                  day.isToday ? "text-primary" : "text-foreground"
                )}>
                  {day.label}
                </span>
              </div>
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <Users size={12} className="text-muted-foreground shrink-0" />
                <span className={cn(
                  "font-medium",
                  day.count > 0 ? "text-foreground" : "text-muted-foreground"
                )}>
                  {day.count}명
                </span>
                {day.names.length > 0 && (
                  <span className="text-muted-foreground truncate">
                    {day.names.join(", ")}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ─── 섹션 4: 최근 알림 ─── */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">
            알림
            {unreadCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-5 h-5 px-1 text-[10px] font-bold bg-destructive text-destructive-foreground rounded-full">
                {unreadCount}
              </span>
            )}
          </h2>
        </div>
        {(!notifications || notifications.length === 0) ? (
          <p className="text-xs text-muted-foreground text-center py-4">알림이 없습니다</p>
        ) : (
          <div className="space-y-1.5">
            {(notifications as any[]).slice(0, 5).map((n) => (
              <div
                key={n.id}
                className={cn(
                  "flex items-start gap-2 px-2 py-1.5 rounded-lg text-xs",
                  !n.isRead && "bg-primary/5"
                )}
              >
                {!n.isRead && <span className="mt-1 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">{n.title}</p>
                  {n.content && (
                    <p className="text-muted-foreground line-clamp-1 mt-0.5">{n.content}</p>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {formatRelativeTime(n.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── 서브 컴포넌트 ──────────────────────────────────────────────────────────

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-muted/50">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-xs font-semibold", color)}>{formatKRW(value)}원</span>
    </div>
  );
}

function StatusRow({
  icon, label, value, status, onClick, loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  status: "ok" | "warn" | "neutral";
  onClick?: () => void;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-left">
        <span className="text-muted-foreground shrink-0">{icon}</span>
        <span className="text-xs text-muted-foreground flex-1">{label}</span>
        <Skeleton className="h-3 w-16" />
      </div>
    );
  }

  const statusColor = status === "ok"
    ? "text-emerald-500"
    : status === "warn"
    ? "text-amber-500"
    : "text-muted-foreground";

  const statusIcon = status === "ok"
    ? <CheckCircle2 size={12} className="text-emerald-500" />
    : status === "warn"
    ? <AlertCircle size={12} className="text-amber-500" />
    : <Minus size={12} className="text-muted-foreground" />;

  return (
    <button
      className="flex items-center gap-2 w-full px-2 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
      onClick={onClick}
    >
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="text-xs text-muted-foreground flex-1">{label}</span>
      <span className={cn("text-xs font-medium", statusColor)}>{value}</span>
      {statusIcon}
      <ChevronRight size={12} className="text-muted-foreground/50" />
    </button>
  );
}

// ─── 유틸리티 ───────────────────────────────────────────────────────────────

// 일일운영 탭 한글 라벨 (DailyOpsPage와 동일)
const TAB_LABELS: Record<string, string> = {
  open: "오픈",
  purchase: "매입",
  midday: "일간보고",
  close: "마감",
};

/** "2026-08-14" → "8/14 (목)" */
function formatGapDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00+09:00");
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}/${d.getDate()} (${dayNames[d.getDay()]})`;
}

function formatKRW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 100000000) return sign + Math.round(abs / 100000000) + "억";
  if (abs >= 10000) return sign + Math.round(abs / 10000).toLocaleString() + "만";
  return sign + abs.toLocaleString();
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

interface DaySchedule {
  date: string;
  label: string;
  isToday: boolean;
  count: number;
  names: string[];
}

function buildFiveDaySchedule(
  upcoming: Array<{
    startTime: string | Date;
    userName?: string | null;
    tempWorkerName?: string | null;
    tempWorkerTag?: string | null;
    status?: string;
  }>,
  todayStr: string,
): DaySchedule[] {
  const days: DaySchedule[] = [];
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  // KST 날짜 변환 헬퍼
  const toKST = (d: Date) => {
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  };

  for (let i = 0; i < 5; i++) {
    // todayStr은 이미 KST 날짜 → KST 자정 기준으로 Date 생성
    const d = new Date(todayStr + "T00:00:00+09:00");
    d.setDate(d.getDate() + i);
    const dateStr = toKST(d);
    const dayOfWeek = dayNames[d.getDay()];
    const label = i === 0 ? `오늘 (${dayOfWeek})` : `${d.getMonth() + 1}/${d.getDate()} (${dayOfWeek})`;

    const daySchedules = upcoming.filter(s => {
      const sd = toKST(new Date(s.startTime));
      return sd === dateStr;
    });

    days.push({
      date: dateStr,
      label,
      isToday: i === 0,
      count: daySchedules.length,
      names: daySchedules.map(s => s.userName ?? (s.tempWorkerName ? (s.tempWorkerTag ? `${s.tempWorkerName} (${s.tempWorkerTag})` : s.tempWorkerName) : null) ?? "").filter(Boolean).slice(0, 3),
    });
  }
  return days;
}
