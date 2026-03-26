import { useState, useRef, useEffect } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import {
  ChevronLeft, ChevronRight, Building2, Users, Clock, Wallet,
  ChevronDown, ChevronUp, FileText, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CompanyCardListSkeleton } from "@/components/ui/skeletons";
import { loadKoreanFont } from "@/lib/pdfKoreanFont";

function fmtWon(n: number) {
  return Math.round(n).toLocaleString();
}

function fmtDate(d: string | null) {
  if (!d) return "-";
  const date = new Date(d);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function wageLabel(type: string | null, amount: string | null) {
  if (!type || !amount) return "-";
  const val = Number(amount).toLocaleString();
  if (type === "hourly") return `시급 ₩${val}`;
  if (type === "monthly") return `월급 ₩${val}`;
  if (type === "daily") return `일급 ₩${val}`;
  return `₩${val}`;
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

  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 메뉴 닫기
  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setShowExportMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showExportMenu]);

  // 데이터 행 생성 (공통)
  const buildRows = () => {
    if (!data) return [];
    const rows: (string | number)[][] = [];
    for (const company of data) {
      for (const emp of company.employees) {
        rows.push([
          company.company,
          emp.name,
          emp.position ?? "-",
          emp.wageType === "hourly" ? "시급" : emp.wageType === "monthly" ? "월급" : emp.wageType === "daily" ? "일급" : "-",
          emp.wageAmount ? Number(emp.wageAmount) : 0,
          emp.shifts,
          Number(emp.totalHours.toFixed(1)),
          Math.round(emp.totalWage),
          emp.contractStart ?? "-",
          emp.contractEnd ?? "-",
        ]);
      }
    }
    return rows;
  };

  const headers = ["소속회사", "이름", "직위", "급여유형", "급여액", "출근횟수", "총근무시간", "인건비(원)", "계약시작", "계약종료"];
  const fileName = `인건비정산_${year}년${month}월_${current?.name ?? ""}`;

  const handleExportExcel = async () => {
    setShowExportMenu(false);
    const rows = buildRows();
    if (!rows.length) return;
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    // 열 너비 설정
    ws["!cols"] = headers.map((h, i) => ({ wch: i === 0 ? 14 : i === 7 ? 14 : 10 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "인건비정산");
    XLSX.writeFile(wb, `${fileName}.xlsx`);
  };

  const handleExportPDF = async () => {
    setShowExportMenu(false);
    const rows = buildRows();
    if (!rows.length) return;
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    await loadKoreanFont(doc);

    // 제목
    doc.setFontSize(14);
    doc.text(`${fileName}`, 14, 15);
    doc.setFontSize(9);
    doc.text(`합계: ${fmtWon(grandTotalWage)}원 / ${grandTotalHours.toFixed(1)}시간`, 14, 22);

    autoTable(doc, {
      startY: 28,
      head: [headers],
      body: rows.map(r => r.map(c => String(c))),
      styles: { fontSize: 8, cellPadding: 2, font: "NanumGothic" },
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontSize: 8, font: "NanumGothic" },
      columnStyles: {
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
        7: { halign: "right" },
      },
    });

    doc.save(`${fileName}.pdf`);
  };

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Building2 className="w-5 h-5" /> 인건비 정산
        </h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{current?.name}</span>
          {data && data.length > 0 && (
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
          )}
        </div>
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
        <CompanyCardListSkeleton />
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
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">급여</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">출근</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">시간</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">인건비</th>
                        </tr>
                      </thead>
                      <tbody>
                        {company.employees.map((emp, i) => (
                          <tr key={i} className="border-t border-border/50 group">
                            <td className="px-4 py-2">
                              <div className="font-medium text-foreground">{emp.name}</div>
                              {emp.position && (
                                <div className="text-[10px] text-muted-foreground">{emp.position}</div>
                              )}
                            </td>
                            <td className="px-4 py-2">
                              <div className="text-muted-foreground">{wageLabel(emp.wageType, emp.wageAmount)}</div>
                              {(emp.contractStart || emp.contractEnd) && (
                                <div className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                  <FileText className="w-2.5 h-2.5 inline" />
                                  {fmtDate(emp.contractStart)}~{fmtDate(emp.contractEnd)}
                                </div>
                              )}
                            </td>
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
