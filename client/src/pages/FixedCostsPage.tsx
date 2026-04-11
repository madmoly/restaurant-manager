import { useState, useRef } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import { Plus, Wallet, Trash2, Paperclip, ExternalLink, Loader2, Pencil, ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { Button, Card, Input, Select, PageHeader, EmptyState, Loading, Modal, Badge, StatCard } from "@/components/ui/compat";

const COST_TYPE_OPTIONS = [
  { value: "monthly", label: "월 고정" },
  { value: "yearly", label: "연간 (월할)" },
  { value: "quarterly", label: "분기별 (3개월할)" },
  { value: "sales_ratio", label: "매출대비 %" },
];

const CATEGORY_OPTIONS = [
  { value: "임대료", label: "임대료" },
  { value: "관리비", label: "관리비" },
  { value: "보험", label: "보험" },
  { value: "로열티/수수료", label: "로열티/수수료" },
  { value: "유틸리티", label: "유틸리티" },
  { value: "기타", label: "기타" },
];

const COST_TYPE_LABELS: Record<string, string> = {
  monthly: "월 고정",
  yearly: "연간",
  quarterly: "분기별",
  sales_ratio: "매출%",
  one_time: "일회성",
};

const BADGE_VARIANTS: Record<string, string> = {
  monthly: "info",
  yearly: "warning",
  quarterly: "default",
  sales_ratio: "success",
  one_time: "default",
};

export default function FixedCostsPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);

  // 월별 조회
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1);

  const utils = trpc.useUtils();
  const { data: list, isLoading } = trpc.fixedCosts.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );
  const { data: monthlyTotal } = trpc.fixedCosts.monthlyTotal.useQuery(
    { restaurantId, year: viewYear, month: viewMonth },
    { enabled: restaurantId > 0 },
  );

  const deactivate = trpc.fixedCosts.deactivate.useMutation({
    onSuccess() {
      toast.success("삭제됨");
      utils.fixedCosts.list.invalidate();
      utils.fixedCosts.monthlyTotal.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const invalidateAll = () => {
    utils.fixedCosts.list.invalidate();
    utils.fixedCosts.monthlyTotal.invalidate();
  };

  if (!restaurantId) return <EmptyState icon={<Wallet size={40} />} title="매장을 선택해주세요" />;

  // 월 이동
  const prevMonth = () => {
    if (viewMonth === 1) { setViewYear(viewYear - 1); setViewMonth(12); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 12) { setViewYear(viewYear + 1); setViewMonth(1); }
    else setViewMonth(viewMonth + 1);
  };
  const goToday = () => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth() + 1); };
  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth() + 1;

  // 카테고리별 그룹핑
  const grouped = groupByCategory(list ?? []);

  return (
    <div>
      <PageHeader
        title="고정비 관리"
        description={current?.name}
        action={<Button onClick={() => setShowAdd(true)} size="sm"><Plus size={16} /> 추가</Button>}
      />

      {/* 월 선택 네비 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-accent transition-colors">
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-semibold text-foreground min-w-[100px] text-center">
            {viewYear}년 {viewMonth}월
          </span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-accent transition-colors">
            <ChevronRight size={18} />
          </button>
        </div>
        {!isCurrentMonth && (
          <button onClick={goToday} className="flex items-center gap-1 text-xs text-primary hover:underline">
            <Calendar size={12} /> 이번달
          </button>
        )}
      </div>

      {/* 이번달 고정비 총액 */}
      {monthlyTotal && (
        <div className="mb-5 space-y-2">
          <StatCard
            icon={<Wallet size={14} />}
            label={`${viewYear}년 ${viewMonth}월 고정비`}
            value={Number(monthlyTotal.total).toLocaleString()}
            unit="원"
          />
          {(monthlyTotal as any).ratioItems?.length > 0 && (
            <div className="px-4 py-2 bg-muted/50 rounded-lg space-y-1">
              <p className="text-xs text-muted-foreground">매출대비 비율 항목 (매출 입력 시 자동 계산)</p>
              {(monthlyTotal as any).ratioItems.map((r: any, i: number) => (
                <span key={i} className="text-xs text-foreground mr-3">{r.name}: {r.ratio}%</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 추가 모달 */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="고정비 추가">
        <FixedCostForm
          restaurantId={restaurantId}
          onDone={() => { setShowAdd(false); invalidateAll(); }}
        />
      </Modal>

      {/* 수정 모달 */}
      <Modal open={!!editItem} onClose={() => setEditItem(null)} title="고정비 수정">
        {editItem && (
          <FixedCostForm
            restaurantId={restaurantId}
            initial={editItem}
            onDone={() => { setEditItem(null); invalidateAll(); }}
          />
        )}
      </Modal>

      {/* 고정비 목록 — 카테고리별 */}
      {isLoading ? <Loading /> : !list?.length ? (
        <EmptyState
          icon={<Wallet size={36} />}
          title="등록된 고정비가 없습니다"
          description="임대료, 관리비 등 매월 발생하는 비용을 등록하세요"
        />
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">{cat}</h3>
              <div className="space-y-2">
                {items.map((fc: any) => (
                  <Card key={fc.id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span className="text-sm font-medium text-foreground truncate">{fc.costName}</span>
                        <Badge variant={(BADGE_VARIANTS[fc.costType] ?? "default") as any}>
                          {COST_TYPE_LABELS[fc.costType] ?? fc.costType}
                        </Badge>
                        {fc.startMonth && (
                          <span className="text-[10px] text-muted-foreground">
                            {fc.startMonth}{fc.endMonth ? ` ~ ${fc.endMonth}` : " ~"}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {fc.costType === "sales_ratio" ? (
                          <span className="text-sm font-semibold text-foreground tabular-nums">{Number(fc.amount)}%</span>
                        ) : (
                          <div className="text-right">
                            <span className="text-sm font-semibold text-foreground tabular-nums">
                              {Number(fc.amount).toLocaleString()}원
                            </span>
                            {fc.costType === "yearly" && (
                              <span className="text-[10px] text-muted-foreground ml-1">
                                월 {Math.round(Number(fc.amount) / 12).toLocaleString()}
                              </span>
                            )}
                            {fc.costType === "quarterly" && (
                              <span className="text-[10px] text-muted-foreground ml-1">
                                월 {Math.round(Number(fc.amount) / 3).toLocaleString()}
                              </span>
                            )}
                          </div>
                        )}
                        <button
                          onClick={() => setEditItem(fc)}
                          className="text-muted-foreground/50 hover:text-primary p-1"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`"${fc.costName}" 삭제하시겠습니까?`))
                              deactivate.mutate({ id: fc.id, restaurantId });
                          }}
                          className="text-muted-foreground/50 hover:text-red-500 p-1"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    {(fc.note || fc.attachmentUrl) && (
                      <div className="flex items-center gap-3 mt-1.5">
                        {fc.note && <p className="text-xs text-muted-foreground flex-1">{fc.note}</p>}
                        {fc.attachmentUrl && (
                          <a href={fc.attachmentUrl} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-primary hover:underline shrink-0">
                            <Paperclip size={11} /> 첨부 <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 카테고리별 그룹핑 (카테고리 순서 유지) */
function groupByCategory(items: any[]) {
  const order = ["임대료", "관리비", "보험", "로열티/수수료", "유틸리티", "기타"];
  const result: Record<string, any[]> = {};
  for (const item of items) {
    const cat = item.category || "기타";
    if (!result[cat]) result[cat] = [];
    result[cat].push(item);
  }
  // 순서 정렬
  const sorted: Record<string, any[]> = {};
  for (const cat of order) {
    if (result[cat]) sorted[cat] = result[cat];
  }
  // order에 없는 카테고리
  for (const cat of Object.keys(result)) {
    if (!sorted[cat]) sorted[cat] = result[cat];
  }
  return sorted;
}

/** 추가/수정 공통 폼 */
function FixedCostForm({
  restaurantId,
  initial,
  onDone,
}: {
  restaurantId: number;
  initial?: any;
  onDone: () => void;
}) {
  const isEdit = !!initial;
  const [costName, setCostName] = useState(initial?.costName ?? "");
  const [costType, setCostType] = useState(initial?.costType ?? "monthly");
  const [category, setCategory] = useState(initial?.category ?? "기타");
  const [amount, setAmount] = useState(initial ? String(Number(initial.amount)) : "");
  const [startMonth, setStartMonth] = useState(initial?.startMonth ?? getCurrentMonth());
  const [endMonth, setEndMonth] = useState(initial?.endMonth ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [attachmentUrl, setAttachmentUrl] = useState(initial?.attachmentUrl ?? "");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const create = trpc.fixedCosts.create.useMutation({
    onSuccess() { toast.success("고정비 추가 완료"); onDone(); },
    onError(err) { toast.error(err.message); },
  });

  const update = trpc.fixedCosts.update.useMutation({
    onSuccess() { toast.success("수정 완료"); onDone(); },
    onError(err) { toast.error(err.message); },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/fixed-cost-attachment", { method: "POST", body: formData });
      const data = await res.json();
      if (data.url) {
        setAttachmentUrl(data.url);
        toast.success("파일 첨부 완료");
      } else {
        toast.error(data.error || "업로드 실패");
      }
    } catch {
      toast.error("파일 업로드 중 오류 발생");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = () => {
    if (isEdit) {
      update.mutate({
        id: initial.id,
        restaurantId,
        costName,
        costType: costType as any,
        category: category as any,
        amount,
        startMonth: startMonth || undefined,
        endMonth: endMonth || null,
        attachmentUrl: attachmentUrl || null,
        note: note || null,
      });
    } else {
      create.mutate({
        restaurantId,
        costName,
        costType: costType as any,
        category: category as any,
        amount,
        startMonth: startMonth || undefined,
        endMonth: endMonth || null,
        attachmentUrl: attachmentUrl || undefined,
        note: note || undefined,
      });
    }
  };

  const isPending = create.isPending || update.isPending;

  return (
    <div className="space-y-4 pb-20 lg:pb-0">
      <Input
        label="항목명"
        value={costName}
        onChange={(e: any) => setCostName(e.target.value)}
        placeholder="임대료, 관리비 등"
        autoFocus
      />
      <div className="grid grid-cols-2 gap-3">
        <Select label="카테고리" value={category} onChange={(e: any) => setCategory(e.target.value)} options={CATEGORY_OPTIONS} />
        <Select label="유형" value={costType} onChange={(e: any) => setCostType(e.target.value)} options={COST_TYPE_OPTIONS} />
      </div>
      <Input
        label={costType === "sales_ratio" ? "비율 (%)" : "금액 (원)"}
        type="number"
        value={amount}
        onChange={(e: any) => setAmount(e.target.value)}
        placeholder={costType === "sales_ratio" ? "5.5" : "0"}
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="적용 시작월"
          type="month"
          value={startMonth}
          onChange={(e: any) => setStartMonth(e.target.value)}
        />
        <Input
          label="적용 종료월 (비워두면 무기한)"
          type="month"
          value={endMonth}
          onChange={(e: any) => setEndMonth(e.target.value)}
        />
      </div>
      <Input label="메모 (선택)" value={note} onChange={(e: any) => setNote(e.target.value)} placeholder="메모" />

      {/* 파일 첨부 */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">자료 첨부 (선택)</label>
        <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileUpload} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
            {uploading ? "업로드 중..." : "파일 선택"}
          </button>
          {attachmentUrl && (
            <span className="text-xs text-primary truncate max-w-[200px]">{attachmentUrl.split("/").pop()}</span>
          )}
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={handleSubmit} disabled={!costName || !amount || isPending}>
          {isPending ? (isEdit ? "수정 중..." : "추가 중...") : (isEdit ? "수정" : "추가")}
        </Button>
        <Button variant="secondary" onClick={onDone}>취소</Button>
      </div>
    </div>
  );
}

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
