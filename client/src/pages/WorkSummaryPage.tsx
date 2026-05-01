import { useState, useRef, useEffect } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import {
  ChevronLeft, ChevronRight, Building2, Clock, ChevronDown, ChevronUp,
  FileText, Download, AlertTriangle, UserX, CalendarClock, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CompanyCardListSkeleton } from "@/components/ui/skeletons";
import { loadKoreanFont } from "@/lib/pdfKoreanFont";

function fmtDate(d: string | null) {
  if (!d) return "-";
  const date = new Date(d);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

const PRESET_LABEL: Record<string, string> = {
  open: "오픈", full: "풀타임", close: "마감", custom: "커스텀",
};
const STATUS_LABEL: Record<string, string> = {
  draft: "초안", scheduled: "예정", published: "게시",
  confirmed: "확정", completed: "완료", canceled: "취소",
};

// ─── 메인 페이지 ──────────────────────────────────────────────────────────
export default function WorkSummaryPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [expandedEmpKey, setExpandedEmpKey] = useState<string | null>(null);

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };

  const { data, isLoading } = trpc.schedules.workSummaryByEmployee.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 },
  );

  const companies = data?.companies ?? [];

  const grandTotalHours = companies.reduce((s, c) => s + c.totalHours, 0);
  const grandTotalShifts = companies.reduce((s, c) => s + c.totalShifts, 0);

  if (!restaurantId) return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;

  // 내보내기
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

  const buildRows = () => {
    const rows: (string | number)[][] = [];
    for (const company of companies) {
      const sorted = [...company.employees].sort((a: any, b: any) => (a.isTemp ? 1 : 0) - (b.isTemp ? 1 : 0));
      for (const emp of sorted) {
        const subRemain = emp.substituteLeave ? emp.substituteLeave.remaining : "-";
        const annRemain = emp.annualLeave ? emp.annualLeave.remaining : "-";
        const nameLabel = emp.isNoHolidayPayWorker
          ? `${emp.name} (주휴미제공)`
          : emp.isTemp ? `${emp.name} (임시)` : emp.name;
        rows.push([
          company.company,
          nameLabel,
          emp.position ?? "-",
          emp.shifts,
          Math.round(emp.totalHours * 10) / 10,
          emp.daysOff ?? 0,
          emp.contractDaysOff ?? 0,
          subRemain,
          annRemain,
        ]);
      }
    }
    return rows;
  };

  const headers = ["소속회사", "이름", "직위", "실근무일", "총근무시간", "실휴무일", "계약휴무", "대체휴무잔여", "연차잔여"];
  const fileName = `근무현황_${year}년${month}월_${current?.name ?? ""}`;

  const handleExportExcel = async () => {
    setShowExportMenu(false);
    const rows = buildRows();
    if (!rows.length) return;
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = headers.map(() => ({ wch: 12 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "근무현황");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = async () => {
    setShowExportMenu(false);
    const rows = buildRows();
    if (!rows.length) return;
    const { jsPDF } = await import("jspdf");
    const atModule = await import("jspdf-autotable");
    const autoTable = atModule.default || atModule.autoTable;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    await loadKoreanFont(doc);

    doc.setFontSize(14);
    doc.text(fileName, 14, 15);
    doc.setFontSize(9);
    doc.text(`합계: ${grandTotalShifts}일 근무 / ${grandTotalHours.toFixed(1)}시간`, 14, 22);

    const rightCols: Record<number, { halign: "right" }> = {};
    [3, 4, 5, 6, 7, 8].forEach(i => { rightCols[i] = { halign: "right" }; });

    autoTable(doc, {
      startY: 28,
      head: [headers],
      body: rows.map(r => r.map(c => String(c))),
      styles: { fontSize: 8, cellPadding: 2, font: "NanumGothic" },
      headStyles: { fillColor: [16, 185, 129], textColor: 255, fontSize: 8, font: "NanumGothic", fontStyle: "normal" },
      columnStyles: rightCols,
    });

    const pdfBlob = doc.output("blob");
    const pdfUrl = URL.createObjectURL(pdfBlob);
    window.open(pdfUrl, "_blank");
  };

  const empKey = (emp: any) => `${emp.userId ?? "t"}_${emp.name}`;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
          <CalendarClock className="w-5 h-5" /> 근무 현황
        </h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{current?.name}</span>
          {companies.length > 0 && (
            <div className="relative" ref={exportRef}>
              <Button variant="outline" size="sm" onClick={() => setShowExportMenu(!showExportMenu)} className="gap-1">
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">내보내기</span>
              </Button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-50 min-w-[180px] py-1">
                  <button onClick={handleExportExcel} className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-green-600" /> Excel (.xlsx)
                  </button>
                  <button onClick={handleExportPDF} className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-red-500" /> PDF
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 안내 배너 */}
      <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
        <Eye className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>근무일수·근무시간·휴무 잔여만 표시됩니다. 급여·계좌 등 정산 정보는 점장 권한의 <b>인건비 정산</b>에서 확인하세요.</span>
      </div>

      {/* 월 네비게이션 */}
      <div className="flex items-center justify-between bg-card border border-border rounded-lg p-3">
        <Button variant="ghost" size="sm" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
        <div className="text-base font-bold text-foreground">{year}년 {month}월</div>
        <Button variant="ghost" size="sm" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
      </div>

      {/* 재확인 배너 */}
      {companies.some(c => c.employees.some((e: any) => e.recheckRequired)) && (
        <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>완료된 스케줄이 수정된 직원이 있습니다. 카드를 펼쳐 확인하세요.</span>
        </div>
      )}

      {/* 총계 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">총 근무일</div>
          <div className="text-sm font-bold text-foreground">{grandTotalShifts}일</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">총 근무시간</div>
          <div className="text-sm font-bold text-foreground flex items-center justify-center gap-1">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            {grandTotalHours.toFixed(1)}h
          </div>
        </div>
      </div>

      {/* 회사별 카드 */}
      {isLoading ? (
        <CompanyCardListSkeleton />
      ) : companies.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">해당 월 스케줄 데이터가 없습니다</div>
      ) : (
        <div className="space-y-3">
          {companies.map((company) => {
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
                    <div className="text-xs text-muted-foreground">{company.employees.length}명 · 영업 {company.operatingDays ?? '-'}일</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-foreground">{company.totalShifts}일</div>
                    <div className="text-[11px] text-muted-foreground">{company.totalHours.toFixed(1)}h</div>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                </div>

                {isExpanded && (() => {
                  const regularEmps = company.employees.filter((e: any) => !e.isTemp);
                  const tempEmps = company.employees.filter((e: any) => e.isTemp);
                  return (
                    <div className="border-t border-border">
                      <div className="divide-y divide-border/50">
                        {regularEmps.map((emp, i) => (
                          <EmployeeShiftCard
                            key={`r-${i}`}
                            emp={emp}
                            restaurantId={restaurantId}
                            year={year}
                            month={month}
                            expanded={expandedEmpKey === empKey(emp)}
                            onToggle={() => setExpandedEmpKey(expandedEmpKey === empKey(emp) ? null : empKey(emp))}
                          />
                        ))}
                      </div>
                      {tempEmps.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1.5 px-4 py-2 bg-muted/40 border-t border-border">
                            <UserX className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-[11px] font-semibold text-muted-foreground">임시/주휴미제공 ({tempEmps.length}명)</span>
                          </div>
                          <div className="divide-y divide-border/50">
                            {tempEmps.map((emp, i) => (
                              <EmployeeShiftCard
                                key={`t-${i}`}
                                emp={emp}
                                restaurantId={restaurantId}
                                year={year}
                                month={month}
                                expanded={expandedEmpKey === empKey(emp)}
                                onToggle={() => setExpandedEmpKey(expandedEmpKey === empKey(emp) ? null : empKey(emp))}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── 인원별 카드 (헤더 + 펼침 시 세부 근무내역 인라인 테이블) ────────────────
function EmployeeShiftCard({
  emp, restaurantId, year, month, expanded, onToggle,
}: {
  emp: any;
  restaurantId: number;
  year: number;
  month: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const subUsed = emp.substituteLeave && emp.substituteLeave.used > 0;
  const annUsed = emp.annualLeave && emp.annualLeave.used > 0;

  const userId = emp.userId ?? null;
  const tempWorkerName = emp.tempWorkerName ?? (emp.isTemp ? emp.name : null);
  const enabled = expanded && (userId !== null || !!tempWorkerName);

  const { data: shifts, isLoading } = trpc.schedules.employeeMonthlyShifts.useQuery(
    { restaurantId, year, month, userId, tempWorkerName },
    { enabled },
  );

  const totalHours = shifts?.reduce((s, r) => s + r.netHours, 0) ?? 0;
  const totalDays = shifts?.length ?? 0;

  return (
    <div className={`px-4 py-3 space-y-2 ${emp.recheckRequired ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}>
      {/* 1행: 이름 + 펼침 */}
      <div className="flex items-start justify-between gap-2 cursor-pointer" onClick={onToggle}>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground flex items-center gap-1">
            {emp.name}
            {emp.isTemp && (
              <span className="text-[9px] bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded font-medium">
                {emp.isNoHolidayPayWorker ? "주휴미제공" : "임시"}
              </span>
            )}
            {emp.position && <span className="text-[10px] text-muted-foreground font-normal">({emp.position})</span>}
            {emp.recheckRequired && <AlertTriangle className="w-3 h-3 text-amber-500" />}
            {expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground ml-auto" /> : <ChevronDown className="w-3 h-3 text-muted-foreground ml-auto" />}
          </div>
          {emp.hireDate && (
            <div className="text-[10px] text-muted-foreground">입사 {fmtDate(emp.hireDate)}</div>
          )}
        </div>
      </div>

      {/* 메타 칩 */}
      <div className="flex flex-wrap gap-1.5 text-[10px]">
        <span className="bg-muted/50 rounded px-1.5 py-0.5 text-muted-foreground">
          실근무 <b className="text-foreground">{emp.shifts}일 · {emp.totalHours.toFixed(1)}h</b>
        </span>
        <span className="bg-muted/50 rounded px-1.5 py-0.5 text-muted-foreground">
          실휴무 <b className="text-foreground">{emp.daysOff ?? 0}일</b>
        </span>
        <span className="bg-muted/50 rounded px-1.5 py-0.5 text-muted-foreground">
          계약휴무 <b className="text-foreground">{emp.contractDaysOff ?? 0}일</b>
        </span>
        {!emp.isTemp && emp.substituteLeave && (
          <span className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 rounded px-1.5 py-0.5">
            대휴 {subUsed ? "사용" : "미사용"} · 잔 {emp.substituteLeave.remaining}일
          </span>
        )}
        {!emp.isTemp && emp.annualLeave && (
          <span className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 rounded px-1.5 py-0.5">
            연차 {annUsed ? "사용" : "미사용"} · 잔 {emp.annualLeave.remaining}일
          </span>
        )}
      </div>

      {/* 펼침: 세부 근무내역 인라인 테이블 */}
      {expanded && (
        <div className="pt-2 space-y-2">
          {/* 상단 요약 */}
          <div className="grid grid-cols-2 gap-2 px-3 py-2 border border-border rounded bg-muted/20">
            <div className="text-center">
              <div className="text-[10px] text-muted-foreground">근무일</div>
              <div className="text-sm font-bold text-foreground">{totalDays}일</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-muted-foreground">총 근무시간</div>
              <div className="text-sm font-bold text-foreground">{totalHours.toFixed(1)}h</div>
            </div>
          </div>

          {/* 테이블 */}
          {isLoading ? (
            <div className="p-4 text-center text-xs text-muted-foreground">불러오는 중...</div>
          ) : !shifts || shifts.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">해당 월 스케줄이 없습니다</div>
          ) : (
            <div className="overflow-x-auto border border-border rounded">
              <table className="w-full text-xs">
                <thead className="bg-muted/60">
                  <tr className="text-muted-foreground">
                    <th className="text-left px-3 py-2 font-medium">날짜</th>
                    <th className="text-left px-2 py-2 font-medium">시간</th>
                    <th className="text-right px-2 py-2 font-medium">휴게</th>
                    <th className="text-right px-2 py-2 font-medium">순근무</th>
                    <th className="text-left px-2 py-2 font-medium">유형</th>
                    <th className="text-left px-3 py-2 font-medium">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((s) => (
                    <tr key={s.id} className="border-t border-border/40">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <span className="text-foreground font-medium">{s.date.slice(5)}</span>
                          <span className={`text-[10px] ${s.weekday === 0 ? "text-red-500" : s.weekday === 6 ? "text-blue-500" : "text-muted-foreground"}`}>
                            ({s.weekdayLabel})
                          </span>
                        </div>
                        {s.holidayName && (
                          <div className="text-[9px] text-red-500 font-medium">{s.holidayName}</div>
                        )}
                        {s.isStoreClosed && !s.holidayName && (
                          <div className="text-[9px] text-muted-foreground">매장휴무</div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-foreground whitespace-nowrap">
                        {s.startTime}–{s.endTime}
                      </td>
                      <td className="px-2 py-2 text-right text-muted-foreground">
                        {s.breakMinutes > 0 ? `${s.breakMinutes}분` : "-"}
                      </td>
                      <td className="px-2 py-2 text-right text-foreground font-medium">
                        {s.netHours.toFixed(1)}h
                      </td>
                      <td className="px-2 py-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.shiftPreset === "open" ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" : s.shiftPreset === "close" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300" : s.shiftPreset === "full" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
                          {PRESET_LABEL[s.shiftPreset] ?? s.shiftPreset}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] ${s.status === "completed" ? "text-emerald-600 dark:text-emerald-400" : s.status === "confirmed" ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`}>
                          {STATUS_LABEL[s.status] ?? s.status}
                        </span>
                        {s.payrollRecheckRequired && (
                          <AlertTriangle className="w-3 h-3 text-amber-500 inline ml-1" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
