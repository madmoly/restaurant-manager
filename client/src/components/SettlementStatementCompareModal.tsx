import { useState, useRef } from "react";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";
import {
  X, Upload, Loader2, CheckCircle2, AlertTriangle, AlertCircle,
  ImageIcon, Trash2, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";

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
type ActionType = "add_to_system" | "update_amount" | "dismiss";

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
  const [uploading, setUploading] = useState(false);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [selectedCpId, setSelectedCpId] = useState<number | null>(initialCounterpartyId ?? null);
  const [ocrResult, setOcrResult] = useState<OcrResponse | null>(null);
  const [comparison, setComparison] = useState<CompareResult | null>(null);
  const [auditId, setAuditId] = useState<number | null>(null);
  const [selectedActions, setSelectedActions] = useState<Map<string, ActionType>>(new Map());
  const [applying, setApplying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const counterpartiesQuery = trpc.counterparties.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 }
  );
  const compareMutation = trpc.settlementStatements.compareAndSave.useMutation();
  const applyMutation = trpc.settlementStatements.applySelectedActions.useMutation();

  // ─── 업로드 ───────────────────────────────────────────────────────────────
  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const newUrls: string[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          toast.error(`이미지 파일만 업로드 가능합니다: ${file.name}`);
          continue;
        }
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

  // ─── OCR + 비교 실행 ───────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (uploadedUrls.length === 0) {
      toast.error("이미지를 1장 이상 업로드해주세요");
      return;
    }
    setOcrProcessing(true);
    try {
      // 1) OCR 호출
      const ocrRes = await fetch("/api/ocr/extract-statement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrls: uploadedUrls,
          restaurantId,
          hintCounterpartyId: selectedCpId ?? undefined,
          hintYearMonth: yearMonth,
        }),
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
      imageUrl: uploadedUrls[0],
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
    comparison.items.forEach((row, idx) => {
      const action = selectedActions.get(itemKey(idx));
      if (!action) return;
      if (action === "add_to_system" && row.ocrItem) {
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
              uploading={uploading}
              ocrProcessing={ocrProcessing}
              fileInputRef={fileInputRef}
              counterpartyOptions={counterpartiesQuery.data ?? []}
              selectedCpId={selectedCpId}
              setSelectedCpId={setSelectedCpId}
              onFileSelect={handleFileSelect}
              onRemove={removeImage}
            />
          )}

          {step === "result" && (
            <ResultStep
              ocrResult={ocrResult}
              comparison={comparison}
              selectedCpId={selectedCpId}
              counterpartyOptions={counterpartiesQuery.data ?? []}
              selectedActions={selectedActions}
              onToggleAction={toggleAction}
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
                disabled={uploadedUrls.length === 0 || ocrProcessing}
              >
                {ocrProcessing ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> 분석 중...</> : "분석 시작"}
              </Button>
            </>
          )}
          {step === "result" && (
            <>
              <Button variant="outline" onClick={() => { setStep("upload"); setComparison(null); setOcrResult(null); setAuditId(null); setSelectedActions(new Map()); }}>
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
  uploading,
  ocrProcessing,
  fileInputRef,
  counterpartyOptions,
  selectedCpId,
  setSelectedCpId,
  onFileSelect,
  onRemove,
}: {
  uploadedUrls: string[];
  uploading: boolean;
  ocrProcessing: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  counterpartyOptions: any[];
  selectedCpId: number | null;
  setSelectedCpId: (id: number | null) => void;
  onFileSelect: (files: FileList | null) => void;
  onRemove: (idx: number) => void;
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
        <label className="text-sm font-medium text-foreground">정산표 이미지</label>
        <p className="text-xs text-muted-foreground mb-2">
          긴 정산표는 페이지별로 캡처하여 여러 장 업로드 가능합니다.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
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
              {uploading ? "업로드 중..." : "이미지 선택 또는 클릭"}
            </span>
            <span className="text-xs text-muted-foreground">정방향 촬영, 그림자 회피</span>
          </div>
        </button>

        {uploadedUrls.length > 0 && (
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
            {uploadedUrls.map((url, idx) => (
              <div key={idx} className="relative group">
                <img
                  src={url}
                  alt={`정산표 ${idx + 1}`}
                  className="w-full h-24 object-cover rounded border border-border"
                />
                <button
                  onClick={() => onRemove(idx)}
                  className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
                <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 rounded">
                  {idx + 1}/{uploadedUrls.length}
                </span>
              </div>
            ))}
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
  selectedActions,
  onToggleAction,
  onSelectCp,
  ocrProcessing,
}: {
  ocrResult: OcrResponse | null;
  comparison: CompareResult | null;
  selectedCpId: number | null;
  counterpartyOptions: any[];
  selectedActions: Map<string, "add_to_system" | "update_amount" | "dismiss">;
  onToggleAction: (idx: number, action: "add_to_system" | "update_amount" | "dismiss") => void;
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

      {/* item_mismatch: 4개 섹션 */}
      {comparison.level === "item_mismatch" && comparison.items && (
        <ItemMismatchSection
          items={comparison.items}
          selectedActions={selectedActions}
          onToggleAction={onToggleAction}
        />
      )}
    </div>
  );
}

// ─── 항목 불일치 섹션 ─────────────────────────────────────────────────────────
function ItemMismatchSection({
  items,
  selectedActions,
  onToggleAction,
}: {
  items: NonNullable<CompareResult["items"]>;
  selectedActions: Map<string, "add_to_system" | "update_amount" | "dismiss">;
  onToggleAction: (idx: number, action: "add_to_system" | "update_amount" | "dismiss") => void;
}) {
  // 종류별 분류 (인덱스 보존)
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
      {amountDiff.length > 0 && (
        <Section title={`금액 차이 (${amountDiff.length})`} color="red">
          {amountDiff.map(({ row, idx }) => (
            <ItemRow
              key={idx}
              row={row}
              actionType="update_amount"
              actionLabel="시스템 금액 → 정산표 금액으로 수정"
              isSelected={selectedActions.get(`item_${idx}`) === "update_amount"}
              onToggle={() => onToggleAction(idx, "update_amount")}
            />
          ))}
        </Section>
      )}

      {missingInSystem.length > 0 && (
        <Section title={`시스템 누락 — 정산표에는 있는데 시스템엔 없음 (${missingInSystem.length})`} color="amber">
          {missingInSystem.map(({ row, idx }) => (
            <ItemRow
              key={idx}
              row={row}
              actionType="add_to_system"
              actionLabel="시스템에 매입 추가"
              isSelected={selectedActions.get(`item_${idx}`) === "add_to_system"}
              onToggle={() => onToggleAction(idx, "add_to_system")}
            />
          ))}
        </Section>
      )}

      {missingInStatement.length > 0 && (
        <Section title={`정산표 누락 — 시스템에는 있는데 정산표엔 없음 (${missingInStatement.length})`} color="amber">
          {missingInStatement.map(({ row, idx }) => (
            <ItemRow
              key={idx}
              row={row}
              actionType="dismiss"
              actionLabel="무시 (반품/오입력 가능)"
              isSelected={selectedActions.get(`item_${idx}`) === "dismiss"}
              onToggle={() => onToggleAction(idx, "dismiss")}
            />
          ))}
        </Section>
      )}

      {matched.length > 0 && (
        <details className="border border-border rounded-lg">
          <summary className="px-3 py-2 text-xs font-medium text-muted-foreground cursor-pointer hover:bg-muted/30">
            정상 ({matched.length})
          </summary>
          <div className="p-2 space-y-1">
            {matched.map(({ row, idx }) => (
              <div key={idx} className="text-xs px-2 py-1 text-muted-foreground">
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

function Section({ title, color, children }: { title: string; color: "red" | "amber"; children: React.ReactNode }) {
  const colorClass = color === "red"
    ? "border-red-200 dark:border-red-900"
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
  actionType: "add_to_system" | "update_amount" | "dismiss";
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
