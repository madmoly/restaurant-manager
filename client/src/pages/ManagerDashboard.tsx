import { useRestaurant } from "@/contexts/RestaurantContext";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { StatCard, Card, Badge, EmptyState, Loading } from "@/components/ui/compat";
import { Receipt, ShoppingCart, TrendingUp, ClipboardCheck, Wallet, Store } from "lucide-react";

export default function ManagerDashboard() {
  const { selectedRestaurant: current, restaurants: stores, isLoading: storesLoading } = useRestaurant();
  const [, setLocation] = useLocation();

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const todayStr = today.toISOString().slice(0, 10);

  const restaurantId = current?.id ?? 0;
  const enabled = restaurantId > 0;

  const { data: monthlyTotal } = trpc.sales.monthlyTotal.useQuery(
    { restaurantId, year, month },
    { enabled }
  );

  const { data: purchaseTotal } = trpc.purchases.monthlyTotal.useQuery(
    { restaurantId, year, month },
    { enabled }
  );

  const { data: fixedTotal } = trpc.fixedCosts.monthlyTotal.useQuery(
    { restaurantId, year, month },
    { enabled }
  );

  const { data: profitSummary } = trpc.dailyClosings.monthlySummary.useQuery(
    { restaurantId, year, month },
    { enabled }
  );

  if (storesLoading) return <Loading />;

  if (!current) {
    return (
      <EmptyState
        icon={<Store size={40} />}
        title="배정된 매장이 없습니다"
        description="관리자에게 매장 배정을 요청하세요"
      />
    );
  }

  const salesNum = Number(monthlyTotal?.total ?? 0);
  const purchasesNum = Number(purchaseTotal?.total ?? 0);
  const fixedNum = Number(fixedTotal?.total ?? 0);
  const targetSales = Number(current ? 0 : 0); // restaurant 자체에서 가져올 수 있지만 일단 별도 쿼리 불필요

  // 매출 달성률 계산은 restaurants.get에서 monthlyTargetSales를 가져와야 함
  const { data: restaurant } = trpc.restaurants.get.useQuery({ id: restaurantId }, { enabled });
  const target = Number(restaurant?.monthlyTargetSales ?? 0);
  const achieveRate = target > 0 ? Math.round((salesNum / target) * 100) : 0;

  // 매출원가율 (매입/매출 * 100)
  const costRatio = salesNum > 0 ? (purchasesNum / salesNum * 100).toFixed(1) : "0";

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold text-slate-900">{current.name}</h2>
        <Badge variant="success">점장/매니저</Badge>
      </div>
      <p className="text-sm text-slate-400 mb-5">{year}년 {month}월 현황</p>

      {/* KPI 그리드 */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <StatCard
          icon={<Receipt size={14} />}
          label="이번 달 매출"
          value={formatKRW(salesNum)}
          unit="원"
        />
        <StatCard
          icon={<ShoppingCart size={14} />}
          label="이번 달 매입"
          value={formatKRW(purchasesNum)}
          unit="원"
        />
        <StatCard
          icon={<Wallet size={14} />}
          label="고정비 (월)"
          value={formatKRW(fixedNum)}
          unit="원"
        />
        <StatCard
          icon={<TrendingUp size={14} />}
          label="매출원가율"
          value={costRatio}
          unit="%"
        />
      </div>

      {/* 목표 달성률 */}
      {target > 0 && (
        <Card className="p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">월 매출 목표 달성률</span>
            <span className="text-sm font-bold text-slate-900">{achieveRate}%</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2.5">
            <div
              className="bg-slate-900 h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(achieveRate, 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-xs text-slate-400">{formatKRW(salesNum)}원</span>
            <span className="text-xs text-slate-400">목표 {formatKRW(target)}원</span>
          </div>
        </Card>
      )}

      {/* 일마감 상태 */}
      {profitSummary && (
        <Card className="p-4 mb-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">이번 달 마감 현황</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-slate-900">{profitSummary.closedDays}</p>
              <p className="text-xs text-slate-400">마감 완료</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-300">{profitSummary.daysInMonth - profitSummary.closedDays}</p>
              <p className="text-xs text-slate-400">미마감</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-600">{formatKRW(Number(profitSummary.profit))}</p>
              <p className="text-xs text-slate-400">누적 순이익</p>
            </div>
          </div>
        </Card>
      )}

      {/* 빠른 액션 */}
      <h3 className="text-sm font-semibold text-slate-700 mb-3">빠른 액션</h3>
      <div className="grid grid-cols-2 gap-3">
        {[
          { icon: <Receipt size={20} className="text-slate-700" />, label: "매출 입력", desc: "오늘 매출 기록", href: "/sales" },
          { icon: <ShoppingCart size={20} className="text-slate-700" />, label: "매입 입력", desc: "오늘 매입 기록", href: "/purchases" },
          { icon: <ClipboardCheck size={20} className="text-slate-700" />, label: "일마감", desc: "오늘 마감 처리", href: "/daily-closing" },
          { icon: <TrendingUp size={20} className="text-slate-700" />, label: "수익 분석", desc: "월별 수익성 확인", href: "/profit" },
        ].map(action => (
          <Card
            key={action.href}
            interactive
            onClick={() => setLocation(action.href)}
            className="p-4"
          >
            <div className="mb-2">{action.icon}</div>
            <p className="text-sm font-medium text-slate-900">{action.label}</p>
            <p className="text-xs text-slate-400">{action.desc}</p>
          </Card>
        ))}
      </div>

      {/* 다중 매장 */}
      {stores.length > 1 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">다른 매장</h3>
          <div className="space-y-1.5">
            {stores.filter(s => s.id !== current.id).map((s) => (
              <Card key={s.id} className="px-4 py-3 text-sm text-slate-600">
                {s.name}
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatKRW(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, "") + "억";
  if (n >= 10000) return Math.round(n / 10000).toLocaleString() + "만";
  return n.toLocaleString();
}
