import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import {
  ArrowUpDown, TrendingUp, TrendingDown,
  Package, Wallet,
  ChevronDown, ChevronUp, Pencil, X, Save,
  ChevronLeft, ChevronRight,
  CalendarRange, AlertTriangle, Merge, CheckSquare, Square,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type TabId = "master" | "analysis" | "history";

export default function PurchaseManagementPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;
  const [activeTab, setActiveTab] = useState<TabId>("master");

  if (!restaurantId) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: "master", label: "품목마스터", icon: Package },
    { id: "analysis", label: "가격분석", icon: ArrowUpDown },
    { id: "history", label: "매입현황", icon: CalendarRange },
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
        {activeTab === "master" && <ItemMasterTab restaurantId={restaurantId} />}
        {activeTab === "analysis" && <PriceAnalysisTab restaurantId={restaurantId} />}
        {activeTab === "history" && <MonthlyPurchaseTab restaurantId={restaurantId} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 품목마스터 탭: 품목-거래처 매핑 + 기준단위가 표시
// ═══════════════════════════════════════════════════════════════════════
// 병합 확인 패널에 전달할 품목 타입
type MergeCandidate = { id: number; name: string; counterpartyCount?: number; purchaseCount?: number };

function MergeConfirmPanel({
  items: candidates,
  isPending,
  onConfirm,
  onCancel,
}: {
  items: MergeCandidate[];
  isPending: boolean;
  onConfirm: (targetId: number, sourceIds: number[], targetName?: string) => void;
  onCancel: () => void;
}) {
  const [selectedId, setSelectedId] = useState(() => {
    // 기본: 거래처 많은 순 → 이름순
    const sorted = [...candidates].sort((a, b) =>
      (b.counterpartyCount ?? 0) - (a.counterpartyCount ?? 0) || a.name.localeCompare(b.name)
    );
    return sorted[0].id;
  });
  const [customName, setCustomName] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  const finalName = useCustom ? customName.trim() : candidates.find(c => c.id === selectedId)?.name || "";
  const canConfirm = finalName.length > 0 && candidates.length >= 2;

  const handleConfirm = () => {
    const sourceIds = candidates.filter(c => c.id !== selectedId).map(c => c.id);
    const selectedItem = candidates.find(c => c.id === selectedId);
    // targetName은 기존 이름과 다를 때만 전달
    const targetName = useCustom && customName.trim() !== selectedItem?.name
      ? customName.trim()
      : !useCustom ? undefined : undefined;
    onConfirm(selectedId, sourceIds, targetName);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onCancel}>
          <ChevronLeft className="w-3.5 h-3.5 mr-1" /> 돌아가기
        </Button>
        <h2 className="text-sm font-bold text-foreground">품목 병합</h2>
      </div>

      <Card className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          대표 품목을 선택하세요. 나머지 품목의 매입 이력과 거래처 매핑이 대표 품목으로 통합됩니다.
        </p>

        <div className="space-y-1.5">
          {candidates.map(item => (
            <button
              key={item.id}
              onClick={() => { setSelectedId(item.id); setUseCustom(false); }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                !useCustom && selectedId === item.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/30"
              }`}
            >
              <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                !useCustom && selectedId === item.id ? "border-primary" : "border-muted-foreground/40"
              }`}>
                {!useCustom && selectedId === item.id && (
                  <div className="w-2 h-2 rounded-full bg-primary" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <span className="font-medium text-foreground text-sm">{item.name}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  {item.counterpartyCount != null && `거래처 ${item.counterpartyCount}곳`}
                  {item.purchaseCount != null && ` · ${item.purchaseCount}건`}
                </span>
              </div>
            </button>
          ))}

          {/* 직접 입력 옵션 */}
          <button
            onClick={() => {
              setUseCustom(true);
              if (!customName) setCustomName(candidates.find(c => c.id === selectedId)?.name || "");
            }}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
              useCustom ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
            }`}
          >
            <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
              useCustom ? "border-primary" : "border-muted-foreground/40"
            }`}>
              {useCustom && <div className="w-2 h-2 rounded-full bg-primary" />}
            </div>
            <span className="text-sm text-muted-foreground">직접 입력</span>
          </button>
          {useCustom && (
            <Input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="병합 후 품목명 입력..."
              className="h-9 text-sm ml-7"
              autoFocus
            />
          )}
        </div>
      </Card>

      {/* 미리보기 */}
      {canConfirm && (
        <Card className="p-3 bg-muted/30">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">"{finalName}"</span>으로 병합됩니다.
            {candidates.length - 1}개 품목이 비활성화되고 매입 이력이 통합됩니다.
          </p>
        </Card>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1 h-10" onClick={onCancel}>
          취소
        </Button>
        <Button
          size="sm"
          className="flex-1 h-10"
          onClick={handleConfirm}
          disabled={!canConfirm || isPending}
        >
          <Merge className="w-3.5 h-3.5 mr-1" />
          {isPending ? "처리 중..." : "병합 확정"}
        </Button>
      </div>
    </div>
  );
}

// 배너 무시 저장 키
const DISMISSED_KEY = "purchase_dismissed_similar_groups";
function getDismissed(restaurantId: number): Set<string> {
  try {
    const raw = localStorage.getItem(`${DISMISSED_KEY}_${restaurantId}`);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}
function setDismissed(restaurantId: number, keys: Set<string>) {
  localStorage.setItem(`${DISMISSED_KEY}_${restaurantId}`, JSON.stringify([...keys]));
}
function groupKey(items: { id: number }[]) {
  return items.map(i => i.id).sort((a, b) => a - b).join(",");
}

function ItemMasterTab({ restaurantId }: { restaurantId: number }) {
  const [search, setSearch] = useState("");
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const [showSuppliers, setShowSuppliers] = useState(false);
  const [showSimilar, setShowSimilar] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dismissed, setDismissedState] = useState(() => getDismissed(restaurantId));
  // 병합 확인 패널
  const [mergeItems, setMergeItems] = useState<MergeCandidate[] | null>(null);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.items.listWithMappings.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  // 유사품목 감지
  const { data: similarData } = trpc.items.findSimilarGroups.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );
  const similarGroups = (similarData?.groups || []).filter(
    g => !dismissed.has(groupKey(g.items))
  );

  const mergeMutation = trpc.items.merge.useMutation({
    onSuccess() {
      toast.success("품목이 병합되었습니다");
      setMergeItems(null);
      setSelected(new Set());
      setSelectMode(false);
      utils.items.listWithMappings.invalidate();
      utils.items.findSimilarGroups.invalidate();
    },
    onError(err: any) { toast.error(err.message || "병합 실패"); },
  });

  // 배너 그룹 → 병합 확인 패널
  const openBannerMerge = (group: typeof similarGroups[0]) => {
    setMergeItems(group.items.map(i => ({
      id: i.id, name: i.name,
      counterpartyCount: i.counterpartyCount, purchaseCount: i.purchaseCount,
    })));
  };

  // 배너 그룹 무시
  const dismissGroup = (group: typeof similarGroups[0]) => {
    const key = groupKey(group.items);
    const next = new Set(dismissed);
    next.add(key);
    setDismissedState(next);
    setDismissed(restaurantId, next);
  };

  // 수동 선택 → 병합 확인 패널
  const openManualMerge = () => {
    const selectedItems = (data || []).filter((i: any) => selected.has(i.itemId));
    if (selectedItems.length < 2) return;
    setMergeItems(selectedItems.map((i: any) => ({
      id: i.itemId, name: i.itemName, counterpartyCount: i.counterpartyCount,
    })));
  };

  const toggleSelect = (itemId: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  };

  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()); };

  const items = (data || []).filter((item: any) =>
    !search || item.itemName.toLowerCase().includes(search.toLowerCase())
  );

  // 병합 확인 패널 표시 중
  if (mergeItems) {
    return (
      <MergeConfirmPanel
        items={mergeItems}
        isPending={mergeMutation.isPending}
        onConfirm={(targetId, sourceIds, targetName) => {
          mergeMutation.mutate({ targetId, sourceIds, targetName });
        }}
        onCancel={() => setMergeItems(null)}
      />
    );
  }

  if (showSuppliers) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setShowSuppliers(false)}>
          <ChevronLeft className="w-3.5 h-3.5 mr-1" /> 품목마스터로 돌아가기
        </Button>
        <SuppliersSubView restaurantId={restaurantId} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="품목명 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 h-9 text-sm"
        />
        {selectMode ? (
          <Button variant="ghost" size="sm" className="h-9 text-xs shrink-0" onClick={exitSelectMode}>
            <X className="w-3.5 h-3.5 mr-1" /> 취소
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" className="h-9 text-xs shrink-0" onClick={() => setSelectMode(true)}>
              <Merge className="w-3.5 h-3.5 mr-1" /> 병합
            </Button>
            <Button variant="outline" size="sm" className="h-9 text-xs shrink-0" onClick={() => setShowSuppliers(true)}>
              <Wallet className="w-3.5 h-3.5 mr-1" /> 거래처
            </Button>
          </>
        )}
      </div>

      {/* 유사품목 경고 배너 */}
      {similarGroups.length > 0 && (
        <Card className="border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20">
          <button
            onClick={() => setShowSimilar(!showSimilar)}
            className="w-full flex items-center justify-between p-3 text-left"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
                유사한 이름의 품목 {similarGroups.length}건 감지
              </span>
            </div>
            {showSimilar ? <ChevronUp className="w-4 h-4 text-amber-600" /> : <ChevronDown className="w-4 h-4 text-amber-600" />}
          </button>
          {showSimilar && (
            <div className="px-3 pb-3 space-y-2">
              {similarGroups.map((group, gi) => (
                <div key={gi} className="bg-white dark:bg-background rounded-md border border-border p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-wrap gap-1 items-center text-xs">
                      {group.items.map((item, ii) => (
                        <span key={item.id}>
                          {ii > 0 && <span className="text-muted-foreground mx-0.5">↔</span>}
                          <span className="font-medium text-foreground">"{item.name}"</span>
                          <span className="text-muted-foreground ml-0.5">({item.purchaseCount}건)</span>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-muted-foreground" onClick={() => dismissGroup(group)}>
                        무시
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openBannerMerge(group)}>
                        <Merge className="w-3 h-3 mr-1" /> 병합
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-8">로딩 중...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">품목 데이터가 없습니다</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item: any) => {
            const expanded = !selectMode && expandedItem === item.itemId;
            const isSelected = selected.has(item.itemId);
            return (
              <Card key={item.itemId} className={`overflow-hidden ${selectMode && isSelected ? "ring-2 ring-primary" : ""}`}>
                <button
                  onClick={() => selectMode ? toggleSelect(item.itemId) : setExpandedItem(expanded ? null : item.itemId)}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {selectMode && (
                      isSelected
                        ? <CheckSquare className="w-4.5 h-4.5 text-primary shrink-0" />
                        : <Square className="w-4.5 h-4.5 text-muted-foreground shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground text-sm truncate">{item.itemName}</span>
                        {item.baseUnit && <span className="text-[10px] text-muted-foreground">({item.baseUnit})</span>}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        거래처 {item.counterpartyCount}곳
                      {item.minBasePrice != null && <> · 최저 ₩{item.minBasePrice.toLocaleString()}/{item.baseUnit || '개'}</>}
                    </span>
                    </div>
                  </div>
                  {!selectMode && (expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />)}
                </button>
                {expanded && item.mappings.length > 0 && (
                  <div className="border-t border-border px-3 pb-3 pt-2 space-y-1">
                    {item.mappings.map((m: any) => (
                      <div key={m.ciId} className="flex items-center justify-between text-xs py-1.5 px-2 bg-muted/20 rounded">
                        <div className="min-w-0">
                          <span className="text-foreground">{m.counterpartyName}</span>
                          {m.purchaseUnit && <span className="text-muted-foreground ml-1">({m.purchaseUnit})</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 tabular-nums">
                          {m.basePricePerUnit != null && (
                            <span className="font-medium text-foreground">₩{m.basePricePerUnit.toLocaleString()}/{item.baseUnit || '개'}</span>
                          )}
                          {m.lastReceivedDate && (
                            <span className="text-[10px] text-muted-foreground">
                              {typeof m.lastReceivedDate === 'string' ? m.lastReceivedDate.substring(0, 10) : new Date(m.lastReceivedDate).toISOString().substring(0, 10)}
                            </span>
                          )}
                          {m.isPreferred && <span className="text-[9px] text-green-600 dark:text-green-400">주거래</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {expanded && item.mappings.length === 0 && (
                  <div className="border-t border-border px-3 py-3 text-xs text-muted-foreground text-center">
                    거래처 매핑 없음
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* 수동 병합 플로팅 바 */}
      {selectMode && selected.size >= 2 && (
        <div className="sticky bottom-4 z-20">
          <Card className="flex items-center justify-between p-3 shadow-lg border-primary/30 bg-background">
            <span className="text-sm font-medium text-foreground">
              {selected.size}개 품목 선택됨
            </span>
            <Button size="sm" className="h-8 text-xs" onClick={openManualMerge} disabled={mergeMutation.isPending}>
              <Merge className="w-3.5 h-3.5 mr-1" /> 병합
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 가격분석 탭: 거래처비교 + 가격추이 세그먼트 토글
// ═══════════════════════════════════════════════════════════════════════
function PriceAnalysisTab({ restaurantId }: { restaurantId: number }) {
  const [view, setView] = useState<"compare" | "trend">("compare");

  return (
    <div className="space-y-3">
      <div className="flex bg-muted/50 rounded-lg p-0.5">
        <button
          onClick={() => setView("compare")}
          className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
            view === "compare" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          거래처 비교
        </button>
        <button
          onClick={() => setView("trend")}
          className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
            view === "trend" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          가격 추이
        </button>
      </div>
      {view === "compare" ? <PriceCompareTab restaurantId={restaurantId} /> : <PriceTrendTab restaurantId={restaurantId} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 거래처 관리 서브뷰 (품목마스터 탭 내)
// ═══════════════════════════════════════════════════════════════════════
const CP_TYPE_LABELS: Record<string, string> = {
  supplier: "공급업체", online: "온라인", mart: "마트", repair: "수리/AS", other: "기타",
};
const CP_TYPES = ["supplier", "online", "mart", "repair", "other"] as const;

function SuppliersSubView({ restaurantId }: { restaurantId: number }) {
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
                const prices = item.suppliers.map((s: any) => Number(s.basePricePerUnit ?? s.unitPrice));
                const minPrice = Math.min(...prices);
                const maxPrice = Math.max(...prices);
                const unit = item.baseUnit || '개';
                return (
                  <Card key={item.itemName} className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground text-sm">{item.itemName}</span>
                        {item.baseUnit && <span className="text-[10px] text-muted-foreground">({item.baseUnit})</span>}
                      </div>
                      {maxPrice > minPrice && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300">
                          차이 ₩{(maxPrice - minPrice).toLocaleString()}/{unit}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1">
                      {item.suppliers
                        .sort((a: any, b: any) => Number(a.basePricePerUnit ?? a.unitPrice) - Number(b.basePricePerUnit ?? b.unitPrice))
                        .map((s: any, si: number) => {
                          const price = Number(s.basePricePerUnit ?? s.unitPrice);
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
                                  ₩{price.toLocaleString()}/{unit}
                                </span>
                                {s.conversionNote && <span className="text-[9px] text-muted-foreground">{s.conversionNote}</span>}
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
              {singleSupplierItems.map((item: any) => {
                const s = item.suppliers[0];
                const price = Number(s?.basePricePerUnit ?? s?.unitPrice ?? 0);
                const unit = item.baseUnit || '개';
                return (
                  <div key={item.itemName} className="flex items-center justify-between px-3 py-2 bg-muted/20 rounded text-xs">
                    <span className="text-foreground">{item.itemName}</span>
                    <span className="text-muted-foreground">
                      {s?.counterpartyName} · ₩{price.toLocaleString()}/{unit}
                    </span>
                  </div>
                );
              })}
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
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const isCurrentMonth = year === now.getFullYear() && month === (now.getMonth() + 1);

  const { data, isLoading } = trpc.purchasesV2.monthlySummaryByCounterparty.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 },
  );

  const { data: expensesData, isLoading: isExpensesLoading } =
    trpc.dailyExpenses.monthlySummary.useQuery(
      { restaurantId, year, month },
      { enabled: restaurantId > 0 },
    );

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
    setExpandedCp(null);
    setExpandedOrder(null);
    setExpandedCat(null);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
    setExpandedCp(null);
    setExpandedOrder(null);
    setExpandedCat(null);
  };

  const cpList = data || [];
  const purchaseTotal = cpList.reduce((s, c) => s + c.totalAmount, 0);
  const totalOrders = cpList.reduce((s, c) => s + c.orderCount, 0);

  const expBreakdown = expensesData?.breakdown ?? [];
  const expenseTotal = Number(expensesData?.total ?? 0);
  const expItemCount = expBreakdown.reduce((s, b) => s + b.items.length, 0);
  const combinedTotal = purchaseTotal + expenseTotal;
  const loading = isLoading || isExpensesLoading;
  const hasData = cpList.length > 0 || expBreakdown.length > 0;

  return (
    <div className="space-y-4">
      {/* 월 선택 */}
      <div className="flex items-center justify-center gap-3">
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={prevMonth}>
          <ChevronLeft size={16} />
        </Button>
        <span className={`text-sm font-semibold min-w-[120px] text-center ${isCurrentMonth ? "text-primary" : ""}`}>
          {year}년 {month}월
          {isCurrentMonth && <span className="ml-1 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full align-middle font-medium">이번달</span>}
        </span>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={nextMonth}>
          <ChevronRight size={16} />
        </Button>
      </div>

      {/* 월 합계 요약 — 매입 / 즉시지출 / 합계 */}
      {!loading && hasData && (
        <Card className="p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              매입 · 거래처 {cpList.length}곳 · 전표 {totalOrders}건
            </span>
            <span className="text-sm font-semibold text-foreground tabular-nums">
              ₩{purchaseTotal.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              즉시지출 · 카테고리 {expBreakdown.length}개 · 항목 {expItemCount}건
            </span>
            <span className="text-sm font-semibold text-foreground tabular-nums">
              ₩{expenseTotal.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-1.5">
            <span className="text-sm font-medium text-foreground">합계</span>
            <span className="text-base font-bold text-primary tabular-nums">
              ₩{combinedTotal.toLocaleString()}
            </span>
          </div>
        </Card>
      )}

      {/* 거래처별 목록 */}
      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">로딩 중...</p>
      ) : !hasData ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {year}년 {month}월 매입 데이터가 없습니다
        </Card>
      ) : (
        <>
          {cpList.length > 0 && (
            <>
              <div className="text-xs font-medium text-muted-foreground px-1 pt-1">매입 (거래처별)</div>
              {cpList.map((cp) => {
          const cpKey = cp.counterpartyName;
          const isExpanded = expandedCp === cpKey;
          const pct = purchaseTotal > 0 ? ((cp.totalAmount / purchaseTotal) * 100).toFixed(1) : "0";

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
              })}
            </>
          )}

          {expBreakdown.length > 0 && (
            <>
              <div className="text-xs font-medium text-muted-foreground px-1 pt-3">즉시지출 (카테고리별)</div>
              {expBreakdown.map((cat) => {
                const catKey = String(cat.categoryId ?? cat.categoryName);
                const isExpanded = expandedCat === catKey;
                const pct = expenseTotal > 0 ? ((cat.amount / expenseTotal) * 100).toFixed(1) : "0";
                return (
                  <Card key={catKey} className="overflow-hidden">
                    <button
                      onClick={() => setExpandedCat(isExpanded ? null : catKey)}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-foreground text-sm truncate">{cat.categoryName}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{cat.items.length}건</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          <span className="text-sm font-bold text-foreground tabular-nums">
                            ₩{cat.amount.toLocaleString()}
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-1">({pct}%)</span>
                        </div>
                        {isExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-border divide-y divide-border">
                        {cat.items.map((it, idx) => (
                          <div key={idx} className="px-4 py-2 flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs text-muted-foreground tabular-nums">{it.date}</span>
                              <span className="text-foreground truncate">{it.title}</span>
                            </div>
                            <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">
                              ₩{it.amount.toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                );
              })}
            </>
          )}
        </>
      )}
    </div>
  );
}
