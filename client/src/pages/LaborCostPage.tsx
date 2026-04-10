import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import {
  ChevronLeft, ChevronRight, Building2, Users, Clock, Wallet,
  ChevronDown, ChevronUp, FileText, Download, CalendarCheck, CalendarDays,
  AlertTriangle, Check, X, Plus, Minus, Info, UserX, Edit3, Save, Phone, CreditCard,
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

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.schedules.laborCostByCompany.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 },
  );
  const clearRecheck = trpc.schedules.clearPayrollRecheck.useMutation({
    onSuccess() { utils.schedules.laborCostByCompany.invalidate(); },
  });

  const grandTotalHours = data?.reduce((s, c) => s + c.totalHours, 0) ?? 0;
  const grandTotalWage = data?.reduce((s, c) => s + c.totalWage, 0) ?? 0;

  if (!restaurantId) return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;

  const [showExportMenu, setShowExportMenu] = useState(false);
  const [includeSettlement, setIncludeSettlement] = useState(true);
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

  // 데이터 행 생성 (공통) — 임시근로자를 회사별 하단으로 정렬
  const buildRows = (withSettlement: boolean) => {
    if (!data) return [];
    const rows: (string | number)[][] = [];
    for (const company of data) {
      const sorted = [...company.employees].sort((a: any, b: any) => (a.isTemp ? 1 : 0) - (b.isTemp ? 1 : 0));
      for (const emp of sorted) {
        const wage = Math.round(emp.totalWage);
        const deduction = !emp.socialInsurance && wage > 0 ? Math.round(wage * 0.033) : 0;
        const subRemain = emp.substituteLeave ? emp.substituteLeave.remaining : "-";
        const annRemain = emp.annualLeave ? emp.annualLeave.remaining : "-";
        const nameLabel = emp.isNoHolidayPayWorker ? `${emp.name} (주휴미제공)` : emp.isTemp ? `${emp.name} (임시)` : emp.name;
        if (withSettlement) {
          rows.push([
            company.company,
            nameLabel,
            emp.position ?? "-",
            emp.wageType === "hourly" ? "시급" : emp.wageType === "monthly" ? "월급" : emp.wageType === "daily" ? "일급" : "-",
            emp.wageAmount ? Number(emp.wageAmount) : 0,
            emp.contractDaysOff ?? 0,
            emp.shifts,
            Math.floor(emp.totalHours),
            emp.daysOff ?? 0,
            subRemain,
            annRemain,
            emp.socialInsurance ? "4대보험" : "3.3%공제",
            wage,
            deduction,
            emp.bankAccount ?? "-",
            emp.residentNumber ?? "-",
            emp.contractStart ? new Date(emp.contractStart).toLocaleDateString("ko-KR") : "-",
            emp.contractEnd ? new Date(emp.contractEnd).toLocaleDateString("ko-KR") : "-",
          ]);
        } else {
          rows.push([
            company.company,
            nameLabel,
            emp.position ?? "-",
            emp.shifts,
            Math.floor(emp.totalHours),
            emp.daysOff ?? 0,
            subRemain,
            annRemain,
          ]);
        }
      }
    }
    return rows;
  };

  const fullHeaders = ["소속회사", "이름", "직위", "급여유형", "계약급여", "계약휴무", "실근무일", "총근무시간", "실휴무일", "대체휴무잔여", "연차잔여", "보험구분", "인건비(원)", "3.3%공제", "계좌번호", "주민번호", "계약시작", "계약종료"];
  const basicHeaders = ["소속회사", "이름", "직위", "실근무일", "총근무시간", "실휴무일", "대체휴무잔여", "연차잔여"];
  const fileName = `인건비정산_${year}년${month}월_${current?.name ?? ""}`;

  const handleExportExcel = async () => {
    setShowExportMenu(false);
    const headers = includeSettlement ? fullHeaders : basicHeaders;
    const rows = buildRows(includeSettlement);
    if (!rows.length) return;
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    if (includeSettlement) {
      ws["!cols"] = headers.map((_h: string, i: number) => ({ wch: i === 0 ? 14 : i === 12 ? 14 : i === 14 ? 22 : i === 15 ? 16 : 10 }));
    } else {
      ws["!cols"] = headers.map(() => ({ wch: 12 }));
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "인건비정산");
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
    try {
      const headers = includeSettlement ? fullHeaders : basicHeaders;
      const rows = buildRows(includeSettlement);
      if (!rows.length) return;
      const { jsPDF } = await import("jspdf");
      const atModule = await import("jspdf-autotable");
      const autoTable = atModule.default || atModule.autoTable;
      const doc = new jsPDF({ orientation: includeSettlement ? "landscape" : "portrait", unit: "mm", format: "a4" });
      await loadKoreanFont(doc);

      // 제목
      doc.setFontSize(14);
      doc.text(`${fileName}`, 14, 15);
      doc.setFontSize(9);
      doc.text(`합계: ${fmtWon(grandTotalWage)}원 / ${Math.floor(grandTotalHours)}시간`, 14, 22);

      const rightAlignCols: Record<number, { halign: "right" }> = {};
      if (includeSettlement) {
        // 급여액(4), 계약휴무(5), 실근무일(6), 총근무시간(7), 실휴무일(8), 대체휴무(9), 연차(10), 인건비(12), 3.3%(13)
        [4, 5, 6, 7, 8, 9, 10, 12, 13].forEach(i => { rightAlignCols[i] = { halign: "right" }; });
      } else {
        // 실근무일(3), 총근무시간(4), 실휴무일(5), 대체휴무(6), 연차(7)
        [3, 4, 5, 6, 7].forEach(i => { rightAlignCols[i] = { halign: "right" }; });
      }

      autoTable(doc, {
        startY: 28,
        head: [headers],
        body: rows.map(r => r.map(c => String(c))),
        styles: { fontSize: 8, cellPadding: 2, font: "NanumGothic" },
        headStyles: { fillColor: [59, 130, 246], textColor: 255, fontSize: 8, font: "NanumGothic", fontStyle: "normal" },
        columnStyles: rightAlignCols,
      });

      const pdfBlob = doc.output("blob");
      const pdfUrl = URL.createObjectURL(pdfBlob);
      window.open(pdfUrl, "_blank");
    } catch (err: any) {
      console.error("PDF export error:", err);
      alert(`PDF 내보내기 실패: ${err.message || "알 수 없는 오류"}`);
    }
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
                <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-50 min-w-[180px] py-1">
                  <label
                    className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground cursor-pointer hover:bg-accent transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={includeSettlement}
                      onChange={(e) => setIncludeSettlement(e.target.checked)}
                      className="rounded border-border"
                    />
                    정산내역 포함
                  </label>
                  <div className="border-t border-border my-1" />
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

      {/* 정산 재확인 배너 */}
      {data && data.some(c => c.employees.some((e: any) => e.recheckRequired)) && (
        <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">완료된 스케줄이 수정된 직원이 있습니다. 인건비 정산을 재확인해주세요.</span>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 h-6 px-2 text-[11px] border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40"
            disabled={clearRecheck.isPending}
            onClick={() => clearRecheck.mutate({ restaurantId, year, month })}
          >
            <Check className="w-3 h-3 mr-1" />
            {clearRecheck.isPending ? "처리중..." : "확인 완료"}
          </Button>
        </div>
      )}

      {/* 총계 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">총 근무시간</div>
          <div className="text-sm font-bold text-foreground flex items-center justify-center gap-1">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            {Math.floor(grandTotalHours)}h
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

      {/* 대체휴무/연차 잔여 요약 */}
      <LeaveSummarySection restaurantId={restaurantId} year={year} month={month} />

      {/* 회사별 카드 */}
      {isLoading ? (
        <CompanyCardListSkeleton />
      ) : !data || data.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">해당 월 스케줄 데이터가 없습니다</div>
      ) : (
        <div className="space-y-3">
          {data.map((company) => {
            const isExpanded = expandedCompany === company.company;
            const recheckCount = company.employees.filter((e: any) => e.recheckRequired).length;
            return (
              <div key={company.company} className="bg-card border border-border rounded-lg overflow-hidden">
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => setExpandedCompany(isExpanded ? null : company.company)}
                >
                  <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground flex items-center gap-1">
                      {company.company}
                      {recheckCount > 0 && (
                        <span className="text-[10px] text-amber-600 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full font-medium">
                          재확인 {recheckCount}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{company.employees.length}명 · 영업 {company.operatingDays ?? '-'}일</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-foreground">₩{fmtWon(company.totalWage)}</div>
                    <div className="text-[11px] text-muted-foreground">{Math.floor(company.totalHours)}h</div>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                </div>

                {isExpanded && (() => {
                  const regularEmps = company.employees.filter((e: any) => !e.isTemp);
                  const tempEmps = company.employees.filter((e: any) => e.isTemp);
                  return (
                    <div className="border-t border-border">
                      {/* 정규 직원 */}
                      <div className="divide-y divide-border/50">
                        {regularEmps.map((emp, i) => (
                          <EmployeeRow key={`r-${i}`} emp={emp} restaurantId={restaurantId} />
                        ))}
                      </div>
                      {/* 임시근로자 + 주휴미제공 */}
                      {tempEmps.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1.5 px-4 py-2 bg-muted/40 border-t border-border">
                            <UserX className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-[11px] font-semibold text-muted-foreground">임시/주휴미제공 ({tempEmps.length}명)</span>
                          </div>
                          <div className="divide-y divide-border/50">
                            {tempEmps.map((emp, i) => (
                              <EmployeeRow key={`t-${i}`} emp={emp} restaurantId={restaurantId} />
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

/* ─── 직원 행 컴포넌트 ─────────────────────────────── */
function EmployeeRow({ emp, restaurantId }: { emp: any; restaurantId: number }) {
  const utils = trpc.useUtils();
  const updateTempInfo = trpc.schedules.updateTempWorkerInfo.useMutation({
    onSuccess() { utils.schedules.laborCostByCompany.invalidate(); },
  });
  const [editingTemp, setEditingTemp] = useState(false);
  const [tempBank, setTempBank] = useState(emp.bankAccount ?? "");
  const [tempPhoneVal, setTempPhoneVal] = useState(emp.phone ?? "");

  const saveTempInfo = () => {
    updateTempInfo.mutate({
      restaurantId,
      tempWorkerName: emp.name,
      bankAccount: tempBank,
      phone: tempPhoneVal,
    });
    setEditingTemp(false);
  };

  const subUsed = emp.substituteLeave && emp.substituteLeave.used > 0;
  const annUsed = emp.annualLeave && emp.annualLeave.used > 0;
  return (
    <div className={`px-4 py-3 space-y-2 ${emp.recheckRequired ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}>
      {/* 1행: 이름 + 실급여 */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-foreground flex items-center gap-1">
            {emp.name}
            {emp.isTemp && <span className="text-[9px] bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded font-medium">{emp.isNoHolidayPayWorker ? "주휴미제공" : "임시"}</span>}
            {emp.position && <span className="text-[10px] text-muted-foreground font-normal">({emp.position})</span>}
            {emp.recheckRequired && <AlertTriangle className="w-3 h-3 text-amber-500" />}
          </div>
          {emp.hireDate && (
            <div className="text-[10px] text-muted-foreground">입사 {fmtDate(emp.hireDate)}</div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold text-foreground">₩{fmtWon(emp.totalWage)}</div>
          {!emp.socialInsurance && emp.totalWage > 0 && (
            <div className="text-[10px] text-orange-600 dark:text-orange-400">
              3.3% 공제 ₩{fmtWon(Math.round(emp.totalWage * 0.033))}
            </div>
          )}
        </div>
      </div>
      {/* 0원 이유 안내 */}
      {emp.zeroWageReason && (
        <div className="flex items-center gap-1.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded px-2.5 py-1.5 text-[11px] text-red-600 dark:text-red-400">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>인건비 0원 — {emp.zeroWageReason}</span>
        </div>
      )}
      {/* 2행: 주요 항목 그리드 */}
      <div className="grid grid-cols-4 gap-x-3 gap-y-1 text-xs">
        <div>
          <span className="text-muted-foreground">계약급여</span>
          <div className="font-medium text-foreground">{wageLabel(emp.wageType, emp.wageAmount)}</div>
        </div>
        <div>
          <span className="text-muted-foreground">계약휴무</span>
          <div className="font-medium text-foreground">{emp.contractDaysOff ?? 0}일</div>
        </div>
        <div>
          <span className="text-muted-foreground">실근무</span>
          <div className="font-medium text-foreground">{emp.shifts}일 / {Math.floor(emp.totalHours)}h</div>
        </div>
        <div>
          <span className="text-muted-foreground">실휴무</span>
          <div className="font-medium text-foreground">{emp.daysOff ?? 0}일</div>
        </div>
      </div>
      {/* 3행: 대체휴무/연차/보험 (임시근로자는 간략화) */}
      {!emp.isTemp ? (
        <div className="grid grid-cols-4 gap-x-3 gap-y-1 text-xs">
          <div>
            <span className="text-muted-foreground">대체휴무</span>
            <div className="font-medium text-foreground">
              {subUsed ? "사용" : "미사용"}
              {emp.substituteLeave && <span className="text-muted-foreground"> (잔여 {emp.substituteLeave.remaining}일)</span>}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">연차</span>
            <div className="font-medium text-foreground">
              {annUsed ? "사용" : "미사용"}
              {emp.annualLeave && <span className="text-muted-foreground"> (잔여 {emp.annualLeave.remaining}일)</span>}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">보험구분</span>
            <div className="font-medium">
              {emp.socialInsurance ? (
                <span className="text-green-600 dark:text-green-400">4대보험</span>
              ) : (
                <span className="text-orange-600 dark:text-orange-400">3.3%공제</span>
              )}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">계약기간</span>
            <div className="font-medium text-foreground text-[10px]">
              {emp.contractStart ? `${fmtDate(emp.contractStart)}~${fmtDate(emp.contractEnd)}` : "-"}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
          <div>
            <span className="text-muted-foreground">급여유형</span>
            <div className="font-medium text-foreground">{wageLabel(emp.wageType, emp.wageAmount)}</div>
          </div>
          <div>
            <span className="text-muted-foreground">보험구분</span>
            <div className="font-medium">
              <span className="text-orange-600 dark:text-orange-400">3.3%공제</span>
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">총 근무</span>
            <div className="font-medium text-foreground">{emp.shifts}일 / {Math.floor(emp.totalHours)}h</div>
          </div>
        </div>
      )}
      {/* 4행: 계좌/주민번호/연락처 */}
      {emp.isTemp ? (
        <div className="text-xs pt-1 border-t border-border/30">
          {editingTemp ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <CreditCard className="w-3 h-3 text-muted-foreground shrink-0" />
                <input
                  className="flex-1 px-2 py-1 border border-input rounded text-xs bg-background"
                  placeholder="계좌번호"
                  value={tempBank}
                  onChange={(e) => setTempBank(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-3 h-3 text-muted-foreground shrink-0" />
                <input
                  className="flex-1 px-2 py-1 border border-input rounded text-xs bg-background"
                  placeholder="연락처"
                  value={tempPhoneVal}
                  onChange={(e) => setTempPhoneVal(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1.5 justify-end">
                <button onClick={() => setEditingTemp(false)} className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent">취소</button>
                <button onClick={saveTempInfo} disabled={updateTempInfo.isPending} className="text-[11px] text-primary font-medium px-2 py-1 rounded hover:bg-primary/10 flex items-center gap-1">
                  <Save className="w-3 h-3" /> 저장
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {emp.bankAccount && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <CreditCard className="w-3 h-3" /> {emp.bankAccount}
                  </span>
                )}
                {emp.phone && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Phone className="w-3 h-3" /> {emp.phone}
                  </span>
                )}
                {!emp.bankAccount && !emp.phone && (
                  <span className="text-muted-foreground/60">계좌/연락처 미등록</span>
                )}
              </div>
              <button
                onClick={() => { setTempBank(emp.bankAccount ?? ""); setTempPhoneVal(emp.phone ?? ""); setEditingTemp(true); }}
                className="text-[11px] text-primary hover:text-primary/80 flex items-center gap-1 px-2 py-1 rounded hover:bg-primary/10"
              >
                <Edit3 className="w-3 h-3" /> {emp.bankAccount || emp.phone ? "수정" : "입력"}
              </button>
            </div>
          )}
        </div>
      ) : (emp.bankAccount || emp.residentNumber) ? (
        <div className="grid grid-cols-2 gap-x-3 text-xs pt-1 border-t border-border/30">
          <div>
            <span className="text-muted-foreground">계좌번호</span>
            <div className="font-medium text-foreground">{emp.bankAccount || "-"}</div>
          </div>
          <div>
            <span className="text-muted-foreground">주민번호</span>
            <div className="font-medium text-foreground">{emp.residentNumber || "-"}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ─── 대체휴무/연차 관리 섹션 ─────────────────────────────── */
function LeaveSummarySection({ restaurantId, year, month }: { restaurantId: number; year: number; month: number }) {
  const [open, setOpen] = useState(false);
  const [useLeaveTarget, setUseLeaveTarget] = useState<{ userId: number; userName: string; leaveType: "substitute" | "annual" } | null>(null);
  const [useDate, setUseDate] = useState("");
  const [useDays, setUseDays] = useState<"1" | "0.5">("1");

  const utils = trpc.useUtils();

  // 공휴일 근무 자동 감지
  const { data: holidayWork, isLoading: hwLoading } = trpc.leaveBalance.detectHolidayWork.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 },
  );

  // 전체 잔여 현황
  const { data: summary, isLoading: sumLoading } = trpc.leaveBalance.storeSummary.useQuery(
    { restaurantId, year },
    { enabled: restaurantId > 0 },
  );

  // 대체휴무 반영 mutation
  const earnMut = trpc.leaveBalance.earnSubstitute.useMutation({
    onSuccess: () => {
      utils.leaveBalance.detectHolidayWork.invalidate();
      utils.leaveBalance.storeSummary.invalidate();
    },
  });

  // 대체휴무 반영 취소 mutation
  const cancelMut = trpc.leaveBalance.cancelEarnSubstitute.useMutation({
    onSuccess: () => {
      utils.leaveBalance.detectHolidayWork.invalidate();
      utils.leaveBalance.storeSummary.invalidate();
    },
  });

  // 휴가 소진 mutation
  const useMut = trpc.leaveBalance.useLeave.useMutation({
    onSuccess: () => {
      utils.leaveBalance.storeSummary.invalidate();
      setUseLeaveTarget(null);
      setUseDate("");
      setUseDays("1");
    },
  });

  const isLoading = hwLoading || sumLoading;
  const hasHolidayWork = holidayWork && holidayWork.length > 0;
  const hasSummary = summary && summary.length > 0;

  if (isLoading) return null;
  if (!hasHolidayWork && !hasSummary) return null;

  const unreflected = holidayWork?.filter((h) => !h.alreadyEarned) ?? [];

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* 헤더 */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <CalendarCheck className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground">대체휴무 / 연차 관리</div>
          <div className="text-xs text-muted-foreground">
            {year}년 {month}월
            {unreflected.length > 0 && (
              <span className="ml-1 text-amber-600 font-medium">
                · 미반영 {unreflected.length}건
              </span>
            )}
          </div>
        </div>
        {unreflected.length > 0 && !open && (
          <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
            {unreflected.length}
          </span>
        )}
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </div>

      {open && (
        <div className="border-t border-border">
          {/* ── 1. 공휴일 근무 감지 (이번 달) ── */}
          {hasHolidayWork && (
            <div className="p-3 space-y-2">
              <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1 mb-2">
                <AlertTriangle className="w-3 h-3" /> {month}월 공휴일 근무 감지 (5인 이상 사업장)
              </div>
              {holidayWork!.map((hw, i) => (
                <div key={i} className="flex items-center gap-2 text-xs bg-muted/30 rounded-md px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-foreground">{hw.userName}</span>
                    <span className="text-muted-foreground ml-1">
                      {hw.holidayDate.slice(5)} {hw.holidayName}
                    </span>
                  </div>
                  {hw.alreadyEarned ? (
                    <div className="flex items-center gap-1">
                      <span className="text-green-600 flex items-center gap-0.5">
                        <Check className="w-3 h-3" /> 반영됨
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`${hw.userName}의 ${hw.holidayName} 대체휴무 반영을 취소하시겠습니까?`)) {
                            cancelMut.mutate({ userId: hw.userId, restaurantId, holidayDate: hw.holidayDate });
                          }
                        }}
                        disabled={cancelMut.isPending}
                        className="text-muted-foreground hover:text-red-500 transition-colors ml-1"
                        title="반영 취소"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        earnMut.mutate({
                          userId: hw.userId,
                          restaurantId,
                          holidayDate: hw.holidayDate,
                          scheduleId: hw.scheduleId,
                        });
                      }}
                      disabled={earnMut.isPending}
                      className="flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium transition-colors"
                    >
                      <Plus className="w-3 h-3" /> 대체휴무 반영
                    </button>
                  )}
                </div>
              ))}
              {unreflected.length > 1 && (
                <button
                  onClick={() => {
                    if (!confirm(`미반영 ${unreflected.length}건을 모두 반영하시겠습니까?`)) return;
                    for (const hw of unreflected) {
                      earnMut.mutate({
                        userId: hw.userId,
                        restaurantId,
                        holidayDate: hw.holidayDate,
                        scheduleId: hw.scheduleId,
                      });
                    }
                  }}
                  disabled={earnMut.isPending}
                  className="w-full text-center text-xs font-medium text-blue-600 hover:text-blue-800 py-1.5 bg-blue-50 dark:bg-blue-950/30 rounded-md transition-colors"
                >
                  미반영 {unreflected.length}건 일괄 반영
                </button>
              )}
            </div>
          )}

          {/* ── 2. 연간 잔여 현황 ── */}
          {hasSummary && (
            <div className={hasHolidayWork ? "border-t border-border" : ""}>
              <div className="px-3 pt-3 pb-1 text-xs font-semibold text-muted-foreground flex items-center gap-1">
                <CalendarDays className="w-3 h-3" /> {year}년 잔여 현황
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">이름</th>
                    <th className="text-center px-1 py-1.5 text-[10px] text-muted-foreground font-normal" colSpan={3}>대체휴무</th>
                    <th className="text-center px-1 py-1.5 text-[10px] text-muted-foreground font-normal" colSpan={3}>연차</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                  <tr className="bg-muted/15">
                    <th className="px-3 py-0.5"></th>
                    <th className="text-center px-1 py-0.5 text-[9px] text-muted-foreground font-normal">발생</th>
                    <th className="text-center px-1 py-0.5 text-[9px] text-muted-foreground font-normal">사용</th>
                    <th className="text-center px-1 py-0.5 text-[9px] text-muted-foreground font-normal">잔여</th>
                    <th className="text-center px-1 py-0.5 text-[9px] text-muted-foreground font-normal">발생</th>
                    <th className="text-center px-1 py-0.5 text-[9px] text-muted-foreground font-normal">사용</th>
                    <th className="text-center px-1 py-0.5 text-[9px] text-muted-foreground font-normal">잔여</th>
                    <th className="px-2 py-0.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {summary!.map((emp) => (
                    <tr key={emp.userId} className="border-t border-border/50">
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{emp.userName}</div>
                      </td>
                      <td className="text-center px-1 py-2 text-muted-foreground">{emp.substitute.earned}</td>
                      <td className="text-center px-1 py-2 text-muted-foreground">{emp.substitute.used}</td>
                      <td className={`text-center px-1 py-2 font-medium ${emp.substitute.remaining > 0 ? "text-blue-600" : "text-muted-foreground"}`}>
                        {emp.substitute.remaining}
                      </td>
                      <td className="text-center px-1 py-2 text-muted-foreground">{emp.annual.earned}</td>
                      <td className="text-center px-1 py-2 text-muted-foreground">{emp.annual.used}</td>
                      <td className={`text-center px-1 py-2 font-medium ${emp.annual.remaining > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                        {emp.annual.remaining}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          {emp.substitute.remaining > 0 && (
                            <button
                              onClick={() => setUseLeaveTarget({ userId: emp.userId, userName: emp.userName, leaveType: "substitute" })}
                              className="text-[10px] text-blue-600 hover:underline whitespace-nowrap"
                              title="대체휴무 소진"
                            >
                              <Minus className="w-3 h-3 inline" />대휴
                            </button>
                          )}
                          {emp.annual.remaining > 0 && (
                            <button
                              onClick={() => setUseLeaveTarget({ userId: emp.userId, userName: emp.userName, leaveType: "annual" })}
                              className="text-[10px] text-green-600 hover:underline whitespace-nowrap"
                              title="연차 소진"
                            >
                              <Minus className="w-3 h-3 inline" />연차
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── 3. 소진 입력 모달 (인라인) ── */}
          {useLeaveTarget && (
            <div className="border-t border-border p-3 bg-muted/20 space-y-2">
              <div className="text-xs font-semibold text-foreground">
                {useLeaveTarget.userName} — {useLeaveTarget.leaveType === "substitute" ? "대체휴무" : "연차"} 소진
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={useDate}
                  onChange={(e) => setUseDate(e.target.value)}
                  className="text-xs border border-border rounded px-2 py-1.5 bg-background text-foreground flex-1"
                  placeholder="사용일"
                />
                <select
                  value={useDays}
                  onChange={(e) => setUseDays(e.target.value as "1" | "0.5")}
                  className="text-xs border border-border rounded px-2 py-1.5 bg-background text-foreground"
                >
                  <option value="1">1일</option>
                  <option value="0.5">반차 (0.5일)</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="default"
                  className="text-xs h-7"
                  disabled={!useDate || useMut.isPending}
                  onClick={() => {
                    useMut.mutate({
                      userId: useLeaveTarget.userId,
                      restaurantId,
                      leaveType: useLeaveTarget.leaveType,
                      useDate,
                      days: parseFloat(useDays),
                    });
                  }}
                >
                  {useMut.isPending ? "처리중..." : "소진 등록"}
                </Button>
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setUseLeaveTarget(null)}>
                  취소
                </Button>
                {useMut.error && (
                  <span className="text-xs text-red-500">{useMut.error.message}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
