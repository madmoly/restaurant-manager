import { useState, useEffect } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import {
  Truck, Wallet, Receipt, Check, Clock,
  Plus, X, Save, Pencil, Trash2, Image,
  ChevronLeft, ChevronRight, Settings,
  Camera, FileText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type TabId = "orders" | "expenses" | "suppliers";

export default function PurchaseManagementPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;
  const [activeTab, setActiveTab] = useState<TabId>("orders");

  if (!restaurantId) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: "orders", label: "발주", icon: Truck },
    { id: "expenses", label: "즉시지출", icon: Receipt },
    { id: "suppliers", label: "거래처", icon: Wallet },
  ];

  return (
    <div className="max-w-3xl mx-auto">
      <div className="sticky top-0 z-10 bg-background border-b border-border">
        <div className="flex overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 flex-1 min-w-[80px] flex flex-col items-center gap-0.5 py-3 text-xs font-medium border-b-2 transition-colors ${
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

      <div className="p-4 space-y-4">
        {activeTab === "orders" && <OrdersTab restaurantId={restaurantId} />}
        {activeTab === "expenses" && <ExpensesTab restaurantId={restaurantId} />}
        {activeTab === "suppliers" && <SuppliersTab restaurantId={restaurantId} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 발주 탭: 사진+메모 등록 → 입고확인
// ═══════════════════════════════════════════════════════════════════════
function OrdersTab({ restaurantId }: { restaurantId: number }) {
  const [filter, setFilter] = useState<"all" | "ordered" | "received">("all");
  const [showForm, setShowForm] = useState(false);
  const [now] = useState(() => new Date());
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data: orders, isLoading } = trpc.purchasesV2.listOrdersByMonth.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 },
  );
  const { data: pending } = trpc.purchasesV2.pendingOrders.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );
  const utils = trpc.useUtils();

  const filteredOrders = (orders || []).filter((o: any) =>
    filter === "all" ? true : o.status === filter,
  );
  const pendingCount = pending?.length ?? 0;

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  return (
    <div className="space-y-3">
      {/* 월 네비게이션 */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="p-1"><ChevronLeft className="w-5 h-5" /></button>
        <span className="text-sm font-bold">{year}년 {month}월</span>
        <button onClick={nextMonth} className="p-1"><ChevronRight className="w-5 h-5" /></button>
      </div>

      {/* 미입고 알림 */}
      {pendingCount > 0 && (
        <div
          className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-center justify-between cursor-pointer"
          onClick={() => setFilter("ordered")}
        >
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600" />
            <span className="text-sm text-amber-800 dark:text-amber-200">미입고 발주 {pendingCount}건</span>
          </div>
          <ChevronRight className="w-4 h-4 text-amber-600" />
        </div>
      )}

      {/* 필터 + 추가 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {(["all", "ordered", "received"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {f === "all" ? "전체" : f === "ordered" ? "미입고" : "입고완료"}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setShowForm(true)} className="h-8 text-xs">
          <Plus className="w-3.5 h-3.5 mr-1" /> 발주 등록
        </Button>
      </div>

      {/* 발주 등록 폼 */}
      {showForm && (
        <OrderForm
          restaurantId={restaurantId}
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            utils.purchasesV2.listOrdersByMonth.invalidate();
            utils.purchasesV2.pendingOrders.invalidate();
          }}
        />
      )}

      {/* 목록 */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-8">로딩 중...</p>
      ) : filteredOrders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">발주 내역이 없습니다</p>
      ) : (
        filteredOrders.map((order: any) => (
          <OrderCard
            key={order.id}
            order={order}
            restaurantId={restaurantId}
            onUpdate={() => {
              utils.purchasesV2.listOrdersByMonth.invalidate();
              utils.purchasesV2.pendingOrders.invalidate();
            }}
          />
        ))
      )}
    </div>
  );
}

