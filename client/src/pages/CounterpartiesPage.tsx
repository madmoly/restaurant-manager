import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import {
  Plus,
  Store,
  Trash2,
  ChevronDown,
  ChevronUp,
  Package,
  Link2,
  X,
  Receipt,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatKRW } from "@/lib/utils";

const TYPE_OPTIONS = [
  { value: "supplier", label: "공급업체" },
  { value: "online", label: "온라인" },
  { value: "mart", label: "마트" },
  { value: "repair", label: "수리/AS" },
  { value: "other", label: "기타" },
];

const TYPE_LABELS: Record<string, string> = {
  supplier: "공급업체",
  online: "온라인",
  mart: "마트",
  repair: "수리/AS",
  other: "기타",
};

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function CounterpartiesPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const { data: list, isLoading } = trpc.counterparties.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  const deactivate = trpc.counterparties.deactivate.useMutation({
    onSuccess() {
      toast.success("비활성화됨");
      utils.counterparties.list.invalidate();
    },
    onError(err) {
      toast.error(err.message);
    },
  });

  if (!restaurantId) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">거래처 관리</h1>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4 mr-1" /> 거래처 추가
        </Button>
      </div>

      {/* 추가 모달 */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">거래처 추가</h2>
              <button onClick={() => setShowAdd(false)} className="p-1 rounded hover:bg-accent">
                <X className="w-5 h-5" />
              </button>
            </div>
            <AddCounterpartyForm
              restaurantId={restaurantId}
              onDone={() => {
                setShowAdd(false);
                utils.counterparties.list.invalidate();
              }}
            />
          </div>
        </div>
      )}

      {/* 목록 */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">로딩 중...</div>
      ) : !list?.length ? (
        <div className="text-center py-12">
          <Store className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">등록된 거래처가 없습니다</p>
          <p className="text-xs text-muted-foreground mt-1">
            거래처를 추가하면 매입 등록 시 선택할 수 있습니다
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((c: any) => (
            <div key={c.id} className="border border-border rounded-lg bg-card">
              <div className="px-4 py-3 flex items-center justify-between">
                <div
                  className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                >
                  <span className="text-sm font-medium text-foreground">{c.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                    {TYPE_LABELS[c.counterpartyType] ?? c.counterpartyType}
                  </span>
                  {expandedId === c.id ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                <button
                  onClick={() => {
                    if (confirm(`${c.name}을(를) 비활성화하시겠습니까?`))
                      deactivate.mutate({ id: c.id, restaurantId });
                  }}
                  className="text-muted-foreground hover:text-destructive p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* 펼쳐진 상세 패널 */}
              {expandedId === c.id && (
                <>
                  <SettlementBasisPanel
                    restaurantId={restaurantId}
                    counterpartyId={c.id}
                    initialBasis={c.settlementBasis ?? "supply"}
                    initialTolerance={c.settlementMatchTolerance ?? 100}
                  />
                  <CounterpartyItemsPanel
                    restaurantId={restaurantId}
                    counterpartyId={c.id}
                    counterpartyName={c.name}
                  />
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 거래처-품목 매핑 패널 ────────────────────────────────────────────────────

function CounterpartyItemsPanel({
  restaurantId,
  counterpartyId,
  counterpartyName,
}: {
  restaurantId: number;
  counterpartyId: number;
  counterpartyName: string;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const utils = trpc.useUtils();

  const { data: cpItems, isLoading } = trpc.counterpartyItems.listByCounterparty.useQuery({
    counterpartyId,
  });

  const deleteCpItem = trpc.counterpartyItems.delete.useMutation({
    onSuccess() {
      toast.success("매핑 삭제됨");
      utils.counterpartyItems.listByCounterparty.invalidate();
    },
    onError(err) {
      toast.error(err.message);
    },
  });

  return (
    <div className="border-t border-border px-4 pb-3">
      <div className="flex items-center justify-between mt-2 mb-2">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Package className="w-3 h-3" /> 등록 품목
        </span>
        <button
          onClick={() => setShowAdd(true)}
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <Link2 className="w-3 h-3" /> 품목 연결
        </button>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">로딩 중...</p>
      ) : !cpItems?.length ? (
        <p className="text-xs text-muted-foreground py-2">
          연결된 품목이 없습니다. "품목 연결"로 추가하세요.
        </p>
      ) : (
        <div className="space-y-1">
          {cpItems.map((ci: any) => (
            <div
              key={ci.id}
              className="flex items-center justify-between text-xs py-1.5 border-b border-border/50 last:border-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-foreground truncate">
                  {ci.supplierItemName || ci.itemName}
                </span>
                {ci.supplierItemName && ci.supplierItemName !== ci.itemName && (
                  <span className="text-muted-foreground">({ci.itemName})</span>
                )}
                {ci.purchaseUnit && (
                  <span className="text-muted-foreground">{ci.purchaseUnit}</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {ci.lastPrice && (
                  <span className="text-muted-foreground tabular-nums">
                    {formatKRW(Number(ci.lastPrice))}
                  </span>
                )}
                {ci.isPreferred && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                    주
                  </span>
                )}
                <button
                  onClick={() => {
                    if (confirm("매핑을 삭제하시겠습니까?")) deleteCpItem.mutate({ id: ci.id });
                  }}
                  className="text-muted-foreground hover:text-destructive p-0.5"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 품목 연결 모달 */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground">
                품목 연결 — {counterpartyName}
              </h2>
              <button onClick={() => setShowAdd(false)} className="p-1 rounded hover:bg-accent">
                <X className="w-5 h-5" />
              </button>
            </div>
            <LinkItemForm
              restaurantId={restaurantId}
              counterpartyId={counterpartyId}
              onDone={() => {
                setShowAdd(false);
                utils.counterpartyItems.listByCounterparty.invalidate();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 품목 연결 폼 ─────────────────────────────────────────────────────────────

function LinkItemForm({
  restaurantId,
  counterpartyId,
  onDone,
}: {
  restaurantId: number;
  counterpartyId: number;
  onDone: () => void;
}) {
  const [itemId, setItemId] = useState<string>("");
  const [newItemName, setNewItemName] = useState("");
  const [supplierItemName, setSupplierItemName] = useState("");
  const [purchaseUnit, setPurchaseUnit] = useState("");
  const [defaultPrice, setDefaultPrice] = useState("");
  const [isPreferred, setIsPreferred] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">("existing");

  const { data: itemList } = trpc.items.list.useQuery({ restaurantId });

  const createItem = trpc.items.create.useMutation();
  const linkItem = trpc.counterpartyItems.create.useMutation({
    onSuccess() {
      toast.success("품목 연결 완료");
      onDone();
    },
    onError(err) {
      toast.error(err.message);
    },
  });

  const handleSubmit = async () => {
    let targetItemId = Number(itemId);

    // 새 품목 모드면 먼저 품목 생성
    if (mode === "new" && newItemName) {
      const result = await createItem.mutateAsync({
        restaurantId,
        name: newItemName,
        itemType: "product",
      });
      targetItemId = result.id;
    }

    if (!targetItemId) {
      toast.error("품목을 선택하거나 이름을 입력해주세요");
      return;
    }

    linkItem.mutate({
      restaurantId,
      counterpartyId,
      itemId: targetItemId,
      supplierItemName: supplierItemName || undefined,
      purchaseUnit: purchaseUnit || undefined,
      defaultPrice: defaultPrice || undefined,
      isPreferred,
    });
  };

  return (
    <div className="space-y-3">
      {/* 모드 전환 */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode("existing")}
          className={`text-xs px-3 py-1.5 rounded-md border ${
            mode === "existing"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground"
          }`}
        >
          기존 품목 선택
        </button>
        <button
          onClick={() => setMode("new")}
          className={`text-xs px-3 py-1.5 rounded-md border ${
            mode === "new"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground"
          }`}
        >
          새 품목 등록
        </button>
      </div>

      {mode === "existing" ? (
        <div>
          <label className="text-sm font-medium text-foreground">품목 선택</label>
          <select
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
          >
            <option value="">선택...</option>
            {(itemList ?? []).map((it: any) => (
              <option key={it.id} value={String(it.id)}>
                {it.name} {it.baseUnit ? `(${it.baseUnit})` : ""}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div>
          <label className="text-sm font-medium text-foreground">새 품목명</label>
          <input
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder="품목명 입력"
            autoFocus
          />
        </div>
      )}

      <div>
        <label className="text-sm font-medium text-foreground">
          거래처 품목명 (다르면 입력)
        </label>
        <input
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={supplierItemName}
          onChange={(e) => setSupplierItemName(e.target.value)}
          placeholder="선택사항"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-foreground">구매 단위</label>
          <input
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={purchaseUnit}
            onChange={(e) => setPurchaseUnit(e.target.value)}
            placeholder="예: 박스, kg"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-foreground">기본 단가</label>
          <input
            type="number"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={defaultPrice}
            onChange={(e) => setDefaultPrice(e.target.value)}
            placeholder="원"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={isPreferred}
          onChange={(e) => setIsPreferred(e.target.checked)}
          className="rounded border-input"
        />
        <span className="text-sm text-foreground">주거래 품목</span>
      </label>

      <div className="flex gap-2 pt-2 justify-end">
        <Button variant="outline" onClick={onDone}>
          취소
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={
            (mode === "existing" && !itemId) ||
            (mode === "new" && !newItemName) ||
            linkItem.isPending ||
            createItem.isPending
          }
        >
          {linkItem.isPending || createItem.isPending ? "연결 중..." : "연결"}
        </Button>
      </div>
    </div>
  );
}

// ─── 정산 기준 패널 (정산표 OCR 대조용) ───────────────────────────────────────

const BASIS_OPTIONS = [
  { value: "supply", label: "공급가 (부가세 별도)", desc: "시스템 매입 = 공급가, 정산표도 공급가 기준" },
  { value: "total", label: "공급가+부가세 (포함)", desc: "정산표가 부가세 포함 금액. 시스템 매입은 ×1.1로 비교" },
  { value: "mixed", label: "혼합 (과세/면세 혼재)", desc: "거래 항목별 자동판정 — 1차 정확도 낮음" },
];

function SettlementBasisPanel({
  restaurantId,
  counterpartyId,
  initialBasis,
  initialTolerance,
}: {
  restaurantId: number;
  counterpartyId: number;
  initialBasis: "supply" | "total" | "mixed";
  initialTolerance: number;
}) {
  const [basis, setBasis] = useState<"supply" | "total" | "mixed">(initialBasis);
  const [tolerance, setTolerance] = useState<string>(String(initialTolerance));
  const utils = trpc.useUtils();

  const update = trpc.counterparties.update.useMutation({
    onSuccess() {
      toast.success("정산 기준 저장됨");
      utils.counterparties.list.invalidate();
    },
    onError(err) {
      toast.error(err.message);
    },
  });

  const isDirty = basis !== initialBasis || Number(tolerance) !== initialTolerance;

  const handleSave = () => {
    const tolNum = parseInt(tolerance) || 0;
    if (tolNum < 0) {
      toast.error("허용 오차는 0 이상이어야 합니다");
      return;
    }
    update.mutate({
      id: counterpartyId,
      restaurantId,
      settlementBasis: basis,
      settlementMatchTolerance: tolNum,
    });
  };

  return (
    <div className="border-t border-border px-4 py-3 bg-muted/20">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Receipt className="w-3 h-3" /> 정산표 OCR 대조 기준
        </span>
        {isDirty && (
          <button
            onClick={handleSave}
            disabled={update.isPending}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <Save className="w-3 h-3" /> {update.isPending ? "저장 중..." : "저장"}
          </button>
        )}
      </div>

      <div className="space-y-2">
        <div>
          <label className="text-[11px] text-muted-foreground">비교 기준</label>
          <div className="mt-1 space-y-1">
            {BASIS_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-start gap-2 cursor-pointer p-1.5 rounded hover:bg-muted/40">
                <input
                  type="radio"
                  name={`basis-${counterpartyId}`}
                  value={opt.value}
                  checked={basis === opt.value}
                  onChange={() => setBasis(opt.value as any)}
                  className="mt-0.5"
                />
                <div className="text-xs">
                  <div className="font-medium text-foreground">{opt.label}</div>
                  <div className="text-[10px] text-muted-foreground">{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[11px] text-muted-foreground">합계 비교 허용 오차 (원)</label>
          <input
            type="number"
            className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1 text-xs"
            value={tolerance}
            onChange={(e) => setTolerance(e.target.value)}
            min={0}
            placeholder="100"
          />
          <p className="text-[10px] text-muted-foreground mt-0.5">
            원단위 절상/절사 흡수용. 기본 100원.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── 거래처 추가 폼 ───────────────────────────────────────────────────────────

function AddCounterpartyForm({
  restaurantId,
  onDone,
}: {
  restaurantId: number;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("supplier");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const create = trpc.counterparties.create.useMutation({
    onSuccess() {
      toast.success("거래처 추가 완료");
      onDone();
    },
    onError(err) {
      toast.error(err.message);
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-foreground">거래처명</label>
        <input
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="거래처명 입력"
          autoFocus
        />
      </div>
      <div>
        <label className="text-sm font-medium text-foreground">유형</label>
        <select
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-foreground">담당자명</label>
          <input
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="선택"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-foreground">연락처</label>
          <input
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            placeholder="선택"
          />
        </div>
      </div>
      <div className="flex gap-2 pt-2 justify-end">
        <Button variant="outline" onClick={onDone}>
          취소
        </Button>
        <Button
          onClick={() =>
            create.mutate({
              restaurantId,
              name,
              counterpartyType: type as any,
              contactName: contactName || undefined,
              contactPhone: contactPhone || undefined,
            })
          }
          disabled={!name || create.isPending}
        >
          {create.isPending ? "추가 중..." : "추가"}
        </Button>
      </div>
    </div>
  );
}
