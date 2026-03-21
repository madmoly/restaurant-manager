import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, FileText, AlertCircle, TrendingUp, Building2, RefreshCw } from "lucide-react";

const CONTRACT_TYPE_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  rent:       { label: "임대료",       color: "bg-blue-500/20 text-blue-400 border border-blue-500/30",     icon: "🏠" },
  commission: { label: "임대 수수료",  color: "bg-purple-500/20 text-purple-400 border border-purple-500/30", icon: "💼" },
  royalty:    { label: "본사 로얄티",  color: "bg-orange-500/20 text-orange-400 border border-orange-500/30", icon: "👑" },
  investor:   { label: "투자자 지분",  color: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30", icon: "📈" },
  other:      { label: "기타",         color: "bg-slate-500/20 text-slate-400 border border-slate-500/30",   icon: "📋" },
};

const CALC_TYPE_LABELS: Record<string, string> = {
  fixed: "고정 금액",
  ratio: "매출 비율 (%)",
};

type Contract = {
  id: number;
  restaurantId: number;
  contractType: "rent" | "commission" | "royalty" | "investor" | "other";
  name: string;
  calcType: "fixed" | "ratio";
  fixedAmount: string | null;
  ratioPercent: string | null;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  autoApplyToFixedCost: boolean;
  isActive: boolean;
  createdAt: Date;
};

const emptyForm: {
  contractType: "rent" | "commission" | "royalty" | "investor" | "other";
  name: string;
  calcType: "fixed" | "ratio";
  fixedAmount: string;
  ratioPercent: string;
  startDate: string;
  endDate: string;
  note: string;
  autoApplyToFixedCost: boolean;
} = {
  contractType: "rent",
  name: "",
  calcType: "fixed",
  fixedAmount: "",
  ratioPercent: "",
  startDate: "",
  endDate: "",
  note: "",
  autoApplyToFixedCost: true,
};

