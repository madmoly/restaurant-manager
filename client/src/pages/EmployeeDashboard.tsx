import { useState, useMemo } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useRestaurant } from "@/contexts/RestaurantContext";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, Bell, DollarSign, ArrowRight, RefreshCw, ClipboardList, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { todayKST, toKSTDateString } from "@/lib/dateKST";

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

const SCHEDULE_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  draft:     { label: "초안",   className: "bg-gray-100 text-gray-600 border-gray-200" },
  published: { label: "고지됨", className: "bg-blue-100 text-blue-700 border-blue-200" },
  completed: { label: "완료",   className: "bg-green-100 text-green-700 border-green-200" },
  confirmed: { label: "확정",   className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  canceled:  { label: "취소",   className: "bg-red-100 text-red-600 border-red-200" },
};

const CHANGE_REQUEST_STATUS: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  pending:  { label: "검토중", icon: <AlertCircle className="h-3 w-3" />, className: "bg-amber-100 text-amber-700 border-amber-200" },
  approved: { label: "승인됨", icon: <CheckCircle2 className="h-3 w-3" />, className: "bg-green-100 text-green-700 border-green-200" },
  rejected: { label: "반려됨", icon: <XCircle className="h-3 w-3" />, className: "bg-red-100 text-red-600 border-red-200" },
};

