import { useRestaurant } from "@/contexts/RestaurantContext";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, EmptyState } from "@/components/ui/compat";
import { DashboardSkeleton } from "@/components/ui/skeletons";
import {
  Store, TrendingUp, TrendingDown, Users, CheckCircle2, XCircle,
  Clock, ShoppingCart, Receipt, CalendarDays, Bell, ChevronRight,
  ClipboardCheck, AlertCircle, Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function ManagerDashboard() {
  const { selectedRestaurant: current, restaurants: stores, isLoading: storesLoading } = useRestaurant();
  const [, setLocation] = useLocation();

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const todayStr = today.toISOString().slice(0, 10);

  const restaurantId = current?.id ?? 0;
  const enabled = restaurantId > 0;

  // ─── 월간 요약 데이터 ────────────────────────────────────────────────────
  const { data: monthlyTotal } = trpc.sales.monthlyTotal.useQuery(
    { restaurantId, year, month }, { enabled }
  );
  const { data: purchaseTotal } = trpc.purchases.monthlyTotal.useQuery(
    { restaurantId, year, month }, { enabled }
  );
  const { data: fixedTotal } = trpc.fixedCosts.monthlyTotal.useQuery(
    { restaurantId, year, month }, { enabled }
  );
  const { data: profitSummary } = trpc.dailyClosings.monthlySummary.useQuery(
    { restaurantId, year, month }, { enabled }
  );

  // ─── 금일 운영 데이터 ────────────────────────────────────────────────────
  const { data: dailyOps } = trpc.dailyOps.getByDate.useQuery(
    { restaurantId, date: todayStr }, { enabled }
  );
  const { data: dailyClosing } = trpc.dailyClosings.getByDate.useQuery(
    { restaurantId, date: todayStr }, { enabled }
  );

  // ─── 스케줄 (7일) ────────────────────────────────────────────────────────
  const { data: upcoming } = trpc.schedules.getUpcoming7Days.useQuery(
    { restaurantId }, { enabled }
  );

  // ─── 중간매출 ───────────────────────────────────────────────────────────
  const { data: midSalesData } = trpc.dailyOps.getMidSales.useQuery(
    { restaurantId, date: todayStr }, { enabled }
  );

  // ─── 알림 ────────────────────────────────────────────────────────────────
  const { data: notifications } = trpc.notifications.listMine.useQuery({ limit: 5 });

  if (storesLoading) return <DashboardSkeleton />;

  if (!current) {
    return (
      <EmptyState
        icon={<Store size={40} />}
        title="배정된 매장이 없습니다"
        description="관리자에게 매장 배정을 요청하세요"
      />
    );
  }

  // ─── 계산 ──────────────────────────────────────────────────────────────────
  const salesNum = Number(monthlyTotal?.total ?? 0);
  const purchasesNum = Number(purchaseTotal?.total ?? 0);
  const fixedNum = Number(fixedTotal?.total ?? 0);
  const laborNum = Number(profitSummary?.laborCost ?? 0);
  const profitNum = salesNum - purchasesNum - laborNum - fixedNum;
  const profitRate = salesNum > 0 ? ((profitNum / salesNum) * 100).toFixed(1) : "0.0";

  // 오픈 체크 상태
  const isOpenChecked = !!dailyOps?.openCheckedAt;
  const openTime = dailyOps?.openCheckedAt
    ? new Date(dailyOps.openCheckedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : null;

  // 일마감 상태
  const isClosed = !!dailyClosing;

  // 오늘 출근자
  const todaySchedules = (upcoming ?? []).filter(s => {
    const d = new Date(s.startTime).toISOString().slice(0, 10);
    return d === todayStr;
  });
  const todayStaffCount = todaySchedules.length;

  // 5일 스케줄 (오늘 포함)
  const fiveDaySchedule = buildFiveDaySchedule(upcoming ?? [], todayStr);

  // 읽지 않은 알림
  const unreadNotifs = (notifications ?? []).filter((n: any) => !n.isRead);

  return (
    <div className="px-4 py-4 space-y-4 max-w-lg mx-auto">
      {/* ─── 헤더 ─── */}
      <div>
        <h1 className="text-base font-bold">{current.name}</h1>
        <p className="text-xs text-muted-foreground">{year}년 {month}월 현황</p>
      </div>

      {/* ─── 섹션 1: 이번 달 수익 요약 ─── */}
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
          <MiniStat label="매입" value={purchasesNum} color="text-orange-400" />
          <MiniStat label="인건비" value={laborNum} color="text-blue-400" />
          <MiniStat label="고정비" value={fixedNum} color="text-muted-foreground" />
        </div>
        <div className="mt-2 pt-2 border-t border-border flex items-center justify-between">
          <span className="text-xs text-muted-foreground">추정 순이익</span>
          <span className={cn(
            "text-sm font-bold",
            profitNum >= 0 ? "text-emerald-500" : "text-red-500"
          )}>
            {profitNum >= 0 ? "+" : ""}{formatKRW(profitNum)}원
          </span>
        </div>
      </Card>

      {/* ─── 섹션 2: 금일 매장 상황 ─── */}
      <Card className="p-3">
        <h2 className="text-sm font-semibold mb-3">금일 매장 상황</h2>
        <div className="space-y-2">
          {/* 출근 인원 */}
          <StatusRow
            icon={<Users size={14} />}
            label="출근 인원"
            value={`${todayStaffCount}명`}
            status={todayStaffCount > 0 ? "ok" : "warn"}
            onClick={() => setLocation("/schedule")}
          />
          {/* 오픈 체크 */}
          <StatusRow
            icon={<CheckCircle2 size={14} />}
            label="오픈 체크"
            value={isOpenChecked ? `완료 ${openTime}` : "미완료"}
            status={isOpenChecked ? "ok" : "warn"}
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
            onClick={() => setLocation("/daily-ops")}
          />
          {/* 매입 현황 */}
          <StatusRow
            icon={<ShoppingCart size={14} />}
            label="금일 매입"
            value={dailyClosing ? formatKRW(Number(dailyClosing.purchasesTotal ?? 0)) + "원" : "—"}
            status="neutral"
            onClick={() => setLocation("/purchases")}
          />
          {/* 일마감 */}
          <StatusRow
            icon={<ClipboardCheck size={14} />}
            label="일마감"
            value={isClosed ? "마감 완료" : "미마감"}
            status={isClosed ? "ok" : "warn"}
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
            {unreadNotifs.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold bg-destructive text-destructive-foreground rounded-full">
                {unreadNotifs.length}
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
  icon, label, value, status, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  status: "ok" | "warn" | "neutral";
  onClick?: () => void;
}) {
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

function formatKRW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 100000000) return sign + (abs / 100000000).toFixed(1).replace(/\.0$/, "") + "억";
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
  upcoming: Array<{ startTime: string | Date; userName?: string | null; status?: string }>,
  todayStr: string,
): DaySchedule[] {
  const days: DaySchedule[] = [];
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];

  for (let i = 0; i < 5; i++) {
    const d = new Date(todayStr);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayOfWeek = dayNames[d.getDay()];
    const label = i === 0 ? `오늘 (${dayOfWeek})` : `${d.getMonth() + 1}/${d.getDate()} (${dayOfWeek})`;

    const daySchedules = upcoming.filter(s => {
      const sd = new Date(s.startTime).toISOString().slice(0, 10);
      return sd === dateStr;
    });

    days.push({
      date: dateStr,
      label,
      isToday: i === 0,
      count: daySchedules.length,
      names: daySchedules.map(s => s.userName ?? "").filter(Boolean).slice(0, 3),
    });
  }
  return days;
}
