import { useState, useRef, useEffect } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { TrendingUp, TrendingDown, ChevronDown, ChevronUp, Download, FileText } from "lucide-react";
import { Card, MonthNav, PageHeader, EmptyState } from "@/components/ui/compat";
import { Button } from "@/components/ui/button";
import { ProfitPageSkeleton } from "@/components/ui/skeletons";
import { loadKoreanFont } from "@/lib/pdfKoreanFont";

type CostCategory = "sales" | "purchases" | "labor" | "fixed" | null;

export default function ProfitPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [expandedCategory, setExpandedCategory] = useState<CostCategory>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setShowExportMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showExportMenu]);

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

  // 드릴다운 상세 데이터
  const { data: salesList } = trpc.sales.listByMonth.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 && expandedCategory === "sales" }
  );
  const { data: purchaseList } = trpc.purchases.listByMonth.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 && expandedCategory === "purchases" }
  );
  const { data: closingList } = trpc.dailyClosings.listByMonth.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 && expandedCategory === "labor" }
  );

  // Restaurant target 정보
  const { data: restaurant } = trpc.restaurants.get.useQuery({ id: restaurantId }, { enabled: restaurantId > 0 });

  if (!restaurantId) return <EmptyState icon={<TrendingUp size={40} />} title="매장을 선택해주세요" />;
  if (isLoading) return <ProfitPageSkeleton />;

  const sales = Number(salesTotal?.total ?? 0);
  const purchases = Number(purchaseTotal?.total ?? 0);
  const fixed = Number(fixedTotal?.total ?? 0);
  const labor = Number(summary?.laborCost ?? 0);
  const profit = sales - purchases - labor - fixed;

  const costRatio = sales > 0 ? (purchases / sales * 100) : 0;
  const laborRatio = sales > 0 ? (labor / sales * 100) : 0;
  const profitRatio = sales > 0 ? (profit / sales * 100) : 0;

  const targetSales = Number(restaurant?.monthlyTargetSales ?? 0);
  const targetCostRatio = Number(restaurant?.targetCostRatio ?? 80);
  const targetLaborRatio = Number(restaurant?.targetLaborRatio ?? 30);

  const fixedBreakdown = fixedTotal?.breakdown ?? [];

  const toggleCategory = (cat: CostCategory) => {
    setExpandedCategory(prev => prev === cat ? null : cat);
  };

  const fileName = `수익분석_${year}년${month}월_${current?.name ?? ""}`;

  const summaryHeaders = ["항목", "금액(원)", "비율(%)"];
  const summaryRows: (string | number)[][] = [
    ["매출", sales, "100.0"],
    ["매입 (식재료비)", purchases, costRatio.toFixed(1)],
    ["인건비", labor, laborRatio.toFixed(1)],
    ["고정비", fixed, sales > 0 ? (fixed / sales * 100).toFixed(1) : "0.0"],
    ["순이익", profit, profitRatio.toFixed(1)],
  ];
  const fixedHeaders = ["항목", "금액(원)", "유형"];
  const fixedRows = fixedBreakdown.map((b: any) => [
    b.name,
    b.amount,
    b.type === "monthly" ? "월납" : b.type === "yearly" ? "연납(÷12)" : b.type === "quarterly" ? "분기(÷3)" : b.type,
  ]);

  const handleExportExcel = async () => {
    setShowExportMenu(false);
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([
      summaryHeaders, ...summaryRows,
      [],
      ["고정비 내역"],
      fixedHeaders, ...fixedRows,
    ]);
    ws["!cols"] = [{ wch: 16 }, { wch: 14 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "수익분석");
    XLSX.writeFile(wb, `${fileName}.xlsx`);
  };

  const handleExportPDF = async () => {
    setShowExportMenu(false);
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    await loadKoreanFont(doc);

    doc.setFontSize(14);
    doc.text(fileName, 14, 15);

    autoTable(doc, {
      startY: 22,
      head: [summaryHeaders],
      body: summaryRows.map(r => r.map(c => typeof c === "number" ? Math.round(c).toLocaleString() : String(c))),
      styles: { fontSize: 9, cellPadding: 3, font: "NanumGothic" },
      headStyles: { fillColor: [59, 130, 246], textColor: 255, font: "NanumGothic" },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? 80;
    doc.setFontSize(11);
    doc.text("고정비 내역", 14, finalY + 10);

    autoTable(doc, {
      startY: finalY + 14,
      head: [fixedHeaders],
      body: fixedRows.map((r: any[]) => r.map((c: any) => typeof c === "number" ? Math.round(c).toLocaleString() : String(c))),
      styles: { fontSize: 9, cellPadding: 3, font: "NanumGothic" },
      headStyles: { fillColor: [100, 116, 139], textColor: 255, font: "NanumGothic" },
      columnStyles: { 1: { halign: "right" } },
    });

    doc.save(`${fileName}.pdf`);
  };

  return (
    <div>
      <PageHeader
        title="수익 분석"
        description={current?.name}
        action={
          <div className="relative" ref={exportRef}>
            <Button variant="outline" size="sm" onClick={() => setShowExportMenu(!showExportMenu)} className="gap-1">
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">내보내기</span>
            </Button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-50 min-w-[140px] py-1">
                <button
                  onClick={handleExportExcel}
                  className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors flex items-center gap-2"
                >
                  <FileText className="w-3.5 h-3.5 text-green-600" /> Excel (.xlsx)
                </button>
                <button
                  onClick={handleExportPDF}
                  className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors flex items-center gap-2"
                >
                  <FileText className="w-3.5 h-3.5 text-red-500" /> PDF
                </button>
              </div>
            )}
          </div>
        }
      />

      <MonthNav year={year} month={month} onPrev={prevMonth} onNext={nextMonth}
        rightSlot={summary && <span className="text-xs text-muted-foreground">{summary.closedDays}일 마감 기준</span>}
      />

      {/* 큰 수익 카드 */}
      <Card className={`p-5 mb-5 ${profit >= 0 ? "border-emerald-200" : "border-red-200"}`}>
        <div className="flex items-center gap-2 mb-2">
          {profit >= 0 ? <TrendingUp size={18} className="text-emerald-600" /> : <TrendingDown size={18} className="text-red-500" />}
          <span className="text-sm font-medium text-muted-foreground">이번 달 추정 순이익</span>
        </div>
        <p className={`text-3xl font-bold tabular-nums ${profit >= 0 ? "text-emerald-700" : "text-red-600"}`}>
          {profit >= 0 ? "+" : ""}{profit.toLocaleString()}
          <span className="text-sm text-muted-foreground ml-1">원</span>
        </p>
        {sales > 0 && (
          <p className="text-xs text-muted-foreground mt-1">수익률 {profitRatio.toFixed(1)}%</p>
        )}
      </Card>

      {/* 비용 구성 — 클릭 가능 */}
      <h3 className="text-sm font-semibold text-foreground mb-3">비용 구성</h3>
      <p className="text-[11px] text-muted-foreground mb-2">항목을 눌러 상세 내역을 확인하세요</p>

      <div className="space-y-2 mb-6">
        <CostCard
          label="매출"
          value={sales}
          expanded={expandedCategory === "sales"}
          onToggle={() => toggleCategory("sales")}
        >
          {salesList && salesList.length > 0 ? (
            <DetailTable
              headers={["날짜", "금액", "비고"]}
              rows={salesList.map(s => [
                fmtDate(s.saleDate),
                `₩${Number(s.amount).toLocaleString()}`,
                s.note ?? "",
              ])}
            />
          ) : (
            <p className="text-xs text-muted-foreground py-2">매출 데이터가 없습니다</p>
          )}
        </CostCard>

        <CostCard
          label="매입 (식재료비)"
          value={purchases}
          expanded={expandedCategory === "purchases"}
          onToggle={() => toggleCategory("purchases")}
        >
          {purchaseList && purchaseList.length > 0 ? (
            <DetailTable
              headers={["날짜", "거래처", "금액"]}
              rows={purchaseList.map(p => [
                fmtDate(p.purchaseDate),
                (p as any).counterpartyName ?? "-",
                `₩${Number(p.totalAmount).toLocaleString()}`,
              ])}
            />
          ) : (
            <p className="text-xs text-muted-foreground py-2">매입 데이터가 없습니다</p>
          )}
        </CostCard>

        <CostCard
          label="인건비 (마감 기준)"
          value={labor}
          expanded={expandedCategory === "labor"}
          onToggle={() => toggleCategory("labor")}
        >
          {closingList && closingList.length > 0 ? (
            <DetailTable
              headers={["날짜", "인건비"]}
              rows={closingList
                .filter(c => Number(c.laborCost) > 0)
                .map(c => [
                  fmtDate(c.closingDate),
                  `₩${Number(c.laborCost).toLocaleString()}`,
                ])}
            />
          ) : (
            <p className="text-xs text-muted-foreground py-2">일마감 인건비 데이터가 없습니다</p>
          )}
        </CostCard>

        <CostCard
          label="고정비"
          value={fixed}
          expanded={expandedCategory === "fixed"}
          onToggle={() => toggleCategory("fixed")}
        >
          {fixedBreakdown.length > 0 ? (
            <DetailTable
              headers={["항목", "유형", "금액"]}
              rows={fixedBreakdown.map(b => [
                b.name,
                b.type === "monthly" ? "월납" : b.type === "yearly" ? "연납(÷12)" : "일시",
                `₩${b.amount.toLocaleString()}`,
              ])}
            />
          ) : (
            <p className="text-xs text-muted-foreground py-2">고정비 항목이 없습니다</p>
          )}
        </CostCard>
      </div>

      {/* 비율 분석 */}
      {sales > 0 && (
        <>
          <h3 className="text-sm font-semibold text-foreground mb-3">비율 분석</h3>
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
          <h3 className="text-sm font-semibold text-foreground mb-3">월 목표 대비</h3>
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">매출 목표 달성률</span>
              <span className="text-sm font-bold text-foreground">
                {Math.round(sales / targetSales * 100)}%
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-3">
              <div
                className="bg-primary h-3 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(Math.round(sales / targetSales * 100), 100)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-xs text-muted-foreground">{sales.toLocaleString()}원</span>
              <span className="text-xs text-muted-foreground">목표 {targetSales.toLocaleString()}원</span>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ── 비용 카드 (드릴다운 지원) ──────────────────────────────────────────────────
function CostCard({ label, value, expanded, onToggle, children }: {
  label: string; value: number; expanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={onToggle}
      >
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-bold text-foreground tabular-nums mt-0.5">
            {value.toLocaleString()}<span className="text-xs text-muted-foreground ml-1">원</span>
          </div>
        </div>
        {expanded
          ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        }
      </div>
      {expanded && (
        <div className="border-t border-border px-4 py-3 bg-muted/30 max-h-64 overflow-y-auto">
          {children}
        </div>
      )}
    </Card>
  );
}

// ── 상세 테이블 ───────────────────────────────────────────────────────────────
function DetailTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border/50">
          {headers.map((h, i) => (
            <th key={i} className={`py-1.5 font-medium text-muted-foreground ${i === 0 ? "text-left" : "text-right"}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} className="border-b border-border/30 last:border-0">
            {row.map((cell, ci) => (
              <td key={ci} className={`py-1.5 text-foreground ${ci === 0 ? "text-left" : "text-right"}`}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── 비율 바 ──────────────────────────────────────────────────────────────────
function RatioBar({ label, value, target, unit, warning, good }: {
  label: string; value: number; target?: number; unit: string; warning?: boolean; good?: boolean;
}) {
  const barWidth = Math.min(Math.max(value, 0), 100);
  let color = "bg-muted-foreground";
  if (warning) color = "bg-red-400";
  else if (good) color = "bg-emerald-400";

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-sm font-semibold tabular-nums ${warning ? "text-red-500" : good ? "text-emerald-600" : "text-foreground"}`}>
          {value.toFixed(1)}{unit}
          {target !== undefined && (
            <span className="text-xs text-muted-foreground ml-1.5">목표 {target}{unit}</span>
          )}
        </span>
      </div>
      <div className="w-full bg-muted rounded-full h-2 relative">
        <div className={`${color} h-2 rounded-full transition-all duration-500`} style={{ width: `${barWidth}%` }} />
        {target !== undefined && (
          <div
            className="absolute top-0 h-2 w-0.5 bg-primary"
            style={{ left: `${Math.min(target, 100)}%` }}
          />
        )}
      </div>
    </div>
  );
}

// ── 날짜 포맷 ──────────────────────────────────────────────────────────────────
function fmtDate(d: string | Date) {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
