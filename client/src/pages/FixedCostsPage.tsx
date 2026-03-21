import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, AlertTriangle, Clock, Infinity } from "lucide-react";

function fmt(n: number) { return n.toLocaleString("ko-KR") + "원"; }
function fmtDate(d: string | Date | null | undefined) {
  if (!d) return null;
  const s = typeof d === "string" ? d : d.toISOString();
  return s.slice(0, 10);
}
function daysUntil(dateStr: string | Date | null | undefined): number | null {
  if (!dateStr) return null;
  const s = typeof dateStr === "string" ? dateStr : dateStr.toISOString().slice(0, 10);
  const diff = new Date(s).getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

const CATEGORY_TYPES = [
  { value: "rent", label: "임대료" },
  { value: "utility", label: "공과금" },
  { value: "fee", label: "수수료" },
  { value: "labor_fixed", label: "고정 인건비" },
  { value: "other", label: "기타" },
];

type FormState = {
  costCategory: string;
  categoryType: "rent" | "utility" | "fee" | "labor_fixed" | "other";
  amount: string;
  note: string;
  startDate: string;
  endDate: string;
};

type EditItem = {
  id: number;
  costCategory: string;
  amount: number;
  note?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

const defaultForm: FormState = {
  costCategory: "",
  categoryType: "other",
  amount: "",
  note: "",
  startDate: "",
  endDate: "",
};

export default function FixedCostsPage() {
  const { selectedRestaurantId } = useRestaurant();
  const rId = selectedRestaurantId;

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<EditItem | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);

  const effectiveMonth = `${year}-${String(month).padStart(2, "0")}`;

  const utils = trpc.useUtils();
  const costsQuery = trpc.fixedCosts.listByMonth.useQuery(
    { restaurantId: rId!, effectiveMonth },
    { enabled: !!rId }
  );
  const expiringSoonQuery = trpc.fixedCosts.getExpiringSoon.useQuery(
    { restaurantId: rId! },
    { enabled: !!rId }
  );

  const createMutation = trpc.fixedCosts.create.useMutation({
    onSuccess: () => {
      utils.fixedCosts.listByMonth.invalidate();
      utils.fixedCosts.getExpiringSoon.invalidate();
      setShowAdd(false);
      setForm(defaultForm);
      toast.success("고정비가 등록되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.fixedCosts.update.useMutation({
    onSuccess: () => {
      utils.fixedCosts.listByMonth.invalidate();
      utils.fixedCosts.getExpiringSoon.invalidate();
      setEditItem(null);
      toast.success("수정되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.fixedCosts.delete.useMutation({
    onSuccess: () => {
      utils.fixedCosts.listByMonth.invalidate();
      utils.fixedCosts.getExpiringSoon.invalidate();
      toast.success("삭제되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });

  const costs = costsQuery.data ?? [];
  const expiring = expiringSoonQuery.data ?? [];
  const total = costs.reduce((s: number, c: any) => s + parseFloat(c.amount ?? "0"), 0);

  const typeMap: Record<string, number> = {};
  costs.forEach((c: any) => {
    const t = c.categoryType ?? "other";
    typeMap[t] = (typeMap[t] ?? 0) + parseFloat(c.amount ?? "0");
  });

  function openEdit(c: any) {
    setEditItem({
      id: c.id,
      costCategory: c.costCategory,
      amount: parseFloat(c.amount ?? "0"),
      note: c.note,
      startDate: fmtDate(c.startDate),
      endDate: fmtDate(c.endDate),
    });
  }

  return (
    <AppLayout title="고정비 관리" subtitle={`${year}년 ${month}월`}>
      <div className="p-4 lg:p-6 space-y-4">

        {/* 만료 임박 알림 배너 */}
        {expiring.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
              <AlertTriangle className="h-4 w-4" />
              종료 임박 고정비 ({expiring.length}건)
            </div>
            {expiring.map((item: any) => {
              const days = daysUntil(item.endDate);
              return (
                <div key={item.id} className="flex items-center justify-between text-xs text-amber-300/80 pl-6">
                  <span>{item.costCategory}</span>
                  <span className="font-medium text-amber-400">
                    {days !== null && days >= 0 ? `${days}일 후 종료 (${fmtDate(item.endDate)})` : "종료됨"}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* 헤더 컨트롤 */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-2">
            <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
              <SelectTrigger className="w-24 h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{[2024, 2025, 2026, 2027].map(y => <SelectItem key={y} value={String(y)}>{y}년</SelectItem>)}</SelectContent>
            </Select>
            <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
              <SelectTrigger className="w-20 h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{Array.from({ length: 12 }, (_, i) => i + 1).map(m => <SelectItem key={m} value={String(m)}>{m}월</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button size="sm" className="gap-1.5 h-8" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5" /> 항목 추가
          </Button>
        </div>

        {/* 유형별 요약 */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {CATEGORY_TYPES.map(ct => (
            <Card key={ct.value} className="border-border">
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground mb-1">{ct.label}</p>
                <p className="text-sm font-bold">{fmt(typeMap[ct.value] ?? 0)}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 합계 */}
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardContent className="p-4 flex items-center justify-between">
            <p className="text-sm font-medium text-orange-400">월 고정비 합계</p>
            <p className="text-xl sm:text-2xl font-bold text-orange-400">{fmt(total)}</p>
          </CardContent>
        </Card>

        {/* 목록 */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">고정비 항목 ({costs.length}건)</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-2 text-xs font-medium text-muted-foreground">항목명</th>
                    <th className="text-left py-2 px-2 text-xs font-medium text-muted-foreground">유형</th>
                    <th className="text-left py-2 px-2 text-xs font-medium text-muted-foreground">기간</th>
                    <th className="text-right py-2 px-2 text-xs font-medium text-muted-foreground">금액</th>
                    <th className="text-left py-2 px-2 text-xs font-medium text-muted-foreground">메모</th>
                    <th className="text-right py-2 px-2 text-xs font-medium text-muted-foreground">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {costs.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-xs">고정비 항목이 없습니다. 항목을 추가하세요.</td></tr>
                  ) : costs.map((c: any) => {
                    const days = daysUntil(c.endDate);
                    const isExpiringSoon = days !== null && days >= 0 && days <= 30;
                    return (
                      <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 px-2 font-medium text-sm">
                          <div className="flex items-center gap-1.5">
                            {isExpiringSoon && <AlertTriangle className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />}
                            {c.costCategory}
                          </div>
                        </td>
                        <td className="py-2.5 px-2">
                          <Badge variant="outline" className="text-xs">{CATEGORY_TYPES.find(t => t.value === c.categoryType)?.label ?? c.categoryType}</Badge>
                        </td>
                        <td className="py-2.5 px-2 text-xs text-muted-foreground">
                          {c.endDate ? (
                            <span className={isExpiringSoon ? "text-amber-400 font-medium" : ""}>
                              {fmtDate(c.startDate) ?? "등록일"} ~ {fmtDate(c.endDate)}
                              {isExpiringSoon && <span className="ml-1 text-amber-400">({days}일 후)</span>}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-emerald-400/70">
                              <Infinity className="h-3 w-3" /> 상시
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-right font-semibold text-orange-400 text-sm">{fmt(parseFloat(c.amount ?? "0"))}</td>
                        <td className="py-2.5 px-2 text-muted-foreground text-xs">{c.note ?? "-"}</td>
                        <td className="py-2.5 px-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => { if (confirm("삭제하시겠습니까?")) deleteMutation.mutate({ id: c.id }); }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {costs.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30">
                      <td colSpan={3} className="py-2.5 px-2 font-bold text-xs">합계</td>
                      <td className="py-2.5 px-2 text-right font-bold text-orange-400 text-xs">{fmt(total)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>

        {/* 추가 다이얼로그 */}
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>고정비 항목 추가</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">항목명 *</Label>
                <Input value={form.costCategory} onChange={e => setForm(f => ({ ...f, costCategory: e.target.value }))} placeholder="예: 매장 임대료" className="mt-1 h-9" />
              </div>
              <div>
                <Label className="text-xs">유형</Label>
                <Select value={form.categoryType} onValueChange={v => setForm(f => ({ ...f, categoryType: v as any }))}>
                  <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORY_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">금액 (원) *</Label>
                <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" className="mt-1 h-9" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs flex items-center gap-1"><Clock className="h-3 w-3" /> 시작일</Label>
                  <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} className="mt-1 h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs flex items-center gap-1"><Clock className="h-3 w-3" /> 종료일 <span className="text-muted-foreground">(미입력 시 상시)</span></Label>
                  <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} className="mt-1 h-9 text-sm" />
                </div>
              </div>
              <div>
                <Label className="text-xs">메모</Label>
                <Input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} className="mt-1 h-9" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => { setShowAdd(false); setForm(defaultForm); }}>취소</Button>
              <Button size="sm" onClick={() => createMutation.mutate({
                restaurantId: rId!,
                effectiveMonth,
                costCategory: form.costCategory,
                categoryType: form.categoryType,
                amount: Number(form.amount),
                note: form.note || undefined,
                startDate: form.startDate || undefined,
                endDate: form.endDate || undefined,
              })} disabled={createMutation.isPending || !form.costCategory || !form.amount}>추가</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 수정 다이얼로그 */}
        <Dialog open={!!editItem} onOpenChange={() => setEditItem(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>고정비 수정</DialogTitle></DialogHeader>
            {editItem && (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">항목명</Label>
                  <Input value={editItem.costCategory} onChange={e => setEditItem(i => i ? { ...i, costCategory: e.target.value } : null)} className="mt-1 h-9" />
                </div>
                <div>
                  <Label className="text-xs">금액 (원)</Label>
                  <Input type="number" value={editItem.amount} onChange={e => setEditItem(i => i ? { ...i, amount: Number(e.target.value) } : null)} className="mt-1 h-9" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">시작일</Label>
                    <Input type="date" value={editItem.startDate ?? ""} onChange={e => setEditItem(i => i ? { ...i, startDate: e.target.value || null } : null)} className="mt-1 h-9 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">종료일 <span className="text-muted-foreground text-xs">(미입력 시 상시)</span></Label>
                    <Input type="date" value={editItem.endDate ?? ""} onChange={e => setEditItem(i => i ? { ...i, endDate: e.target.value || null } : null)} className="mt-1 h-9 text-sm" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">메모</Label>
                  <Input value={editItem.note ?? ""} onChange={e => setEditItem(i => i ? { ...i, note: e.target.value } : null)} className="mt-1 h-9" />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setEditItem(null)}>취소</Button>
              <Button size="sm" onClick={() => editItem && updateMutation.mutate({
                id: editItem.id,
                costCategory: editItem.costCategory,
                amount: editItem.amount,
                note: editItem.note ?? undefined,
                startDate: editItem.startDate ?? null,
                endDate: editItem.endDate ?? null,
              })} disabled={updateMutation.isPending}>저장</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
