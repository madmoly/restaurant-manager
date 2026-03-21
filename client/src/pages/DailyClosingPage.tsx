import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { todayKST } from "@/lib/dateKST";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, CheckCircle2, LockKeyhole,
  Plus, Trash2, TrendingUp, ShoppingCart, Users, Calendar,
  AlertTriangle, ClipboardList, ArrowLeft, X
} from "lucide-react";

const fmt = (v: number) =>
  new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(v);

const STEPS = [
  { id: 1, label: "매출 입력", icon: TrendingUp },
  { id: 2, label: "특이사항", icon: ClipboardList },
  { id: 3, label: "매입 확인", icon: ShoppingCart },
  { id: 4, label: "인건비/스케줄", icon: Users },
  { id: 5, label: "마감 확정", icon: LockKeyhole },
];

// ─── 매출 항목 입력 컴포넌트 ──────────────────────────────────────────────────
function SalesStep({
  salesTypes,
  salesBreakdown,
  setSalesBreakdown,
  onAddType,
}: {
  salesTypes: Array<{ id: number; typeName: string }>;
  salesBreakdown: Array<{ typeName: string; amount: number }>;
  setSalesBreakdown: (v: Array<{ typeName: string; amount: number }>) => void;
  onAddType: (name: string) => void;
}) {
  const [newTypeName, setNewTypeName] = useState("");

  const total = salesBreakdown.reduce((s, i) => s + i.amount, 0);

  const setAmount = (typeName: string, amount: number) => {
    const existing = salesBreakdown.find(i => i.typeName === typeName);
    if (existing) {
      setSalesBreakdown(salesBreakdown.map(i => i.typeName === typeName ? { ...i, amount } : i));
    } else {
      setSalesBreakdown([...salesBreakdown, { typeName, amount }]);
    }
  };

  const getAmount = (typeName: string) =>
    salesBreakdown.find(i => i.typeName === typeName)?.amount ?? 0;

  const handleAddType = () => {
    const name = newTypeName.trim();
    if (!name) return;
    onAddType(name);
    setNewTypeName("");
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {salesTypes.map(t => (
          <div key={t.id} className="flex items-center gap-3">
            <Label className="w-28 shrink-0 text-sm font-medium">{t.typeName}</Label>
            <div className="relative flex-1">
              <Input
                type="number"
                min={0}
                value={getAmount(t.typeName) || ""}
                onChange={e => setAmount(t.typeName, Number(e.target.value) || 0)}
                placeholder="0"
                className="pr-8 text-right"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">원</span>
            </div>
          </div>
        ))}
      </div>

      {/* 신규 항목 추가 */}
      <div className="flex gap-2 pt-1">
        <Input
          value={newTypeName}
          onChange={e => setNewTypeName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAddType()}
          placeholder="새 매출 항목 추가 (예: 네이버페이)"
          className="flex-1 text-sm"
        />
        <Button size="sm" variant="outline" onClick={handleAddType} className="gap-1 shrink-0">
          <Plus className="h-3.5 w-3.5" />추가
        </Button>
      </div>

      {/* 합계 */}
      <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4">
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium text-muted-foreground">일일 총 매출</span>
          <span className="text-xl font-bold text-emerald-400">{fmt(total)}</span>
        </div>
        {salesBreakdown.filter(i => i.amount > 0).map(i => (
          <div key={i.typeName} className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{i.typeName}</span>
            <span>{fmt(i.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 특이사항 입력 컴포넌트 ────────────────────────────────────────────────────
function SpecialsStep({
  specialTypes,
  salesSpecials,
  setSalesSpecials,
  onAddType,
}: {
  specialTypes: Array<{ id: number; typeName: string }>;
  salesSpecials: Array<{ typeName: string; amount: number; note?: string }>;
  setSalesSpecials: (v: Array<{ typeName: string; amount: number; note?: string }>) => void;
  onAddType: (name: string) => void;
}) {
  const [newTypeName, setNewTypeName] = useState("");

  const getItem = (typeName: string) =>
    salesSpecials.find(i => i.typeName === typeName) ?? { typeName, amount: 0, note: "" };

  const setItem = (typeName: string, patch: Partial<{ amount: number; note: string }>) => {
    const existing = salesSpecials.find(i => i.typeName === typeName);
    if (existing) {
      setSalesSpecials(salesSpecials.map(i => i.typeName === typeName ? { ...i, ...patch } : i));
    } else {
      setSalesSpecials([...salesSpecials, { typeName, amount: 0, note: "", ...patch }]);
    }
  };

  const removeItem = (typeName: string) => {
    setSalesSpecials(salesSpecials.filter(i => i.typeName !== typeName));
  };

  const handleAddType = () => {
    const name = newTypeName.trim();
    if (!name) return;
    onAddType(name);
    setNewTypeName("");
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">해당 항목이 있는 경우에만 금액과 메모를 입력하세요.</p>
      <div className="space-y-3">
        {specialTypes.map(t => {
          const item = getItem(t.typeName);
          const isActive = salesSpecials.some(i => i.typeName === t.typeName);
          return (
            <div key={t.id} className={cn(
              "rounded-lg border p-3 space-y-2 transition-colors",
              isActive ? "border-amber-500/30 bg-amber-500/5" : "border-border"
            )}>
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">{t.typeName}</Label>
                {isActive && (
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeItem(t.typeName)}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type="number"
                    min={0}
                    value={item.amount || ""}
                    onChange={e => setItem(t.typeName, { amount: Number(e.target.value) || 0 })}
                    placeholder="금액 (없으면 0)"
                    className="pr-8 text-right text-sm"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">원</span>
                </div>
                <Input
                  value={item.note ?? ""}
                  onChange={e => setItem(t.typeName, { note: e.target.value })}
                  placeholder="메모 (선택)"
                  className="flex-1 text-sm"
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* 신규 항목 추가 */}
      <div className="flex gap-2 pt-1">
        <Input
          value={newTypeName}
          onChange={e => setNewTypeName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAddType()}
          placeholder="새 특이사항 항목 추가 (예: 단체 예약 할인)"
          className="flex-1 text-sm"
        />
        <Button size="sm" variant="outline" onClick={handleAddType} className="gap-1 shrink-0">
          <Plus className="h-3.5 w-3.5" />추가
        </Button>
      </div>

      {salesSpecials.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
          <p className="text-xs font-semibold text-amber-400 mb-1">입력된 특이사항</p>
          {salesSpecials.map(i => (
            <div key={i.typeName} className="flex justify-between text-xs text-muted-foreground">
              <span>{i.typeName}{i.note ? ` — ${i.note}` : ""}</span>
              <span>{i.amount > 0 ? fmt(i.amount) : "-"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 매입 확인 컴포넌트 ────────────────────────────────────────────────────────
function PurchaseStep({
  detail,
  purchaseNote,
  setPurchaseNote,
}: {
  detail: any;
  purchaseNote: string;
  setPurchaseNote: (v: string) => void;
}) {
  const orders = detail?.purchaseOrderList ?? [];
  const purchases = detail?.purchaseList ?? [];
  const totalV2 = orders.reduce((s: number, o: any) => s + parseFloat(o.totalAmount ?? "0"), 0);
  const totalV1 = purchases.reduce((s: number, p: any) => s + parseFloat(p.cost ?? "0"), 0);
  const total = totalV2 + totalV1;

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-muted/40 p-4">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-semibold">오늘 매입 합계</span>
          <span className="text-lg font-bold text-amber-400">{fmt(total)}</span>
        </div>
        {orders.length === 0 && purchases.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">오늘 입력된 매입 내역이 없습니다.</p>
        ) : (
          <div className="space-y-1.5">
            {orders.map((o: any) => (
              <div key={o.id} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{o.note || `전표 #${o.id}`}</span>
                <span className="font-medium">{fmt(parseFloat(o.totalAmount))}</span>
              </div>
            ))}
            {purchases.map((p: any) => (
              <div key={p.id} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{p.vendorName ? `${p.vendorName} — ` : ""}{p.itemName}</span>
                <span className="font-medium">{fmt(parseFloat(p.cost))}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <Label className="text-xs mb-1 block">매입 확인 메모 (선택)</Label>
        <Textarea
          value={purchaseNote}
          onChange={e => setPurchaseNote(e.target.value)}
          placeholder="매입 관련 특이사항, 누락 항목, 확인 필요 사항 등을 메모하세요."
          className="text-sm resize-none"
          rows={3}
        />
      </div>
    </div>
  );
}

// ─── 인건비/스케줄 확인 컴포넌트 ──────────────────────────────────────────────
function ScheduleStep({
  restaurantId,
  todayStr,
  tomorrowScheduleConfirmed,
  setTomorrowScheduleConfirmed,
  scheduleNote,
  setScheduleNote,
  laborCost,
}: {
  restaurantId: number;
  todayStr: string;
  tomorrowScheduleConfirmed: boolean;
  setTomorrowScheduleConfirmed: (v: boolean) => void;
  scheduleNote: string;
  setScheduleNote: (v: string) => void;
  laborCost: number;
}) {
  const tomorrowQuery = trpc.schedules.getTomorrowCheck.useQuery({ restaurantId }, { enabled: !!restaurantId });
  const tomorrow = tomorrowQuery.data ?? [];
  const confirmedCount = tomorrow.filter((s: any) => s.status === "confirmed" || s.status === "published").length;
  const draftCount = tomorrow.filter((s: any) => s.status === "draft").length;

  const fmtTime = (d: any) => {
    if (!d) return "-";
    const dt = new Date(d);
    return dt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="space-y-4">
      {/* 오늘 인건비 */}
      <div className="rounded-lg bg-purple-500/10 border border-purple-500/20 p-4">
        <div className="flex justify-between items-center">
          <span className="text-sm font-semibold">오늘 예상 인건비</span>
          <span className="text-lg font-bold text-purple-400">{fmt(laborCost)}</span>
        </div>
      </div>

      {/* 내일 스케줄 */}
      <div className="space-y-2">
        <p className="text-sm font-semibold">내일 스케줄 현황</p>
        {tomorrowQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">로딩 중...</p>
        ) : tomorrow.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg p-3">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            내일 등록된 스케줄이 없습니다. 확인이 필요합니다.
          </div>
        ) : (
          <div className="rounded-lg border divide-y divide-border">
            {tomorrow.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{s.userName ?? s.tempWorkerName ?? "미지정"}</p>
                  <p className="text-xs text-muted-foreground">{fmtTime(s.startTime)} ~ {fmtTime(s.endTime)}</p>
                </div>
                <Badge variant={s.status === "confirmed" ? "default" : s.status === "published" ? "secondary" : "outline"} className="text-xs">
                  {s.status === "confirmed" ? "확정" : s.status === "published" ? "발행" : "임시"}
                </Badge>
              </div>
            ))}
          </div>
        )}
        {draftCount > 0 && (
          <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg p-3">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {draftCount}명의 스케줄이 아직 임시 상태입니다. 발행 처리가 필요합니다.
          </div>
        )}
      </div>

      {/* 내일 스케줄 확정 토글 */}
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">내일 스케줄 확정 완료</p>
          <p className="text-xs text-muted-foreground">내일 근무 인원이 모두 확정되었습니까?</p>
        </div>
        <Switch
          checked={tomorrowScheduleConfirmed}
          onCheckedChange={setTomorrowScheduleConfirmed}
        />
      </div>

      {/* 스케줄 메모 */}
      <div>
        <Label className="text-xs mb-1 block">스케줄 특이사항 (선택)</Label>
        <Textarea
          value={scheduleNote}
          onChange={e => setScheduleNote(e.target.value)}
          placeholder="스케줄 변경, 대타, 추가 인원 등 특이사항을 메모하세요."
          className="text-sm resize-none"
          rows={3}
        />
      </div>
    </div>
  );
}

// ─── 마감 확정 컴포넌트 ────────────────────────────────────────────────────────
function ConfirmStep({
  salesBreakdown,
  salesSpecials,
  purchaseNote,
  tomorrowScheduleConfirmed,
  scheduleNote,
  note,
  setNote,
  laborCost,
  purchaseTotal,
  existingClosing,
}: {
  salesBreakdown: Array<{ typeName: string; amount: number }>;
  salesSpecials: Array<{ typeName: string; amount: number; note?: string }>;
  purchaseNote: string;
  tomorrowScheduleConfirmed: boolean;
  scheduleNote: string;
  note: string;
  setNote: (v: string) => void;
  laborCost: number;
  purchaseTotal: number;
  existingClosing: any;
}) {
  const salesTotal = salesBreakdown.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="space-y-4">
      {existingClosing && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg p-3">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          이미 마감된 날입니다. 재마감하면 기존 데이터를 덮어씁니다.
        </div>
      )}

      {/* 요약 카드 */}
      <div className="rounded-lg bg-muted/40 p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground mb-3">마감 요약</p>
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">일일 총 매출</span>
            <span className="font-bold text-emerald-400">{fmt(salesTotal)}</span>
          </div>
          {salesBreakdown.filter(i => i.amount > 0).map(i => (
            <div key={i.typeName} className="flex justify-between text-xs text-muted-foreground pl-3">
              <span>{i.typeName}</span>
              <span>{fmt(i.amount)}</span>
            </div>
          ))}
          <Separator className="my-1" />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground" title="오늘 실제 입고/매입 합계">오늘 실매입</span>
            <span className="font-medium text-amber-400">{fmt(purchaseTotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">오늘 인건비</span>
            <span className="font-medium text-purple-400">{fmt(laborCost)}</span>
          </div>
          <Separator className="my-1" />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">특이사항</span>
            <span className="text-xs">{salesSpecials.length > 0 ? `${salesSpecials.length}건` : "없음"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">내일 스케줄</span>
            <span className={cn("text-xs font-medium", tomorrowScheduleConfirmed ? "text-emerald-400" : "text-amber-400")}>
              {tomorrowScheduleConfirmed ? "확정 완료" : "미확정"}
            </span>
          </div>
        </div>
      </div>

      {/* 최종 메모 */}
      <div>
        <Label className="text-xs mb-1 block">최종 메모 (선택)</Label>
        <Textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="날씨, 이벤트, 특이사항 등 오늘 영업에 대한 총평을 남겨주세요."
          className="text-sm resize-none"
          rows={3}
        />
      </div>
    </div>
  );
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────
export default function DailyClosingPage() {
  const { selectedRestaurantId } = useRestaurant();
  const [, navigate] = useLocation();

  const todayStr = useMemo(() => todayKST(), []);

  const [step, setStep] = useState(1);
  const [salesBreakdown, setSalesBreakdown] = useState<Array<{ typeName: string; amount: number }>>([]);
  const [salesSpecials, setSalesSpecials] = useState<Array<{ typeName: string; amount: number; note?: string }>>([]);
  const [purchaseNote, setPurchaseNote] = useState("");
  const [tomorrowScheduleConfirmed, setTomorrowScheduleConfirmed] = useState(false);
  const [scheduleNote, setScheduleNote] = useState("");
  const [note, setNote] = useState("");

  const utils = trpc.useUtils();

  const salesTypesQuery = trpc.dailyClosings.getSalesTypes.useQuery(
    { restaurantId: selectedRestaurantId! },
    { enabled: !!selectedRestaurantId }
  );
  const specialTypesQuery = trpc.dailyClosings.getSpecialTypes.useQuery(
    { restaurantId: selectedRestaurantId! },
    { enabled: !!selectedRestaurantId }
  );
  const detailQuery = trpc.dailyClosings.getDetail.useQuery(
    { restaurantId: selectedRestaurantId!, date: todayStr },
    { enabled: !!selectedRestaurantId }
  );
  const profitabilityQuery = trpc.profitability.daily.useQuery(
    { restaurantId: selectedRestaurantId!, date: todayStr },
    { enabled: !!selectedRestaurantId }
  );
  const existingClosingQuery = trpc.dailyClosings.get.useQuery(
    { restaurantId: selectedRestaurantId!, date: todayStr },
    { enabled: !!selectedRestaurantId }
  );

  const addSalesTypeMutation = trpc.dailyClosings.addSalesType.useMutation({
    onSuccess: () => utils.dailyClosings.getSalesTypes.invalidate(),
  });
  const addSpecialTypeMutation = trpc.dailyClosings.addSpecialType.useMutation({
    onSuccess: () => utils.dailyClosings.getSpecialTypes.invalidate(),
  });
  const closeMutation = trpc.dailyClosings.close.useMutation({
    onSuccess: () => {
      toast.success("일마감이 완료되었습니다.");
      utils.dailyClosings.get.invalidate();
      utils.dailyClosings.listByMonth.invalidate();
      navigate("/");
    },
    onError: (e) => toast.error(e.message),
  });

  const salesTypes = salesTypesQuery.data ?? [];
  const specialTypes = specialTypesQuery.data ?? [];
  const detail = detailQuery.data;
  const laborCost = profitabilityQuery.data?.laborCost ?? 0;
  const purchaseTotal = (detail?.purchaseOrderList ?? []).reduce((s: number, o: any) => s + parseFloat(o.totalAmount ?? "0"), 0)
    + (detail?.purchaseList ?? []).reduce((s: number, p: any) => s + parseFloat(p.cost ?? "0"), 0);

  const handleClose = () => {
    if (!selectedRestaurantId) return;
    closeMutation.mutate({
      restaurantId: selectedRestaurantId,
      date: todayStr,
      salesBreakdown: salesBreakdown.filter(i => i.amount > 0),
      salesSpecials: salesSpecials.filter(i => i.amount > 0 || (i.note && i.note.trim())),
      tomorrowScheduleConfirmed,
      scheduleNote: scheduleNote || undefined,
      purchaseNote: purchaseNote || undefined,
      note: note || undefined,
    });
  };

  const canProceed = () => {
    if (step === 1) return salesBreakdown.some(i => i.amount > 0);
    return true;
  };

  const fmtDate = (d: string) => {
    const dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  };

  return (
    <AppLayout title="일마감" subtitle={fmtDate(todayStr)}>
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* 스텝 인디케이터 */}
        <div className="flex items-center gap-1">
          {STEPS.map((s, idx) => {
            const Icon = s.icon;
            const isDone = step > s.id;
            const isCurrent = step === s.id;
            return (
              <div key={s.id} className="flex items-center gap-1 flex-1">
                <button
                  onClick={() => isDone && setStep(s.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 flex-1 py-2 rounded-lg transition-colors",
                    isCurrent ? "bg-blue-600/20 text-blue-400" : isDone ? "text-emerald-400 cursor-pointer" : "text-muted-foreground"
                  )}
                >
                  <div className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold",
                    isCurrent ? "bg-blue-600 text-white" : isDone ? "bg-emerald-600 text-white" : "bg-muted"
                  )}>
                    {isDone ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-3.5 w-3.5" />}
                  </div>
                  <span className="text-[10px] hidden sm:block">{s.label}</span>
                </button>
                {idx < STEPS.length - 1 && (
                  <div className={cn("h-0.5 w-3 rounded shrink-0", step > s.id ? "bg-emerald-500" : "bg-muted")} />
                )}
              </div>
            );
          })}
        </div>

        {/* 스텝 카드 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {(() => { const Icon = STEPS[step - 1].icon; return <Icon className="h-4 w-4" />; })()}
              {STEPS[step - 1].label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {step === 1 && (
              <SalesStep
                salesTypes={salesTypes}
                salesBreakdown={salesBreakdown}
                setSalesBreakdown={setSalesBreakdown}
                onAddType={name => selectedRestaurantId && addSalesTypeMutation.mutate({ restaurantId: selectedRestaurantId, typeName: name })}
              />
            )}
            {step === 2 && (
              <SpecialsStep
                specialTypes={specialTypes}
                salesSpecials={salesSpecials}
                setSalesSpecials={setSalesSpecials}
                onAddType={name => selectedRestaurantId && addSpecialTypeMutation.mutate({ restaurantId: selectedRestaurantId, typeName: name })}
              />
            )}
            {step === 3 && (
              <PurchaseStep
                detail={detail}
                purchaseNote={purchaseNote}
                setPurchaseNote={setPurchaseNote}
              />
            )}
            {step === 4 && (
              <ScheduleStep
                restaurantId={selectedRestaurantId!}
                todayStr={todayStr}
                tomorrowScheduleConfirmed={tomorrowScheduleConfirmed}
                setTomorrowScheduleConfirmed={setTomorrowScheduleConfirmed}
                scheduleNote={scheduleNote}
                setScheduleNote={setScheduleNote}
                laborCost={laborCost ?? 0}
              />
            )}
            {step === 5 && (
              <ConfirmStep
                salesBreakdown={salesBreakdown}
                salesSpecials={salesSpecials}
                purchaseNote={purchaseNote}
                tomorrowScheduleConfirmed={tomorrowScheduleConfirmed}
                scheduleNote={scheduleNote}
                note={note}
                setNote={setNote}
                laborCost={laborCost ?? 0}
                purchaseTotal={purchaseTotal}
                existingClosing={existingClosingQuery.data}
              />
            )}
          </CardContent>
        </Card>

        {/* 네비게이션 버튼 */}
        <div className="flex gap-3">
          {step > 1 ? (
            <Button variant="outline" onClick={() => setStep(s => s - 1)} className="gap-1.5">
              <ChevronLeft className="h-4 w-4" />이전
            </Button>
          ) : (
            <Button variant="outline" onClick={() => navigate("/")} className="gap-1.5">
              <ArrowLeft className="h-4 w-4" />취소
            </Button>
          )}
          <div className="flex-1" />
          {step < 5 ? (
            <Button
              onClick={() => setStep(s => s + 1)}
              disabled={!canProceed()}
              className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
            >
              다음<ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleClose}
              disabled={closeMutation.isPending}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <LockKeyhole className="h-4 w-4" />
              {closeMutation.isPending ? "마감 중..." : "일마감 확정"}
            </Button>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
