import { useState, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { getEffectiveRole, isManagerLevel } from "@shared/permissions";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Send,
  Clock,
  X,
  MoreHorizontal,
  Trash2,
  Edit3,
  Sun,
  Moon,
  Maximize2,
  UserPlus,
  Pencil,
  AlertTriangle,
  CalendarOff,
  Check,
  Settings,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { getHolidayName } from "@shared/holidays";

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function getWeekDates(baseDate: Date): Date[] {
  const d = new Date(baseDate);
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((day + 6) % 7));
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

const STATUS_LABELS: Record<string, { label: string; color: string; bgCard: string }> = {
  draft: {
    label: "초안",
    color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    bgCard: "border-l-gray-400",
  },
  confirmed: {
    label: "확정",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
    bgCard: "border-l-blue-500",
  },
  completed: {
    label: "완료",
    color: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
    bgCard: "border-l-green-500",
  },
  canceled: {
    label: "취소",
    color: "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400",
    bgCard: "border-l-red-400",
  },
};

// 기본 프리셋 라벨 (DB에 없을 때 폴백)
const DEFAULT_PRESET_LABELS: Record<string, { label: string; icon: typeof Sun }> = {
  open: { label: "오픈", icon: Sun },
  close: { label: "마감", icon: Moon },
  full: { label: "풀타임", icon: Maximize2 },
  fullday: { label: "풀타임", icon: Maximize2 },
};

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type ScheduleItem = {
  id: number;
  userId: number | null;
  tempWorkerName: string | null;
  tempWageType: string | null;
  tempWageAmount: string | null;
  userName: string | null;
  startTime: string | Date;
  endTime: string | Date;
  status: string;
  shiftPreset: string | null;
  breakMinutes: number | null;
  note: string | null;
  editReason: string | null;
  payrollRecheckRequired: boolean | null;
};

type StaffItem = {
  userId: number;
  name: string;
  storeRole: string;
};

// ─── 휴무/반차 신청 섹션 ──────────────────────────────────────────────────────

const LEAVE_LABELS: Record<string, string> = {
  dayoff: "휴무",
  half_morning: "반차출근 (오전OFF)",
  half_evening: "반차퇴근 (오후OFF)",
};
const REQ_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "대기", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  approved: { label: "승인", color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  rejected: { label: "거절", color: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400" },
};

function LeaveRequestSection({ restaurantId, isManager }: { restaurantId: number; isManager: boolean }) {
  const [showForm, setShowForm] = useState(false);
  const [leaveDate, setLeaveDate] = useState("");
  const [leaveType, setLeaveType] = useState<"dayoff" | "half_morning" | "half_evening">("dayoff");
  const [reason, setReason] = useState("");

  const utils = trpc.useUtils();

  // 직원: 내 신청 / 매니저: 전체 신청
  const myLeaves = trpc.leaveRequests.listMine.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 && !isManager },
  );
  const allLeaves = trpc.leaveRequests.list.useQuery(
    { restaurantId, status: "pending" },
    { enabled: restaurantId > 0 && isManager },
  );

  const createLeave = trpc.leaveRequests.create.useMutation({
    onSuccess() {
      toast.success("휴무/반차 신청 완료");
      setShowForm(false);
      setLeaveDate("");
      setLeaveType("dayoff");
      setReason("");
      utils.leaveRequests.listMine.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const cancelLeave = trpc.leaveRequests.cancel.useMutation({
    onSuccess() {
      toast.success("신청이 취소되었습니다");
      utils.leaveRequests.listMine.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const reviewLeave = trpc.leaveRequests.review.useMutation({
    onSuccess() {
      toast.success("처리 완료");
      utils.leaveRequests.list.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const handleSubmit = () => {
    if (!leaveDate) { toast.error("날짜를 선택해주세요"); return; }
    createLeave.mutate({ restaurantId, leaveDate, leaveType, reason: reason || undefined });
  };

  // 5일 후부터 선택 가능
  const minDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    return fmtDate(d);
  }, []);

  const leaves = isManager ? (allLeaves.data || []) : (myLeaves.data || []);

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarOff className="h-4 w-4 text-primary" />
            {isManager ? "휴무/반차 신청 관리" : "휴무/반차 신청"}
          </CardTitle>
          {!isManager && (
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setShowForm(!showForm)}>
              {showForm ? "취소" : "신청하기"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 신청 폼 (직원만) */}
        {showForm && !isManager && (
          <div className="p-3 rounded-lg bg-muted/50 border space-y-3">
            <p className="text-[10px] text-muted-foreground">최소 5일 전 신청 필요</p>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">날짜</label>
              <input
                type="date"
                min={minDate}
                value={leaveDate}
                onChange={(e) => setLeaveDate(e.target.value)}
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">유형</label>
              <div className="grid grid-cols-3 gap-1.5">
                {(["dayoff", "half_morning", "half_evening"] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setLeaveType(t)}
                    className={`text-xs py-2 rounded-md border transition-colors ${
                      leaveType === t
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {t === "dayoff" ? "휴무" : t === "half_morning" ? "반차출근" : "반차퇴근"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">사유 (선택)</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="사유를 입력하세요"
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              />
            </div>
            <Button size="sm" className="w-full" onClick={handleSubmit} disabled={createLeave.isPending}>
              {createLeave.isPending ? "신청 중..." : "신청"}
            </Button>
          </div>
        )}

        {/* 신청 목록 */}
        {leaves.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">
            {isManager ? "대기 중인 신청이 없습니다" : "신청 내역이 없습니다"}
          </p>
        ) : (
          <div className="space-y-2">
            {leaves.map((l: any) => (
              <div key={l.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                <div className="min-w-0">
                  {isManager && l.userName && (
                    <span className="font-medium text-foreground mr-1.5">{l.userName}</span>
                  )}
                  <span className="text-foreground">
                    {typeof l.leaveDate === "string" ? l.leaveDate : new Date(l.leaveDate).toISOString().substring(0, 10)}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1.5">
                    {LEAVE_LABELS[l.leaveType] || l.leaveType}
                  </span>
                  {l.reason && <span className="text-xs text-muted-foreground ml-1.5">· {l.reason}</span>}
                  {l.reviewNote && <span className="text-xs text-amber-600 dark:text-amber-400 ml-1.5">({l.reviewNote})</span>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isManager && l.status === "pending" ? (
                    <>
                      <Button
                        size="sm" variant="outline"
                        className="text-[10px] h-6 px-2 border-green-300 text-green-600 hover:bg-green-50"
                        onClick={() => reviewLeave.mutate({ id: l.id, status: "approved" })}
                        disabled={reviewLeave.isPending}
                      >
                        <Check className="w-3 h-3 mr-0.5" /> 승인
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        className="text-[10px] h-6 px-2 border-red-300 text-red-600 hover:bg-red-50"
                        onClick={() => reviewLeave.mutate({ id: l.id, status: "rejected" })}
                        disabled={reviewLeave.isPending}
                      >
                        <X className="w-3 h-3 mr-0.5" /> 거절
                      </Button>
                    </>
                  ) : (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${REQ_STATUS[l.status]?.color || ""}`}>
                      {REQ_STATUS[l.status]?.label || l.status}
                    </span>
                  )}
                  {!isManager && l.status === "pending" && (
                    <Button
                      size="sm" variant="ghost"
                      className="text-[10px] h-6 px-1.5 text-muted-foreground hover:text-destructive"
                      onClick={() => cancelLeave.mutate({ id: l.id })}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── 근무유형 프리셋 설정 ─────────────────────────────────────────────────────

const SHIFT_PRESET_DEFAULTS = [
  { value: "open", label: "오픈" },
  { value: "full", label: "풀타임" },
  { value: "close", label: "마감" },
] as const;
const SHIFT_DAY_TYPES = [
  { value: "weekday", label: "평일" },
  { value: "weekend", label: "주말" },
] as const;

function ShiftPresetPanel({ restaurantId }: { restaurantId: number }) {
  const utils = trpc.useUtils();
  const { data: presets, isLoading } = trpc.restaurants.getShiftPresets.useQuery(
    { restaurantId, includeInactive: true },
    { enabled: restaurantId > 0 },
  );

  // ── 편집 상태: 어떤 presetType을 열고 있는지 ──
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [editForms, setEditForms] = useState<Record<string, { label: string; weekdayStart: string; weekdayEnd: string; weekdayBreak: number; weekendStart: string; weekendEnd: string; weekendBreak: number }>>({});
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [newType, setNewType] = useState({ label: "", weekdayStart: "", weekdayEnd: "", weekdayBreak: 0, weekendStart: "", weekendEnd: "", weekendBreak: 0 });

  const saveMut = trpc.restaurants.saveShiftPresets.useMutation({
    onSuccess() { toast.success("저장됨"); utils.restaurants.getShiftPresets.invalidate({ restaurantId }); setExpandedType(null); },
    onError(e: any) { toast.error(e.message); },
  });
  const createMut = trpc.restaurants.createShiftPresetType.useMutation({
    onSuccess() { toast.success("근무유형 추가됨"); utils.restaurants.getShiftPresets.invalidate({ restaurantId }); setShowAddCustom(false); setNewType({ label: "", weekdayStart: "", weekdayEnd: "", weekdayBreak: 0, weekendStart: "", weekendEnd: "", weekendBreak: 0 }); },
    onError(e: any) { toast.error(e.message); },
  });
  const deleteMut = trpc.restaurants.deleteShiftPreset.useMutation({
    onSuccess() { toast.success("삭제됨"); utils.restaurants.getShiftPresets.invalidate({ restaurantId }); setExpandedType(null); },
    onError(e: any) { toast.error(e.message); },
  });
  const toggleMut = trpc.restaurants.toggleShiftPreset.useMutation({
    onSuccess() { utils.restaurants.getShiftPresets.invalidate({ restaurantId }); },
    onError(e: any) { toast.error(e.message); },
  });

  // ── 프리셋을 presetType별로 그룹화 ──
  const allTypes = useMemo(() => {
    const base = SHIFT_PRESET_DEFAULTS.map((p) => {
      const dbRow = (presets ?? []).find((r: any) => r.presetType === p.value);
      return { value: p.value, label: dbRow?.label || p.label, isCustom: false };
    });
    const custom = (presets ?? []).filter((p: any) => p.isCustom).reduce((acc: { value: string; label: string; isCustom: boolean }[], p: any) => { if (!acc.find((a) => a.value === p.presetType)) acc.push({ value: p.presetType, label: p.label || p.presetType, isCustom: true }); return acc; }, []);
    return [...base, ...custom];
  }, [presets]);

  const presetLabel = (v: string) => { const dbRow = presets?.find((p: any) => p.presetType === v); if (dbRow?.label) return dbRow.label; const d = SHIFT_PRESET_DEFAULTS.find((p) => p.value === v); return d?.label ?? v; };

  // ── 카드 확장 시 폼 초기화 ──
  const openEdit = (presetType: string) => {
    if (expandedType === presetType) { setExpandedType(null); return; }
    const wd = (presets ?? []).find((p: any) => p.presetType === presetType && p.dayType === "weekday");
    const we = (presets ?? []).find((p: any) => p.presetType === presetType && p.dayType === "weekend");
    const label = wd?.label || we?.label || presetLabel(presetType);
    setEditForms((prev) => ({
      ...prev,
      [presetType]: {
        label,
        weekdayStart: wd?.startTime ?? "", weekdayEnd: wd?.endTime ?? "",
        weekdayBreak: wd?.breakMinutes ?? (presetType === "full" ? 60 : 0),
        weekendStart: we?.startTime ?? "", weekendEnd: we?.endTime ?? "",
        weekendBreak: we?.breakMinutes ?? (presetType === "full" ? 60 : 0),
      },
    }));
    setExpandedType(presetType);
  };

  const handleSaveType = (presetType: string) => {
    const f = editForms[presetType];
    if (!f) return;
    const items: any[] = [];
    const isCustom = !SHIFT_PRESET_DEFAULTS.some((d) => d.value === presetType);
    if (f.weekdayStart && f.weekdayEnd) {
      items.push({ presetType, dayType: "weekday" as const, label: f.label, startTime: f.weekdayStart, endTime: f.weekdayEnd, breakMinutes: f.weekdayBreak, isCustom });
    }
    // 주말: 비어있으면 평일과 동일
    const weStart = f.weekendStart || f.weekdayStart;
    const weEnd = f.weekendEnd || f.weekdayEnd;
    const weBreak = f.weekendStart ? f.weekendBreak : f.weekdayBreak;
    if (weStart && weEnd) {
      items.push({ presetType, dayType: "weekend" as const, label: f.label, startTime: weStart, endTime: weEnd, breakMinutes: weBreak, isCustom });
    }
    if (items.length === 0) { toast.error("평일 시간을 입력해주세요"); return; }
    saveMut.mutate({ restaurantId, presets: items });
  };

  // ── 커스텀 추가: 영문코드 자동 생성 ──
  const handleAddCustom = () => {
    if (!newType.label || !newType.weekdayStart || !newType.weekdayEnd) { toast.error("이름과 평일 시간을 입력해주세요"); return; }
    // 라벨로부터 영문 키 자동 생성 (한글→로마자 변환 대신 타임스탬프 기반)
    const key = `custom_${Date.now().toString(36)}`;
    createMut.mutate({
      restaurantId, presetType: key, label: newType.label,
      weekday: { startTime: newType.weekdayStart, endTime: newType.weekdayEnd, breakMinutes: newType.weekdayBreak },
      weekend: newType.weekendStart && newType.weekendEnd
        ? { startTime: newType.weekendStart, endTime: newType.weekendEnd, breakMinutes: newType.weekendBreak }
        : undefined,
    });
  };

  // ── 시간 행 컴포넌트 ──
  const TimeRow = ({ label, startTime, endTime, breakMin, onStartChange, onEndChange, onBreakChange }: {
    label: string; startTime: string; endTime: string; breakMin: number;
    onStartChange: (v: string) => void; onEndChange: (v: string) => void; onBreakChange: (v: number) => void;
  }) => (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="w-8 text-muted-foreground shrink-0">{label}</span>
      <input type="time" step="600" value={startTime} onChange={(e) => onStartChange(e.target.value)} className="w-[90px] rounded border border-input bg-background px-1.5 py-1 text-xs" />
      <span className="text-muted-foreground">~</span>
      <input type="time" step="600" value={endTime} onChange={(e) => onEndChange(e.target.value)} className="w-[90px] rounded border border-input bg-background px-1.5 py-1 text-xs" />
      <span className="text-muted-foreground shrink-0 ml-1">휴게</span>
      <input type="number" value={breakMin} onChange={(e) => onBreakChange(Number(e.target.value) || 0)} className="w-[48px] rounded border border-input bg-background px-1 py-1 text-xs text-center" min={0} max={180} />
      <span className="text-muted-foreground">분</span>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings className="h-4 w-4 text-primary" /> 근무유형 프리셋
          </CardTitle>
          <button
            onClick={() => { setShowAddCustom(!showAddCustom); setExpandedType(null); }}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> 유형 추가
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? <p className="text-xs text-muted-foreground">불러오는 중...</p> : (
          <>
            {/* ── 커스텀 추가 폼 ── */}
            {showAddCustom && (
              <div className="p-3 rounded-lg bg-violet-50/50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-800 space-y-2.5">
                <p className="text-xs font-semibold text-violet-700 dark:text-violet-400">새 근무유형</p>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">이름</label>
                  <input
                    value={newType.label} onChange={(e) => setNewType({ ...newType, label: e.target.value })}
                    placeholder="예: 미들, 라운지, 주방오픈"
                    className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs"
                  />
                </div>
                <TimeRow label="평일"
                  startTime={newType.weekdayStart} endTime={newType.weekdayEnd} breakMin={newType.weekdayBreak}
                  onStartChange={(v) => setNewType({ ...newType, weekdayStart: v })}
                  onEndChange={(v) => setNewType({ ...newType, weekdayEnd: v })}
                  onBreakChange={(v) => setNewType({ ...newType, weekdayBreak: v })}
                />
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">주말 <span className="text-muted-foreground/60">(비우면 평일과 동일)</span></p>
                  <TimeRow label="주말"
                    startTime={newType.weekendStart} endTime={newType.weekendEnd} breakMin={newType.weekendBreak}
                    onStartChange={(v) => setNewType({ ...newType, weekendStart: v })}
                    onEndChange={(v) => setNewType({ ...newType, weekendEnd: v })}
                    onBreakChange={(v) => setNewType({ ...newType, weekendBreak: v })}
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={handleAddCustom} disabled={createMut.isPending} className="h-7 px-3 text-xs">추가</Button>
                  <button onClick={() => setShowAddCustom(false)} className="text-xs text-muted-foreground hover:text-foreground">취소</button>
                </div>
              </div>
            )}

            {/* ── 프리셋 목록 (카드형) ── */}
              <div className="space-y-1.5">
                {allTypes.map((pt) => {
                  const rows = (presets ?? []).filter((p: any) => p.presetType === pt.value);
                  const hasData = rows.length > 0;
                  const isActive = hasData ? rows.some((r: any) => r.isActive !== false) : true;
                  const wd = rows.find((r: any) => r.dayType === "weekday");
                  const we = rows.find((r: any) => r.dayType === "weekend");
                  const isExpanded = expandedType === pt.value;

                  // 평일/주말 시간이 동일한지 체크
                  const sameTime = wd && we && wd.startTime === we.startTime && wd.endTime === we.endTime && wd.breakMinutes === we.breakMinutes;

                  // 총 근무시간 계산 (시작~종료 - 휴게)
                  const calcHours = (start?: string, end?: string, breakMin?: number) => {
                    if (!start || !end) return null;
                    const [sh, sm] = start.split(":").map(Number);
                    const [eh, em] = end.split(":").map(Number);
                    let totalMin = (eh * 60 + em) - (sh * 60 + sm);
                    if (totalMin <= 0) totalMin += 24 * 60; // 야간 근무
                    totalMin -= (breakMin || 0);
                    // 10분 단위 내림
                    const rounded = Math.floor(Math.max(0, totalMin) / 10) * 10;
                    return rounded / 60;
                  };
                  const wdHours = wd ? calcHours(wd.startTime, wd.endTime, wd.breakMinutes) : null;
                  const weHours = we ? calcHours(we.startTime, we.endTime, we.breakMinutes) : null;
                  const fmtHours = (h: number | null) => h !== null ? (Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`) : null;

                  return (
                    <div
                      key={pt.value}
                      className={`rounded-lg border transition-all ${isExpanded ? "border-primary/40 bg-accent/30" : "border-border/60 hover:border-border"} ${!isActive ? "opacity-50" : ""}`}
                    >
                      {/* ── 요약 행 ── */}
                      <div
                        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
                        onClick={() => openEdit(pt.value)}
                      >
                        {/* 라벨 */}
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          {pt.isCustom && <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />}
                          <span className={`text-xs font-medium truncate ${!isActive ? "line-through" : ""}`}>
                            {pt.label}
                          </span>
                        </div>

                        {/* 시간 요약 */}
                        <div className="flex flex-col items-end text-[11px] text-muted-foreground shrink-0 leading-tight">
                          {wd && sameTime && (
                            <span>
                              {wd.startTime}~{wd.endTime}
                              {wd.breakMinutes > 0 && <span className="text-orange-500 ml-0.5">휴{wd.breakMinutes}</span>}
                              {wdHours !== null && <span className="text-primary font-medium ml-1">{fmtHours(wdHours)}</span>}
                            </span>
                          )}
                          {wd && !sameTime && (
                            <span>
                              평 {wd.startTime}~{wd.endTime}
                              {wd.breakMinutes > 0 && <span className="text-orange-500 ml-0.5">휴{wd.breakMinutes}</span>}
                              {wdHours !== null && <span className="text-primary/70 ml-0.5">{fmtHours(wdHours)}</span>}
                            </span>
                          )}
                          {we && !sameTime && (
                            <span>
                              주 {we.startTime}~{we.endTime}
                              {we.breakMinutes > 0 && <span className="text-orange-500 ml-0.5">휴{we.breakMinutes}</span>}
                              {weHours !== null && <span className="text-primary/70 ml-0.5">{fmtHours(weHours)}</span>}
                            </span>
                          )}
                          {!wd && !we && <span className="italic text-muted-foreground/60">미설정</span>}
                        </div>

                        {/* 수정 버튼 */}
                        <Pencil className={`w-3 h-3 shrink-0 transition-colors ${isExpanded ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground"}`} />

                        {/* 활성/비활성 스위치 (데이터 있을 때만) */}
                        {hasData && (
                          <div onClick={(e) => e.stopPropagation()}>
                            <Switch
                              checked={isActive}
                              onCheckedChange={(checked: boolean) => toggleMut.mutate({ restaurantId, presetType: pt.value, isActive: checked })}
                              className="scale-90"
                            />
                          </div>
                        )}
                      </div>

                      {/* ── 편집 패널 (확장 시) ── */}
                      {isExpanded && editForms[pt.value] && (
                        <div className="px-3 pb-3 space-y-2.5 border-t border-border/40 pt-2.5">
                          {/* 라벨 편집 */}
                          <div>
                            <label className="text-[10px] text-muted-foreground block mb-0.5">표시 이름</label>
                            <input
                              value={editForms[pt.value].label}
                              onChange={(e) => setEditForms((prev) => ({ ...prev, [pt.value]: { ...prev[pt.value], label: e.target.value } }))}
                              className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs font-medium"
                              placeholder="표시 이름"
                            />
                          </div>

                          {/* 평일 시간 */}
                          <TimeRow label="평일"
                            startTime={editForms[pt.value].weekdayStart}
                            endTime={editForms[pt.value].weekdayEnd}
                            breakMin={editForms[pt.value].weekdayBreak}
                            onStartChange={(v) => setEditForms((prev) => ({ ...prev, [pt.value]: { ...prev[pt.value], weekdayStart: v } }))}
                            onEndChange={(v) => setEditForms((prev) => ({ ...prev, [pt.value]: { ...prev[pt.value], weekdayEnd: v } }))}
                            onBreakChange={(v) => setEditForms((prev) => ({ ...prev, [pt.value]: { ...prev[pt.value], weekdayBreak: v } }))}
                          />
                          {editForms[pt.value].weekdayStart && editForms[pt.value].weekdayEnd && (() => {
                            const h = calcHours(editForms[pt.value].weekdayStart, editForms[pt.value].weekdayEnd, editForms[pt.value].weekdayBreak);
                            return h !== null ? <p className="text-[10px] text-primary font-medium pl-9">실근무 {fmtHours(h)}</p> : null;
                          })()}

                          {/* 주말 시간 */}
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">주말 <span className="text-muted-foreground/60">(비우면 평일과 동일)</span></p>
                            <TimeRow label="주말"
                              startTime={editForms[pt.value].weekendStart}
                              endTime={editForms[pt.value].weekendEnd}
                              breakMin={editForms[pt.value].weekendBreak}
                              onStartChange={(v) => setEditForms((prev) => ({ ...prev, [pt.value]: { ...prev[pt.value], weekendStart: v } }))}
                              onEndChange={(v) => setEditForms((prev) => ({ ...prev, [pt.value]: { ...prev[pt.value], weekendEnd: v } }))}
                              onBreakChange={(v) => setEditForms((prev) => ({ ...prev, [pt.value]: { ...prev[pt.value], weekendBreak: v } }))}
                            />
                            {editForms[pt.value].weekendStart && editForms[pt.value].weekendEnd && (() => {
                              const h = calcHours(editForms[pt.value].weekendStart, editForms[pt.value].weekendEnd, editForms[pt.value].weekendBreak);
                              return h !== null ? <p className="text-[10px] text-primary font-medium pl-9">실근무 {fmtHours(h)}</p> : null;
                            })()}
                          </div>

                          {/* 저장/삭제 버튼 */}
                          <div className="flex items-center gap-2 pt-1">
                            <Button size="sm" onClick={() => handleSaveType(pt.value)} disabled={saveMut.isPending} className="h-7 px-4 text-xs">저장</Button>
                            <button onClick={() => setExpandedType(null)} className="text-xs text-muted-foreground hover:text-foreground">취소</button>
                            {pt.isCustom && (
                              <button
                                onClick={() => { if (confirm(`"${pt.label}" 유형을 삭제하시겠습니까?`)) deleteMut.mutate({ id: rows[0]?.id }); }}
                                className="ml-auto text-xs text-red-400 hover:text-red-600 flex items-center gap-0.5"
                              >
                                <Trash2 className="w-3 h-3" /> 삭제
                              </button>
                            )}
                          </div>

                          {/* 비우면 자동계산 안내 (기본 프리셋만) */}
                          {!pt.isCustom && (
                            <p className="text-[10px] text-muted-foreground/60">시간을 비우면 매장 영업시간 기반으로 자동 계산됩니다</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>



          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const { user } = useAuth();
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;
  const effectiveRole = getEffectiveRole(user?.role ?? "user", current?.storeRole ?? null);
  const isManager = isManagerLevel(effectiveRole);

  const [baseDate, setBaseDate] = useState(new Date());
  const weekDates = useMemo(() => getWeekDates(baseDate), [baseDate]);

  const weekStart = fmtDate(weekDates[0]);
  const weekEnd = fmtDate(weekDates[6]) + "T23:59:59";

  // ─── 모달 상태 ─────────────────────────────
  type AssignStep = "employee" | "preset" | "custom-time" | "temp-worker";
  const [assignDate, setAssignDate] = useState<string | null>(null);
  const [assignStep, setAssignStep] = useState<AssignStep>("employee");
  const [assignUserId, setAssignUserId] = useState<number>(0);
  const [assignUserName, setAssignUserName] = useState<string>("");
  const [customTime, setCustomTime] = useState({ startTime: "09:00", endTime: "18:00", note: "" });

  // 임시근로자 입력
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

  // showBulkMenu 삭제 — 버튼이 헤더에 직접 노출됨

  const utils = trpc.useUtils();

  const { data: scheduleList = [], isLoading } = trpc.schedules.listByRestaurant.useQuery(
    { restaurantId, from: weekStart, to: weekEnd },
    { enabled: restaurantId > 0 }
  );

  const { data: staffList = [] } = trpc.restaurants.getStaff.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 }
  ) as { data: StaffItem[] };

  // 매장별 커스텀 근무 프리셋
  const { data: shiftPresets = [] } = trpc.restaurants.getShiftPresets.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 }
  );

  // ─── Mutations ─────────────────────────────
  const quickAssign = trpc.schedules.quickAssign.useMutation({
    onSuccess() {
      toast.success("스케줄 등록됨");
      closeAssignModal();
      invalidate();
    },
    onError(err) { toast.error(err.message); },
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

  const invalidate = () => {
    utils.schedules.listByRestaurant.invalidate();
  };

  // ─── 날짜별 스케줄 그룹핑 ─────────────────
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

  const assignedUserIds = useMemo(() => {
    if (!assignDate) return new Set<number>();
    const daySchedules = scheduleByDate.get(assignDate) ?? [];
    return new Set(daySchedules.filter((s) => s.userId && s.status !== "canceled").map((s) => s.userId!));
  }, [assignDate, scheduleByDate]);

  // ─── 주 이동 ──────────────────────────────
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

  // ─── 모달 헬퍼 ────────────────────────────
  const openAssignModal = (dateStr: string) => {
    setAssignDate(dateStr);
    setAssignStep("employee");
    setAssignUserId(0);
    setAssignUserName("");
    setCustomTime({ startTime: "09:00", endTime: "18:00", note: "" });
    setTempForm({ name: "", wageType: "hourly", wageAmount: "", startTime: "09:00", endTime: "18:00", note: "" });
  };
  const closeAssignModal = () => {
    setAssignDate(null);
    setAssignStep("employee");
  };

  const selectEmployee = (userId: number, name: string) => {
    setAssignUserId(userId);
    setAssignUserName(name);
    setAssignStep("preset");
  };

  const handleQuickAssign = (preset: string) => {
    if (!assignDate || !assignUserId) return;
    quickAssign.mutate({
      restaurantId,
      userId: assignUserId,
      workDate: assignDate,
      preset,
    });
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
    if (!assignDate || !tempForm.name.trim()) {
      toast.error("이름을 입력해주세요");
      return;
    }
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

  // 매장별 커스텀 프리셋 우선 → 없으면 영업시간 기반 계산
  const getPresetTimes = (preset: string, dateStr?: string) => {
    // 커스텀 프리셋 조회
    if (shiftPresets.length > 0) {
      const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
      const dow = d.getDay();
      const dayType = (dow === 0 || dow === 6) ? "weekend" : "weekday";
      const custom = shiftPresets.find(
        (p: any) => p.presetType === preset && p.dayType === dayType
      );
      if (custom) {
        return { startTime: custom.startTime, endTime: custom.endTime, breakMinutes: custom.breakMinutes };
      }
    }
    // 폴백: 영업시간 기반
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
    if (needsReason && !deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    deleteSchedule.mutate({
      id: editSchedule.id,
      reason: editForm.editReason || undefined,
    });
  };

  if (!current) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  const today = fmtDate(new Date());

  return (
    <div className="p-3 md:p-6 space-y-3 max-w-4xl mx-auto">
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
          const daySchedules = scheduleByDate.get(dateStr) ?? [];
          const isToday = dateStr === today;
          const isWeekend = i >= 5;

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
                  {daySchedules.length > 0 && (() => {
                    const headcount = daySchedules.filter(s => s.status !== "canceled").reduce((sum, s) =>
                      sum + (s.shiftPreset === "open" || s.shiftPreset === "close" ? 0.5 : 1), 0);
                    return <span className="ml-1 text-[10px] md:text-xs font-normal">({headcount % 1 === 0 ? headcount : headcount.toFixed(1)}명)</span>;
                  })()}
                </span>
                {daySchedules.some((s) => s.status === "draft") && (
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
                {daySchedules.map((s) => {
                  const st = STATUS_LABELS[s.status] ?? STATUS_LABELS.draft;
                  const presetInfo = s.shiftPreset ? (() => {
                    const dbPreset = shiftPresets.find((p: any) => p.presetType === s.shiftPreset);
                    if (dbPreset?.label) return { label: dbPreset.label };
                    return DEFAULT_PRESET_LABELS[s.shiftPreset] ?? null;
                  })() : null;
                  return (
                    <button
                      key={s.id}
                      onClick={() => openEditModal(s)}
                      className={`w-full text-left p-1 md:p-1.5 rounded bg-background border-l-2 ${st.bgCard} border border-border/50 text-xs active:bg-accent/50 transition-colors`}
                    >
                      <div className="flex items-center gap-1">
                        <span className={`font-medium truncate text-[11px] md:text-xs ${s.tempWorkerName ? "text-orange-600 dark:text-orange-400" : "text-foreground"}`}>
                          {(() => {
                            const rawName = s.userName ?? s.tempWorkerName ?? "미배정";
                            return rawName.length >= 2 ? rawName.slice(1) : rawName;
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
                          {presetInfo ? presetInfo.label.charAt(0) : `${fmtTime(s.startTime)}~${fmtTime(s.endTime)}`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {isManager && (
                <button
                  onClick={() => openAssignModal(dateStr)}
                  className="w-full mt-1 py-2 rounded border border-dashed border-border/60 text-[11px] md:text-xs text-muted-foreground hover:bg-accent/30 active:bg-accent/50 transition-colors"
                >
                  + 직원 배정
                </button>
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
            {/* 핸들바 (모바일) */}
            <div className="flex justify-center pt-2 md:hidden">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>

            <div className="flex items-center justify-between p-4 pb-2">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {assignStep === "employee" && "직원 선택"}
                  {assignStep === "preset" && `${assignUserName} — 근무유형`}
                  {assignStep === "custom-time" && `${assignUserName} — 시간 직접입력`}
                  {assignStep === "temp-worker" && "임시근로자 등록"}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">{assignDate}</p>
              </div>
              <button onClick={closeAssignModal} className="p-1.5 rounded-full hover:bg-accent">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* ─── Step 1: 직원 목록 ─── */}
            {assignStep === "employee" && (
              <div className="overflow-y-auto flex-1 px-4 pb-4">
                {staffList.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">등록된 직원이 없습니다</p>
                ) : (
                  <div className="space-y-1">
                    {(staffList as StaffItem[]).map((staff) => {
                      const isAssigned = assignedUserIds.has(staff.userId);
                      const roleLabel =
                        staff.storeRole === "owner" || staff.storeRole === "store_manager" ? "점장"
                          : staff.storeRole === "supervisor" || staff.storeRole === "manager" ? "매니져"
                          : "직원";
                      return (
                        <button
                          key={staff.userId}
                          disabled={isAssigned}
                          onClick={() => selectEmployee(staff.userId, staff.name)}
                          className={`w-full flex items-center justify-between p-3 rounded-lg text-sm transition-colors ${
                            isAssigned
                              ? "opacity-40 cursor-not-allowed bg-muted/30"
                              : "hover:bg-accent active:bg-accent/70"
                          }`}
                        >
                          <div className="flex items-center gap-3">
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
                )}

                {/* 임시근로자 추가 버튼 */}
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
              </div>
            )}

            {/* ─── Step 2: 프리셋 선택 ─── */}
            {assignStep === "preset" && (
              <div className="px-4 pb-6 space-y-2 overflow-y-auto flex-1">
                <button
                  onClick={() => setAssignStep("employee")}
                  className="text-xs text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1"
                >
                  <ChevronLeft className="w-3 h-3" /> 직원 다시 선택
                </button>
                {/* 공휴일 대체휴무 알림 */}
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
                {/* 동적 프리셋 버튼: DB 기본3종 + 커스텀 (비활성 제외) */}
                {(() => {
                  const allDefaults = [
                    { key: "full", apiKey: "fullday", label: "풀타임", icon: Maximize2, fallbackDesc: "영업시간 전체 근무" },
                    { key: "open", apiKey: "open", label: "오픈", icon: Sun, fallbackDesc: "오픈 ~ 중간시간" },
                    { key: "close", apiKey: "close", label: "마감", icon: Moon, fallbackDesc: "중간시간 ~ 마감" },
                  ];
                  // DB에 프리셋이 있으면 active 목록에 있는 것만 표시, 없으면 전부 표시
                  const hasDbPresets = shiftPresets.length > 0;
                  const defaultTypes = hasDbPresets
                    ? allDefaults.filter(({ key }) => shiftPresets.some((p: any) => p.presetType === key))
                    : allDefaults;
                  // DB 커스텀 프리셋 (isCustom=true, 중복 제거)
                  const customTypes = shiftPresets
                    .filter((p: any) => p.isCustom && !["open", "full", "close"].includes(p.presetType))
                    .reduce((acc: any[], p: any) => {
                      if (!acc.find((a: any) => a.presetType === p.presetType)) acc.push(p);
                      return acc;
                    }, []);

                  return (
                    <>
                      {defaultTypes.map(({ key, apiKey, label: defLabel, icon: Icon, fallbackDesc }) => {
                        const dbPreset = shiftPresets.find((p: any) => p.presetType === key);
                        const displayLabel = dbPreset?.label || defLabel;
                        return (
                          <button
                            key={key}
                            onClick={() => handleQuickAssign(apiKey)}
                            disabled={quickAssign.isPending}
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
                          disabled={quickAssign.isPending}
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

                {/* 시간 직접입력 */}
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
              </div>
            )}

            {/* ─── Step 2b: 시간 직접입력 ─── */}
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

                <Button
                  className="w-full"
                  onClick={handleCustomTimeAssign}
                  disabled={createSchedule.isPending}
                >
                  등록
                </Button>
              </div>
            )}

            {/* ─── Step: 임시근로자 입력 ─── */}
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
              {/* 상태별 경고 배너 */}
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

              {/* 근무유형 선택 — 동적 렌더링 */}
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

              {/* 휴게시간 */}
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

              {/* 사유 입력 — confirmed/completed 상태에서만 표시 */}
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

              {/* 삭제 확인 단계 (confirmed/completed) */}
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

      {/* 휴무/반차 신청 섹션 */}
      {restaurantId > 0 && (
        <LeaveRequestSection restaurantId={restaurantId} isManager={isManager} />
      )}

      {/* 근무유형 프리셋 설정 (매니저 이상) */}
      {isManager && restaurantId > 0 && (
        <ShiftPresetPanel restaurantId={restaurantId} />
      )}
    </div>
  );
}
