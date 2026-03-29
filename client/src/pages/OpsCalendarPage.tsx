import { useState, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { getHolidayName } from "@/lib/koreanHolidays";
import {
  ChevronLeft, ChevronRight, CalendarDays, CheckCircle2, Clock,
  XCircle, Users, TrendingUp, TrendingDown, ClipboardCheck, X, Receipt,
  Wallet, ShoppingCart, ArrowRight, Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
} from "@/components/ui/drawer";

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function fmtWon(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}만`;
  return n.toLocaleString();
}
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}
function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month - 1, 1).getDay();
}
function fmtTime(d: string | Date) {
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
}

// ─── 일별 상세 콘텐츠 (Drawer/Panel 공용) ──────────────────────────────────
function DayDetailContent({ restaurantId, date }: {
  restaurantId: number; date: string;
}) {
  const { data, isLoading } = trpc.dailyOps.getDayDetail.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 },
  );

  if (isLoading) return <div className="text-center py-8 text-muted-foreground text-sm">로딩 중...</div>;
  if (!data) return <div className="text-center py-8 text-muted-foreground text-sm">데이터 없음</div>;

  return (
    <div className="space-y-4">
      {/* 일일운영 상태 */}
      <section>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <ClipboardCheck className="w-3.5 h-3.5" /> 일일 운영
        </h4>
        <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">오픈</span>
            {data.operation?.openCheckedAt ? (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {fmtTime(data.operation.openCheckedAt)} · {data.operation.openHeadcount ?? 0}명
              </span>
            ) : <span className="text-muted-foreground">미완료</span>}
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">마감</span>
            {data.operation?.closeCheckedAt ? (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {fmtTime(data.operation.closeCheckedAt)} · {data.operation.closeHeadcount ?? 0}명{data.operation.closedByName ? ` · ${data.operation.closedByName}` : ""}
              </span>
            ) : <span className="text-muted-foreground">미완료</span>}
          </div>
          {data.checklists.length > 0 && (
            <div className="pt-1 border-t border-border/50 mt-1">
              {data.checklists.map((c: any, i: number) => {
                const tabLabels: Record<string, string> = { open: "오픈", purchase: "매입", midday: "일간보고", close: "마감" };
                const label = tabLabels[c.targetTab] ?? c.targetTab ?? c.checkType;
                return (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{label} 체크</span>
                    <span className={c.checkedCount > 0 ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-muted-foreground"}>
                      {c.checkedCount}항목 완료
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 스케줄 */}
      <section>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" /> 스케줄 ({data.schedules.length}명)
        </h4>
        {data.schedules.length === 0 ? (
          <p className="text-xs text-muted-foreground pl-1">등록된 스케줄 없음</p>
        ) : (
          <div className="space-y-1">
            {data.schedules.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                <span className="text-xs font-medium text-foreground">{s.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {fmtTime(s.startTime)}~{fmtTime(s.endTime)}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    s.status === "completed" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : s.status === "confirmed" ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                    : "bg-muted text-muted-foreground"
                  }`}>{s.status === "completed" ? "완료" : s.status === "confirmed" ? "확정" : "초안"}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 매출 */}
      <section>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Receipt className="w-3.5 h-3.5" /> 매출
        </h4>
        {!data.sales ? (
          <p className="text-xs text-muted-foreground pl-1">매출 입력 없음</p>
        ) : (
          <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">총 매출</span>
              <span className="text-sm font-bold text-foreground">₩{data.sales.totalAmount.toLocaleString()}</span>
            </div>
            <div className="grid grid-cols-2 gap-1 pt-1 border-t border-border/50">
              {data.sales.cashAmount > 0 && (
                <div className="text-[11px]"><span className="text-muted-foreground">현금</span> <span className="font-medium text-foreground">{fmtWon(data.sales.cashAmount)}</span></div>
              )}
              {data.sales.cardAmount > 0 && (
                <div className="text-[11px]"><span className="text-muted-foreground">카드</span> <span className="font-medium text-foreground">{fmtWon(data.sales.cardAmount)}</span></div>
              )}
              {data.sales.giftCardAmount > 0 && (
                <div className="text-[11px]"><span className="text-muted-foreground">상품권</span> <span className="font-medium text-foreground">{fmtWon(data.sales.giftCardAmount)}</span></div>
              )}
              {data.sales.transferAmount > 0 && (
                <div className="text-[11px]"><span className="text-muted-foreground">이체</span> <span className="font-medium text-foreground">{fmtWon(data.sales.transferAmount)}</span></div>
              )}
            </div>
            {data.midSalesTotal > 0 && (
              <div className="text-[11px] pt-1 border-t border-border/50">
                <span className="text-muted-foreground">중간매출 합계</span> <span className="font-medium text-foreground">₩{data.midSalesTotal.toLocaleString()}</span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 매입 */}
      <section>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <ShoppingCart className="w-3.5 h-3.5" /> 매입 ({data.purchases.length}건)
        </h4>
        {data.purchases.length === 0 ? (
          <p className="text-xs text-muted-foreground pl-1">매입 내역 없음</p>
        ) : (
          <div className="space-y-1">
            {data.purchases.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                <span className="text-xs font-medium text-foreground">{p.counterparty}</span>
                <span className="text-xs text-foreground font-medium">₩{p.amount.toLocaleString()}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 pt-1">
              <span className="text-xs text-muted-foreground font-medium">매입 합계</span>
              <span className="text-xs font-bold text-foreground">₩{data.purchaseTotal.toLocaleString()}</span>
            </div>
          </div>
        )}
      </section>

      {/* 일일 손익 요약 */}
      {data.sales && (
        <section className="border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">일일 매출 - 매입</span>
            <span className={`text-sm font-bold ${data.sales.totalAmount - data.purchaseTotal >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
              ₩{(data.sales.totalAmount - data.purchaseTotal).toLocaleString()}
            </span>
          </div>
        </section>
      )}
    </div>
  );
}


// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export default function OpsCalendarPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const prevMonth = () => {
    if (month === 1) { setYear(year - 1); setMonth(12); } else setMonth(month - 1);
    setSelectedDate(null);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(year + 1); setMonth(1); } else setMonth(month + 1);
    setSelectedDate(null);
  };
  const goThisMonth = () => {
    setYear(today.getFullYear()); setMonth(today.getMonth() + 1); setSelectedDate(null);
  };

  // ─── 데이터 소스 ─────────────────────────────────────────────────────────
  const { data: calData } = trpc.dailyOps.getMonthlyCalendar.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 },
  );
  // 월간 P&L용 추가 데이터
  const { data: fixedTotal } = trpc.fixedCosts.monthlyTotal.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 },
  );
  const { data: closingSummary } = trpc.dailyClosings.monthlySummary.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 },
  );

  const daysInMonth = getDaysInMonth(year, month);
  const firstDow = getFirstDayOfWeek(year, month);

  const stats = useMemo(() => {
    if (!calData) return { totalSales: 0, totalPurchases: 0, closedDays: 0, avgSales: 0 };
    const salesDays = Object.values(calData.days).filter((d) => d.totalSales > 0).length;
    return {
      totalSales: calData.totalSales,
      totalPurchases: calData.totalPurchases,
      closedDays: calData.closedDays,
      avgSales: salesDays > 0 ? Math.round(calData.totalSales / salesDays) : 0,
    };
  }, [calData]);

  // 월간 P&L: 수익분석과 동일하게 마감 기준 데이터 사용
  const closedSales = Number(closingSummary?.salesTotal ?? 0);
  const closedPurchases = Number(closingSummary?.purchasesTotal ?? 0);
  const fixed = Number(fixedTotal?.total ?? 0);
  const labor = Number(closingSummary?.laborCost ?? 0);
  const closedDayCount = closingSummary?.closedDays ?? 0;
  const netProfit = closedSales - closedPurchases - fixed - labor;

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const selectedDow = selectedDate ? DAY_LABELS[new Date(selectedDate + "T00:00:00").getDay()] : "";
  const selectedHoliday = selectedDate ? getHolidayName(selectedDate) : null;

  if (!current) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  return (
    <div className="flex h-full">
      {/* 좌측: 캘린더 */}
      <div className={`flex-1 min-w-0 p-4 md:p-6 space-y-4 overflow-y-auto ${selectedDate ? "hidden lg:block lg:max-w-[calc(100%-340px)]" : ""}`}>
        <div className="max-w-3xl mx-auto space-y-4">
          {/* 헤더 */}
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
              <CalendarDays className="w-5 h-5" /> 운영 캘린더
            </h1>
            <span className="text-xs text-muted-foreground">{current.name}</span>
          </div>

          {/* 월 네비게이션 */}
          <div className="flex items-center justify-between bg-card border border-border rounded-lg p-3">
            <Button variant="ghost" size="sm" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
            <div className="text-base font-bold text-foreground">{year}년 {month}월</div>
            <Button variant="ghost" size="sm" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
          </div>

          {/* 월간 P&L 요약 (마감 기준 — 수익분석과 동일) */}
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-muted-foreground font-medium">{closedDayCount}일 마감 기준</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground">매출</div>
                <div className="text-sm font-bold text-foreground">{closedSales > 0 ? `₩${fmtWon(closedSales)}` : "-"}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground">매입</div>
                <div className="text-sm font-bold text-foreground">{closedPurchases > 0 ? `₩${fmtWon(closedPurchases)}` : "-"}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground">고정비</div>
                <div className="text-sm font-bold text-foreground">{fixed > 0 ? `₩${fmtWon(fixed)}` : "-"}</div>
              </div>
            </div>
            <div className="border-t border-border/50 pt-2 grid grid-cols-3 gap-2">
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground">인건비</div>
                <div className="text-sm font-bold text-foreground">{labor > 0 ? `₩${fmtWon(labor)}` : "-"}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground">마감</div>
                <div className="text-sm font-bold text-foreground">{closedDayCount}일</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground">순이익</div>
                <div className={`text-sm font-bold ${netProfit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {closedSales > 0 ? (
                    <span className="flex items-center justify-center gap-0.5">
                      {netProfit >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {netProfit >= 0 ? "+" : ""}{fmtWon(netProfit)}
                    </span>
                  ) : "-"}
                </div>
              </div>
            </div>
          </div>

          {/* 캘린더 그리드 */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="grid grid-cols-7 border-b border-border">
              {DAY_LABELS.map((d, i) => (
                <div key={d} className={`text-center text-xs font-medium py-2 ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-muted-foreground"}`}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: firstDow }).map((_, i) => (
                <div key={`empty-${i}`} className="border-b border-r border-border min-h-[72px]" />
              ))}
              {Array.from({ length: daysInMonth }).map((_, idx) => {
                const day = idx + 1;
                const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const dow = (firstDow + idx) % 7;
                const dayData = calData?.days[dateStr];
                const holiday = getHolidayName(dateStr);
                const isToday = dateStr === todayStr;
                const isFuture = dateStr > todayStr;
                const isSelected = dateStr === selectedDate;
                const StatusIcon = dayData?.status === "closed" ? CheckCircle2 : dayData?.status === "open" ? Clock : XCircle;
                const statusColor = dayData?.status === "closed" ? "text-green-600" : dayData?.status === "open" ? "text-amber-500" : "text-muted-foreground/30";
                const dailyProfit = (dayData?.totalSales ?? 0) - (dayData?.totalPurchases ?? 0);

                return (
                  <div
                    key={day}
                    onClick={() => !isFuture && setSelectedDate(isSelected ? null : dateStr)}
                    className={`border-b border-r border-border min-h-[72px] p-1 relative cursor-pointer transition-colors hover:bg-accent/50
                      ${isToday ? "bg-primary/5 ring-1 ring-primary/30 ring-inset" : ""}
                      ${isFuture ? "opacity-40 cursor-default" : ""}
                      ${isSelected ? "bg-primary/10 ring-2 ring-primary/50 ring-inset" : ""}`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={`text-xs font-medium ${dow === 0 || holiday ? "text-red-500" : dow === 6 ? "text-blue-500" : "text-foreground"} ${isToday ? "bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-[10px]" : ""}`}>{day}</span>
                      {!isFuture && dayData && <StatusIcon className={`w-3 h-3 ${statusColor}`} />}
                    </div>
                    {holiday && <div className="text-[9px] text-red-400 truncate leading-tight">{holiday}</div>}
                    {dayData?.closedByName && (
                      <div className="text-[9px] text-green-600 dark:text-green-400 truncate leading-tight">
                        {dayData.closedByName}
                      </div>
                    )}
                    {/* 매출 */}
                    {dayData && dayData.totalSales > 0 && (
                      <div className="text-[10px] font-medium text-foreground mt-0.5 flex items-center gap-0.5">
                        <TrendingUp className="w-2.5 h-2.5 text-emerald-500 shrink-0" />
                        <span className="truncate">{fmtWon(dayData.totalSales)}</span>
                      </div>
                    )}
                    {/* 매입 */}
                    {dayData && dayData.totalPurchases > 0 && (
                      <div className="text-[10px] font-medium text-foreground mt-0.5 flex items-center gap-0.5">
                        <ShoppingCart className="w-2.5 h-2.5 text-orange-400 shrink-0" />
                        <span className="truncate text-muted-foreground">{fmtWon(dayData.totalPurchases)}</span>
                      </div>
                    )}
                    {/* 일일 손익 (매출+매입 모두 있을 때) */}
                    {dayData && dayData.totalSales > 0 && dayData.totalPurchases > 0 && (
                      <div className={`text-[9px] font-medium mt-0.5 ${dailyProfit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {dailyProfit >= 0 ? "+" : ""}{fmtWon(dailyProfit)}
                      </div>
                    )}
                    {/* 체크리스트 완료 현황 */}
                    {dayData?.checklist && dayData.checklist.total > 0 && (
                      <div className={`text-[9px] flex items-center gap-0.5 mt-0.5 ${dayData.checklist.checked === dayData.checklist.total ? "text-emerald-600" : dayData.checklist.checked > 0 ? "text-blue-500" : "text-muted-foreground/50"}`}>
                        <ClipboardCheck className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">{dayData.checklist.checked}/{dayData.checklist.total}</span>
                      </div>
                    )}
                    {/* 스케줄 (공간 있을 때만) */}
                    {dayData?.schedule && dayData.schedule.total > 0 && !dayData.totalPurchases && !dayData?.checklist && (
                      <div className={`text-[9px] flex items-center gap-0.5 mt-0.5 ${dayData.schedule.completed === dayData.schedule.total ? "text-emerald-600" : dayData.schedule.completed > 0 ? "text-blue-500" : "text-muted-foreground"}`}>
                        <Users className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">{dayData.schedule.completed}/{dayData.schedule.total}</span>
                      </div>
                    )}
                  </div>
                );
              })}
              {(() => {
                const lastDow = (firstDow + daysInMonth - 1) % 7;
                const remaining = lastDow < 6 ? 6 - lastDow : 0;
                return Array.from({ length: remaining }).map((_, i) => (
                  <div key={`end-${i}`} className="border-b border-r border-border min-h-[72px]" />
                ));
              })()}
            </div>
          </div>

          {/* 범례 */}
          <div className="flex flex-wrap items-center gap-3 justify-center text-xs text-muted-foreground">
            <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-600" /> 마감</div>
            <div className="flex items-center gap-1"><Clock className="w-3 h-3 text-amber-500" /> 오픈</div>
            <div className="flex items-center gap-1"><TrendingUp className="w-3 h-3 text-emerald-500" /> 매출</div>
            <div className="flex items-center gap-1"><ShoppingCart className="w-3 h-3 text-orange-400" /> 매입</div>
            <div className="flex items-center gap-1"><ClipboardCheck className="w-3 h-3 text-blue-500" /> 체크리스트</div>
            <div className="flex items-center gap-1"><Users className="w-3 h-3 text-blue-500" /> 스케줄</div>
          </div>

          {(year !== today.getFullYear() || month !== today.getMonth() + 1) && (
            <div className="text-center">
              <Button variant="outline" size="sm" onClick={goThisMonth}>이번 달로</Button>
            </div>
          )}
        </div>
      </div>

      {/* 모바일: Drawer (바텀시트) */}
      <Drawer open={!!selectedDate} onOpenChange={(open) => { if (!open) setSelectedDate(null); }}>
        <DrawerContent className="lg:hidden max-h-[85vh]">
          <DrawerHeader className="pb-2">
            <DrawerTitle className="text-sm">
              {selectedDate?.slice(5).replace("-", "/")} ({selectedDow})
              {selectedHoliday && <span className="text-red-500 ml-1 text-xs">{selectedHoliday}</span>}
            </DrawerTitle>
            <DrawerDescription className="text-xs">일별 운영 상세</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-6 overflow-y-auto">
            {selectedDate && <DayDetailContent restaurantId={restaurantId} date={selectedDate} />}
          </div>
        </DrawerContent>
      </Drawer>

      {/* 데스크탑: 사이드 패널 */}
      {selectedDate && (
        <div className="hidden lg:flex w-[340px] shrink-0 h-full flex-col bg-card border-l border-border">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <h3 className="text-sm font-bold text-foreground">
              {selectedDate.slice(5).replace("-", "/")} ({selectedDow})
              {selectedHoliday && <span className="text-red-500 ml-1 text-xs">{selectedHoliday}</span>}
            </h3>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedDate(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <DayDetailContent restaurantId={restaurantId} date={selectedDate} />
          </div>
        </div>
      )}
    </div>
  );
}
