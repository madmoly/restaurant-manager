import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Card, StatCard, MonthNav, PageHeader, EmptyState, Loading } from "@/components/ui/compat";

export default function ProfitPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };

  const { data: summary, isLoading } = trpc.dailyClosings.monthlySummary.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 }
  );
  const { data: salesTotal } = trpc.sales.monthlyTotal.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 }
  );
  const { data: purchaseTotal } = trpc.purchases.monthlyTotal.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 }
  );
  const { data: fixedTotal } = trpc.fixedCosts.monthlyTotal.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 }
  );

  // Restaurant target 정보
  const { data: restaurant } = trpc.restaurants.get.useQuery({ id: restaurantId }, { enabled: restaurantId > 0 });

  if (!restaurantId) return <EmptyState icon={<TrendingUp size={40} />} title="매장을 선택해주세요" />;
  if (isLoading) return <Loading />;

  const sales = Number(salesTotal?.total ?? 0);
  const purchases = Number(purchaseTotal?.total ?? 0);
  const fixed = Number(fixedTotal?.total ?? 0);
  const labor = Number(summary?.laborCost ?? 0);
  const profit = sales - purchases - labor - fixed;
  const profitFromClosings = Number(summary?.profit ?? 0);

  const costRatio = sales > 0 ? (purchases / sales * 100) : 0;
  const laborRatio = sales > 0 ? (labor / sales * 100) : 0;
  const profitRatio = sales > 0 ? (profit / sales * 100) : 0;

  const targetSales = Number(restaurant?.monthlyTargetSales ?? 0);
  const targetCostRatio = Number(restaurant?.targetCostRatio ?? 80);
  const targetLaborRatio = Number(restaurant?.targetLaborRatio ?? 30);

  return (
    <div>
      <PageHeader title="수익 분석" description={current?.name} />

      <MonthNav year={year} month={month} onPrev={prevMonth} onNext={nextMonth}
        rightSlot={summary && <span className="text-xs text-slate-400">{summary.closedDays}일 마감 기준</span>}
      />

      {/* 큰 수익 카드 */}
      <Card className={`p-5 mb-5 ${profit >= 0 ? "border-emerald-200" : "border-red-200"}`}>
        <div className="flex items-center gap-2 mb-2">
          {profit >= 0 ? <TrendingUp size={18} className="text-emerald-600" /> : <TrendingDown size={18} className="text-red-500" />}
          <span className="text-sm font-medium text-slate-500">이번 달 추정 순이익</span>
        </div>
        <p className={`text-3xl font-bold tabular-nums ${profit >= 0 ? "text-emerald-700" : "text-red-600"}`}>
          {profit >= 0 ? "+" : ""}{profit.toLocaleString()}
          <span className="text-sm text-slate-400 ml-1">원</span>
        </p>
        {sales > 0 && (
          <p className="text-xs text-slate-400 mt-1">수익률 {profitRatio.toFixed(1)}%</p>
        )}
      </Card>

      {/* 비용 구성 */}
      <h3 className="text-sm font-semibold text-slate-700 mb-3">비용 구성</h3>
      <div className="grid grid-cols-2 gap-3 mb-6">
        <StatCard label="매출" value={sales.toLocaleString()} unit="원" />
        <StatCard label="매입 (식재료비)" value={purchases.toLocaleString()} unit="원" />
        <StatCard label="인건비 (마감 기준)" value={labor.toLocaleString()} unit="원" />
        <StatCard label="고정비" value={fixed.toLocaleString()} unit="원" />
      </div>

      {/* 비율 분석 */}
      {sales > 0 && (
        <>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">비율 분석</h3>
          <Card className="p-4 mb-5">
            <div className="space-y-4">
              <RatioBar label="매출원가율 (매입/매출)" value={costRatio} target={targetCostRatio > 0 ? targetCostRatio : undefined} unit="%" warning={costRatio > 35} />
              <RatioBar label="인건비율 (인건비/매출)" value={laborRatio} target={targetLaborRatio > 0 ? targetLaborRatio : undefined} unit="%" warning={laborRatio > targetLaborRatio} />
              <RatioBar label="수익률 (순이익/매출)" value={profitRatio} unit="%" good={profitRatio > 10} />
            </div>
          </Card>
        </>
      )}

      {/* 목표 대비 */}
      {targetSales > 0 && (
        <>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">월 목표 대비</h3>
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500">매출 목표 달성률</span>
              <span className="text-sm font-bold text-slate-900">
                {Math.round(sales / targetSales * 100)}%
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3">
              <div
                className="bg-slate-900 h-3 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(Math.round(sales / targetSales * 100), 100)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-xs text-slate-400">{sales.toLocaleString()}원</span>
              <span className="text-xs text-slate-400">목표 {targetSales.toLocaleString()}원</span>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function RatioBar({ label, value, target, unit, warning, good }: {
  label: string; value: number; target?: number; unit: string; warning?: boolean; good?: boolean;
}) {
  const barWidth = Math.min(Math.max(value, 0), 100);
  let color = "bg-slate-400";
  if (warning) color = "bg-red-400";
  else if (good) color = "bg-emerald-400";

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-500">{label}</span>
        <span className={`text-sm font-semibold tabular-nums ${warning ? "text-red-500" : good ? "text-emerald-600" : "text-slate-700"}`}>
          {value.toFixed(1)}{unit}
          {target !== undefined && (
            <span className="text-xs text-slate-400 ml-1.5">목표 {target}{unit}</span>
          )}
        </span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2 relative">
        <div className={`${color} h-2 rounded-full transition-all duration-500`} style={{ width: `${barWidth}%` }} />
        {target !== undefined && (
          <div
            className="absolute top-0 h-2 w-0.5 bg-slate-900"
            style={{ left: `${Math.min(target, 100)}%` }}
          />
        )}
      </div>
    </div>
  );
}
