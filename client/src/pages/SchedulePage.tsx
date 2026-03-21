import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/_core/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  Plus, Check, AlertCircle, CalendarCheck,
  MoreHorizontal, Copy, Send, CheckCircle2, BadgeCheck,
  MessageSquarePlus, Clock, Settings, UserX, Banknote, Zap, X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getEffectiveRole, isManagerLevel } from "@shared/permissions";
import { todayKST } from "@/lib/dateKST";

/* ── 상수 ─────────────────────────────────────────────────── */
const DAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];

const STAFF_COLORS = [
  { bg: "bg-blue-500/20",    text: "text-blue-300",    border: "border-blue-500/40",    dot: "bg-blue-400" },
  { bg: "bg-emerald-500/20", text: "text-emerald-300", border: "border-emerald-500/40", dot: "bg-emerald-400" },
  { bg: "bg-violet-500/20",  text: "text-violet-300",  border: "border-violet-500/40",  dot: "bg-violet-400" },
  { bg: "bg-amber-500/20",   text: "text-amber-300",   border: "border-amber-500/40",   dot: "bg-amber-400" },
  { bg: "bg-rose-500/20",    text: "text-rose-300",    border: "border-rose-500/40",    dot: "bg-rose-400" },
  { bg: "bg-cyan-500/20",    text: "text-cyan-300",    border: "border-cyan-500/40",    dot: "bg-cyan-400" },
  { bg: "bg-orange-500/20",  text: "text-orange-300",  border: "border-orange-500/40",  dot: "bg-orange-400" },
  { bg: "bg-pink-500/20",    text: "text-pink-300",    border: "border-pink-500/40",    dot: "bg-pink-400" },
];

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  draft:     { label: "초안",   cls: "bg-muted/50 text-muted-foreground border-border" },
  published: { label: "고지",   cls: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  completed: { label: "완료",   cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  confirmed: { label: "확정",   cls: "bg-violet-500/20 text-violet-300 border-violet-500/30" },
  canceled:  { label: "취소",   cls: "bg-red-500/20 text-red-300 border-red-500/30" },
};

/* ── 날짜 유틸 ───────────────────────────────────────────── */
function getWeekMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}
function getWeekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });
}
function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function halfTime(open: string, close: string): string {
  const [oh, om] = open.split(":").map(Number);
  const [ch, cm] = close.split(":").map(Number);
  const mid = Math.round((oh*60+om + ch*60+cm) / 2);
  return `${String(Math.floor(mid/60)).padStart(2,"0")}:${String(mid%60).padStart(2,"0")}`;
}
function isHalfShift(s: string, e: string, open: string, close: string, thr = 60): boolean {
  const toMin = (t: string) => { const [h,m] = (t??"00:00").split(":").map(Number); return h*60+m; };
  const total = toMin(close) - toMin(open);
  if (total <= 0) return false;
  const work = toMin(e) - toMin(s);
  return work > 0 && work/total < thr/100;
}

