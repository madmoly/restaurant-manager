import { useState, useEffect } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import { ClipboardCheck, Check, AlertCircle, Clock, CheckCircle, Users } from "lucide-react";
import { Button, Card, Input, PageHeader, EmptyState, Loading, StatCard, Badge, MonthNav } from "@/components/ui/compat";

type ViewMode = "today" | "list";

export default function DailyClosingPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const [mode, setMode] = useState<ViewMode>("today");
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  if (!restaurantId) return <EmptyState icon={<ClipboardCheck size={40} />} title="매장을 선택해주세요" />;

  return (
    <div>
      <PageHeader
        title="일마감"
        description={current?.name}
        action={
          <div className="flex gap-1 bg-muted p-0.5 rounded-lg">
            <button
              onClick={() => setMode("today")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === "today" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              오늘 마감
            </button>
            <button
              onClick={() => setMode("list")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              월별 조회
            </button>
          </div>
        }
      />

      {mode === "today" ? (
        <DailyClosingForm restaurantId={restaurantId} date={selectedDate} onDateChange={setSelectedDate} />
      ) : (
        <MonthlyClosingList restaurantId={restaurantId} year={year} month={month}
          onPrev={() => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); }}
          onNext={() => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); }}
        />
      )}
    </div>
  );
}

