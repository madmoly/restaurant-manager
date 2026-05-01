import { useState, useRef, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";
import {
  X, Upload, Loader2, CheckCircle2, AlertTriangle, AlertCircle,
  Trash2, FileText, Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  spreadsheetToText,
  isSpreadsheetFile,
  isImageOrPdfFile,
  type SpreadsheetExtractResult,
} from "../lib/spreadsheetToText";

// ─── 타입 ─────────────────────────────────────────────────────────────────────
interface OcrItem {
  date: string;
  rawItemName: string;
  itemName: string;
  spec: string | null;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number;
  taxType: "taxable" | "exempt" | "unknown";
  uncertain: boolean;
  confidence: number;
}

interface OcrResponse {
  counterpartyName: string | null;
  counterpartyId: number | null;
  counterpartyBusinessNumber: string | null;
  counterpartyCandidates?: { id: number; name: string; score: number }[];
  yearMonth: string | null;
  documentType: string | null;
  items: OcrItem[];
  monthlySummary: {
    salesTotal: number | null;
    paymentTotal: number | null;
    balance: number | null;
  };
  rawText: string;
}

interface CompareResult {
  level: "monthly_match" | "date_mismatch" | "item_mismatch";
  monthly: { ocr: number; system: number; diff: number; ok: boolean; tolerance: number };
  dates?: { date: string; ocrTotal: number; systemTotal: number; diff: number; ok: boolean }[];
  items?: {
    kind: "match" | "amount_diff" | "missing_in_system" | "missing_in_statement";
    date: string;
    ocrItem?: OcrItem;
    systemItem?: { itemRowId: number; itemName: string; quantity: number | null; unitPrice: number | null; lineTotal: number };
    diff?: number;
  }[];
}

interface Props {
  restaurantId: number;
  initialCounterpartyId?: number | null;
  initialCounterpartyName?: string;
  yearMonth: string; // 'YYYY-MM'
  onClose: () => void;
  onApplied?: () => void; // 적용 후 매입 데이터 새로고침 트리거
}

type Step = "upload" | "result";
type ActionType = "link_alias" | "add_to_system" | "update_amount" | "dismiss";

// 입력 모드: 이미지/PDF는 업로드 후 imageUrls 사용, Excel/CSV는 클라이언트에서 spreadsheetText로 변환
type InputMode = "image" | "spreadsheet";

// 클라이언트에서 보관하는 정산표 입력 (이미지 URL or 스프레드시트 추출 결과)
interface SpreadsheetInput {
  fileName: string;
  result: SpreadsheetExtractResult;
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────
export default function SettlementStatementCompareModal({
  restaurantId,
  initialCounterpartyId,
  initialCounterpartyName,
  yearMonth,
  onClose,
  onApplied,
}: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [spreadsheet, setSpreadsheet] = useState<SpreadsheetInput | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [selectedCpId, setSelectedCpId] = useState<number | null>(initialCounterpartyId ?? null);
  const [ocrResult, setOcrResult] = useState<OcrResponse | null>(null);
  const [comparison, setComparison] = useState<CompareResult | null>(null);
  const [auditId, setAuditId] = useState<number | null>(null);
  const [selectedActions, setSelectedActions] = useState<Map<string, ActionType>>(new Map());
  // link_alias 액션이 가리키는 마스터 items.id (idx → itemId)
  const [aliasTargets, setAliasTargets] = useState<Map<number, number>>(new Map());
  const [applying, setApplying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const counterpartiesQuery = trpc.counterparties.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 }
  );
  const itemsQuery = trpc.items.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 }
  );
  const compareMutation = trpc.settlementStatements.compareAndSave.useMutation();
  const applyMutation = trpc.settlementStatements.applySelectedActions.useMutation();

  // 입력 모드 도출 (둘 다 비어있으면 기본 image)
  const inputMode: InputMode = spreadsheet ? "spreadsheet" : "image";
  const hasInput = uploadedUrls.length > 0 || !!spreadsheet;

  // ─── 업로드 ───────────────────────────────────────────────────────────────
  // 확장자별 분기:
  //   - 이미지/PDF: /api/upload/settlement-image 거쳐 URL 받음 (Vision 모드)
  //   - Excel/CSV: 클라이언트에서 SheetJS dump → spreadsheetText (텍스트 모드)
  // 두 모드는 상호 배타적 — 새 모드 파일이 들어오면 기존 입력은 초기화.
  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);

    // 모드 판정 (혼합 업로드 거부)
    const sheetFiles = arr.filter(isSpreadsheetFile);
    const imageFiles = arr.filter((f) => !isSpreadsheetFile(f) && isImageOrPdfFile(f));
    const unknownFiles = arr.filter((f) => !isSpreadsheetFile(f) && !isImageOrPdfFile(f));
    if (unknownFiles.length > 0) {
      toast.error(`지원하지 않는 형식: ${unknownFiles.map((f) => f.name).join(", ")}`);
      return;
    }
    if (sheetFiles.length > 0 && (imageFiles.length > 0 || uploadedUrls.length > 0)) {
      toast.error("Excel/CSV와 이미지/PDF를 한 번에 업로드할 수 없습니다. 한 모드만 사용해주세요.");
      return;
    }
    if (imageFiles.length > 0 && spreadsheet) {
      toast.error("이미 Excel/CSV가 등록되어 있습니다. 먼저 제거 후 이미지를 업로드해주세요.");
      return;
    }

    setUploading(true);
    try {
      // 1) Excel/CSV 모드 — 첫 파일만 사용 (다중 파일은 후속 과제)
      if (sheetFiles.length > 0) {
        if (sheetFiles.length > 1) {
          toast.warning("Excel/CSV는 한 번에 한 파일만 처리됩니다. 첫 파일만 사용합니다.");
        }
        const file = sheetFiles[0];
        const result = await spreadsheetToText(file);
        if (!result.text) {
          toast.error("스프레드시트에서 데이터를 추출하지 못했습니다. 빈 시트인지 확인해주세요.");
          return;
        }
        setSpreadsheet({ fileName: file.name, result });
        if (result.truncated) {
          toast.warning(
            `용량이 커서 일부 시트가 잘렸습니다 (${result.truncatedSheetNames?.join(", ")}). 파일을 분할 업로드해주세요.`
          );
        }
        return;
      }

      // 2) 이미지/PDF 모드 — 다중 업로드
      const newUrls: string[] = [];
      for (const file of imageFiles) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload/settlement-image", { method: "POST", body: form });
        if (!res.ok) throw new Error("업로드 실패");
        const { url } = await res.json();
        newUrls.push(url);
      }
      setUploadedUrls((prev) => [...prev, ...newUrls]);
    } catch (e: any) {
      toast.error(e.message || "업로드 실패");
    } finally {
      setUploading(false);
    }
  };

  const removeImage = (idx: number) => {
    setUploadedUrls((prev) => prev.filter((_, i) => i !== idx));
  };

  const removeSpreadsheet = () => {
    setSpreadsheet(null);
  };

  // ─── OCR + 비교 실행 ───────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!hasInput) {
      toast.error("이미지·PDF 또는 Excel/CSV 파일을 업로드해주세요");
      return;
    }
    setOcrProcessing(true);
    try {
      // 1) OCR 호출 — 모드별 페이로드 분기
      const payload: Record<string, unknown> = {
        restaurantId,
        hintCounterpartyId: selectedCpId ?? undefined,
        hintYearMonth: yearMonth,
      };
      if (inputMode === "image") {
        payload.imageUrls = uploadedUrls;
      } else {
        payload.spreadsheetText = spreadsheet?.result.text ?? "";
      }
      const ocrRes = await fetch("/api/ocr/extract-statement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!ocrRes.ok) {
        const err = await ocrRes.json().catch(() => ({}));
        throw new Error(err.error || "OCR 실패");
      }
      const ocr: OcrResponse = await ocrRes.json();
      setOcrResult(ocr);

      // 2) 거래처 결정: 명시적 선택 > OCR 매칭 > 후보 선택 대기
      const finalCpId = selectedCpId ?? ocr.counterpartyId;
      if (!finalCpId) {
        // 거래처 미매칭 — 사용자가 직접 선택해야 함
        setOcrProcessing(false);
        setStep("result");
        toast.warning("거래처를 자동 매칭하지 못했습니다. 직접 선택해주세요.");
        return;
      }
      setSelectedCpId(finalCpId);

      // 3) 비교 실행
      await runComparison(ocr, finalCpId);
    } catch (e: any) {
      toast.error(e.message || "분석 실패");
    } finally {
      setOcrProcessing(false);
    }
  };

  const runComparison = async (ocr: OcrResponse, cpId: number) => {
    const finalYearMonth = ocr.yearMonth || yearMonth;
    const result = await compareMutation.mutateAsync({
      restaurantId,
      counterpartyId: cpId,
      yearMonth: finalYearMonth,
      imageUrl: inputMode === "image" ? uploadedUrls[0] : undefined,
      ocrRawData: ocr,
      items: ocr.items,
      monthlySummary: ocr.monthlySummary,
      counterpartyNameRaw: ocr.counterpartyName,
    });
    setComparison(result.comparison as CompareResult);
    setAuditId(result.auditId);
    setStep("result");
  };

  // 거래처 미매칭 → 사용자 선택 후 재비교
  const handleSelectCpAndRerun = async (cpId: number) => {
    if (!ocrResult) return;
    setSelectedCpId(cpId);
    setOcrProcessing(true);
    try {
      await runComparison(ocrResult, cpId);
    } catch (e: any) {
      toast.error(e.message || "비교 실패");
    } finally {
      setOcrProcessing(false);
    }
  };

  // ─── 액션 적용 ────────────────────────────────────────────────────────────
  const itemKey = (idx: number) => `item_${idx}`;
  const toggleAction = (idx: number, action: ActionType) => {
    setSelectedActions((prev) => {
      const next = new Map(prev);
      const k = itemKey(idx);
      if (next.get(k) === action) {
        next.delete(k);
      } else {
        next.set(k, action);
      }
      return next;
    });
  };

  const handleApply = async () => {
    if (!auditId || !comparison?.items) return;
    const actions: any[] = [];
    const missingAliasTargets: number[] = [];
    comparison.items.forEach((row, idx) => {
      const action = selectedActions.get(itemKey(idx));
      if (!action) return;
      if (action === "link_alias" && row.ocrItem) {
        const targetItemId = aliasTargets.get(idx);
        if (!targetItemId) {
          missingAliasTargets.push(idx);
          return;
        }
        actions.push({ type: "link_alias", ocrItem: row.ocrItem, targetItemId });
      } else if (action === "add_to_system" && row.ocrItem) {
        actions.push({ type: "add_to_system", ocrItem: row.ocrItem });
      } else if (action === "update_amount" && row.ocrItem && row.systemItem) {
        actions.push({
          type: "update_amount",
          ocrItem: row.ocrItem,
          targetItemRowId: row.systemItem.itemRowId,
        });
      } else if (action === "dismiss") {
        actions.push({ type: "dismiss", note: `idx=${idx}` });
      }
    });
    if (missingAliasTargets.length > 0) {
      toast.error("alias로 연결할 마스터 품목을 선택해주세요");
      return;
    }
    if (actions.length === 0) {
      toast.error("적용할 항목을 선택해주세요");
      return;
    }
    setApplying(true);
    try {
      await applyMutation.mutateAsync({ auditId, restaurantId, actions });
      toast.success(`${actions.length}건 적용 완료`);
      onApplied?.();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "적용 실패");
    } finally {
      setApplying(false);
    }
  };

  // alias 타겟 itemId 변경
  const setAliasTarget = (idx: number, itemId: number | null) => {
    setAliasTargets((prev) => {
      const next = new Map(prev);
      if (itemId == null) next.delete(idx);
      else next.set(idx, itemId);
      return next;
    });
  };

  // ─── 렌더링 ───────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <FileText className="w-4 h-4" />
            정산표 대조
            <span className="text-xs text-muted-foreground font-normal">
              {yearMonth}{initialCounterpartyName ? ` · ${initialCounterpartyName}` : ""}
            </span>
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-4">
          {step === "upload" && (
            <UploadStep
              uploadedUrls={uploadedUrls}
              spreadsheet={spreadsheet}
              uploading={uploading}
              ocrProcessing={ocrProcessing}
              fileInputRef={fileInputRef}
              counterpartyOptions={counterpartiesQuery.data ?? []}
              selectedCpId={selectedCpId}
              setSelectedCpId={setSelectedCpId}
              onFileSelect={handleFileSelect}
              onRemoveImage={removeImage}
              onRemoveSpreadsheet={removeSpreadsheet}
            />
          )}

          {step === "result" && (
            <ResultStep
              ocrResult={ocrResult}
              comparison={comparison}
              selectedCpId={selectedCpId}
              counterpartyOptions={counterpartiesQuery.data ?? []}
              itemOptions={itemsQuery.data ?? []}
              selectedActions={selectedActions}
              aliasTargets={aliasTargets}
              onToggleAction={toggleAction}
              onAliasTargetChange={setAliasTarget}
              onSelectCp={handleSelectCpAndRerun}
              ocrProcessing={ocrProcessing}
            />
          )}
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border bg-muted/30">
          {step === "upload" && (
            <>
              <Button variant="outline" onClick={onClose}>취소</Button>
              <Button
                onClick={handleAnalyze}
                disabled={!hasInput || ocrProcessing}
              >
                {ocrProcessing ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> 분석 중...</> : "분석 시작"}
              </Button>
            </>
          )}
          {step === "result" && (
            <>
              <Button variant="outline" onClick={() => {
                setStep("upload");
                setComparison(null);
                setOcrResult(null);
                setAuditId(null);
                setSelectedActions(new Map());
                setAliasTargets(new Map());
              }}>
                다시 업로드
              </Button>
              {comparison?.level === "item_mismatch" && (
                <Button onClick={handleApply} disabled={applying || selectedActions.size === 0}>
                  {applying ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> 적용 중...</> : `선택 항목 적용 (${selectedActions.size})`}
                </Button>
              )}
              {comparison && comparison.level !== "item_mismatch" && (
                <Button onClick={onClose}>닫기</Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: 업로드 ───────────────────────────────────────────────────────────
function UploadStep({
  uploadedUrls,
  spreadsheet,
  uploading,
  ocrProcessing,
  fileInputRef,
  counterpartyOptions,
  selectedCpId,
  setSelectedCpId,
  onFileSelect,
  onRemoveImage,
  onRemoveSpreadsheet,
}: {
  uploadedUrls: string[];
  spreadsheet: SpreadsheetInput | null;
  uploading: boolean;
  ocrProcessing: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  counterpartyOptions: any[];
  selectedCpId: number | null;
  setSelectedCpId: (id: number | null) => void;
  onFileSelect: (files: FileList | null) => void;
  onRemoveImage: (idx: number) => void;
  onRemoveSpreadsheet: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-foreground">거래처</label>
        <select
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={selectedCpId ?? ""}
          onChange={(e) => setSelectedCpId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">OCR로 자동 감지</option>
          {counterpartyOptions.map((c: any) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground mt-1">
          미선택 시 정산표의 거래처명을 OCR로 인식해 자동 매칭합니다.
        </p>
      </div>

      <div>
        <label className="text-sm font-medium text-foreground">정산표 파일</label>
        <p className="text-xs text-muted-foreground mb-2">
          이미지/PDF는 여러 장, Excel/CSV는 한 파일. 모드 혼합 업로드는 지원하지 않습니다.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.heic,.heif,.pdf,.xlsx,.xls,.csv,image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => { onFileSelect(e.target.files); e.target.value = ""; }}
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || ocrProcessing}
          className="w-full border-2 border-dashed border-border rounded-lg py-6 px-4 hover:border-primary hover:bg-accent/30 transition-colors disabled:opacity-50"
        >
          <div className="flex flex-col items-center gap-2">
            {uploading ? (
              <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
            ) : (
              <Upload className="w-6 h-6 text-muted-foreground" />
            )}
            <span className="text-sm text-foreground">
              {uploading ? "처리 중..." : "파일 선택 또는 클릭"}
            </span>
            <span className="text-xs text-muted-foreground">
              사진/PDF (정방향 촬영) · Excel/CSV (디지털 발행)
            </span>
          </div>
        </button>

        {/* 이미지/PDF 미리보기 */}
        {uploadedUrls.length > 0 && (
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
            {uploadedUrls.map((url, idx) => {
              const isPdf = url.toLowerCase().endsWith(".pdf");
              return (
                <div key={idx} className="relative group">
                  {isPdf ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full h-24 rounded border border-border bg-muted/30 flex flex-col items-center justify-center gap-1 hover:bg-muted/50"
                      title="새 탭에서 열기"
                    >
                      <FileText className="w-7 h-7 text-muted-foreground" />
                      <span className="text-[10px] font-medium text-muted-foreground">PDF</span>
                    </a>
                  ) : (
                    <img
                      src={url}
                      alt={`정산표 ${idx + 1}`}
                      className="w-full h-24 object-cover rounded border border-border"
                    />
                  )}
                  <button
                    onClick={() => onRemoveImage(idx)}
                    className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                  <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 rounded">
                    {idx + 1}/{uploadedUrls.length}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Excel/CSV 카드 */}
        {spreadsheet && (
          <div className="mt-3 border border-border rounded-lg p-3 bg-muted/20 flex items-start gap-2">
            <FileText className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0 text-xs">
              <div className="font-medium text-foreground truncate">{spreadsheet.fileName}</div>
              <div className="text-muted-foreground mt-0.5">
                시트 {spreadsheet.result.sheetCount}개 · 약 {spreadsheet.result.text.length.toLocaleString()}자
                {spreadsheet.result.truncated && " · 일부 잘림"}
              </div>
            </div>
            <button
              onClick={onRemoveSpreadsheet}
              className="p-1 rounded hover:bg-accent shrink-0"
              title="제거"
            >
              <Trash2 className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 2: 결과 ─────────────────────────────────────────────────────────────
function ResultStep({
  ocrResult,
  comparison,
  selectedCpId,
  counterpartyOptions,
  itemOptions,
  selectedActions,
  aliasTargets,
  onToggleAction,
  onAliasTargetChange,
  onSelectCp,
  ocrProcessing,
}: {
  ocrResult: OcrResponse | null;
  comparison: CompareResult | null;
  selectedCpId: number | null;
  counterpartyOptions: any[];
  itemOptions: { id: number; name: string }[];
  selectedActions: Map<string, ActionType>;
  aliasTargets: Map<number, number>;
  onToggleAction: (idx: number, action: ActionType) => void;
  onAliasTargetChange: (idx: number, itemId: number | null) => void;
  onSelectCp: (cpId: number) => void;
  ocrProcessing: boolean;
}) {
  // 거래처 미매칭 케이스
  if (ocrResult && !selectedCpId) {
    return (
      <div className="space-y-4">
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-700 dark:text-amber-300">
            <p className="font-medium">거래처를 자동 매칭하지 못했습니다.</p>
            <p className="mt-1">OCR 인식: {ocrResult.counterpartyName || "(없음)"}</p>
            <p>아래에서 직접 선택해주세요.</p>
          </div>
        </div>

        {ocrResult.counterpartyCandidates && ocrResult.counterpartyCandidates.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">유사 거래처 후보</p>
            <div className="space-y-1">
              {ocrResult.counterpartyCandidates.map((cand) => (
                <button
                  key={cand.id}
                  onClick={() => onSelectCp(cand.id)}
                  disabled={ocrProcessing}
                  className="w-full text-left px-3 py-2 rounded border border-border hover:border-primary hover:bg-accent/30 transition-colors text-sm disabled:opacity-50"
                >
                  <span className="font-medium">{cand.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    유사도 {Math.round(cand.score * 100)}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="text-sm font-medium text-foreground">전체 거래처 목록</label>
          <select
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            disabled={ocrProcessing}
            onChange={(e) => e.target.value && onSelectCp(Number(e.target.value))}
            defaultValue=""
          >
            <option value="">선택...</option>
            {counterpartyOptions.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {ocrProcessing && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> 비교 실행 중...
          </div>
        )}
      </div>
    );
  }

  if (!comparison) return <div className="text-center text-muted-foreground py-8">결과 없음</div>;

  // 비교 결과 헤더 (월합계)
  const monthlyHeader = (
    <div className={`p-3 rounded-lg border flex items-start gap-2 ${
      comparison.level === "monthly_match"
        ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900"
        : comparison.level === "date_mismatch"
        ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900"
        : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900"
    }`}>
      {comparison.level === "monthly_match" ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
      ) : (
        <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${
          comparison.level === "date_mismatch" ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"
        }`} />
      )}
      <div className="text-xs flex-1">
        <p className="font-medium text-foreground">
          {comparison.level === "monthly_match"
            ? `월합계 일치 (오차 ±${comparison.monthly.tolerance.toLocaleString()}원 이내)`
            : comparison.level === "date_mismatch"
            ? "월합계만 차이 — 일자별 합계는 모두 일치"
            : "항목 단위 차이 발견"}
        </p>
        <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
          <div>
            <span className="text-muted-foreground">정산표</span>
            <div className="font-medium tabular-nums">{comparison.monthly.ocr.toLocaleString()}원</div>
          </div>
          <div>
            <span className="text-muted-foreground">시스템</span>
            <div className="font-medium tabular-nums">{comparison.monthly.system.toLocaleString()}원</div>
          </div>
          <div>
            <span className="text-muted-foreground">차이</span>
            <div className={`font-medium tabular-nums ${
              comparison.monthly.diff === 0 ? "text-foreground" : comparison.monthly.diff > 0 ? "text-amber-600" : "text-red-600"
            }`}>
              {comparison.monthly.diff > 0 ? "+" : ""}{comparison.monthly.diff.toLocaleString()}원
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {monthlyHeader}

      {/* date_mismatch: 일자별 표 */}
      {comparison.level === "date_mismatch" && comparison.dates && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">일자별 합계 (모두 일치)</p>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-1.5">일자</th>
                  <th className="text-right px-3 py-1.5">정산표</th>
                  <th className="text-right px-3 py-1.5">시스템</th>
                  <th className="text-right px-3 py-1.5">차이</th>
                </tr>
              </thead>
              <tbody>
                {comparison.dates.map((d) => (
                  <tr key={d.date} className="border-t border-border">
                    <td className="px-3 py-1.5">{d.date}</td>
                    <td className="text-right px-3 py-1.5 tabular-nums">{d.ocrTotal.toLocaleString()}</td>
                    <td className="text-right px-3 py-1.5 tabular-nums">{d.systemTotal.toLocaleString()}</td>
                    <td className={`text-right px-3 py-1.5 tabular-nums ${d.diff === 0 ? "" : d.diff > 0 ? "text-amber-600" : "text-red-600"}`}>
                      {d.diff > 0 ? "+" : ""}{d.diff.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* item_mismatch: 5개 섹션 (spec §4.2.c) */}
      {comparison.level === "item_mismatch" && comparison.items && (
        <ItemMismatchSection
          items={comparison.items}
          itemOptions={itemOptions}
          selectedActions={selectedActions}
          aliasTargets={aliasTargets}
          onToggleAction={onToggleAction}
          onAliasTargetChange={onAliasTargetChange}
        />
      )}
    </div>
  );
}

// ─── 항목 불일치 섹션 (spec §4.2.c 5섹션) ────────────────────────────────────
// missing_in_system 항목은 [품목 매칭 필요] / [시스템 누락] 두 섹션에 모두 노출되며,
// selectedActions가 idx 단일 키라 한 항목에 link_alias / add_to_system 중 하나만 선택됨.
function ItemMismatchSection({
  items,
  itemOptions,
  selectedActions,
  aliasTargets,
  onToggleAction,
  onAliasTargetChange,
}: {
  items: NonNullable<CompareResult["items"]>;
  itemOptions: { id: number; name: string }[];
  selectedActions: Map<string, ActionType>;
  aliasTargets: Map<number, number>;
  onToggleAction: (idx: number, action: ActionType) => void;
  onAliasTargetChange: (idx: number, itemId: number | null) => void;
}) {
  type IndexedItem = { row: NonNullable<CompareResult["items"]>[number]; idx: number };
  const amountDiff: IndexedItem[] = [];
  const missingInSystem: IndexedItem[] = [];
  const missingInStatement: IndexedItem[] = [];
  const matched: IndexedItem[] = [];
  items.forEach((row, idx) => {
    const ie = { row, idx };
    if (row.kind === "amount_diff") amountDiff.push(ie);
    else if (row.kind === "missing_in_system") missingInSystem.push(ie);
    else if (row.kind === "missing_in_statement") missingInStatement.push(ie);
    else matched.push(ie);
  });

  return (
    <div className="space-y-4">
      {/* 1) 품목 매칭 필요 — link_alias */}
      {missingInSystem.length > 0 && (
        <Section title={`① 품목 매칭 필요 — 마스터 품목과 연결 (${missingInSystem.length})`} color="blue">
          <p className="text-[11px] text-muted-foreground px-1 pb-1">
            정산표에만 있는 품목입니다. 우리 시스템 마스터 품목과 연결하면 다음 정산표부터 자동 매칭됩니다.
          </p>
          {missingInSystem.map(({ row, idx }) => (
            <LinkAliasRow
              key={`alias_${idx}`}
              row={row}
              itemOptions={itemOptions}
              isSelected={selectedActions.get(`item_${idx}`) === "link_alias"}
              targetItemId={aliasTargets.get(idx) ?? null}
              onToggle={() => onToggleAction(idx, "link_alias")}
              onTargetChange={(itemId) => onAliasTargetChange(idx, itemId)}
            />
          ))}
        </Section>
      )}

      {/* 2) 금액 차이 — update_amount */}
      {amountDiff.length > 0 && (
        <Section title={`② 금액 차이 (${amountDiff.length})`} color="red">
          {amountDiff.map(({ row, idx }) => (
            <ItemRow
              key={`amt_${idx}`}
              row={row}
              actionLabel="시스템 금액 → 정산표 금액으로 수정"
              isSelected={selectedActions.get(`item_${idx}`) === "update_amount"}
              onToggle={() => onToggleAction(idx, "update_amount")}
            />
          ))}
        </Section>
      )}

      {/* 3) 시스템 누락 — add_to_system (1번과 동일 항목, 다른 처리) */}
      {missingInSystem.length > 0 && (
        <Section title={`③ 시스템 누락 — 매입으로 그대로 추가 (${missingInSystem.length})`} color="amber">
          <p className="text-[11px] text-muted-foreground px-1 pb-1">
            마스터 품목 연결 없이 정산표 내용 그대로 매입에 추가합니다. (alias 학습 X)
          </p>
          {missingInSystem.map(({ row, idx }) => (
            <ItemRow
              key={`add_${idx}`}
              row={row}
              actionLabel="시스템에 매입 추가"
              isSelected={selectedActions.get(`item_${idx}`) === "add_to_system"}
              onToggle={() => onToggleAction(idx, "add_to_system")}
            />
          ))}
        </Section>
      )}

      {/* 4) 정산표 누락 — dismiss */}
      {missingInStatement.length > 0 && (
        <Section title={`④ 정산표 누락 — 시스템에는 있는데 정산표엔 없음 (${missingInStatement.length})`} color="amber">
          {missingInStatement.map(({ row, idx }) => (
            <ItemRow
              key={`dis_${idx}`}
              row={row}
              actionLabel="무시 (반품/오입력 가능)"
              isSelected={selectedActions.get(`item_${idx}`) === "dismiss"}
              onToggle={() => onToggleAction(idx, "dismiss")}
            />
          ))}
        </Section>
      )}

      {/* 5) 정상 — 접힘 */}
      {matched.length > 0 && (
        <details className="border border-border rounded-lg">
          <summary className="px-3 py-2 text-xs font-medium text-muted-foreground cursor-pointer hover:bg-muted/30">
            ⑤ 정상 ({matched.length})
          </summary>
          <div className="p-2 space-y-1">
            {matched.map(({ row, idx }) => (
              <div key={`ok_${idx}`} className="text-xs px-2 py-1 text-muted-foreground">
                <span className="font-medium">{row.date}</span>
                {" · "}
                {row.ocrItem?.itemName ?? row.systemItem?.itemName}
                {" · "}
                <span className="tabular-nums">{(row.ocrItem?.lineTotal ?? row.systemItem?.lineTotal ?? 0).toLocaleString()}원</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Section({ title, color, children }: { title: string; color: "red" | "amber" | "blue"; children: React.ReactNode }) {
  const colorClass = color === "red"
    ? "border-red-200 dark:border-red-900"
    : color === "blue"
    ? "border-blue-200 dark:border-blue-900"
    : "border-amber-200 dark:border-amber-900";
  return (
    <div>
      <p className="text-xs font-medium text-foreground mb-2">{title}</p>
      <div className={`space-y-1.5 border rounded-lg p-2 ${colorClass}`}>
        {children}
      </div>
    </div>
  );
}

function ItemRow({
  row,
  actionLabel,
  isSelected,
  onToggle,
}: {
  row: NonNullable<CompareResult["items"]>[number];
  actionLabel: string;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex items-start gap-2 p-2 rounded hover:bg-muted/30 cursor-pointer">
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onToggle}
        className="mt-0.5 rounded border-input"
      />
      <div className="flex-1 min-w-0 text-xs">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-medium">{row.date}</span>
          <span className="text-foreground truncate">
            {row.ocrItem?.itemName || row.systemItem?.itemName}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-muted-foreground">
          {row.ocrItem && (
            <div>
              <span className="text-[10px]">정산표</span>
              <div className="tabular-nums">
                {row.ocrItem.quantity ?? "-"} × {row.ocrItem.unitPrice?.toLocaleString() ?? "-"} = {row.ocrItem.lineTotal.toLocaleString()}원
              </div>
            </div>
          )}
          {row.systemItem && (
            <div>
              <span className="text-[10px]">시스템</span>
              <div className="tabular-nums">
                {row.systemItem.quantity ?? "-"} × {row.systemItem.unitPrice?.toLocaleString() ?? "-"} = {row.systemItem.lineTotal.toLocaleString()}원
              </div>
            </div>
          )}
        </div>
        {row.diff != null && row.diff !== 0 && (
          <div className={`mt-1 ${row.diff > 0 ? "text-amber-600" : "text-red-600"} text-[11px]`}>
            차이: {row.diff > 0 ? "+" : ""}{row.diff.toLocaleString()}원
          </div>
        )}
        <div className="mt-1 text-primary text-[11px]">{actionLabel}</div>
      </div>
    </label>
  );
}

// ─── link_alias 전용 행 (items 검색 + 마스터 품목 dropdown) ─────────────────
function LinkAliasRow({
  row,
  itemOptions,
  isSelected,
  targetItemId,
  onToggle,
  onTargetChange,
}: {
  row: NonNullable<CompareResult["items"]>[number];
  itemOptions: { id: number; name: string }[];
  isSelected: boolean;
  targetItemId: number | null;
  onToggle: () => void;
  onTargetChange: (itemId: number | null) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    if (!query.trim()) return itemOptions.slice(0, 30);
    const q = query.trim().toLowerCase();
    return itemOptions.filter((it) => it.name.toLowerCase().includes(q)).slice(0, 30);
  }, [itemOptions, query]);

  const selectedItem = targetItemId ? itemOptions.find((i) => i.id === targetItemId) : null;

  return (
    <div className="p-2 rounded hover:bg-muted/30">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggle}
          className="mt-0.5 rounded border-input"
        />
        <div className="flex-1 min-w-0 text-xs">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-medium">{row.date}</span>
            <span className="text-foreground truncate">
              {row.ocrItem?.itemName || row.ocrItem?.rawItemName}
            </span>
            <span className="text-muted-foreground tabular-nums shrink-0">
              {row.ocrItem?.lineTotal.toLocaleString()}원
            </span>
          </div>
          {row.ocrItem?.rawItemName && row.ocrItem.rawItemName !== row.ocrItem.itemName && (
            <div className="text-[11px] text-muted-foreground">
              원문: <span className="font-mono">{row.ocrItem.rawItemName}</span>
            </div>
          )}
        </div>
      </label>

      {isSelected && (
        <div className="mt-2 ml-6 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Link2 className="w-3 h-3" />
            마스터 품목 선택
          </div>
          <input
            type="text"
            placeholder="품목명 검색..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full text-xs rounded-md border border-input bg-background px-2 py-1"
          />
          <select
            value={targetItemId ?? ""}
            onChange={(e) => onTargetChange(e.target.value ? Number(e.target.value) : null)}
            className="w-full text-xs rounded-md border border-input bg-background px-2 py-1"
          >
            <option value="">— 선택 —</option>
            {filtered.map((it) => (
              <option key={it.id} value={it.id}>{it.name}</option>
            ))}
          </select>
          {selectedItem && (
            <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
              ✓ <span className="font-mono">{row.ocrItem?.rawItemName}</span> → {selectedItem.name}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
