import { useState, useEffect } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import { ClipboardCheck, Check, AlertCircle } from "lucide-react";
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
          <div className="flex gap-1 bg-slate-100 p-0.5 rounded-lg">
            <button
              onClick={() => setMode("today")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === "today" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
            >
              오늘 마감
            </button>
            <button
              onClick={() => setMode("list")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === "list" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
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
        <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-emerald-50 rounded-lg">
          <Check size={14} className="text-emerald-600" />
          <span className="text-xs text-emerald-700 font-medium">마감 완료됨 — 수정 가능</span>
        </div>
      )}

      {calcLoading ? <Loading /> : (
        <div className="space-y-4">
          {/* 자동 집계 */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="매출" value={Number(salesTotal).toLocaleString()} unit="원" className="border-slate-200" />
            <StatCard label="매입" value={Number(purchasesTotal).toLocaleString()} unit="원" className="border-slate-200" />
          </div>

          {/* 수동 입력 */}
          <Card className="p-4 space-y-3">
            <Input label="인건비 (원)" type="number" value={laborCost} onChange={e => setLaborCost(e.target.value)} />
            <div>
              <span className="block text-xs font-medium text-slate-500 mb-1.5">고정비 (일할 자동계산)</span>
              <div className="px-3 py-2.5 bg-slate-50 rounded-lg text-sm text-slate-600 tabular-nums">
                {dailyFixed.toLocaleString()}원
                <span className="text-xs text-slate-400 ml-2">({Number(fixedTotal?.total ?? 0).toLocaleString()}원 ÷ {daysInMonth}일)</span>
              </div>
            </div>
          </Card>

          {/* 손익 */}
          <Card className={`p-4 ${profit >= 0 ? "border-emerald-200 bg-emerald-50/30" : "border-red-200 bg-red-50/30"}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-600">오늘 손익</span>
              <span className={`text-2xl font-bold tabular-nums ${profit >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                {profit >= 0 ? "+" : ""}{profit.toLocaleString()}원
              </span>
            </div>
            <div className="mt-2 text-xs text-slate-400">
              매출 {Number(salesTotal).toLocaleString()} - 매입 {Number(purchasesTotal).toLocaleString()} - 인건비 {Number(laborCost).toLocaleString()} - 고정비 {dailyFixed.toLocaleString()}
            </div>
          </Card>

          <Input label="마감 메모 (선택)" value={note} onChange={e => setNote(e.target.value)} placeholder="오늘 특이사항" />

          <Button onClick={handleSave} disabled={save.isPending} className="w-full" size="lg">
            {save.isPending ? "저장 중..." : existing ? "마감 수정" : "마감 확정"}
          </Button>
        </div>
      )}
    </div>
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
          <span className="text-xs text-slate-400">{summary.closedDays}/{summary.daysInMonth}일 마감</span>
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
                    <span className="text-sm text-slate-600 tabular-nums">{String(c.closingDate).slice(5)}</span>
                    <span className="text-xs text-slate-400">매출 {Number(c.salesTotal).toLocaleString()}</span>
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
