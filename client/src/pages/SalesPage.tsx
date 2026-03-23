import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useParams } from "wouter";
import { toast } from "sonner";
import { Plus, Trash2, Receipt } from "lucide-react";
import { Button, Card, Input, MonthNav, PageHeader, EmptyState, Loading, Modal } from "@/components/ui/compat";

export default function SalesPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const params = useParams<{ restaurantId?: string }>();
  const restaurantId = params.restaurantId ? Number(params.restaurantId) : (current?.id ?? 0);

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [showAdd, setShowAdd] = useState(false);

  const utils = trpc.useUtils();
  const { data: restaurant } = trpc.restaurants.get.useQuery({ id: restaurantId }, { enabled: restaurantId > 0 });
  const { data: salesList, isLoading } = trpc.sales.listByMonth.useQuery({ restaurantId, year, month }, { enabled: restaurantId > 0 });
  const { data: monthlyTotal } = trpc.sales.monthlyTotal.useQuery({ restaurantId, year, month }, { enabled: restaurantId > 0 });

  const deleteSale = trpc.sales.delete.useMutation({
    onSuccess() { toast.success("삭제됨"); invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const invalidate = () => {
    utils.sales.listByMonth.invalidate();
    utils.sales.monthlyTotal.invalidate();
  };

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };

  if (!restaurantId) return <EmptyState icon={<Receipt size={40} />} title="매장을 선택해주세요" />;

  return (
    <div>
      <PageHeader
        title={`${restaurant?.name ?? ""} 매출`}
        action={
          <Button onClick={() => setShowAdd(true)} size="sm">
            <Plus size={16} /> 매출 입력
          </Button>
        }
      />

      <MonthNav
        year={year}
        month={month}
        onPrev={prevMonth}
        onNext={nextMonth}
        rightSlot={
          <span className="text-sm font-bold text-foreground tabular-nums">
            합계 {Number(monthlyTotal?.total ?? 0).toLocaleString()}원
          </span>
        }
      />

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="매출 입력">
        <AddSaleForm restaurantId={restaurantId} onDone={() => { setShowAdd(false); invalidate(); }} />
      </Modal>

      {isLoading ? <Loading /> : !salesList?.length ? (
        <EmptyState
          icon={<Receipt size={36} />}
          title="이번 달 매출 기록이 없습니다"
          description="매출 입력 버튼으로 기록을 시작하세요"
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">날짜</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">금액</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground hidden sm:table-cell">메모</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {salesList.map((s: any) => (
                  <tr key={s.id} className="border-b border-border/50 hover:bg-accent/50">
                    <td className="px-4 py-3 text-foreground tabular-nums">{String(s.saleDate).slice(5)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground tabular-nums">{Number(s.amount).toLocaleString()}원</td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell truncate max-w-[200px]">{s.note || "—"}</td>
                    <td className="px-2">
                      <button
                        onClick={() => { if (confirm("삭제하시겠습니까?")) deleteSale.mutate({ id: s.id, restaurantId }); }}
                        className="text-muted-foreground/50 hover:text-red-500 p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function AddSaleForm({ restaurantId, onDone }: { restaurantId: number; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [saleDate, setSaleDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const create = trpc.sales.create.useMutation({
    onSuccess() { toast.success("매출 등록 완료"); onDone(); },
    onError(err) { toast.error(err.message); },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Input label="날짜" type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
        <Input label="금액 (원)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
      </div>
      <Input label="메모 (선택)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="메모" />
      <div className="flex gap-2 pt-2">
        <Button onClick={() => create.mutate({ restaurantId, saleDate, amount, note })} disabled={!amount || create.isPending}>
          {create.isPending ? "등록 중..." : "등록"}
        </Button>
        <Button variant="secondary" onClick={onDone}>취소</Button>
      </div>
    </div>
  );
}
