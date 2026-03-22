import { useState, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Copy,
  Send,
  CheckCircle,
  Lock,
  Clock,
  UserPlus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/compat";

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function getWeekDates(baseDate: Date): Date[] {
  const d = new Date(baseDate);
  const day = d.getDay(); // 0=일
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((day + 6) % 7)); // 이번 주 월요일
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(mon);
    dd.setDate(mon.getDate() + i);
    return dd;
  });
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtTime(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const DAY_NAMES = ["월", "화", "수", "목", "금", "토", "일"];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "초안", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  published: { label: "고지", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300" },
  completed: { label: "완료", color: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300" },
  confirmed: { label: "확정", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300" },
  canceled: { label: "취소", color: "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400" },
};

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;

  const [baseDate, setBaseDate] = useState(new Date());
  const weekDates = useMemo(() => getWeekDates(baseDate), [baseDate]);

  const weekStart = fmtDate(weekDates[0]);
  const weekEnd = fmtDate(weekDates[6]) + "T23:59:59";

  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [addForm, setAddForm] = useState({ userId: 0, startTime: "09:00", endTime: "18:00", note: "" });

  const utils = trpc.useUtils();

  const { data: scheduleList = [], isLoading } = trpc.schedules.listByRestaurant.useQuery(
    { restaurantId, from: weekStart, to: weekEnd },
    { enabled: restaurantId > 0 }
  );

  // 매장 직원 목록
  const { data: staffList = [] } = trpc.restaurants.getStaff.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 }
  );

  const createSchedule = trpc.schedules.create.useMutation({
    onSuccess() {
      toast.success("스케줄 추가됨");
      setShowAddModal(false);
      invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const deleteSchedule = trpc.schedules.delete.useMutation({
    onSuccess() { toast.success("삭제됨"); invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const copyWeek = trpc.schedules.copyPreviousWeek.useMutation({
    onSuccess(data) {
      toast.success(`지난주 ${data.copied}건 복사됨`);
      invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const publishRange = trpc.schedules.publishRange.useMutation({
    onSuccess() { toast.success("고지 완료"); invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const completeRange = trpc.schedules.completeRange.useMutation({
    onSuccess() { toast.success("근무완료 처리됨"); invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const confirmRange = trpc.schedules.confirmRange.useMutation({
    onSuccess() { toast.success("인건비 확정됨"); invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const invalidate = () => {
    utils.schedules.listByRestaurant.invalidate();
  };

  // 날짜별 스케줄 그룹핑
  const scheduleByDate = useMemo(() => {
    const map = new Map<string, typeof scheduleList>();
    weekDates.forEach((d) => map.set(fmtDate(d), []));
    scheduleList.forEach((s) => {
      const key = fmtDate(new Date(s.startTime));
      const list = map.get(key);
      if (list) list.push(s);
    });
    return map;
  }, [scheduleList, weekDates]);

  // 주 이동
  const prevWeek = () => {
    const d = new Date(baseDate);
    d.setDate(d.getDate() - 7);
    setBaseDate(d);
  };
  const nextWeek = () => {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 7);
    setBaseDate(d);
  };
  const goThisWeek = () => setBaseDate(new Date());

  if (!current) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  const today = fmtDate(new Date());

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-foreground">스케줄 관리</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => copyWeek.mutate({ restaurantId, targetWeekStart: weekStart })}
            disabled={copyWeek.isPending}
          >
            <Copy className="w-4 h-4 mr-1" /> 지난주 복사
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => publishRange.mutate({ restaurantId, from: weekStart, to: weekEnd })}
            disabled={publishRange.isPending}
          >
            <Send className="w-4 h-4 mr-1" /> 전체 고지
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => completeRange.mutate({ restaurantId, from: weekStart, to: weekEnd })}
            disabled={completeRange.isPending}
          >
            <CheckCircle className="w-4 h-4 mr-1" /> 전체 완료
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => confirmRange.mutate({ restaurantId, from: weekStart, to: weekEnd })}
            disabled={confirmRange.isPending}
          >
            <Lock className="w-4 h-4 mr-1" /> 전체 확정
          </Button>
        </div>
      </div>

      {/* 주 네비게이션 */}
      <div className="flex items-center justify-center gap-4">
        <Button variant="ghost" size="icon" onClick={prevWeek}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <button
          onClick={goThisWeek}
          className="text-sm font-medium text-foreground hover:text-primary"
        >
          {weekDates[0].getMonth() + 1}월 {weekDates[0].getDate()}일 ~ {weekDates[6].getMonth() + 1}월 {weekDates[6].getDate()}일
        </button>
        <Button variant="ghost" size="icon" onClick={nextWeek}>
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>

      {/* 주간 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
        {weekDates.map((date, i) => {
          const dateStr = fmtDate(date);
          const daySchedules = scheduleByDate.get(dateStr) ?? [];
          const isToday = dateStr === today;
          const isWeekend = i >= 5;

          return (
            <div
              key={dateStr}
              className={`border rounded-lg min-h-[140px] p-2 ${
                isToday
                  ? "border-primary bg-primary/5"
                  : isWeekend
                  ? "border-muted bg-muted/30"
                  : "border-border bg-card"
              }`}
            >
              {/* 날짜 헤더 */}
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`text-xs font-semibold ${
                    isToday ? "text-primary" : isWeekend ? "text-red-500" : "text-muted-foreground"
                  }`}
                >
                  {DAY_NAMES[i]} {date.getDate()}일
                </span>
                <button
                  onClick={() => {
                    setSelectedDate(dateStr);
                    setAddForm({ userId: 0, startTime: "09:00", endTime: "18:00", note: "" });
                    setShowAddModal(true);
                  }}
                  className="p-0.5 rounded hover:bg-accent"
                >
                  <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>

              {/* 스케줄 카드 */}
              <div className="space-y-1">
                {daySchedules.map((s) => {
                  const st = STATUS_LABELS[s.status] ?? STATUS_LABELS.draft;
                  return (
                    <div
                      key={s.id}
                      className="group relative p-1.5 rounded bg-background border border-border/50 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground truncate">
                          {s.userName ?? s.tempWorkerName ?? "미배정"}
                        </span>
                        <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${st.color}`}>
                          {st.label}
                        </span>
                      </div>
                      <div className="text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />
                        {fmtTime(s.startTime)} ~ {fmtTime(s.endTime)}
                      </div>
                      {s.note && (
                        <div className="text-muted-foreground truncate mt-0.5">{s.note}</div>
                      )}
                      {/* 삭제 버튼 */}
                      <button
                        onClick={() => {
                          if (confirm("삭제하시겠습니까?")) deleteSchedule.mutate({ id: s.id });
                        }}
                        className="absolute top-1 right-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-opacity"
                      >
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </button>
                    </div>
                  );
                })}
                {daySchedules.length === 0 && (
                  <div className="text-center text-[10px] text-muted-foreground py-2">-</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 스케줄 추가 모달 */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">스케줄 추가</h2>
              <button onClick={() => setShowAddModal(false)} className="p-1 rounded hover:bg-accent">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-sm text-muted-foreground mb-4">{selectedDate}</div>

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-foreground">직원</label>
                <select
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={addForm.userId}
                  onChange={(e) => setAddForm({ ...addForm, userId: Number(e.target.value) })}
                >
                  <option value={0}>선택...</option>
                  {staffList.map((s: any) => (
                    <option key={s.userId} value={s.userId}>
                      {s.name} ({s.storeRole === "store_manager" ? "점장" : s.storeRole === "manager" ? "매니저" : "직원"})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-foreground">시작</label>
                  <input
                    type="time"
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={addForm.startTime}
                    onChange={(e) => setAddForm({ ...addForm, startTime: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">종료</label>
                  <input
                    type="time"
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={addForm.endTime}
                    onChange={(e) => setAddForm({ ...addForm, endTime: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">메모</label>
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={addForm.note}
                  onChange={(e) => setAddForm({ ...addForm, note: e.target.value })}
                  placeholder="선택 사항"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddModal(false)}>
                취소
              </Button>
              <Button
                onClick={() => {
                  if (!addForm.userId) {
                    toast.error("직원을 선택해주세요");
                    return;
                  }
                  createSchedule.mutate({
                    restaurantId,
                    userId: addForm.userId,
                    workDate: selectedDate,
                    startTime: addForm.startTime,
                    endTime: addForm.endTime,
                    note: addForm.note || undefined,
                  });
                }}
                disabled={createSchedule.isPending}
              >
                추가
              </Button>
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="text-center py-8 text-muted-foreground">로딩 중...</div>
      )}
    </div>
  );
}
