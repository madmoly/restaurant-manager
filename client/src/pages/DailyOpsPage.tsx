import { useState, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  CheckCircle2, Clock, Users, Banknote, CreditCard, Receipt, Tag, Plus, Trash2,
  ChevronDown, ChevronUp, AlertCircle, TrendingUp, X, ArrowLeft,
  ShoppingCart, LockKeyhole, ClipboardList, Package, Building2, Copy,
  AlertTriangle, Calendar, Image, TrendingDown, Sun, Sunrise, Zap, Pencil,
  Sparkles, CheckSquare, Square
} from "lucide-react";
import { cn } from "@/lib/utils";
import { todayKST, addDays } from "@/lib/dateKST";
import AppLayout from "@/components/AppLayout";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import DailyChecklistCard from "@/components/DailyChecklistCard";
import { getEffectiveRole, isManagerLevel } from "@shared/permissions";

// ─── 유틸 ──────────────────────────────────────────────────────────────────────
function fmt(v: number | string | null | undefined) {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  return new Intl.NumberFormat("ko-KR").format(Math.round(n)) + "원";
}
const fmtCurrency = (v: number) =>
  new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(v);

// ─── 매입 관련 상수/타입 ────────────────────────────────────────────────────────
const PURCHASE_CATEGORIES = [
  { value: "food",    label: "식재료",  color: "bg-green-500/10 text-green-700 dark:text-green-400" },
  { value: "supply",  label: "소모품",  color: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  { value: "utility", label: "공과금",  color: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" },
  { value: "labor",   label: "인건비",  color: "bg-purple-500/10 text-purple-700 dark:text-purple-400" },
  { value: "other",   label: "기타",    color: "bg-gray-500/10 text-gray-600 dark:text-gray-400" },
] as const;
type PurchaseCategory = typeof PURCHASE_CATEGORIES[number]["value"];
const UNITS = [
  { value: "kg", label: "kg", decimal: true }, { value: "g", label: "g", decimal: false },
  { value: "L", label: "L", decimal: true }, { value: "mL", label: "mL", decimal: false },
  { value: "개", label: "개", decimal: false }, { value: "박스", label: "박스", decimal: false },
  { value: "봉", label: "봉", decimal: false }, { value: "팩", label: "팩", decimal: false },
  { value: "병", label: "병", decimal: false }, { value: "캔", label: "캔", decimal: false },
  { value: "장", label: "장", decimal: false }, { value: "묶음", label: "묶음", decimal: false },
  { value: "포", label: "포", decimal: false }, { value: "롤", label: "롤", decimal: false },
];
const COUNTERPARTY_TYPE_LABELS: Record<string, string> = {
  supplier: "공급업체", online: "온라인", mart: "마트", repair: "수리", other: "기타"
};
type OrderLine = {
  id: string; itemId?: number; counterpartyItemId?: number;
  rawItemName: string; category: PurchaseCategory;
  quantity: string; unitName: string; unitPrice: string; lineTotal: string; note: string;
};
type CpItem = {
  id: number; counterpartyId: number; itemId: number; itemName: string;
  itemType: "product" | "service" | "misc"; supplierItemName: string | null;
  purchaseUnit: string | null; conversionToBase: string | null; decimalAllowed: boolean;
  quantityStep: string | null; defaultPrice: string | null; lastPrice: string | null;
  isPreferred: boolean; costingCategory: string | null; baseUnit: string | null;
};
function newLine(): OrderLine {
  return { id: Math.random().toString(36).slice(2), rawItemName: "", category: "food", quantity: "", unitName: "", unitPrice: "", lineTotal: "", note: "" };
}

// ─── 일마감 스텝 컴포넌트들 ────────────────────────────────────────────────────
const CLOSING_STEPS = [
  { id: 1, label: "매출 입력", icon: TrendingUp },
  { id: 2, label: "발주 체크", icon: Package },
  { id: 3, label: "특이사항", icon: ClipboardList },
  { id: 4, label: "매입 확인", icon: ShoppingCart },
  { id: 5, label: "인건비/스케줄", icon: Users },
  { id: 6, label: "청소 확인", icon: Sparkles },
  { id: 7, label: "마감 확정", icon: LockKeyhole },
];

function SalesStep({ salesTypes, salesBreakdown, setSalesBreakdown, onAddType, intermTotal }: {
  salesTypes: Array<{ id: number; typeName: string }>;
  salesBreakdown: Array<{ typeName: string; amount: number }>;
  setSalesBreakdown: (v: Array<{ typeName: string; amount: number }>) => void;
  onAddType: (name: string) => void;
  intermTotal: number;
}) {
  const [newTypeName, setNewTypeName] = useState("");
  const directTotal = salesBreakdown.reduce((s, i) => s + i.amount, 0);
  const grandTotal = directTotal + intermTotal;
  const setAmount = (typeName: string, amount: number) => {
    const existing = salesBreakdown.find(i => i.typeName === typeName);
    if (existing) setSalesBreakdown(salesBreakdown.map(i => i.typeName === typeName ? { ...i, amount } : i));
    else setSalesBreakdown([...salesBreakdown, { typeName, amount }]);
  };
  const getAmount = (typeName: string) => salesBreakdown.find(i => i.typeName === typeName)?.amount ?? 0;
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
              <Input type="number" min={0} value={getAmount(t.typeName) || ""} onChange={e => setAmount(t.typeName, Number(e.target.value) || 0)} placeholder="0" className="pr-8 text-right" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">원</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <Input value={newTypeName} onChange={e => setNewTypeName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAddType()} placeholder="새 매출 항목 추가 (예: 네이버페이)" className="flex-1 text-sm" />
        <Button size="sm" variant="outline" onClick={handleAddType} className="gap-1 shrink-0"><Plus className="h-3.5 w-3.5" />추가</Button>
      </div>
      {intermTotal > 0 && (
        <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 flex justify-between items-center">
          <span className="text-sm text-blue-400">중간 매출 합산</span>
          <span className="text-sm font-semibold text-blue-400">+{fmtCurrency(intermTotal)}</span>
        </div>
      )}
      {grandTotal > 0 && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 flex justify-between items-center">
          <span className="text-sm font-semibold text-emerald-400">일일 총 매출 (중간 매출 포함)</span>
          <span className="text-lg font-bold text-emerald-400">{fmtCurrency(grandTotal)}</span>
        </div>
      )}
    </div>
  );
}

