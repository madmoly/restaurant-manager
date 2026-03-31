import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "../lib/trpc";
import { CheckCircle, AlertTriangle, Pen, RotateCcw, Download } from "lucide-react";

// ─── 계약서 서명 페이지 (/sign/:token) ────────────────────────────────────────
// 비로그인 접근 가능. 직원이 링크를 받아서 계약 내용 확인 + 서명
// 항상 라이트 모드로 표시 (인쇄/가독성 우선)

export default function ContractSignPage({ token }: { token: string }) {
  const { data: contract, isLoading, error } = trpc.electronicContracts.getByToken.useQuery(
    { token },
    { enabled: !!token, retry: false },
  );

  const sign = trpc.electronicContracts.signContract.useMutation({
    onSuccess() {
      window.location.reload();
    },
  });

  const [agreed, setAgreed] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [showSignPad, setShowSignPad] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState("");

  // ─── 모든 Hooks는 조건부 return 앞에 위치해야 함 ──────────────────────────

  // 다크모드 강제 해제 + 인쇄 스타일 주입
  useEffect(() => {
    const html = document.documentElement;
    const wasDark = html.classList.contains("dark");
    html.classList.remove("dark");

    const style = document.createElement("style");
    style.textContent = `
      @media print {
        body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .no-print { display: none !important; }
        .print-contract { box-shadow: none !important; border: none !important; margin: 0 !important; padding: 2rem !important; }
        @page { margin: 15mm; size: A4; }
      }
    `;
    document.head.appendChild(style);

    return () => {
      if (wasDark) html.classList.add("dark");
      document.head.removeChild(style);
    };
  }, []);

  // ─── 로딩 / 에러 분기 ────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f9fafb" }}>
        <div className="animate-pulse" style={{ color: "#6b7280" }}>계약서를 불러오는 중...</div>
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f9fafb" }}>
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 mx-auto mb-3" style={{ color: "#f87171" }} />
          <p className="text-lg font-semibold" style={{ color: "#111827" }}>유효하지 않은 링크입니다</p>
          <p className="text-sm mt-1" style={{ color: "#6b7280" }}>계약서를 찾을 수 없거나 만료된 링크입니다.</p>
        </div>
      </div>
    );
  }

  const isSigned = contract.status === "signed";
  const isDraft = contract.status === "draft";

  const typeLabels: Record<string, string> = {
    permanent: "정규직",
    fixed_term: "계약직",
    part_time: "단시간(파트타임)",
    daily: "일용직",
  };

  const handleSign = () => {
    if (!signatureData) return;
    sign.mutate({ token, signature: signatureData });
  };

  // ─── 스타일 상수 (인라인으로 다크모드 영향 차단) ────────────────────────────
  const pageStyle = { background: "#f9fafb", color: "#1f2937" };
  const cardStyle = { background: "#ffffff", border: "1px solid #e5e7eb" };

  return (
    <div className="min-h-screen py-6 px-4" style={pageStyle}>
      <div className="max-w-2xl mx-auto">
        {/* 서명완료 배너 */}
        {isSigned && (
          <div className="mb-4 rounded-lg p-4 flex items-center gap-3 no-print"
            style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
            <CheckCircle className="w-6 h-6 shrink-0" style={{ color: "#16a34a" }} />
            <div>
              <p className="font-semibold" style={{ color: "#166534" }}>서명 완료</p>
              <p className="text-sm" style={{ color: "#16a34a" }}>
                {contract.signedAt && `서명일시: ${new Date(contract.signedAt).toLocaleString("ko-KR")}`}
              </p>
            </div>
          </div>
        )}

        {isDraft && (
          <div className="mb-4 rounded-lg p-4 flex items-center gap-3 no-print"
            style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
            <AlertTriangle className="w-6 h-6 shrink-0" style={{ color: "#d97706" }} />
            <p className="text-sm" style={{ color: "#92400e" }}>이 계약서는 아직 발송 전 상태입니다.</p>
          </div>
        )}

        {/* 계약서 본문 — 근기법 표준양식 */}
        <div className="rounded-lg shadow-sm print-contract" style={cardStyle}>
          {/* 헤더 */}
          <div className="text-center py-8" style={{ borderBottom: "1px solid #e5e7eb" }}>
            <h1 className="text-2xl font-bold tracking-wide" style={{ color: "#111827" }}>근 로 계 약 서</h1>
            <p className="text-sm mt-2" style={{ color: "#6b7280" }}>(근로기준법 제17조에 의거)</p>
          </div>

          <div className="p-6 md:p-8 space-y-6 text-sm leading-relaxed" style={{ color: "#1f2937" }}>
            {/* 당사자 */}
            <p>
              <strong>{contract.affiliatedCompany || contract.restaurantName || `매장 #${contract.restaurantId}`}</strong>
              {contract.employerBusinessNumber && (
                <span className="text-xs" style={{ color: "#6b7280" }}> (사업자등록번호: {contract.employerBusinessNumber})</span>
              )}
              (이하 "사업주"라 한다)과(와){" "}
              <strong>{contract.employeeName}</strong>
              (이하 "근로자"라 한다)은(는) 다음과 같이 근로계약을 체결한다.
            </p>

            {/* 조항 테이블 */}
            <table className="w-full border-collapse">
              <tbody>
                <ContractRow label="1. 계약유형" value={typeLabels[contract.contractType] ?? contract.contractType} />
                <ContractRow
                  label="2. 계약기간"
                  value={
                    contract.contractEnd
                      ? `${fmt(contract.contractStart)} ~ ${fmt(contract.contractEnd)}`
                      : `${fmt(contract.contractStart)} ~ (기간의 정함 없음)`
                  }
                />
                <ContractRow
                  label="3. 근무장소"
                  value={
                    contract.workPlaceAddress
                      ? `${contract.workPlace || "(매장 내)"} (${contract.workPlaceAddress})`
                      : contract.workPlace || "(매장 내)"
                  }
                />
                <ContractRow label="4. 업무내용" value={contract.jobDescription || "(사업주 지시에 따름)"} />
                <ContractRow
                  label="5. 근무시간"
                  value={`${contract.workStartTime} ~ ${contract.workEndTime} (주 ${Number(contract.weeklyHours)}시간, 휴게 ${contract.breakMinutes ?? 60}분)`}
                />
                <ContractRow
                  label="6. 주휴일"
                  value="스케줄상 지정일 또는 당사자 간 협의에 따름"
                />
                <ContractRow
                  label="7. 임금"
                  value={`${contract.wageType === "hourly" ? "시급" : "월급"} ${Number(contract.wageAmount).toLocaleString()}원`}
                />
                {/* 포괄임금 구성항목 (월급제 + basePay 존재 시) */}
                {contract.wageType === "monthly" && contract.basePay && (
                  <tr>
                    <td colSpan={2} style={{ padding: "0 0 0 0" }}>
                      <div style={{ margin: "0 16px 12px 16px", border: "1px solid #d1d5db", borderRadius: "6px", overflow: "hidden" }}>
                        <div style={{ background: "#f3f4f6", padding: "6px 12px", borderBottom: "1px solid #d1d5db" }}>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: "#374151" }}>임금 구성항목 (근기법 제17조)</span>
                          {contract.monthlyContractHours && (
                            <span style={{ fontSize: "10px", color: "#6b7280", marginLeft: "8px" }}>월소정근로 {Number(contract.monthlyContractHours)}h</span>
                          )}
                        </div>
                        <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
                          <tbody>
                            {contract.hourlyWage && (
                              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                                <td style={{ padding: "5px 12px", color: "#6b7280" }}>통상시급</td>
                                <td style={{ padding: "5px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 500 }}>
                                  {Number(contract.hourlyWage).toLocaleString()}원
                                </td>
                              </tr>
                            )}
                            <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                              <td style={{ padding: "5px 12px", color: "#6b7280" }}>기본급{contract.monthlyContractHours ? ` (${Number(contract.monthlyContractHours)}h)` : ""}</td>
                              <td style={{ padding: "5px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 500 }}>
                                {Number(contract.basePay).toLocaleString()}원
                              </td>
                            </tr>
                            {/* 고정연장/휴일수당 필드 제거됨 */}
                            {contract.annualLeavePay && (
                              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                                <td style={{ padding: "5px 12px", color: "#6b7280" }}>포괄연차수당 (8h)</td>
                                <td style={{ padding: "5px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 500 }}>
                                  {Number(contract.annualLeavePay).toLocaleString()}원
                                </td>
                              </tr>
                            )}
                            <tr style={{ background: "#f9fafb" }}>
                              <td style={{ padding: "6px 12px", fontWeight: 600 }}>합계 (월급)</td>
                              <td style={{ padding: "6px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>
                                {Number(contract.wageAmount).toLocaleString()}원
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
                <ContractRow label="8. 급여일" value={`매월 ${contract.payDay ?? 25}일`} />
                <ContractRow
                  label="9. 지급방법"
                  value={contract.payMethod === "bank_transfer" ? "계좌이체" : "현금"}
                />
                <ContractRow
                  label="10. 4대보험"
                  value={contract.socialInsurance ? "가입" : "미가입"}
                />
                {contract.mealProvided && (
                  <ContractRow
                    label="11. 식사제공"
                    value={
                      Number(contract.mealAllowance) > 0
                        ? `제공 (식대 월 ${Number(contract.mealAllowance).toLocaleString()}원)`
                        : "제공"
                    }
                  />
                )}
              </tbody>
            </table>

            {/* ═══ 표준 근로조건 조항 ═══ */}
            <div className="space-y-4 text-[13px] leading-relaxed" style={{ color: "#374151" }}>

              {/* 근로시간·휴게 상세 */}
              <div>
                <h3 className="font-semibold mb-1.5" style={{ color: "#111827", fontSize: "13px" }}>근로시간 및 휴게시간</h3>
                <div className="space-y-1" style={{ paddingLeft: "8px" }}>
                  {(() => {
                    const [sh, sm] = (contract.workStartTime || "09:00").split(":").map(Number);
                    const [eh, em] = (contract.workEndTime || "18:00").split(":").map(Number);
                    let dailyMins = (eh * 60 + em) - (sh * 60 + sm) - (contract.breakMinutes ?? 60);
                    if (dailyMins <= 0) dailyMins += 24 * 60;
                    const dailyH = Math.floor(dailyMins / 60);
                    const dailyM = dailyMins % 60;
                    const dailyStr = `${dailyH}시간${dailyM > 0 ? ` ${dailyM}분` : ""}`;
                    const weeklyH = Number(contract.weeklyHours) || 40;
                    // 주 근무일수 = 주근로시간 / 1일 근로시간 (반올림)
                    const workDays = dailyMins > 0 ? Math.round(weeklyH * 60 / dailyMins) : 5;
                    return (
                      <>
                        <p>① 근무시간: {contract.workStartTime} ~ {contract.workEndTime} (휴게시간 {contract.breakMinutes ?? 60}분 제외)</p>
                        <p>② 1일 소정근로시간은 {dailyStr}이며, 주 {workDays}일 근무를 기준으로 1주 소정근로시간은 {weeklyH}시간으로 한다.</p>
                      </>
                    );
                  })()}
                  <p>③ 휴게시간은 근로자가 자유롭게 이용할 수 있다.</p>
                  <p>④ 실제 근무 스케줄은 사업주가 작성한 스케줄표에 따르되, 근로자에게 사전에 고지한다.</p>
                </div>
              </div>

              {/* 연장·야간·휴일근로 조항 제거됨 */}

              {/* 휴일·휴가 */}
              <div>
                <h3 className="font-semibold mb-1.5" style={{ color: "#111827", fontSize: "13px" }}>휴일 및 연차유급휴가</h3>
                <div className="space-y-1" style={{ paddingLeft: "8px" }}>
                  <p>① 주휴일은 스케줄상 지정일 또는 당사자 간 협의에 따르며, 1주 소정근로일을 개근한 경우 유급으로 부여한다.</p>
                  {contract.wageType === "monthly" && contract.annualLeavePay ? (
                    <>
                      <p>② 연차유급휴가는 근로기준법 제60조에 따라 부여한다. 본 계약의 임금에는 상기 임금 구성항목에 명시된 포괄연차수당이 포함되어 있으며, 해당 일수 범위 내의 연차사용에 대해서는 별도 수당을 지급하지 아니한다.</p>
                      <p>③ 포괄연차수당에 해당하는 일수를 초과하여 연차를 사용하는 경우 관련 법령에 따라 처리한다.</p>
                    </>
                  ) : (
                    <p>② 연차유급휴가는 근로기준법 제60조에 따라 부여하며, 미사용 연차에 대해서는 관련 법령에 따라 수당으로 정산한다.</p>
                  )}
                </div>
              </div>

              {/* 퇴직 및 해고 */}
              <div>
                <h3 className="font-semibold mb-1.5" style={{ color: "#111827", fontSize: "13px" }}>계약 해지 및 퇴직</h3>
                <div className="space-y-1" style={{ paddingLeft: "8px" }}>
                  <p>① 근로자가 자발적으로 퇴직하고자 할 때에는 최소 1개월 전에 사업주에게 서면으로 통보하여야 한다.</p>
                  <p>② 사업주가 근로자를 해고하고자 할 때에는 30일 전에 예고하거나 30일분의 통상임금을 지급한다.</p>
                  {contract.contractEnd && (
                    <p>③ 계약기간 만료 시 재계약 여부는 근무성적, 경영상 필요 등을 고려하여 결정한다.</p>
                  )}
                </div>
              </div>

              {/* 비밀유지·손해배상 */}
              <div>
                <h3 className="font-semibold mb-1.5" style={{ color: "#111827", fontSize: "13px" }}>비밀유지 및 손해배상</h3>
                <div className="space-y-1" style={{ paddingLeft: "8px" }}>
                  <p>① 근로자는 업무상 취득한 영업비밀, 고객정보, 경영정보를 재직 중은 물론 퇴직 후에도 제3자에게 누설하거나 업무 외 목적으로 사용하여서는 아니 된다.</p>
                  <p>② 근로자가 고의 또는 중대한 과실로 사업주에게 손해를 끼친 경우 배상 책임을 진다.</p>
                </div>
              </div>

              {/* 근태·물품관리 */}
              <div>
                <h3 className="font-semibold mb-1.5" style={{ color: "#111827", fontSize: "13px" }}>근태 및 물품관리</h3>
                <div className="space-y-1" style={{ paddingLeft: "8px" }}>
                  <p>① 근로자는 출·퇴근 시 사업주가 정한 방법으로 근태를 기록하여야 한다.</p>
                  <p>② 사업주가 지급한 업무용 물품(유니폼, 열쇠, 장비 등)은 퇴직 시 반납하여야 한다.</p>
                  <p>③ 근로자는 식품위생법 등 관련 법령에서 요구하는 위생관리 기준을 준수하여야 한다.</p>
                </div>
              </div>
            </div>

            {/* 특약사항 */}
            {contract.specialTerms && (
              <div>
                <h3 className="font-semibold mb-2" style={{ color: "#111827" }}>특약사항</h3>
                <div className="rounded-md p-3 text-sm whitespace-pre-wrap"
                  style={{ background: "#f9fafb" }}>
                  {contract.specialTerms}
                </div>
              </div>
            )}

            {/* 법적 고지 */}
            <div className="text-xs space-y-1 pt-4" style={{ borderTop: "1px solid #e5e7eb", color: "#6b7280" }}>
              <p>본 계약에 명시되지 않은 사항은 근로기준법에 따릅니다.</p>
              <p>근로자는 본 계약서 사본을 교부받을 권리가 있습니다. (근로기준법 제17조 제2항)</p>
              <p>본 계약서의 전자 서명은 전자서명법에 따라 법적 효력을 가집니다.</p>
            </div>

            {/* ═══ 부속서류 1: 비밀유지서약서 ═══ */}
            {contract.includeNda && (
              <div className="pt-6 space-y-3" style={{ borderTop: "2px solid #111827" }}>
                <h2 className="text-lg font-bold text-center tracking-wide" style={{ color: "#111827" }}>비밀유지서약서</h2>
                <div className="text-[13px] leading-relaxed space-y-3" style={{ color: "#374151" }}>
                  <p>
                    <strong>{contract.employeeName}</strong> (이하 "서약자"라 한다)은(는){" "}
                    <strong>{contract.affiliatedCompany || contract.restaurantName || `매장 #${contract.restaurantId}`}</strong>
                    (이하 "회사"라 한다)에 입사함에 있어 다음 사항을 서약합니다.
                  </p>
                  <div style={{ paddingLeft: "8px" }} className="space-y-1.5">
                    <p>1. 서약자는 재직 중 업무상 알게 된 회사의 영업비밀, 경영정보, 고객정보, 매출·원가 정보, 레시피, 운영 노하우 등 일체의 비밀정보를 재직 중은 물론 퇴직 후에도 제3자에게 누설, 공개, 전달하거나 사적 목적으로 이용하지 아니한다.</p>
                    <p>2. 서약자는 업무 중 취득한 자료(문서, 데이터, 사진, 전자파일 등)를 회사의 사전 서면 승인 없이 외부로 반출하거나 복사·촬영하지 아니한다.</p>
                    <p>3. 서약자는 퇴직 시 업무 관련 자료 일체를 회사에 반환하며, 개인 기기에 저장된 업무 자료를 삭제한다.</p>
                    <p>4. 서약자가 본 서약을 위반하여 회사에 손해를 끼친 경우 민·형사상 책임을 지며, 손해배상의 의무를 진다.</p>
                    <p>5. 본 서약서의 효력은 서약자의 퇴직 후에도 존속한다.</p>
                  </div>
                  <p className="text-xs pt-2" style={{ color: "#6b7280" }}>본 서약서는 근로계약서와 동시에 체결되며, 전자서명으로 효력을 가집니다.</p>
                </div>
              </div>
            )}

            {/* ═══ 부속서류 2: 개인정보 수집·이용 동의서 ═══ */}
            {contract.includePrivacyConsent && (
              <div className="pt-6 space-y-3" style={{ borderTop: "2px solid #111827" }}>
                <h2 className="text-lg font-bold text-center tracking-wide" style={{ color: "#111827" }}>개인정보 수집·이용 동의서</h2>
                <div className="text-[13px] leading-relaxed space-y-3" style={{ color: "#374151" }}>
                  <p>
                    <strong>{contract.affiliatedCompany || contract.restaurantName || `매장 #${contract.restaurantId}`}</strong>
                    (이하 "회사"라 한다)은(는) 「개인정보 보호법」에 따라 근로자의 개인정보를 다음과 같이 수집·이용합니다.
                  </p>
                  <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse", border: "1px solid #d1d5db" }}>
                    <tbody>
                      <tr style={{ borderBottom: "1px solid #d1d5db" }}>
                        <td style={{ padding: "6px 10px", fontWeight: 600, background: "#f3f4f6", width: "30%", verticalAlign: "top" }}>수집 항목</td>
                        <td style={{ padding: "6px 10px" }}>성명, 생년월일, 연락처, 주소, 계좌정보, 건강진단서, 근로계약 관련 정보</td>
                      </tr>
                      <tr style={{ borderBottom: "1px solid #d1d5db" }}>
                        <td style={{ padding: "6px 10px", fontWeight: 600, background: "#f3f4f6", verticalAlign: "top" }}>수집·이용 목적</td>
                        <td style={{ padding: "6px 10px" }}>근로계약 체결·이행, 급여 지급, 4대보험 신고, 근태·인사 관리, 법령상 의무 이행</td>
                      </tr>
                      <tr style={{ borderBottom: "1px solid #d1d5db" }}>
                        <td style={{ padding: "6px 10px", fontWeight: 600, background: "#f3f4f6", verticalAlign: "top" }}>보유·이용 기간</td>
                        <td style={{ padding: "6px 10px" }}>근로관계 종료 후 관련 법령에 따른 보존기간까지 (근로기준법 3년, 국세기본법 5년 등)</td>
                      </tr>
                      <tr>
                        <td style={{ padding: "6px 10px", fontWeight: 600, background: "#f3f4f6", verticalAlign: "top" }}>동의 거부 권리</td>
                        <td style={{ padding: "6px 10px" }}>동의를 거부할 권리가 있으나, 거부 시 근로계약 체결 및 급여 지급 등에 제한이 있을 수 있습니다.</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="text-xs pt-1" style={{ color: "#6b7280" }}>본 동의서는 근로계약서와 동시에 체결되며, 전자서명으로 효력을 가집니다.</p>
                </div>
              </div>
            )}

            {/* 서명 영역 */}
            <div className="pt-6" style={{ borderTop: "1px solid #e5e7eb" }}>
              <p className="text-center text-sm mb-4" style={{ color: "#4b5563" }}>
                위와 같이 근로계약을 체결하고 이를 성실히 이행할 것을 약정합니다.
              </p>
              <p className="text-center text-sm mb-6" style={{ color: "#6b7280" }}>
                {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}
              </p>

              <div className="grid grid-cols-2 gap-4">
                {/* 사업주 */}
                <div className="rounded-lg p-4 text-center" style={{ border: "1px solid #e5e7eb" }}>
                  <p className="text-xs mb-1" style={{ color: "#6b7280" }}>사업주</p>
                  <p className="font-semibold" style={{ color: "#111827" }}>
                    {contract.affiliatedCompany || contract.restaurantName || `매장 #${contract.restaurantId}`}
                  </p>
                  {contract.employerBusinessNumber && (
                    <p className="text-xs" style={{ color: "#6b7280" }}>{contract.employerBusinessNumber}</p>
                  )}
                  <p className="text-xs mt-1" style={{ color: "#9ca3af" }}>(전자계약 생성으로 갈음)</p>
                </div>
                {/* 근로자 */}
                <div className="rounded-lg p-4 text-center" style={{ border: "1px solid #e5e7eb" }}>
                  <p className="text-xs mb-1" style={{ color: "#6b7280" }}>근로자</p>
                  <p className="font-semibold" style={{ color: "#111827" }}>{contract.employeeName}</p>
                  {isSigned && contract.employeeSignature ? (
                    <img
                      src={contract.employeeSignature}
                      alt="서명"
                      className="mx-auto mt-2 max-h-16"
                    />
                  ) : signatureData ? (
                    <img src={signatureData} alt="서명 미리보기" className="mx-auto mt-2 max-h-16" />
                  ) : (
                    <p className="text-xs mt-2" style={{ color: "#9ca3af" }}>(서명 대기)</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 서명 영역 (미서명 + 발송됨 상태일 때만) */}
        {!isSigned && !isDraft && (
          <div className="mt-6 rounded-lg shadow-sm p-6 no-print" style={cardStyle}>
            <h2 className="font-semibold mb-4" style={{ color: "#111827" }}>전자 서명</h2>

            <label className="flex items-start gap-3 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 rounded"
                style={{ borderColor: "#d1d5db" }}
              />
              <span className="text-sm" style={{ color: "#374151" }}>
                위 근로계약서의 내용을 확인하였으며, 이에 동의합니다.
              </span>
            </label>

            {agreed && (
              <button
                className="w-full py-2.5 px-4 rounded-lg font-medium text-white flex items-center justify-center gap-2"
                style={{ background: "#2563eb" }}
                onClick={() => setShowSignPad(true)}
              >
                <Pen className="w-4 h-4" /> {signatureData ? "서명 다시하기" : "서명하기"}
              </button>
            )}

            {signatureData && agreed && (
              <div className="mt-3 space-y-3">
                <div className="rounded-lg p-4 text-center" style={{ border: "1px solid #d1d5db", background: "#fafafa" }}>
                  <p className="text-xs mb-2" style={{ color: "#6b7280" }}>서명 미리보기</p>
                  <img src={signatureData} alt="서명 미리보기" className="mx-auto max-h-20" />
                </div>
                <button
                  className="w-full py-2.5 px-4 rounded-lg font-medium text-white disabled:opacity-50"
                  style={{ background: "#2563eb" }}
                  onClick={handleSign}
                  disabled={sign.isPending}
                >
                  {sign.isPending ? "서명 처리 중..." : "서명 제출"}
                </button>
                {sign.error && (
                  <p className="text-sm" style={{ color: "#dc2626" }}>{sign.error.message}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* 서명 완료 후 안내 */}
        {isSigned && (
          <div className="mt-6 rounded-lg shadow-sm p-6 no-print" style={cardStyle}>
            <div className="text-center">
              <CheckCircle className="w-10 h-10 mx-auto mb-3" style={{ color: "#22c55e" }} />
              <p className="font-semibold" style={{ color: "#111827" }}>계약이 완료되었습니다</p>
              <p className="text-sm mt-1" style={{ color: "#6b7280" }}>
                사업주에게도 서명 완료가 통보되었습니다.
              </p>
            </div>

            {/* 이메일 발송 */}
            <div className="mt-5 pt-4" style={{ borderTop: "1px solid #e5e7eb" }}>
              <p className="text-sm font-medium mb-2" style={{ color: "#374151" }}>계약서 사본 이메일 발송</p>
              {emailSent ? (
                <div className="rounded-lg p-3 flex items-center gap-2" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                  <CheckCircle className="w-4 h-4 shrink-0" style={{ color: "#16a34a" }} />
                  <p className="text-sm" style={{ color: "#166534" }}>이메일이 발송되었습니다</p>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => { setEmailInput(e.target.value); setEmailError(""); }}
                    placeholder="이메일 주소 입력"
                    className="flex-1 rounded-lg px-3 py-2 text-sm"
                    style={{ border: "1px solid #d1d5db", background: "#ffffff", color: "#111827" }}
                  />
                  <button
                    onClick={async () => {
                      if (!emailInput || !emailInput.includes("@")) { setEmailError("올바른 이메일을 입력하세요"); return; }
                      setEmailSending(true); setEmailError("");
                      try {
                        const res = await fetch("/api/contract/send-email", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ token, email: emailInput }),
                        });
                        if (!res.ok) {
                          let errMsg = `HTTP ${res.status}`;
                          try { const d = await res.json(); errMsg = d.message || errMsg; } catch {}
                          setEmailError(errMsg);
                        } else {
                          const data = await res.json();
                          if (data.ok) { setEmailSent(true); } else { setEmailError(data.message || "발송 실패"); }
                        }
                      } catch (err: any) { setEmailError("네트워크 오류: " + (err?.message || "")); }
                      setEmailSending(false);
                    }}
                    disabled={emailSending}
                    className="shrink-0 py-2 px-4 rounded-lg text-sm font-medium text-white"
                    style={{ background: "#2563eb" }}
                  >
                    {emailSending ? "발송 중..." : "발송"}
                  </button>
                </div>
              )}
              {emailError && <p className="text-xs mt-1" style={{ color: "#dc2626" }}>{emailError}</p>}
            </div>

            {/* 인쇄 버튼 */}
            <div className="text-center mt-4">
              <button
                className="py-2 px-4 rounded-lg font-medium flex items-center gap-2 mx-auto"
                style={{ border: "1px solid #d1d5db", color: "#374151" }}
                onClick={() => window.print()}
              >
                <Download className="w-4 h-4" /> 인쇄 / 저장
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ 풀스크린 서명 모달 ═══ */}
      {showSignPad && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "#ffffff",
          display: "flex", flexDirection: "column",
          touchAction: "none",
        }}>
          {/* 헤더 */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "16px 20px", borderBottom: "1px solid #e5e7eb",
          }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#111827" }}>전자 서명</h3>
            <button
              onClick={() => setShowSignPad(false)}
              style={{ padding: "8px", borderRadius: "8px", color: "#6b7280" }}
            >
              ✕
            </button>
          </div>

          {/* 서명 캔버스 영역 */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "20px" }}>
            <p style={{ fontSize: "14px", color: "#4b5563", marginBottom: "12px", textAlign: "center" }}>
              아래 영역에 서명해주세요
            </p>
            <div style={{ flex: 1, position: "relative" }}>
              <FullscreenSignaturePad
                onSave={(data) => {
                  setSignatureData(data);
                  setShowSignPad(false);
                }}
                onCancel={() => setShowSignPad(false)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 계약 조항 행 ─────────────────────────────────────────────────────────────

function ContractRow({ label, value }: { label: string; value: string }) {
  return (
    <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
      <td className="py-2.5 pr-4 whitespace-nowrap align-top font-medium" style={{ color: "#6b7280", width: "9rem" }}>
        {label}
      </td>
      <td className="py-2.5" style={{ color: "#111827" }}>{value}</td>
    </tr>
  );
}

// ─── 날짜 포맷 ────────────────────────────────────────────────────────────────

function fmt(d: any): string {
  if (!d) return "-";
  const s = String(d).slice(0, 10);
  const [y, m, dd] = s.split("-");
  return `${y}년 ${Number(m)}월 ${Number(dd)}일`;
}

// ─── 서명 패드 (Canvas) ───────────────────────────────────────────────────────

// ─── 풀스크린 서명 패드 ─────────────────────────────────────────────────────

function FullscreenSignaturePad({ onSave, onCancel }: { onSave: (data: string) => void; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  // 컨테이너 크기에 맞춰 캔버스 리사이즈
  useEffect(() => {
    const resize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * 2; // 레티나 대응
      canvas.height = rect.height * 2;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(2, 2);
        ctx.strokeStyle = "#1a1a1a";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
      }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const getPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    setDrawing(true);
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, [getPos]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  }, [drawing, getPos]);

  const endDraw = useCallback(() => {
    setDrawing(false);
  }, []);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const confirm = () => {
    if (hasDrawn && canvasRef.current) {
      onSave(canvasRef.current.toDataURL("image/png"));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "16px" }}>
      <div
        ref={containerRef}
        style={{
          flex: 1, borderRadius: "12px", border: "2px dashed #d1d5db",
          background: "#fafafa", position: "relative", overflow: "hidden",
          minHeight: "200px",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ cursor: "crosshair", touchAction: "none", display: "block" }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {!hasDrawn && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
          }}>
            <p style={{ fontSize: "16px", color: "#9ca3af" }}>손가락 또는 마우스로 서명</p>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: "12px" }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1, padding: "14px", borderRadius: "12px",
            border: "1px solid #d1d5db", fontSize: "15px", fontWeight: 500,
            color: "#374151", background: "#ffffff",
          }}
        >
          취소
        </button>
        <button
          onClick={clear}
          style={{
            padding: "14px 20px", borderRadius: "12px",
            border: "1px solid #d1d5db", fontSize: "15px", fontWeight: 500,
            color: "#6b7280", background: "#ffffff",
            display: "flex", alignItems: "center", gap: "6px",
          }}
        >
          <RotateCcw style={{ width: "16px", height: "16px" }} /> 지우기
        </button>
        <button
          onClick={confirm}
          disabled={!hasDrawn}
          style={{
            flex: 1, padding: "14px", borderRadius: "12px",
            fontSize: "15px", fontWeight: 600,
            color: "#ffffff",
            background: hasDrawn ? "#2563eb" : "#93c5fd",
            opacity: hasDrawn ? 1 : 0.6,
          }}
        >
          서명 완료
        </button>
      </div>
    </div>
  );
}

// ─── 인라인 서명 패드 (레거시, 미사용) ──────────────────────────────────────

function SignaturePad({ onSave }: { onSave: (data: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  const getPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    setDrawing(true);
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, [getPos]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  }, [drawing, getPos]);

  const endDraw = useCallback(() => {
    setDrawing(false);
    if (hasDrawn && canvasRef.current) {
      onSave(canvasRef.current.toDataURL("image/png"));
    }
  }, [hasDrawn, onSave]);

  const clear = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !canvasRef.current) return;
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setHasDrawn(false);
    onSave("");
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm" style={{ color: "#4b5563" }}>아래 영역에 서명해주세요</p>
        <button
          type="button"
          onClick={clear}
          className="text-xs flex items-center gap-1"
          style={{ color: "#6b7280" }}
        >
          <RotateCcw className="w-3 h-3" /> 다시쓰기
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={560}
        height={180}
        className="w-full rounded-lg cursor-crosshair touch-none"
        style={{ border: "2px dashed #d1d5db", background: "#ffffff" }}
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={endDraw}
        onMouseLeave={endDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={endDraw}
      />
      {!hasDrawn && (
        <p className="text-xs text-center mt-1" style={{ color: "#9ca3af" }}>
          손가락 또는 마우스로 서명을 그려주세요
        </p>
      )}
    </div>
  );
}