export default function ContractsPage() {
  const { selectedRestaurantId, selectedRestaurant } = useRestaurant();
  const rId = selectedRestaurantId ?? 0;
  const activeRestaurantName = selectedRestaurant?.name ?? "";

  const { data: contracts = [], refetch } = trpc.restaurantContracts.list.useQuery(
    { restaurantId: rId },
    { enabled: rId > 0 }
  );

  const currentMonth = new Date().toISOString().slice(0, 7);
  const { data: contractCosts = [] } = trpc.restaurantContracts.applyToFixedCosts.useQuery(
    { restaurantId: rId, effectiveMonth: currentMonth },
    { enabled: rId > 0 }
  );

  const utils = trpc.useUtils();

  const createMutation = trpc.restaurantContracts.create.useMutation({
    onSuccess: () => {
      toast.success("계약 조건이 등록되었습니다. 고정비에 자동 반영되었습니다.");
      refetch();
      utils.restaurantContracts.applyToFixedCosts.invalidate();
      utils.fixedCosts.listByMonth.invalidate();
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.restaurantContracts.update.useMutation({
    onSuccess: () => {
      toast.success("계약 조건이 수정되었습니다. 고정비에 자동 반영되었습니다.");
      refetch();
      utils.restaurantContracts.applyToFixedCosts.invalidate();
      utils.fixedCosts.listByMonth.invalidate();
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.restaurantContracts.delete.useMutation({
    onSuccess: () => {
      toast.success("계약 조건이 삭제되었습니다.");
      refetch();
      utils.restaurantContracts.applyToFixedCosts.invalidate();
      utils.fixedCosts.listByMonth.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const syncMutation = trpc.restaurantContracts.syncToFixedCosts.useMutation({
    onSuccess: (res) => {
      toast.success(res.message);
      utils.restaurantContracts.applyToFixedCosts.invalidate();
      utils.fixedCosts.listByMonth.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Contract | null>(null);
  const [form, setForm] = useState(emptyForm);

  function openCreate() {
    setEditTarget(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(c: Contract) {
    setEditTarget(c);
    setForm({
      contractType: c.contractType,
      name: c.name,
      calcType: c.calcType,
      fixedAmount: c.fixedAmount ?? "",
      ratioPercent: c.ratioPercent ?? "",
      startDate: c.startDate ? String(c.startDate).slice(0, 10) : "",
      endDate: c.endDate ? String(c.endDate).slice(0, 10) : "",
      note: c.note ?? "",
      autoApplyToFixedCost: c.autoApplyToFixedCost,
    });
    setOpen(true);
  }

  function handleSubmit() {
    if (!form.name.trim()) { toast.error("항목명을 입력해주세요."); return; }
    const payload = {
      restaurantId: rId,
      contractType: form.contractType,
      name: form.name,
      calcType: form.calcType,
      fixedAmount: form.calcType === "fixed" ? parseFloat(form.fixedAmount) || 0 : 0,
      ratioPercent: form.calcType === "ratio" ? parseFloat(form.ratioPercent) || 0 : 0,
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      note: form.note || undefined,
      autoApplyToFixedCost: form.autoApplyToFixedCost,
    };
    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const totalFixedFromContracts = contractCosts.reduce((s, c) => s + c.calculatedAmount, 0);

  if (!rId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <AlertCircle className="mr-2 h-5 w-5" />
        매장을 선택해주세요.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            매장 계약 조건
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{activeRestaurantName} — 임대료, 수수료, 로얄티, 투자자 지분 등 계약 항목을 관리합니다.</p>
        </div>
        <div className="flex gap-2">
          {contracts.length > 0 && (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => syncMutation.mutate({ restaurantId: rId, effectiveMonth: currentMonth })}
              disabled={syncMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              고정비 동기화
            </Button>
          )}
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            계약 조건 추가
          </Button>
        </div>
      </div>

      {/* 이번 달 계약 기반 고정비 요약 */}
      {contractCosts.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              이번 달 계약 기반 고정비 자동 계산 ({currentMonth})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {contractCosts.map((cc) => {
                const info = CONTRACT_TYPE_LABELS[cc.contractType] ?? CONTRACT_TYPE_LABELS.other;
                return (
                  <div key={cc.id} className="flex items-center justify-between bg-background rounded-lg px-4 py-3 border">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{info.icon}</span>
                      <div>
                        <p className="text-sm font-medium">{cc.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {cc.calcType === "ratio" ? `매출의 ${cc.ratioPercent}%` : "고정 금액"}
                        </p>
                      </div>
                    </div>
                    <span className="font-bold text-primary">
                      {cc.calculatedAmount.toLocaleString()}원
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t flex justify-between items-center">
              <span className="text-sm font-medium text-muted-foreground">계약 기반 고정비 합계</span>
              <span className="text-lg font-bold text-primary">{totalFixedFromContracts.toLocaleString()}원</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 계약 조건 목록 */}
      {contracts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground font-medium">등록된 계약 조건이 없습니다.</p>
            <p className="text-sm text-muted-foreground mt-1">임대료, 수수료, 로얄티 등 계약 항목을 추가해보세요.</p>
            <Button onClick={openCreate} className="mt-4 gap-2" variant="outline">
              <Plus className="h-4 w-4" />
              첫 계약 조건 추가
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {contracts.map((c) => {
            const info = CONTRACT_TYPE_LABELS[c.contractType] ?? CONTRACT_TYPE_LABELS.other;
            const applied = contractCosts.find(cc => cc.id === c.id);
            return (
              <Card key={c.id} className="relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-primary/40 rounded-l" />
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <span className="text-2xl mt-0.5">{info.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold truncate">{c.name}</h3>
                          <Badge className={`text-xs ${info.color} border-0`}>{info.label}</Badge>
                          {c.autoApplyToFixedCost && (
                            <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-500/30 bg-emerald-500/10">고정비 자동반영</Badge>
                          )}
                        </div>
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground">계산 방식:</span>
                            <span className="font-medium">{CALC_TYPE_LABELS[c.calcType]}</span>
                          </div>
                          {c.calcType === "fixed" ? (
                            <div className="flex items-center gap-2 text-sm">
                              <span className="text-muted-foreground">금액:</span>
                              <span className="font-bold text-primary">
                                {parseFloat(c.fixedAmount ?? "0").toLocaleString()}원 / 월
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-sm">
                              <span className="text-muted-foreground">비율:</span>
                              <span className="font-bold text-primary">
                                매출의 {parseFloat(c.ratioPercent ?? "0")}%
                              </span>
                              {applied && (
                                <span className="text-muted-foreground">
                                  (이번 달 ≈ {applied.calculatedAmount.toLocaleString()}원)
                                </span>
                              )}
                            </div>
                          )}
                          {(c.startDate || c.endDate) && (
                            <div className="text-xs text-muted-foreground">
                              계약 기간: {c.startDate ? String(c.startDate).slice(0, 10) : "—"} ~ {c.endDate ? String(c.endDate).slice(0, 10) : "무기한"}
                            </div>
                          )}
                          {c.note && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.note}</p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(c as Contract)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon" variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => { if (confirm("이 계약 조건을 삭제하시겠습니까?")) deleteMutation.mutate({ id: c.id }); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 등록/수정 다이얼로그 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? "계약 조건 수정" : "계약 조건 추가"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>계약 유형 *</Label>
                <Select value={form.contractType} onValueChange={(v) => setForm(f => ({ ...f, contractType: v as typeof f.contractType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CONTRACT_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.icon} {v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>계산 방식 *</Label>
                <Select value={form.calcType} onValueChange={(v) => setForm(f => ({ ...f, calcType: v as typeof f.calcType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">고정 금액</SelectItem>
                    <SelectItem value="ratio">매출 비율 (%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>항목명 *</Label>
              <Input
                placeholder="예: 강남역 1호점 임대료"
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            {form.calcType === "fixed" ? (
              <div className="space-y-1.5">
                <Label>월 고정 금액 (원)</Label>
                <Input
                  type="number"
                  placeholder="예: 3000000"
                  value={form.fixedAmount}
                  onChange={(e) => setForm(f => ({ ...f, fixedAmount: e.target.value }))}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>매출 대비 비율 (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  placeholder="예: 5.5"
                  value={form.ratioPercent}
                  onChange={(e) => setForm(f => ({ ...f, ratioPercent: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">해당 월 매출에 이 비율을 곱하여 고정비로 자동 계산됩니다.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>계약 시작일</Label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>계약 종료일</Label>
                <Input type="date" value={form.endDate} onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>메모</Label>
              <Textarea
                placeholder="계약 관련 특이사항, 조건 등을 기록하세요."
                value={form.note}
                onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))}
                rows={3}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">월 고정비 자동 반영</p>
                <p className="text-xs text-muted-foreground">활성화 시 이 항목이 매월 고정비에 자동으로 포함됩니다.</p>
              </div>
              <Switch
                checked={form.autoApplyToFixedCost}
                onCheckedChange={(v) => setForm(f => ({ ...f, autoApplyToFixedCost: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
              {editTarget ? "수정" : "등록"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
