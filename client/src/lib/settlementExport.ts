import { loadKoreanFont } from "@/lib/pdfKoreanFont";

type SettlementData = any; // trpc 반환 타입 — 서버 스키마와 동일

const FIXED_TYPE_LABEL: Record<string, string> = {
  monthly: "월납",
  yearly: "연납÷12",
  quarterly: "분기÷3",
  sales_ratio: "매출비례",
  one_time: "일시",
};
const fixedTypeLabel = (t: string) => FIXED_TYPE_LABEL[t] ?? "일시";

const fmtKRW = (n: number) => Math.round(n).toLocaleString("ko-KR");
const fmtPct = (n: number | string) => (typeof n === "number" ? n.toFixed(1) : n);
const pctOfSales = (amount: number, salesTotal: number) =>
  salesTotal > 0 ? Number((amount / salesTotal * 100).toFixed(1)) : 0;
const fmtDateTime = (s: string | Date | null) => {
  if (!s) return "";
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").trim();

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface ExportContext {
  restaurantName: string;
  year: number;
  month: number;
  data: SettlementData;
}

function buildFileBase({ restaurantName, year, month, data }: ExportContext) {
  const tag = data.closing?.isClosed ? "" : "(미확정)";
  return sanitize(`월정산_${restaurantName}_${year}년${month}월${tag}`);
}

// 숫자 셀 서식 적용 (시트 단위, 헤더 1행 제외)
function applyNumFmt(ws: any, colIndexes: number[], fmt = "#,##0") {
  const ref = ws["!ref"];
  if (!ref) return;
  const range = /^[A-Z]+\d+:([A-Z]+)(\d+)$/.exec(ref);
  if (!range) return;
  const rows = parseInt(range[2], 10);
  for (const ci of colIndexes) {
    for (let r = 1; r <= rows; r++) {
      const addr = String.fromCharCode(65 + ci) + (r + 1);
      const cell = ws[addr];
      if (cell && cell.t === "n") cell.z = fmt;
    }
  }
}

// ── Excel ────────────────────────────────────────────────
export async function exportSettlementExcel(ctx: ExportContext) {
  const { year, month, restaurantName, data } = ctx;
  const XLSX = await import("xlsx");
  const { income, metrics, collection, unconfirmed, prevMonth, closing } = data;

  const wb = XLSX.utils.book_new();

  // ── 시트 1: 요약 ──
  const statusLabel = closing?.isClosed ? "확정" : "미확정";
  const summaryAoa: any[][] = [
    [`${year}년 ${month}월 월정산`],
    ["매장", restaurantName],
    ["상태", statusLabel],
    ["확정자", closing?.closedByName ?? ""],
    ["확정일시", fmtDateTime(closing?.closedAt ?? null)],
    [],
  ];

  if (!closing?.isClosed) {
    summaryAoa.push(["⚠ 미확정 파일", `일마감 ${collection.closedDays}/${collection.operatingDays}일 — 미반영 매출·매입·인건비는 아래 표에서 별도 표기`]);
    summaryAoa.push([]);
  }

  summaryAoa.push(["[손익 — 확정분]"]);
  summaryAoa.push(["항목", "금액(원)", "비율(%)"]);
  summaryAoa.push(["매출", income.salesTotal, 100]);
  summaryAoa.push(["매입(식재료비)", income.purchasesTotal, Number(metrics.costRatio) || 0]);
  summaryAoa.push(["인건비", income.laborCost, Number(metrics.laborRatio) || 0]);
  summaryAoa.push(["고정비", income.fixedCostsTotal, income.salesTotal > 0 ? Number((income.fixedCostsTotal / income.salesTotal * 100).toFixed(1)) : 0]);
  summaryAoa.push(["즉시 지출", income.expensesTotal, income.salesTotal > 0 ? Number((income.expensesTotal / income.salesTotal * 100).toFixed(1)) : 0]);
  summaryAoa.push(["순이익", income.profit, Number(metrics.profitRatio) || 0]);
  summaryAoa.push([]);

  summaryAoa.push(["[미반영분 — 일마감 미완료]"]);
  summaryAoa.push(["항목", "금액(원)"]);
  summaryAoa.push(["미반영 매출", unconfirmed.salesTotal]);
  summaryAoa.push(["미반영 매입", unconfirmed.purchasesTotal]);
  summaryAoa.push(["미반영 인건비", unconfirmed.laborCost]);
  summaryAoa.push(["미마감일수", unconfirmed.unclosedDays]);
  summaryAoa.push([]);

  if (prevMonth) {
    const delta = (curr: number, prev: number) => prev === 0 ? 0 : Number(((curr - prev) / prev * 100).toFixed(1));
    summaryAoa.push(["[전월 대비]"]);
    summaryAoa.push(["항목", "당월(원)", "전월(원)", "증감률(%)"]);
    summaryAoa.push(["매출", income.salesTotal, prevMonth.salesTotal, delta(income.salesTotal, prevMonth.salesTotal)]);
    summaryAoa.push(["매입", income.purchasesTotal, prevMonth.purchasesTotal, delta(income.purchasesTotal, prevMonth.purchasesTotal)]);
    summaryAoa.push(["인건비", income.laborCost, prevMonth.laborCost, delta(income.laborCost, prevMonth.laborCost)]);
    summaryAoa.push(["고정비", income.fixedCostsTotal, prevMonth.fixedCostsTotal, delta(income.fixedCostsTotal, prevMonth.fixedCostsTotal)]);
    summaryAoa.push(["순이익", income.profit, prevMonth.profit, delta(income.profit, prevMonth.profit)]);
    summaryAoa.push([]);
  }

  summaryAoa.push(["[운영 지표]"]);
  summaryAoa.push(["일평균 매출(원)", metrics.dailyAvgSales]);
  if (metrics.targetSales > 0) {
    summaryAoa.push(["월 목표 매출(원)", metrics.targetSales]);
    summaryAoa.push(["목표 달성률(%)", Number((income.salesTotal / metrics.targetSales * 100).toFixed(1))]);
  }
  if (metrics.targetCostRatio > 0) summaryAoa.push(["목표 매입비율(%)", metrics.targetCostRatio]);
  if (metrics.targetLaborRatio > 0) summaryAoa.push(["목표 인건비율(%)", metrics.targetLaborRatio]);
  summaryAoa.push([]);

  summaryAoa.push(["[수집 현황]"]);
  summaryAoa.push(["영업일", collection.operatingDays]);
  summaryAoa.push(["일마감 완료일", collection.closedDays]);
  summaryAoa.push(["미마감 날짜", (collection.unclosedDates ?? []).join(", ")]);
  summaryAoa.push(["매출 입력 누락일", (collection.salesMissingDates ?? []).join(", ")]);
  summaryAoa.push(["매입 건수", collection.purchaseCount]);
  summaryAoa.push(["매입 대기(ordered)", collection.purchasePendingCount]);
  summaryAoa.push(["스케줄 draft", collection.draftScheduleCount]);
  summaryAoa.push(["고정비 항목 수", collection.fixedCostCount]);

  const ws1 = XLSX.utils.aoa_to_sheet(summaryAoa);
  ws1["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws1, "요약");

  // ── 시트 2: 매출(결제수단별) ──
  const sbm = income.salesByMethod ?? {};
  const salesAoa: any[][] = [
    ["결제수단", "금액(원)", "비율(%)"],
    ["카드", sbm.card ?? 0, income.salesTotal > 0 ? Number(((sbm.card ?? 0) / income.salesTotal * 100).toFixed(1)) : 0],
    ["현금", sbm.cash ?? 0, income.salesTotal > 0 ? Number(((sbm.cash ?? 0) / income.salesTotal * 100).toFixed(1)) : 0],
    ["상품권", sbm.giftCard ?? 0, income.salesTotal > 0 ? Number(((sbm.giftCard ?? 0) / income.salesTotal * 100).toFixed(1)) : 0],
    ["계좌이체", sbm.transfer ?? 0, income.salesTotal > 0 ? Number(((sbm.transfer ?? 0) / income.salesTotal * 100).toFixed(1)) : 0],
    ["기타", sbm.other ?? 0, income.salesTotal > 0 ? Number(((sbm.other ?? 0) / income.salesTotal * 100).toFixed(1)) : 0],
    ["합계", income.salesTotal, 100],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(salesAoa);
  ws2["!cols"] = [{ wch: 14 }, { wch: 16 }, { wch: 12 }];
  applyNumFmt(ws2, [1], "#,##0");
  applyNumFmt(ws2, [2], "0.0");
  XLSX.utils.book_append_sheet(wb, ws2, "매출");

  // ── 시트 3: 매입 ──
  const purchAoa: any[][] = [["거래처", "건수", "금액(원)", "매출대비(%)"]];
  for (const cp of income.purchasesByCounterparty) {
    purchAoa.push([cp.name, cp.count, cp.amount, pctOfSales(cp.amount, income.salesTotal)]);
  }
  purchAoa.push([
    "합계",
    income.purchasesByCounterparty.reduce((s: number, c: any) => s + c.count, 0),
    income.purchasesTotal,
    pctOfSales(income.purchasesTotal, income.salesTotal),
  ]);
  const ws3 = XLSX.utils.aoa_to_sheet(purchAoa);
  ws3["!cols"] = [{ wch: 24 }, { wch: 8 }, { wch: 16 }, { wch: 12 }];
  applyNumFmt(ws3, [2], "#,##0");
  applyNumFmt(ws3, [3], "0.0");
  XLSX.utils.book_append_sheet(wb, ws3, "매입");

  // ── 시트 4: 인건비 ──
  const laborAoa: any[][] = [["소속회사", "인원", "시간(h)", "금액(원)", "매출대비(%)"]];
  for (const co of income.laborByCompany) {
    laborAoa.push([co.company, co.headcount, co.hours, co.amount, pctOfSales(co.amount, income.salesTotal)]);
  }
  laborAoa.push([
    "합계",
    income.laborByCompany.reduce((s: number, c: any) => s + c.headcount, 0),
    Number(income.laborByCompany.reduce((s: number, c: any) => s + c.hours, 0).toFixed(1)),
    income.laborCost,
    pctOfSales(income.laborCost, income.salesTotal),
  ]);
  const ws4 = XLSX.utils.aoa_to_sheet(laborAoa);
  ws4["!cols"] = [{ wch: 16 }, { wch: 8 }, { wch: 10 }, { wch: 16 }, { wch: 12 }];
  applyNumFmt(ws4, [2], "0.0");
  applyNumFmt(ws4, [3], "#,##0");
  applyNumFmt(ws4, [4], "0.0");
  XLSX.utils.book_append_sheet(wb, ws4, "인건비");

  // ── 시트 5: 고정비 ──
  const fixedAoa: any[][] = [["항목", "유형", "원비율(%)", "금액(원)", "매출대비(%)"]];
  for (const f of income.fixedBreakdown) {
    fixedAoa.push([f.name, fixedTypeLabel(f.type), f.ratio ?? "", f.amount, pctOfSales(f.amount, income.salesTotal)]);
  }
  fixedAoa.push(["합계", "", "", income.fixedCostsTotal, pctOfSales(income.fixedCostsTotal, income.salesTotal)]);
  const ws5 = XLSX.utils.aoa_to_sheet(fixedAoa);
  ws5["!cols"] = [{ wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 12 }];
  applyNumFmt(ws5, [2], "0.0");
  applyNumFmt(ws5, [3], "#,##0");
  applyNumFmt(ws5, [4], "0.0");
  XLSX.utils.book_append_sheet(wb, ws5, "고정비");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  triggerDownload(blob, `${buildFileBase(ctx)}.xlsx`);
}

// ── PDF ──────────────────────────────────────────────────
export async function exportSettlementPDF(ctx: ExportContext) {
  const { year, month, restaurantName, data } = ctx;
  const { jsPDF } = await import("jspdf");
  const atModule = await import("jspdf-autotable");
  const autoTable = (atModule as any).default || (atModule as any).autoTable;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await loadKoreanFont(doc);

  const { income, metrics, collection, unconfirmed, prevMonth, closing } = data;
  const statusLabel = closing?.isClosed ? "확정" : "미확정";

  doc.setFontSize(14);
  doc.text(`${year}년 ${month}월 월정산 (${statusLabel})`, 14, 15);
  doc.setFontSize(9);
  const meta: string[] = [
    `매장: ${restaurantName}`,
    `일마감 ${collection.closedDays}/${collection.operatingDays}일`,
  ];
  if (closing?.closedByName) meta.push(`확정자: ${closing.closedByName}`);
  if (closing?.closedAt) meta.push(`확정일시: ${fmtDateTime(closing.closedAt)}`);
  doc.text(meta.join(" | "), 14, 22);

  const commonStyles = { fontSize: 9, cellPadding: 2.5, font: "NanumGothic" };
  const headPrimary = { fillColor: [59, 130, 246] as [number, number, number], textColor: 255, font: "NanumGothic", fontStyle: "normal" };
  const headSub = { fillColor: [100, 116, 139] as [number, number, number], textColor: 255, font: "NanumGothic", fontStyle: "normal" };
  const tableBase = {
    styles: commonStyles,
    rowPageBreak: "avoid" as const,
    margin: { left: 14, right: 14 },
  };

  // 손익
  autoTable(doc, {
    ...tableBase,
    startY: 27,
    head: [["항목", "금액(원)", "비율(%)"]],
    body: [
      ["매출", fmtKRW(income.salesTotal), "100.0"],
      ["매입(식재료비)", fmtKRW(income.purchasesTotal), fmtPct(metrics.costRatio)],
      ["인건비", fmtKRW(income.laborCost), fmtPct(metrics.laborRatio)],
      ["고정비", fmtKRW(income.fixedCostsTotal), income.salesTotal > 0 ? (income.fixedCostsTotal / income.salesTotal * 100).toFixed(1) : "0.0"],
      ["즉시 지출", fmtKRW(income.expensesTotal), income.salesTotal > 0 ? (income.expensesTotal / income.salesTotal * 100).toFixed(1) : "0.0"],
      ["순이익", fmtKRW(income.profit), fmtPct(metrics.profitRatio)],
    ],
    headStyles: headPrimary,
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
  });
  let finalY = (doc as any).lastAutoTable?.finalY ?? 70;

  const section = (title: string) => {
    if (finalY > 260) { doc.addPage(); finalY = 15; }
    doc.setFontSize(11);
    doc.text(title, 14, finalY + 8);
  };

  // 미반영분
  if (!closing?.isClosed && (unconfirmed.salesTotal || unconfirmed.purchasesTotal || unconfirmed.laborCost)) {
    section("미반영분 (일마감 미완료)");
    autoTable(doc, {
      ...tableBase,
      startY: finalY + 11,
      head: [["항목", "금액(원)"]],
      body: [
        ["미반영 매출", fmtKRW(unconfirmed.salesTotal)],
        ["미반영 매입", fmtKRW(unconfirmed.purchasesTotal)],
        ["미반영 인건비", fmtKRW(unconfirmed.laborCost)],
        ["미마감일수", String(unconfirmed.unclosedDays)],
      ],
      headStyles: headSub,
      columnStyles: { 1: { halign: "right" } },
    });
    finalY = (doc as any).lastAutoTable?.finalY ?? finalY + 40;
  }

  // 매출 구성
  const sbm = income.salesByMethod ?? {};
  if (income.salesTotal > 0) {
    section("매출 구성(결제수단별)");
    autoTable(doc, {
      ...tableBase,
      startY: finalY + 11,
      head: [["결제수단", "금액(원)", "비율(%)"]],
      body: [
        ["카드", fmtKRW(sbm.card ?? 0), ((sbm.card ?? 0) / income.salesTotal * 100).toFixed(1)],
        ["현금", fmtKRW(sbm.cash ?? 0), ((sbm.cash ?? 0) / income.salesTotal * 100).toFixed(1)],
        ["상품권", fmtKRW(sbm.giftCard ?? 0), ((sbm.giftCard ?? 0) / income.salesTotal * 100).toFixed(1)],
        ["계좌이체", fmtKRW(sbm.transfer ?? 0), ((sbm.transfer ?? 0) / income.salesTotal * 100).toFixed(1)],
        ["기타", fmtKRW(sbm.other ?? 0), ((sbm.other ?? 0) / income.salesTotal * 100).toFixed(1)],
      ],
      headStyles: headSub,
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
    });
    finalY = (doc as any).lastAutoTable?.finalY ?? finalY + 40;
  }

  // 매입
  if (income.purchasesByCounterparty.length > 0) {
    section("거래처별 매입");
    const purchCount = income.purchasesByCounterparty.reduce((s: number, c: any) => s + c.count, 0);
    autoTable(doc, {
      ...tableBase,
      startY: finalY + 11,
      head: [["거래처", "건수", "금액(원)", "매출대비(%)"]],
      body: income.purchasesByCounterparty.map((cp: any) => [
        cp.name,
        cp.count,
        fmtKRW(cp.amount),
        pctOfSales(cp.amount, income.salesTotal).toFixed(1),
      ]),
      foot: [[
        "합계",
        String(purchCount),
        fmtKRW(income.purchasesTotal),
        pctOfSales(income.purchasesTotal, income.salesTotal).toFixed(1),
      ]],
      headStyles: headSub,
      footStyles: { fillColor: [226, 232, 240] as [number, number, number], textColor: 20, font: "NanumGothic", fontStyle: "normal" },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    });
    finalY = (doc as any).lastAutoTable?.finalY ?? finalY + 30;
  }

  // 인건비
  if (income.laborByCompany.length > 0) {
    section("소속회사별 인건비");
    const laborHeadcount = income.laborByCompany.reduce((s: number, c: any) => s + c.headcount, 0);
    const laborHours = income.laborByCompany.reduce((s: number, c: any) => s + c.hours, 0);
    autoTable(doc, {
      ...tableBase,
      startY: finalY + 11,
      head: [["소속회사", "인원", "시간(h)", "금액(원)", "매출대비(%)"]],
      body: income.laborByCompany.map((co: any) => [
        co.company,
        co.headcount,
        co.hours.toFixed(1),
        fmtKRW(co.amount),
        pctOfSales(co.amount, income.salesTotal).toFixed(1),
      ]),
      foot: [[
        "합계",
        String(laborHeadcount),
        laborHours.toFixed(1),
        fmtKRW(income.laborCost),
        pctOfSales(income.laborCost, income.salesTotal).toFixed(1),
      ]],
      headStyles: headSub,
      footStyles: { fillColor: [226, 232, 240] as [number, number, number], textColor: 20, font: "NanumGothic", fontStyle: "normal" },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    });
    finalY = (doc as any).lastAutoTable?.finalY ?? finalY + 30;
  }

  // 고정비
  if (income.fixedBreakdown.length > 0) {
    section("고정비 내역");
    autoTable(doc, {
      ...tableBase,
      startY: finalY + 11,
      head: [["항목", "유형", "원비율(%)", "금액(원)", "매출대비(%)"]],
      body: income.fixedBreakdown.map((f: any) => [
        f.name,
        fixedTypeLabel(f.type),
        f.ratio != null ? f.ratio.toFixed(1) : "",
        fmtKRW(f.amount),
        pctOfSales(f.amount, income.salesTotal).toFixed(1),
      ]),
      foot: [[
        "합계",
        "",
        "",
        fmtKRW(income.fixedCostsTotal),
        pctOfSales(income.fixedCostsTotal, income.salesTotal).toFixed(1),
      ]],
      headStyles: headSub,
      footStyles: { fillColor: [226, 232, 240] as [number, number, number], textColor: 20, font: "NanumGothic", fontStyle: "normal" },
      columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    });
    finalY = (doc as any).lastAutoTable?.finalY ?? finalY + 30;
  }

  // 전월 대비
  if (prevMonth) {
    section("전월 대비");
    const deltaCell = (curr: number, prev: number) => prev === 0 ? "-" : `${((curr - prev) / prev * 100).toFixed(1)}%`;
    autoTable(doc, {
      ...tableBase,
      startY: finalY + 11,
      head: [["항목", "당월", "전월", "증감"]],
      body: [
        ["매출", fmtKRW(income.salesTotal), fmtKRW(prevMonth.salesTotal), deltaCell(income.salesTotal, prevMonth.salesTotal)],
        ["매입", fmtKRW(income.purchasesTotal), fmtKRW(prevMonth.purchasesTotal), deltaCell(income.purchasesTotal, prevMonth.purchasesTotal)],
        ["인건비", fmtKRW(income.laborCost), fmtKRW(prevMonth.laborCost), deltaCell(income.laborCost, prevMonth.laborCost)],
        ["고정비", fmtKRW(income.fixedCostsTotal), fmtKRW(prevMonth.fixedCostsTotal), deltaCell(income.fixedCostsTotal, prevMonth.fixedCostsTotal)],
        ["순이익", fmtKRW(income.profit), fmtKRW(prevMonth.profit), deltaCell(income.profit, prevMonth.profit)],
      ],
      headStyles: headSub,
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    });
    finalY = (doc as any).lastAutoTable?.finalY ?? finalY + 30;
  }

  // 수집 현황
  section("수집 현황");
  const collRows: any[][] = [
    ["영업일", String(collection.operatingDays)],
    ["일마감 완료일", String(collection.closedDays)],
    ["매입 건수 (대기/전체)", `${collection.purchasePendingCount} / ${collection.purchaseCount}`],
    ["스케줄 draft", String(collection.draftScheduleCount)],
    ["고정비 항목 수", String(collection.fixedCostCount)],
  ];
  if ((collection.unclosedDates ?? []).length > 0) collRows.push(["미마감 날짜", collection.unclosedDates.join(", ")]);
  if ((collection.salesMissingDates ?? []).length > 0) collRows.push(["매출 입력 누락일", collection.salesMissingDates.join(", ")]);
  autoTable(doc, {
    ...tableBase,
    startY: finalY + 11,
    head: [["항목", "값"]],
    body: collRows,
    headStyles: headSub,
  });

  const blob = doc.output("blob");
  triggerDownload(blob, `${buildFileBase(ctx)}.pdf`);
}
