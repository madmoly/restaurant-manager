import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import {
  ArrowUpDown, TrendingUp, TrendingDown, Minus,
  Package, Wallet, Truck, AlertTriangle, Check,
  ChevronDown, ChevronUp, Pencil, X, Save,
  Merge, Copy, Trash2, ChevronLeft, ChevronRight,
  CalendarRange,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type TabId = "suppliers" | "monthly" | "compare" | "trend" | "pending" | "items" | "duplicates";

export default function PurchaseManagementPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;
  const [activeTab, setActiveTab] = useState<TabId>("suppliers");

  if (!restaurantId) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: "suppliers", label: "거래처", icon: Wallet },
    { id: "monthly", label: "월별매입", icon: CalendarRange },
    { id: "items", label: "품목관리", icon: Package },
    { id: "compare", label: "가격비교", icon: ArrowUpDown },
    { id: "trend", label: "단가추이", icon: TrendingUp },
    { id: "pending", label: "발주현황", icon: Truck },
    { id: "duplicates", label: "중복관리", icon: Copy },
  ];

  return (
    <div className="max-w-3xl mx-auto">
      {/* 탭 네비게이션 */}
      <div className="sticky top-0 z-10 bg-background border-b border-border">
        <div className="flex overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 flex-1 min-w-[64px] flex flex-col items-center gap-0.5 py-3 text-xs font-medium border-b-2 transition-colors ${
                  active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 탭 콘텐츠 */}
      <div className="p-4 space-y-4">
        {activeTab === "suppliers" && <SuppliersTab restaurantId={restaurantId} />}
        {activeTab === "monthly" && <MonthlyPurchaseTab restaurantId={restaurantId} />}
        {activeTab === "items" && <ItemManagementTab restaurantId={restaurantId} />}
        {activeTab === "compare" && <PriceCompareTab restaurantId={restaurantId} />}
        {activeTab === "trend" && <PriceTrendTab restaurantId={restaurantId} />}
        {activeTab === "pending" && <PendingOrdersTab restaurantId={restaurantId} />}
        {activeTab === "duplicates" && <DuplicatesTab restaurantId={restaurantId} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 거래처 관리 탭 (기존 CounterpartiesPage 기능 임베드)
// ═══════════════════════════════════════════════════════════════════════
const CP_TYPE_LABELS: Record<string, string> = {
  supplier: "공급업체", online: "온라인", mart: "마트", repair: "수리/AS", other: "기타",
};
const CP_TYPES = ["supplier", "online", "mart", "repair", "other"] as const;

function SuppliersTab({ restaurantId }: { restaurantId: number }) {
  const { data: list, isLoading } = trpc.counterparties.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );
  const utils = trpc.useUtils();
  const updateCp = trpc.counterparties.update.useMutation({
    onSuccess() { toast.success("거래처 정보 저장됨"); utils.counterparties.list.invalidate(); setEditingId(null); },
    onError(err: any) { toast.error(err.message || "저장 실패"); },
  });
  const deactivate = trpc.counterparties.deactivate.useMutation({
    onSuccess() { toast.success("비활성화됨"); utils.counterparties.list.invalidate(); setEditingId(null); },
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    name: "", counterpartyType: "supplier" as string,
    phone: "", address: "", contactName: "", contactPhone: "", note: "",
  });

  const counterpartiesList = list || [];

  const startEdit = (cp: any) => {
    setEditingId(cp.id);
    setEditForm({
      name: cp.name || "",
      counterpartyType: cp.counterpartyType || "supplier",
      phone: cp.phone || "",
      address: cp.address || "",
      contactName: cp.contactName || "",
      contactPhone: cp.contactPhone || "",
      note: cp.note || "",
    });
  };

  const saveEdit = () => {
    if (!editingId || !editForm.name.trim()) { toast.error("거래처명은 필수입니다"); return; }
    updateCp.mutate({
      id: editingId,
      restaurantId,
      name: editForm.name.trim(),
      counterpartyType: editForm.counterpartyType as any,
      phone: editForm.phone.trim() || null,
      address: editForm.address.trim() || null,
      contactName: editForm.contactName.trim() || null,
      contactPhone: editForm.contactPhone.trim() || null,
      note: editForm.note.trim() || null,
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">거래처 목록</h2>
        <span className="text-sm text-muted-foreground">{counterpartiesList.length}개</span>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-8">로딩 중...</p>
      ) : counterpartiesList.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">등록된 거래처가 없습니다</p>
      ) : (
        counterpartiesList.map((cp: any) => (
          <Card key={cp.id} className="p-3">
            {editingId === cp.id ? (
              /* ── 수정 모드 ── */
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">거래처 정보 수정</span>
                  <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">거래처명 *</label>
                  <Input value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-sm mt-0.5" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">유형</label>
                  <select
                    value={editForm.counterpartyType}
                    onChange={(e) => setEditForm(f => ({ ...f, counterpartyType: e.target.value }))}
                    className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground mt-0.5"
                  >
                    {CP_TYPES.map(t => <option key={t} value={t}>{CP_TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">대표 연락처</label>
                    <Input value={editForm.phone} onChange={(e) => setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="02-XXX-XXXX" className="h-8 text-sm mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">주소</label>
                    <Input value={editForm.address} onChange={(e) => setEditForm(f => ({ ...f, address: e.target.value }))} placeholder="주소" className="h-8 text-sm mt-0.5" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">담당자명</label>
                    <Input value={editForm.contactName} onChange={(e) => setEditForm(f => ({ ...f, contactName: e.target.value }))} placeholder="담당자" className="h-8 text-sm mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">담당자 연락처</label>
                    <Input value={editForm.contactPhone} onChange={(e) => setEditForm(f => ({ ...f, contactPhone: e.target.value }))} placeholder="010-XXXX-XXXX" className="h-8 text-sm mt-0.5" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">메모</label>
                  <Input value={editForm.note} onChange={(e) => setEditForm(f => ({ ...f, note: e.target.value }))} placeholder="비고/메모" className="h-8 text-sm mt-0.5" />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={saveEdit} disabled={updateCp.isPending} className="flex-1 h-8 text-xs">
                    <Save className="w-3.5 h-3.5 mr-1" /> 저장
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => { if (confirm(`"${cp.name}" 거래처를 비활성화할까요?`)) deactivate.mutate({ id: cp.id, restaurantId }); }} className="h-8 text-xs px-3">
                    삭제
                  </Button>
                </div>
              </div>
            ) : (
              /* ── 보기 모드 ── */
              <div className="flex items-start justify-between gap-2" onClick={() => startEdit(cp)} role="button">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">{cp.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {CP_TYPE_LABELS[cp.counterpartyType] || "기타"}
                    {cp.phone && ` · ${cp.phone}`}
                  </p>
                  {(cp.contactName || cp.contactPhone || cp.address) && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {cp.contactName && `담당: ${cp.contactName}`}
                      {cp.contactPhone && ` ${cp.contactPhone}`}
                      {cp.address && ` · ${cp.address}`}
                    </p>
                  )}
                  {cp.note && <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{cp.note}</p>}
                </div>
                <Pencil className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-1" />
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 가격비교 탭: 동일 품목 거래처별 단가 비교
// ═══════════════════════════════════════════════════════════════════════
function PriceCompareTab({ restaurantId }: { restaurantId: number }) {
  const [search, setSearch] = useState("");
  const { data, isLoading } = trpc.purchasesV2.itemPriceComparison.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  const items = (data || []).filter((item: any) =>
    !search || item.itemName.toLowerCase().includes(search.toLowerCase())
  );

  const multiSupplierItems = items.filter((item: any) => item.suppliers.length >= 2);
  const singleSupplierItems = items.filter((item: any) => item.suppliers.length === 1);

  return (
    <div className="space-y-3">
      <Input
        placeholder="품목명 검색..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-9 text-sm"
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-8">로딩 중...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">매입 데이터가 없습니다</p>
      ) : (
        <>
          {/* 복수 거래처 품목 (비교 가능) */}
          {multiSupplierItems.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1">
                <ArrowUpDown className="w-3.5 h-3.5" /> 복수 거래처 비교 ({multiSupplierItems.length}개 품목)
              </h3>
              {multiSupplierItems.map((item: any) => {
                const prices = item.suppliers.map((s: any) => Number(s.unitPrice));
                const minPrice = Math.min(...prices);
                const maxPrice = Math.max(...prices);
                return (
                  <Card key={item.itemName} className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground text-sm">{item.itemName}</span>
                      {maxPrice > minPrice && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300">
                          차이 ₩{(maxPrice - minPrice).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1">
                      {item.suppliers
                        .sort((a: any, b: any) => Number(a.unitPrice) - Number(b.unitPrice))
                        .map((s: any, si: number) => {
                          const price = Number(s.unitPrice);
                          const isCheapest = price === minPrice && prices.length > 1;
                          const isMostExpensive = price === maxPrice && prices.length > 1 && maxPrice !== minPrice;
                          return (
                            <div key={si} className={`flex items-center justify-between text-xs px-2 py-1.5 rounded ${
                              isCheapest ? "bg-green-50 dark:bg-green-900/20" : isMostExpensive ? "bg-red-50 dark:bg-red-900/20" : "bg-muted/30"
                            }`}>
                              <span className="text-foreground">{s.counterpartyName}</span>
                              <div className="flex items-center gap-2">
                                <span className={`font-medium tabular-nums ${
                                  isCheapest ? "text-green-600 dark:text-green-400" : isMostExpensive ? "text-red-500" : "text-foreground"
                                }`}>
                                  ₩{price.toLocaleString()}/{s.unitName || '개'}
                                </span>
                                {isCheapest && <span className="text-[9px] text-green-600 dark:text-green-400">최저</span>}
                                {isMostExpensive && <span className="text-[9px] text-red-500">최고</span>}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* 단일 거래처 품목 */}
          {singleSupplierItems.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground mt-4">단일 거래처 품목 ({singleSupplierItems.length}개)</h3>
              {singleSupplierItems.map((item: any) => (
                <div key={item.itemName} className="flex items-center justify-between px-3 py-2 bg-muted/20 rounded text-xs">
                  <span className="text-foreground">{item.itemName}</span>
                  <span className="text-muted-foreground">
                    {item.suppliers[0]?.counterpartyName} · ₩{Number(item.suppliers[0]?.unitPrice).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 단가추이 탭: 시기별 품목 단가 변화
// ═══════════════════════════════════════════════════════════════════════
function PriceTrendTab({ restaurantId }: { restaurantId: number }) {
  const [search, setSearch] = useState("");
  const [months, setMonths] = useState(6);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const { data, isLoading } = trpc.purchasesV2.itemPriceTrend.useQuery(
    { restaurantId, months },
    { enabled: restaurantId > 0 },
  );

  const items = (data || []).filter((item: any) =>
    !search || item.itemName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="품목명 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 h-9 text-sm"
        />
        <select
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value={3}>3개월</option>
          <option value={6}>6개월</option>
          <option value={12}>12개월</option>
        </select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-8">로딩 중...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">단가 데이터가 없습니다</p>
      ) : (
        <div className="space-y-2">
          {items.map((item: any) => {
            const expanded = expandedItem === item.itemName;
            const changePercent = item.points.length >= 2
              ? ((item.latestPrice - item.points[0].unitPrice) / item.points[0].unitPrice * 100)
              : 0;

            return (
              <Card key={item.itemName} className="overflow-hidden">
                <button
                  onClick={() => setExpandedItem(expanded ? null : item.itemName)}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/30 transition-colors"
                >
                  <div>
                    <span className="font-medium text-foreground text-sm">{item.itemName}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        현재 ₩{item.latestPrice.toLocaleString()}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        (₩{item.minPrice.toLocaleString()} ~ ₩{item.maxPrice.toLocaleString()})
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {changePercent !== 0 && (
                      <span className={`text-xs font-medium flex items-center gap-0.5 ${
                        changePercent > 0 ? "text-red-500" : "text-green-600 dark:text-green-400"
                      }`}>
                        {changePercent > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {changePercent > 0 ? "+" : ""}{changePercent.toFixed(1)}%
                      </span>
                    )}
                    {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </button>

                {expanded && (
                  <div className="px-3 pb-3 border-t border-border pt-2 space-y-1">
                    {item.points.map((p: any, pi: number) => {
                      const prevPrice = pi > 0 ? item.points[pi - 1].unitPrice : null;
                      const diff = prevPrice ? p.unitPrice - prevPrice : 0;
                      return (
                        <div key={pi} className="flex items-center justify-between text-xs py-1">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground w-20">
                              {typeof p.purchaseDate === 'string'
                                ? p.purchaseDate.substring(0, 10)
                                : new Date(p.purchaseDate).toISOString().substring(0, 10)}
                            </span>
                            <span className="text-muted-foreground">{p.counterpartyName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground tabular-nums">₩{p.unitPrice.toLocaleString()}</span>
                            {diff !== 0 && (
                              <span className={`text-[10px] ${diff > 0 ? "text-red-500" : "text-green-600 dark:text-green-400"}`}>
                                {diff > 0 ? "▲" : "▼"}{Math.abs(diff).toLocaleString()}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 발주현황 탭: 거래처별 금액분석 + 미입고 발주
// ═══════════════════════════════════════════════════════════════════════
function PendingOrdersTab({ restaurantId }: { restaurantId: number }) {
  const [months, setMonths] = useState(3);

  const pendingQuery = trpc.purchasesV2.pendingOrders.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  const analysisQuery = trpc.purchasesV2.counterpartyAmountAnalysis.useQuery(
    { restaurantId, months },
    { enabled: restaurantId > 0 },
  );

  const updateOrder = trpc.purchasesV2.updateOrder.useMutation({
    onSuccess() {
      toast.success("입고 처리 완료");
      pendingQuery.refetch();
      analysisQuery.refetch();
    },
  });

  const pending = pendingQuery.data || [];
  const analysis = analysisQuery.data || [];
  const totalPending = pending.reduce((s, o: any) => s + Number(o.totalAmount || 0), 0);

  return (
    <div className="space-y-4">
      {/* 미입고 발주 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            미입고 발주 ({pending.length}건)
          </h3>
          {totalPending > 0 && (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              ₩{totalPending.toLocaleString()}
            </span>
          )}
        </div>

        {pending.length === 0 ? (
          <Card className="p-4 text-center">
            <p className="text-sm text-muted-foreground">미입고 발주가 없습니다</p>
          </Card>
        ) : (
          pending.map((order: any) => (
            <Card key={order.id} className="p-3 border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-900/10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-foreground text-sm">
                    {order.counterpartyName || '미지정'} · ₩{Number(order.totalAmount).toLocaleString()}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {typeof order.purchaseDate === 'string'
                      ? order.purchaseDate.substring(0, 10)
                      : new Date(order.purchaseDate).toISOString().substring(0, 10)}
                    {order.note && ` · ${order.note}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 gap-1 border-green-300 text-green-600 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/20"
                  onClick={() => updateOrder.mutate({ restaurantId, id: order.id, status: "received" })}
                  disabled={updateOrder.isPending}
                >
                  <Check className="w-3 h-3" /> 입고확인
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* 거래처별 금액 분석 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">거래처별 매입 분석</h3>
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value={1}>1개월</option>
            <option value={3}>3개월</option>
            <option value={6}>6개월</option>
          </select>
        </div>

        {analysisQuery.isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-4">로딩 중...</p>
        ) : analysis.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">해당 기간 매입 데이터가 없습니다</p>
        ) : (
          analysis.map((cp: any) => {
            const total = cp.totalReceived + cp.totalOrdered;
            return (
              <Card key={cp.counterpartyName} className="p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-medium text-foreground text-sm">{cp.counterpartyName}</span>
                  <span className="text-sm font-bold text-foreground tabular-nums">₩{total.toLocaleString()}</span>
                </div>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span>입고 {cp.receivedCount}건 · ₩{cp.totalReceived.toLocaleString()}</span>
                  {cp.orderedCount > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">
                      미입고 {cp.orderedCount}건 · ₩{cp.totalOrdered.toLocaleString()}
                    </span>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 품목관리 탭 — 유사 품목 합치기
// ═══════════════════════════════════════════════════════════════════════
function ItemManagementTab({ restaurantId }: { restaurantId: number }) {
  const { data, isLoading, refetch } = trpc.items.findSimilarGroups.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );
  const mergeMut = trpc.items.merge.useMutation({
    onSuccess: (res) => {
      toast.success(`${res.merged}개 품목을 병합했습니다`);
      refetch();
    },
    onError: (err) => toast.error(`병합 실패: ${err.message}`),
  });

  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");

  if (isLoading) return <div className="text-center py-8 text-sm text-muted-foreground">로딩 중...</div>;

  const groups = data?.groups || [];
  const allItems = data?.allItems || [];

  const filteredAll = search
    ? allItems.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
    : allItems;

  const handleMerge = (groupIdx: number, tId: number) => {
    const group = groups[groupIdx];
    if (!group) return;
    const sourceIds = group.items.map(i => i.id).filter(id => id !== tId);
    const targetItem = group.items.find(i => i.id === tId);
    if (!targetItem || sourceIds.length === 0) return;

    if (!confirm(`"${targetItem.name}"으로 ${sourceIds.length}개 품목을 합칩니다.\n거래처 매핑과 매입 이력이 모두 이동됩니다.\n계속하시겠습니까?`)) return;
    mergeMut.mutate({ targetId: tId, sourceIds });
  };

  return (
    <div className="space-y-4">
      {/* 요약 */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          전체 <span className="font-semibold text-foreground">{data?.totalItems ?? 0}</span>개 품목
          {groups.length > 0 && (
            <span className="ml-2 text-amber-600 dark:text-amber-400">
              · 유사 그룹 <span className="font-semibold">{groups.length}</span>개 발견
            </span>
          )}
        </div>
        <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setShowAll(!showAll)}>
          {showAll ? "유사 그룹만" : "전체 품목"}
        </Button>
      </div>

      {/* 유사 그룹 병합 UI */}
      {!showAll && (
        <>
          {groups.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              <Check className="w-6 h-6 mx-auto mb-2 text-green-500" />
              유사한 품목이 없습니다
            </Card>
          ) : (
            groups.map((group, gi) => (
              <Card key={gi} className="overflow-hidden">
                <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Merge size={14} className="text-amber-600" />
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                      유사 품목 {group.items.length}개
                    </span>
                  </div>
                  {selectedGroup === gi ? (
                    <Button size="sm" variant="ghost" className="text-xs h-6 px-2" onClick={() => { setSelectedGroup(null); setTargetId(null); }}>
                      취소
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="text-xs h-6 px-2" onClick={() => { setSelectedGroup(gi); setTargetId(group.items[0].id); }}>
                      합치기
                    </Button>
                  )}
                </div>
                <div className="divide-y divide-border">
                  {group.items.map((item) => {
                    const isTarget = selectedGroup === gi && targetId === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`px-4 py-2.5 flex items-center justify-between text-sm ${isTarget ? "bg-blue-50 dark:bg-blue-900/20" : ""}`}
                        onClick={() => { if (selectedGroup === gi) setTargetId(item.id); }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {selectedGroup === gi && (
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${isTarget ? "border-blue-500 bg-blue-500" : "border-muted-foreground/30"}`}>
                              {isTarget && <Check size={10} className="text-white" />}
                            </div>
                          )}
                          <span className="font-medium text-foreground truncate">{item.name}</span>
                          {isTarget && <Badge className="text-[9px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 shrink-0">대표</Badge>}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                          {item.counterpartyCount > 0 && <span>거래처 {item.counterpartyCount}</span>}
                          {item.purchaseCount > 0 && <span>매입 {item.purchaseCount}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {selectedGroup === gi && targetId && (
                  <div className="px-4 py-2.5 bg-muted/30 border-t border-border">
                    <Button
                      size="sm"
                      className="w-full text-xs"
                      disabled={mergeMut.isPending}
                      onClick={() => handleMerge(gi, targetId)}
                    >
                      <Merge size={12} className="mr-1" />
                      "{group.items.find(i => i.id === targetId)?.name}"으로 합치기
                    </Button>
                  </div>
                )}
              </Card>
            ))
          )}
        </>
      )}

      {/* 전체 품목 목록 */}
      {showAll && (
        <>
          <Input
            placeholder="품목명 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
          />
          <Card className="overflow-hidden">
            <div className="divide-y divide-border max-h-[60vh] overflow-y-auto">
              {filteredAll.map((item) => (
                <div key={item.id} className="px-4 py-2.5 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-foreground truncate">{item.name}</span>
                    {item.baseUnit && <span className="text-xs text-muted-foreground">({item.baseUnit})</span>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                    {item.counterpartyCount > 0 && <span>거래처 {item.counterpartyCount}</span>}
                    {item.purchaseCount > 0 && <span>매입 {item.purchaseCount}</span>}
                  </div>
                </div>
              ))}
              {filteredAll.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">검색 결과 없음</div>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 중복관리 탭 — 동일 날짜+거래처+금액 중복 감지/삭제
// ═══════════════════════════════════════════════════════════════════════
function DuplicatesTab({ restaurantId }: { restaurantId: number }) {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);

  const { data: dupes, isLoading, refetch } = trpc.purchasesV2.findDuplicates.useQuery(
    { restaurantId, month },
    { enabled: restaurantId > 0 },
  );

  const deleteMut = trpc.purchasesV2.deleteDuplicate.useMutation({
    onSuccess: () => {
      toast.success("삭제 완료");
      refetch();
    },
    onError: (err) => toast.error(`삭제 실패: ${err.message}`),
  });

  const handleDelete = (orderId: number, counterpartyName: string) => {
    if (!confirm(`${counterpartyName}의 전표 #${orderId}를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    deleteMut.mutate({ restaurantId, orderId });
  };

  const prevMonth = () => {
    const d = new Date(month + "-01");
    d.setMonth(d.getMonth() - 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const nextMonth = () => {
    const d = new Date(month + "-01");
    d.setMonth(d.getMonth() + 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  return (
    <div className="space-y-4">
      {/* 월 선택 */}
      <div className="flex items-center justify-center gap-3">
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={prevMonth}>
          <ChevronLeft size={16} />
        </Button>
        <span className="text-sm font-semibold min-w-[100px] text-center">{month}</span>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={nextMonth}>
          <ChevronRight size={16} />
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-sm text-muted-foreground">검색 중...</div>
      ) : !dupes || dupes.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          <Check className="w-6 h-6 mx-auto mb-2 text-green-500" />
          {month}에 중복 전표가 없습니다
        </Card>
      ) : (
        dupes.map((d, i) => (
          <Card key={i} className="overflow-hidden">
            <div className="px-4 py-2.5 bg-red-50 dark:bg-red-900/20 border-b border-border">
              <div className="flex items-center gap-2">
                <Copy size={14} className="text-red-500" />
                <span className="text-xs font-semibold text-red-700 dark:text-red-400">
                  중복 {d.count}건
                </span>
                <span className="text-xs text-muted-foreground">
                  · {d.purchaseDate} · {d.counterpartyName} · ₩{Number(d.totalAmount).toLocaleString()}
                </span>
              </div>
            </div>
            <div className="divide-y divide-border">
              {d.ids.map((orderId, idx) => (
                <div key={orderId} className="px-4 py-2.5 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground font-medium">#{orderId}</span>
                    <Badge variant={d.status === "received" ? "default" : "secondary"} className="text-[10px]">
                      {d.status === "received" ? "입고" : "발주"}
                    </Badge>
                    {idx === 0 && <span className="text-[10px] text-muted-foreground">(먼저 등록)</span>}
                  </div>
                  {idx > 0 && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="text-xs h-7 px-2"
                      disabled={deleteMut.isPending}
                      onClick={() => handleDelete(orderId, d.counterpartyName)}
                    >
                      <Trash2 size={12} className="mr-1" /> 삭제
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 월별매입 탭 — 거래처별 월간 매입 목록
// ═══════════════════════════════════════════════════════════════════════
const CP_TYPE_LABELS_MONTHLY: Record<string, string> = {
  supplier: "공급", online: "온라인", mart: "마트", repair: "수리", other: "기타",
};

function MonthlyPurchaseTab({ restaurantId }: { restaurantId: number }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [expandedCp, setExpandedCp] = useState<string | null>(null);
  const [expandedOrder, setExpandedOrder] = useState<number | null>(null);

  const { data, isLoading } = trpc.purchasesV2.monthlySummaryByCounterparty.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 },
  );

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
    setExpandedCp(null);
    setExpandedOrder(null);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
    setExpandedCp(null);
    setExpandedOrder(null);
  };

  const cpList = data || [];
  const grandTotal = cpList.reduce((s, c) => s + c.totalAmount, 0);
  const totalOrders = cpList.reduce((s, c) => s + c.orderCount, 0);

  return (
    <div className="space-y-4">
      {/* 월 선택 */}
      <div className="flex items-center justify-center gap-3">
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={prevMonth}>
          <ChevronLeft size={16} />
        </Button>
        <span className="text-sm font-semibold min-w-[120px] text-center">
          {year}년 {month}월
        </span>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={nextMonth}>
          <ChevronRight size={16} />
        </Button>
      </div>

      {/* 월 합계 요약 */}
      {!isLoading && cpList.length > 0 && (
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              거래처 {cpList.length}곳 · 전표 {totalOrders}건
            </span>
            <span className="text-base font-bold text-foreground tabular-nums">
              ₩{grandTotal.toLocaleString()}
            </span>
          </div>
        </Card>
      )}

      {/* 거래처별 목록 */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-8">로딩 중...</p>
      ) : cpList.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {year}년 {month}월 매입 데이터가 없습니다
        </Card>
      ) : (
        cpList.map((cp) => {
          const cpKey = cp.counterpartyName;
          const isExpanded = expandedCp === cpKey;
          const pct = grandTotal > 0 ? ((cp.totalAmount / grandTotal) * 100).toFixed(1) : "0";

          return (
            <Card key={cpKey} className="overflow-hidden">
              {/* 거래처 헤더 */}
              <button
                onClick={() => { setExpandedCp(isExpanded ? null : cpKey); setExpandedOrder(null); }}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-foreground text-sm truncate">{cp.counterpartyName}</span>
                  {cp.counterpartyType && (
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {CP_TYPE_LABELS_MONTHLY[cp.counterpartyType] || cp.counterpartyType}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground shrink-0">{cp.orderCount}건</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <span className="text-sm font-bold text-foreground tabular-nums">
                      ₩{cp.totalAmount.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-1">({pct}%)</span>
                  </div>
                  {isExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                </div>
              </button>

              {/* 전표 목록 (펼침) */}
              {isExpanded && (
                <div className="border-t border-border divide-y divide-border">
                  {cp.orders.map((order) => {
                    const isOrderExpanded = expandedOrder === order.orderId;
                    return (
                      <div key={order.orderId}>
                        <button
                          onClick={() => setExpandedOrder(isOrderExpanded ? null : order.orderId)}
                          className="w-full px-4 py-2.5 flex items-center justify-between text-sm hover:bg-muted/20 transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs text-muted-foreground tabular-nums">{order.purchaseDate}</span>
                            <Badge
                              variant={order.status === "received" ? "default" : "secondary"}
                              className="text-[10px]"
                            >
                              {order.status === "received" ? "입고" : "발주"}
                            </Badge>
                            {order.note && <span className="text-xs text-muted-foreground truncate max-w-[120px]">{order.note}</span>}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-sm font-semibold tabular-nums text-foreground">
                              ₩{order.totalAmount.toLocaleString()}
                            </span>
                            {order.items.length > 0 && (
                              isOrderExpanded
                                ? <ChevronUp size={12} className="text-muted-foreground" />
                                : <ChevronDown size={12} className="text-muted-foreground" />
                            )}
                          </div>
                        </button>

                        {/* 품목 상세 */}
                        {isOrderExpanded && order.items.length > 0 && (
                          <div className="bg-muted/20 px-4 py-2 space-y-1">
                            {order.items.map((item) => (
                              <div key={item.itemRowId} className="flex items-center justify-between text-xs">
                                <span className="text-foreground truncate max-w-[45%]">{item.itemName}</span>
                                <div className="flex items-center gap-2 text-muted-foreground tabular-nums">
                                  {item.quantity && <span>{item.quantity}{item.unitName || ""}</span>}
                                  {item.unitPrice && <span>@₩{Number(item.unitPrice).toLocaleString()}</span>}
                                  <span className="font-medium text-foreground">₩{Number(item.lineTotal || 0).toLocaleString()}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
