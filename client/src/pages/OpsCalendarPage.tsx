import { useState, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { getHolidayName } from "@/lib/koreanHolidays";
import {
  ChevronLeft, ChevronRight, CalendarDays, CheckCircle2, Clock,
  XCircle, Users, TrendingUp, ClipboardCheck, X, Receipt,
  Wallet, ShoppingCart, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

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

// ─── 우측 상세 패널 ──────────────────────────────────────────────────────────
function DayDetailPanel({ restaurantId, date, onClose }: {
  restaurantId: number; date: string; onClose: () => void;
}) {
  const { data, isLoading } = trpc.dailyOps.getDayDetail.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 },
  );

  const d = new Date(date + "T00:00:00");
  const dow = DAY_LABELS[d.getDay()];
  const holiday = getHolidayName(date);

  return (
    <div className="h-full flex flex-col bg-card border-l border-border">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div>
          <h3 className="text-sm font-bold text-foreground">
            {date.slice(5).replace("-", "/")} ({dow})
            {holiday && <span className="text-red-500 ml-1 text-xs">{holiday}</span>}
          </h3>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* 내용 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">로딩 중...</div>
        ) : !data ? (
          <div className="text-center py-8 text-muted-foreground text-sm">데이터 없음</div>
        ) : (
          <>
            {/* 일일운영 상태 */}
            <section>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <ClipboardCheck className="w-3.5 h-3.5" /> 일일 운영
              </h4>
              <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">오픈</span>
                  {data.operation?.openCheckedAt ? (
                    <span className="text-emerald-600 font-medium flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      {fmtTime(data.operation.openCheckedAt)} · {data.operation.openHeadcount ?? 0}명
                    </span>
                  ) : <span className="text-muted-foreground/50">미완료</span>}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">마감</span>
                  {data.operation?.closeCheckedAt ? (
                    <span className="text-emerald-600 font-medium flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      {fmtTime(data.operation.closeCheckedAt)} · {data.operation.closeHeadcount ?? 0}명{data.operation.closedByName ? ` · ${data.operation.closedByName}` : ""}
                    </span>
                  ) : <span className="text-muted-foreground/50">미완료</span>}
                </div>
                {data.checklists.length > 0 && (
                  <div className="pt-1 border-t border-border/50 mt-1">
                    {data.checklists.map((c, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{c.checkType === "open" ? "오픈" : c.checkType === "order" ? "발주" : "마감"} 체크</span>
                        <span className={c.checkedCount > 0 ? "text-emerald-600" : "text-muted-foreground/50"}>
                          {c.checkedCount}항목 완료
                        </span>
                      </div>
                    ))}
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
                <p className="text-xs text-muted-foreground/50 pl-1">등록된 스케줄 없음</p>
              ) : (
                <div className="space-y-1">
                  {data.schedules.map((s) => (
                    <div key={s.id} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                      <span className="text-xs font-medium text-foreground">{s.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          {fmtTime(s.startTime)}~{fmtTime(s.endTime)}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          s.status === "completed" ? "bg-emerald-500/15 text-emerald-600"
                          : s.status === "confirmed" ? "bg-blue-500/15 text-blue-600"
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
                <p className="text-xs text-muted-foreground/50 pl-1">매출 입력 없음</p>
              ) : (
                <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">총 매출</span>
                    <span className="text-sm font-bold text-foreground">₩{data.sales.totalAmount.toLocaleString()}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 pt-1 border-t border-border/50">
                    {data.sales.cashAmount > 0 && (
                      <div className="text-[11px]"><span className="text-muted-foreground">현금</span> <span className="font-medium">{fmtWon(data.sales.cashAmount)}</span></div>
                    )}
                    {data.sales.cardAmount > 0 && (
                      <div className="text-[11px]"><span className="text-muted-foreground">카드</span> <span className="font-medium">{fmtWon(data.sales.cardAmount)}</span></div>
                    )}
                    {data.sales.giftCardAmount > 0 && (
                      <div className="text-[11px]"><span className="text-muted-foreground">상품권</span> <span className="font-medium">{fmtWon(data.sales.giftCardAmount)}</span></div>
                    )}
                    {data.sales.transferAmount > 0 && (
                      <div className="text-[11px]"><span className="text-muted-foreground">이체</span> <span className="font-medium">{fmtWon(data.sales.transferAmount)}</span></div>
                    )}
                  </div>
                  {data.midSalesTotal > 0 && (
                    <div className="text-[11px] pt-1 border-t border-border/50">
                      <span className="text-muted-foreground">중간매출 합계</span> <span className="font-medium">₩{data.midSalesTotal.toLocaleString()}</span>
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
                <p className="text-xs text-muted-foreground/50 pl-1">매입 내역 없음</p>
              ) : (
                <div className="space-y-1">
                  {data.purchases.map((p) => (
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
                  <span className={`text-sm font-bold ${data.sales.totalAmount - data.purchaseTotal >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    ₩{(data.sales.totalAmount - data.purchaseTotal).toLocaleString()}
                  </span>
                </div>
              </section>
            )}
          </>
        )}
      </div>
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

  const { data: calData } = trpc.dailyOps.getMonthlyCalendar.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 },
  );

  const daysInMonth = getDaysInMonth(year, month);
  const firstDow = getFirstDayOfWeek(year, month);

  const stats = useMemo(() => {
    if (!calData) return { totalSales: 0, closedDays: 0, avgSales: 0 };
    const salesDays = Object.values(calData.days).filter((d) => d.totalSales > 0).length;
    return {
      totalSales: calData.totalSales,
      closedDays: calData.closedDays,
      avgSales: salesDays > 0 ? Math.round(calData.totalSales / salesDays) : 0,
    };
  }, [calData]);

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  if (!current) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  return (
    <div className="flex h-full">
      {/* 좌측: 캘린더 */}
      <div className={`flex-1 min-w-0 p-4 md:p-6 space-y-4 overflow-y-auto ${selectedDate ? "max-w-[calc(100%-320px)]" : ""}`}>
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
            <div className="text-center">
              <div className="text-base font-bold text-foreground">{year}년 {month}월</div>
            </div>
            <Button variant="ghost" size="sm" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
          </div>

          {/* 월간 요약 */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-card border border-border rounded-lg p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">월 매출</div>
              <div className="text-sm font-bold text-foreground">{stats.totalSales > 0 ? `₩${fmtWon(stats.totalSales)}` : "-"}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">마감 완료</div>
              <div className="text-sm font-bold text-foreground">{stats.closedDays}일</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">일평균</div>
              <div className="text-sm font-bold text-foreground">{stats.avgSales > 0 ? `₩${fmtWon(stats.avgSales)}` : "-"}</div>
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
                    {dayData && dayData.totalSales > 0 && (
                      <div className="text-[10px] font-medium text-foreground mt-0.5 flex items-center gap-0.5">
                        <TrendingUp className="w-2.5 h-2.5 text-emerald-500 shrink-0" />
                        <span className="truncate">{fmtWon(dayData.totalSales)}</span>
                      </div>
                    )}
                    {dayData && (dayData.openHeadcount > 0 || dayData.closeHeadcount > 0) && (
                      <div className="text-[9px] text-muted-foreground flex items-center gap-0.5 mt-0.5">
                        <Users className="w-2.5 h-2.5 shrink-0" />{dayData.openHeadcount || dayData.closeHeadcount}명
                      </div>
                    )}
                    {dayData?.checklist && dayData.checklist.total > 0 && (
                      <div className={`text-[9px] flex items-center gap-0.5 mt-0.5 ${dayData.checklist.checked >= dayData.checklist.total ? "text-emerald-600" : "text-amber-500"}`}>
                        <ClipboardCheck className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">{dayData.checklist.types.length >= 3 ? "✓" : `${dayData.checklist.checked}/${dayData.checklist.total}`}</span>
                      </div>
                    )}
                    {dayData?.schedule && dayData.schedule.total > 0 && (
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
            <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-600" /> 마감완료</div>
            <div className="flex items-center gap-1"><Clock className="w-3 h-3 text-amber-500" /> 오픈만</div>
            <div className="flex items-center gap-1"><XCircle className="w-3 h-3 text-muted-foreground/30" /> 미운영</div>
            <div className="flex items-center gap-1"><ClipboardCheck className="w-3 h-3 text-emerald-600" /> 체크리스트</div>
            <div className="flex items-center gap-1"><Users className="w-3 h-3 text-blue-500" /> 스케줄</div>
          </div>

          {(year !== today.getFullYear() || month !== today.getMonth() + 1) && (
            <div className="text-center">
              <Button variant="outline" size="sm" onClick={goThisMonth}>이번 달로</Button>
            </div>
          )}
        </div>
      </div>

      {/* 우측: 상세 패널 (모바일에서는 오버레이) */}
      {selectedDate && (
        <>
          {/* 모바일 오버레이 */}
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <div className="fixed inset-0 bg-black/50" onClick={() => setSelectedDate(null)} />
            <div className="ml-auto w-[320px] max-w-[85vw] relative z-10 h-full">
              <DayDetailPanel restaurantId={restaurantId} date={selectedDate} onClose={() => setSelectedDate(null)} />
            </div>
          </div>
          {/* 데스크탑 사이드패널 */}
          <div className="hidden lg:block w-[340px] shrink-0 h-full border-l border-border">
            <DayDetailPanel restaurantId={restaurantId} date={selectedDate} onClose={() => setSelectedDate(null)} />
          </div>
        </>
      )}
    </div>
  );
}
