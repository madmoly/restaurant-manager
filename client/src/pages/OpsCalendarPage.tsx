import { useState, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { getHolidayName } from "@/lib/koreanHolidays";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  XCircle,
  Users,
  TrendingUp,
  ClipboardCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function fmtWon(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}만`;
  return n.toLocaleString();
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function OpsCalendarPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const prevMonth = () => {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  };
  const goThisMonth = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth() + 1);
  };

  const { data: calData } = trpc.dailyOps.getMonthlyCalendar.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 },
  );

  const daysInMonth = getDaysInMonth(year, month);
  const firstDow = getFirstDayOfWeek(year, month);

  // 월 통계
  const stats = useMemo(() => {
    if (!calData) return { totalSales: 0, closedDays: 0, avgSales: 0 };
    const salesDays = Object.values(calData.days).filter((d) => d.totalSales > 0).length;
    return {
      totalSales: calData.totalSales,
      closedDays: calData.closedDays,
      avgSales: salesDays > 0 ? Math.round(calData.totalSales / salesDays) : 0,
    };
  }, [calData]);

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  if (!current) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
          <CalendarDays className="w-5 h-5" />
          운영 캘린더
        </h1>
        <span className="text-xs text-muted-foreground">{current.name}</span>
      </div>

      {/* 월 네비게이션 */}
      <div className="flex items-center justify-between bg-card border border-border rounded-lg p-3">
        <Button variant="ghost" size="sm" onClick={prevMonth}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="text-center">
          <div className="text-base font-bold text-foreground">
            {year}년 {month}월
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={nextMonth}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {/* 월간 요약 카드 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">월 매출</div>
          <div className="text-sm font-bold text-foreground">
            {stats.totalSales > 0 ? `₩${fmtWon(stats.totalSales)}` : "-"}
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">마감 완료</div>
          <div className="text-sm font-bold text-foreground">{stats.closedDays}일</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">일평균</div>
          <div className="text-sm font-bold text-foreground">
            {stats.avgSales > 0 ? `₩${fmtWon(stats.avgSales)}` : "-"}
          </div>
        </div>
      </div>

      {/* 캘린더 그리드 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 border-b border-border">
          {DAY_LABELS.map((d, i) => (
            <div
              key={d}
              className={`text-center text-xs font-medium py-2 ${
                i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-muted-foreground"
              }`}
            >
              {d}
            </div>
          ))}
        </div>

        {/* 날짜 셀 */}
        <div className="grid grid-cols-7">
          {/* 첫째 주 빈 칸 */}
          {Array.from({ length: firstDow }).map((_, i) => (
            <div key={`empty-${i}`} className="border-b border-r border-border min-h-[72px]" />
          ))}

          {Array.from({ length: daysInMonth }).map((_, idx) => {
            const day = idx + 1;
            const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const dow = (firstDow + idx) % 7;
            const dayData = calData?.days[dateStr];
            const holiday = getHolidayName(dateStr);
            const isToday = dateStr === todayStr;
            const isFuture = dateStr > todayStr;

            const statusColor =
              dayData?.status === "closed"
                ? "text-green-600"
                : dayData?.status === "open"
                  ? "text-amber-500"
                  : "text-muted-foreground/30";

            const StatusIcon =
              dayData?.status === "closed"
                ? CheckCircle2
                : dayData?.status === "open"
                  ? Clock
                  : XCircle;

            return (
              <div
                key={day}
                className={`border-b border-r border-border min-h-[72px] p-1 relative ${
                  isToday ? "bg-primary/5 ring-1 ring-primary/30 ring-inset" : ""
                } ${isFuture ? "opacity-40" : ""}`}
              >
                {/* 날짜 */}
                <div className="flex items-center justify-between mb-0.5">
                  <span
                    className={`text-xs font-medium ${
                      dow === 0 || holiday ? "text-red-500" : dow === 6 ? "text-blue-500" : "text-foreground"
                    } ${isToday ? "bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-[10px]" : ""}`}
                  >
                    {day}
                  </span>
                  {!isFuture && dayData && (
                    <StatusIcon className={`w-3 h-3 ${statusColor}`} />
                  )}
                </div>

                {/* 공휴일명 */}
                {holiday && (
                  <div className="text-[9px] text-red-400 truncate leading-tight">{holiday}</div>
                )}

                {/* 매출 */}
                {dayData && dayData.totalSales > 0 && (
                  <div className="text-[10px] font-medium text-foreground mt-0.5 flex items-center gap-0.5">
                    <TrendingUp className="w-2.5 h-2.5 text-emerald-500 shrink-0" />
                    <span className="truncate">{fmtWon(dayData.totalSales)}</span>
                  </div>
                )}

                {/* 출근인원 */}
                {dayData && (dayData.openHeadcount > 0 || dayData.closeHeadcount > 0) && (
                  <div className="text-[9px] text-muted-foreground flex items-center gap-0.5 mt-0.5">
                    <Users className="w-2.5 h-2.5 shrink-0" />
                    {dayData.openHeadcount || dayData.closeHeadcount}명
                  </div>
                )}

                {/* 체크리스트 완료 */}
                {dayData?.checklist && dayData.checklist.total > 0 && (
                  <div className={`text-[9px] flex items-center gap-0.5 mt-0.5 ${
                    dayData.checklist.checked >= dayData.checklist.total ? "text-emerald-600" : "text-amber-500"
                  }`}>
                    <ClipboardCheck className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">{dayData.checklist.types.length >= 3 ? "✓" : `${dayData.checklist.checked}/${dayData.checklist.total}`}</span>
                  </div>
                )}

                {/* 스케줄 현황 */}
                {dayData?.schedule && dayData.schedule.total > 0 && (
                  <div className={`text-[9px] flex items-center gap-0.5 mt-0.5 ${
                    dayData.schedule.completed === dayData.schedule.total ? "text-emerald-600"
                    : dayData.schedule.completed > 0 ? "text-blue-500"
                    : "text-muted-foreground"
                  }`}>
                    <Users className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">{dayData.schedule.completed}/{dayData.schedule.total}</span>
                  </div>
                )}
              </div>
            );
          })}

          {/* 마지막 주 빈 칸 */}
          {(() => {
            const lastDow = (firstDow + daysInMonth - 1) % 7;
            const remaining = lastDow < 6 ? 6 - lastDow : 0;
            return Array.from({ length: remaining }).map((_, i) => (
              <div key={`end-${i}`} className="border-b border-r border-border min-h-[72px]" />
            ));
          })()}
        </div>
      </div>

      {/* 범례 */}
      <div className="flex flex-wrap items-center gap-3 justify-center text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-green-600" /> 마감완료
        </div>
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3 text-amber-500" /> 오픈만
        </div>
        <div className="flex items-center gap-1">
          <XCircle className="w-3 h-3 text-muted-foreground/30" /> 미운영
        </div>
        <div className="flex items-center gap-1">
          <ClipboardCheck className="w-3 h-3 text-emerald-600" /> 체크리스트
        </div>
        <div className="flex items-center gap-1">
          <Users className="w-3 h-3 text-blue-500" /> 스케줄
        </div>
      </div>

      {/* 이번 달 아닌 경우 오늘로 이동 버튼 */}
      {(year !== today.getFullYear() || month !== today.getMonth() + 1) && (
        <div className="text-center">
          <Button variant="outline" size="sm" onClick={goThisMonth}>
            이번 달로
          </Button>
        </div>
      )}
    </div>
  );
}
