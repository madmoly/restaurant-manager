import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { ChevronDown, ChevronRight, Users, ShoppingCart, Building2, Wrench, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

function fmt(n: number) { return n.toLocaleString("ko-KR") + "원"; }
function pct(n: number) { return n.toFixed(1) + "%"; }

interface LaborUser {
  userId: number;
  userName: string;
  wageType: string;
  wageAmount: number;
  totalHours: number;
  laborCost: number;
}

interface FixedCategory {
  categoryType: string;
  label: string;
  total: number;
  ratio: number;
}

interface CostBreakdownProps {
  salesTotal: number;
  purchasesTotal: number;
  fixedCostsTotal: number;
  laborCost: number;
  profit: number;
  purchaseRatio: number;
  fixedRatio: number;
  laborRatio: number;
  costRatio: number;
  targetCostRatio: number;
  targetLaborRatio: number;
  laborByUser?: LaborUser[] | null;
  fixedByCategory?: FixedCategory[];
}

const COLORS = {
  purchase: "#f59e0b",
  fixed: "#f97316",
  labor: "#8b5cf6",
  profit: "#10b981",
  danger: "#ef4444",
  warning: "#f59e0b",
  safe: "#10b981",
};

function RatioBar({ label, value, target, color, children, defaultOpen = false }: {
  label: string;
  value: number;
  target: number;
  color: string;
  children?: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOver = value > target;
  const statusColor = isOver ? "text-red-600" : value > target * 0.85 ? "text-amber-600" : "text-green-600";
  const barColor = isOver ? "#ef4444" : value > target * 0.85 ? "#f59e0b" : color;

  return (
    <div className="space-y-1">
      <div
        className={cn("flex items-center justify-between cursor-pointer group py-1", children ? "hover:bg-muted/30 rounded px-1" : "")}
        onClick={() => children && setOpen(!open)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {children ? (
            open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : <span className="w-3.5" />}
          <span className="text-sm font-medium truncate">{label}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-muted-foreground">목표 {pct(target)}</span>
          <span className={cn("text-sm font-bold tabular-nums", statusColor)}>{pct(value)}</span>
          <Badge variant="outline" className={cn("text-xs px-1.5 py-0", isOver ? "border-red-300 text-red-600" : "border-green-300 text-green-600")}>
            {isOver ? "초과" : "정상"}
          </Badge>
        </div>
      </div>
      {/* 진행 바 */}
      <div className="h-1.5 bg-muted rounded-full overflow-hidden mx-1">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(value / target * 100, 100)}%`, backgroundColor: barColor }}
        />
      </div>
      {/* 세부 내역 (펼침) */}
      {children && open && (
        <div className="ml-5 mt-2 space-y-1 pb-1">
          {children}
        </div>
      )}
    </div>
  );
}

export default function CostBreakdown({
  salesTotal, purchasesTotal, fixedCostsTotal, laborCost, profit,
  purchaseRatio, fixedRatio, laborRatio, costRatio,
  targetCostRatio, targetLaborRatio,
  laborByUser, fixedByCategory = [],
}: CostBreakdownProps) {
  const [showTable, setShowTable] = useState(false);

  const pieData = [
    { name: "매입비", value: purchasesTotal, color: COLORS.purchase },
    { name: "고정비", value: fixedCostsTotal, color: COLORS.fixed },
    { name: "인건비", value: laborCost, color: COLORS.labor },
    { name: "이익", value: Math.max(0, profit), color: COLORS.profit },
  ].filter(d => d.value > 0);

  // 매출 대비 전체 비용 항목 테이블 데이터
  const tableRows = [
    { label: "매입비", amount: purchasesTotal, ratio: purchaseRatio, color: COLORS.purchase, icon: <ShoppingCart className="h-3.5 w-3.5" /> },
    { label: "고정비 합계", amount: fixedCostsTotal, ratio: fixedRatio, color: COLORS.fixed, icon: <Building2 className="h-3.5 w-3.5" /> },
    { label: "인건비 합계", amount: laborCost, ratio: laborRatio, color: COLORS.labor, icon: <Users className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-4">
      {/* 상단: 도넛 차트 + 비율 요약 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* 도넛 차트 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Wrench className="h-4 w-4 text-muted-foreground" />
              매출 대비 비용 구조
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2} dataKey="value">
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => [fmt(v), ""]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                {/* 총 비용율 요약 */}
                <div className="mt-2 p-2 rounded-lg bg-muted/40 flex items-center justify-between">
                  <span className="text-xs font-medium">총 비용율</span>
                  <div className="flex items-center gap-2">
                    <span className={cn("text-base font-bold", costRatio > targetCostRatio ? "text-red-600" : "text-green-600")}>
                      {pct(costRatio)}
                    </span>
                    {costRatio > targetCostRatio
                      ? <TrendingDown className="h-4 w-4 text-red-500" />
                      : <TrendingUp className="h-4 w-4 text-green-500" />}
                  </div>
                </div>
              </>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">데이터 없음</div>
            )}
          </CardContent>
        </Card>

        {/* 비율 게이지 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">항목별 비율 (매출 대비)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* 매입비 */}
            <RatioBar label="매입비" value={purchaseRatio} target={40} color={COLORS.purchase} />

            {/* 고정비 (세부 펼침) */}
            <RatioBar label="고정비" value={fixedRatio} target={20} color={COLORS.fixed}>
              {fixedByCategory.length > 0 ? fixedByCategory.map(c => (
                <div key={c.categoryType} className="flex items-center justify-between text-xs py-0.5">
                  <span className="text-muted-foreground">{c.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{fmt(c.total)}</span>
                    <span className="font-medium tabular-nums w-12 text-right">{pct(c.ratio)}</span>
                  </div>
                </div>
              )) : <p className="text-xs text-muted-foreground">세부 내역 없음</p>}
            </RatioBar>

            {/* 인건비 (직원별 펼침) */}
            <RatioBar label="인건비" value={laborRatio} target={targetLaborRatio} color={COLORS.labor} defaultOpen={false}>
              {laborByUser == null ? (
                <p className="text-xs text-muted-foreground">인건비 상세는 점장만 확인할 수 있습니다.</p>
              ) : laborByUser.length > 0 ? laborByUser.map(u => (
                <div key={u.userId} className="flex items-center justify-between text-xs py-0.5">
                  <div className="min-w-0">
                    <span className="font-medium truncate">{u.userName}</span>
                    <span className="text-muted-foreground ml-1.5">
                      {u.wageType === "hourly" ? `${u.totalHours}h × ${u.wageAmount.toLocaleString()}원` : "월급제"}
                    </span>
                  </div>
                  <span className="font-medium tabular-nums shrink-0 ml-2">{fmt(u.laborCost)}</span>
                </div>
              )) : <p className="text-xs text-muted-foreground">세부 내역 없음</p>}
              {laborByUser != null && laborByUser.length > 0 && (
                <div className="flex items-center justify-between text-xs font-semibold border-t pt-1 mt-1">
                  <span>합계</span>
                  <span>{fmt(laborCost)}</span>
                </div>
              )}
            </RatioBar>
          </CardContent>
        </Card>
      </div>

      {/* 상세 테이블 토글 */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowTable(!showTable)}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">항목별 금액 상세</CardTitle>
            {showTable ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        </CardHeader>
        {showTable && (
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium text-muted-foreground">항목</th>
                    <th className="text-right py-2 font-medium text-muted-foreground">금액</th>
                    <th className="text-right py-2 font-medium text-muted-foreground">매출 대비</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="py-2 font-semibold text-blue-700">매출</td>
                    <td className="py-2 text-right font-bold text-blue-700">{fmt(salesTotal)}</td>
                    <td className="py-2 text-right text-muted-foreground">100%</td>
                  </tr>
                  {tableRows.map(row => (
                    <tr key={row.label}>
                      <td className="py-2">
                        <div className="flex items-center gap-1.5">
                          <span style={{ color: row.color }}>{row.icon}</span>
                          {row.label}
                        </div>
                      </td>
                      <td className="py-2 text-right">{fmt(row.amount)}</td>
                      <td className="py-2 text-right font-medium">{pct(row.ratio)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2">
                    <td className="py-2 font-semibold">총 비용</td>
                    <td className="py-2 text-right font-bold">{fmt(purchasesTotal + fixedCostsTotal + laborCost)}</td>
                    <td className="py-2 text-right font-bold">{pct(costRatio)}</td>
                  </tr>
                  <tr className={cn(profit >= 0 ? "bg-green-50" : "bg-red-50")}>
                    <td className={cn("py-2 font-bold", profit >= 0 ? "text-green-700" : "text-red-700")}>
                      {profit >= 0 ? "순이익" : "손실"}
                    </td>
                    <td className={cn("py-2 text-right font-bold", profit >= 0 ? "text-green-700" : "text-red-700")}>
                      {fmt(Math.abs(profit))}
                    </td>
                    <td className={cn("py-2 text-right font-bold", profit >= 0 ? "text-green-700" : "text-red-700")}>
                      {pct(salesTotal > 0 ? (Math.abs(profit) / salesTotal) * 100 : 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