function DailyClosingForm({ restaurantId, date, onDateChange }: { restaurantId: number; date: string; onDateChange: (d: string) => void }) {
  const [laborCost, setLaborCost] = useState("0");
  const [note, setNote] = useState("");

  const utils = trpc.useUtils();

  // 자동 계산 데이터
  const { data: calculated, isLoading: calcLoading } = trpc.dailyClosings.calculateDay.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 }
  );

  // 기존 마감 데이터
  const { data: existing } = trpc.dailyClosings.getByDate.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 }
  );

  // 고정비 (일할)
  const dateObj = new Date(date);
  const daysInMonth = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0).getDate();
  const { data: fixedTotal } = trpc.fixedCosts.monthlyTotal.useQuery(
    { restaurantId, year: dateObj.getFullYear(), month: dateObj.getMonth() + 1 },
    { enabled: restaurantId > 0 }
  );
  const dailyFixed = fixedTotal ? Math.round(Number(fixedTotal.total) / daysInMonth) : 0;

  // 기존 데이터 로드
  useEffect(() => {
    if (existing) {
      setLaborCost(existing.laborCost ?? "0");
      setNote(existing.note ?? "");
    } else {
      setLaborCost("0");
      setNote("");
    }
  }, [existing]);

  const save = trpc.dailyClosings.save.useMutation({
    onSuccess(data) {
      toast.success(data.updated ? "마감 수정 완료" : "마감 저장 완료");
      utils.dailyClosings.getByDate.invalidate();
      utils.dailyClosings.listByMonth.invalidate();
      utils.dailyClosings.monthlySummary.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const salesTotal = calculated?.salesTotal ?? "0";
  const purchasesTotal = calculated?.purchasesTotal ?? "0";
  const profit = Number(salesTotal) - Number(purchasesTotal) - Number(laborCost) - dailyFixed;

  const handleSave = () => {
    save.mutate({
      restaurantId,
      closingDate: date,
      salesTotal,
      purchasesTotal,
      laborCost,
      fixedCostShare: String(dailyFixed),
      profit: String(profit),
      note: note || undefined,
    });
  };

  return (
    <div>
      <div className="mb-5">
        <Input
          label="마감 날짜"
          type="date"
          value={date}
          onChange={e => onDateChange(e.target.value)}
        />
      </div>

      {existing && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-emerald-500/10 rounded-lg">
          <Check size={14} className="text-emerald-600" />
          <span className="text-xs text-emerald-700 font-medium">마감 완료됨 — 수정 가능</span>
        </div>
      )}

      {calcLoading ? <Loading /> : (
        <div className="space-y-4">
          {/* 자동 집계 */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="매출" value={Number(salesTotal).toLocaleString()} unit="원" className="border-border" />
            <StatCard label="매입" value={Number(purchasesTotal).toLocaleString()} unit="원" className="border-border" />
          </div>

          {/* 수동 입력 */}
          <Card className="p-4 space-y-3">
            <Input label="인건비 (원)" type="number" value={laborCost} onChange={e => setLaborCost(e.target.value)} />
            <div>
              <span className="block text-xs font-medium text-muted-foreground mb-1.5">고정비 (일할 자동계산)</span>
              <div className="px-3 py-2.5 bg-muted/50 rounded-lg text-sm text-muted-foreground tabular-nums">
                {dailyFixed.toLocaleString()}원
                <span className="text-xs text-muted-foreground ml-2">({Number(fixedTotal?.total ?? 0).toLocaleString()}원 ÷ {daysInMonth}일)</span>
              </div>
            </div>
          </Card>

          {/* 손익 */}
          <Card className={`p-4 ${profit >= 0 ? "border-emerald-200 bg-emerald-500/10" : "border-red-200 bg-red-500/10"}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">오늘 손익</span>
              <span className={`text-2xl font-bold tabular-nums ${profit >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                {profit >= 0 ? "+" : ""}{profit.toLocaleString()}원
              </span>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              매출 {Number(salesTotal).toLocaleString()} - 매입 {Number(purchasesTotal).toLocaleString()} - 인건비 {Number(laborCost).toLocaleString()} - 고정비 {dailyFixed.toLocaleString()}
            </div>
          </Card>

          {/* 스케줄 섹션 */}
          <ScheduleSection restaurantId={restaurantId} date={date} />

          <Input label="마감 메모 (선택)" value={note} onChange={e => setNote(e.target.value)} placeholder="오늘 특이사항" />

          <Button onClick={handleSave} disabled={save.isPending} className="w-full" size="lg">
            {save.isPending ? "저장 중..." : existing ? "마감 수정" : "마감 확정"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SCHEDULE SECTION – 일마감 시 스케줄 확인 + 완료 처리
// ============================================================================

const SHIFT_LABELS: Record<string, string> = { open: "오픈", close: "마감", full: "풀타임" };

function fmtTime(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function ScheduleSection({ restaurantId, date }: { restaurantId: number; date: string }) {
  const utils = trpc.useUtils();

  const { data: daySchedules = [], isLoading } = trpc.schedules.getDaySchedules.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 }
  );

  const completeDay = trpc.schedules.completeDay.useMutation({
    onSuccess(data) {
      toast.success(`${data.affected}건 근무완료 처리됨`);
      utils.schedules.getDaySchedules.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const completeOne = trpc.schedules.completeOne.useMutation({
    onSuccess() {
      toast.success("완료 처리됨");
      utils.schedules.getDaySchedules.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  if (isLoading) return null;

  const confirmed = daySchedules.filter((s: any) => s.status === "confirmed");
  const completed = daySchedules.filter((s: any) => s.status === "completed");
  const draft = daySchedules.filter((s: any) => s.status === "draft");
  const total = daySchedules.length;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">스케줄</span>
          <span className="text-xs text-muted-foreground">({total}명)</span>
        </div>
        {confirmed.length > 0 && (
          <button
            onClick={() => completeDay.mutate({ restaurantId, date })}
            disabled={completeDay.isPending}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            <CheckCircle size={12} />
            전체 완료 ({confirmed.length}건)
          </button>
        )}
      </div>

      {total === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">등록된 스케줄이 없습니다</p>
      ) : (
        <div className="space-y-1.5">
          {daySchedules.map((s: any) => {
            const isConfirmed = s.status === "confirmed";
            const isCompleted = s.status === "completed";
            const isDraft = s.status === "draft";
            return (
              <div
                key={s.id}
                className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm ${
                  isCompleted
                    ? "bg-emerald-500/10 border-emerald-200 dark:border-emerald-800"
                    : isDraft
                    ? "bg-muted/30 border-border opacity-60"
                    : "bg-card border-border"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isCompleted ? (
                    <Check size={14} className="text-emerald-600 shrink-0" />
                  ) : isDraft ? (
                    <AlertCircle size={14} className="text-muted-foreground shrink-0" />
                  ) : (
                    <Clock size={14} className="text-blue-500 shrink-0" />
                  )}
                  <span className="font-medium text-foreground truncate">
                    {s.userName ?? s.tempWorkerName ?? "미배정"}
                    {s.tempWorkerName && <span className="text-orange-500 ml-1 text-xs">(임시)</span>}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {fmtTime(s.startTime)}~{fmtTime(s.endTime)}
                    {s.shiftPreset && <span className="ml-1 opacity-70">({SHIFT_LABELS[s.shiftPreset] ?? s.shiftPreset})</span>}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isCompleted && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 font-medium">완료</span>
                  )}
                  {isDraft && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 font-medium">초안</span>
                  )}
                  {isConfirmed && (
                    <button
                      onClick={() => completeOne.mutate({ id: s.id })}
                      disabled={completeOne.isPending}
                      className="text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 font-medium hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors"
                    >
                      확정 → 완료
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 요약 */}
      {total > 0 && (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1 border-t border-border">
          {completed.length > 0 && <span className="text-emerald-600">완료 {completed.length}</span>}
          {confirmed.length > 0 && <span className="text-blue-600">확정 {confirmed.length}</span>}
          {draft.length > 0 && <span className="text-gray-500">초안 {draft.length}</span>}
        </div>
      )}
    </Card>
  );
}

function MonthlyClosingList({ restaurantId, year, month, onPrev, onNext }: {
  restaurantId: number; year: number; month: number; onPrev: () => void; onNext: () => void;
}) {
  const { data: closings, isLoading } = trpc.dailyClosings.listByMonth.useQuery(
    { restaurantId, year, month }, { enabled: restaurantId > 0 }
  );
  const { data: summary } = trpc.dailyClosings.monthlySummary.useQuery(
    { restaurantId, year, month }, { enabled: restaurantId > 0 }
  );

  return (
    <div>
      <MonthNav year={year} month={month} onPrev={onPrev} onNext={onNext}
        rightSlot={summary && (
          <span className="text-xs text-muted-foreground">{summary.closedDays}/{summary.daysInMonth}일 마감</span>
        )}
      />

      {/* 월간 요약 */}
      {summary && Number(summary.closedDays) > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          <StatCard label="매출" value={Number(summary.salesTotal).toLocaleString()} unit="원" />
          <StatCard label="매입" value={Number(summary.purchasesTotal).toLocaleString()} unit="원" />
          <StatCard
            label="순이익"
            value={Number(summary.profit).toLocaleString()}
            unit="원"
            className={Number(summary.profit) >= 0 ? "" : "border-red-200"}
          />
        </div>
      )}

      {isLoading ? <Loading /> : !closings?.length ? (
        <EmptyState icon={<ClipboardCheck size={36} />} title="이번 달 마감 기록이 없습니다" />
      ) : (
        <div className="space-y-2">
          {closings.map((c: any) => {
            const p = Number(c.profit);
            return (
              <Card key={c.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground tabular-nums">{String(c.closingDate).slice(5)}</span>
                    <span className="text-xs text-muted-foreground">매출 {Number(c.salesTotal).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold tabular-nums ${p >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {p >= 0 ? "+" : ""}{p.toLocaleString()}원
                    </span>
                    <Badge variant="success"><Check size={10} /></Badge>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
