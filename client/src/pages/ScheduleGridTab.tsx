import { useState, useMemo, useEffect, useCallback } from "react";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Send,
  Clock,
  X,
  Trash2,
  Edit3,
  Sun,
  Moon,
  Maximize2,
  UserPlus,
  Pencil,
  AlertTriangle,
  Zap,
  Check,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getHolidayName } from "@shared/holidays";
import {
  type ScheduleItem,
  type StaffItem,
  getWeekDates,
  fmtDate,
  fmtTime,
  DAY_NAMES,
  STATUS_LABELS,
  resolvePresetLabel,
  calcHeadcountWeight,
} from "@/lib/scheduleHelpers";

interface ScheduleGridTabProps {
  restaurantId: number;
  isManager: boolean;
  shiftPresets: any[];
  current: any;
}

// ─── 월간 미니맵 컴포넌트 ───────────────────────────────────────────────────

function MonthlyMinimap({
  restaurantId,
  baseDate,
  onDateClick,
}: {
  restaurantId: number;
  baseDate: Date;
  onDateClick: (date: Date) => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => new Date(baseDate.getFullYear(), baseDate.getMonth(), 1));
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth() + 1;

  const { data: summary = [] } = trpc.schedules.monthlySummary.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0, staleTime: 60_000 },
  );

  const summaryMap = useMemo(() => {
    const m = new Map<string, { headcount: number; hasUnconfirmed: boolean }>();
    summary.forEach((s: any) => m.set(s.date, { headcount: s.headcount, hasUnconfirmed: !!s.hasUnconfirmed }));
    return m;
  }, [summary]);

  // 현재 주 시작/종료
  const weekDates = useMemo(() => getWeekDates(baseDate), [baseDate]);
  const weekStartStr = fmtDate(weekDates[0]);
  const weekEndStr = fmtDate(weekDates[6]);

  // 달력 날짜 배열 (월요일 시작)
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const startDow = (firstDay.getDay() + 6) % 7; // 월=0
    const days: (Date | null)[] = [];
    for (let i = 0; i < startDow; i++) days.push(null);
    for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month - 1, d));
    return days;
  }, [year, month]);

  const today = fmtDate(new Date());

  const prevMonth = () => setViewMonth(new Date(year, month - 2, 1));
  const nextMonth = () => setViewMonth(new Date(year, month, 1));

  // 주 변경 시 미니맵 월도 동기화
  useEffect(() => {
    const bdMonth = baseDate.getMonth();
    const bdYear = baseDate.getFullYear();
    if (bdYear !== viewMonth.getFullYear() || bdMonth !== viewMonth.getMonth()) {
      setViewMonth(new Date(bdYear, bdMonth, 1));
    }
  }, [baseDate]);

  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="border rounded-lg bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1 rounded hover:bg-accent"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-semibold">{year}년 {month}월</span>
          <button onClick={nextMonth} className="p-1 rounded hover:bg-accent"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          {collapsed ? "펼치기" : "접기"}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="grid grid-cols-7 gap-0.5 text-center mb-1">
            {DAY_NAMES.map((d, i) => (
              <span key={d} className={`text-[10px] font-medium ${i >= 5 ? "text-red-400" : "text-muted-foreground"}`}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {calendarDays.map((date, i) => {
              if (!date) return <div key={`empty-${i}`} />;
              const ds = fmtDate(date);
              const info = summaryMap.get(ds);
              const isCurrentWeek = ds >= weekStartStr && ds <= weekEndStr;
              const isToday = ds === today;
              const hc = info?.headcount ?? 0;
              const isEmpty = hc === 0;
              const hasUnconfirmed = info?.hasUnconfirmed ?? false;

              return (
                <button
                  key={ds}
                  onClick={() => onDateClick(date)}
                  className={`relative flex flex-col items-center py-0.5 rounded text-[10px] transition-colors
                    ${isCurrentWeek ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-accent/50"}
                    ${isToday ? "font-bold" : ""}`}
                >
                  <span className={isToday ? "text-primary" : "text-foreground"}>{date.getDate()}</span>
                  {info ? (
                    <span className={`text-[9px] font-medium leading-none ${
                      isEmpty ? "text-red-500" : hasUnconfirmed ? "text-amber-500" : "text-green-600"
                    }`}>
                      {hc % 1 === 0 ? hc : hc.toFixed(1)}
                    </span>
                  ) : (
                    <span className="text-[9px] text-transparent">0</span>
                  )}
                </button>
              );
            })}
          </div>
          {/* 범례 */}
          <div className="flex items-center gap-3 mt-2 text-[9px] text-muted-foreground justify-center">
            <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500" /> 확정</span>
            <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> 초안포함</span>
            <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500" /> 미배정</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── 메인 ScheduleGridTab ───────────────────────────────────────────────────

export default function ScheduleGridTab({ restaurantId, isManager, shiftPresets, current }: ScheduleGridTabProps) {
  const [baseDate, setBaseDate] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get("date");
    return d ? new Date(d + "T12:00:00") : new Date();
  });
  const weekDates = useMemo(() => getWeekDates(baseDate), [baseDate]);
  const weekStart = fmtDate(weekDates[0]);
  const weekEnd = fmtDate(weekDates[6]) + "T23:59:59";

  // ─── 빠른배정 상태 ─────────────────────────
  const [quickMode, setQuickMode] = useState(false);
  const [quickUserId, setQuickUserId] = useState<number>(0);
  const [quickPreset, setQuickPreset] = useState<string>("full");

  // ─── 모달 상태 ─────────────────────────────
  type AssignStep = "employee" | "preset" | "custom-time" | "temp-worker";
  const [assignDate, setAssignDate] = useState<string | null>(null);
  const [assignStep, setAssignStep] = useState<AssignStep>("employee");
  const [assignUserIds, setAssignUserIds] = useState<Set<number>>(new Set());
  const [assignUserNames, setAssignUserNames] = useState<Map<number, string>>(new Map());
  // 하위 호환: 단일 선택이 필요한 곳용
  const assignUserId = assignUserIds.size === 1 ? [...assignUserIds][0] : 0;
  const assignUserName = assignUserIds.size === 1 ? (assignUserNames.get([...assignUserIds][0]) ?? "") : `${assignUserIds.size}명 선택`;
  const [customTime, setCustomTime] = useState({ startTime: "09:00", endTime: "18:00", note: "" });
  const [tempForm, setTempForm] = useState({
    name: "",
    wageType: "hourly" as "hourly" | "daily",
    wageAmount: "",
    startTime: "09:00",
    endTime: "18:00",
    note: "",
  });
  const [editSchedule, setEditSchedule] = useState<ScheduleItem | null>(null);
  const [editForm, setEditForm] = useState({ startTime: "", endTime: "", note: "", editReason: "", shiftPreset: "custom" as string, breakMinutes: 0 });
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const utils = trpc.useUtils();

  const { data: scheduleList = [], isLoading } = trpc.schedules.listByRestaurant.useQuery(
    { restaurantId, from: weekStart, to: weekEnd },
    { enabled: restaurantId > 0 },
  );

  const { data: staffList = [] } = trpc.restaurants.getStaff.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  ) as { data: StaffItem[] };

  // ─── Mutations ─────────────────────────────
  const quickAssignMut = trpc.schedules.quickAssign.useMutation({
    onSuccess() {
      toast.success("스케줄 등록됨");
      closeAssignModal();
      invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const batchQuickAssignMut = trpc.schedules.batchQuickAssign.useMutation({
    onSuccess(data) {
      const msg = data.skipped.length > 0
        ? `${data.created.length}명 배정 완료 (${data.skipped.length}명 이미 배정됨)`
        : `${data.created.length}명 배정 완료`;
      toast.success(msg);
      closeAssignModal();
      invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  // 빠른배정 모드용 mutation (optimistic)
  const quickAssignFast = trpc.schedules.quickAssign.useMutation({
    onMutate: async (vars) => {
      await utils.schedules.listByRestaurant.cancel();
      const prev = utils.schedules.listByRestaurant.getData({ restaurantId, from: weekStart, to: weekEnd });
      const staff = (staffList as StaffItem[]).find(s => s.userId === vars.userId);
      utils.schedules.listByRestaurant.setData(
        { restaurantId, from: weekStart, to: weekEnd },
        (old: any) => [...(old ?? []), {
          id: -Date.now(),
          userId: vars.userId,
          tempWorkerName: null,
          tempWageType: null,
          tempWageAmount: null,
          userName: staff?.name ?? "...",
          startTime: `${vars.workDate}T09:00:00`,
          endTime: `${vars.workDate}T18:00:00`,
          status: "draft",
          shiftPreset: vars.preset,
          breakMinutes: null,
          note: null,
          editReason: null,
          payrollRecheckRequired: null,
        }],
      );
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) {
        utils.schedules.listByRestaurant.setData({ restaurantId, from: weekStart, to: weekEnd }, ctx.prev);
      }
      toast.error(err.message);
    },
    onSettled: () => invalidate(),
    onSuccess: () => toast.success("배정됨"),
  });

  const createSchedule = trpc.schedules.create.useMutation({
    onSuccess() {
      toast.success("스케줄 등록됨");
      closeAssignModal();
      invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const createTempWorker = trpc.schedules.createTempWorker.useMutation({
    onSuccess() {
      toast.success("임시근로자 스케줄 등록됨");
      closeAssignModal();
      invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const updateSchedule = trpc.schedules.update.useMutation({
    onSuccess(data: any) {
      if (data.payrollRecheck) {
        toast.warning("수정됨 — 완료 스케줄 변경으로 정산 재확인 필요");
      } else {
        toast.success("수정됨");
      }
      setEditSchedule(null);
      setDeleteConfirm(false);
      invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const deleteSchedule = trpc.schedules.delete.useMutation({
    onSuccess(data: any) {
      if (data.action === "canceled") {
        if (data.payrollRecheck) {
          toast.warning("취소됨 — 완료 스케줄 취소로 정산 재확인 필요");
        } else {
          toast.success("스케줄이 취소 처리되었습니다");
        }
      } else {
        toast.success("삭제됨");
      }
      setEditSchedule(null);
      setDeleteConfirm(false);
      invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const copyWeek = trpc.schedules.copyPreviousWeek.useMutation({
    onSuccess(data) {
      toast.success(`지난주 ${data.copied}건 복사됨`);
      invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const confirmRange = trpc.schedules.confirmRange.useMutation({
    onSuccess(data: any) {
      const cnt = data?.affected ?? 0;
      if (cnt > 0) toast.success(`${cnt}건 스케줄 확정 완료`);
      else toast.info("확정할 초안 스케줄이 없습니다");
      invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const confirmDay = trpc.schedules.confirmDay.useMutation({
    onSuccess(data: any) { toast.success(`${data.affected}건 확정됨`); invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const invalidate = useCallback(() => {
    utils.schedules.listByRestaurant.invalidate();
    utils.schedules.monthlySummary.invalidate();
  }, [utils]);

  // ─── 메모이제이션된 데이터 ───────────────────
  const scheduleByDate = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>();
    weekDates.forEach((d) => map.set(fmtDate(d), []));
    (scheduleList as ScheduleItem[]).forEach((s) => {
      const key = fmtDate(new Date(s.startTime));
      const list = map.get(key);
      if (list) list.push(s);
    });
    return map;
  }, [scheduleList, weekDates]);

  const activeSchedulesByDate = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>();
    scheduleByDate.forEach((items, dateStr) => {
      map.set(dateStr, items.filter(s => s.status !== "canceled"));
    });
    return map;
  }, [scheduleByDate]);

  const headcountByDate = useMemo(() => {
    const map = new Map<string, number>();
    activeSchedulesByDate.forEach((items, dateStr) => {
      map.set(dateStr, items.reduce((sum, s) =>
        sum + calcHeadcountWeight(s.startTime, s.endTime, current?.openTime, current?.closeTime, current?.halfShiftThreshold), 0));
    });
    return map;
  }, [activeSchedulesByDate, current?.openTime, current?.closeTime, current?.halfShiftThreshold]);

  const assignedUserIds = useMemo(() => {
    if (!assignDate) return new Set<number>();
    const daySchedules = scheduleByDate.get(assignDate) ?? [];
    return new Set(daySchedules.filter((s) => s.userId && s.status !== "canceled").map((s) => s.userId!));
  }, [assignDate, scheduleByDate]);

  const presetTimesMap = useMemo(() => {
    const map = new Map<string, { startTime: string; endTime: string; breakMinutes?: number } | null>();
    if (!shiftPresets) return map;
    const allPresetTypes = new Set<string>();
    ["full", "open", "close"].forEach(p => allPresetTypes.add(p));
    shiftPresets.forEach((p: any) => allPresetTypes.add(p.presetType));
    weekDates.forEach(date => {
      const dateStr = fmtDate(date);
      allPresetTypes.forEach(preset => {
        map.set(`${preset}_${dateStr}`, getPresetTimesInner(preset, dateStr));
      });
    });
    return map;
  }, [shiftPresets, weekDates, current?.openTime, current?.closeTime]);

  // ─── 주 이동 ──────────────────────────────
  const prevWeek = () => { const d = new Date(baseDate); d.setDate(d.getDate() - 7); setBaseDate(d); };
  const nextWeek = () => { const d = new Date(baseDate); d.setDate(d.getDate() + 7); setBaseDate(d); };
  const goThisWeek = () => setBaseDate(new Date());

  // ─── 프리셋 시간 계산 ─────────────────────
  function getPresetTimesInner(preset: string, dateStr?: string) {
    if (shiftPresets.length > 0) {
      const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
      const dow = d.getDay();
      const dayType = (dow === 0 || dow === 6) ? "weekend" : "weekday";
      const custom = shiftPresets.find((p: any) => p.presetType === preset && p.dayType === dayType);
      if (custom) return { startTime: custom.startTime, endTime: custom.endTime, breakMinutes: custom.breakMinutes };
    }
    const openTime = current?.openTime ?? "09:00";
    const closeTime = current?.closeTime ?? "22:00";
    const [oh, om] = openTime.split(":").map(Number);
    const [ch, cm] = closeTime.split(":").map(Number);
    const totalMinutes = (ch * 60 + cm) - (oh * 60 + om);
    const midMinutes = oh * 60 + om + Math.floor(totalMinutes / 2);
    const midTime = `${String(Math.floor(midMinutes / 60)).padStart(2, "0")}:${String(midMinutes % 60).padStart(2, "0")}`;
    switch (preset) {
      case "full": return { startTime: openTime, endTime: closeTime };
      case "open": return { startTime: openTime, endTime: midTime };
      case "close": return { startTime: midTime, endTime: closeTime };
      default: return null;
    }
  }

  const getPresetTimes = (preset: string, dateStr?: string) => {
    if (dateStr) {
      const cached = presetTimesMap.get(`${preset}_${dateStr}`);
      if (cached !== undefined) return cached;
    }
    return getPresetTimesInner(preset, dateStr);
  };

  // ─── 모달 헬퍼 ────────────────────────────
  const openAssignModal = (dateStr: string) => {
    setAssignDate(dateStr);
    setAssignStep("employee");
    setAssignUserIds(new Set());
    setAssignUserNames(new Map());
    setCustomTime({ startTime: "09:00", endTime: "18:00", note: "" });
    setTempForm({ name: "", wageType: "hourly", wageAmount: "", startTime: "09:00", endTime: "18:00", note: "" });
  };
  const closeAssignModal = () => { setAssignDate(null); setAssignStep("employee"); };

  const toggleEmployee = (userId: number, name: string) => {
    setAssignUserIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) { next.delete(userId); } else { next.add(userId); }
      return next;
    });
    setAssignUserNames(prev => {
      const next = new Map(prev);
      if (next.has(userId)) { next.delete(userId); } else { next.set(userId, name); }
      return next;
    });
  };

  const confirmEmployeeSelection = () => {
    if (assignUserIds.size === 0) return;
    setAssignStep("preset");
  };

  const handleQuickAssign = (preset: string) => {
    if (!assignDate || assignUserIds.size === 0) return;
    if (assignUserIds.size === 1) {
      // 단일 선택: 기존 API 사용
      quickAssignMut.mutate({ restaurantId, userId: [...assignUserIds][0], workDate: assignDate, preset });
    } else {
      // 다중 선택: batch API 사용
      batchQuickAssignMut.mutate({ restaurantId, userIds: [...assignUserIds], workDate: assignDate, preset });
    }
  };

  const handleCustomTimeAssign = () => {
    if (!assignDate || !assignUserId) return;
    createSchedule.mutate({
      restaurantId,
      userId: assignUserId,
      workDate: assignDate,
      startTime: customTime.startTime,
      endTime: customTime.endTime,
      note: customTime.note || undefined,
    });
  };

  const handleTempWorkerAssign = () => {
    if (!assignDate || !tempForm.name.trim()) { toast.error("이름을 입력해주세요"); return; }
    createTempWorker.mutate({
      restaurantId,
      tempWorkerName: tempForm.name.trim(),
      workDate: assignDate!,
      startTime: tempForm.startTime,
      endTime: tempForm.endTime,
      wageType: tempForm.wageType,
      wageAmount: tempForm.wageAmount ? Number(tempForm.wageAmount) : undefined,
      note: tempForm.note || undefined,
    });
  };

  const openEditModal = (schedule: ScheduleItem) => {
    setEditSchedule(schedule);
    setEditForm({
      startTime: fmtTime(schedule.startTime),
      endTime: fmtTime(schedule.endTime),
      note: schedule.note ?? "",
      editReason: "",
      shiftPreset: schedule.shiftPreset ?? "custom",
      breakMinutes: schedule.breakMinutes ?? 0,
    });
    setDeleteConfirm(false);
  };

  const handleUpdate = () => {
    if (!editSchedule) return;
    const dateStr = fmtDate(new Date(editSchedule.startTime));
    updateSchedule.mutate({
      id: editSchedule.id,
      restaurantId,
      workDate: dateStr,
      startTime: editForm.startTime,
      endTime: editForm.endTime,
      shiftPreset: editForm.shiftPreset,
      breakMinutes: editForm.breakMinutes,
      note: editForm.note || undefined,
      editReason: editForm.editReason || undefined,
    });
  };

  const handleDelete = () => {
    if (!editSchedule) return;
    const needsReason = editSchedule.status === "confirmed" || editSchedule.status === "completed";
    if (needsReason && !deleteConfirm) { setDeleteConfirm(true); return; }
    deleteSchedule.mutate({ id: editSchedule.id, reason: editForm.editReason || undefined });
  };

  // ─── 빠른배정 핸들러 ─────────────────────
  const handleQuickDateClick = (dateStr: string) => {
    if (!quickMode || !quickUserId) return;
    quickAssignFast.mutate({ restaurantId, userId: quickUserId, workDate: dateStr, preset: quickPreset });
  };

  // ─── 인접 주 프리페치 ─────────────────────
  useEffect(() => {
    if (!isLoading && restaurantId > 0) {
      const prevWeekStart = fmtDate(new Date(weekDates[0].getTime() - 7 * 86400000));
      const prevWeekEnd = fmtDate(new Date(weekDates[0].getTime() - 86400000)) + "T23:59:59";
      const nextWeekStart = fmtDate(new Date(weekDates[6].getTime() + 86400000));
      const nextWeekEnd = fmtDate(new Date(weekDates[6].getTime() + 7 * 86400000)) + "T23:59:59";
      utils.schedules.listByRestaurant.prefetch({ restaurantId, from: prevWeekStart, to: prevWeekEnd });
      utils.schedules.listByRestaurant.prefetch({ restaurantId, from: nextWeekStart, to: nextWeekEnd });
    }
  }, [weekStart, isLoading, restaurantId]);

  const today = fmtDate(new Date());

  // 프리셋 목록 (빠른배정 드롭다운용)
  const presetOptions = useMemo(() => {
    const defaults = [
      { key: "full", apiKey: "fullday", label: "풀타임" },
      { key: "open", apiKey: "open", label: "오픈" },
      { key: "close", apiKey: "close", label: "마감" },
    ];
    const hasDb = shiftPresets.length > 0;
    const filtered = hasDb ? defaults.filter(d => shiftPresets.some((p: any) => p.presetType === d.key)) : defaults;
    const customs = shiftPresets
      .filter((p: any) => p.isCustom && !["open", "full", "close"].includes(p.presetType))
      .reduce((acc: { key: string; apiKey: string; label: string }[], p: any) => {
        if (!acc.find(a => a.key === p.presetType)) acc.push({ key: p.presetType, apiKey: p.presetType, label: p.label || p.presetType });
        return acc;
      }, []);
    return [...filtered, ...customs];
  }, [shiftPresets]);

  return (
    <div className="space-y-3">
      {/* ─── 헤더 ──────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-foreground">스케줄 관리</h1>
        {isManager && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyWeek.mutate({ restaurantId, targetWeekStart: weekStart })}
              disabled={copyWeek.isPending}
              className="text-xs gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" /> 지난주 복사
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => confirmRange.mutate({ restaurantId, from: weekStart, to: weekEnd })}
              disabled={confirmRange.isPending}
              className="text-xs gap-1.5"
            >
              <Send className="w-3.5 h-3.5" /> 초안 전체 확정
            </Button>
          </div>
        )}
      </div>

      {/* ─── 월간 미니맵 (매니저) ──────────────── */}
      {isManager && restaurantId > 0 && (
        <MonthlyMinimap
          restaurantId={restaurantId}
          baseDate={baseDate}
          onDateClick={(date) => setBaseDate(date)}
        />
      )}

      {/* ─── 주 네비게이션 ─────────────────────── */}
      <div className="flex items-center justify-center gap-3">
        <Button variant="ghost" size="icon" onClick={prevWeek} className="h-8 w-8">
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <button onClick={goThisWeek} className="text-sm font-medium text-foreground hover:text-primary">
          {weekDates[0].getMonth() + 1}월 {weekDates[0].getDate()}일 ~ {weekDates[6].getMonth() + 1}월 {weekDates[6].getDate()}일
        </button>
        <Button variant="ghost" size="icon" onClick={nextWeek} className="h-8 w-8">
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>

      {/* ─── 빠른배정 바 (매니저) ──────────────── */}
      {isManager && (
        <div className={`flex items-center gap-2 rounded-lg border p-2 transition-colors ${quickMode ? "bg-primary/5 border-primary/30" : "bg-muted/30 border-border/60"}`}>
          <button
            onClick={() => setQuickMode(!quickMode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              quickMode ? "bg-primary text-primary-foreground" : "bg-background border border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            빠른배정 {quickMode ? "ON" : "OFF"}
          </button>
          {quickMode && (
            <>
              <select
                value={quickUserId}
                onChange={(e) => setQuickUserId(Number(e.target.value))}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs flex-1 min-w-0"
              >
                <option value={0}>직원 선택</option>
                {(staffList as StaffItem[]).map(s => (
                  <option key={s.userId} value={s.userId}>{s.name}</option>
                ))}
              </select>
              <select
                value={quickPreset}
                onChange={(e) => setQuickPreset(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                {presetOptions.map(p => (
                  <option key={p.key} value={p.apiKey}>{p.label}</option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      {/* ─── 상태 흐름 범례 ────────────────────── */}
      <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
        <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">초안</span>
        <span>→</span>
        <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">확정</span>
        <span className="text-[9px]">(직원공개·예상인건비)</span>
        <span>→</span>
        <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">완료</span>
        <span className="text-[9px]">(리포트·지출반영)</span>
      </div>

      {/* ─── 주간 그리드 ───────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
        {weekDates.map((date, i) => {
          const dateStr = fmtDate(date);
          const active = activeSchedulesByDate.get(dateStr) ?? [];
          const allDay = scheduleByDate.get(dateStr) ?? [];
          const isToday = dateStr === today;
          const isWeekend = i >= 5;
          const hc = headcountByDate.get(dateStr) ?? 0;

          return (
            <div
              key={dateStr}
              className={`border rounded-lg min-h-[100px] md:min-h-[140px] p-2 ${
                isToday
                  ? "border-primary bg-primary/5"
                  : isWeekend
                  ? "border-muted bg-muted/30"
                  : "border-border bg-card"
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className={`text-xs md:text-sm font-semibold ${
                    isToday ? "text-primary" : isWeekend ? "text-red-500" : "text-muted-foreground"
                  }`}
                >
                  {DAY_NAMES[i]} {date.getDate()}일
                  {hc > 0 && <span className="ml-1 text-[10px] md:text-xs font-normal">({hc % 1 === 0 ? hc : hc.toFixed(1)}명)</span>}
                </span>
                {allDay.some((s) => s.status === "draft") && (
                  <button
                    onClick={(e) => { e.stopPropagation(); confirmDay.mutate({ restaurantId, date: dateStr }); }}
                    disabled={confirmDay.isPending}
                    className="px-1.5 py-0.5 rounded text-[10px] md:text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors"
                  >
                    확정
                  </button>
                )}
              </div>

              <div className="space-y-1">
                {active.map((s) => {
                  const st = STATUS_LABELS[s.status] ?? STATUS_LABELS.draft;
                  const presetLabel = s.shiftPreset ? resolvePresetLabel(s.shiftPreset, shiftPresets) : "";
                  return (
                    <button
                      key={s.id}
                      onClick={() => openEditModal(s)}
                      className={`w-full text-left p-1 md:p-1.5 rounded bg-background border-l-2 ${st.bgCard} border border-border/50 text-xs active:bg-accent/50 transition-colors`}
                    >
                      <div className="flex items-center gap-1">
                        <span className={`font-medium truncate text-[11px] md:text-xs ${s.tempWorkerName ? "text-orange-600 dark:text-orange-400" : "text-foreground"}`}>
                          {(() => {
                            if (s.userName) {
                              return s.userName.length >= 2 ? s.userName.slice(1) : s.userName;
                            }
                            return s.tempWorkerName ?? "미배정";
                          })()}
                        </span>
                        <span className={`shrink-0 px-1 py-0 rounded text-[9px] md:text-[10px] font-medium leading-tight ${st.color}`}>
                          {st.label.charAt(0)}
                        </span>
                        {s.tempWorkerName && (
                          <span className="shrink-0 px-1 py-0 rounded text-[9px] md:text-[10px] font-medium leading-tight bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400">
                            임시
                          </span>
                        )}
                        <span className="text-muted-foreground text-[10px] md:text-[11px] shrink-0 ml-auto">
                          {presetLabel ? presetLabel.charAt(0) : `${fmtTime(s.startTime)}~${fmtTime(s.endTime)}`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {isManager && (
                quickMode && quickUserId ? (
                  <button
                    onClick={() => handleQuickDateClick(dateStr)}
                    disabled={quickAssignFast.isPending}
                    className="w-full mt-1 py-2 rounded border border-dashed border-primary/40 text-[11px] md:text-xs text-primary font-medium hover:bg-primary/5 active:bg-primary/10 transition-colors"
                  >
                    + 배정하기
                  </button>
                ) : (
                  <button
                    onClick={() => openAssignModal(dateStr)}
                    className="w-full mt-1 py-2 rounded border border-dashed border-border/60 text-[11px] md:text-xs text-muted-foreground hover:bg-accent/30 active:bg-accent/50 transition-colors"
                  >
                    + 직원 배정
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>

      {isLoading && (
        <div className="text-center py-8 text-muted-foreground">로딩 중...</div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          직원 배정 바텀시트
          ═══════════════════════════════════════════════════════════════════════ */}
      {assignDate && (
        <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={closeAssignModal} />
          <div className="relative z-10 bg-card border-t md:border border-border rounded-t-2xl md:rounded-xl shadow-xl w-full max-w-md md:mx-4 max-h-[75vh] flex flex-col mb-[88px] md:mb-0">
            <div className="flex justify-center pt-2 md:hidden">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>

            <div className="flex items-center justify-between p-4 pb-2">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {assignStep === "employee" && "직원 선택"}
                  {assignStep === "preset" && (
                    assignUserIds.size <= 2
                      ? `${[...assignUserNames.values()].join(", ")} — 근무유형`
                      : `${[...assignUserNames.values()].slice(0, 2).join(", ")} 외 ${assignUserIds.size - 2}명 — 근무유형`
                  )}
                  {assignStep === "custom-time" && `${assignUserName} — 시간 직접입력`}
                  {assignStep === "temp-worker" && "임시근로자 등록"}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">{assignDate}</p>
              </div>
              <button onClick={closeAssignModal} className="p-1.5 rounded-full hover:bg-accent">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step 1: 직원 목록 (다중 체크박스 선택) */}
            {assignStep === "employee" && (
              <div className="overflow-y-auto flex-1 px-4 pb-4 flex flex-col">
                {staffList.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">등록된 직원이 없습니다</p>
                ) : (
                  <>
                    {/* 전체 선택 / 해제 */}
                    {(() => {
                      const availableStaff = (staffList as StaffItem[]).filter(s => !assignedUserIds.has(s.userId));
                      const allSelected = availableStaff.length > 0 && availableStaff.every(s => assignUserIds.has(s.userId));
                      return availableStaff.length > 1 ? (
                        <button
                          onClick={() => {
                            if (allSelected) {
                              setAssignUserIds(new Set());
                              setAssignUserNames(new Map());
                            } else {
                              setAssignUserIds(new Set(availableStaff.map(s => s.userId)));
                              setAssignUserNames(new Map(availableStaff.map(s => [s.userId, s.name])));
                            }
                          }}
                          className="flex items-center gap-2 px-3 py-2 mb-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                            allSelected ? "bg-primary border-primary" : "border-muted-foreground/40"
                          }`}>
                            {allSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                          </div>
                          {allSelected ? "전체 해제" : `전체 선택 (${availableStaff.length}명)`}
                        </button>
                      ) : null;
                    })()}
                    <div className="space-y-1">
                      {(staffList as StaffItem[]).map((staff) => {
                        const isAssigned = assignedUserIds.has(staff.userId);
                        const isChecked = assignUserIds.has(staff.userId);
                        const roleLabel =
                          staff.storeRole === "owner" || staff.storeRole === "store_manager" ? "점장"
                            : staff.storeRole === "supervisor" || staff.storeRole === "manager" ? "매니져"
                            : "직원";
                        return (
                          <button
                            key={staff.userId}
                            disabled={isAssigned}
                            onClick={() => toggleEmployee(staff.userId, staff.name)}
                            className={`w-full flex items-center justify-between p-3 rounded-lg text-sm transition-colors ${
                              isAssigned
                                ? "opacity-40 cursor-not-allowed bg-muted/30"
                                : isChecked
                                ? "bg-primary/5 ring-1 ring-primary/30"
                                : "hover:bg-accent active:bg-accent/70"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {/* 체크박스 */}
                              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${
                                isAssigned ? "border-muted bg-muted/30"
                                  : isChecked ? "border-primary bg-primary" : "border-muted-foreground/40"
                              }`}>
                                {isChecked && <Check className="w-3.5 h-3.5 text-primary-foreground" />}
                              </div>
                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                                {staff.name.charAt(0)}
                              </div>
                              <div className="text-left">
                                <span className="font-medium text-foreground">{staff.name}</span>
                                <span className="text-xs text-muted-foreground ml-2">{roleLabel}</span>
                              </div>
                            </div>
                            {isAssigned && (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground">배정됨</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                <div className="mt-3 pt-3 border-t border-border">
                  <button
                    onClick={() => setAssignStep("temp-worker")}
                    className="w-full flex items-center gap-3 p-3 rounded-lg text-sm hover:bg-accent active:bg-accent/70 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                      <UserPlus className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                    </div>
                    <div className="text-left">
                      <span className="font-medium text-foreground">임시근로자 추가</span>
                      <span className="text-xs text-muted-foreground ml-2">급구/일용직</span>
                    </div>
                  </button>
                </div>

                {/* 선택 확정 버튼 (하단 고정) */}
                {assignUserIds.size > 0 && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <button
                      onClick={confirmEmployeeSelection}
                      className="w-full flex items-center justify-center gap-2 p-3 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors"
                    >
                      <Users className="w-4 h-4" />
                      {assignUserIds.size}명 선택 — 근무유형 선택
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: 프리셋 선택 */}
            {assignStep === "preset" && (
              <div className="px-4 pb-6 space-y-2 overflow-y-auto flex-1">
                <button
                  onClick={() => setAssignStep("employee")}
                  className="text-xs text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1"
                >
                  <ChevronLeft className="w-3 h-3" /> 직원 다시 선택
                </button>
                {/* 공휴일 알림 */}
                {assignDate && (() => {
                  const hName = getHolidayName(assignDate);
                  if (!hName) return null;
                  return (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs">
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-amber-800 dark:text-amber-300">{hName} (공휴일)</p>
                        <p className="text-amber-700 dark:text-amber-400 mt-0.5">
                          5인 이상 사업장 계약 직원에게 <span className="font-bold">대체휴무 1일</span>이 자동 발생합니다.
                        </p>
                      </div>
                    </div>
                  );
                })()}
                {/* 동적 프리셋 버튼 */}
                {(() => {
                  const allDefaults = [
                    { key: "full", apiKey: "fullday", label: "풀타임", icon: Maximize2, fallbackDesc: "영업시간 전체 근무" },
                    { key: "open", apiKey: "open", label: "오픈", icon: Sun, fallbackDesc: "오픈 ~ 중간시간" },
                    { key: "close", apiKey: "close", label: "마감", icon: Moon, fallbackDesc: "중간시간 ~ 마감" },
                  ];
                  const hasDbPresets = shiftPresets.length > 0;
                  const defaultTypes = hasDbPresets
                    ? allDefaults.filter(({ key }) => shiftPresets.some((p: any) => p.presetType === key))
                    : allDefaults;
                  const customTypes = shiftPresets
                    .filter((p: any) => p.isCustom && !["open", "full", "close"].includes(p.presetType))
                    .reduce((acc: any[], p: any) => { if (!acc.find((a: any) => a.presetType === p.presetType)) acc.push(p); return acc; }, []);

                  return (
                    <>
                      {defaultTypes.map(({ key, apiKey, label: defLabel, icon: Icon, fallbackDesc }) => {
                        const dbPreset = shiftPresets.find((p: any) => p.presetType === key);
                        const displayLabel = dbPreset?.label || defLabel;
                        return (
                          <button
                            key={key}
                            onClick={() => handleQuickAssign(apiKey)}
                            disabled={quickAssignMut.isPending || batchQuickAssignMut.isPending}
                            className="w-full flex items-center gap-3 p-4 rounded-lg border border-border hover:bg-accent active:bg-accent/70 transition-colors"
                          >
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <Icon className="w-5 h-5 text-primary" />
                            </div>
                            <div className="text-left">
                              <div className="font-medium text-foreground text-sm">{displayLabel}</div>
                              <div className="text-xs text-muted-foreground">
                                {(() => {
                                  const times = getPresetTimes(key, assignDate ?? undefined);
                                  if (times) return `${times.startTime} ~ ${times.endTime}`;
                                  return fallbackDesc;
                                })()}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                      {customTypes.map((cp: any) => (
                        <button
                          key={cp.presetType}
                          onClick={() => handleQuickAssign(cp.presetType)}
                          disabled={quickAssignMut.isPending || batchQuickAssignMut.isPending}
                          className="w-full flex items-center gap-3 p-4 rounded-lg border border-border hover:bg-accent active:bg-accent/70 transition-colors"
                        >
                          <div className="w-10 h-10 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                            <Clock className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                          </div>
                          <div className="text-left">
                            <div className="font-medium text-foreground text-sm">{cp.label || cp.presetType}</div>
                            <div className="text-xs text-muted-foreground">
                              {(() => {
                                const times = getPresetTimes(cp.presetType, assignDate ?? undefined);
                                if (times) return `${times.startTime} ~ ${times.endTime}`;
                                return "커스텀 근무";
                              })()}
                            </div>
                          </div>
                        </button>
                      ))}
                    </>
                  );
                })()}

                {/* 시간 직접입력: 단일 선택 시에만 표시 */}
                {assignUserIds.size === 1 && (
                  <button
                    onClick={() => setAssignStep("custom-time")}
                    className="w-full flex items-center gap-3 p-4 rounded-lg border border-dashed border-border hover:bg-accent active:bg-accent/70 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                      <Pencil className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="text-left">
                      <div className="font-medium text-foreground text-sm">시간 직접입력</div>
                      <div className="text-xs text-muted-foreground">출퇴근 시간 수동 설정</div>
                    </div>
                  </button>
                )}
              </div>
            )}

            {/* Step 2b: 시간 직접입력 */}
            {assignStep === "custom-time" && (
              <div className="px-4 pb-6 space-y-3 overflow-y-auto flex-1">
                <button
                  onClick={() => setAssignStep("preset")}
                  className="text-xs text-muted-foreground hover:text-foreground mb-1 flex items-center gap-1"
                >
                  <ChevronLeft className="w-3 h-3" /> 근무유형 선택
                </button>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">시작</label>
                    <input
                      type="time" step="600"
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={customTime.startTime}
                      onChange={(e) => setCustomTime({ ...customTime, startTime: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">종료</label>
                    <input
                      type="time" step="600"
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={customTime.endTime}
                      onChange={(e) => setCustomTime({ ...customTime, endTime: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">메모</label>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={customTime.note}
                    onChange={(e) => setCustomTime({ ...customTime, note: e.target.value })}
                    placeholder="선택 사항"
                  />
                </div>

                <Button className="w-full" onClick={handleCustomTimeAssign} disabled={createSchedule.isPending}>
                  등록
                </Button>
              </div>
            )}

            {/* Step: 임시근로자 입력 */}
            {assignStep === "temp-worker" && (
              <div className="px-4 pb-6 space-y-3 overflow-y-auto flex-1">
                <button
                  onClick={() => setAssignStep("employee")}
                  className="text-xs text-muted-foreground hover:text-foreground mb-1 flex items-center gap-1"
                >
                  <ChevronLeft className="w-3 h-3" /> 직원 선택
                </button>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">이름 *</label>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={tempForm.name}
                    onChange={(e) => setTempForm({ ...tempForm, name: e.target.value })}
                    placeholder="근로자 이름"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">급여 유형</label>
                  <div className="mt-1 flex gap-2">
                    <button
                      onClick={() => setTempForm({ ...tempForm, wageType: "hourly" })}
                      className={`flex-1 py-2 rounded-md border text-sm font-medium transition-colors ${
                        tempForm.wageType === "hourly"
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      시급
                    </button>
                    <button
                      onClick={() => setTempForm({ ...tempForm, wageType: "daily" })}
                      className={`flex-1 py-2 rounded-md border text-sm font-medium transition-colors ${
                        tempForm.wageType === "daily"
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      일급
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    금액 ({tempForm.wageType === "hourly" ? "시급" : "일급"})
                  </label>
                  <div className="mt-1 relative">
                    <input
                      type="number"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm pr-8"
                      value={tempForm.wageAmount}
                      onChange={(e) => setTempForm({ ...tempForm, wageAmount: e.target.value })}
                      placeholder={tempForm.wageType === "hourly" ? "예: 10030" : "예: 80000"}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">원</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">시작</label>
                    <input
                      type="time" step="600"
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={tempForm.startTime}
                      onChange={(e) => setTempForm({ ...tempForm, startTime: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">종료</label>
                    <input
                      type="time" step="600"
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={tempForm.endTime}
                      onChange={(e) => setTempForm({ ...tempForm, endTime: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">메모</label>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={tempForm.note}
                    onChange={(e) => setTempForm({ ...tempForm, note: e.target.value })}
                    placeholder="선택 사항"
                  />
                </div>

                <Button
                  className="w-full"
                  onClick={handleTempWorkerAssign}
                  disabled={createTempWorker.isPending || !tempForm.name.trim()}
                >
                  임시근로자 등록
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          스케줄 수정/삭제 모달
          ═══════════════════════════════════════════════════════════════════════ */}
      {editSchedule && (
        <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEditSchedule(null)} />
          <div className="relative z-10 bg-card border-t md:border border-border rounded-t-2xl md:rounded-xl shadow-xl w-full max-w-md md:mx-4 mb-[88px] md:mb-0">
            <div className="flex justify-center pt-2 md:hidden">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>

            <div className="flex items-center justify-between p-4 pb-2">
              <div>
                <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Edit3 className="w-4 h-4" />
                  {editSchedule.userName ?? editSchedule.tempWorkerName ?? "미배정"}
                  {editSchedule.tempWorkerName && <span className="text-xs text-orange-500">(임시)</span>}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {fmtDate(new Date(editSchedule.startTime))} · {
                    (STATUS_LABELS[editSchedule.status] ?? STATUS_LABELS.draft).label
                  }
                </p>
              </div>
              <button onClick={() => setEditSchedule(null)} className="p-1.5 rounded-full hover:bg-accent">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-4 pb-4 space-y-3">
              {editSchedule.status === "confirmed" && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-amber-700 dark:text-amber-400">
                    <span className="font-semibold">확정된 스케줄</span> — 수정/삭제 시 사유 입력이 필요하며, 직원에게 변경 사항이 반영됩니다.
                  </div>
                </div>
              )}
              {editSchedule.status === "completed" && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-200 dark:border-red-800">
                  <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-red-700 dark:text-red-400">
                    <span className="font-semibold">완료된 스케줄</span> — 수정/삭제 시 사유 입력이 필요하며, 정산 재확인이 발생합니다.
                  </div>
                </div>
              )}

              {/* 근무유형 선택 */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">근무유형</label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {(() => {
                    const allDefaultItems = [
                      { key: "full", label: shiftPresets.find((p: any) => p.presetType === "full")?.label || "풀타임", icon: Maximize2 },
                      { key: "open", label: shiftPresets.find((p: any) => p.presetType === "open")?.label || "오픈", icon: Sun },
                      { key: "close", label: shiftPresets.find((p: any) => p.presetType === "close")?.label || "마감", icon: Moon },
                    ];
                    const hasDbPresets = shiftPresets.length > 0;
                    const defaultItems = hasDbPresets
                      ? allDefaultItems.filter(({ key }) => shiftPresets.some((p: any) => p.presetType === key))
                      : allDefaultItems;
                    const customItems = shiftPresets
                      .filter((p: any) => p.isCustom && !["open", "full", "close"].includes(p.presetType))
                      .reduce((acc: any[], p: any) => {
                        if (!acc.find((a: any) => a.presetType === p.presetType)) acc.push(p);
                        return acc;
                      }, [])
                      .map((p: any) => ({ key: p.presetType, label: p.label || p.presetType, icon: Clock }));
                    const allItems = [...defaultItems, ...customItems, { key: "custom", label: "직접입력", icon: Clock }];
                    return allItems.map(({ key, label, icon: Icon }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          const editDateStr = editSchedule ? fmtDate(new Date(editSchedule.startTime)) : undefined;
                          const times = getPresetTimes(key, editDateStr);
                          const brk = times?.breakMinutes ?? (key === "full" ? 60 : 0);
                          if (times) {
                            setEditForm({ ...editForm, shiftPreset: key, startTime: times.startTime, endTime: times.endTime, breakMinutes: brk });
                          } else {
                            setEditForm({ ...editForm, shiftPreset: key, breakMinutes: brk });
                          }
                        }}
                        className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg border text-xs font-medium transition-colors ${
                          editForm.shiftPreset === key
                            ? "bg-primary/10 border-primary text-primary"
                            : "border-border text-muted-foreground hover:bg-muted/50"
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                      </button>
                    ));
                  })()}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">시작</label>
                  <input
                    type="time" step="600"
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={editForm.startTime}
                    onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value, shiftPreset: "custom" })}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">종료</label>
                  <input
                    type="time" step="600"
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={editForm.endTime}
                    onChange={(e) => setEditForm({ ...editForm, endTime: e.target.value, shiftPreset: "custom" })}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">휴게시간 (분)</label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min={0}
                    max={240}
                    step={10}
                    className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={editForm.breakMinutes}
                    onChange={(e) => setEditForm({ ...editForm, breakMinutes: Math.max(0, Number(e.target.value)) })}
                  />
                  <span className="text-xs text-muted-foreground">분</span>
                  {editForm.breakMinutes > 0 && (() => {
                    const [sh, sm] = editForm.startTime.split(":").map(Number);
                    const [eh, em] = editForm.endTime.split(":").map(Number);
                    const totalMin = (eh * 60 + em) - (sh * 60 + sm);
                    const netMin = totalMin - editForm.breakMinutes;
                    if (netMin > 0) {
                      const h = Math.floor(netMin / 60);
                      const m = netMin % 60;
                      return <span className="text-xs text-muted-foreground">(실근무 {h}시간{m > 0 ? ` ${m}분` : ""})</span>;
                    }
                    return null;
                  })()}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">메모</label>
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={editForm.note}
                  onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                  placeholder="선택 사항"
                />
              </div>

              {(editSchedule.status === "confirmed" || editSchedule.status === "completed") && (
                <div>
                  <label className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    변경 사유 *
                  </label>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border border-amber-300 dark:border-amber-700 bg-background px-3 py-2 text-sm focus:ring-amber-500"
                    value={editForm.editReason}
                    onChange={(e) => setEditForm({ ...editForm, editReason: e.target.value })}
                    placeholder="수정/삭제 사유를 입력하세요"
                  />
                </div>
              )}

              {deleteConfirm && (
                <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-300 dark:border-red-800 text-xs text-red-700 dark:text-red-400">
                  {editSchedule.status === "completed"
                    ? "완료된 스케줄을 취소하면 정산에 영향을 줍니다. 사유를 입력 후 다시 삭제를 눌러주세요."
                    : "확정된 스케줄을 취소합니다. 사유를 입력 후 다시 삭제를 눌러주세요."}
                </div>
              )}

              {isManager && (
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-1"
                    onClick={handleDelete}
                    disabled={deleteSchedule.isPending}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    {deleteConfirm ? "삭제 확인" : editSchedule.status === "draft" ? "삭제" : "취소 처리"}
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={handleUpdate}
                    disabled={updateSchedule.isPending}
                  >
                    저장
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
