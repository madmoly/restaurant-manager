import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import {
  ArrowUpDown, TrendingUp, TrendingDown, Minus,
  Package, Wallet, Truck, AlertTriangle, Check,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type TabId = "suppliers" | "compare" | "trend" | "pending";

export default function PurchaseManagementPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;
  const [activeTab, setActiveTab] = useState<TabId>("suppliers");

  if (!restaurantId) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: "suppliers", label: "거래처", icon: Wallet },
    { id: "compare", label: "가격비교", icon: ArrowUpDown },
    { id: "trend", label: "단가추이", icon: TrendingUp },
    { id: "pending", label: "발주현황", icon: Truck },
  ];

  return (
    <div className="max-w-3xl mx-auto">
      {/* 탭 네비게이션 */}
      <div className="sticky top-0 z-10 bg-background border-b border-border">
        <div className="flex">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-3 text-xs font-medium border-b-2 transition-colors ${
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
        {activeTab === "compare" && <PriceCompareTab restaurantId={restaurantId} />}
        {activeTab === "trend" && <PriceTrendTab restaurantId={restaurantId} />}
        {activeTab === "pending" && <PendingOrdersTab restaurantId={restaurantId} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 거래처 관리 탭 (기존 CounterpartiesPage 기능 임베드)
// ═══════════════════════════════════════════════════════════════════════
function SuppliersTab({ restaurantId }: { restaurantId: number }) {
  const { data: list, isLoading } = trpc.counterparties.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );
  const utils = trpc.useUtils();
  const deactivate = trpc.counterparties.deactivate.useMutation({
    onSuccess() { toast.success("비활성화됨"); utils.counterparties.list.invalidate(); },
  });

  const counterpartiesList = list || [];

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
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">{cp.name}</p>
                <p className="text-xs text-muted-foreground">
                  {cp.counterpartyType === "supplier" ? "공급업체" :
                   cp.counterpartyType === "online" ? "온라인" :
                   cp.counterpartyType === "mart" ? "마트" :
                   cp.counterpartyType === "repair" ? "수리/AS" : "기타"}
                  {cp.contactName && ` · ${cp.contactName}`}
                  {cp.contactPhone && ` · ${cp.contactPhone}`}
                </p>
              </div>
            </div>
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
                  onClick={() => updateOrder.mutate({ id: order.id, status: "received" })}
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
