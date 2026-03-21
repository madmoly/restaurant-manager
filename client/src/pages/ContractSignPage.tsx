import { useState, useRef, useEffect } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { CheckCircle, FileText, PenLine, AlertCircle, Loader2 } from "lucide-react";

export default function ContractSignPage() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";

  const [agreed, setAgreed] = useState(false);
  const [signatureName, setSignatureName] = useState("");
  const [signed, setSigned] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [useTypedSignature, setUseTypedSignature] = useState(true);

  const contractQuery = trpc.electronicContracts.getByToken.useQuery(
    { token },
    { enabled: !!token, retry: false }
  );

  const signMutation = trpc.electronicContracts.sign.useMutation({
    onSuccess: () => {
      setSigned(true);
      toast.success("계약서에 서명이 완료되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });

  // 캔버스 서명 초기화
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#60a5fa";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  }, [useTypedSignature]);

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
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
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e, canvasRef.current);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setIsDrawing(true);
    setHasSignature(true);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e, canvasRef.current);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const endDraw = () => setIsDrawing(false);

  const clearCanvas = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const handleSign = () => {
    if (!agreed) { toast.error("계약 내용에 동의해주세요."); return; }
    if (useTypedSignature && !signatureName.trim()) { toast.error("서명(성명)을 입력해주세요."); return; }
    if (!useTypedSignature && !hasSignature) { toast.error("서명을 그려주세요."); return; }

    let signatureData = signatureName;
    if (!useTypedSignature && canvasRef.current) {
      signatureData = canvasRef.current.toDataURL("image/png");
    }

    signMutation.mutate({ token, signatureData });
  };

  // 로딩
  if (contractQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">계약서를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  // 오류 (토큰 만료 / 없음)
  if (contractQuery.error || !contractQuery.data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <h2 className="text-lg font-bold">계약서를 찾을 수 없습니다</h2>
            <p className="text-sm text-muted-foreground">
              링크가 만료되었거나 유효하지 않습니다.<br />
              점장에게 새 링크를 요청해주세요.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 이미 서명 완료
  if (signed || contractQuery.data.status === "signed") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
            <CheckCircle className="h-12 w-12 text-emerald-500" />
            <h2 className="text-lg font-bold">서명이 완료되었습니다</h2>
            <p className="text-sm text-muted-foreground">
              근로계약서 서명이 정상적으로 완료되었습니다.<br />
              계약서 사본은 점장에게 요청하세요.
            </p>
            {contractQuery.data.signedAt && (
              <p className="text-xs text-muted-foreground">
                서명 일시: {new Date(contractQuery.data.signedAt).toLocaleString("ko-KR")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const ec = contractQuery.data;
  const contractTypeLabel: Record<string, string> = {
    permanent: "정규직 (무기계약)", fixed_term: "기간제 근로자",
    part_time: "단시간 근로자", daily: "일용직",
  };
  const wageTypeLabel = ec.wageType === "hourly" ? "시급" : "월급";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* 헤더 */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-2">
        <FileText className="h-5 w-5 text-blue-400" />
        <div>
          <h1 className="text-sm font-bold">근로계약서 서명</h1>
          <p className="text-xs text-muted-foreground">{ec.restaurantName ?? "매장"} · {ec.employeeName}님</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-4 pb-32">
        {/* 계약 요약 카드 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <PenLine className="h-4 w-4 text-blue-400" /> 계약 요약
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div className="text-muted-foreground text-xs">근로자</div>
              <div className="font-medium text-xs">{ec.employeeName}</div>
              <div className="text-muted-foreground text-xs">계약 유형</div>
              <div className="text-xs">{contractTypeLabel[ec.contractType]}</div>
              <div className="text-muted-foreground text-xs">근무지</div>
              <div className="text-xs">{ec.workPlace ?? ec.restaurantName}</div>
              <div className="text-muted-foreground text-xs">계약 기간</div>
              <div className="text-xs">
                {new Date(ec.contractStart).toLocaleDateString('ko-KR')}
                {ec.contractEnd ? ` ~ ${new Date(ec.contractEnd).toLocaleDateString('ko-KR')}` : " ~ 무기한"}
              </div>
              <div className="text-muted-foreground text-xs">근무 시간</div>
              <div className="text-xs">{ec.workStartTime} ~ {ec.workEndTime} (휴게 {ec.breakMinutes}분)</div>
              <div className="text-muted-foreground text-xs">주 소정근로</div>
              <div className="text-xs">{ec.weeklyHours}시간</div>
              <div className="text-muted-foreground text-xs">{wageTypeLabel}</div>
              <div className="text-xs font-semibold text-emerald-400">{Number(ec.wageAmount).toLocaleString()}원</div>
              <div className="text-muted-foreground text-xs">임금 지급일</div>
              <div className="text-xs">매월 {ec.payDay}일 ({ec.payMethod === "bank_transfer" ? "계좌이체" : "현금"})</div>
              {ec.mealProvided && (
                <>
                  <div className="text-muted-foreground text-xs">식사</div>
                  <div className="text-xs">현물 제공</div>
                </>
              )}
              {!ec.mealProvided && Number(ec.mealAllowance ?? 0) > 0 && (
                <>
                  <div className="text-muted-foreground text-xs">식대</div>
                  <div className="text-xs">{Number(ec.mealAllowance ?? 0).toLocaleString()}원/월</div>
                </>
              )}
              <div className="text-muted-foreground text-xs">4대보험</div>
              <div className="text-xs">{ec.socialInsurance ? "가입" : "미가입"}</div>
              {ec.over5Employees && (
                <>
                  <div className="text-muted-foreground text-xs">연장/야간/휴일수당</div>
                  <div className="text-xs">근로기준법 적용</div>
                </>
              )}
            </div>
            {ec.jobDescription && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1">담당 업무</p>
                <p className="text-xs">{ec.jobDescription}</p>
              </div>
            )}
            {ec.specialTerms && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1">특약사항</p>
                <p className="text-xs whitespace-pre-line">{ec.specialTerms}</p>
              </div>
            )}
            {ec.hasProbation && (ec.probationMonths ?? 0) > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded p-2 text-xs">
                ⚠️ 수습기간 {ec.probationMonths ?? 0}개월 적용 — 수습 중 임금은 최저임금의 90%가 적용됩니다.
              </div>
            )}
          </CardContent>
        </Card>

        {/* 법적 고지 */}
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-blue-300 leading-relaxed">
              본 계약서는 <strong>근로기준법</strong>에 따라 작성되었습니다. 서명 시 계약 내용에 동의한 것으로 간주되며,
              서명된 계약서는 법적 효력을 가집니다. 계약 내용에 이의가 있을 경우 서명 전 점장에게 문의하세요.
            </p>
          </CardContent>
        </Card>

        {/* 서명 영역 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">서명</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* 서명 방식 선택 */}
            <div className="flex gap-2">
              <Button
                variant={useTypedSignature ? "default" : "outline"}
                size="sm" className="flex-1 h-8 text-xs"
                onClick={() => setUseTypedSignature(true)}
              >
                이름으로 서명
              </Button>
              <Button
                variant={!useTypedSignature ? "default" : "outline"}
                size="sm" className="flex-1 h-8 text-xs"
                onClick={() => setUseTypedSignature(false)}
              >
                직접 서명
              </Button>
            </div>

            {useTypedSignature ? (
              <div className="space-y-1">
                <Label className="text-xs">성명 입력 (서명 대체)</Label>
                <Input
                  className="h-9 text-sm"
                  value={signatureName}
                  onChange={e => setSignatureName(e.target.value)}
                  placeholder={ec.employeeName}
                />
                <p className="text-xs text-muted-foreground">성명을 입력하면 전자서명으로 처리됩니다.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs">서명 (터치/마우스로 그리기)</Label>
                <canvas
                  ref={canvasRef}
                  width={400} height={150}
                  className="w-full rounded-lg border border-border cursor-crosshair touch-none"
                  style={{ background: "#1e293b" }}
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                  onTouchStart={startDraw}
                  onTouchMove={draw}
                  onTouchEnd={endDraw}
                />
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={clearCanvas}>
                  다시 그리기
                </Button>
              </div>
            )}

            {/* 동의 체크박스 */}
            <div className="flex items-start gap-2 pt-2">
              <Checkbox
                id="agree"
                checked={agreed}
                onCheckedChange={v => setAgreed(!!v)}
                className="mt-0.5"
              />
              <label htmlFor="agree" className="text-xs text-muted-foreground cursor-pointer leading-relaxed">
                위 근로계약서의 모든 내용을 확인하였으며, 이에 동의하고 서명합니다.
                본 서명은 법적 효력을 가지는 전자서명임을 인정합니다.
              </label>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 하단 고정 서명 버튼 */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur border-t border-border">
        <Button
          className="w-full h-12 text-base font-semibold bg-blue-600 hover:bg-blue-700"
          disabled={!agreed || signMutation.isPending || (!useTypedSignature && !hasSignature) || (useTypedSignature && !signatureName.trim())}
          onClick={handleSign}
        >
          {signMutation.isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-2" /> 서명 처리 중...</>
          ) : (
            <><CheckCircle className="h-4 w-4 mr-2" /> 계약서에 서명하기</>
          )}
        </Button>
        <p className="text-center text-xs text-muted-foreground mt-2">
          서명 후에는 취소할 수 없습니다
        </p>
      </div>
    </div>
  );
}