/* ── 컴포넌트 ────────────────────────────────────────────── */
export default function SchedulePage() {
  const { selectedRestaurantId } = useRestaurant();
  const rId = selectedRestaurantId;
  const { user } = useAuth();

  /* 역할 */
  const storeRoleQuery = trpc.restaurants.getMyStoreRole.useQuery(
    { restaurantId: rId! }, { enabled: !!rId && !!user }
  );
  const storeRole = storeRoleQuery.data;
  const effectiveRole = getEffectiveRole(user?.role ?? "employee", storeRole);
  const isManager = isManagerLevel(effectiveRole);

/* 7일 스크롤 네비게이션 (오늘 기준 어제 포함 7일) */
  const todayStr  = toDateStr(new Date());
  // 시작일 = 어제
  const getDefaultStart = () => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0,0,0,0); return d; };
  const [viewStart, setViewStart] = useState<Date>(getDefaultStart);
  const viewDates = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(viewStart); d.setDate(d.getDate() + i); return d;
  }), [viewStart]);
  const startDate = toDateStr(viewDates[0]);
  const endDate   = `${toDateStr(viewDates[6])}T23:59:59`;
  const isCurrentView = toDateStr(viewStart) === toDateStr(getDefaultStart());

  const goThisWeek = useCallback(() => setViewStart(getDefaultStart()), []);

  /* 스크롤 컨테이너 ref */
  const gridRef = useRef<HTMLDivElement>(null);

  /* 쿼리 */
  const utils = trpc.useUtils();
  const invalidate = () => utils.schedules.listByRestaurantAndRange.invalidate();

  const schedulesQuery = trpc.schedules.listByRestaurantAndRange.useQuery(
    { restaurantId: rId!, startDate, endDate }, { enabled: !!rId }
  );
  const staffQuery = trpc.restaurants.getStaff.useQuery(
    { restaurantId: rId! }, { enabled: !!rId }
  );
  const restaurantQuery = trpc.restaurants.get.useQuery(
    { id: rId! }, { enabled: !!rId }
  );
  const changeRequestsQuery = trpc.scheduleChangeRequests.list.useQuery(
    { restaurantId: rId!, status: "pending" }, { enabled: !!rId && isManager }
  );
  const closedDaysQuery = trpc.storeClosures.getSpecial.useQuery(
    { restaurantId: rId!, year: viewDates[0].getFullYear(), month: viewDates[0].getMonth()+1 },
    { enabled: !!rId }
  );
  const closedDaysQuery2 = trpc.storeClosures.getSpecial.useQuery(
    { restaurantId: rId!, year: viewDates[6].getFullYear(), month: viewDates[6].getMonth()+1 },
    { enabled: !!rId && viewDates[0].getMonth() !== viewDates[6].getMonth() }
  );
  const weeklyClosuresQuery = trpc.storeClosures.getWeekly.useQuery(
    { restaurantId: rId! }, { enabled: !!rId }
  );

  const closedDateSet = useMemo(() => {
    const set = new Set<string>();
    const add = (data: any[]) => (data??[]).forEach((d: any) => {
      const raw = d.closedDate;
      set.add(raw instanceof Date
        ? `${raw.getFullYear()}-${String(raw.getMonth()+1).padStart(2,"0")}-${String(raw.getDate()).padStart(2,"0")}`
        : String(raw).slice(0,10));
    });
    add(closedDaysQuery.data??[]); add(closedDaysQuery2.data??[]);
    return set;
  }, [closedDaysQuery.data, closedDaysQuery2.data]);

  const weeklyClosedDays = useMemo(() => {
    const set = new Set<number>();
    (weeklyClosuresQuery.data??[]).forEach((d: any) => set.add(d.dayOfWeek));
    return set;
  }, [weeklyClosuresQuery.data]);

  /* 공휴일 */
  const holidaysQuery = trpc.holidays.getByYear.useQuery(
    { year: viewDates[0].getFullYear() },
    { enabled: !!rId, staleTime: 1000 * 60 * 60 * 24 }
  );
  const holidaysQuery2 = trpc.holidays.getByYear.useQuery(
    { year: viewDates[6].getFullYear() },
    { enabled: !!rId && viewDates[0].getFullYear() !== viewDates[6].getFullYear(), staleTime: 1000 * 60 * 60 * 24 }
  );
  const holidayMap = useMemo(() => {
    const map = new Map<string, string>();
    const add = (data: any[]) => (data ?? []).forEach((h: any) => map.set(h.date, h.name));
    add(holidaysQuery.data ?? []);
    add(holidaysQuery2.data ?? []);
    return map;
  }, [holidaysQuery.data, holidaysQuery2.data]);

  const openTime  = restaurantQuery.data?.openTime  ?? "09:00";
  const closeTime = restaurantQuery.data?.closeTime ?? "22:00";
  const halfThr   = restaurantQuery.data?.halfShiftThreshold ?? 60;
  const midTime   = halfTime(openTime, closeTime);

  const PRESETS = {
    open:    { label: "오픈", start: openTime, end: midTime },
    fullday: { label: "풀",   start: openTime, end: closeTime },
    close:   { label: "마감", start: midTime,  end: closeTime },
  };

  /* 뮤테이션 */
  const createMutation = trpc.schedules.create.useMutation({
    onSuccess: () => { invalidate(); setDialog(null); toast.success("스케줄이 등록되었습니다."); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.schedules.update.useMutation({
    onSuccess: () => { invalidate(); setDialog(null); toast.success("스케줄이 수정되었습니다."); },
    onError: (e) => toast.error(e.message),
  });
  const updateConfirmedMutation = trpc.schedules.updateConfirmedSchedule.useMutation({
    onSuccess: () => { invalidate(); setDialog(null); toast.success("확정 스케줄이 수정되었습니다. (인건비 재검토 필요)"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.schedules.delete.useMutation({
    onSuccess: () => { invalidate(); toast.success("삭제되었습니다."); },
    onError: (e) => toast.error(e.message),
  });
  const copyWeekMutation = trpc.schedules.copyPreviousWeek.useMutation({
    onSuccess: (r) => { invalidate(); toast.success(`스케줄 ${r.copied}건 복사 완료`); },
    onError: (e) => toast.error(e.message),
  });
  const quickAssignMutation = trpc.schedules.quickAssign.useMutation({
    onSuccess: () => { invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const publishMutation = trpc.schedules.publishRange.useMutation({
    onSuccess: () => { invalidate(); toast.success("직원에게 고지했습니다."); },
    onError: (e) => toast.error(e.message),
  });
  const completeTodayMutation = trpc.schedules.completeToday.useMutation({
    onSuccess: (r) => { invalidate(); toast.success(`오늘 스케줄 ${r.affected}건 완료 처리`); },
    onError: (e) => toast.error(e.message),
  });
  const confirmMutation = trpc.schedules.confirmRange.useMutation({
    onSuccess: () => { invalidate(); toast.success("스케줄 확정 완료"); },
    onError: (e) => toast.error(e.message),
  });
  const createTempWorkerMutation = trpc.schedules.createTempWorker.useMutation({
    onSuccess: () => { invalidate(); setDialog(null); toast.success("임시 근로자 스케줄 등록 완료"); },
    onError: (e) => toast.error(e.message),
  });
  const setOperatingHoursMutation = trpc.restaurants.setOperatingHours.useMutation({
    onSuccess: () => { utils.restaurants.get.invalidate(); setDialog(null); toast.success("운영시간 저장 완료"); },
    onError: (e) => toast.error(e.message),
  });
  const changeRequestMutation = trpc.scheduleChangeRequests.create.useMutation({
    onSuccess: () => { utils.scheduleChangeRequests.list.invalidate(); setDialog(null); toast.success("변경 요청 전송 완료"); },
    onError: (e) => toast.error(e.message),
  });
  const approveRequestMutation = trpc.scheduleChangeRequests.approve.useMutation({
    onSuccess: () => { utils.scheduleChangeRequests.list.invalidate(); toast.success("승인 완료"); },
    onError: (e) => toast.error(e.message),
  });
  const rejectRequestMutation = trpc.scheduleChangeRequests.reject.useMutation({
    onSuccess: () => { utils.scheduleChangeRequests.list.invalidate(); toast.success("거절 완료"); },
    onError: (e) => toast.error(e.message),
  });

  /* 다이얼로그 통합 상태 */
  type DialogMode =
    | { type: "add";      userId?: number; workDate?: string }
    | { type: "edit";     sch: any }
    | { type: "editConfirmed"; sch: any }
    | { type: "tempWorker"; workDate?: string }
    | { type: "operatingHours" }
    | { type: "changeRequest"; sch: any };

  const [dialog, setDialog] = useState<DialogMode|null>(null);
  const [showRequests, setShowRequests] = useState(false);

  /* 폼 상태 */
  const [form, setForm] = useState({
    userId: "", workDate: "", startTime: "09:00", endTime: "22:00", note: "",
    editReason: "", requestType: "change" as "change"|"swap"|"off",
    reqStartTime: "", reqEndTime: "", reason: "",
    tempName: "", wageType: "hourly" as "hourly"|"daily", wageAmount: "",
    opOpen: "09:00", opClose: "22:00", opHalfThr: 60,
  });

  const openDialog = (mode: DialogMode) => {
    if (mode.type === "add") {
      setForm(f => ({ ...f, userId: String(mode.userId??""), workDate: mode.workDate??"", startTime: openTime, endTime: closeTime, note: "" }));
    } else if (mode.type === "edit") {
      const s = mode.sch;
      setForm(f => ({ ...f, userId: String(s.userId??""), workDate: s.workDate??"", startTime: s.startTimeStr??"", endTime: s.endTimeStr??"", note: s.note??"" }));
    } else if (mode.type === "editConfirmed") {
      const s = mode.sch;
      setForm(f => ({ ...f, startTime: s.startTimeStr??"", endTime: s.endTimeStr??"", editReason: "" }));
    } else if (mode.type === "changeRequest") {
      const s = mode.sch;
      setForm(f => ({ ...f, requestType: "change", reqStartTime: s.startTimeStr??"", reqEndTime: s.endTimeStr??"", reason: "" }));
    } else if (mode.type === "tempWorker") {
      setForm(f => ({ ...f, tempName: "", workDate: mode.workDate??todayStr, startTime: openTime, endTime: closeTime, wageType: "hourly", wageAmount: "", note: "" }));
    } else if (mode.type === "operatingHours") {
      setForm(f => ({ ...f, opOpen: openTime, opClose: closeTime, opHalfThr: halfThr }));
    }
    setDialog(mode);
  };

  /* 데이터 */
  const schedules = schedulesQuery.data ?? [];
  const staff = staffQuery.data ?? [];
  const changeRequests = changeRequestsQuery.data ?? [];

  const staffColorMap = useMemo(() => {
    const map: Record<number, typeof STAFF_COLORS[0]> = {};
    staff.forEach((s: any, i: number) => { map[s.id] = STAFF_COLORS[i % STAFF_COLORS.length]; });
    return map;
  }, [staff]);

  const getSchedules = (userId: number, dateStr: string) =>
    schedules.filter((s: any) => s.workDate === dateStr && s.userId === userId);

  // 날짜별 근무 총원 (반차 0.5명, 정규 1명)
  const getDayCount = (dateStr: string) => {
    const daySchedules = schedules.filter((s: any) => s.workDate === dateStr && !s.tempWorkerName);
    // userId별로 가장 많은 시간을 기준으로 1명 또는 0.5명으로 집계
    const userMap = new Map<number, boolean>(); // userId -> 정규(true) or 반차(false)
    daySchedules.forEach((s: any) => {
      const half = isHalfShift(s.startTimeStr ?? "", s.endTimeStr ?? "", openTime, closeTime, halfThr);
      if (!userMap.has(s.userId) || (!half && userMap.get(s.userId) === false)) {
        userMap.set(s.userId, !half);
      }
    });
    let total = 0;
    userMap.forEach(isFullDay => { total += isFullDay ? 1 : 0.5; });
    return total;
  };

  const tempSchedules = schedules.filter((s: any) => s.tempWorkerName);

  /* 날짜 범위 텍스트 */
  const weekLabel = (() => {
    const s = viewDates[0], e = viewDates[6];
    const rangeStr = s.getMonth() === e.getMonth()
      ? `${s.getMonth()+1}월 ${s.getDate()}일~${e.getDate()}일`
      : `${s.getMonth()+1}월 ${s.getDate()}일~${e.getMonth()+1}월 ${e.getDate()}일`;
    return isCurrentView ? `이번 주 · ${rangeStr}` : rangeStr;
  })();

  const isTodayInView = viewDates.some(d => toDateStr(d) === todayStr);

  /* ── 렌더 ───────────────────────────────────────────────── */
  return (
    <AppLayout title="스케줄" subtitle={weekLabel}>
      <div
        className="p-4 lg:p-6 space-y-3 select-none"
        style={{ touchAction: "pan-x pan-y" }}
      >
        {/* ── 헤더 콘트롤 ── */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* 날짜 네비게이션 */}
          <div className="flex items-center gap-1.5">
            <Button
              variant={isCurrentView ? "default" : "outline"}
              size="sm" className="h-8 text-xs px-3 gap-1"
              onClick={goThisWeek}
            >
              <CalendarCheck className="h-3 w-3" /> 이번 주
            </Button>
            <span className="text-xs text-muted-foreground flex items-center gap-1 ml-1">
              <Clock className="h-3 w-3" /> {openTime}~{closeTime}
            </span>
          </div>

          {/* 우측 액션 */}
          <div className="flex items-center gap-2">
            {/* 변경 요청 배지 (매니저) */}
            {isManager && changeRequests.length > 0 && (
              <button
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
                onClick={() => setShowRequests(true)}
              >
                <AlertCircle className="h-3 w-3" /> 변경 요청 {changeRequests.length}건
              </button>
            )}

            {isManager && (
              <>
                {/* 일괄 작업 드롭다운 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => openDialog({ type: "operatingHours" })}>
                      <Settings className="h-3.5 w-3.5 mr-2" /> 운영시간 설정
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openDialog({ type: "tempWorker" })}>
                      <UserX className="h-3.5 w-3.5 mr-2" /> 임시 근로자 추가
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => {
                      if (confirm("지난 주 스케줄을 이번 주로 복사하시겠습니까?"))
                        copyWeekMutation.mutate({ restaurantId: rId!, targetWeekStart: startDate });
                    }}>
                      <Copy className="h-3.5 w-3.5 mr-2" /> 지난 주 복사
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-violet-400 focus:text-violet-400" onClick={() => {
                      if (confirm("이 기간 완료된 스케줄을 스케줄 확정하시겠습니까?"))
                        confirmMutation.mutate({ restaurantId: rId!, from: startDate, to: endDate });
                    }}>
                      <BadgeCheck className="h-3.5 w-3.5 mr-2" /> 스케줄 확정
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}

            {/* 직원용 변경 요청 버튼 */}
            {!isManager && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
                onClick={() => openDialog({ type: "changeRequest", sch: {} })}>
                <MessageSquarePlus className="h-3.5 w-3.5" /> 변경 요청
              </Button>
            )}
          </div>
        </div>

        {/* ── 7일 그리드 ── */}
        <Card>
          <CardContent className="p-0 overflow-x-auto" ref={gridRef}>
            <table className="w-full border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="sticky left-0 z-10 bg-background/95 backdrop-blur-sm border-r border-border p-2 w-24 text-left">
                    <span className="text-xs text-muted-foreground">직원</span>
                  </th>
                  {viewDates.map((date, i) => {
                    const ds = toDateStr(date);
                    const isToday = ds === todayStr;
                    const isClosed = closedDateSet.has(ds) || weeklyClosedDays.has(date.getDay());
                    const holidayName = holidayMap.get(ds);
                    const isSunday = date.getDay() === 0;
                    const isSaturday = date.getDay() === 6;
                    return (
                      <th key={i} className={cn(
                        "border-r border-border last:border-r-0 p-2 text-center min-w-[80px]",
                        isToday && "bg-blue-50/40",
                        isClosed && "bg-red-500/10",
                        holidayName && !isClosed && "bg-rose-500/8"
                      )}>
                        <p className={cn(
                          "text-xs font-semibold",
                          isToday && "text-blue-400",
                          isClosed && "text-red-400/70",
                          !isClosed && (holidayName || isSunday) && "text-rose-400",
                          !isClosed && !holidayName && isSaturday && "text-sky-400"
                        )}>
                          {DAYS_KO[date.getDay()]}
                        </p>
                        <p className={cn(
                          "text-[11px]",
                          isToday ? "text-blue-400 font-bold" : "text-muted-foreground",
                          isClosed && "text-red-400/70",
                          !isClosed && (holidayName || isSunday) && "text-rose-400",
                          !isClosed && !holidayName && isSaturday && "text-sky-400"
                        )}>
                          {date.getMonth()+1}/{date.getDate()}
                        </p>
                        {isClosed && <p className="text-[9px] text-red-400/60 mt-0.5">휴무</p>}
                        {holidayName && !isClosed && (
                          <p className="text-[9px] text-rose-400/80 mt-0.5 leading-tight truncate max-w-[72px] mx-auto" title={holidayName}>
                            {holidayName}
                          </p>
                        )}
                        {(() => { const cnt = getDayCount(ds); return cnt > 0 ? (
                          <span className="inline-block mt-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded-full px-1.5 py-0.5 font-medium">
                            {cnt}명
                          </span>
                        ) : null; })()}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {schedulesQuery.isLoading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-sm text-muted-foreground">불러오는 중...</td></tr>
                ) : staff.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-sm text-muted-foreground">등록된 직원이 없습니다.</td></tr>
                ) : staff.map((s: any) => {
                  const color = staffColorMap[s.id];
                  return (
                    <tr key={s.id} className="border-b border-border last:border-b-0">
                      {/* 직원 이름 열 */}
                      <td className="sticky left-0 z-10 bg-background/95 backdrop-blur-sm border-r border-border p-2 align-middle">
                        <div className="flex items-center gap-1.5">
                          <span className={cn("w-2 h-2 rounded-full flex-shrink-0", color?.dot)} />
                          <div>
                            <p className="text-xs font-medium leading-tight">{s.name ?? s.username}</p>
                            <p className="text-[10px] text-muted-foreground leading-tight">
                              {s.restaurantRole === "store_manager" ? "점장" : s.restaurantRole === "manager" ? "매니저" : "직원"}
                            </p>
                          </div>
                        </div>
                      </td>
                      {/* 날짜별 셀 */}
                      {viewDates.map((date, i) => {
                        const ds = toDateStr(date);
                        const isToday = ds === todayStr;
                        const isPast  = ds < todayStr;
                        const isClosed = closedDateSet.has(ds) || weeklyClosedDays.has(date.getDay());
                        const cellSchedules = getSchedules(s.id, ds);
                        return (
                          <td
                            key={i}
                            className={cn(
                              "border-r border-border last:border-r-0 p-1.5 align-top h-[72px]",
                              isClosed ? "bg-red-500/10 cursor-not-allowed"
                                : isToday ? "bg-blue-50/40"
                                : isPast  ? "bg-muted/10" : "",
                              !isClosed && isManager && "cursor-pointer hover:bg-muted/30 transition-colors"
                            )}
                            onClick={() => {
                              if (isClosed || !isManager) return;
                              if (cellSchedules.length === 0) openDialog({ type: "add", userId: s.id, workDate: ds });
                            }}
                          >
                            {isClosed ? null : cellSchedules.length === 0 ? (
                              isManager ? (
                                <div className="h-full flex flex-col items-center justify-center gap-1 opacity-0 hover:opacity-100 transition-opacity">
                                  <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                                  <div className="flex gap-0.5" onClick={e => e.stopPropagation()}>
                                    {(["open","fullday","close"] as const).map(p => (
                                      <button key={p}
                                        className="text-[9px] px-1 py-0.5 rounded bg-muted/60 text-muted-foreground hover:bg-primary/20 hover:text-primary transition-colors"
                                        onClick={() => quickAssignMutation.mutate({ restaurantId: rId!, userId: s.id, workDate: ds, preset: p })}
                                        title={`${PRESETS[p].label}(${PRESETS[p].start}~${PRESETS[p].end})`}
                                      >
                                        {PRESETS[p].label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="h-full flex items-center justify-center">
                                  <span className="text-[10px] text-muted-foreground/30">-</span>
                                </div>
                              )
                            ) : (
                              <div className="space-y-1">
                                {cellSchedules.map((sch: any) => {
                                  const sb = STATUS_BADGE[sch.status] ?? STATUS_BADGE.draft;
                                  const isConfirmed = sch.status === "confirmed";
                                  const isMySchedule = !isManager && sch.userId === user?.id;
                                  const half = isHalfShift(sch.startTimeStr??"", sch.endTimeStr??"", openTime, closeTime, halfThr);
                                  return (
                                    <Tooltip key={sch.id}>
                                      <TooltipTrigger asChild>
                                        <div
                                          className={cn(
                                            "group relative rounded px-1.5 py-1 text-[11px] border cursor-default",
                                            color?.bg, color?.text, color?.border
                                          )}
                                          onClick={e => e.stopPropagation()}
                                        >
                                          <p className="font-semibold leading-tight">
                                            {sch.startTimeStr}~{sch.endTimeStr}
                                          </p>
                                          <div className="flex items-center gap-0.5 mt-0.5 flex-wrap">
                                            <span className={cn("inline-block text-[9px] px-1 rounded border", sb.cls)}>
                                              {sb.label}
                                            </span>
                                            {half && (
                                              <span className="inline-block text-[9px] px-1 rounded border bg-orange-500/20 text-orange-300 border-orange-500/30">
                                                반차
                                              </span>
                                            )}
                                          </div>
                                          {sch.note && <p className="truncate opacity-70 text-[10px]">{sch.note}</p>}

                                          {/* 매니저 액션 버튼 */}
                                          {isManager && (
                                            <div className="absolute -top-1 -right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                              {isConfirmed ? (
                                                <button
                                                  className="w-4 h-4 bg-amber-500 text-white rounded-full flex items-center justify-center"
                                                  title="확정 스케줄 수정"
                                                  onClick={e => { e.stopPropagation(); openDialog({ type: "editConfirmed", sch }); }}
                                                >
                                                  <Zap className="h-2.5 w-2.5" />
                                                </button>
                                              ) : (
                                                <>
                                                  <button
                                                    className="w-4 h-4 bg-blue-500 text-white rounded-full flex items-center justify-center"
                                                    title="수정"
                                                    onClick={e => { e.stopPropagation(); openDialog({ type: "edit", sch }); }}
                                                  >
                                                    <span className="text-[9px] font-bold">✎</span>
                                                  </button>
                                                  <button
                                                    className="w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center"
                                                    title="삭제"
                                                    onClick={e => {
                                                      e.stopPropagation();
                                                      if (confirm("이 스케줄을 삭제하시겠습니까?"))
                                                        deleteMutation.mutate({ id: sch.id, restaurantId: rId! });
                                                    }}
                                                  >
                                                    <X className="h-2.5 w-2.5" />
                                                  </button>
                                                </>
                                              )}
                                            </div>
                                          )}

                                          {/* 직원 변경 요청 버튼 */}
                                          {isMySchedule && (
                                            <div className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                              <button
                                                className="w-4 h-4 bg-blue-500 text-white rounded-full flex items-center justify-center"
                                                title="변경 요청"
                                                onClick={e => { e.stopPropagation(); openDialog({ type: "changeRequest", sch }); }}
                                              >
                                                <MessageSquarePlus className="h-2.5 w-2.5" />
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="text-xs max-w-[200px]">
                                        <p className="font-semibold">{s.name ?? s.username}</p>
                                        <p>{sch.startTimeStr} ~ {sch.endTimeStr} · {sb.label}</p>
                                        {sch.note && <p>메모: {sch.note}</p>}
                                        {sch.editReason && <p className="text-amber-400">수정사유: {sch.editReason}</p>}
                                        {sch.payrollRecheckRequired && <p className="text-amber-400">⚠ 인건비 재검토 필요</p>}
                                      </TooltipContent>
                                    </Tooltip>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* ── 임시 근로자 섹션 ── */}
        {tempSchedules.length > 0 && (
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <UserX className="h-4 w-4 text-amber-400" />
                <span className="text-sm font-semibold text-amber-300">임시/급구 근로자</span>
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] h-5">{tempSchedules.length}건</Badge>
              </div>
              <div className="space-y-1">
                {tempSchedules.map((sch: any) => {
                  const sb = STATUS_BADGE[sch.status] ?? STATUS_BADGE.draft;
                  return (
                    <div key={sch.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded border border-amber-500/30 bg-amber-500/5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-amber-300">{sch.tempWorkerName}</span>
                        <span className="text-muted-foreground">{sch.workDate}</span>
                        <span className="text-muted-foreground">{sch.startTimeStr}~{sch.endTimeStr}</span>
                        <span className={cn("text-[10px] px-1 rounded border", sb.cls)}>{sb.label}</span>
                        {sch.tempWageAmount && (
                          <span className="flex items-center gap-0.5 text-[10px] text-amber-300">
                            <Banknote className="h-3 w-3" />
                            {sch.tempWageType === "hourly"
                              ? `${Number(sch.tempWageAmount).toLocaleString()}원/h`
                              : `${Number(sch.tempWageAmount).toLocaleString()}원/일`}
                          </span>
                        )}
                      </div>
                      {isManager && (
                        <button
                          className="text-red-400 hover:text-red-300 text-xs"
                          onClick={() => { if (confirm("삭제하시겠습니까?")) deleteMutation.mutate({ id: sch.id, restaurantId: rId! }); }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── 변경 요청 시트 (매니저) ── */}
      <Sheet open={showRequests} onOpenChange={setShowRequests}>
        <SheetContent side="right" className="w-[360px] sm:w-[400px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400" />
              변경 요청 {changeRequests.length}건
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3 overflow-y-auto max-h-[calc(100vh-120px)]">
            {changeRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">대기 중인 요청이 없습니다.</p>
            ) : changeRequests.map((req: any) => (
              <Card key={req.id}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{req.requesterName ?? req.requesterId}</span>
                    <Badge className="text-[10px] bg-amber-500/20 text-amber-400 border-amber-500/30">
                      {req.requestType === "change" ? "시간변경" : req.requestType === "swap" ? "교대" : "휴무"}
                    </Badge>
                  </div>
                  {req.reason && <p className="text-xs text-muted-foreground">{req.reason}</p>}
                  {req.requestedStartTime && (
                    <p className="text-xs text-blue-300">
                      희망: {new Date(req.requestedStartTime).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}
                      ~ {req.requestedEndTime ? new Date(req.requestedEndTime).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"}) : ""}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1 h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => approveRequestMutation.mutate({ id: req.id })}
                      disabled={approveRequestMutation.isPending}>
                      <Check className="h-3 w-3" /> 승인
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 h-7 text-xs text-red-400 border-red-400/30 hover:bg-red-500/10"
                      onClick={() => rejectRequestMutation.mutate({ id: req.id, reviewNote: "" })}
                      disabled={rejectRequestMutation.isPending}>
                      거절
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── 통합 다이얼로그 ── */}

      {/* 스케줄 추가 */}
      <Dialog open={dialog?.type === "add"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>스케줄 추가</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">직원</Label>
              <Select value={form.userId} onValueChange={v => setForm(f => ({ ...f, userId: v }))}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="직원 선택" /></SelectTrigger>
                <SelectContent>
                  {staff.map((s: any) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name ?? s.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">날짜</Label>
              <Input type="date" value={form.workDate} onChange={e => setForm(f => ({ ...f, workDate: e.target.value }))} className="mt-1 h-9" />
            </div>
            <TimePresetRow form={form} setForm={setForm} PRESETS={PRESETS} />
            <div>
              <Label className="text-xs">메모</Label>
              <Input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="선택 사항" className="mt-1 h-9" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialog(null)}>취소</Button>
            <Button size="sm"
              onClick={() => createMutation.mutate({
                userId: Number(form.userId), restaurantId: rId!,
                workDate: form.workDate, startTime: form.startTime, endTime: form.endTime,
                note: form.note || undefined,
              })}
              disabled={!form.userId || !form.workDate || createMutation.isPending}>
              추가
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 스케줄 수정 */}
      <Dialog open={dialog?.type === "edit"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>스케줄 수정</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">담당 직원</Label>
              <Select value={form.userId} onValueChange={v => setForm(f => ({ ...f, userId: v }))}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="직원 선택" /></SelectTrigger>
                <SelectContent>
                  {staff.map((s: any) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name ?? s.username}
                      <span className="ml-1 text-muted-foreground text-xs">
                        ({s.restaurantRole === "store_manager" ? "점장" : s.restaurantRole === "manager" ? "매니저" : "직원"})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">날짜</Label>
              <Input type="date" value={form.workDate} onChange={e => setForm(f => ({ ...f, workDate: e.target.value }))} className="mt-1 h-9" />
            </div>
            <TimePresetRow form={form} setForm={setForm} PRESETS={PRESETS} />
            <div>
              <Label className="text-xs">메모</Label>
              <Input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="선택 사항" className="mt-1 h-9" />
            </div>
          </div>
          <DialogFooter className="flex gap-2 justify-between">
            <Button variant="destructive" size="sm"
              onClick={() => {
                const d = dialog as { type: "edit"; sch: any };
                if (confirm("이 스케줄을 삭제하시겠습니까?")) {
                  deleteMutation.mutate({ id: d.sch.id, restaurantId: rId! });
                  setDialog(null);
                }
              }}
              disabled={deleteMutation.isPending}>
              삭제
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialog(null)}>취소</Button>
              <Button size="sm"
                onClick={() => {
                  const d = dialog as { type: "edit"; sch: any };
                  updateMutation.mutate({
                    id: d.sch.id, restaurantId: rId!,
                    userId: Number(form.userId) || undefined,
                    workDate: form.workDate || undefined,
                    startTime: form.startTime || undefined,
                    endTime: form.endTime || undefined,
                    note: form.note || undefined,
                  });
                }}
                disabled={updateMutation.isPending}>
                저장
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 확정 스케줄 수정 */}
      <Dialog open={dialog?.type === "editConfirmed"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-400" /> 확정 스케줄 수정
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded p-2">
            확정된 스케줄을 수정하면 인건비 재검토 이력이 남습니다.
          </p>
          <div className="space-y-3">
            <TimePresetRow form={form} setForm={setForm} PRESETS={PRESETS} />
            <div>
              <Label className="text-xs">수정 사유 *</Label>
              <Input value={form.editReason} onChange={e => setForm(f => ({ ...f, editReason: e.target.value }))} placeholder="수정 사유를 입력하세요" className="mt-1 h-9" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialog(null)}>취소</Button>
            <Button size="sm" className="bg-amber-500 hover:bg-amber-600"
              onClick={() => {
                const d = dialog as { type: "editConfirmed"; sch: any };
                const datePrefix = d.sch.workDate ?? todayKST();
                updateConfirmedMutation.mutate({
                  id: d.sch.id,
                  startTime: form.startTime ? `${datePrefix}T${form.startTime}` : undefined,
                  endTime: form.endTime ? `${datePrefix}T${form.endTime}` : undefined,
                  editReason: form.editReason,
                });
              }}
              disabled={!form.editReason || updateConfirmedMutation.isPending}>
              수정 저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 임시 근로자 */}
      <Dialog open={dialog?.type === "tempWorker"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserX className="h-4 w-4 text-amber-400" /> 임시/급구 근로자
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">이름 *</Label>
              <Input className="mt-1 h-9" placeholder="임시 근로자 이름" value={form.tempName}
                onChange={e => setForm(f => ({ ...f, tempName: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">날짜 *</Label>
              <Input type="date" className="mt-1 h-9" value={form.workDate}
                onChange={e => setForm(f => ({ ...f, workDate: e.target.value }))} />
            </div>
            <TimePresetRow form={form} setForm={setForm} PRESETS={PRESETS} />
            <div>
              <Label className="text-xs flex items-center gap-1">
                <Banknote className="h-3 w-3 text-amber-400" /> 급여
              </Label>
              <div className="flex gap-2 mt-1">
                <Select value={form.wageType} onValueChange={(v: "hourly"|"daily") => setForm(f => ({ ...f, wageType: v }))}>
                  <SelectTrigger className="h-9 text-sm w-20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">시급</SelectItem>
                    <SelectItem value="daily">일당</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="number" className="h-9 flex-1"
                  placeholder={form.wageType === "hourly" ? "시급 (원/h)" : "일당 (원)"}
                  value={form.wageAmount} onChange={e => setForm(f => ({ ...f, wageAmount: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">메모</Label>
              <Input className="mt-1 h-9" placeholder="선택 사항" value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialog(null)}>취소</Button>
            <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white"
              onClick={() => createTempWorkerMutation.mutate({
                restaurantId: rId!, tempWorkerName: form.tempName, workDate: form.workDate,
                startTime: form.startTime, endTime: form.endTime,
                wageType: form.wageAmount ? form.wageType : undefined,
                wageAmount: form.wageAmount ? Number(form.wageAmount) : undefined,
                note: form.note || undefined,
              })}
              disabled={!form.tempName || !form.workDate || createTempWorkerMutation.isPending}>
              등록
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 운영시간 설정 */}
      <Dialog open={dialog?.type === "operatingHours"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" /> 매장 운영시간
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground bg-muted/30 rounded p-2">
            오픈: <span className="text-primary font-medium">{form.opOpen}~{halfTime(form.opOpen, form.opClose)}</span>
            {" / "}
            마감: <span className="text-primary font-medium">{halfTime(form.opOpen, form.opClose)}~{form.opClose}</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">오픈</Label>
              <Input type="time" value={form.opOpen} onChange={e => setForm(f => ({ ...f, opOpen: e.target.value }))} className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">마감</Label>
              <Input type="time" value={form.opClose} onChange={e => setForm(f => ({ ...f, opClose: e.target.value }))} className="mt-1 h-9" />
            </div>
          </div>
          <div className="border-t border-border pt-3">
            <Label className="text-xs font-medium">반차 기준 ({form.opHalfThr}%)</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">
              전체 운영시간 대비 이 비율 미만 근무 시 반차(0.5명)로 계산
            </p>
            <div className="flex items-center gap-3">
              <input type="range" min={10} max={90} step={5} value={form.opHalfThr}
                onChange={e => setForm(f => ({ ...f, opHalfThr: Number(e.target.value) }))}
                className="flex-1 accent-primary" />
              <div className="flex items-center gap-1">
                <Input type="number" min={10} max={90} value={form.opHalfThr}
                  onChange={e => setForm(f => ({ ...f, opHalfThr: Math.min(90, Math.max(10, Number(e.target.value))) }))}
                  className="w-14 h-8 text-sm text-center" />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialog(null)}>취소</Button>
            <Button size="sm"
              onClick={() => setOperatingHoursMutation.mutate({
                restaurantId: rId!, openTime: form.opOpen, closeTime: form.opClose, halfShiftThreshold: form.opHalfThr,
              })}
              disabled={setOperatingHoursMutation.isPending}>
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 변경 요청 (직원) */}
      <Dialog open={dialog?.type === "changeRequest"} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>스케줄 변경 요청</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">요청 유형</Label>
              <Select value={form.requestType} onValueChange={(v: any) => setForm(f => ({ ...f, requestType: v }))}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="change">시간 변경</SelectItem>
                  <SelectItem value="swap">교대 요청</SelectItem>
                  <SelectItem value="off">휴무 요청</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.requestType === "change" && (
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">희망 시작</Label><Input type="time" value={form.reqStartTime} onChange={e => setForm(f => ({ ...f, reqStartTime: e.target.value }))} className="mt-1 h-9" /></div>
                <div><Label className="text-xs">희망 종료</Label><Input type="time" value={form.reqEndTime} onChange={e => setForm(f => ({ ...f, reqEndTime: e.target.value }))} className="mt-1 h-9" /></div>
              </div>
            )}
            <div>
              <Label className="text-xs">요청 사유</Label>
              <Input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="변경 사유를 입력하세요" className="mt-1 h-9" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialog(null)}>취소</Button>
            <Button size="sm"
              onClick={() => {
                const d = dialog as { type: "changeRequest"; sch: any };
                const today = todayKST();
                changeRequestMutation.mutate({
                  scheduleId: d.sch.id ?? 0, restaurantId: rId!,
                  requestType: form.requestType, reason: form.reason || undefined,
                  requestedStartTime: form.reqStartTime ? `${today}T${form.reqStartTime}` : undefined,
                  requestedEndTime: form.reqEndTime ? `${today}T${form.reqEndTime}` : undefined,
                });
              }}
              disabled={changeRequestMutation.isPending}>
              요청 전송
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

/* ── 시간/프리셋 공통 컴포넌트 ── */
function TimePresetRow({ form, setForm, PRESETS }: {
  form: any;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  PRESETS: Record<string, { label: string; start: string; end: string }>;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs">시작</Label><Input type="time" value={form.startTime} onChange={e => setForm((f: any) => ({ ...f, startTime: e.target.value }))} className="mt-1 h-9" /></div>
        <div><Label className="text-xs">종료</Label><Input type="time" value={form.endTime} onChange={e => setForm((f: any) => ({ ...f, endTime: e.target.value }))} className="mt-1 h-9" /></div>
      </div>
      <div className="flex gap-1.5">
        {(["open","fullday","close"] as const).map(p => (
          <button key={p}
            className="flex-1 text-xs py-1.5 rounded border border-border bg-muted/30 hover:bg-primary/10 hover:border-primary/30 transition-colors"
            onClick={() => setForm((f: any) => ({ ...f, startTime: PRESETS[p].start, endTime: PRESETS[p].end }))}>
            {PRESETS[p].label}<br />
            <span className="text-[10px] text-muted-foreground">{PRESETS[p].start}~{PRESETS[p].end}</span>
          </button>
        ))}
      </div>
    </>
  );
}
