import { Fragment, useState, useRef, useEffect } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import {
  ChevronLeft, ChevronRight, Building2, Wallet,
  ChevronDown, ChevronUp, FileText, Download, CalendarCheck, CalendarDays,
  AlertTriangle, Check, X, Plus, Info, UserX, Edit3, Save, Phone, CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CompanyCardListSkeleton } from "@/components/ui/skeletons";
import { loadKoreanFont } from "@/lib/pdfKoreanFont";
import { formatKRW } from "@/lib/utils";

/** 표·PDF용 — 단순 천단위 콤마 (단위 없이) */
function fmtWonRaw(n: number | null | undefined) {
  if (n == null || !isFinite(n)) return "-";
  return Math.round(n).toLocaleString();
}

/** 화면 표시용 — "2,000,000원" 형식 */
function fmtWon(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "-";
  return formatKRW(Math.round(n));
}

function fmtDate(d: string | null) {
  if (!d) return "-";
  const date = new Date(d);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function wageTypeBadge(emp: any): string | null {
  if (emp.isNoHolidayPayWorker) return "주휴미제공";
  if (emp.isTemp) return "임시";
  if (emp.wageType === "hourly") return "시급";
  if (emp.wageType === "monthly") return "월급";
  if (emp.wageType === "daily") return "일급";
  return null;
}

function pctDiff(eff: number | null, guide: number | null): number | null {
  if (eff == null || guide == null || guide === 0) return null;
  return ((eff - guide) / guide) * 100;
}

function fmtPct(p: number | null): string {
  if (p == null) return "";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(1)}%`;
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

  const grandTotalWage = data?.reduce((s, c) => s + c.totalWage, 0) ?? 0;

  if (!restaurantId) return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;

  const [showExportMenu, setShowExportMenu] = useState(false);
  const [consultantMode, setConsultantMode] = useState(false);
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
  const buildRows = (consultant: boolean) => {
    if (!data) return [];
    const rows: (string | number)[][] = [];
    for (const company of data) {
      const sorted = [...company.employees].sort((a: any, b: any) => (a.isTemp ? 1 : 0) - (b.isTemp ? 1 : 0));
      for (const emp of sorted) {
        const subRemain = emp.substituteLeave ? emp.substituteLeave.remaining : "-";
        const annRemain = emp.annualLeave ? emp.annualLeave.remaining : "-";
        const subUsed = emp.substituteLeave ? emp.substituteLeave.used : 0;
        const annUsed = emp.annualLeave ? emp.annualLeave.used : 0;
        const nameLabel = emp.isNoHolidayPayWorker ? `${emp.name} (주휴미제공)` : emp.isTemp ? `${emp.name} (임시)` : emp.name;
        const wageTypeLabel = emp.wageType === "hourly" ? "시급" : emp.wageType === "monthly" ? "월급" : emp.wageType === "daily" ? "일급" : "-";
        // 재설계 2026-05-02: socialInsurance 폐기 → taxMode 박제 사용
        const insuranceLabel = emp.taxMode === "biz_income_3_3" ? "3.3%공제" : "4대보험";
        const contractStartStr = emp.contractStart ? fmtDate(emp.contractStart) : "-";
        const contractEndStr = emp.contractEnd ? fmtDate(emp.contractEnd) : "-";
        const bankNameStr = emp.bankName ?? "-";
        const hireDateStr = emp.hireDate ? fmtDate(emp.hireDate) : "-";

        if (consultant) {
          // 노무사전송용: 시스템 계산 급여 제외, 계약·근무·신원 raw data만
          rows.push([
            company.company,
            nameLabel,
            emp.position ?? "-",
            wageTypeLabel,
            emp.wageAmount ? Number(emp.wageAmount) : 0,
            insuranceLabel,
            emp.workedDays ?? 0,
            emp.daysOff ?? 0,
            emp.contractDaysOff ?? 0,
            subUsed,
            subRemain,
            annUsed,
            annRemain,
            bankNameStr,
            emp.bankAccount ?? "-",
            emp.residentNumber ?? "-",
            hireDateStr,
            contractStartStr,
            contractEndStr,
          ]);
        } else {
          // 기본 정산: 시스템 계산 결과 포함 (4대보험·원천세는 미계산)
          const wage = Math.round(emp.totalWage);
          rows.push([
            company.company,
            nameLabel,
            emp.position ?? "-",
            wageTypeLabel,
            emp.wageAmount ? Number(emp.wageAmount) : 0,
            emp.contractDaysOff ?? 0,
            emp.workedDays ?? 0,
            emp.totalHours != null ? Number((emp.totalHours).toFixed(1)) : 0,
            emp.daysOff ?? 0,
            subRemain,
            annRemain,
            insuranceLabel,
            wage,
            bankNameStr,
            emp.bankAccount ?? "-",
            emp.residentNumber ?? "-",
            hireDateStr,
            contractStartStr,
            contractEndStr,
          ]);
        }
      }
    }
    return rows;
  };

  // 헤더 (단어 단축으로 1줄 정렬) — 3.3%공제 컬럼 제거(시스템 미계산), 근무시간 컬럼 추가
  const fullHeaders = ["소속회사", "이름", "직위", "유형", "계약급여", "계약휴무", "출근일수", "근무시간", "실휴무일", "대휴잔여", "연차잔여", "보험", "인건비", "은행명", "계좌번호", "주민번호", "입사일", "계약시작", "종료"];
  const consultantHeaders = ["소속회사", "이름", "직위", "유형", "계약급여", "보험", "출근일수", "실휴무일", "계약휴무", "대휴사용", "대휴잔여", "연차사용", "연차잔여", "은행명", "계좌번호", "주민번호", "입사일", "계약시작", "종료"];
  const fileName = consultantMode
    ? `노무사전송_${year}년${month}월_${current?.name ?? ""}`
    : `인건비정산_${year}년${month}월_${current?.name ?? ""}`;

  const handleExportExcel = async () => {
    setShowExportMenu(false);
    const headers = consultantMode ? consultantHeaders : fullHeaders;
    const rows = buildRows(consultantMode);
    if (!rows.length) return;
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    // 컬럼별 폭 (consultantMode·fullMode 동일 패턴, 헤더 단축 반영)
    const colWidths = consultantMode
      // 소속회사,이름,직위,유형,계약급여,보험,출근,실휴무,계약휴무,대휴사용,대휴잔여,연차사용,연차잔여,은행명,계좌,주민,입사일,계약시작,종료
      ? [14, 10, 8, 6, 12, 8, 6, 7, 8, 7, 7, 7, 7, 10, 18, 16, 12, 12, 12]
      // 소속회사,이름,직위,유형,계약급여,계약휴무,출근,근무시간,실휴무,대휴잔여,연차잔여,보험,인건비,은행명,계좌,주민,입사일,계약시작,종료
      : [14, 10, 8, 6, 12, 8, 7, 7, 7, 7, 7, 8, 12, 10, 18, 16, 12, 12, 12];
    ws["!cols"] = colWidths.map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, consultantMode ? "노무사전송" : "인건비정산");
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
      const headers = consultantMode ? consultantHeaders : fullHeaders;
      const rows = buildRows(consultantMode);
      if (!rows.length) return;
      const { jsPDF } = await import("jspdf");
      const atModule = await import("jspdf-autotable");
      const autoTable = atModule.default || atModule.autoTable;
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      await loadKoreanFont(doc);

      // 제목
      doc.setFontSize(14);
      doc.text(`${fileName}`, 14, 15);
      doc.setFontSize(9);
      if (consultantMode) {
        // 시스템 계산 금액 노출 회피
        const totalEmployees = (data ?? []).reduce((s, c) => s + c.employees.length, 0);
        const operatingDays = (data ?? [])[0]?.operatingDays ?? "-";
        doc.text(`대상 직원 ${totalEmployees}명 / 영업일 ${operatingDays}일`, 14, 22);
      } else {
        doc.text(`합계: ${fmtWonRaw(grandTotalWage)}원`, 14, 22);
      }

      // 우측정렬 컬럼 인덱스
      const rightAlignCols: Record<number, { halign: "right" }> = {};
      const columnStyles: Record<number, any> = {};
      if (consultantMode) {
        // 계약급여(4), 출근(6), 실휴무(7), 계약휴무(8), 대휴사용(9), 대휴잔여(10), 연차사용(11), 연차잔여(12)
        [4, 6, 7, 8, 9, 10, 11, 12].forEach(i => { rightAlignCols[i] = { halign: "right" }; });
        // 폭 (mm) — A4 landscape 가용 ~281mm 기준
        // 소속회사,이름,직위,유형,계약급여,보험,출근,실휴무,계약휴무,대휴사용,대휴잔여,연차사용,연차잔여,은행명,계좌,주민,입사일,계약시작,종료
        const widths = [22, 16, 12, 12, 22, 14, 12, 12, 14, 14, 14, 12, 12, 12, 18, 24, 12, 18, 18];
        widths.forEach((w, i) => {
          columnStyles[i] = { ...(rightAlignCols[i] ?? {}), cellWidth: w };
        });
      } else {
        // 계약급여(4), 계약휴무(5), 출근일수(6), 근무시간(7), 실휴무(8), 대휴잔여(9), 연차잔여(10), 인건비(12)
        [4, 5, 6, 7, 8, 9, 10, 12].forEach(i => { rightAlignCols[i] = { halign: "right" }; });
        // 소속회사,이름,직위,유형,계약급여,계약휴무,출근,근무시간,실휴무,대휴잔여,연차잔여,보험,인건비,은행명,계좌,주민,입사일,계약시작,종료
        const widths = [20, 16, 12, 12, 20, 12, 12, 12, 12, 14, 12, 12, 22, 12, 16, 22, 12, 14, 14];
        widths.forEach((w, i) => {
          columnStyles[i] = { ...(rightAlignCols[i] ?? {}), cellWidth: w };
        });
      }

      autoTable(doc, {
        startY: 28,
        head: [headers],
        body: rows.map(r => r.map(c => String(c))),
        styles: { fontSize: 7.5, cellPadding: 1.2, font: "NanumGothic", overflow: "linebreak" },
        headStyles: { fillColor: [59, 130, 246], textColor: 255, fontSize: 7.5, font: "NanumGothic", fontStyle: "normal" },
        columnStyles,
        tableWidth: "auto",
        margin: { left: 8, right: 8 },
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
                      checked={consultantMode}
                      onChange={(e) => setConsultantMode(e.target.checked)}
                      className="rounded border-border"
                    />
                    노무사전송용 (시스템 계산 급여 제외)
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
      <div className="bg-card border border-border rounded-lg p-3 text-center">
        <div className="text-xs text-muted-foreground mb-1">총 인건비</div>
        <div className="text-base font-bold text-foreground flex items-center justify-center gap-1">
          <Wallet className="w-4 h-4 text-muted-foreground" />
          {fmtWon(grandTotalWage)}
        </div>
      </div>

      {/* 4대보험 공제 안내 (페이지 1회 표시) */}
      <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg px-3 py-2 text-[11px] text-blue-700 dark:text-blue-300">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>4대보험·원천세 공제는 노무사 정산 결과 기준이며 본 화면에 미반영입니다. 3.3% 사업소득자는 원천세(3.3%)만 별도 계산하세요.</span>
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
                    <div className="text-sm font-bold text-foreground">{fmtWon(company.totalWage)}</div>
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

/* ─── 실효 ±% 표시 ─────────────────────────────── */
function EffSpan({ label, eff, guide }: { label: string; eff: number | null; guide: number | null }) {
  if (eff == null) return <span className="text-muted-foreground">{label} -</span>;
  const p = pctDiff(eff, guide);
  const pColor = p == null ? "" : p > 0 ? "text-emerald-600 dark:text-emerald-400" : p < 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground";
  return (
    <span>
      {label} <b className="text-foreground">{fmtWon(eff)}</b>
      {p != null && <span className={`ml-0.5 ${pColor}`}>({fmtPct(p)})</span>}
    </span>
  );
}

/* ─── 직원 행 컴포넌트 (점진적 공개) ─────────────────────────────── */
function EmployeeRow({ emp, restaurantId }: { emp: any; restaurantId: number }) {
  const utils = trpc.useUtils();
  const updateTempInfo = trpc.schedules.updateTempWorkerInfo.useMutation({
    onSuccess() { utils.schedules.laborCostByCompany.invalidate(); },
  });
  const [expanded, setExpanded] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
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

  const badge = wageTypeBadge(emp);
  const wb = emp.wageBreakdown ?? { base: Math.round(emp.totalWage ?? 0), weeklyHoliday: 0, overtime: 0, night: 0 };
  const isHourly = emp.wageType === "hourly";
  const hourlyRate = isHourly ? Number(emp.wageAmount) : NaN;
  const totalWage = Math.round(emp.totalWage ?? 0);

  // 메타 요약 1줄
  const metaParts: string[] = [];
  if (!emp.isTemp) {
    if (emp.substituteLeave) {
      metaParts.push(`대휴 ${emp.substituteLeave.remaining}일 잔여`);
    }
    if (emp.contractDaysOff != null || emp.daysOff != null) {
      metaParts.push(`휴무 ${emp.contractDaysOff ?? 0}/${emp.daysOff ?? 0}일`);
    }
    const cs = emp.monthlyContractStart ?? emp.contractStart;
    const ce = emp.monthlyContractEnd ?? emp.contractEnd;
    if (cs) {
      metaParts.push(`계약 ${fmtDate(cs)}~${ce ? fmtDate(ce) : ""}`);
    }
  }

  return (
    <div className={`px-4 py-2.5 ${emp.recheckRequired ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}>
      {/* ── 기본 행: 이름 · 유형 · 근무 · 총액 ── */}
      <div
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold text-foreground">{emp.name}</span>
          {emp.position && <span className="text-[10px] text-muted-foreground">({emp.position})</span>}
          {badge && (
            <span className="text-[9px] bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded font-medium">
              {badge}
            </span>
          )}
          {emp.recheckRequired && <AlertTriangle className="w-3 h-3 text-amber-500" />}
          {emp.monthlyContractMissing && (
            <span className="text-[9px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
              <AlertTriangle className="w-2.5 h-2.5" /> 계약 미연결
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">
            {emp.workedDays ?? 0}일{(emp.totalHours ?? 0) > 0 && ` · ${emp.totalHours.toFixed(1)}h`}
          </span>
        </div>
        <div className="text-right shrink-0">
          <span className="text-sm font-bold text-foreground">{fmtWon(totalWage)}</span>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </div>

      {/* 0원 이유 안내 */}
      {emp.zeroWageReason && (
        <div className="flex items-center gap-1.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded px-2.5 py-1.5 text-[11px] text-red-600 dark:text-red-400 mt-2">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>인건비 0원 — {emp.zeroWageReason}</span>
        </div>
      )}

      {/* ── 펼침 시: 상세 정보 ── */}
      {expanded && (
        <div className="mt-2 space-y-2">
          {/* 급여 내역 */}
          <div className="text-[11px] grid grid-cols-3 gap-x-3 gap-y-1 pt-2 border-t border-border/30">
            {isHourly && (
              <div>
                <span className="text-muted-foreground">시급</span>
                <div className="font-medium text-foreground">
                  {isFinite(hourlyRate) && hourlyRate > 0 ? fmtWon(hourlyRate) : "-"}
                </div>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">{isHourly ? "시간×시급" : "기본급"}</span>
              <div className="font-medium text-foreground">{fmtWon(wb.base)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">주휴</span>
              <div className="font-medium">
                {(wb.weeklyHoliday ?? 0) > 0
                  ? <span className="text-foreground">{fmtWon(wb.weeklyHoliday)}</span>
                  : <span className="text-muted-foreground">포함</span>}
              </div>
            </div>
            <div className="col-span-3 flex items-center justify-between border-t border-border/30 pt-1">
              <span className="text-muted-foreground">합계</span>
              <span className="font-bold text-foreground">{fmtWon(totalWage)}</span>
            </div>
          </div>

          {/* 가이드/실효 비교 (옵션) */}
          {emp.wageType === "monthly" && (
            <div>
              <button
                onClick={() => setShowComparison(!showComparison)}
                className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
              >
                {showComparison ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                가이드/실효 비교
              </button>
              {showComparison && (
                <div className="text-[11px] mt-1 space-y-1">
                  <div className="text-muted-foreground">
                    가이드: 시급 {fmtWon(emp.guideHourly)} · 일급 {fmtWon(emp.guideDaily)} · 월급 {fmtWon(emp.guideMonthly)}
                  </div>
                  <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                    <EffSpan label="실효 시급" eff={emp.effectiveHourly} guide={emp.guideHourly} />
                    <EffSpan label="실효 일급" eff={emp.effectiveDaily} guide={emp.guideDaily} />
                    <EffSpan label="실효 월급" eff={emp.effectiveMonthly} guide={emp.guideMonthly} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 메타 요약 (1줄) */}
          {!emp.isTemp && metaParts.length > 0 && (
            <div className="text-[10px] text-muted-foreground pt-2 border-t border-border/30">
              {metaParts.join(" · ")}
            </div>
          )}

          {/* 임시직 근무 요약 */}
          {emp.isTemp && (
            <div className="text-[10px] text-muted-foreground pt-2 border-t border-border/30">
              출근 {emp.workedDays ?? 0}일 · 실휴무 {emp.daysOff ?? 0}일
            </div>
          )}

          {/* 계약 이력 */}
          {!emp.isTemp && emp.contractHistory && emp.contractHistory.length > 0 && (
            <ContractHistoryToggle history={emp.contractHistory} />
          )}

          {/* 계좌/민감정보 (토글) */}
          <div className="pt-2 border-t border-border/30">
            {!emp.isTemp ? (
              (emp.bankAccount || emp.bankName || emp.residentNumber) ? (
                <div>
                  <button
                    onClick={() => setShowAccount(!showAccount)}
                    className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                  >
                    {showAccount ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    계좌·주민번호
                  </button>
                  {showAccount && (
                    <div className="grid grid-cols-2 gap-x-3 text-xs mt-1">
                      <div>
                        <span className="text-muted-foreground">계좌번호</span>
                        <div className="font-medium text-foreground">
                          {emp.bankName ? <span className="text-muted-foreground mr-1">{emp.bankName}</span> : null}
                          {emp.bankAccount || "-"}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">주민번호</span>
                        <div className="font-medium text-foreground">{emp.residentNumber || "-"}</div>
                      </div>
                    </div>
                  )}
                </div>
              ) : null
            ) : (
              /* 임시직: 계좌/연락처 인라인 편집 (기존 유지) */
              <div className="text-xs">
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}


/* ─── 계약 이력 토글 ─────────────────────────────── */
function ContractHistoryToggle({ history }: { history: Array<{ contractStart: string; contractEnd: string | null; signedAt: string | null }> }) {
  const [open, setOpen] = useState(false);
  // 시간순 정렬 (오래된 순 → 최신 순)
  const sorted = [...history].sort((a, b) => a.contractStart.localeCompare(b.contractStart));
  return (
    <div className="text-[10px]">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-muted-foreground hover:text-foreground flex items-center gap-0.5 px-1 py-0.5 rounded hover:bg-accent"
      >
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        계약 이력 {history.length}건
      </button>
      {open && (
        <ul className="mt-1 pl-3 space-y-0.5 text-muted-foreground">
          {sorted.map((r, i) => (
            <li key={i}>
              {fmtDate(r.contractStart)} ~ {fmtDate(r.contractEnd)}
              {r.signedAt && (
                <span className="ml-1 text-muted-foreground/70">(서명 {fmtDate(r.signedAt.slice(0, 10))})</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── 대체휴무 관리 섹션 ─────────────────────────────── */
function LeaveSummarySection({ restaurantId, year, month }: { restaurantId: number; year: number; month: number }) {
  const [open, setOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<{ userId: number; userName: string } | null>(null);
  const [adjType, setAdjType] = useState<"earn" | "use">("earn");
  const [adjDate, setAdjDate] = useState("");
  const [adjDays, setAdjDays] = useState("1");
  const [adjNote, setAdjNote] = useState("");
  const [historyTarget, setHistoryTarget] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const invalidateAll = () => {
    utils.leaveBalance.detectHolidayWork.invalidate();
    utils.leaveBalance.storeSummary.invalidate();
    utils.leaveBalance.storeSubstituteTransactions.invalidate();
  };

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

  // 대체휴무 이력 (편집용)
  const { data: txs } = trpc.leaveBalance.storeSubstituteTransactions.useQuery(
    { restaurantId, year },
    { enabled: restaurantId > 0 && open },
  );

  const earnMut = trpc.leaveBalance.earnSubstitute.useMutation({ onSuccess: invalidateAll });
  const cancelMut = trpc.leaveBalance.cancelEarnSubstitute.useMutation({ onSuccess: invalidateAll });
  const adjustMut = trpc.leaveBalance.adjustSubstitute.useMutation({
    onSuccess: () => {
      invalidateAll();
      setAdjustTarget(null);
      setAdjType("earn");
      setAdjDate("");
      setAdjDays("1");
      setAdjNote("");
    },
  });
  const deleteMut = trpc.leaveBalance.deleteSubstituteTransaction.useMutation({ onSuccess: invalidateAll });

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
          <div className="text-sm font-semibold text-foreground">대체휴무 관리</div>
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

          {/* ── 2. 연간 잔여 현황 (대체휴무) ── */}
          {hasSummary && (
            <div className={hasHolidayWork ? "border-t border-border" : ""}>
              <div className="px-3 pt-3 pb-1 text-xs font-semibold text-muted-foreground flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <CalendarDays className="w-3 h-3" /> {year}년 대체휴무 잔여 현황
                </span>
                <span className="text-[10px] font-normal text-muted-foreground">점장 임의 편집 가능</span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">이름</th>
                    <th className="text-center px-1 py-1.5 text-[10px] text-muted-foreground font-normal">발생</th>
                    <th className="text-center px-1 py-1.5 text-[10px] text-muted-foreground font-normal">사용</th>
                    <th className="text-center px-1 py-1.5 text-[10px] text-muted-foreground font-normal">잔여</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {summary!.map((emp) => (
                    <Fragment key={emp.userId}>
                      <tr className="border-t border-border/50">
                        <td className="px-3 py-2">
                          <div className="font-medium text-foreground flex items-center gap-1">
                            {emp.userName}
                            {!emp.is5Plus && (
                              <span className="text-[9px] text-muted-foreground bg-muted px-1 rounded">5인↓</span>
                            )}
                          </div>
                        </td>
                        <td className="text-center px-1 py-2 text-muted-foreground">{emp.substitute.earned}</td>
                        <td className="text-center px-1 py-2 text-muted-foreground">{emp.substitute.used}</td>
                        <td className={`text-center px-1 py-2 font-medium ${emp.substitute.remaining > 0 ? "text-blue-600" : "text-muted-foreground"}`}>
                          {emp.substitute.remaining}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5 justify-end">
                            <button
                              onClick={() => {
                                setAdjustTarget({ userId: emp.userId, userName: emp.userName });
                                setAdjType("earn");
                                setAdjDate(`${year}-${String(month).padStart(2, "0")}-01`);
                                setAdjDays("1");
                                setAdjNote("");
                              }}
                              className="text-[10px] text-blue-600 hover:underline whitespace-nowrap flex items-center gap-0.5"
                              title="대체휴무 임의 조정"
                            >
                              <Edit3 className="w-3 h-3" /> 조정
                            </button>
                            <button
                              onClick={() => setHistoryTarget(historyTarget === emp.userId ? null : emp.userId)}
                              className="text-[10px] text-muted-foreground hover:text-foreground whitespace-nowrap"
                            >
                              {historyTarget === emp.userId ? "이력닫기" : "이력"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {historyTarget === emp.userId && (
                        <tr className="bg-muted/10">
                          <td colSpan={5} className="px-3 py-2">
                            <SubstituteHistoryRows
                              txs={(txs ?? []).filter((t) => t.userId === emp.userId)}
                              onDelete={(transactionId) => {
                                if (!confirm("이 이력을 삭제하시겠습니까?")) return;
                                deleteMut.mutate({ transactionId, restaurantId });
                              }}
                              isDeleting={deleteMut.isPending}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── 3. 임의 조정 입력 (인라인) ── */}
          {adjustTarget && (
            <div className="border-t border-border p-3 bg-muted/20 space-y-2">
              <div className="text-xs font-semibold text-foreground">
                {adjustTarget.userName} — 대체휴무 임의 조정
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={adjType}
                  onChange={(e) => setAdjType(e.target.value as "earn" | "use")}
                  className="text-xs border border-border rounded px-2 py-1.5 bg-background text-foreground"
                >
                  <option value="earn">발생 (+)</option>
                  <option value="use">사용 (−)</option>
                </select>
                <input
                  type="date"
                  value={adjDate}
                  onChange={(e) => setAdjDate(e.target.value)}
                  className="text-xs border border-border rounded px-2 py-1.5 bg-background text-foreground flex-1 min-w-[130px]"
                  placeholder="날짜"
                />
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="31"
                  value={adjDays}
                  onChange={(e) => setAdjDays(e.target.value)}
                  className="text-xs border border-border rounded px-2 py-1.5 bg-background text-foreground w-20"
                  placeholder="일수"
                />
              </div>
              <input
                type="text"
                value={adjNote}
                onChange={(e) => setAdjNote(e.target.value)}
                className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background text-foreground"
                placeholder="메모 (선택) — 예: 5/1 근로자의날 대체"
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="default"
                  className="text-xs h-7"
                  disabled={!adjDate || !adjDays || adjustMut.isPending}
                  onClick={() => {
                    const days = parseFloat(adjDays);
                    if (!isFinite(days) || days <= 0) return;
                    adjustMut.mutate({
                      userId: adjustTarget.userId,
                      restaurantId,
                      txType: adjType,
                      date: adjDate,
                      days,
                      note: adjNote || undefined,
                    });
                  }}
                >
                  {adjustMut.isPending ? "처리중..." : "저장"}
                </Button>
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setAdjustTarget(null)}>
                  취소
                </Button>
                {adjustMut.error && (
                  <span className="text-xs text-red-500">{adjustMut.error.message}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── 대체휴무 이력 행 ─────────────────────────────── */
function SubstituteHistoryRows({
  txs,
  onDelete,
  isDeleting,
}: {
  txs: Array<{
    id: number;
    txType: string;
    days: string;
    holidayDate: string | null;
    holidayName: string | null;
    useDate: string | null;
    note: string | null;
  }>;
  onDelete: (id: number) => void;
  isDeleting: boolean;
}) {
  if (txs.length === 0) {
    return <div className="text-[11px] text-muted-foreground">등록된 이력이 없습니다.</div>;
  }
  return (
    <div className="space-y-1">
      {txs.map((tx) => {
        const date = tx.txType === "earn" ? tx.holidayDate : tx.useDate;
        const sign = tx.txType === "earn" ? "+" : "−";
        const color = tx.txType === "earn" ? "text-blue-600" : "text-rose-600";
        return (
          <div key={tx.id} className="flex items-center gap-2 text-[11px]">
            <span className={`font-semibold ${color} w-12`}>{sign}{tx.days}일</span>
            <span className="text-foreground w-24">{date ?? "-"}</span>
            <span className="text-muted-foreground flex-1 truncate">
              {tx.holidayName ? `${tx.holidayName}` : ""}
              {tx.note ? ` · ${tx.note}` : ""}
            </span>
            <button
              onClick={() => onDelete(tx.id)}
              disabled={isDeleting}
              className="text-muted-foreground hover:text-red-500 transition-colors"
              title="이력 삭제"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