function SpecialsStep({ specialTypes, salesSpecials, setSalesSpecials, onAddType }: {
  specialTypes: Array<{ id: number; typeName: string }>;
  salesSpecials: Array<{ typeName: string; amount: number; note?: string }>;
  setSalesSpecials: (v: Array<{ typeName: string; amount: number; note?: string }>) => void;
  onAddType: (name: string) => void;
}) {
  const [newTypeName, setNewTypeName] = useState("");
  const setItem = (typeName: string, patch: { amount?: number; note?: string }) => {
    const existing = salesSpecials.find(i => i.typeName === typeName);
    if (existing) setSalesSpecials(salesSpecials.map(i => i.typeName === typeName ? { ...i, ...patch } : i));
    else setSalesSpecials([...salesSpecials, { typeName, amount: 0, ...patch }]);
  };
  const removeItem = (typeName: string) => setSalesSpecials(salesSpecials.filter(i => i.typeName !== typeName));
  const handleAddType = () => {
    const name = newTypeName.trim();
    if (!name) return;
    onAddType(name);
    setNewTypeName("");
  };
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {specialTypes.map(t => {
          const item = salesSpecials.find(i => i.typeName === t.typeName) ?? { amount: 0, note: "" };
          const isActive = salesSpecials.some(i => i.typeName === t.typeName);
          return (
            <div key={t.id} className={cn("rounded-lg border p-3 space-y-2 transition-colors", isActive ? "border-amber-500/30 bg-amber-500/5" : "border-border")}>
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">{t.typeName}</Label>
                {isActive && <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeItem(t.typeName)}><X className="h-3 w-3" /></Button>}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input type="number" min={0} value={item.amount || ""} onChange={e => setItem(t.typeName, { amount: Number(e.target.value) || 0 })} placeholder="금액 (없으면 0)" className="pr-8 text-right text-sm" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">원</span>
                </div>
                <Input value={item.note ?? ""} onChange={e => setItem(t.typeName, { note: e.target.value })} placeholder="메모 (선택)" className="flex-1 text-sm" />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 pt-1">
        <Input value={newTypeName} onChange={e => setNewTypeName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAddType()} placeholder="새 특이사항 항목 추가 (예: 단체 예약 할인)" className="flex-1 text-sm" />
        <Button size="sm" variant="outline" onClick={handleAddType} className="gap-1 shrink-0"><Plus className="h-3.5 w-3.5" />추가</Button>
      </div>
      {salesSpecials.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
          <p className="text-xs font-semibold text-amber-400 mb-1">입력된 특이사항</p>
          {salesSpecials.map(i => (
            <div key={i.typeName} className="flex justify-between text-xs text-muted-foreground">
              <span>{i.typeName}{i.note ? ` — ${i.note}` : ""}</span>
              <span>{i.amount > 0 ? fmtCurrency(i.amount) : "-"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 발주 체크 스텝 ────────────────────────────────────────────────────────────
function OrderCheckStep({
  orderCheckPhotoUrl, setOrderCheckPhotoUrl,
  orderCheckNoOrder, setOrderCheckNoOrder,
}: {
  orderCheckPhotoUrl: string;
  setOrderCheckPhotoUrl: (v: string) => void;
  orderCheckNoOrder: boolean;
  setOrderCheckNoOrder: (v: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { toast.error("파일 크기가 16MB를 초과합니다."); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const { url } = await res.json();
      setOrderCheckPhotoUrl(url);
      setOrderCheckNoOrder(false);
      toast.success("발주 사진이 업로드되었습니다.");
    } catch (e: any) {
      toast.error("업로드 실패: " + e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-muted/40 p-4 space-y-3">
        <p className="text-sm font-semibold">금일 발주 내역 사진</p>
        <p className="text-xs text-muted-foreground">발주서 또는 발주 확인 화면 스크린샷을 업로드하세요.</p>
        {orderCheckPhotoUrl ? (
          <div className="space-y-2">
            <img
              src={orderCheckPhotoUrl}
              alt="발주 사진"
              className="w-full max-h-48 object-contain rounded-lg border border-border cursor-pointer"
              onClick={() => setPreviewUrl(orderCheckPhotoUrl)}
            />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <Image className="h-3 w-3 mr-1" />사진 교체
              </Button>
              <Button size="sm" variant="outline" className="text-xs text-destructive hover:text-destructive" onClick={() => setOrderCheckPhotoUrl("")}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-full h-24 border-dashed flex-col gap-2 text-muted-foreground hover:text-foreground"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || orderCheckNoOrder}
          >
            {uploading ? (
              <><span className="animate-spin text-lg">⌛</span><span className="text-xs">업로드 중...</span></>
            ) : (
              <><Image className="h-6 w-6" /><span className="text-xs">발주 사진 업로드</span></>
            )}
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
        />
      </div>

      <div className={cn(
        "flex items-center gap-3 rounded-lg border p-4 cursor-pointer transition-colors",
        orderCheckNoOrder ? "bg-amber-500/10 border-amber-500/30" : "bg-muted/30 hover:bg-muted/50"
      )} onClick={() => { setOrderCheckNoOrder(!orderCheckNoOrder); if (!orderCheckNoOrder) setOrderCheckPhotoUrl(""); }}>
        <div className={cn(
          "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
          orderCheckNoOrder ? "bg-amber-500 border-amber-500" : "border-muted-foreground"
        )}>
          {orderCheckNoOrder && <CheckCircle2 className="h-3 w-3 text-white" />}
        </div>
        <div>
          <p className="text-sm font-medium">금일 발주 없음</p>
          <p className="text-xs text-muted-foreground">오늘 발주한 내역이 없습니다.</p>
        </div>
      </div>

      {!orderCheckPhotoUrl && !orderCheckNoOrder && (
        <p className="text-xs text-center text-amber-400">발주 사진을 업로드하거나 '금일 발주 없음'을 체크해야 다음 단계로 진행할 수 있습니다.</p>
      )}

      {previewUrl && <ImagePreviewModal url={previewUrl} onClose={() => setPreviewUrl(null)} />}
    </div>
  );
}

function PurchaseCheckStep({ detail, purchaseNote, setPurchaseNote }: { detail: any; purchaseNote: string; setPurchaseNote: (v: string) => void }) {
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
          <span className="text-lg font-bold text-amber-400">{fmtCurrency(total)}</span>
        </div>
        {orders.length === 0 && purchases.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">오늘 입력된 매입 내역이 없습니다.</p>
        ) : (
          <div className="space-y-1.5">
            {orders.map((o: any) => (
              <div key={o.id} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{o.note || `전표 #${o.id}`}</span>
                <span className="font-medium">{fmtCurrency(parseFloat(o.totalAmount))}</span>
              </div>
            ))}
            {purchases.map((p: any) => (
              <div key={p.id} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{p.vendorName ? `${p.vendorName} — ` : ""}{p.itemName}</span>
                <span className="font-medium">{fmtCurrency(parseFloat(p.cost))}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <Label className="text-xs mb-1 block">매입 확인 메모 (선택)</Label>
        <Textarea value={purchaseNote} onChange={e => setPurchaseNote(e.target.value)} placeholder="매입 관련 특이사항, 누락 항목, 확인 필요 사항 등을 메모하세요." className="text-sm resize-none" rows={3} />
      </div>
    </div>
  );
}

function ScheduleCheckStep({ restaurantId, todayStr, tomorrowScheduleConfirmed, setTomorrowScheduleConfirmed, scheduleNote, setScheduleNote, laborCost }: {
  restaurantId: number; todayStr: string; tomorrowScheduleConfirmed: boolean;
  setTomorrowScheduleConfirmed: (v: boolean) => void; scheduleNote: string;
  setScheduleNote: (v: string) => void; laborCost: number;
}) {
  function fmtTime(t: string | null | undefined) {
    if (!t) return "-";
    return t.slice(0, 5);
  }
  const tomorrowStr = useMemo(() => addDays(todayStr, 1), [todayStr]);
  const todayScheduleQuery = trpc.schedules.listByRestaurantAndRange.useQuery(
    { restaurantId, startDate: todayStr, endDate: todayStr },
    { enabled: !!restaurantId }
  );
  const tomorrowScheduleQuery = trpc.schedules.listByRestaurantAndRange.useQuery(
    { restaurantId, startDate: tomorrowStr, endDate: tomorrowStr },
    { enabled: !!restaurantId }
  );
  const todaySchedules = todayScheduleQuery.data ?? [];
  const tomorrowSchedules = tomorrowScheduleQuery.data ?? [];
  const draftCount = tomorrowSchedules.filter((s: any) => s.status === "draft").length;
  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-muted/40 p-3">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-semibold">오늘 인건비 (예상)</span>
          <span className="text-base font-bold text-purple-400">{fmtCurrency(laborCost)}</span>
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2">오늘 스케줄 ({todaySchedules.length}명)</p>
        {todaySchedules.length === 0 ? (
          <p className="text-xs text-muted-foreground">오늘 스케줄이 없습니다.</p>
        ) : (
          <div className="space-y-1.5">
            {todaySchedules.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between text-sm rounded-md bg-muted/30 px-3 py-2">
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
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2">내일 스케줄 ({tomorrowSchedules.length}명)</p>
        {tomorrowSchedules.length === 0 ? (
          <p className="text-xs text-muted-foreground">내일 스케줄이 없습니다.</p>
        ) : (
          <div className="space-y-1.5">
            {tomorrowSchedules.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between text-sm rounded-md bg-muted/30 px-3 py-2">
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
      </div>
      {draftCount > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg p-3">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {draftCount}명의 스케줄이 아직 임시 상태입니다. 발행 처리가 필요합니다.
        </div>
      )}
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">내일 스케줄 확정 완료</p>
          <p className="text-xs text-muted-foreground">내일 근무 인원이 모두 확정되었습니까?</p>
        </div>
        <Switch checked={tomorrowScheduleConfirmed} onCheckedChange={setTomorrowScheduleConfirmed} />
      </div>
      <div>
        <Label className="text-xs mb-1 block">스케줄 특이사항 (선택)</Label>
        <Textarea value={scheduleNote} onChange={e => setScheduleNote(e.target.value)} placeholder="스케줄 변경, 대타, 추가 인원 등 특이사항을 메모하세요." className="text-sm resize-none" rows={3} />
      </div>
    </div>
  );
}

function ConfirmClosingStep({ salesBreakdown, salesSpecials, purchaseNote, tomorrowScheduleConfirmed, scheduleNote, note, setNote, laborCost, purchaseTotal, existingClosing, intermTotal }: {
  salesBreakdown: Array<{ typeName: string; amount: number }>;
  salesSpecials: Array<{ typeName: string; amount: number; note?: string }>;
  purchaseNote: string; tomorrowScheduleConfirmed: boolean; scheduleNote: string;
  note: string; setNote: (v: string) => void; laborCost: number; purchaseTotal: number; existingClosing: any;
  intermTotal: number;
}) {
  const directTotal = salesBreakdown.reduce((s, i) => s + i.amount, 0);
  const salesTotal = directTotal + intermTotal;
  return (
    <div className="space-y-4">
      {existingClosing && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg p-3">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          이미 마감된 날입니다. 재마감하면 기존 데이터를 덮어씁니다.
        </div>
      )}
      <div className="rounded-lg bg-muted/40 p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground mb-3">마감 요약</p>
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">일일 총 매출</span>
            <span className="font-bold text-emerald-400">{fmtCurrency(salesTotal)}</span>
          </div>
          {salesBreakdown.filter(i => i.amount > 0).map(i => (
            <div key={i.typeName} className="flex justify-between text-xs text-muted-foreground pl-3">
              <span>{i.typeName}</span><span>{fmtCurrency(i.amount)}</span>
            </div>
          ))}
          {intermTotal > 0 && (
            <div className="flex justify-between text-xs text-blue-400 pl-3">
              <span>중간 매출 합산</span><span>{fmtCurrency(intermTotal)}</span>
            </div>
          )}
          <Separator className="my-1" />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">오늘 매입</span>
            <span className="font-medium text-amber-400">{fmtCurrency(purchaseTotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">오늘 인건비</span>
            <span className="font-medium text-purple-400">{fmtCurrency(laborCost)}</span>
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
      <div>
        <Label className="text-xs mb-1 block">최종 메모 (선택)</Label>
        <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="날씨, 이벤트, 특이사항 등 오늘 영업에 대한 총평을 남겨주세요." className="text-sm resize-none" rows={3} />
      </div>
    </div>
  );
}

// ─── 매입 OrderRow 컴포넌트 ───────────────────────────────────────────────────
function OrderRow({ order, isManager, onDelete, onUpdated }: {
  order: { id: number; counterpartyName: string | null; purchaseDate: Date | null; status: string; totalAmount: string; note: string | null; createdByName: string | null; attachmentUrl?: string | null; editHistory?: Array<{userId: number; userName: string; at: string; summary: string}> | null };
  isManager: boolean; onDelete: () => void; onUpdated?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editNote, setEditNote] = useState(order.note ?? "");
  const [editStatus, setEditStatus] = useState<"received" | "ordered">(order.status as "received" | "ordered");
  const [editDate, setEditDate] = useState(() => {
    if (!order.purchaseDate) return "";
    const d = typeof order.purchaseDate === "string" ? new Date(order.purchaseDate) : order.purchaseDate;
    return d.toISOString().split("T")[0];
  });
  const [editAttachment, setEditAttachment] = useState(order.attachmentUrl ?? "");
  const [editAttachUploading, setEditAttachUploading] = useState(false);
  const editAttachRef = useRef<HTMLInputElement>(null);
  const itemsQuery = trpc.purchasesV2.getOrderItems.useQuery({ orderId: order.id }, { enabled: expanded });
  const utils = trpc.useUtils();
  const updateMutation = trpc.purchasesV2.updateOrder.useMutation({
    onSuccess: () => { toast.success("전표가 수정되었습니다"); setShowEdit(false); onUpdated?.(); utils.purchasesV2.listOrdersByMonth.invalidate(); },
    onError: (e) => toast.error("수정 실패: " + e.message),
  });
  const fmtDate = (d: string | Date) => {
    const date = typeof d === "string" ? new Date(d) : d;
    return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
  };
  const handleEditAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEditAttachUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (json.url) { setEditAttachment(json.url); toast.success("영수증 업로드 완료"); }
    } catch { toast.error("업로드 실패"); } finally { setEditAttachUploading(false); }
  };
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <button className="flex-1 flex items-center gap-3 text-left" onClick={() => setExpanded(e => !e)}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{order.counterpartyName ?? "거래처 없음"}</span>
              <Badge variant={order.status === "received" ? "default" : "secondary"} className="text-xs">
                {order.status === "received" ? "입고" : "발주"}
              </Badge>
              {order.note && <span className="text-xs text-muted-foreground truncate max-w-[120px]">{order.note}</span>}
              {order.attachmentUrl && (
                <button
                  className="text-xs text-primary underline"
                  onClick={e => { e.stopPropagation(); setPreviewUrl(order.attachmentUrl!); }}
                >
                  영수증
                </button>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-muted-foreground">{order.purchaseDate ? fmtDate(order.purchaseDate) : "-"}</span>
              {order.createdByName && <span className="text-xs text-muted-foreground">{order.createdByName}</span>}
              {(order as any).editHistory?.length > 0 && <span className="text-[10px] text-muted-foreground/60">수정됨</span>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="font-semibold text-sm">{fmt(parseFloat(String(order.totalAmount)))}</p>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={e => { e.stopPropagation(); setShowEdit(true); }}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          {isManager && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
      {/* 수정 다이얼로그 */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">전표 수정 — #{order.id}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">날짜</Label>
              <Input type="date" className="h-8 text-xs" value={editDate} onChange={e => setEditDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">상태</Label>
              <Select value={editStatus} onValueChange={v => setEditStatus(v as "received" | "ordered")}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="received">입고</SelectItem>
                  <SelectItem value="ordered">발주</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">메모</Label>
              <Input className="h-8 text-xs" value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="메모 (선택)" />
            </div>
            <div>
              <Label className="text-xs">영수증</Label>
              <div className="flex items-center gap-2">
                {editAttachment ? (
                  <div className="flex items-center gap-1 flex-1">
                    <button className="text-xs text-primary underline truncate" onClick={() => setPreviewUrl(editAttachment)}>영수증 보기</button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditAttachment("")}><X className="w-3 h-3" /></Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => editAttachRef.current?.click()} disabled={editAttachUploading}>
                    {editAttachUploading ? "업로드 중..." : "영수증 체인지"}
                  </Button>
                )}
                <input ref={editAttachRef} type="file" accept="image/*" className="hidden" onChange={handleEditAttach} />
              </div>
            </div>
            {(order as any).editHistory?.length > 0 && (
              <div className="border-t border-border/30 pt-2">
                <p className="text-[10px] text-muted-foreground mb-1">수정 이력</p>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {((order as any).editHistory as Array<{userId: number; userName: string; at: string; summary: string}>).map((h, i) => (
                    <div key={i} className="text-[10px] text-muted-foreground">
                      <span className="font-medium">{h.userName}</span> · {new Date(h.at).toLocaleString("ko-KR", {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})} — {h.summary}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowEdit(false)}>취소</Button>
            <Button size="sm" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: order.id, status: editStatus, note: editNote || null, purchaseDate: editDate || undefined, attachmentUrl: editAttachment || null })}>
              {updateMutation.isPending ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {expanded && (
        <div className="mt-3 pl-2 border-l-2 border-muted">
          {itemsQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">불러오는 중...</p>
          ) : itemsQuery.data?.length ? (
            <div className="space-y-1.5">
              {itemsQuery.data.map(item => {
                const cat = PURCHASE_CATEGORIES.find(c => c.value === item.costingCategory);
                return (
                  <div key={item.id} className="flex items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium truncate">{(item as any).rawItemName || (item as any).itemName || "-"}</span>
                      {cat && <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cat.color}`}>{cat.label}</span>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-muted-foreground">
                      {(item as any).quantity && <span>{(item as any).quantity}{(item as any).unitName ? ` ${(item as any).unitName}` : ""}</span>}
                      {(item as any).unitPrice && <span>{fmt(parseFloat(String((item as any).unitPrice)))}</span>}
                      <span className="font-semibold text-foreground">{fmt(parseFloat(String((item as any).lineTotal)))}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-xs text-muted-foreground">항목 없음</p>}
        </div>
      )}
      <ImagePreviewModal url={previewUrl} onClose={() => setPreviewUrl(null)} />
    </div>
  );
}

// ─── 매입 OrderLineCard ────────────────────────────────────────────────────────────────────────────────────
function OrderLineCard({ line, index, cpItems, restaurantId, onChange, onRemove, onSelectCpItem, canRemove }: {
  line: OrderLine; index: number; cpItems: CpItem[]; restaurantId: number;
  onChange: (patch: Partial<OrderLine>) => void; onRemove: () => void;
  onSelectCpItem: (ci: CpItem) => void; canRemove: boolean;
}) {
  const [showCpItemDropdown, setShowCpItemDropdown] = useState(false);
  const [showPriceComparison, setShowPriceComparison] = useState(false);
  const priceComparisonQuery = trpc.pricing.getRecentComparisonByItem.useQuery(
    { restaurantId, itemId: line.itemId! },
    { enabled: showPriceComparison && !!line.itemId }
  );
  const filteredCpItems = line.rawItemName
    ? cpItems.filter(ci => (ci.supplierItemName || ci.itemName || "").toLowerCase().includes(line.rawItemName.toLowerCase()))
    : cpItems;
  const selectedUnit = UNITS.find(u => u.value === line.unitName);
  const isDecimalUnit = selectedUnit?.decimal ?? false;
  const catInfo = PURCHASE_CATEGORIES.find(c => c.value === line.category);
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">항목 {index + 1}</span>
          {catInfo && <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${catInfo.color}`}>{catInfo.label}</span>}
        </div>
        {canRemove && <button onClick={onRemove} className="text-muted-foreground hover:text-destructive transition-colors p-1"><X className="w-4 h-4" /></button>}
      </div>
      <div className="relative">
        <Input placeholder="항목명 입력" value={line.rawItemName}
          onChange={e => { onChange({ rawItemName: e.target.value, itemId: undefined, counterpartyItemId: undefined }); setShowCpItemDropdown(true); }}
          onFocus={() => setShowCpItemDropdown(true)}
          onBlur={() => setTimeout(() => setShowCpItemDropdown(false), 150)}
          className="text-base" />
        {showCpItemDropdown && filteredCpItems.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-xl shadow-xl max-h-48 overflow-y-auto">
            {filteredCpItems.map(ci => (
              <button key={ci.id} className="w-full text-left px-4 py-3 text-sm hover:bg-accent flex items-center justify-between border-b last:border-0"
                onMouseDown={() => { onSelectCpItem(ci); setShowCpItemDropdown(false); }}>
                <div>
                  <p className="font-medium">{ci.supplierItemName || ci.itemName}</p>
                  {ci.lastPrice && <p className="text-xs text-muted-foreground">최근가: {fmt(parseFloat(String(ci.lastPrice)))}</p>}
                </div>
                {ci.isPreferred && <Badge variant="outline" className="text-xs">선호</Badge>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {PURCHASE_CATEGORIES.map(cat => (
          <button key={cat.value} onClick={() => onChange({ category: cat.value })}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${line.category === cat.value ? `${cat.color} border-current` : "border-border text-muted-foreground hover:bg-accent"}`}>
            {cat.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">수량</Label>
          <Input type="number" placeholder="0" value={line.quantity}
            onChange={e => onChange({ quantity: e.target.value })}
            step={isDecimalUnit ? "0.1" : "1"} min={0} className="text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">단위</Label>
          <Select value={line.unitName} onValueChange={v => onChange({ unitName: v })}>
            <SelectTrigger className="text-sm h-9"><SelectValue placeholder="단위" /></SelectTrigger>
            <SelectContent>{UNITS.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">단가</Label>
          <Input type="number" placeholder="0" value={line.unitPrice}
            onChange={e => onChange({ unitPrice: e.target.value })} min={0} className="text-sm" />
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">소계</Label>
          {line.itemId && (
            <button onClick={() => setShowPriceComparison(v => !v)} className="text-xs text-primary hover:underline flex items-center gap-1">
              <TrendingDown className="w-3 h-3" />가격 비교
            </button>
          )}
        </div>
        <Input type="number" placeholder="0" value={line.lineTotal}
          onChange={e => onChange({ lineTotal: e.target.value })} min={0} className="text-sm font-semibold" />
        {showPriceComparison && priceComparisonQuery.data && priceComparisonQuery.data.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {priceComparisonQuery.data.map((c: any, i: number) => (
              <div key={i} className="text-xs px-2 py-1 rounded-lg border bg-muted/50 flex items-center gap-1.5">
                <span className="font-medium">{c.counterpartyName}</span>
                <span className="text-muted-foreground">{c.lastPrice ? fmt(parseFloat(String(c.lastPrice))) : "가격 없음"}{c.purchaseUnit ? `/${c.purchaseUnit}` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">비고 (선택)</Label>
        <Input placeholder="비고" value={line.note} onChange={e => onChange({ note: e.target.value })} className="text-sm" />
      </div>
    </div>
  );
}
// ─── 메인 페이지 ──────────────────────────────────────────────────────────────────────────────
export default function DailyOpsPage() {
  const { user } = useAuth();
  const { selectedRestaurantId: rId, selectedRestaurant } = useRestaurant();
  const [, navigate] = useLocation();
  // 매장 내 역할 조회 (시스템 역할이 employee이지만 해당 매장에서 store_manager인 경우 반영)
  const storeRoleQuery = trpc.restaurants.getMyStoreRole.useQuery(
    { restaurantId: rId! },
    { enabled: !!rId && (user?.role === "employee" || user?.role === "user") }
  );
  const storeRole = storeRoleQuery.data;
  const effectiveRole = getEffectiveRole(user?.role ?? "employee", storeRole);
  const isManager = isManagerLevel(effectiveRole);
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);

  const todayStr = useMemo(() => todayKST(), []);
  const [saleDate, setSaleDate] = useState(todayStr);
  const [activeTab, setActiveTab] = useState("open");

  // ─── 오픈 체크 ─────────────────────────────────────────────────────────
  const todayOpsQuery = trpc.dailyOps.getToday.useQuery({ restaurantId: rId! }, { enabled: !!rId });
  const todayOps = todayOpsQuery.data;
  const [closeNote, setCloseNote] = useState("");
  const openCheckMutation = trpc.dailyOps.openCheck.useMutation({
    onSuccess: (data) => { toast.success(`오픈 체크 완료 — 출근 인원 ${data.headcount}명, 예상 인건비 ${fmt(data.laborCost)}`); utils.dailyOps.getToday.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const closeCheckMutation = trpc.dailyOps.closeCheck.useMutation({
    onSuccess: (data) => {
      toast.success(`마감 체크 완료 — 최종 인원 ${data.headcount}명, 인건비 ${fmt(data.laborCost)}`);
      if (data.salesWarning) toast.warning(data.salesWarning);
      utils.dailyOps.getToday.invalidate();
      setCloseNote("");
    },
    onError: (e) => toast.error(e.message),
  });

  // 전날 마감 내용 조회
  const yesterdayStr = useMemo(() => addDays(todayStr, -1), [todayStr]);
  const yesterdayClosingQuery = trpc.dailyClosings.get.useQuery(
    { restaurantId: rId!, date: yesterdayStr },
    { enabled: !!rId }
  );
  const yesterdayClosing = yesterdayClosingQuery.data;

  // 오늘 출근 스케줄 조회
  const todayScheduleQuery = trpc.schedules.listByRestaurantAndRange.useQuery(
    { restaurantId: rId!, startDate: todayStr, endDate: todayStr },
    { enabled: !!rId }
  );
  const todaySchedules = todayScheduleQuery.data ?? [];

  // ─── 중간 매출 ─────────────────────────────────────────────────────────
  const intermQuery = trpc.intermediateSales.listByDate.useQuery({ restaurantId: rId!, saleDate: saleDate }, { enabled: !!rId });
  const [intermAmount, setIntermAmount] = useState("");
  const [intermNote, setIntermNote] = useState("");
  const intermCreateMutation = trpc.intermediateSales.create.useMutation({
    onSuccess: () => { toast.success("중간 매출이 입력되었습니다."); setIntermAmount(""); setIntermNote(""); utils.intermediateSales.listByDate.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const intermDeleteMutation = trpc.intermediateSales.delete.useMutation({
    onSuccess: () => { utils.intermediateSales.listByDate.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const intermTotal = (intermQuery.data ?? []).reduce((s, i) => s + parseFloat(i.amount?.toString() ?? "0"), 0);

  // ─── 매입 입력 ─────────────────────────────────────────────────────────
  const now = new Date();
  const [purchaseYear, setPurchaseYear] = useState(now.getFullYear());
  const [purchaseMonth, setPurchaseMonth] = useState(now.getMonth() + 1);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [quickPurchaseMode, setQuickPurchaseMode] = useState(false);
  const [quickCpId, setQuickCpId] = useState<number | null>(null);
  const [quickAmount, setQuickAmount] = useState("");
  const [quickStatus, setQuickStatus] = useState<"received" | "ordered">("received");
  const [quickNote, setQuickNote] = useState("");
  const [quickAttachmentUrl, setQuickAttachmentUrl] = useState("");
  const [quickUploading, setQuickUploading] = useState(false);
  const quickFileRef = useRef<HTMLInputElement>(null);
  const [selectedCounterpartyId, setSelectedCounterpartyId] = useState<number | null>(null);
  const [orderDate, setOrderDate] = useState(todayStr);
  const [orderNote, setOrderNote] = useState("");
  const [orderStatus, setOrderStatus] = useState<"received" | "ordered">("received");
  const [orderLines, setOrderLines] = useState<OrderLine[]>([newLine()]);
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showNewCounterparty, setShowNewCounterparty] = useState(false);
  const [newCpName, setNewCpName] = useState("");
  const [newCpType, setNewCpType] = useState<"supplier" | "online" | "mart" | "repair" | "other">("supplier");
  const ordersQuery = trpc.purchasesV2.listOrdersByMonth.useQuery({ restaurantId: rId!, year: purchaseYear, month: purchaseMonth }, { enabled: !!rId });
  const counterpartiesQuery = trpc.counterparties.list.useQuery({ restaurantId: rId! }, { enabled: !!rId });
  const recentOrdersQuery = trpc.purchasesV2.getRecentOrdersByCounterparty.useQuery(
    { restaurantId: rId!, counterpartyId: selectedCounterpartyId!, limit: 5 },
    { enabled: !!rId && !!selectedCounterpartyId }
  );
  const cpItemsQuery = trpc.counterpartyItems.listByCounterparty.useQuery({ counterpartyId: selectedCounterpartyId! }, { enabled: !!selectedCounterpartyId });
  const createOrderMutation = trpc.purchasesV2.createOrder.useMutation({
    onSuccess: () => { toast.success("매입이 저장되었습니다."); utils.purchasesV2.listOrdersByMonth.invalidate(); resetOrderForm(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteOrderMutation = trpc.purchasesV2.deleteOrder.useMutation({
    onSuccess: () => { toast.success("삭제되었습니다."); utils.purchasesV2.listOrdersByMonth.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const createCounterpartyMutation = trpc.counterparties.create.useMutation({
    onSuccess: (data) => { toast.success("거래처가 추가되었습니다."); utils.counterparties.list.invalidate(); setSelectedCounterpartyId(data.id); setShowNewCounterparty(false); setNewCpName(""); },
    onError: (e) => toast.error(e.message),
  });
  function resetOrderForm() {
    setShowOrderForm(false); setSelectedCounterpartyId(null); setOrderDate(todayStr);
    setOrderNote(""); setOrderStatus("received"); setOrderLines([newLine()]); setAttachmentUrl("");
  }
  function updateLine(id: string, patch: Partial<OrderLine>) {
    setOrderLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      const updated = { ...l, ...patch };
      const qty = parseFloat(updated.quantity) || 0;
      const price = parseFloat(updated.unitPrice) || 0;
      const total = parseFloat(updated.lineTotal) || 0;
      if ("quantity" in patch || "unitPrice" in patch) { if (qty > 0 && price > 0) updated.lineTotal = String(Math.round(qty * price)); }
      else if ("lineTotal" in patch) { if (qty > 0 && total > 0) updated.unitPrice = String(Math.round(total / qty)); }
      return updated;
    }));
  }
  function removeLine(id: string) { setOrderLines(prev => prev.length > 1 ? prev.filter(l => l.id !== id) : prev); }
  function selectCpItem(lineId: string, ci: CpItem) {
    updateLine(lineId, { counterpartyItemId: ci.id, itemId: ci.itemId, rawItemName: ci.supplierItemName || ci.itemName || "", unitName: ci.purchaseUnit || ci.baseUnit || "", unitPrice: ci.lastPrice ?? ci.defaultPrice ?? "", category: (ci.costingCategory as PurchaseCategory) || "food" });
  }
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const { url } = await res.json();
      setAttachmentUrl(url);
      toast.success("영수증이 첨부되었습니다.");
    } catch { toast.error("업로드 실패"); }
    finally { setUploading(false); }
  }
  function handleSubmitOrder() {
    if (!rId) return;
    const validLines = orderLines.filter(l => l.rawItemName.trim() && l.lineTotal);
    if (validLines.length === 0) { toast.error("항목을 1개 이상 입력하세요."); return; }
    createOrderMutation.mutate({
      restaurantId: rId, counterpartyId: selectedCounterpartyId ?? undefined,
      purchaseDate: orderDate, status: orderStatus, note: orderNote, attachmentUrl: attachmentUrl || undefined,
      items: validLines.map(l => ({ itemId: l.itemId, counterpartyItemId: l.counterpartyItemId, rawItemName: l.rawItemName, itemType: "product" as const, quantity: l.quantity || undefined, unitName: l.unitName || undefined, unitPrice: l.unitPrice || undefined, lineTotal: l.lineTotal, costingCategory: l.category || undefined, note: l.note || undefined })),
    });
  }
  const orderTotalAmount = orderLines.reduce((s, l) => s + (parseFloat(l.lineTotal) || 0), 0);
  const monthlyTotal = (ordersQuery.data ?? []).reduce((s, o) => s + parseFloat(String(o.totalAmount) || "0"), 0);
  const selectedCp = counterpartiesQuery.data?.find(c => c.id === selectedCounterpartyId);

  // ─── 일마감 ────────────────────────────────────────────────────────────
  const [closingStep, setClosingStep] = useState(1);
  const [salesBreakdown, setSalesBreakdown] = useState<Array<{ typeName: string; amount: number }>>([]);
  const [salesSpecials, setSalesSpecials] = useState<Array<{ typeName: string; amount: number; note?: string }>>([]);
  const [purchaseNote, setPurchaseNote] = useState("");
  const [orderCheckPhotoUrl, setOrderCheckPhotoUrl] = useState("");
  const [orderCheckNoOrder, setOrderCheckNoOrder] = useState(false);
  const [tomorrowScheduleConfirmed, setTomorrowScheduleConfirmed] = useState(false);
  const [scheduleNote, setScheduleNote] = useState("");
  const [closingNote, setClosingNote] = useState("");
  const salesTypesQuery = trpc.dailyClosings.getSalesTypes.useQuery({ restaurantId: rId! }, { enabled: !!rId });
  const specialTypesQuery = trpc.dailyClosings.getSpecialTypes.useQuery({ restaurantId: rId! }, { enabled: !!rId });
  const closingDetailQuery = trpc.dailyClosings.getDetail.useQuery({ restaurantId: rId!, date: todayStr }, { enabled: !!rId });
  const profitabilityQuery = trpc.profitability.daily.useQuery({ restaurantId: rId!, date: todayStr }, { enabled: !!rId });
  const existingClosingQuery = trpc.dailyClosings.get.useQuery({ restaurantId: rId!, date: todayStr }, { enabled: !!rId });
  const addSalesTypeMutation = trpc.dailyClosings.addSalesType.useMutation({ onSuccess: () => utils.dailyClosings.getSalesTypes.invalidate() });
  const addSpecialTypeMutation = trpc.dailyClosings.addSpecialType.useMutation({ onSuccess: () => utils.dailyClosings.getSpecialTypes.invalidate() });
  const closeMutation = trpc.dailyClosings.close.useMutation({
    onSuccess: () => {
      toast.success("일마감이 완료되었습니다.");
      utils.dailyClosings.get.invalidate();
      utils.dailyClosings.listByMonth.invalidate();
      setClosingStep(1);
    },
    onError: (e) => toast.error(e.message),
  });
  const salesTypes = salesTypesQuery.data ?? [];
  const specialTypes = specialTypesQuery.data ?? [];
  const closingDetail = closingDetailQuery.data;
  const laborCost = profitabilityQuery.data?.laborCost ?? 0;
  const purchaseTotal = (closingDetail?.purchaseOrderList ?? []).reduce((s: number, o: any) => s + parseFloat(o.totalAmount ?? "0"), 0)
    + (closingDetail?.purchaseList ?? []).reduce((s: number, p: any) => s + parseFloat(p.cost ?? "0"), 0);
  function handleClose() {
    if (!rId) return;
    // 중간 매출을 salesBreakdown에 추가하여 합산
    const finalBreakdown = [...salesBreakdown.filter(i => i.amount > 0)];
    if (intermTotal > 0) {
      finalBreakdown.push({ typeName: "중간 매출", amount: intermTotal });
    }
    closeMutation.mutate({ restaurantId: rId, date: todayStr, salesBreakdown: finalBreakdown, salesSpecials: salesSpecials.filter(i => i.amount > 0 || (i.note && i.note.trim())), tomorrowScheduleConfirmed, scheduleNote: scheduleNote || undefined, purchaseNote: purchaseNote || undefined, note: closingNote || undefined, orderCheckPhotoUrl: orderCheckPhotoUrl || undefined, orderCheckNoOrder });
  }
  const canProceedClosing = () => {
    if (closingStep === 1) return salesBreakdown.some(i => i.amount > 0) || intermTotal > 0;
    if (closingStep === 2) return !!(orderCheckPhotoUrl || orderCheckNoOrder);
    return true;
  };

  if (!rId) {
    return (
      <AppLayout title="일일 운영">
        <div className="p-8 text-center text-muted-foreground">
          <AlertCircle className="mx-auto mb-2 h-8 w-8" />
          매장을 선택해 주세요.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="일일 운영" subtitle={selectedRestaurant?.name}>
    <div className="p-4 lg:p-6 max-w-3xl mx-auto space-y-4">
      {/* 헤더 - 날짜 선택 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{selectedRestaurant?.name}</p>
        </div>
        <Input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)} className="w-40 shrink-0" />
      </div>

      {/* 탭 */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="open" className="text-xs gap-1.5">
            <Sunrise className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">오픈</span>
            <span className="sm:hidden">오픈</span>
          </TabsTrigger>
          <TabsTrigger value="purchases" className="text-xs gap-1.5">
            <ShoppingCart className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">매입 입력</span>
            <span className="sm:hidden">매입</span>
          </TabsTrigger>
          <TabsTrigger value="interim" className="text-xs gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">중간매출 & 발주확인</span>
            <span className="sm:hidden">중간</span>
          </TabsTrigger>
          <TabsTrigger value="closing" className="text-xs gap-1.5">
            <LockKeyhole className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">일마감</span>
            <span className="sm:hidden">마감</span>
          </TabsTrigger>
        </TabsList>

        {/* ─── 탭 1: 오픈 ─── */}
        <TabsContent value="open" className="space-y-4 mt-4">
          {/* 오픈 체크 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sunrise className="h-4 w-4 text-amber-400" />
                오픈 체크
                {todayOps?.openCheckedAt && (
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30 ml-auto">
                    <CheckCircle2 className="h-3 w-3 mr-1" />완료
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {todayOps?.openCheckedAt ? (
                <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-sm text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="font-medium">오픈 체크 완료</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {new Date(todayOps.openCheckedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground pl-6">
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" />출근 {todayOps.openHeadcount}명</span>
                    <span className="flex items-center gap-1"><Banknote className="h-3 w-3" />예상 인건비 {fmt(todayOps.openLaborCost)}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">아직 오픈 체크가 완료되지 않았습니다.</p>
              )}
              <Button
                size="sm"
                className="w-full"
                onClick={() => openCheckMutation.mutate({ restaurantId: rId })}
                disabled={openCheckMutation.isPending}
              >
                <Sunrise className="h-4 w-4 mr-2" />
                {todayOps?.openCheckedAt ? "오픈 체크 재확인" : "오픈 체크 시작"}
              </Button>
            </CardContent>
          </Card>

          {/* 오픈 체크리스트 */}
          <DailyChecklistCard restaurantId={rId} checkType="open" todayStr={todayStr} />

          {/* 금일 출근 인원 확인 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-400" />
                금일 출근 인원 ({todaySchedules.length}명)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {todaySchedules.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">오늘 등록된 스케줄이 없습니다.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {todaySchedules.map((s: any) => (
                    <div key={s.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5">
                      <div>
                        <p className="text-sm font-medium">{s.userName ?? s.tempWorkerName ?? "미지정"}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.startTime ? s.startTime.slice(0, 5) : "-"} ~ {s.endTime ? s.endTime.slice(0, 5) : "-"}
                        </p>
                      </div>
                      <Badge
                        variant={s.status === "confirmed" ? "default" : s.status === "published" ? "secondary" : "outline"}
                        className="text-xs"
                      >
                        {s.status === "confirmed" ? "확정" : s.status === "published" ? "발행" : "임시"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 전날 마감 내용 확인 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4 text-purple-400" />
                전날 마감 내용 ({yesterdayStr})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {yesterdayClosingQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">불러오는 중...</p>
              ) : !yesterdayClosing ? (
                <div className="text-center py-6 text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">전날 마감 내용이 없습니다.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3">
                      <p className="text-xs text-muted-foreground mb-1">전날 총 매출</p>
                      <p className="text-lg font-bold text-emerald-400">{fmt(yesterdayClosing.salesTotal)}</p>
                    </div>
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
                      <p className="text-xs text-muted-foreground mb-1">전날 매입</p>
                      <p className="text-lg font-bold text-amber-400">{fmt(yesterdayClosing.purchasesTotal)}</p>
                    </div>
                  </div>
                  {yesterdayClosing.note && (
                    <div className="rounded-lg bg-muted/40 p-3">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">마감 메모</p>
                      <p className="text-sm">{yesterdayClosing.note}</p>
                    </div>
                  )}
                  {yesterdayClosing.salesBreakdown && Array.isArray(yesterdayClosing.salesBreakdown) && yesterdayClosing.salesBreakdown.length > 0 && (
                    <div className="rounded-lg bg-muted/40 p-3">
                      <p className="text-xs font-semibold text-muted-foreground mb-2">매출 내역</p>
                      <div className="space-y-1">
                        {(yesterdayClosing.salesBreakdown as Array<{typeName: string; amount: number}>).map((item) => (
                          <div key={item.typeName} className="flex justify-between text-xs">
                            <span className="text-muted-foreground">{item.typeName}</span>
                            <span className="font-medium">{fmt(item.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    마감 시각: {yesterdayClosing.closedAt ? new Date(yesterdayClosing.closedAt).toLocaleString("ko-KR") : "-"}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── 탭 2: 매입 입력 ─── */}
        <TabsContent value="purchases" className="space-y-4 mt-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-2">
              <Select value={String(purchaseYear)} onValueChange={v => setPurchaseYear(Number(v))}>
                <SelectTrigger className="w-24 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{[2024, 2025, 2026].map(y => <SelectItem key={y} value={String(y)}>{y}년</SelectItem>)}</SelectContent>
              </Select>
              <Select value={String(purchaseMonth)} onValueChange={v => setPurchaseMonth(Number(v))}>
                <SelectTrigger className="w-20 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{Array.from({ length: 12 }, (_, i) => i + 1).map(m => <SelectItem key={m} value={String(m)}>{m}월</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="quick-mode"
                  checked={quickPurchaseMode}
                  onCheckedChange={setQuickPurchaseMode}
                  className="scale-90"
                />
                <Label htmlFor="quick-mode" className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap">간편 입력</Label>
              </div>
              <Button size="sm" className="gap-1.5 h-8" onClick={() => setShowOrderForm(true)}>
                <Plus className="h-3.5 w-3.5" />매입 입력
              </Button>
            </div>
          </div>
          {/* ─── 간편 매입 입력 폼 ─── */}
          {quickPurchaseMode && (
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  간편 매입 입력
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">거래처</Label>
                    <div className="flex gap-1">
                      <Select value={quickCpId ? String(quickCpId) : ""} onValueChange={v => setQuickCpId(Number(v))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="거래처 선택" /></SelectTrigger>
                        <SelectContent>
                          {counterpartiesQuery.data?.map(cp => (
                            <SelectItem key={cp.id} value={String(cp.id)}>{cp.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">전체 금액</Label>
                    <div className="relative">
                      <Input
                        type="number"
                        placeholder="금액"
                        value={quickAmount}
                        onChange={e => setQuickAmount(e.target.value)}
                        className="h-8 text-xs pr-6"
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">원</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">입고/발주 상태</Label>
                    <Select value={quickStatus} onValueChange={v => setQuickStatus(v as "received" | "ordered")}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="received">✅ 입고 완료</SelectItem>
                        <SelectItem value="ordered">📦 발주 중</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">메모</Label>
                    <Input
                      placeholder="메모 (선택)"
                      value={quickNote}
                      onChange={e => setQuickNote(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Label className="text-xs">영수증 첨부</Label>
                    <div className="flex gap-2 items-center mt-1">
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => quickFileRef.current?.click()} disabled={quickUploading}>
                        <Image className="w-3 h-3" />{quickUploading ? "업로드 중..." : quickAttachmentUrl ? "변경" : "첨부"}
                      </Button>
                      {quickAttachmentUrl && <a href={quickAttachmentUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">보기</a>}
                    </div>
                    <input ref={quickFileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0]; if (!file || !rId) return;
                      setQuickUploading(true);
                      try {
                        const formData = new FormData(); formData.append("file", file);
                        const res = await fetch("/api/upload", { method: "POST", body: formData });
                        const data = await res.json();
                        if (data.url) setQuickAttachmentUrl(data.url);
                      } catch { toast.error("업로드 실패"); } finally { setQuickUploading(false); }
                    }} />
                  </div>
                  <Button
                    size="sm"
                    className="mt-4 gap-1.5"
                    disabled={!quickAmount || createOrderMutation.isPending}
                    onClick={() => {
                      if (!rId || !quickAmount) return;
                      createOrderMutation.mutate({
                        restaurantId: rId,
                        counterpartyId: quickCpId ?? undefined,
                        purchaseDate: todayStr,
                        status: quickStatus,
                        note: quickNote || undefined,
                        attachmentUrl: quickAttachmentUrl || undefined,
                        items: [{ rawItemName: quickCpId ? (counterpartiesQuery.data?.find(c => c.id === quickCpId)?.name ?? "간편매입") : "간편매입", itemType: "product" as const, lineTotal: quickAmount }],
                      }, {
                        onSuccess: () => {
                          toast.success("간편 매입이 저장되었습니다.");
                          setQuickAmount(""); setQuickNote(""); setQuickAttachmentUrl(""); setQuickCpId(null); setQuickStatus("received");
                        },
                      });
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />저장
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-3 flex items-center gap-3">
                <Package className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">이번 달 매입 합계</p>
                  <p className="text-lg font-bold">{fmt(monthlyTotal)}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 flex items-center gap-3">
                <Building2 className="w-5 h-5 text-blue-500" />
                <div>
                  <p className="text-xs text-muted-foreground">전표 수</p>
                  <p className="text-lg font-bold">{ordersQuery.data?.length ?? 0}건</p>
                </div>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">매입 내역</CardTitle></CardHeader>
            <CardContent className="p-0">
              {ordersQuery.isLoading ? (
                <div className="p-6 text-center text-muted-foreground text-sm">불러오는 중...</div>
              ) : !ordersQuery.data?.length ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />이번 달 매입 내역이 없습니다.
                </div>
              ) : (
                <div className="divide-y">
                  {ordersQuery.data.map(order => (
                    <OrderRow key={order.id} order={order} isManager={isManager} onDelete={() => deleteOrderMutation.mutate({ id: order.id })} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── 탭 3: 중간 매출 ─── */}
        <TabsContent value="interim" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-400" />
                중간 매출 입력
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">영업 중 수시로 매출을 기록합니다. 입력한 중간 매출은 일마감 시 자동으로 합산됩니다.</p>

              {/* 입력 폼 */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type="number"
                    placeholder="금액 입력"
                    value={intermAmount}
                    onChange={e => setIntermAmount(e.target.value)}
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">원</span>
                </div>
                <Input
                  placeholder="메모 (선택)"
                  value={intermNote}
                  onChange={e => setIntermNote(e.target.value)}
                  className="flex-1"
                />
                <Button
                  onClick={() => {
                    if (!rId || !intermAmount) return;
                    intermCreateMutation.mutate({ restaurantId: rId, saleDate, amount: parseFloat(intermAmount), note: intermNote || undefined });
                  }}
                  disabled={intermCreateMutation.isPending || !intermAmount}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {/* 입력된 중간 매출 목록 */}
              {(intermQuery.data ?? []).length > 0 ? (
                <div className="space-y-2">
                  {(intermQuery.data ?? []).map(item => (
                    <div key={item.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5">
                      <div>
                        <span className="font-semibold text-sm">{fmt(item.amount)}</span>
                        {item.note && <span className="ml-2 text-xs text-muted-foreground">{item.note}</span>}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {new Date(item.recordedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      {isManager && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => intermDeleteMutation.mutate({ id: item.id })}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 flex justify-between items-center mt-2">
                    <span className="text-sm font-semibold text-blue-400">중간 매출 합계</span>
                    <span className="text-lg font-bold text-blue-400">{fmt(intermTotal)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">일마감 시 위 금액이 자동으로 합산됩니다.</p>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">아직 입력된 중간 매출이 없습니다.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── 탭 4: 일마감 ─── */}
        <TabsContent value="closing" className="space-y-4 mt-4">
          {/* 스텝 인디케이터 */}
          <div className="flex items-center justify-center gap-1">
            {CLOSING_STEPS.map((s, idx) => {
              const Icon = s.icon;
              const isDone = closingStep > s.id;
              const isCurrent = closingStep === s.id;
              return (
                <div key={s.id} className="flex items-center gap-1 flex-1">
                  <button onClick={() => isDone && setClosingStep(s.id)}
                    className={cn("flex flex-col items-center gap-1 flex-1 py-2 rounded-lg transition-colors", isCurrent ? "bg-blue-600/20 text-blue-400" : isDone ? "text-emerald-400 cursor-pointer" : "text-muted-foreground")}>
                    <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold", isCurrent ? "bg-blue-600 text-white" : isDone ? "bg-emerald-600 text-white" : "bg-muted")}>
                      {isDone ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-3.5 w-3.5" />}
                    </div>
                    <span className="text-[10px] hidden sm:block">{s.label}</span>
                  </button>
                  {idx < CLOSING_STEPS.length - 1 && <div className={cn("h-0.5 w-3 rounded shrink-0", closingStep > s.id ? "bg-emerald-500" : "bg-muted")} />}
                </div>
              );
            })}
          </div>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                {(() => { const Icon = CLOSING_STEPS[closingStep - 1].icon; return <Icon className="h-4 w-4" />; })()}
                {CLOSING_STEPS[closingStep - 1].label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {closingStep === 1 && <SalesStep salesTypes={salesTypes} salesBreakdown={salesBreakdown} setSalesBreakdown={setSalesBreakdown} onAddType={name => rId && addSalesTypeMutation.mutate({ restaurantId: rId, typeName: name })} intermTotal={intermTotal} />}
              {closingStep === 2 && (
                <div className="space-y-5">
                  <OrderCheckStep orderCheckPhotoUrl={orderCheckPhotoUrl} setOrderCheckPhotoUrl={setOrderCheckPhotoUrl} orderCheckNoOrder={orderCheckNoOrder} setOrderCheckNoOrder={setOrderCheckNoOrder} />
                  <DailyChecklistCard restaurantId={rId} checkType="order" todayStr={todayStr} noOrderToday={orderCheckNoOrder} />
                </div>
              )}
              {closingStep === 3 && <SpecialsStep specialTypes={specialTypes} salesSpecials={salesSpecials} setSalesSpecials={setSalesSpecials} onAddType={name => rId && addSpecialTypeMutation.mutate({ restaurantId: rId, typeName: name })} />}
              {closingStep === 4 && <PurchaseCheckStep detail={closingDetail} purchaseNote={purchaseNote} setPurchaseNote={setPurchaseNote} />}
              {closingStep === 5 && rId && <ScheduleCheckStep restaurantId={rId} todayStr={todayStr} tomorrowScheduleConfirmed={tomorrowScheduleConfirmed} setTomorrowScheduleConfirmed={setTomorrowScheduleConfirmed} scheduleNote={scheduleNote} setScheduleNote={setScheduleNote} laborCost={laborCost} />}
              {closingStep === 6 && <DailyChecklistCard restaurantId={rId} checkType="cleaning" todayStr={todayStr} />}
              {closingStep === 7 && <ConfirmClosingStep salesBreakdown={salesBreakdown} salesSpecials={salesSpecials} purchaseNote={purchaseNote} tomorrowScheduleConfirmed={tomorrowScheduleConfirmed} scheduleNote={scheduleNote} note={closingNote} setNote={setClosingNote} laborCost={laborCost} purchaseTotal={purchaseTotal} existingClosing={existingClosingQuery.data} intermTotal={intermTotal} />}
            </CardContent>
          </Card>
          <div className="flex gap-3">
            {closingStep > 1 ? (
              <Button variant="outline" onClick={() => setClosingStep(s => s - 1)} className="gap-1.5">
                <ChevronDown className="h-4 w-4 rotate-90" />이전
              </Button>
            ) : null}
            <div className="flex-1" />
            {closingStep < 7 ? (
              <Button onClick={() => setClosingStep(s => s + 1)} disabled={!canProceedClosing()} className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
                다음<ChevronDown className="h-4 w-4 -rotate-90" />
              </Button>
            ) : (
              <Button onClick={handleClose} disabled={closeMutation.isPending} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
                <LockKeyhole className="h-4 w-4" />{closeMutation.isPending ? "마감 중..." : "일마감 확정"}
              </Button>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ─── 매입 입력 다이얼로그 ─── */}
      <Dialog open={showOrderForm} onOpenChange={v => { if (!v) resetOrderForm(); }}>
        <DialogContent className="max-w-2xl max-h-[95vh] overflow-y-auto p-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b"><DialogTitle>매입 입력</DialogTitle></DialogHeader>
          <div className="px-5 py-4 space-y-5">
            <section className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">기본 정보</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>날짜</Label>
                  <Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>상태</Label>
                  <Select value={orderStatus} onValueChange={v => setOrderStatus(v as "received" | "ordered")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="received">✅ 입고 완료</SelectItem>
                      <SelectItem value="ordered">📦 발주 중</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>거래처</Label>
                <div className="flex gap-2">
                  <Select value={selectedCounterpartyId ? String(selectedCounterpartyId) : ""} onValueChange={v => setSelectedCounterpartyId(Number(v))}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="거래처 선택 (선택사항)" /></SelectTrigger>
                    <SelectContent>
                      {counterpartiesQuery.data?.map(cp => (
                        <SelectItem key={cp.id} value={String(cp.id)}>
                          <span className="font-medium">{cp.name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{COUNTERPARTY_TYPE_LABELS[cp.counterpartyType]}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" onClick={() => setShowNewCounterparty(true)} title="신규 거래처 추가"><Plus className="w-4 h-4" /></Button>
                </div>
              </div>
            </section>
            {selectedCounterpartyId && recentOrdersQuery.data?.length ? (
              <section className="rounded-xl border bg-muted/30 p-4 space-y-3">
                <p className="text-sm font-semibold flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" />{selectedCp?.name} — 최근 전표 복제</p>
                <div className="flex flex-wrap gap-2">
                  {recentOrdersQuery.data.map(o => (
                    <button key={o.id} onClick={() => { setOrderDate(todayStr); setOrderNote(o.note || ""); toast.info("최근 전표를 불러왔습니다."); }}
                      className="text-xs px-3 py-1.5 rounded-lg border bg-background hover:bg-accent transition-colors">
                      <Copy className="w-3 h-3 inline mr-1" />{new Date(o.purchaseDate!).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} — {fmt(parseFloat(String(o.totalAmount)))}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">항목</p>
                <Button variant="outline" size="sm" onClick={() => setOrderLines(prev => [...prev, newLine()])} className="gap-1.5 h-7 text-xs"><Plus className="w-3 h-3" />항목 추가</Button>
              </div>
              <div className="space-y-3">
                {orderLines.map((line, idx) => (
                  <OrderLineCard key={line.id} line={line} index={idx} cpItems={cpItemsQuery.data ?? []} restaurantId={rId ?? 0} onChange={(patch) => updateLine(line.id, patch)} onRemove={() => removeLine(line.id)} onSelectCpItem={(ci) => selectCpItem(line.id, ci)} canRemove={orderLines.length > 1} />
                ))}
              </div>
              <div className="flex justify-between items-center pt-2 border-t">
                <span className="text-sm text-muted-foreground">합계</span>
                <span className="text-xl font-bold text-primary">{fmt(orderTotalAmount)}</span>
              </div>
            </section>
            <section className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">추가 정보</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>메모</Label>
                  <Input placeholder="메모 (선택)" value={orderNote} onChange={e => setOrderNote(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>영수증 첨부</Label>
                  <div className="flex gap-2 items-center">
                    <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-1.5">
                      <Image className="w-4 h-4" />{uploading ? "업로드 중..." : attachmentUrl ? "변경" : "첨부"}
                    </Button>
                    {attachmentUrl && <a href={attachmentUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">보기</a>}
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                </div>
              </div>
            </section>
          </div>
          <DialogFooter className="px-5 py-4 border-t gap-2">
            <Button variant="outline" onClick={resetOrderForm} className="flex-1 sm:flex-none">취소</Button>
            <Button onClick={handleSubmitOrder} disabled={createOrderMutation.isPending} className="flex-1 sm:flex-none">
              {createOrderMutation.isPending ? "저장 중..." : "매입 저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 신규 거래처 다이얼로그 */}
      <Dialog open={showNewCounterparty} onOpenChange={setShowNewCounterparty}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>신규 거래처 추가</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>거래처명</Label><Input value={newCpName} onChange={e => setNewCpName(e.target.value)} placeholder="거래처명 입력" /></div>
            <div className="space-y-1.5">
              <Label>유형</Label>
              <Select value={newCpType} onValueChange={v => setNewCpType(v as typeof newCpType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(COUNTERPARTY_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewCounterparty(false)}>취소</Button>
            <Button disabled={!newCpName.trim() || createCounterpartyMutation.isPending}
              onClick={() => { if (!rId) return; createCounterpartyMutation.mutate({ restaurantId: rId, name: newCpName.trim(), counterpartyType: newCpType }); }}>
              추가
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </AppLayout>
  );
}
