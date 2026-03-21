import { useState, useMemo, useRef } from "react";
import { getHolidayNames } from "@hyunbinseo/holidays-kr";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useRestaurant } from "@/contexts/RestaurantContext";
import AppLayout from "@/components/AppLayout";
import CostBreakdown from "@/components/CostBreakdown";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { todayKST, toKSTDateString } from "@/lib/dateKST";
import { CheckCircle2, LockKeyhole, AlertTriangle, TrendingUp, TrendingDown, Minus, ShoppingCart, Receipt, ChevronRight, Package, Loader2, History, Pencil, Download, X, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MonthNavigator } from "@/components/MonthNavigator";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

function fmt(n: number) { return n.toLocaleString("ko-KR") + "원"; }
function pct(n: number) { return n.toFixed(1) + "%"; }
function fmtShort(n: number) {
  if (Math.abs(n) >= 100000000) return (n / 100000000).toFixed(1) + "억";
  if (Math.abs(n) >= 10000) return Math.round(n / 10000) + "만";
  return n.toLocaleString("ko-KR");
}

// ─── 캘린더 탭 ────────────────────────────────────────────────────────────────
function CalendarTab({ rId, year, month, canViewLaborCost, isManager }: {
  rId: number; year: number; month: number; canViewLaborCost: boolean; isManager: boolean;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const [detailDate, setDetailDate] = useState<string | null>(null);
  const [showDetailSheet, setShowDetailSheet] = useState(false);
  // 인라인 편집 모드
  const [editMode, setEditMode] = useState(false);
  const [editSalesBreakdown, setEditSalesBreakdown] = useState<Array<{typeName: string; amount: number}>>([]);
  const [editNote, setEditNote] = useState("");
  // 간편 매입 추가
  const [showQuickPurchase, setShowQuickPurchase] = useState(false);
  const [quickVendor, setQuickVendor] = useState("");
  const [quickAmount, setQuickAmount] = useState("");
  // 영수증 미리보기
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const closingsQuery = trpc.dailyClosings.listByMonth.useQuery({ restaurantId: rId, year, month });
  const closings = closingsQuery.data ?? [];
  const closingMap = Object.fromEntries(closings.map(c => [
    typeof c.closingDate === "string" ? c.closingDate : toKSTDateString(c.closingDate as Date),
    c
  ]));

  // 월별 출근인원 집계
  const attendanceQuery = trpc.dailyClosings.getAttendanceCounts.useQuery({ restaurantId: rId, year, month });
  const attendanceCounts = attendanceQuery.data ?? {};

  const utils = trpc.useUtils();
  const closeMutation = trpc.dailyClosings.close.useMutation({
    onSuccess: () => {
      toast.success("일마감 완료");
      utils.dailyClosings.listByMonth.invalidate();
      utils.dailyClosings.getDetail.invalidate();
      setShowCloseDialog(false);
      setCloseNote("");
    },
    onError: (e) => toast.error(e.message),
  });

  // 편집 모드 — 일마감 직접 입력/수정
  const salesTypesQuery = trpc.dailyClosings.getSalesTypes.useQuery(
    { restaurantId: rId },
    { enabled: editMode }
  );
  const salesTypes = salesTypesQuery.data ?? [];

  const editCloseMutation = trpc.dailyClosings.close.useMutation({
    onSuccess: () => {
      toast.success("저장 완료");
      utils.dailyClosings.listByMonth.invalidate();
      utils.dailyClosings.getDetail.invalidate();
      setEditMode(false);
    },
    onError: (e) => toast.error(e.message),
  });

  // 간편 매입 추가
  const quickPurchaseMutation = trpc.purchasesV2.createOrder.useMutation({
    onSuccess: () => {
      toast.success("매입 추가 완료");
      utils.dailyClosings.getDetail.invalidate();
      setShowQuickPurchase(false);
      setQuickVendor("");
      setQuickAmount("");
    },
    onError: (e) => toast.error(e.message),
  });

  const counterpartiesQuery = trpc.counterparties.list.useQuery(
    { restaurantId: rId },
    { enabled: showQuickPurchase }
  );

  const openEditMode = () => {
    const closing = detailDate ? (closingMap[detailDate] as any) : null;
    if (closing?.salesBreakdown && Array.isArray(closing.salesBreakdown)) {
      setEditSalesBreakdown(closing.salesBreakdown as Array<{typeName: string; amount: number}>);
    } else {
      setEditSalesBreakdown([{ typeName: "현금", amount: 0 }, { typeName: "카드", amount: 0 }]);
    }
    setEditNote(closing?.note ?? "");
    setEditMode(true);
  };

  // 선택된 날짜의 실시간 데이터
  const dailyQuery = trpc.profitability.daily.useQuery(
    { restaurantId: rId, date: selectedDate ?? "" },
    { enabled: !!selectedDate }
  );

  // 슬라이드 패널용 상세 데이터
  const detailQuery = trpc.dailyClosings.getDetail.useQuery(
    { restaurantId: rId, date: detailDate ?? "" },
    { enabled: !!detailDate && showDetailSheet }
  );

  const openDetailSheet = (dateStr: string) => {
    setDetailDate(dateStr);
    setShowDetailSheet(true);
  };

  // 달력 계산
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=일
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = todayKST();
  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week); }

  const selectedClosing = selectedDate ? closingMap[selectedDate] : null;
  const selectedDaily = dailyQuery.data;

  // 해당 월 공휴일 맵 생성 (dateStr -> 공휴일명[])
  const holidayMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (let d = 1; d <= new Date(year, month, 0).getDate(); d++) {
      const date = new Date(year, month - 1, d);
      const names = getHolidayNames(date);
      if (names && names.length > 0) {
        const key = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        map[key] = [...names];
      }
    }
    return map;
  }, [year, month]);

  return (
    <div className="space-y-4">
      {/* 달력 */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-7 gap-1 mb-2">
            {["일", "월", "화", "수", "목", "금", "토"].map(d => (
              <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-1">{d}</div>
            ))}
          </div>
          <div className="space-y-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1">
                {week.map((day, di) => {
                  if (!day) return <div key={di} />;
                  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const closing = closingMap[dateStr];
                  const isToday = dateStr === today;
                  const isFuture = dateStr > today;
                  const isSelected = selectedDate === dateStr;
                  const profit = closing ? Number(closing.profit) : null;
                  const holidays = holidayMap[dateStr];
                  const attendeeCount = attendanceCounts[dateStr] ?? 0;
                  return (
                    <button
                      key={di}
                      onClick={() => {
                        setSelectedDate(isSelected ? null : dateStr);
                        if (!isSelected) openDetailSheet(dateStr);
                      }}
                      disabled={isFuture}
                      className={cn(
                        "relative rounded-lg p-1.5 text-center transition-all min-h-[60px] flex flex-col items-center justify-start gap-0.5",
                        isSelected ? "ring-2 ring-primary bg-primary/10" : "hover:bg-muted/60",
                        isToday && !isSelected ? "bg-primary/5 ring-1 ring-primary/30" : "",
                        isFuture ? "opacity-30 cursor-not-allowed" : "cursor-pointer",
                        closing ? (profit! >= 0 ? "bg-emerald-500/8" : "bg-red-500/8") : ""
                      )}
                    >
                      <span className={cn("text-xs font-semibold", isToday ? "text-primary" : (di === 0 || holidays) ? "text-red-400" : di === 6 ? "text-blue-400" : "text-foreground")}>
                        {day}
                      </span>
                      {holidays && (
                        <span className="text-[8px] text-red-400 leading-none text-center w-full truncate px-0.5">
                          {holidays[0]}
                        </span>
                      )}
                      {attendeeCount > 0 && (
                        <span className="text-[8px] text-blue-300 leading-none">
                          출{attendeeCount}
                        </span>
                      )}
                      {closing ? (
                        <>
                          <span className={cn("text-[9px] font-bold leading-none", profit! >= 0 ? "text-emerald-400" : "text-red-400")}>
                            {profit! >= 0 ? "+" : ""}{fmtShort(profit!)}
                          </span>
                          <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400 mt-0.5" />
                        </>
                      ) : !isFuture && (
                        <span className="text-[9px] text-muted-foreground/50 leading-none">미마감</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 선택된 날짜 상세 */}
      {selectedDate && (
        <Card className={cn("border", selectedClosing ? "border-emerald-500/30" : "border-muted")}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">
                {new Date(selectedDate).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })}
              </CardTitle>
              <div className="flex items-center gap-2">
                {selectedClosing
                  ? <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs gap-1"><CheckCircle2 className="h-3 w-3" />마감완료</Badge>
                  : <Badge variant="outline" className="text-xs text-muted-foreground">미마감</Badge>
                }
                {isManager && selectedDate <= today && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowCloseDialog(true)}>
                    <LockKeyhole className="h-3 w-3" />
                    {selectedClosing ? "재마감" : "일마감"}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {selectedClosing ? (
              <div className={cn("grid gap-3", canViewLaborCost ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3")}>
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">매출</p>
                  <p className="text-base font-bold text-emerald-400">{fmt(Number(selectedClosing.salesTotal))}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">매입(실제 합산)</p>
                  <p className="text-base font-bold text-amber-400">{fmt(Number(selectedClosing.purchasesTotal))}</p>
                </div>
                {canViewLaborCost && (
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">인건비</p>
                    <p className="text-base font-bold text-purple-400">{fmt(Number(selectedClosing.laborCost))}</p>
                  </div>
                )}
                <div className={cn("rounded-lg p-3", Number(selectedClosing.profit) >= 0 ? "bg-emerald-500/10" : "bg-red-500/10")}>
                  <p className="text-xs text-muted-foreground">순이익</p>
                  <p className={cn("text-base font-bold", Number(selectedClosing.profit) >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {fmt(Number(selectedClosing.profit))}
                  </p>
                </div>
                {selectedClosing.note && (
                  <div className="col-span-full rounded-lg bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground mb-1">메모</p>
                    <p className="text-sm">{selectedClosing.note}</p>
                  </div>
                )}
              </div>
            ) : selectedDaily ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">실시간 집계 (아직 마감 전)</p>
                <div className={cn("grid gap-3", canViewLaborCost ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">매출</p>
                    <p className="text-base font-bold">{fmt(selectedDaily.salesTotal)}</p>
                  </div>
                  {canViewLaborCost && (
                    <div className="rounded-lg bg-muted/40 p-3">
                      <p className="text-xs text-muted-foreground">인건비</p>
                      <p className="text-base font-bold text-purple-400">{fmt(selectedDaily.laborCost ?? 0)}</p>
                    </div>
                  )}
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">인건비율</p>
                    <p className="text-base font-bold">{pct(selectedDaily.laborRatio)}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">이 날의 데이터가 없습니다.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* 날짜 상세 슬라이드 패널 */}
      <Sheet open={showDetailSheet} onOpenChange={(open) => {
        setShowDetailSheet(open);
        if (!open) { setSelectedDate(null); setEditMode(false); setShowQuickPurchase(false); }
      }}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-0">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border/50">
            <div className="flex items-center justify-between pr-6">
              <div>
                <SheetTitle className="text-base font-bold">
                  {detailDate && new Date(detailDate + "T00:00:00").toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}
                </SheetTitle>
                {detailQuery.data?.closing ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-400 mt-0.5">
                    <CheckCircle2 className="h-3 w-3" />마감완료
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground mt-0.5">미마감</span>
                )}
              </div>
              {isManager && detailDate && (
                <div className="flex gap-1.5">
                  {!editMode && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-primary" onClick={openEditMode}>
                      <Pencil className="h-3 w-3" />
                      {detailQuery.data?.closing ? "수정" : "입력"}
                    </Button>
                  )}
                  {editMode && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setEditMode(false)}>
                      취소
                    </Button>
                  )}
                  {!editMode && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setShowDetailSheet(false); setSelectedDate(detailDate); setShowCloseDialog(true); }}>
                      <LockKeyhole className="h-3 w-3" />
                      {detailQuery.data?.closing ? "재마감" : "일마감"}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </SheetHeader>

          {detailQuery.isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : detailQuery.data ? (
            <div className="px-5 py-4 space-y-5">

              {/* ─── 편집 모드 ─────────────────────────────────── */}
              {editMode && isManager && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-4">
                  <p className="text-xs font-semibold text-primary uppercase tracking-wide">매출 입력 / 수정</p>

                  {/* 매출 항목별 입력 */}
                  <div className="space-y-2">
                    {editSalesBreakdown.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Input
                          className="h-8 text-xs w-24 shrink-0"
                          value={item.typeName}
                          onChange={e => setEditSalesBreakdown(prev => prev.map((it, i) => i === idx ? { ...it, typeName: e.target.value } : it))}
                          placeholder="항목명"
                        />
                        <Input
                          className="h-8 text-xs flex-1"
                          type="number"
                          value={item.amount || ""}
                          onChange={e => setEditSalesBreakdown(prev => prev.map((it, i) => i === idx ? { ...it, amount: Number(e.target.value) || 0 } : it))}
                          placeholder="금액"
                        />
                        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setEditSalesBreakdown(prev => prev.filter((_, i) => i !== idx))}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1" onClick={() => setEditSalesBreakdown(prev => [...prev, { typeName: "", amount: 0 }])}>
                      <Plus className="h-3 w-3" />항목 추가
                    </Button>
                    <div className="flex justify-between items-center pt-1 border-t border-border/40">
                      <span className="text-xs text-muted-foreground">합계</span>
                      <span className="text-sm font-bold text-emerald-400">{fmt(editSalesBreakdown.reduce((s, i) => s + i.amount, 0))}</span>
                    </div>
                  </div>

                  {/* 메모 */}
                  <div className="space-y-1">
                    <Label className="text-xs">메모</Label>
                    <Textarea className="text-xs min-h-[60px]" value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="메모 (선택)" />
                  </div>

                  {/* 저장 버튼 */}
                  <Button
                    className="w-full gap-1.5"
                    disabled={editCloseMutation.isPending || !detailDate}
                    onClick={() => {
                      if (!detailDate) return;
                      editCloseMutation.mutate({
                        restaurantId: rId,
                        date: detailDate,
                        note: editNote,
                        salesBreakdown: editSalesBreakdown.filter(i => i.typeName && i.amount > 0),
                      });
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {editCloseMutation.isPending ? "저장 중..." : (detailQuery.data?.closing ? "수정 저장" : "일마감 입력")}
                  </Button>

                  {/* 간편 매입 추가 */}
                  <div className="border-t border-border/40 pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-amber-400">간편 매입 추가</p>
                      <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-amber-400" onClick={() => setShowQuickPurchase(v => !v)}>
                        <Plus className="h-3 w-3" />{showQuickPurchase ? "닫기" : "추가"}
                      </Button>
                    </div>
                    {showQuickPurchase && (
                      <div className="space-y-2">
                        <Select value={quickVendor} onValueChange={setQuickVendor}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="거래처 선택" /></SelectTrigger>
                          <SelectContent>
                            {(counterpartiesQuery.data ?? []).map((cp: any) => (
                              <SelectItem key={cp.id} value={String(cp.id)}>{cp.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          className="h-8 text-xs"
                          type="number"
                          value={quickAmount}
                          onChange={e => setQuickAmount(e.target.value)}
                          placeholder="금액"
                        />
                        <Button
                          size="sm"
                          className="w-full h-8 text-xs gap-1"
                          disabled={!quickVendor || !quickAmount || quickPurchaseMutation.isPending}
                          onClick={() => {
                            if (!detailDate || !quickVendor || !quickAmount) return;
                            quickPurchaseMutation.mutate({
                              restaurantId: rId,
                              counterpartyId: Number(quickVendor),
                              purchaseDate: detailDate,
                              status: "received",
                              items: [{ rawItemName: "간편입력", quantity: "1", unitPrice: String(quickAmount), lineTotal: String(quickAmount) }],
                            });
                          }}
                        >
                          {quickPurchaseMutation.isPending ? "저장 중..." : "매입 저장"}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 일마감 확정 요약 */}
              {detailQuery.data.closing && (
                <div className="rounded-xl bg-muted/30 border border-border/50 p-4 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">일마감 확정 요약</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-background/60 p-3">
                      <p className="text-[10px] text-muted-foreground">매출</p>
                      <p className="text-sm font-bold text-emerald-400">{fmt(Number(detailQuery.data.closing.salesTotal))}</p>
                    </div>
                    <div className="rounded-lg bg-background/60 p-3">
                      <p className="text-[10px] text-muted-foreground">매입(실제)</p>
                      <p className="text-sm font-bold text-amber-400">{fmt(Number(detailQuery.data.closing.purchasesTotal))}</p>
                    </div>
                    {canViewLaborCost && (
                      <div className="rounded-lg bg-background/60 p-3">
                        <p className="text-[10px] text-muted-foreground">인건비</p>
                        <p className="text-sm font-bold text-purple-400">{fmt(Number(detailQuery.data.closing.laborCost))}</p>
                      </div>
                    )}
                    <div className={cn("rounded-lg p-3", Number(detailQuery.data.closing.profit) >= 0 ? "bg-emerald-500/10" : "bg-red-500/10")}>
                      <p className="text-[10px] text-muted-foreground">순이익</p>
                      <p className={cn("text-sm font-bold", Number(detailQuery.data.closing.profit) >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {fmt(Number(detailQuery.data.closing.profit))}
                      </p>
                    </div>
                  </div>
                  {detailQuery.data.closing.note && (
                    <div className="rounded-lg bg-background/40 px-3 py-2">
                      <p className="text-[10px] text-muted-foreground mb-0.5">메모</p>
                      <p className="text-xs">{detailQuery.data.closing.note}</p>
                    </div>
                  )}
                  {/* 매출 특이사항 */}
                  {(detailQuery.data.closing as any).salesSpecials && ((detailQuery.data.closing as any).salesSpecials as Array<{typeName: string; amount: number; note?: string}>).length > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">매출 특이사항</p>
                      <div className="space-y-1">
                        {((detailQuery.data.closing as any).salesSpecials as Array<{typeName: string; amount: number; note?: string}>).map((sp, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{sp.typeName}{sp.note ? ` (${sp.note})` : ''}</span>
                            <span className="text-red-400">-{fmt(sp.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 익일 스케줄 확정 여부 */}
                  {(detailQuery.data.closing as any).tomorrowScheduleConfirmed !== undefined && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">익일 스케줄</span>
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full",
                        (detailQuery.data.closing as any).tomorrowScheduleConfirmed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                      )}>
                        {(detailQuery.data.closing as any).tomorrowScheduleConfirmed ? '확정됨' : '미확정'}
                      </span>
                    </div>
                  )}
                  {/* 스케줄 메모 */}
                  {(detailQuery.data.closing as any).scheduleNote && (
                    <div className="rounded-lg bg-background/40 px-3 py-2">
                      <p className="text-[10px] text-muted-foreground mb-0.5">스케줄 특이사항</p>
                      <p className="text-xs">{(detailQuery.data.closing as any).scheduleNote}</p>
                    </div>
                  )}
                  {/* 매입 메모 */}
                  {(detailQuery.data.closing as any).purchaseNote && (
                    <div className="rounded-lg bg-background/40 px-3 py-2">
                      <p className="text-[10px] text-muted-foreground mb-0.5">매입 특이사항</p>
                      <p className="text-xs">{(detailQuery.data.closing as any).purchaseNote}</p>
                    </div>
                  )}
                </div>
              )}

              {/* 출근인원 · 인건비 요약 */}
              {(detailQuery.data.attendeeCount > 0 || (canViewLaborCost && detailQuery.data.laborCostTotal > 0)) && (
                <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 p-4 space-y-2">
                  <p className="text-xs font-semibold text-blue-300 uppercase tracking-wide">인력 현황</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-background/60 p-3">
                      <p className="text-[10px] text-muted-foreground">출근인원</p>
                      <p className="text-sm font-bold text-blue-300">{detailQuery.data.attendeeCount}명</p>
                    </div>
                    {canViewLaborCost && detailQuery.data.laborCostTotal > 0 && (
                      <div className="rounded-lg bg-background/60 p-3">
                        <p className="text-[10px] text-muted-foreground">임시직 인건비</p>
                        <p className="text-sm font-bold text-purple-400">{fmt(detailQuery.data.laborCostTotal)}</p>
                      </div>
                    )}
                  </div>
                  {/* 스케줄 목록 */}
                  {detailQuery.data.scheduleList && detailQuery.data.scheduleList.length > 0 && (
                    <div className="rounded-xl border border-border/40 overflow-hidden mt-2">
                      <div className="divide-y divide-border/30">
                        {detailQuery.data.scheduleList.map((s: any) => (
                          <div key={s.id} className="flex items-center justify-between px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium">
                                {s.tempWorkerName ?? '정규직'}
                              </span>
                              <span className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded-full",
                                s.status === 'confirmed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'
                              )}>
                                {s.status === 'confirmed' ? '확정' : '완료'}
                              </span>
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(s.startTime).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} ~
                              {new Date(s.endTime).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 매출 상세 */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Receipt className="h-4 w-4 text-emerald-400" />
                  <p className="text-sm font-semibold">매출 상세</p>
                </div>
                {detailQuery.data.salesDetail ? (
                  <div className="space-y-2">
                    <div className="rounded-xl border border-border/50 overflow-hidden">
                      <div className="divide-y divide-border/40">
                        <div className="flex items-center justify-between px-4 py-2.5">
                          <span className="text-xs text-muted-foreground">현금</span>
                          <span className="text-sm font-semibold">{fmt(Number(detailQuery.data.salesDetail.cashAmount))}</span>
                        </div>
                        <div className="flex items-center justify-between px-4 py-2.5">
                          <span className="text-xs text-muted-foreground">카드</span>
                          <span className="text-sm font-semibold">{fmt(Number(detailQuery.data.salesDetail.cardAmount))}</span>
                        </div>
                        {detailQuery.data.otherItems.map((item: any) => (
                          <div key={item.id} className="flex items-center justify-between px-4 py-2.5">
                            <span className="text-xs text-muted-foreground">{item.itemName}</span>
                            <span className="text-sm font-semibold">{fmt(Number(item.amount))}</span>
                          </div>
                        ))}
                        {Number(detailQuery.data.salesDetail.discountAmount) > 0 && (
                          <div className="flex items-center justify-between px-4 py-2.5 bg-red-500/5">
                            <span className="text-xs text-red-400">할인</span>
                            <span className="text-sm font-semibold text-red-400">-{fmt(Number(detailQuery.data.salesDetail.discountAmount))}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-500/5">
                          <span className="text-xs font-semibold text-emerald-400">합계</span>
                          <span className="text-sm font-bold text-emerald-400">{fmt(Number(detailQuery.data.salesDetail.totalAmount))}</span>
                        </div>
                      </div>
                    </div>
                    {detailQuery.data.salesDetail.receiptCount > 0 && (
                      <p className="text-[10px] text-muted-foreground text-right">영수증 {detailQuery.data.salesDetail.receiptCount}건</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border/40 py-6 text-center">
                    <p className="text-xs text-muted-foreground">매출 데이터가 없습니다</p>
                  </div>
                )}
              </div>

              <Separator className="opacity-30" />

              {/* 매입 목록 */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <ShoppingCart className="h-4 w-4 text-amber-400" />
                  <p className="text-sm font-semibold">매입 목록</p>
                  {(detailQuery.data.purchaseList.length + detailQuery.data.purchaseOrderList.length) > 0 && (
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                      {detailQuery.data.purchaseList.length + detailQuery.data.purchaseOrderList.length}건
                    </Badge>
                  )}
                </div>

                {/* 레거시 purchases 테이블 */}
                {detailQuery.data.purchaseList.length > 0 && (
                  <div className="rounded-xl border border-border/50 overflow-hidden mb-2">
                    <div className="divide-y divide-border/40">
                      {detailQuery.data.purchaseList.map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{p.itemName}</p>
                            {p.vendorName && <p className="text-[10px] text-muted-foreground">{p.vendorName}</p>}
                          </div>
                          <div className="text-right shrink-0 ml-3">
                            <p className="text-sm font-semibold">{fmt(Number(p.cost))}</p>
                            <Badge variant="outline" className={cn("text-[9px] h-3.5 px-1", p.purchaseStatus === "ordered" ? "text-amber-400 border-amber-400/30" : "text-emerald-400 border-emerald-400/30")}>
                              {p.purchaseStatus === "ordered" ? "발주" : "입고"}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 신규 purchaseOrdersV2 전표 */}
                {detailQuery.data.purchaseOrderList.map((order: any) => {
                  const items = (detailQuery.data?.purchaseOrderItems ?? []).filter((i: any) => i.purchaseOrderId === order.id);
                  return (
                    <div key={order.id} className="rounded-xl border border-border/50 overflow-hidden mb-2">
                      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20">
                        <div className="flex items-center gap-2 min-w-0">
                          <Package className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                          <span className="text-xs font-medium">{(order as any).counterpartyName ?? `전표 #${order.id}`}</span>
                          {order.note && <span className="text-[10px] text-muted-foreground truncate">— {order.note}</span>}
                          {(order as any).attachmentUrl && (
                            <button
                              className="text-[10px] text-primary underline shrink-0"
                              onClick={() => setPreviewUrl((order as any).attachmentUrl)}
                            >
                              영수증
                            </button>
                          )}
                        </div>
                        <span className="text-sm font-bold text-amber-400 shrink-0">{fmt(Number(order.totalAmount))}</span>
                      </div>
                      {items.length > 0 && (
                        <div className="divide-y divide-border/40">
                          {items.map((item: any) => (
                            <div key={item.id} className="flex items-center justify-between px-4 py-2 pl-8">
                              <div className="min-w-0">
                                <p className="text-xs truncate">{item.rawItemName || "품목"}</p>
                                {item.quantity && <p className="text-[10px] text-muted-foreground">{Number(item.quantity)}{item.unitName || ""} × {item.unitPrice ? fmt(Number(item.unitPrice)) : ""}</p>}
                              </div>
                              <p className="text-xs font-semibold shrink-0 ml-2">{fmt(Number(item.lineTotal))}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {detailQuery.data.purchaseList.length === 0 && detailQuery.data.purchaseOrderList.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border/40 py-6 text-center">
                    <p className="text-xs text-muted-foreground">매입 내역이 없습니다</p>
                  </div>
                )}
              </div>

              {/* 수정 이력 */}
              {detailQuery.data?.closing && (detailQuery.data.closing as any).editHistory && ((detailQuery.data.closing as any).editHistory as Array<{userId: number; userName: string; at: string; summary: string}>).length > 0 && (
                <div>
                  <Separator className="opacity-30" />
                  <div className="flex items-center gap-2 mb-3 mt-5">
                    <History className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-semibold">수정 이력</p>
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                      {((detailQuery.data.closing as any).editHistory as any[]).length}건
                    </Badge>
                  </div>
                  <div className="rounded-xl border border-border/50 overflow-hidden">
                    <div className="divide-y divide-border/40">
                      {((detailQuery.data.closing as any).editHistory as Array<{userId: number; userName: string; at: string; summary: string}>).map((entry, idx) => (
                        <div key={idx} className="px-4 py-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-foreground flex items-center gap-1">
                              <Pencil className="h-3 w-3 text-muted-foreground" />
                              {entry.userName}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(entry.at).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground">{entry.summary}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

            </div>
          ) : (
            <div className="flex items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">데이터를 불러오는 중 오류가 발생했습니다.</p>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ImagePreviewModal url={previewUrl} onClose={() => setPreviewUrl(null)} />

      {/* 일마감 다이얼로그 */}
      <Dialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <LockKeyhole className="h-4 w-4" />
              일마감 — {selectedDate && new Date(selectedDate).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {selectedClosing && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg p-3">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                이미 마감된 날입니다. 재마감하면 기존 데이터를 덮어씁니다.
              </div>
            )}
            <div>
              <Label className="text-xs">메모 (선택)</Label>
              <Textarea value={closeNote} onChange={e => setCloseNote(e.target.value)} placeholder="특이사항 메모" className="mt-1 text-sm resize-none" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCloseDialog(false)}>취소</Button>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
              onClick={() => selectedDate && closeMutation.mutate({ restaurantId: rId, date: selectedDate, note: closeNote || undefined })}
              disabled={closeMutation.isPending}
            >
              <LockKeyhole className="h-3.5 w-3.5" />
              {closeMutation.isPending ? "마감 중..." : "확정"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── 월마감 탭 ────────────────────────────────────────────────────────────────
function MonthlyCloseTab({ rId, year, month, restaurantName, canViewLaborCost, isManager }: {
  rId: number; year: number; month: number; restaurantName: string; canViewLaborCost: boolean; isManager: boolean;
}) {
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [closeMonth, setCloseMonth] = useState(month);
  const [closeNote, setCloseNote] = useState("");
  const [selectedDetailMonth, setSelectedDetailMonth] = useState<number | null>(null);
  const detailRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const handleGridClick = (m: number, hasClosed: boolean) => {
    if (hasClosed) {
      // 마감된 월: 상세 패널 토글 + 스크롤
      const next = selectedDetailMonth === m ? null : m;
      setSelectedDetailMonth(next);
      if (next !== null) {
        // 다음 렌더링 후 스크롤
        setTimeout(() => {
          detailRefs.current[m]?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
      }
    } else {
      // 미마감 월: 월마감 다이얼로그 열기 (점장 이상)
      if (isManager) {
        setCloseMonth(m);
        setShowCloseDialog(true);
      }
    }
  };

  const listQuery = trpc.monthlyClosings.listByYear.useQuery({ restaurantId: rId, year });
  const closings = listQuery.data ?? [];
  const closingMap = Object.fromEntries(closings.map(c => [c.month, c]));

  const utils = trpc.useUtils();
  const closeMutation = trpc.monthlyClosings.close.useMutation({
    onSuccess: () => {
      toast.success("월마감이 완료되었습니다.");
      utils.monthlyClosings.listByYear.invalidate();
      setShowCloseDialog(false);
      setCloseNote("");
    },
    onError: (e) => toast.error(e.message),
  });

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  return (
    <div className="space-y-4">
      {/* 연간 월마감 현황 그리드 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">{year}년 월마감 현황</CardTitle>
            {isManager && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowCloseDialog(true)}>
                <LockKeyhole className="h-3 w-3" />월마감
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
              const closing = closingMap[m];
              const isFuture = year > currentYear || (year === currentYear && m > currentMonth);
              const profit = closing ? Number(closing.profit) : null;
              const isSelected = selectedDetailMonth === m;
              return (
                <div
                  key={m}
                  onClick={() => !isFuture && handleGridClick(m, !!closing)}
                  className={cn(
                    "rounded-lg p-3 text-center transition-all",
                    closing
                      ? (profit! >= 0
                          ? "bg-emerald-500/10 border border-emerald-500/20 cursor-pointer hover:bg-emerald-500/20"
                          : "bg-red-500/10 border border-red-500/20 cursor-pointer hover:bg-red-500/20")
                      : isFuture
                        ? "bg-muted/20 opacity-40"
                        : isManager
                          ? "bg-muted/40 cursor-pointer hover:bg-muted/60 border border-dashed border-border/50"
                          : "bg-muted/40",
                    isSelected && "ring-2 ring-primary/50"
                  )}
                >
                  <p className="text-xs font-semibold text-muted-foreground mb-1">{m}월</p>
                  {closing ? (
                    <>
                      <p className={cn("text-sm font-bold", profit! >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {profit! >= 0 ? "+" : ""}{fmtShort(profit!)}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{fmtShort(Number(closing.salesTotal))} 매출</p>
                      <CheckCircle2 className={cn("h-3 w-3 mx-auto mt-1", isSelected ? "text-primary" : "text-emerald-400")} />
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {isFuture ? "-" : isManager ? "클릭하여 마감" : "미마감"}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 마감된 월 상세 목록 */}
      {closings.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">마감 내역</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {closings.sort((a, b) => b.month - a.month).map(c => {
              const profit = Number(c.profit);
              const sales = Number(c.salesTotal);
              const purchases = Number(c.purchasesTotal);
              const labor = Number(c.laborCost);
              const fixed = Number(c.fixedCostsTotal);
              const profitRatio = sales > 0 ? (profit / sales) * 100 : 0;
              const isExpanded = selectedDetailMonth === c.month;
              return (
                <div
                  key={c.month}
                  ref={el => { detailRefs.current[c.month] = el; }}
                  className="rounded-lg border border-border/50 overflow-hidden"
                >
                  {/* 요약 헤더 줄 - 클릭 시 펼치기 */}
                  <div
                    className="flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedDetailMonth(isExpanded ? null : c.month)}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold", profit >= 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400")}>
                        {c.month}월
                      </div>
                      <div>
                        <p className="text-sm font-medium">매출 {fmt(sales)}</p>
                        <p className="text-xs text-muted-foreground">
                          매입 {fmt(purchases)}
                          {canViewLaborCost && ` · 인건비 ${fmt(labor)}`}
                          {` · 고정비 ${fmt(fixed)}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div className="flex items-center gap-1">
                          {profit >= 0 ? <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> : <TrendingDown className="h-3.5 w-3.5 text-red-400" />}
                          <p className={cn("text-sm font-bold", profit >= 0 ? "text-emerald-400" : "text-red-400")}>{fmt(profit)}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">이익률 {pct(profitRatio)}</p>
                      </div>
                      <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
                    </div>
                  </div>

                  {/* 상세 패널 - 펼쳐진 경우 */}
                  {isExpanded && (
                    <div className="p-4 border-t border-border/50 space-y-4 bg-background/50">
                      {/* KPI 카드 그리드 */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div className="rounded-lg bg-emerald-500/10 p-3">
                          <p className="text-[10px] text-muted-foreground mb-1">매출 합계</p>
                          <p className="text-sm font-bold text-emerald-400">{fmt(sales)}</p>
                        </div>
                        <div className="rounded-lg bg-amber-500/10 p-3">
                          <p className="text-[10px] text-muted-foreground mb-1">매입 합계</p>
                          <p className="text-sm font-bold text-amber-400">{fmt(purchases)}</p>
                        </div>
                        <div className="rounded-lg bg-blue-500/10 p-3">
                          <p className="text-[10px] text-muted-foreground mb-1">고정비</p>
                          <p className="text-sm font-bold text-blue-400">{fmt(fixed)}</p>
                        </div>
                        {canViewLaborCost && (
                          <div className="rounded-lg bg-purple-500/10 p-3">
                            <p className="text-[10px] text-muted-foreground mb-1">인건비</p>
                            <p className="text-sm font-bold text-purple-400">{fmt(labor)}</p>
                          </div>
                        )}
                        <div className={cn("rounded-lg p-3", profit >= 0 ? "bg-emerald-500/10" : "bg-red-500/10")}>
                          <p className="text-[10px] text-muted-foreground mb-1">순이익</p>
                          <p className={cn("text-sm font-bold", profit >= 0 ? "text-emerald-400" : "text-red-400")}>
                            {profit >= 0 ? "+" : ""}{fmt(profit)}
                          </p>
                        </div>
                        <div className="rounded-lg bg-muted/40 p-3">
                          <p className="text-[10px] text-muted-foreground mb-1">이익률</p>
                          <p className="text-sm font-bold">{pct(profitRatio)}</p>
                        </div>
                      </div>

                      {/* 마감 메모 */}
                      {c.note && (
                        <div className="rounded-lg bg-muted/30 p-3">
                          <p className="text-[10px] text-muted-foreground mb-1">마감 메모</p>
                          <p className="text-xs">{c.note}</p>
                        </div>
                      )}

                      {/* 마감 정보 */}
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>마감 확정일: {new Date(c.closedAt).toLocaleDateString("ko-KR")}</span>
                      </div>

                      {/* PDF 다운로드 버튼 */}
                      {isManager && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full h-8 gap-2 text-xs"
                          onClick={() => {
                            const url = `/api/report/monthly-pdf/${rId}/${year}/${c.month}`;
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `${restaurantName}_${year}년${c.month}월_월마감리포트.pdf`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                          }}
                        >
                          <Download className="h-3.5 w-3.5" />
                          {year}년 {c.month}월 월마감 리포트 PDF 다운로드
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* 마감 전 안내 메시지 */}
      {closings.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <LockKeyhole className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">{year}년에 마감된 월이 없습니다.</p>
            {isManager && (
              <p className="text-xs text-muted-foreground mt-1">월마감 버튼을 눌러 월마감을 확정하세요.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* 월마감 다이얼로그 */}
      <Dialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <LockKeyhole className="h-4 w-4" />
              월마감 확정
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">마감 월</Label>
              <Select value={String(closeMonth)} onValueChange={v => setCloseMonth(Number(v))}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                    <SelectItem key={m} value={String(m)}>{year}년 {m}월</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {closingMap[closeMonth] && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg p-3">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                이미 마감된 월입니다. 재마감하면 기존 데이터를 덮어씁니다.
              </div>
            )}
            <div>
              <Label className="text-xs">메모 (선택)</Label>
              <Textarea value={closeNote} onChange={e => setCloseNote(e.target.value)} placeholder="특이사항 메모" className="mt-1 text-sm resize-none" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCloseDialog(false)}>취소</Button>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
              onClick={() => closeMutation.mutate({ restaurantId: rId, year, month: closeMonth, note: closeNote || undefined })}
              disabled={closeMutation.isPending}
            >
              <LockKeyhole className="h-3.5 w-3.5" />
              {closeMutation.isPending ? "마감 중..." : "월마감 확정"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────
export default function ProfitabilityPage() {
  const { user } = useAuth();
  const { selectedRestaurantId, selectedRestaurant } = useRestaurant();
  const rId = selectedRestaurantId;
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tab, setTab] = useState("calendar");
  const handleMonthChange = (y: number, m: number) => { setYear(y); setMonth(m); };

  const storeRoleQuery = trpc.restaurants.getMyStoreRole.useQuery(
    { restaurantId: rId! },
    { enabled: !!rId }
  );
  const storeRole = storeRoleQuery.data;
  const canViewLaborCost = storeRole === "store_manager" || user?.role === "admin" || user?.role === "master";
  const isManager = storeRole === "store_manager" || storeRole === "manager" || user?.role === "admin" || user?.role === "master" || user?.role === "manager";

  const profitQuery = trpc.profitability.monthly.useQuery(
    { restaurantId: rId!, year, month },
    { enabled: !!rId && tab === "monthly", refetchInterval: 60000 }
  );
  const p = profitQuery.data;
  const salesProgress = p && p.monthlyTargetSales > 0 ? (p.salesTotal / p.monthlyTargetSales) * 100 : 0;

  if (!rId) {
    return (
      <AppLayout title="분석캘린더">
        <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요.</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="분석캘린더" subtitle={`${year}년 ${month}월`}>
      <div className="p-4 lg:p-6 space-y-4">
        {/* 기간 선택 */}
        <div className="flex items-center gap-2">
          <div className="flex-1"><MonthNavigator year={year} month={month} onChange={handleMonthChange} /></div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-3 h-9">
            <TabsTrigger value="calendar" className="text-xs">일마감 캘린더</TabsTrigger>
            <TabsTrigger value="monthly" className="text-xs">월별 분석</TabsTrigger>
            <TabsTrigger value="closing" className="text-xs">월마감</TabsTrigger>
          </TabsList>

          {/* ── 월별 분석 탭 ── */}
          <TabsContent value="monthly" className="mt-4 space-y-4">
            {/* 매출 목표 달성률 */}
            {p && p.monthlyTargetSales > 0 && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">매출 목표 달성률</p>
                    <p className="text-sm font-bold">
                      {pct(salesProgress)} <span className="text-muted-foreground font-normal text-xs">({fmt(p.salesTotal)} / {fmt(p.monthlyTargetSales)})</span>
                    </p>
                  </div>
                  <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", salesProgress >= 100 ? "bg-green-500" : salesProgress >= 70 ? "bg-blue-500" : "bg-amber-500")}
                      style={{ width: `${Math.min(100, salesProgress)}%` }}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {p ? (
              <CostBreakdown
                salesTotal={p.salesTotal}
                purchasesTotal={p.purchasesTotal}
                fixedCostsTotal={p.fixedCostsTotal}
                laborCost={p.laborCost}
                profit={p.profit}
                purchaseRatio={p.purchaseRatio}
                fixedRatio={p.fixedRatio}
                laborRatio={p.laborRatio}
                costRatio={p.costRatio}
                targetCostRatio={p.targetCostRatio}
                targetLaborRatio={p.targetLaborRatio}
                laborByUser={p.laborByUser}
                fixedByCategory={p.fixedByCategory}
              />
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  {profitQuery.isLoading ? "데이터를 불러오는 중..." : "이 달의 데이터가 없습니다."}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── 일마감 캘린더 탭 ── */}
          <TabsContent value="calendar" className="mt-4">
            <CalendarTab rId={rId} year={year} month={month} canViewLaborCost={canViewLaborCost} isManager={isManager} />
          </TabsContent>

          {/* ── 월마감 탭 ── */}
          <TabsContent value="closing" className="mt-4">
            <MonthlyCloseTab rId={rId} year={year} month={month} restaurantName={selectedRestaurant?.name ?? "매장"} canViewLaborCost={canViewLaborCost} isManager={isManager} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
