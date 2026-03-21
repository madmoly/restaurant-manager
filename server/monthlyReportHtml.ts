/**
 * 월별 정산 리포트 HTML 생성 헬퍼
 * 매출·매입·고정비·인건비·순이익을 A4 PDF로 출력하기 위한 HTML을 생성합니다.
 */

export interface MonthlyReportData {
  restaurantName: string;
  year: number;
  month: number;
  salesTotal: number;
  purchasesTotal: number;
  fixedCostsTotal: number;
  laborCost: number;
  totalCost: number;
  profit: number;
  costRatio: number;
  laborRatio: number;
  purchaseRatio: number;
  fixedRatio: number;
  targetCostRatio: number;
  targetLaborRatio: number;
  monthlyTargetSales: number;
  laborByUser: Array<{
    userId: number;
    userName: string;
    wageType: string;
    wageAmount: number;
    totalHours: number;
    laborCost: number;
  }> | null;
  fixedByCategory: Array<{
    categoryType: string;
    label: string;
    total: number;
  }>;
}

function fmt(n: number): string {
  return n.toLocaleString("ko-KR") + "원";
}

function pct(n: number): string {
  return n.toFixed(1) + "%";
}

function ratioBar(actual: number, target: number): string {
  const isOver = actual > target;
  const barWidth = Math.min((actual / (target || 1)) * 100, 150);
  const color = isOver ? "#ef4444" : "#22c55e";
  return `
    <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
      <div style="flex:1; background:#f1f5f9; border-radius:4px; height:8px; overflow:hidden;">
        <div style="width:${Math.min(barWidth, 100)}%; height:100%; background:${color}; border-radius:4px;"></div>
      </div>
      <span style="font-size:11px; color:${color}; font-weight:600; white-space:nowrap;">${pct(actual)} / 목표 ${pct(target)}</span>
    </div>`;
}

