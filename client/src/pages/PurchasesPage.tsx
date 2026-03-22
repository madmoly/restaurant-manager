import { useState, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/hooks/useAuth";
import { getEffectiveRole } from "@shared/permissions";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  ShoppingCart,
  X,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  FileText,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function fmtDate(d: string | Date) {
  const s = typeof d === "string" ? d : d.toISOString();
  return s.slice(0, 10);
}

// ─── 매입 항목 행 타입 ──────────────────────────────────────────────────────

interface ItemRow {
  key: string;
  itemId?: number;
  counterpartyItemId?: number;
  rawItemName: string;
  itemType: "product" | "service" | "misc";
  quantity: string;
  unitName: string;
  unitPrice: string;
  lineTotal: string;
  costingCategory: string;
  note: string;
}

function emptyRow(): ItemRow {
  return {
    key: String(Date.now()) + Math.random(),
    rawItemName: "",
    itemType: "product",
    quantity: "",
    unitName: "",
    unitPrice: "",
    lineTotal: "",
    costingCategory: "식재료",
    note: "",
  };
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function PurchasesPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const { data: orders, isLoading } = trpc.purchasesV2.listOrdersByMonth.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 },
  );

  const deleteOrder = trpc.purchasesV2.deleteOrder.useMutation({
    onSuccess() {
      toast.success("삭제됨");
      invalidate();
    },
    onError(err) {
      toast.error(err.message);
    },
  });

  const invalidate = () => {
    utils.purchasesV2.listOrdersByMonth.invalidate();
  };

  const prevMonth = () => {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else setMonth((m) => m + 1);
  };

  const monthTotal = useMemo(
    () => (orders ?? []).reduce((s, o) => s + Number(o.totalAmount ?? 0), 0),
    [orders],
  );

  if (!restaurantId) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">매입 관리</h1>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4 mr-1" /> 매입 등록
        </Button>
      </div>

      {/* 월 네비게이션 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={prevMonth}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="text-sm font-medium text-foreground">
            {year}년 {month}월
          </span>
          <Button variant="ghost" size="icon" onClick={nextMonth}>
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>
        <span className="text-sm font-bold text-foreground tabular-nums">
          합계 {monthTotal.toLocaleString()}원
        </span>
      </div>

      {/* 등록 모달 */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">매입 등록</h2>
              <button onClick={() => setShowAdd(false)} className="p-1 rounded hover:bg-accent">
                <X className="w-5 h-5" />
              </button>
            </div>
            <AddPurchaseForm
              restaurantId={restaurantId}
              onDone={() => {
                setShowAdd(false);
                invalidate();
              }}
            />
          </div>
        </div>
      )}

      {/* 전표 목록 */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">로딩 중...</div>
      ) : !orders?.length ? (
        <div className="text-center py-12">
          <ShoppingCart className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">이번 달 매입 기록이 없습니다</p>
          <p className="text-xs text-muted-foreground mt-1">매입 등록 버튼으로 시작하세요</p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((o: any) => (
            <div key={o.id} className="border border-border rounded-lg bg-card">
              <div
                className="px-4 py-3 flex items-center justify-between cursor-pointer"
                onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {fmtDate(o.purchaseDate).slice(5)}
                  </span>
                  <span className="text-sm text-foreground truncate">
                    {o.counterpartyName ?? "직접입력"}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      o.status === "received"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
                        : "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                    }`}
                  >
                    {o.status === "received" ? "입고" : "발주"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-foreground tabular-nums">
                    {Number(o.totalAmount).toLocaleString()}원
                  </span>
                  {expandedId === o.id ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              {/* 상세 패널 */}
              {expandedId === o.id && <OrderDetail orderId={o.id} onDelete={() => {
                if (confirm("전표를 삭제하시겠습니까?")) deleteOrder.mutate({ id: o.id });
              }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 전표 상세 ────────────────────────────────────────────────────────────────

function OrderDetail({ orderId, onDelete }: { orderId: number; onDelete: () => void }) {
  const { data: items, isLoading } = trpc.purchasesV2.getOrderItems.useQuery({ orderId });

  if (isLoading) return <div className="px-4 pb-3 text-xs text-muted-foreground">로딩 중...</div>;

  return (
    <div className="border-t border-border px-4 pb-3">
      {items && items.length > 0 ? (
        <table className="w-full text-xs mt-2">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="text-left py-1 font-medium">품목</th>
              <th className="text-right py-1 font-medium">수량</th>
              <th className="text-right py-1 font-medium">단가</th>
              <th className="text-right py-1 font-medium">소계</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it: any) => (
              <tr key={it.id} className="border-b border-border/50">
                <td className="py-1.5 text-foreground">
                  {it.itemName ?? it.rawItemName ?? "-"}
                </td>
                <td className="py-1.5 text-right text-muted-foreground tabular-nums">
                  {it.quantity ? `${it.quantity}${it.unitName ? ` ${it.unitName}` : ""}` : "-"}
                </td>
                <td className="py-1.5 text-right text-muted-foreground tabular-nums">
                  {it.unitPrice ? `${Number(it.unitPrice).toLocaleString()}` : "-"}
                </td>
                <td className="py-1.5 text-right font-medium text-foreground tabular-nums">
                  {Number(it.lineTotal).toLocaleString()}원
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-muted-foreground mt-2">항목 없음</p>
      )}
      <div className="flex justify-end mt-2">
        <button onClick={onDelete} className="text-xs text-destructive hover:underline flex items-center gap-1">
          <Trash2 className="w-3 h-3" /> 전표 삭제
        </button>
      </div>
    </div>
  );
}

// ─── 매입 등록 폼 ─────────────────────────────────────────────────────────────

function AddPurchaseForm({
  restaurantId,
  onDone,
}: {
  restaurantId: number;
  onDone: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [purchaseDate, setPurchaseDate] = useState(today);
  const [counterpartyId, setCounterpartyId] = useState<string>("");
  const [status, setStatus] = useState<"received" | "ordered">("received");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<ItemRow[]>([emptyRow()]);

  const { data: counterparties } = trpc.counterparties.list.useQuery({ restaurantId });

  // 거래처 선택 시 해당 거래처의 품목 매핑 불러오기
  const { data: cpItems } = trpc.counterpartyItems.listByCounterparty.useQuery(
    { counterpartyId: Number(counterpartyId) },
    { enabled: !!counterpartyId },
  );

  const create = trpc.purchasesV2.createOrder.useMutation({
    onSuccess() {
      toast.success("매입 등록 완료");
      onDone();
    },
    onError(err) {
      toast.error(err.message);
    },
  });

  const addItem = () => setItems([...items, emptyRow()]);
  const removeItem = (key: string) => {
    if (items.length <= 1) return;
    setItems(items.filter((i) => i.key !== key));
  };

  const updateItem = (key: string, field: keyof ItemRow, value: any) => {
    setItems(
      items.map((item) => {
        if (item.key !== key) return item;
        const updated = { ...item, [field]: value };
        if (
          (field === "quantity" || field === "unitPrice") &&
          updated.quantity &&
          updated.unitPrice
        ) {
          updated.lineTotal = String(
            Math.round(Number(updated.quantity) * Number(updated.unitPrice)),
          );
        }
        return updated;
      }),
    );
  };

  // 거래처 품목에서 빠른 추가
  const addFromCpItem = (cpItem: any) => {
    const newItem: ItemRow = {
      key: String(Date.now()) + Math.random(),
      itemId: cpItem.itemId,
      counterpartyItemId: cpItem.id,
      rawItemName: cpItem.supplierItemName || cpItem.itemName,
      itemType: cpItem.itemType ?? "product",
      quantity: "",
      unitName: cpItem.purchaseUnit ?? "",
      unitPrice: cpItem.lastPrice ?? cpItem.defaultPrice ?? "",
      lineTotal: "",
      costingCategory: cpItem.costingCategory ?? "식재료",
      note: "",
    };
    // 빈 행이 하나만 있으면 교체, 아니면 추가
    if (items.length === 1 && !items[0].rawItemName) {
      setItems([newItem]);
    } else {
      setItems([...items, newItem]);
    }
  };

  const total = items.reduce((s, i) => s + Number(i.lineTotal || 0), 0);
  const canSubmit = items.some((i) => (i.rawItemName || i.itemId) && i.lineTotal);

  const handleSubmit = () => {
    create.mutate({
      restaurantId,
      counterpartyId: counterpartyId ? Number(counterpartyId) : undefined,
      purchaseDate,
      status,
      note: note || undefined,
      items: items
        .filter((i) => (i.rawItemName || i.itemId) && i.lineTotal)
        .map((i) => ({
          itemId: i.itemId,
          counterpartyItemId: i.counterpartyItemId,
          rawItemName: i.rawItemName || undefined,
          itemType: i.itemType,
          quantity: i.quantity || undefined,
          unitName: i.unitName || undefined,
          unitPrice: i.unitPrice || undefined,
          lineTotal: i.lineTotal,
          costingCategory: i.costingCategory || undefined,
          note: i.note || undefined,
        })),
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-sm font-medium text-foreground">날짜</label>
          <input
            type="date"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-foreground">거래처</label>
          <select
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={counterpartyId}
            onChange={(e) => setCounterpartyId(e.target.value)}
          >
            <option value="">직접 입력</option>
            {(counterparties ?? []).map((c: any) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-foreground">상태</label>
          <select
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
          >
            <option value="received">입고</option>
            <option value="ordered">발주</option>
          </select>
        </div>
      </div>

      {/* 거래처 품목 빠른 추가 */}
      {cpItems && cpItems.length > 0 && (
        <div className="border border-border rounded-lg p-3 bg-muted/30">
          <span className="text-xs font-medium text-muted-foreground mb-2 block">
            <Package className="w-3 h-3 inline mr-1" />
            거래처 등록 품목 (클릭하여 추가)
          </span>
          <div className="flex flex-wrap gap-1.5">
            {cpItems.map((ci: any) => (
              <button
                key={ci.id}
                onClick={() => addFromCpItem(ci)}
                className="text-xs px-2 py-1 rounded border border-border bg-background hover:bg-accent text-foreground"
              >
                {ci.supplierItemName || ci.itemName}
                {ci.lastPrice && (
                  <span className="text-muted-foreground ml-1">
                    ₩{Number(ci.lastPrice).toLocaleString()}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 항목 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground">항목</span>
          <button onClick={addItem} className="text-xs text-primary hover:underline">
            + 항목 추가
          </button>
        </div>
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.key} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-4">
                <input
                  placeholder="품목명"
                  value={item.rawItemName}
                  onChange={(e) => updateItem(item.key, "rawItemName", e.target.value)}
                  className="w-full px-2.5 py-2 border border-input bg-background rounded-md text-sm"
                />
              </div>
              <div className="col-span-2">
                <input
                  placeholder="수량"
                  type="number"
                  value={item.quantity}
                  onChange={(e) => updateItem(item.key, "quantity", e.target.value)}
                  className="w-full px-2.5 py-2 border border-input bg-background rounded-md text-sm"
                />
              </div>
              <div className="col-span-2">
                <input
                  placeholder="단가"
                  type="number"
                  value={item.unitPrice}
                  onChange={(e) => updateItem(item.key, "unitPrice", e.target.value)}
                  className="w-full px-2.5 py-2 border border-input bg-background rounded-md text-sm"
                />
              </div>
              <div className="col-span-3">
                <input
                  placeholder="합계"
                  type="number"
                  value={item.lineTotal}
                  onChange={(e) => updateItem(item.key, "lineTotal", e.target.value)}
                  className="w-full px-2.5 py-2 border border-input bg-background rounded-md text-sm font-semibold"
                />
              </div>
              <div className="col-span-1">
                {items.length > 1 && (
                  <button
                    onClick={() => removeItem(item.key)}
                    className="p-2 text-muted-foreground hover:text-destructive"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="text-right mt-2 text-sm font-bold text-foreground tabular-nums">
          합계: {total.toLocaleString()}원
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-foreground">메모 (선택)</label>
        <input
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="메모"
        />
      </div>

      <div className="flex gap-2 pt-2 justify-end">
        <Button variant="outline" onClick={onDone}>
          취소
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit || create.isPending}>
          {create.isPending ? "등록 중..." : "등록"}
        </Button>
      </div>
    </div>
  );
}
