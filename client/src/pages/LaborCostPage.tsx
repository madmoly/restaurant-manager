import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import {
  ChevronLeft, ChevronRight, Building2, Users, Clock, Wallet,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";

function fmtWon(n: number) {
  return Math.round(n).toLocaleString();
}

export default function LaborCostPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };

  const { data, isLoading } = trpc.schedules.laborCostByCompany.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 },
  );

  const grandTotalHours = data?.reduce((s, c) => s + c.totalHours, 0) ?? 0;
  const grandTotalWage = data?.reduce((s, c) => s + c.totalWage, 0) ?? 0;

  if (!restaurantId) return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Building2 className="w-5 h-5" /> 인건비 정산
        </h1>
        <span className="text-xs text-muted-foreground">{current?.name}</span>
      </div>

      {/* 월 네비게이션 */}
      <div className="flex items-center justify-between bg-card border border-border rounded-lg p-3">
        <Button variant="ghost" size="sm" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
        <div className="text-base font-bold text-foreground">{year}년 {month}월</div>
        <Button variant="ghost" size="sm" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
      </div>

      {/* 총계 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">총 근무시간</div>
          <div className="text-sm font-bold text-foreground flex items-center justify-center gap-1">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            {grandTotalHours.toFixed(1)}h
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">총 인건비</div>
          <div className="text-sm font-bold text-foreground flex items-center justify-center gap-1">
            <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
            ₩{fmtWon(grandTotalWage)}
          </div>
        </div>
      </div>

      {/* 회사별 카드 */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">로딩 중...</div>
      ) : !data || data.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">해당 월 스케줄 데이터가 없습니다</div>
      ) : (
        <div className="space-y-3">
          {data.map((company) => {
            const isExpanded = expandedCompany === company.company;
            return (
              <div key={company.company} className="bg-card border border-border rounded-lg overflow-hidden">
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => setExpandedCompany(isExpanded ? null : company.company)}
                >
                  <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground">{company.company}</div>
                    <div className="text-xs text-muted-foreground">{company.employees.length}명</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-foreground">₩{fmtWon(company.totalWage)}</div>
                    <div className="text-[11px] text-muted-foreground">{company.totalHours.toFixed(1)}h</div>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                </div>

                {isExpanded && (
                  <div className="border-t border-border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/50">
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">이름</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">출근</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">시간</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">인건비</th>
                        </tr>
                      </thead>
                      <tbody>
                        {company.employees.map((emp, i) => (
                          <tr key={i} className="border-t border-border/50">
                            <td className="px-4 py-2 font-medium text-foreground">{emp.name}</td>
                            <td className="px-4 py-2 text-right text-muted-foreground">{emp.shifts}회</td>
                            <td className="px-4 py-2 text-right text-muted-foreground">{emp.totalHours.toFixed(1)}h</td>
                            <td className="px-4 py-2 text-right font-medium text-foreground">₩{fmtWon(emp.totalWage)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