/** 발주 등록 폼 */
function OrderForm({
  restaurantId,
  onClose,
  onSuccess,
}: {
  restaurantId: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [counterpartyId, setCounterpartyId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  const { data: counterparties } = trpc.counterparties.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );
  const createOrder = trpc.purchasesV2.createOrder.useMutation({
    onSuccess: () => { toast.success("발주 등록 완료"); onSuccess(); },
    onError: (err: any) => toast.error(err.message || "등록 실패"),
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.url) setAttachmentUrl(data.url);
    } catch {
      toast.error("업로드 실패");
    }
    setUploading(false);
  };

  return (
    <Card className="p-4 space-y-3 border-primary/30">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">발주 등록</h3>
        <button onClick={onClose}><X className="w-4 h-4" /></button>
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground">발주일</label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-sm mt-0.5" />
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground">거래처 (선택)</label>
        <select
          value={counterpartyId ?? ""}
          onChange={(e) => setCounterpartyId(e.target.value ? Number(e.target.value) : null)}
          className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm mt-0.5"
        >
          <option value="">미지정</option>
          {(counterparties || []).map((cp: any) => (
            <option key={cp.id} value={cp.id}>{cp.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground">메모</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="발주 내용 메모..."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm mt-0.5 min-h-[60px] resize-none"
        />
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground">사진 첨부</label>
        <div className="mt-1">
          {attachmentUrl ? (
            <div className="relative">
              <img src={attachmentUrl} alt="발주 사진" className="w-full max-h-48 object-contain rounded-md border" />
              <button
                onClick={() => setAttachmentUrl("")}
                className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <label className="flex items-center justify-center gap-2 h-20 border-2 border-dashed border-border rounded-md cursor-pointer hover:border-primary/50 transition-colors">
              <Camera className="w-5 h-5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{uploading ? "업로드 중..." : "사진 촬영/선택"}</span>
              <input type="file" accept="image/*" capture="environment" onChange={handleUpload} className="hidden" />
            </label>
          )}
        </div>
      </div>

      <Button
        onClick={() => createOrder.mutate({ restaurantId, purchaseDate: date, counterpartyId, note: note || undefined, attachmentUrl: attachmentUrl || undefined })}
        disabled={createOrder.isPending}
        className="w-full h-9 text-sm"
      >
        발주 등록
      </Button>
    </Card>
  );
}

/** 발주 카드 */
function OrderCard({
  order,
  restaurantId,
  onUpdate,
}: {
  order: any;
  restaurantId: number;
  onUpdate: () => void;
}) {
  const [showReceiveForm, setShowReceiveForm] = useState(false);
  const [receiveAmount, setReceiveAmount] = useState("");
  const [showImage, setShowImage] = useState(false);

  const confirm = trpc.purchasesV2.confirmReceive.useMutation({
    onSuccess: () => { toast.success("입고 확인 완료"); onUpdate(); setShowReceiveForm(false); },
    onError: (err: any) => toast.error(err.message || "처리 실패"),
  });
  const deleteOrder = trpc.purchasesV2.deleteOrder.useMutation({
    onSuccess: () => { toast.success("삭제됨"); onUpdate(); },
  });

  const dateStr = order.purchaseDate instanceof Date
    ? order.purchaseDate.toISOString().split("T")[0]
    : String(order.purchaseDate ?? "").split("T")[0];
  const isOrdered = order.status === "ordered";

  return (
    <Card className={`p-3 ${isOrdered ? "border-amber-300 dark:border-amber-700" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant={isOrdered ? "outline" : "secondary"} className={`text-[10px] ${isOrdered ? "border-amber-500 text-amber-600" : ""}`}>
              {isOrdered ? "미입고" : "입고완료"}
            </Badge>
            <span className="text-xs text-muted-foreground">{dateStr}</span>
          </div>
          <div className="mt-1">
            {order.counterpartyName && (
              <p className="text-sm font-medium">{order.counterpartyName}</p>
            )}
            {order.note && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{order.note}</p>
            )}
            {Number(order.totalAmount) > 0 && (
              <p className="text-sm font-bold text-foreground mt-1">
                {Number(order.totalAmount).toLocaleString()}원
              </p>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">{order.createdByName}</p>
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {order.attachmentUrl && (
            <button onClick={() => setShowImage(!showImage)} className="p-1.5 rounded-md bg-muted hover:bg-muted/80">
              <Image className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
          {isOrdered && (
            <Button size="sm" variant="outline" onClick={() => setShowReceiveForm(!showReceiveForm)} className="h-7 text-[10px] px-2">
              <Check className="w-3 h-3 mr-0.5" /> 입고확인
            </Button>
          )}
        </div>
      </div>

      {/* 사진 미리보기 */}
      {showImage && order.attachmentUrl && (
        <div className="mt-2">
          <img src={order.attachmentUrl} alt="발주 사진" className="w-full max-h-60 object-contain rounded-md border" />
        </div>
      )}

      {/* 입고 확인 폼 */}
      {showReceiveForm && (
        <div className="mt-3 pt-3 border-t space-y-2">
          <div>
            <label className="text-[10px] text-muted-foreground">입고 금액 (원)</label>
            <Input
              type="number"
              value={receiveAmount}
              onChange={(e) => setReceiveAmount(e.target.value)}
              placeholder="금액 입력 (선택)"
              className="h-8 text-sm mt-0.5"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => confirm.mutate({
                id: order.id,
                totalAmount: receiveAmount ? receiveAmount : undefined,
              })}
              disabled={confirm.isPending}
              className="flex-1 h-8 text-xs"
            >
              <Check className="w-3.5 h-3.5 mr-1" /> 입고 확인
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowReceiveForm(false)} className="h-8 text-xs">
              취소
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 즉시지출 탭
// ═══════════════════════════════════════════════════════════════════════
function ExpensesTab({ restaurantId }: { restaurantId: number }) {
  const [now] = useState(() => new Date());
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [showForm, setShowForm] = useState(false);
  const [showCategoryMgr, setShowCategoryMgr] = useState(false);

  // 카테고리 자동 시드
  const seedCategories = trpc.dailyExpenses.seedDefaultCategories.useMutation();
  const { data: categories, isLoading: catLoading } = trpc.dailyExpenses.listCategories.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );
  const { data: expenses, isLoading } = trpc.dailyExpenses.listByMonth.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 },
  );
  const { data: summary } = trpc.dailyExpenses.monthlySummary.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 },
  );
  const utils = trpc.useUtils();

  // 카테고리가 없으면 자동 시드
  useEffect(() => {
    if (!catLoading && categories && categories.length === 0) {
      seedCategories.mutate({ restaurantId }, {
        onSuccess: () => utils.dailyExpenses.listCategories.invalidate(),
      });
    }
  }, [catLoading, categories]);

  const totalExpense = (summary || []).reduce((s: number, r: any) => s + r.total, 0);

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  return (
    <div className="space-y-3">
      {/* 월 네비게이션 */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="p-1"><ChevronLeft className="w-5 h-5" /></button>
        <span className="text-sm font-bold">{year}년 {month}월</span>
        <button onClick={nextMonth} className="p-1"><ChevronRight className="w-5 h-5" /></button>
      </div>

      {/* 월 합계 + 카테고리별 */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">월 즉시지출 합계</span>
          <span className="text-lg font-bold">{totalExpense.toLocaleString()}원</span>
        </div>
        {(summary || []).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {(summary || []).map((s: any, i: number) => (
              <Badge key={i} variant="secondary" className="text-[10px]">
                {s.categoryName} {s.total.toLocaleString()}원
              </Badge>
            ))}
          </div>
        )}
      </Card>

      {/* 추가 + 카테고리 관리 */}
      <div className="flex items-center justify-between">
        <Button size="sm" variant="outline" onClick={() => setShowCategoryMgr(!showCategoryMgr)} className="h-8 text-xs">
          <Settings className="w-3.5 h-3.5 mr-1" /> 카테고리 관리
        </Button>
        <Button size="sm" onClick={() => setShowForm(true)} className="h-8 text-xs">
          <Plus className="w-3.5 h-3.5 mr-1" /> 지출 등록
        </Button>
      </div>

      {/* 카테고리 관리 */}
      {showCategoryMgr && (
        <CategoryManager
          restaurantId={restaurantId}
          categories={categories || []}
          onClose={() => setShowCategoryMgr(false)}
        />
      )}

      {/* 지출 등록 폼 */}
      {showForm && (
        <ExpenseForm
          restaurantId={restaurantId}
          categories={categories || []}
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            utils.dailyExpenses.listByMonth.invalidate();
            utils.dailyExpenses.monthlySummary.invalidate();
          }}
        />
      )}

      {/* 목록 */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-8">로딩 중...</p>
      ) : (expenses || []).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">지출 내역이 없습니다</p>
      ) : (
        (expenses || []).map((exp: any) => (
          <ExpenseCard
            key={exp.id}
            expense={exp}
            restaurantId={restaurantId}
            onUpdate={() => {
              utils.dailyExpenses.listByMonth.invalidate();
              utils.dailyExpenses.monthlySummary.invalidate();
            }}
          />
        ))
      )}
    </div>
  );
}

/** 카테고리 관리 */
function CategoryManager({
  restaurantId,
  categories,
  onClose,
}: {
  restaurantId: number;
  categories: any[];
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  const utils = trpc.useUtils();

  const createCat = trpc.dailyExpenses.createCategory.useMutation({
    onSuccess: () => {
      toast.success("카테고리 추가됨");
      setNewName("");
      utils.dailyExpenses.listCategories.invalidate();
    },
    onError: (err: any) => toast.error(err.message || "추가 실패"),
  });
  const deactivateCat = trpc.dailyExpenses.deactivateCategory.useMutation({
    onSuccess: () => {
      toast.success("카테고리 삭제됨");
      utils.dailyExpenses.listCategories.invalidate();
    },
  });

  return (
    <Card className="p-3 space-y-2 border-primary/30">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">지출 카테고리 관리</h3>
        <button onClick={onClose}><X className="w-4 h-4" /></button>
      </div>
      {categories.map((cat: any) => (
        <div key={cat.id} className="flex items-center justify-between py-1">
          <span className="text-sm">{cat.name}</span>
          <button
            onClick={() => { if (window.confirm(`"${cat.name}" 카테고리를 삭제하시겠습니까?`)) deactivateCat.mutate({ id: cat.id }); }}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="새 카테고리명"
          className="h-8 text-sm flex-1"
          onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) createCat.mutate({ restaurantId, name: newName.trim() }); }}
        />
        <Button
          size="sm"
          onClick={() => { if (newName.trim()) createCat.mutate({ restaurantId, name: newName.trim() }); }}
          disabled={!newName.trim() || createCat.isPending}
          className="h-8 text-xs"
        >
          추가
        </Button>
      </div>
    </Card>
  );
}

/** 지출 등록 폼 */
function ExpenseForm({
  restaurantId,
  categories,
  onClose,
  onSuccess,
}: {
  restaurantId: number;
  categories: any[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [categoryId, setCategoryId] = useState<number>(categories[0]?.id ?? 0);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  const create = trpc.dailyExpenses.create.useMutation({
    onSuccess: () => { toast.success("지출 등록 완료"); onSuccess(); },
    onError: (err: any) => toast.error(err.message || "등록 실패"),
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.url) setAttachmentUrl(data.url);
    } catch {
      toast.error("업로드 실패");
    }
    setUploading(false);
  };

  return (
    <Card className="p-4 space-y-3 border-primary/30">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">즉시지출 등록</h3>
        <button onClick={onClose}><X className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground">지출일</label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-sm mt-0.5" />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">카테고리</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(Number(e.target.value))}
            className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm mt-0.5"
          >
            {categories.map((cat: any) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground">제목</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="지출 내용" className="h-8 text-sm mt-0.5" />
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground">금액 (원)</label>
        <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="h-8 text-sm mt-0.5" />
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground">메모</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="상세 메모 (선택)"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm mt-0.5 min-h-[40px] resize-none"
        />
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground">사진 첨부</label>
        <div className="mt-1">
          {attachmentUrl ? (
            <div className="relative">
              <img src={attachmentUrl} alt="지출 사진" className="w-full max-h-48 object-contain rounded-md border" />
              <button onClick={() => setAttachmentUrl("")} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <label className="flex items-center justify-center gap-2 h-16 border-2 border-dashed border-border rounded-md cursor-pointer hover:border-primary/50">
              <Camera className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{uploading ? "업로드 중..." : "사진 첨부"}</span>
              <input type="file" accept="image/*" capture="environment" onChange={handleUpload} className="hidden" />
            </label>
          )}
        </div>
      </div>

      <Button
        onClick={() => {
          if (!title.trim()) { toast.error("제목을 입력해주세요"); return; }
          if (!categoryId) { toast.error("카테고리를 선택해주세요"); return; }
          create.mutate({
            restaurantId,
            expenseDate: date,
            categoryId,
            title: title.trim(),
            amount: Number(amount) || 0,
            note: note || undefined,
            attachmentUrl: attachmentUrl || undefined,
          });
        }}
        disabled={create.isPending}
        className="w-full h-9 text-sm"
      >
        지출 등록
      </Button>
    </Card>
  );
}

/** 지출 카드 */
function ExpenseCard({
  expense,
  restaurantId,
  onUpdate,
}: {
  expense: any;
  restaurantId: number;
  onUpdate: () => void;
}) {
  const [showImage, setShowImage] = useState(false);
  const deleteExp = trpc.dailyExpenses.delete.useMutation({
    onSuccess: () => { toast.success("삭제됨"); onUpdate(); },
  });

  const dateStr = String(expense.expenseDate ?? "").split("T")[0];
  const catName = expense.categoryName || expense.category || "기타";

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">{catName}</Badge>
            <span className="text-xs text-muted-foreground">{dateStr}</span>
          </div>
          <p className="text-sm font-medium mt-1">{expense.title}</p>
          {expense.note && <p className="text-xs text-muted-foreground mt-0.5">{expense.note}</p>}
          <p className="text-sm font-bold mt-1">{Number(expense.amount).toLocaleString()}원</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {expense.attachmentUrl && (
            <button onClick={() => setShowImage(!showImage)} className="p-1.5 rounded-md bg-muted hover:bg-muted/80">
              <Image className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
          <button
            onClick={() => { if (window.confirm("이 지출을 삭제하시겠습니까?")) deleteExp.mutate({ id: expense.id, restaurantId }); }}
            className="p-1.5 rounded-md hover:bg-destructive/10"
          >
            <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
          </button>
        </div>
      </div>
      {showImage && expense.attachmentUrl && (
        <div className="mt-2">
          <img src={expense.attachmentUrl} alt="지출 사진" className="w-full max-h-60 object-contain rounded-md border" />
        </div>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 거래처 관리 탭
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
