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
    fixed_term: "기간제",
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
              <strong>{contract.restaurantName ?? `매장 #${contract.restaurantId}`}</strong>
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
                {contract.hasProbation && (
                  <ContractRow label="   수습기간" value={`${contract.probationMonths ?? 3}개월`} />
                )}
                <ContractRow label="3. 근무장소" value={contract.workPlace || "(매장 내)"} />
                <ContractRow label="4. 업무내용" value={contract.jobDescription || "(사업주 지시에 따름)"} />
                <ContractRow
                  label="5. 근무시간"
                  value={`${contract.workStartTime} ~ ${contract.workEndTime} (주 ${Number(contract.weeklyHours)}시간, 휴게 ${contract.breakMinutes ?? 60}분)`}
                />
                <ContractRow label="6. 주휴일" value={contract.weeklyHoliday ?? "일요일"} />
                <ContractRow
                  label="7. 임금"
                  value={`${contract.wageType === "hourly" ? "시급" : "월급"} ${Number(contract.wageAmount).toLocaleString()}원`}
                />
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
                    {contract.restaurantName ?? `매장 #${contract.restaurantId}`}
                  </p>
                  <p className="text-xs mt-2" style={{ color: "#9ca3af" }}>(전자계약 생성으로 갈음)</p>
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
              <>
                {!showSignPad ? (
                  <button
                    className="w-full py-2.5 px-4 rounded-lg font-medium text-white flex items-center justify-center gap-2"
                    style={{ background: "#2563eb" }}
                    onClick={() => setShowSignPad(true)}
                  >
                    <Pen className="w-4 h-4" /> 서명하기
                  </button>
                ) : (
                  <div className="space-y-3">
                    <SignaturePad onSave={setSignatureData} />
                    {signatureData && (
                      <button
                        className="w-full py-2.5 px-4 rounded-lg font-medium text-white disabled:opacity-50"
                        style={{ background: "#2563eb" }}
                        onClick={handleSign}
                        disabled={sign.isPending}
                      >
                        {sign.isPending ? "서명 처리 중..." : "서명 제출"}
                      </button>
                    )}
                    {sign.error && (
                      <p className="text-sm" style={{ color: "#dc2626" }}>{sign.error.message}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 서명 완료 후 안내 */}
        {isSigned && (
          <div className="mt-6 rounded-lg shadow-sm p-6 text-center no-print" style={cardStyle}>
            <CheckCircle className="w-10 h-10 mx-auto mb-3" style={{ color: "#22c55e" }} />
            <p className="font-semibold" style={{ color: "#111827" }}>계약이 완료되었습니다</p>
            <p className="text-sm mt-1" style={{ color: "#6b7280" }}>
              사업주에게도 서명 완료가 통보되었습니다. 이 페이지를 스크린샷하거나 인쇄하여 보관하세요.
            </p>
            <button
              className="mt-4 py-2 px-4 rounded-lg font-medium flex items-center gap-2 mx-auto"
              style={{ border: "1px solid #d1d5db", color: "#374151" }}
              onClick={() => window.print()}
            >
              <Download className="w-4 h-4" /> 인쇄 / 저장
            </button>
          </div>
        )}
      </div>
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
