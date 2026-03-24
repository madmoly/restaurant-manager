import { useMemo } from "react";
import { trpc } from "../lib/trpc";
import { useAuth } from "../hooks/useAuth";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ClipboardList, CalendarDays, Clock, CheckCircle2,
  AlertCircle, ChevronRight, Loader2,
} from "lucide-react";

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtTime(s: string | Date) {
  const d = typeof s === "string" ? new Date(s) : s;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const LEAVE_TYPE_LABELS: Record<string, string> = {
  dayoff: "휴무",
  half_morning: "반차출근",
  half_evening: "반차퇴근",
};
const STATUS_COLORS: Record<string, string> = {
  pending: "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/20",
  approved: "text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/20",
  rejected: "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/20",
};
const STATUS_LABELS: Record<string, string> = {
  pending: "대기",
  approved: "승인",
  rejected: "거절",
};

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const { selectedRestaurantId, selectedRestaurant } = useRestaurant();
  const today = fmtDate(new Date());

  // 오늘 내 스케줄
  const weekStart = useMemo(() => {
    const d = new Date();
    const day = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() - ((day + 6) % 7));
    return fmtDate(mon);
  }, []);
  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return fmtDate(d);
  }, [weekStart]);

  const schedulesQuery = trpc.schedules.listByRestaurant.useQuery(
    { restaurantId: selectedRestaurantId!, from: weekStart, to: weekEnd + "T23:59:59" },
    { enabled: !!selectedRestaurantId },
  );

  // 일일운영 체크리스트 상태
  const dailyOpsQuery = trpc.dailyOps.getByDate.useQuery(
    { restaurantId: selectedRestaurantId!, date: today },
    { enabled: !!selectedRestaurantId },
  );

  // 내 휴무 신청
  const leaveQuery = trpc.leaveRequests.listMine.useQuery(
    { restaurantId: selectedRestaurantId! },
    { enabled: !!selectedRestaurantId },
  );

  const mySchedules = useMemo(() => {
    if (!schedulesQuery.data || !user) return [];
    return schedulesQuery.data.filter((s: any) => s.userId === user.id);
  }, [schedulesQuery.data, user]);

  const todaySchedules = mySchedules.filter((s: any) => {
    const d = typeof s.startTime === "string" ? s.startTime.substring(0, 10) : fmtDate(new Date(s.startTime));
    return d === today;
  });

  const pendingLeaves = (leaveQuery.data || []).filter((l: any) => l.status === "pending");

  if (!selectedRestaurantId) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        매장을 선택해주세요
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      {/* 인사 헤더 */}
      <div>
        <h1 className="text-lg font-bold text-foreground">
          {user?.name}님, 안녕하세요
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {selectedRestaurant?.name} &middot; {new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })}
        </p>
      </div>

      {/* 오늘 내 스케줄 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            오늘 내 근무
          </CardTitle>
        </CardHeader>
        <CardContent>
          {schedulesQuery.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : todaySchedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">오늘 배정된 근무가 없습니다</p>
          ) : (
            <div className="space-y-2">
              {todaySchedules.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between p-2 rounded-lg bg-primary/5 border border-primary/10">
                  <div>
                    <span className="text-sm font-medium text-foreground">
                      {fmtTime(s.startTime)} ~ {fmtTime(s.endTime)}
                    </span>
                    {s.shiftPreset && s.shiftPreset !== "custom" && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({s.shiftPreset === "open" ? "오픈" : s.shiftPreset === "close" ? "마감" : "풀타임"})
                      </span>
                    )}
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    s.status === "confirmed" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                    : s.status === "completed" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                  }`}>
                    {s.status === "confirmed" ? "확정" : s.status === "completed" ? "완료" : s.status === "draft" ? "초안" : s.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 일일 운영 업무 요약 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            오늘 업무
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dailyOpsQuery.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (() => {
            const ops = dailyOpsQuery.data;
            const tasks = [
              { label: "오픈 체크", done: !!ops?.openCheckedAt },
              { label: "마감 체크", done: !!ops?.closeCheckedAt },
            ];
            const completedCount = tasks.filter(t => t.done).length;
            return (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{completedCount}/{tasks.length} 완료</span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${(completedCount / tasks.length) * 100}%` }}
                    />
                  </div>
                </div>
                {tasks.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {t.done ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                    )}
                    <span className={t.done ? "text-muted-foreground line-through" : "text-foreground"}>{t.label}</span>
                  </div>
                ))}
                <Link href="/daily-ops">
                  <Button variant="outline" size="sm" className="w-full mt-1 text-xs h-8">
                    일일 운영 바로가기 <ChevronRight className="h-3 w-3 ml-1" />
                  </Button>
                </Link>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* 이번 주 스케줄 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            이번 주 근무
          </CardTitle>
        </CardHeader>
        <CardContent>
          {schedulesQuery.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : mySchedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">이번 주 배정된 근무가 없습니다</p>
          ) : (
            <div className="space-y-1.5">
              {mySchedules.map((s: any) => {
                const d = new Date(s.startTime);
                const dayStr = d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", weekday: "short" });
                const isToday = fmtDate(d) === today;
                return (
                  <div key={s.id} className={`flex items-center justify-between text-sm px-2 py-1.5 rounded ${isToday ? "bg-primary/10 font-medium" : ""}`}>
                    <span className={isToday ? "text-primary" : "text-foreground"}>{dayStr}</span>
                    <span className="text-muted-foreground text-xs">
                      {fmtTime(s.startTime)} ~ {fmtTime(s.endTime)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <Link href="/schedule">
            <Button variant="outline" size="sm" className="w-full mt-2 text-xs h-8">
              스케줄 전체보기 <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* 휴무/반차 신청 현황 */}
      {pendingLeaves.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertCircle className="h-4 w-4" />
              대기 중인 신청 {pendingLeaves.length}건
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {pendingLeaves.slice(0, 5).map((l: any) => (
                <div key={l.id} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">
                    {typeof l.leaveDate === "string" ? l.leaveDate : new Date(l.leaveDate).toISOString().substring(0, 10)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {LEAVE_TYPE_LABELS[l.leaveType] || l.leaveType}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
