import { useState, useRef } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import { Plus, Wallet, Trash2, Paperclip, ExternalLink, Loader2 } from "lucide-react";
import { Button, Card, Input, Select, PageHeader, EmptyState, Loading, Modal, Badge, StatCard } from "@/components/ui/compat";

const COST_TYPE_OPTIONS = [
  { value: "monthly", label: "월 고정" },
  { value: "yearly", label: "연간 (월할)" },
  { value: "quarterly", label: "분기별 (3개월할)" },
  { value: "sales_ratio", label: "매출대비 %" },
];

const COST_TYPE_LABELS: Record<string, string> = {
  monthly: "월 고정",
  yearly: "연간",
  quarterly: "분기별",
  sales_ratio: "매출%",
  one_time: "일회성",  // 레거시 표시용
};

export default function FixedCostsPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;
  const [showAdd, setShowAdd] = useState(false);

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  const utils = trpc.useUtils();
  const { data: list, isLoading } = trpc.fixedCosts.list.useQuery({ restaurantId }, { enabled: restaurantId > 0 });
  const { data: monthlyTotal } = trpc.fixedCosts.monthlyTotal.useQuery({ restaurantId, year, month }, { enabled: restaurantId > 0 });

  const deactivate = trpc.fixedCosts.deactivate.useMutation({
    onSuccess() { toast.success("비활성화됨"); utils.fixedCosts.list.invalidate(); utils.fixedCosts.monthlyTotal.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  if (!restaurantId) return <EmptyState icon={<Wallet size={40} />} title="매장을 선택해주세요" />;

  const getBadgeVariant = (type: string) => {
    switch (type) {
      case "monthly": return "info";
      case "yearly": return "warning";
      case "quarterly": return "default";
      case "sales_ratio": return "success";
      default: return "default";
    }
  };

  return (
    <div>
      <PageHeader
        title="고정비 관리"
        description={current?.name}
        action={<Button onClick={() => setShowAdd(true)} size="sm"><Plus size={16} /> 고정비 추가</Button>}
      />

      {/* 이번달 고정비 총액 */}
      {monthlyTotal && (
        <div className="mb-5 space-y-2">
          <StatCard
            icon={<Wallet size={14} />}
            label={`${year}년 ${month}월 고정비`}
            value={Number(monthlyTotal.total).toLocaleString()}
            unit="원"
          />
          {(monthlyTotal as any).ratioItems?.length > 0 && (
            <div className="px-4 py-2 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">매출대비 비율 항목</p>
              {(monthlyTotal as any).ratioItems.map((r: any, i: number) => (
                <span key={i} className="text-xs text-foreground mr-3">{r.name}: {r.ratio}%</span>
              ))}
            </div>
          )}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="고정비 추가">
        <AddFixedCostForm restaurantId={restaurantId} onDone={() => { setShowAdd(false); utils.fixedCosts.list.invalidate(); utils.fixedCosts.monthlyTotal.invalidate(); }} />
      </Modal>

      {isLoading ? <Loading /> : !list?.length ? (
        <EmptyState icon={<Wallet size={36} />} title="등록된 고정비가 없습니다" description="임대료, 관리비 등 매월 발생하는 비용을 등록하세요" />
      ) : (
        <div className="space-y-2">
          {list.map((fc: any) => (
            <Card key={fc.id} className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-medium text-foreground">{fc.costName}</span>
                  <Badge variant={getBadgeVariant(fc.costType) as any}>
                    {COST_TYPE_LABELS[fc.costType] ?? fc.costType}
                  </Badge>
                </div>
                <div className="flex items-center gap-3">
                  {fc.costType === "sales_ratio" ? (
                    <span className="text-sm font-semibold text-foreground tabular-nums">{Number(fc.amount)}%</span>
                  ) : (
                    <>
                      <span className="text-sm font-semibold text-foreground tabular-nums">{Number(fc.amount).toLocaleString()}원</span>
                      {fc.costType === "yearly" && (
                        <span className="text-xs text-muted-foreground">월 {Math.round(Number(fc.amount) / 12).toLocaleString()}원</span>
                      )}
                      {fc.costType === "quarterly" && (
                        <span className="text-xs text-muted-foreground">월 {Math.round(Number(fc.amount) / 3).toLocaleString()}원</span>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => { if (confirm(`${fc.costName}을(를) 삭제하시겠습니까?`)) deactivate.mutate({ id: fc.id, restaurantId }); }}
                    className="text-muted-foreground/50 hover:text-red-500 p-1"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {(fc.note || fc.attachmentUrl) && (
                <div className="flex items-center gap-3 mt-1.5">
                  {fc.note && <p className="text-xs text-muted-foreground flex-1">{fc.note}</p>}
                  {fc.attachmentUrl && (
                    <a href={fc.attachmentUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline shrink-0">
                      <Paperclip size={11} /> 첨부파일 <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AddFixedCostForm({ restaurantId, onDone }: { restaurantId: number; onDone: () => void }) {
  const [costName, setCostName] = useState("");
  const [costType, setCostType] = useState("monthly");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const create = trpc.fixedCosts.create.useMutation({
    onSuccess() { toast.success("고정비 추가 완료"); onDone(); },
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

  return (
    <div className="space-y-4">
      <Input label="항목명" value={costName} onChange={(e: any) => setCostName(e.target.value)} placeholder="임대료, 관리비 등" autoFocus />
      <div className="grid grid-cols-2 gap-3">
        <Select label="유형" value={costType} onChange={(e: any) => setCostType(e.target.value)} options={COST_TYPE_OPTIONS} />
        <Input
          label={costType === "sales_ratio" ? "비율 (%)" : "금액 (원)"}
          type="number"
          value={amount}
          onChange={(e: any) => setAmount(e.target.value)}
          placeholder={costType === "sales_ratio" ? "5.5" : "0"}
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
        <Button
          onClick={() => create.mutate({
            restaurantId,
            costName,
            costType: costType as any,
            amount,
            attachmentUrl: attachmentUrl || undefined,
            note: note || undefined,
          })}
          disabled={!costName || !amount || create.isPending}
        >
          {create.isPending ? "추가 중..." : "추가"}
        </Button>
        <Button variant="secondary" onClick={onDone}>취소</Button>
      </div>
    </div>
  );
}
