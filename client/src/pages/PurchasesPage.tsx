import { useState, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { todayKST } from "@/lib/dateKST";
import { useRestaurant } from "@/contexts/RestaurantContext";
import AppLayout from "@/components/AppLayout";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MonthNavigator } from "@/components/MonthNavigator";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Plus, Trash2, Image, Package, ChevronDown, ChevronUp,
  Building2, Copy, X, TrendingDown, Pencil
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getEffectiveRole, isManagerLevel } from "@shared/permissions";

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
function fmt(n: number) { return n.toLocaleString("ko-KR") + "원"; }
function fmtDate(d: string | Date) {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

// ─── 상수 ─────────────────────────────────────────────────────────────────────
/** 유형+원가분류 통합 카테고리 */
const PURCHASE_CATEGORIES = [
  { value: "food",    label: "식재료",  color: "bg-green-500/10 text-green-700 dark:text-green-400" },
  { value: "supply",  label: "소모품",  color: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  { value: "utility", label: "공과금",  color: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" },
  { value: "labor",   label: "인건비",  color: "bg-purple-500/10 text-purple-700 dark:text-purple-400" },
  { value: "other",   label: "기타",    color: "bg-gray-500/10 text-gray-600 dark:text-gray-400" },
] as const;

type PurchaseCategory = typeof PURCHASE_CATEGORIES[number]["value"];

/** 단위 목록 — KG는 소수점 허용, 나머지는 정수 */
const UNITS: { value: string; label: string; decimal: boolean }[] = [
  { value: "kg",   label: "kg",   decimal: true  },
  { value: "g",    label: "g",    decimal: false },
  { value: "L",    label: "L",    decimal: true  },
  { value: "mL",   label: "mL",   decimal: false },
  { value: "개",   label: "개",   decimal: false },
  { value: "박스", label: "박스", decimal: false },
  { value: "봉",   label: "봉",   decimal: false },
  { value: "팩",   label: "팩",   decimal: false },
  { value: "병",   label: "병",   decimal: false },
  { value: "캔",   label: "캔",   decimal: false },
  { value: "장",   label: "장",   decimal: false },
  { value: "묶음", label: "묶음", decimal: false },
  { value: "포",   label: "포",   decimal: false },
  { value: "롤",   label: "롤",   decimal: false },
];

const COUNTERPARTY_TYPE_LABELS: Record<string, string> = {
  supplier: "공급업체", online: "온라인", mart: "마트", repair: "수리", other: "기타"
};

// ─── 타입 ─────────────────────────────────────────────────────────────────────
type OrderLine = {
  id: string;
  itemId?: number;
  counterpartyItemId?: number;
  rawItemName: string;
  category: PurchaseCategory;
  quantity: string;
  unitName: string;
  unitPrice: string;
  lineTotal: string;
  note: string;
  priceComparison?: { counterpartyName: string; lastPrice: string | null; purchaseUnit: string | null }[];
};

type CpItem = {
  id: number; counterpartyId: number; itemId: number; itemName: string;
  itemType: "product" | "service" | "misc";
  supplierItemName: string | null; purchaseUnit: string | null;
  conversionToBase: string | null; decimalAllowed: boolean;
  quantityStep: string | null; defaultPrice: string | null;
  lastPrice: string | null; isPreferred: boolean;
  costingCategory: string | null; baseUnit: string | null;
};

function newLine(): OrderLine {
  return {
    id: Math.random().toString(36).slice(2),
    rawItemName: "", category: "food",
    quantity: "", unitName: "", unitPrice: "", lineTotal: "", note: "",
  };
}

// ─// ─── 메인 컴포넌트 ────────────────────────────────────────────────────
export default function PurchasesPage() {
  const { selectedRestaurantId } = useRestaurant();
  const rId = selectedRestaurantId;
  const { user } = useAuth();
  // 매장 내 역할 조회 (시스템 역할이 employee이지만 해당 매장에서 store_manager인 경우 반영)
  const storeRoleQuery = trpc.restaurants.getMyStoreRole.useQuery(
    { restaurantId: rId! },
    { enabled: !!rId && (user?.role === "employee" || user?.role === "user") }
  );
  const storeRole = storeRoleQuery.data;
  const effectiveRole = getEffectiveRole(user?.role ?? "employee", storeRole);
  const isManager = isManagerLevel(effectiveRole);

  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const handleMonthChange = (y: number, m: number) => { setYear(y); setMonth(m); };

  // 전표 입력 상태
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [selectedCounterpartyId, setSelectedCounterpartyId] = useState<number | null>(null);
  const [orderDate, setOrderDate] = useState(todayKST());
  const [orderNote, setOrderNote] = useState("");
  const [orderStatus, setOrderStatus] = useState<"received" | "ordered">("received");
  const [orderLines, setOrderLines] = useState<OrderLine[]>([newLine()]);
  const [uploading, setUploading] = useState(false);
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // 신규 거래처 추가 상태
  const [showNewCounterparty, setShowNewCounterparty] = useState(false);
  const [newCpName, setNewCpName] = useState("");
  const [newCpType, setNewCpType] = useState<"supplier" | "online" | "mart" | "repair" | "other">("supplier");

  const utils = trpc.useUtils();

  // ─── 쿼리 ──────────────────────────────────────────────────────────────────
  const counterpartiesQuery = trpc.counterparties.list.useQuery(
    { restaurantId: rId! }, { enabled: !!rId }
  );
  const ordersQuery = trpc.purchasesV2.listOrdersByMonth.useQuery(
    { restaurantId: rId!, year, month }, { enabled: !!rId }
  );
  const recentOrdersQuery = trpc.purchasesV2.getRecentOrdersByCounterparty.useQuery(
    { restaurantId: rId!, counterpartyId: selectedCounterpartyId!, limit: 5 },
    { enabled: !!rId && !!selectedCounterpartyId }
  );
  const cpItemsQuery = trpc.counterpartyItems.listByCounterparty.useQuery(
    { counterpartyId: selectedCounterpartyId! },
    { enabled: !!selectedCounterpartyId }
  );

  // ─── 뮤테이션 ──────────────────────────────────────────────────────────────
  const createOrderMutation = trpc.purchasesV2.createOrder.useMutation({
    onSuccess: () => {
      toast.success("매입이 저장되었습니다.");
      utils.purchasesV2.listOrdersByMonth.invalidate();
      resetForm();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteOrderMutation = trpc.purchasesV2.deleteOrder.useMutation({
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      utils.purchasesV2.listOrdersByMonth.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const createCounterpartyMutation = trpc.counterparties.create.useMutation({
    onSuccess: (data) => {
      toast.success("거래처가 추가되었습니다.");
      utils.counterparties.list.invalidate();
      setSelectedCounterpartyId(data.id);
      setShowNewCounterparty(false);
      setNewCpName("");
    },
    onError: (e) => toast.error(e.message),
  });

  function resetForm() {
    setShowOrderForm(false);
    setSelectedCounterpartyId(null);
    setOrderDate(todayKST());
    setOrderNote("");
    setOrderStatus("received");
    setOrderLines([newLine()]);
    setAttachmentUrl("");
  }

  // ─── 행 조작 ───────────────────────────────────────────────────────────────
  function updateLine(id: string, patch: Partial<OrderLine>) {
    setOrderLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      const updated = { ...l, ...patch };
      const qty = parseFloat(updated.quantity) || 0;
      const price = parseFloat(updated.unitPrice) || 0;
      const total = parseFloat(updated.lineTotal) || 0;

      if ("quantity" in patch || "unitPrice" in patch) {
        // 수량 × 단가 → 합계
        if (qty > 0 && price > 0) updated.lineTotal = String(Math.round(qty * price));
      } else if ("lineTotal" in patch) {
        // 합계 ÷ 수량 → 단가 역산
        if (qty > 0 && total > 0) updated.unitPrice = String(Math.round(total / qty));
      }
      return updated;
    }));
  }

  function removeLine(id: string) {
    setOrderLines(prev => prev.length > 1 ? prev.filter(l => l.id !== id) : prev);
  }

  function selectCpItem(lineId: string, ci: CpItem) {
    const autoPrice = ci.lastPrice ?? ci.defaultPrice ?? "";
    const unit = ci.purchaseUnit || ci.baseUnit || "";
    updateLine(lineId, {
      counterpartyItemId: ci.id,
      itemId: ci.itemId,
      rawItemName: ci.supplierItemName || ci.itemName || "",
      unitName: unit,
      unitPrice: autoPrice ? String(autoPrice) : "",
      category: (ci.costingCategory as PurchaseCategory) || "food",
    });
  }

  function copyFromRecentOrder(order: NonNullable<typeof recentOrdersQuery.data>[number]) {
    setOrderDate(todayKST());
    setOrderNote(order.note || "");
    toast.info("최근 전표를 불러왔습니다. 항목을 확인 후 저장하세요.");
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
    } catch {
      toast.error("업로드 실패");
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit() {
    if (!rId) return;
    const validLines = orderLines.filter(l => l.rawItemName.trim() && l.lineTotal);
    if (validLines.length === 0) {
      toast.error("항목을 1개 이상 입력하세요.");
      return;
    }
    createOrderMutation.mutate({
      restaurantId: rId,
      counterpartyId: selectedCounterpartyId ?? undefined,
      purchaseDate: orderDate,
      status: orderStatus,
      note: orderNote,
      attachmentUrl: attachmentUrl || undefined,
      items: validLines.map(l => ({
        itemId: l.itemId,
        counterpartyItemId: l.counterpartyItemId,
        rawItemName: l.rawItemName,
        itemType: "product" as const,
        quantity: l.quantity || undefined,
        unitName: l.unitName || undefined,
        unitPrice: l.unitPrice || undefined,
        lineTotal: l.lineTotal,
        costingCategory: l.category || undefined,
        note: l.note || undefined,
      })),
    });
  }

  const totalAmount = orderLines.reduce((s, l) => s + (parseFloat(l.lineTotal) || 0), 0);
  const monthlyTotal = (ordersQuery.data ?? []).reduce((s, o) => s + parseFloat(String(o.totalAmount) || "0"), 0);
  const selectedCp = counterpartiesQuery.data?.find(c => c.id === selectedCounterpartyId);

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-4">
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">매입 관리</h1>
            <p className="text-sm text-muted-foreground mt-0.5">거래처별 매입 입력 및 조회</p>
          </div>
          {isManager && (
            <Button onClick={() => setShowOrderForm(true)} className="gap-2">
              <Plus className="w-4 h-4" /> 매입 입력
            </Button>
          )}
        </div>

        {/* 월 선택 + KPI */}
        <div className="flex flex-wrap items-center gap-3">
          <MonthNavigator year={year} month={month} onChange={handleMonthChange} />
          <Card className="flex-1 min-w-[160px]">
            <CardContent className="p-3 flex items-center gap-3">
              <Package className="w-5 h-5 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">이번 달 매입 합계</p>
                <p className="text-lg font-bold">{fmt(monthlyTotal)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-1 min-w-[120px]">
            <CardContent className="p-3 flex items-center gap-3">
              <Building2 className="w-5 h-5 text-blue-500" />
              <div>
                <p className="text-xs text-muted-foreground">전표 수</p>
                <p className="text-lg font-bold">{ordersQuery.data?.length ?? 0}건</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 전표 목록 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">매입 내역</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {ordersQuery.isLoading ? (
              <div className="p-6 text-center text-muted-foreground text-sm">불러오는 중...</div>
            ) : !ordersQuery.data?.length ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                이번 달 매입 내역이 없습니다.
              </div>
            ) : (
              <div className="divide-y">
                {ordersQuery.data.map(order => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    isManager={isManager}
                    onDelete={() => deleteOrderMutation.mutate({ id: order.id })}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── 매입 입력 다이얼로그 ─────────────────────────────────────────────── */}
      <Dialog open={showOrderForm} onOpenChange={v => { if (!v) resetForm(); }}>
        <DialogContent className="max-w-2xl max-h-[95vh] overflow-y-auto p-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b">
            <DialogTitle>매입 입력</DialogTitle>
          </DialogHeader>

          <div className="px-5 py-4 space-y-5">
            {/* ① 기본 정보 */}
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
                  <Select
                    value={selectedCounterpartyId ? String(selectedCounterpartyId) : ""}
                    onValueChange={v => setSelectedCounterpartyId(Number(v))}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="거래처 선택 (선택사항)" />
                    </SelectTrigger>
                    <SelectContent>
                      {counterpartiesQuery.data?.map(cp => (
                        <SelectItem key={cp.id} value={String(cp.id)}>
                          <span className="font-medium">{cp.name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {COUNTERPARTY_TYPE_LABELS[cp.counterpartyType]}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" onClick={() => setShowNewCounterparty(true)} title="신규 거래처 추가">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </section>

            {/* ② 거래처 선택 시 — 최근 내역 + 자주 구매 품목 */}
            {selectedCounterpartyId && (
              <section className="rounded-xl border bg-muted/30 p-4 space-y-3">
                <p className="text-sm font-semibold flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-primary" />
                  {selectedCp?.name} — 빠른 입력
                </p>

                {/* 최근 전표 복제 */}
                {recentOrdersQuery.data?.length ? (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">최근 전표 복제</p>
                    <div className="flex flex-wrap gap-2">
                      {recentOrdersQuery.data.map(o => (
                        <button
                          key={o.id}
                          onClick={() => copyFromRecentOrder(o)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-background text-xs hover:bg-accent transition-colors"
                        >
                          <Copy className="w-3 h-3" />
                          {fmtDate(o.purchaseDate)} · {fmt(parseFloat(String(o.totalAmount)))}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* 자주 구매 품목 */}
                {cpItemsQuery.data?.length ? (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">자주 구매하는 품목 (탭하면 추가)</p>
                    <div className="flex flex-wrap gap-2">
                      {cpItemsQuery.data.map(ci => (
                        <button
                          key={ci.id}
                          onClick={() => {
                            const lastLine = orderLines[orderLines.length - 1];
                            if (lastLine && !lastLine.rawItemName) {
                              selectCpItem(lastLine.id, ci);
                            } else {
                              const nl = newLine();
                              setOrderLines(prev => [...prev, nl]);
                              setTimeout(() => selectCpItem(nl.id, ci), 0);
                            }
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-background text-xs hover:bg-accent transition-colors"
                        >
                          <span className="font-medium">{ci.supplierItemName || ci.itemName}</span>
                          {ci.lastPrice && (
                            <span className="text-muted-foreground">
                              · {fmt(parseFloat(String(ci.lastPrice)))}/{ci.purchaseUnit || ci.baseUnit || "개"}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            )}

            {/* ③ 항목 입력 */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">항목</p>
                <Button variant="outline" size="sm" onClick={() => setOrderLines(prev => [...prev, newLine()])} className="gap-1.5 h-7 text-xs">
                  <Plus className="w-3 h-3" /> 항목 추가
                </Button>
              </div>

              <div className="space-y-3">
                {orderLines.map((line, idx) => (
                  <OrderLineCard
                    key={line.id}
                    line={line}
                    index={idx}
                    cpItems={cpItemsQuery.data ?? []}
                    restaurantId={rId ?? 0}
                    onChange={(patch) => updateLine(line.id, patch)}
                    onRemove={() => removeLine(line.id)}
                    onSelectCpItem={(ci) => selectCpItem(line.id, ci)}
                    canRemove={orderLines.length > 1}
                  />
                ))}
              </div>

              {/* 합계 */}
              <div className="flex justify-between items-center pt-2 border-t">
                <span className="text-sm text-muted-foreground">합계</span>
                <span className="text-xl font-bold text-primary">{fmt(totalAmount)}</span>
              </div>
            </section>

            {/* ④ 메모 + 영수증 */}
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
                      <Image className="w-4 h-4" />
                      {uploading ? "업로드 중..." : attachmentUrl ? "변경" : "첨부"}
                    </Button>
                    {attachmentUrl && (
                      <a href={attachmentUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
                        보기
                      </a>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                </div>
              </div>
            </section>
          </div>

          <DialogFooter className="px-5 py-4 border-t gap-2">
            <Button variant="outline" onClick={resetForm} className="flex-1 sm:flex-none">취소</Button>
            <Button onClick={handleSubmit} disabled={createOrderMutation.isPending} className="flex-1 sm:flex-none">
              {createOrderMutation.isPending ? "저장 중..." : "매입 저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 신규 거래처 추가 다이얼로그 */}
      <Dialog open={showNewCounterparty} onOpenChange={setShowNewCounterparty}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>신규 거래처 추가</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>거래처명</Label>
              <Input value={newCpName} onChange={e => setNewCpName(e.target.value)} placeholder="거래처명 입력" />
            </div>
            <div className="space-y-1.5">
              <Label>유형</Label>
              <Select value={newCpType} onValueChange={v => setNewCpType(v as typeof newCpType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(COUNTERPARTY_TYPE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewCounterparty(false)}>취소</Button>
            <Button
              disabled={!newCpName.trim() || createCounterpartyMutation.isPending}
              onClick={() => {
                if (!rId) return;
                createCounterpartyMutation.mutate({ restaurantId: rId, name: newCpName.trim(), counterpartyType: newCpType });
              }}
            >
              추가
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

// ─── 전표 행 (목록) ───────────────────────────────────────────────────────────
function OrderRow({
  order, isManager, onDelete
}: {
  order: { id: number; counterpartyName: string | null; purchaseDate: Date | null; status: string; totalAmount: string; note: string | null; createdByName: string | null; attachmentUrl?: string | null; editHistory?: Array<{userId: number; userName: string; at: string; summary: string}> | null };
  isManager: boolean;
  onDelete: () => void;
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
  const utils = trpc.useUtils();
  const updateMutation = trpc.purchasesV2.updateOrder.useMutation({
    onSuccess: () => { toast.success("전표가 수정되었습니다"); setShowEdit(false); utils.purchasesV2.listOrdersByMonth.invalidate(); },
    onError: (e) => toast.error("수정 실패: " + e.message),
  });
  const itemsQuery = trpc.purchasesV2.getOrderItems.useQuery(
    { orderId: order.id }, { enabled: expanded }
  );
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
              <span className="text-xs text-muted-foreground">
                {order.purchaseDate ? fmtDate(order.purchaseDate) : "-"}
              </span>
              {order.createdByName && (
                <span className="text-xs text-muted-foreground">{order.createdByName}</span>
              )}
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
                      <span className="font-medium truncate">{item.rawItemName || item.itemName || "-"}</span>
                      {cat && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cat.color}`}>{cat.label}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-muted-foreground">
                      {item.quantity && <span>{item.quantity}{item.unitName ? ` ${item.unitName}` : ""}</span>}
                      {item.unitPrice && <span>{fmt(parseFloat(String(item.unitPrice)))}</span>}
                      <span className="font-semibold text-foreground">{fmt(parseFloat(String(item.lineTotal)))}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">항목 없음</p>
          )}
        </div>
      )}
      <ImagePreviewModal url={previewUrl} onClose={() => setPreviewUrl(null)} />
    </div>
  );
}

// ─── 항목 입력 카드 (모바일 최적화) ──────────────────────────────────────────────────
function OrderLineCard({
  line, index, cpItems, restaurantId, onChange, onRemove, onSelectCpItem, canRemove
}: {
  line: OrderLine;
  index: number;
  cpItems: CpItem[];
  restaurantId: number;
  onChange: (patch: Partial<OrderLine>) => void;
  onRemove: () => void;
  onSelectCpItem: (ci: CpItem) => void;
  canRemove: boolean;
}) {
  const [showCpItemDropdown, setShowCpItemDropdown] = useState(false);
  const [showPriceComparison, setShowPriceComparison] = useState(false);

  const priceComparisonQuery = trpc.pricing.getRecentComparisonByItem.useQuery(
    { restaurantId, itemId: line.itemId! },
    { enabled: showPriceComparison && !!line.itemId }
  );

  const filteredCpItems = line.rawItemName
    ? cpItems.filter(ci =>
        (ci.supplierItemName || ci.itemName || "").toLowerCase().includes(line.rawItemName.toLowerCase())
      )
    : cpItems;

  // 선택된 단위가 소수점 허용 단위인지 확인
  const selectedUnit = UNITS.find(u => u.value === line.unitName);
  const isDecimalUnit = selectedUnit?.decimal ?? false;

  const catInfo = PURCHASE_CATEGORIES.find(c => c.value === line.category);

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      {/* 카드 헤더: 번호 + 카테고리 배지 + 삭제 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">항목 {index + 1}</span>
          {catInfo && (
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${catInfo.color}`}>{catInfo.label}</span>
          )}
        </div>
        {canRemove && (
          <button onClick={onRemove} className="text-muted-foreground hover:text-destructive transition-colors p-1">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 항목명 (자동완성) */}
      <div className="relative">
        <Input
          placeholder="항목명 입력"
          value={line.rawItemName}
          onChange={e => {
            onChange({ rawItemName: e.target.value, itemId: undefined, counterpartyItemId: undefined });
            setShowCpItemDropdown(true);
          }}
          onFocus={() => setShowCpItemDropdown(true)}
          onBlur={() => setTimeout(() => setShowCpItemDropdown(false), 150)}
          className="text-base"
        />
        {showCpItemDropdown && filteredCpItems.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-xl shadow-xl max-h-48 overflow-y-auto">
            {filteredCpItems.map(ci => (
              <button
                key={ci.id}
                className="w-full text-left px-4 py-3 text-sm hover:bg-accent flex items-center justify-between border-b last:border-0"
                onMouseDown={() => onSelectCpItem(ci)}
              >
                <span className="font-medium">{ci.supplierItemName || ci.itemName}</span>
                {ci.lastPrice && (
                  <span className="text-muted-foreground text-xs">{fmt(parseFloat(String(ci.lastPrice)))}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 카테고리 선택 */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">분류</Label>
        <div className="flex flex-wrap gap-2">
          {PURCHASE_CATEGORIES.map(cat => (
            <button
              key={cat.value}
              onClick={() => onChange({ category: cat.value })}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                line.category === cat.value
                  ? `${cat.color} border-current`
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* 수량 + 단위 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">수량</Label>
          <Input
            placeholder={isDecimalUnit ? "0.5" : "1"}
            value={line.quantity}
            onChange={e => onChange({ quantity: e.target.value })}
            type="number"
            min="0"
            step={isDecimalUnit ? "0.001" : "1"}
            inputMode={isDecimalUnit ? "decimal" : "numeric"}
            className="text-base"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">단위</Label>
          <Select value={line.unitName} onValueChange={v => onChange({ unitName: v })}>
            <SelectTrigger className="text-base">
              <SelectValue placeholder="단위 선택" />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map(u => (
                <SelectItem key={u.value} value={u.value}>
                  {u.label}
                  {u.decimal && <span className="text-xs text-muted-foreground ml-1">(소수점)</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 단가 + 합계 (상호 자동계산) */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">단가</Label>
          <div className="relative">
            <Input
              placeholder="단가"
              value={line.unitPrice}
              onChange={e => onChange({ unitPrice: e.target.value })}
              type="number"
              min="0"
              inputMode="numeric"
              className="text-base pr-6"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">원</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">합계</Label>
          <div className="relative">
            <Input
              placeholder="합계"
              value={line.lineTotal}
              onChange={e => onChange({ lineTotal: e.target.value })}
              type="number"
              min="0"
              inputMode="numeric"
              className="text-base font-semibold pr-6"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">원</span>
          </div>
        </div>
      </div>

      {/* 합계 입력 시 단가 자동계산 안내 */}
      {line.quantity && !line.unitPrice && line.lineTotal && (
        <p className="text-xs text-muted-foreground">
          단가 자동계산: {fmt(Math.round(parseFloat(line.lineTotal) / parseFloat(line.quantity)))}
        </p>
      )}

      {/* 타 거래처 가격 비교 */}
      {line.itemId && (
        <div>
          <button
            className="text-xs text-primary hover:underline flex items-center gap-1"
            onClick={() => setShowPriceComparison(p => !p)}
          >
            <TrendingDown className="w-3 h-3" />
            타 거래처 가격 비교
          </button>
          {showPriceComparison && priceComparisonQuery.data && (
            <div className="mt-2 flex flex-wrap gap-2">
              {priceComparisonQuery.data.map((c, i) => (
                <div key={i} className="text-xs px-2 py-1 rounded-lg border bg-muted/50 flex items-center gap-1.5">
                  <span className="font-medium">{c.counterpartyName}</span>
                  <span className="text-muted-foreground">
                    {c.lastPrice ? fmt(parseFloat(String(c.lastPrice))) : "가격 없음"}
                    {c.purchaseUnit ? `/${c.purchaseUnit}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 비고 */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">비고 (선택)</Label>
        <Input
          placeholder="비고"
          value={line.note}
          onChange={e => onChange({ note: e.target.value })}
          className="text-sm"
        />
      </div>
    </div>
  );
}