export function generateMonthlyReportHtml(data: MonthlyReportData): string {
  const {
    restaurantName, year, month,
    salesTotal, purchasesTotal, fixedCostsTotal, laborCost, totalCost, profit,
    costRatio, laborRatio, purchaseRatio, fixedRatio,
    targetCostRatio, targetLaborRatio, monthlyTargetSales,
    laborByUser, fixedByCategory,
  } = data;

  const salesAchievement = monthlyTargetSales > 0 ? (salesTotal / monthlyTargetSales) * 100 : 0;
  const profitColor = profit >= 0 ? "#16a34a" : "#dc2626";
  const monthLabel = `${year}년 ${month}월`;

  const laborRows = laborByUser && laborByUser.length > 0
    ? laborByUser.map(u => `
      <tr>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0;">${u.userName}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:center;">${u.wageType === "hourly" ? "시급" : "월급"}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right;">${fmt(u.wageAmount)}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right;">${u.totalHours.toFixed(1)}h</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right; font-weight:600;">${fmt(u.laborCost)}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" style="padding:12px; text-align:center; color:#94a3b8;">인건비 상세 데이터 없음</td></tr>`;

  const fixedRows = fixedByCategory.length > 0
    ? fixedByCategory.map(c => `
      <tr>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0;">${c.label}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right;">${fmt(c.total)}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right;">${salesTotal > 0 ? pct((c.total / salesTotal) * 100) : "-"}</td>
      </tr>`).join("")
    : `<tr><td colspan="3" style="padding:12px; text-align:center; color:#94a3b8;">고정비 데이터 없음</td></tr>`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${restaurantName} ${monthLabel} 정산 리포트</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; font-size: 13px; color: #1e293b; background: #fff; padding: 24px; }
    h1 { font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
    h2 { font-size: 15px; font-weight: 700; color: #1e293b; margin: 20px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; }
    .subtitle { font-size: 13px; color: #64748b; margin-bottom: 20px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 3px solid #0f172a; }
    .header-right { text-align: right; font-size: 12px; color: #64748b; }
    .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
    .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; }
    .kpi-label { font-size: 11px; color: #64748b; margin-bottom: 4px; }
    .kpi-value { font-size: 18px; font-weight: 700; }
    .kpi-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }
    .profit-card { background: linear-gradient(135deg, #f0fdf4, #dcfce7); border: 2px solid #86efac; border-radius: 8px; padding: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
    .profit-label { font-size: 13px; color: #166534; font-weight: 600; }
    .profit-value { font-size: 26px; font-weight: 800; }
    .loss-card { background: linear-gradient(135deg, #fef2f2, #fee2e2); border: 2px solid #fca5a5; }
    .loss-card .profit-label { color: #991b1b; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    thead th { background: #f1f5f9; padding: 8px; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0; }
    thead th:last-child, thead th:nth-child(3), thead th:nth-child(4) { text-align: right; }
    .summary-row { background: #f8fafc; font-weight: 700; }
    .summary-row td { padding: 8px; border-top: 2px solid #e2e8f0; }
    .ratio-section { margin-top: 20px; }
    .ratio-item { margin-bottom: 12px; }
    .ratio-item-header { display: flex; justify-content: space-between; font-size: 12px; }
    .ratio-label { color: #475569; font-weight: 600; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${restaurantName}</h1>
      <p class="subtitle">${monthLabel} 월별 정산 리포트</p>
    </div>
    <div class="header-right">
      <p>출력일: ${new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}</p>
      ${monthlyTargetSales > 0 ? `<p>월 목표 매출: ${fmt(monthlyTargetSales)}</p>` : ""}
    </div>
  </div>

  <!-- 순이익 요약 -->
  <div class="profit-card ${profit < 0 ? "loss-card" : ""}">
    <div>
      <p class="profit-label">${month}월 순이익 (매출 - 전체 비용)</p>
      <p style="font-size:12px; color:${profit >= 0 ? "#166534" : "#991b1b"}; margin-top:4px;">
        매출 ${fmt(salesTotal)} − 총비용 ${fmt(totalCost)}
      </p>
    </div>
    <p class="profit-value" style="color:${profitColor}">${profit >= 0 ? "+" : ""}${fmt(profit)}</p>
  </div>

  <!-- KPI 카드 -->
  <div class="kpi-grid">
    <div class="kpi-card">
      <p class="kpi-label">총 매출</p>
      <p class="kpi-value" style="color:#2563eb">${fmt(salesTotal)}</p>
      ${monthlyTargetSales > 0 ? `<p class="kpi-sub">목표 달성률 ${pct(salesAchievement)}</p>` : ""}
    </div>
    <div class="kpi-card">
      <p class="kpi-label">총 비용</p>
      <p class="kpi-value" style="color:#dc2626">${fmt(totalCost)}</p>
      <p class="kpi-sub">원가율 ${pct(costRatio)}</p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">매입(실제 합산)</p>
      <p class="kpi-value">${fmt(purchasesTotal)}</p>
      <p class="kpi-sub">매출 대비 ${pct(purchaseRatio)}</p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">인건비</p>
      <p class="kpi-value">${fmt(laborCost)}</p>
      <p class="kpi-sub">인건비율 ${pct(laborRatio)}</p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">고정비</p>
      <p class="kpi-value">${fmt(fixedCostsTotal)}</p>
      <p class="kpi-sub">매출 대비 ${pct(fixedRatio)}</p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">목표 원가율</p>
      <p class="kpi-value" style="color:${costRatio > targetCostRatio ? "#dc2626" : "#16a34a"}">${pct(costRatio)}</p>
      <p class="kpi-sub">목표 ${pct(targetCostRatio)}</p>
    </div>
  </div>

  <!-- 비율 분석 -->
  <h2>비율 분석</h2>
  <div class="ratio-section">
    <div class="ratio-item">
      <div class="ratio-item-header">
        <span class="ratio-label">원가율 (목표: ${pct(targetCostRatio)})</span>
      </div>
      ${ratioBar(costRatio, targetCostRatio)}
    </div>
    <div class="ratio-item">
      <div class="ratio-item-header">
        <span class="ratio-label">인건비율 (목표: ${pct(targetLaborRatio)})</span>
      </div>
      ${ratioBar(laborRatio, targetLaborRatio)}
    </div>
    <div class="ratio-item">
      <div class="ratio-item-header">
        <span class="ratio-label">매입 비율</span>
      </div>
      ${ratioBar(purchaseRatio, 35)}
    </div>
  </div>

  <!-- 고정비 내역 -->
  <h2>고정비 내역</h2>
  <table>
    <thead>
      <tr>
        <th>항목</th>
        <th style="text-align:right">금액</th>
        <th style="text-align:right">매출 대비</th>
      </tr>
    </thead>
    <tbody>
      ${fixedRows}
    </tbody>
    <tfoot>
      <tr class="summary-row">
        <td>합계</td>
        <td style="text-align:right">${fmt(fixedCostsTotal)}</td>
        <td style="text-align:right">${pct(fixedRatio)}</td>
      </tr>
    </tfoot>
  </table>

  <!-- 인건비 내역 -->
  <h2>인건비 내역 (확정/완료 스케줄 기준)</h2>
  <table>
    <thead>
      <tr>
        <th>직원명</th>
        <th style="text-align:center">급여 유형</th>
        <th style="text-align:right">시급/월급</th>
        <th style="text-align:right">근무 시간</th>
        <th style="text-align:right">인건비</th>
      </tr>
    </thead>
    <tbody>
      ${laborRows}
    </tbody>
    <tfoot>
      <tr class="summary-row">
        <td colspan="4">합계</td>
        <td style="text-align:right">${fmt(laborCost)}</td>
      </tr>
    </tfoot>
  </table>

  <!-- 손익 요약 -->
  <h2>손익 요약</h2>
  <table>
    <thead>
      <tr>
        <th>항목</th>
        <th style="text-align:right">금액</th>
        <th style="text-align:right">매출 대비</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0;">총 매출</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right; color:#2563eb; font-weight:600;">${fmt(salesTotal)}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right;">100.0%</td>
      </tr>
      <tr>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0;">매입</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right;">${fmt(purchasesTotal)}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right;">${pct(purchaseRatio)}</td>
      </tr>
      <tr>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0;">고정비</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right;">${fmt(fixedCostsTotal)}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right;">${pct(fixedRatio)}</td>
      </tr>
      <tr>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0;">인건비</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right;">${fmt(laborCost)}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right;">${pct(laborRatio)}</td>
      </tr>
      <tr>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0;">총 비용</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right; color:#dc2626; font-weight:600;">${fmt(totalCost)}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right;">${pct(costRatio)}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr class="summary-row">
        <td style="padding:8px;">순이익</td>
        <td style="padding:8px; text-align:right; color:${profitColor}; font-size:15px;">${profit >= 0 ? "+" : ""}${fmt(profit)}</td>
        <td style="padding:8px; text-align:right; color:${profitColor};">${salesTotal > 0 ? (profit >= 0 ? "+" : "") + pct((profit / salesTotal) * 100) : "-"}</td>
      </tr>
    </tfoot>
  </table>

  <div class="footer">
    <p>본 리포트는 ${restaurantName} ${monthLabel} 데이터를 기반으로 자동 생성되었습니다.</p>
    <p>인건비는 확정/완료 상태의 스케줄 기준이며, 실제 지급액과 차이가 있을 수 있습니다.</p>
  </div>
</body>
</html>`;
}
