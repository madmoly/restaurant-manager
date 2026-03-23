import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import { Plus, Wallet, Trash2 } from "lucide-react";
import { Button, Card, Input, Select, PageHeader, EmptyState, Loading, Modal, Badge, StatCard } from "@/components/ui/compat";

const COST_TYPE_OPTIONS = [
  { value: "monthly", label: "월 고정" },
  { value: "yearly", label: "연간 (월할)" },
  { value: "one_time", label: "일회성" },
];

const COST_TYPE_LABELS: Record<string, string> = { monthly: "월 고정", yearly: "연간", one_time: "일회성" };

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

  return (
    <div>
      <PageHeader
        title="고정비 관리"
        description={current?.name}
        action={<Button onClick={() => setShowAdd(true)} size="sm"><Plus size={16} /> 고정비 추가</Button>}
      />

      {/* 이번달 고정비 총액 */}
      {monthlyTotal && (
        <StatCard
          icon={<Wallet size={14} />}
          label={`${year}년 ${month}월 고정비`}
          value={Number(monthlyTotal.total).toLocaleString()}
          unit="원"
          className="mb-5"
        />
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
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground">{fc.costName}</span>
                  <Badge variant={fc.costType === "monthly" ? "info" : fc.costType === "yearly" ? "warning" : "default"}>
                    {COST_TYPE_LABELS[fc.costType]}
                  </Badge>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-foreground tabular-nums">{Number(fc.amount).toLocaleString()}원</span>
                  {fc.costType === "yearly" && (
                    <span className="text-xs text-muted-foreground">월 {Math.round(Number(fc.amount) / 12).toLocaleString()}원</span>
                  )}
                  <button
                    onClick={() => { if (confirm(`${fc.costName}을(를) 삭제하시겠습니까?`)) deactivate.mutate({ id: fc.id, restaurantId }); }}
                    className="text-muted-foreground/50 hover:text-red-500 p-1"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {fc.note && <p className="text-xs text-muted-foreground mt-1">{fc.note}</p>}
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
  const [effectiveMonth, setEffectiveMonth] = useState("");
  const [note, setNote] = useState("");

  const create = trpc.fixedCosts.create.useMutation({
    onSuccess() { toast.success("고정비 추가 완료"); onDone(); },
    onError(err) { toast.error(err.message); },
  });

  return (
    <div className="space-y-4">
      <Input label="항목명" value={costName} onChange={e => setCostName(e.target.value)} placeholder="임대료, 관리비 등" autoFocus />
      <div className="grid grid-cols-2 gap-3">
        <Select label="유형" value={costType} onChange={e => setCostType(e.target.value)} options={COST_TYPE_OPTIONS} />
        <Input label="금액 (원)" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
      </div>
      {costType === "one_time" && (
        <Input label="적용 월 (YYYY-MM)" type="month" value={effectiveMonth} onChange={e => setEffectiveMonth(e.target.value)} />
      )}
      <Input label="메모 (선택)" value={note} onChange={e => setNote(e.target.value)} placeholder="메모" />
      <div className="flex gap-2 pt-2">
        <Button
          onClick={() => create.mutate({ restaurantId, costName, costType: costType as any, amount, effectiveMonth: effectiveMonth || undefined, note: note || undefined })}
          disabled={!costName || !amount || create.isPending}
        >
          {create.isPending ? "추가 중..." : "추가"}
        </Button>
        <Button variant="secondary" onClick={onDone}>취소</Button>
      </div>
    </div>
  );
}