const CHANGE_REQUEST_TYPE: Record<string, string> = {
  swap:   "교대 요청",
  change: "시간 변경",
  off:    "휴무 요청",
};

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const now = new Date();
  const [showAllRequests, setShowAllRequests] = useState(false);

  const { selectedRestaurant: activeRestaurant } = useRestaurant();

  const upcomingDates = useMemo(() => Array.from({ length: 5 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    return toKSTDateString(d);
  }), []);

  const schedulesQuery = trpc.schedules.listByRestaurantAndRange.useQuery(
    { restaurantId: activeRestaurant?.id ?? 0, startDate: upcomingDates[0], endDate: upcomingDates[4] },
    { enabled: !!activeRestaurant }
  );
  const notifQuery = trpc.notifications.list.useQuery();
  const dailyQuery = trpc.profitability.daily.useQuery(
    { restaurantId: activeRestaurant?.id ?? 0, date: todayKST() },
    { enabled: !!activeRestaurant }
  );
  const changeRequestsQuery = trpc.scheduleChangeRequests.myRequests.useQuery(
    { restaurantId: activeRestaurant?.id ?? 0 },
    { enabled: !!activeRestaurant }
  );

  const schedules = schedulesQuery.data ?? [];
  const mySchedules = schedules.filter((s: any) => s.userId === user?.id);
  const notifications = notifQuery.data ?? [];
  const unreadCount = notifications.filter((n: any) => !n.isRead).length;
  const d = dailyQuery.data;
  const changeRequests = (changeRequestsQuery.data ?? []) as any[];
  const pendingCount = changeRequests.filter((r: any) => r.scheduleChangeRequests?.status === "pending").length;

  const todaySchedule = mySchedules.find((s: any) => s.workDate === todayKST());

  const displayedRequests = showAllRequests ? changeRequests.slice(0, 10) : changeRequests.slice(0, 3);

  return (
    <AppLayout title={activeRestaurant?.name ?? "내 대시보드"} subtitle={`${user?.name ?? user?.username}님, 안녕하세요`}>
      <div className="p-4 lg:p-6 space-y-4">
        {/* 오늘 근무 현황 */}
        <Card className={cn("border-2", todaySchedule ? "border-blue-200 bg-blue-50/50" : "border-muted")}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={cn("p-2.5 rounded-xl", todaySchedule ? "bg-blue-100" : "bg-muted")}>
                <Clock className={cn("h-5 w-5", todaySchedule ? "text-blue-600" : "text-muted-foreground")} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-0.5">오늘 근무</p>
                {todaySchedule ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-blue-700">{todaySchedule.startTimeStr} ~ {todaySchedule.endTimeStr}</p>
                    {todaySchedule.status && SCHEDULE_STATUS_LABELS[todaySchedule.status] && (
                      <Badge variant="outline" className={cn("text-xs border", SCHEDULE_STATUS_LABELS[todaySchedule.status].className)}>
                        {SCHEDULE_STATUS_LABELS[todaySchedule.status].label}
                      </Badge>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">오늘 근무 스케줄이 없습니다</p>
                )}
                {todaySchedule?.note && (
                  <p className="text-xs text-muted-foreground mt-0.5">{todaySchedule.note}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 당일 매출 현황 (열람용) */}
        {d && (
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">오늘 매출</p>
                <p className="text-xl font-bold text-blue-600">{d.salesTotal.toLocaleString("ko-KR")}원</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">인건비율</p>
                <p className={cn("text-xl font-bold", d.laborRatio > 30 ? "text-red-600" : "text-green-600")}>
                  {d.laborRatio.toFixed(1)}%
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 향후 5일 내 스케줄 */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4" /> 내 스케줄 (향후 5일)
              </CardTitle>
              {activeRestaurant && (
                <Link href="/schedule">
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">전체 보기 <ArrowRight className="h-3 w-3" /></Button>
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {schedulesQuery.isLoading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin mr-2" /> 불러오는 중...
              </div>
            ) : (
              <div className="space-y-2">
                {upcomingDates.map(date => {
                  const daySchedule = mySchedules.find((s: any) => s.workDate === date);
                  const dateObj = new Date(date);
                  const isToday = date === todayKST();
                  const statusInfo = daySchedule?.status ? SCHEDULE_STATUS_LABELS[daySchedule.status] : null;
                  return (
                    <div key={date} className={cn("flex items-center gap-3 p-2.5 rounded-lg", isToday ? "bg-blue-50 border border-blue-200" : "bg-muted/30")}>
                      <div className="text-center w-10 flex-shrink-0">
                        <p className={cn("text-xs font-medium", dateObj.getDay() === 0 ? "text-red-500" : dateObj.getDay() === 6 ? "text-blue-500" : "text-muted-foreground")}>{DAYS[dateObj.getDay()]}</p>
                        <p className={cn("text-sm font-bold", isToday ? "text-blue-600" : "")}>{dateObj.getDate()}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        {daySchedule ? (
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-medium text-blue-700">{daySchedule.startTimeStr} ~ {daySchedule.endTimeStr}</p>
                              {statusInfo && (
                                <Badge variant="outline" className={cn("text-xs border px-1.5 py-0", statusInfo.className)}>
                                  {statusInfo.label}
                                </Badge>
                              )}
                            </div>
                            {daySchedule.note && <p className="text-xs text-muted-foreground mt-0.5 truncate">{daySchedule.note}</p>}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">휴무</p>
                        )}
                      </div>
                      {isToday && <Badge className="bg-blue-100 text-blue-700 text-xs flex-shrink-0">오늘</Badge>}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 변경 요청 목록 */}
        {activeRestaurant && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ClipboardList className="h-4 w-4" /> 내 변경 요청
                  {pendingCount > 0 && (
                    <Badge className="bg-amber-100 text-amber-700 text-xs">{pendingCount}건 검토중</Badge>
                  )}
                </CardTitle>
                <Link href="/schedule">
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">스케줄 이동 <ArrowRight className="h-3 w-3" /></Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {changeRequestsQuery.isLoading ? (
                <div className="flex items-center justify-center py-4 text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" /> 불러오는 중...
                </div>
              ) : changeRequests.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">변경 요청 내역이 없습니다</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {displayedRequests.map((row: any) => {
                    const req = row.scheduleChangeRequests ?? row;
                    const sched = row.schedules;
                    const statusInfo = CHANGE_REQUEST_STATUS[req.status] ?? CHANGE_REQUEST_STATUS.pending;
                    const typeLabel = CHANGE_REQUEST_TYPE[req.requestType] ?? req.requestType;
                    return (
                      <div key={req.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/30 border border-border/40">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                            <span className="text-xs font-semibold">{typeLabel}</span>
                            <Badge variant="outline" className={cn("text-xs border flex items-center gap-0.5 px-1.5 py-0", statusInfo.className)}>
                              {statusInfo.icon}{statusInfo.label}
                            </Badge>
                          </div>
                          {sched && (
                            <p className="text-xs text-muted-foreground">
                              근무일: {sched.workDate} {sched.startTime}~{sched.endTime}
                            </p>
                          )}
                          {req.reason && <p className="text-xs text-muted-foreground truncate">사유: {req.reason}</p>}
                          {req.reviewNote && (
                            <p className="text-xs text-blue-600 mt-0.5">검토 메모: {req.reviewNote}</p>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground flex-shrink-0">
                          {req.createdAt ? new Date(req.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }) : ""}
                        </p>
                      </div>
                    );
                  })}
                  {changeRequests.length > 3 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full h-7 text-xs text-muted-foreground"
                      onClick={() => setShowAllRequests(v => !v)}
                    >
                      {showAllRequests ? "접기" : `${changeRequests.length - 3}건 더 보기`}
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 알림 미리보기 */}
        {notifications.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Bell className="h-4 w-4" /> 최근 알림
                  {unreadCount > 0 && <Badge className="bg-red-100 text-red-700 text-xs">{unreadCount}</Badge>}
                </CardTitle>
                <Link href="/notifications">
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">전체 보기 <ArrowRight className="h-3 w-3" /></Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {notifications.slice(0, 3).map((n: any) => (
                <div key={n.id} className={cn("p-2.5 rounded-lg text-xs", !n.isRead ? "bg-blue-50 border border-blue-100" : "bg-muted/30")}>
                  <p className="font-medium">{n.title}</p>
                  {n.content && <p className="text-muted-foreground mt-0.5">{n.content}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* 빠른 메뉴 */}
        {activeRestaurant && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">빠른 메뉴</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {[
                { label: "스케줄 조회", href: "/schedule", icon: <Calendar className="h-4 w-4" />, color: "text-blue-600" },
                { label: "일일 운영", href: "/daily-ops", icon: <DollarSign className="h-4 w-4" />, color: "text-green-600" },
                { label: "알림", href: "/notifications", icon: <Bell className="h-4 w-4" />, color: "text-amber-600" },
              ].map(item => (
                <Link key={item.href} href={item.href}>
                  <div className="flex items-center gap-2.5 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors cursor-pointer">
                    <span className={item.color}>{item.icon}</span>
                    <span className="text-sm font-medium">{item.label}</span>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
