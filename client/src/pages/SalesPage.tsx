import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, DollarSign, TrendingUp } from "lucide-react";
import { MonthNavigator } from "@/components/MonthNavigator";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";
import { todayKST } from "@/lib/dateKST";
import { getEffectiveRole, isManagerLevel } from "@shared/permissions";

function fmt(n: number) { return n.toLocaleString("ko-KR") + "원"; }

export default function SalesPage() {
  const { selectedRestaurantId } = useRestaurant();
  const rId = selectedRestaurantId;
  const { user } = useAuth();
  // 매장 내 역할 조회 (시스템 역할이 employee이지만 해당 매장에서 store_manager인 경우 반영)
  const storeRoleQuery = trpc.restaurants.getMyStoreRole.useQuery(
    { restaurantId: rId! },
    { enabled: !!rId && (user?.role === "employee" || user?.role === "user") }
  );
  const storeRole = storeRoleQuery.data;
  const effectiveRole = getEffectiveRole(user?.role ?? "employee", storeRole);
  const isManager = isManagerLevel(effectiveRole);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const handleMonthChange = (y: number, m: number) => { setYear(y); setMonth(m); };
  const [showAdd, setShowAdd] = useState(false);
  const [editSale, setEditSale] = useState<{ id: number; amount: number; note?: string | null } | null>(null);
  const [form, setForm] = useState({ saleDate: todayKST(), amount: "", note: "" });

  const utils = trpc.useUtils();
  const salesQuery = trpc.sales.listByMonth.useQuery(
    { restaurantId: rId!, year, month },
    { enabled: !!rId }
  );

  const createMutation = trpc.sales.create.useMutation({
    onSuccess: () => { utils.sales.listByMonth.invalidate(); setShowAdd(false); setForm({ saleDate: todayKST(), amount: "", note: "" }); toast.success("매출이 등록되었습니다."); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.sales.update.useMutation({
    onSuccess: () => { utils.sales.listByMonth.invalidate(); setEditSale(null); toast.success("수정되었습니다."); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.sales.delete.useMutation({
    onSuccess: () => { utils.sales.listByMonth.invalidate(); toast.success("삭제되었습니다."); },
    onError: (e) => toast.error(e.message),
  });

  const sales = salesQuery.data ?? [];
  const totalSales = sales.reduce((s: number, r: any) => s + parseFloat(r.amount ?? "0"), 0);

  // 일별 집계
  const dailyMap: Record<string, number> = {};
  sales.forEach((s: any) => {
    const d = new Date(s.saleDate).toLocaleDateString("ko-KR", { day: "numeric" }) + "일";
    dailyMap[d] = (dailyMap[d] ?? 0) + parseFloat(s.amount ?? "0");
  });
  const chartData = Object.entries(dailyMap).map(([date, amount]) => ({ date, amount }));

  return (
    <AppLayout title="매출 관리" subtitle={`${year}년 ${month}월`}>
      <div className="p-4 lg:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <MonthNavigator year={year} month={month} onChange={handleMonthChange} />
          {isManager && (
            <Button size="sm" className="gap-1.5 h-8" onClick={() => setShowAdd(true)}>
              <Plus className="h-3.5 w-3.5" /> 매출 입력
            </Button>
          )}
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4">
              <p className="text-xs text-primary font-medium mb-1">월 총 매출</p>
              <p className="text-xl sm:text-2xl font-bold text-primary">{fmt(totalSales)}</p>
            </CardContent>
          </Card>
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardContent className="p-4">
              <p className="text-xs text-emerald-400 font-medium mb-1">평균 일 매출</p>
              <p className="text-xl sm:text-2xl font-bold text-emerald-400">{sales.length > 0 ? fmt(Math.round(totalSales / sales.length)) : "-"}</p>
            </CardContent>
          </Card>
        </div>

        {/* 차트 */}
        {chartData.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">일별 매출 추이</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 8%)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => (v / 10000).toFixed(0) + "만"} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="amount" fill="#3b82f6" radius={[3, 3, 0, 0]} name="매출" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* 목록 */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">매출 내역 ({sales.length}건)</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-2 text-xs font-medium text-muted-foreground">날짜</th>
                    <th className="text-right py-2 px-2 text-xs font-medium text-muted-foreground">금액</th>
                    <th className="text-left py-2 px-2 text-xs font-medium text-muted-foreground">메모</th>
                    <th className="text-left py-2 px-2 text-xs font-medium text-muted-foreground">입력자</th>
                    <th className="text-right py-2 px-2 text-xs font-medium text-muted-foreground">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-muted-foreground text-xs">매출 데이터가 없습니다</td></tr>
                  ) : sales.map((s: any) => (
                    <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 px-2">{new Date(s.saleDate).toLocaleDateString("ko-KR")}</td>
                      <td className="py-2.5 px-2 text-right font-semibold text-primary">{fmt(parseFloat(s.amount ?? "0"))}</td>
                      <td className="py-2.5 px-2 text-muted-foreground text-xs">{s.note ?? "-"}</td>
                      <td className="py-2.5 px-2 text-muted-foreground text-xs">{s.source ?? "수동"}</td>
                      <td className="py-2.5 px-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isManager && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditSale({ id: s.id, amount: parseFloat(s.amount ?? "0"), note: s.note })}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {isManager && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => { if (confirm("삭제하시겠습니까?")) deleteMutation.mutate({ id: s.id }); }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {sales.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30">
                      <td className="py-2.5 px-2 font-bold text-xs">합계</td>
                      <td className="py-2.5 px-2 text-right font-bold text-primary text-xs">{fmt(totalSales)}</td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>

        {/* 매출 추가 */}
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>매출 입력</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label className="text-xs">날짜 *</Label><Input type="date" value={form.saleDate} onChange={e => setForm(f => ({ ...f, saleDate: e.target.value }))} className="mt-1 h-9" /></div>
              <div><Label className="text-xs">금액 (원) *</Label><Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" className="mt-1 h-9" /></div>
              <div><Label className="text-xs">메모</Label><Input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} className="mt-1 h-9" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>취소</Button>
              <Button size="sm" onClick={() => createMutation.mutate({ restaurantId: rId!, saleDate: form.saleDate, amount: Number(form.amount), note: form.note || undefined })} disabled={createMutation.isPending}>등록</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 매출 수정 */}
        <Dialog open={!!editSale} onOpenChange={() => setEditSale(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>매출 수정</DialogTitle></DialogHeader>
            {editSale && (
              <div className="space-y-3">
                <div><Label className="text-xs">금액 (원)</Label><Input type="number" value={editSale.amount} onChange={e => setEditSale(s => s ? { ...s, amount: Number(e.target.value) } : null)} className="mt-1 h-9" /></div>
                <div><Label className="text-xs">메모</Label><Input value={editSale.note ?? ""} onChange={e => setEditSale(s => s ? { ...s, note: e.target.value } : null)} className="mt-1 h-9" /></div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setEditSale(null)}>취소</Button>
              <Button size="sm" onClick={() => editSale && updateMutation.mutate({ id: editSale.id, amount: editSale.amount, note: editSale.note ?? undefined })} disabled={updateMutation.isPending}>저장</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
