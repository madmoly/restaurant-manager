import { useState, useRef } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useParams } from "wouter";
import { toast } from "sonner";
import { Plus, Trash2, Receipt, Camera, Loader2, AlertCircle } from "lucide-react";
import { Button, Card, Input, MonthNav, PageHeader, EmptyState, Loading, Modal } from "@/components/ui/compat";
import { resizeImage, OCR_HIGH } from "@/lib/imageResize";

// ─── OCR 타입 ──────────────────────────────────────────────

interface SalesOcrItem {
  label: string;
  count: number;
  amount: number;
  type: "cash" | "card" | "giftcard" | "transfer" | "point" | "delivery" | "discount" | "subtotal" | "other";
  confidence?: "high" | "medium" | "low";
}

interface SalesOcrResponse {
  posVendor: string;
  saleDate: string;
  receiptNo: string;
  items: SalesOcrItem[];
  totalAmount: number;
  confidence: "high" | "medium" | "low";
  mapped: {
    cashAmount: number;
    cardAmount: number;
    giftCardAmount: number;
    transferAmount: number;
    discountAmount: number;
    otherAmount: number;
    totalAmount: number;
  };
}

// ─── 메인 페이지 ──────────────────────────────────────────

export default function SalesPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const params = useParams<{ restaurantId?: string }>();
  const restaurantId = params.restaurantId ? Number(params.restaurantId) : (current?.id ?? 0);

  const today = new Date();
  const _biz = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const todayStr = `${_biz.getFullYear()}-${String(_biz.getMonth() + 1).padStart(2, "0")}-${String(_biz.getDate()).padStart(2, "0")}`;
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [showAdd, setShowAdd] = useState(false);
  const [showOcr, setShowOcr] = useState(false);
  const [ocrResult, setOcrResult] = useState<SalesOcrResponse | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const { data: restaurant } = trpc.restaurants.get.useQuery({ id: restaurantId }, { enabled: restaurantId > 0 });
  const { data: salesList, isLoading } = trpc.sales.listByMonth.useQuery({ restaurantId, year, month }, { enabled: restaurantId > 0 });
  const { data: monthlyTotal } = trpc.sales.monthlyTotal.useQuery({ restaurantId, year, month }, { enabled: restaurantId > 0 });

  const deleteSale = trpc.sales.delete.useMutation({
    onSuccess() { toast.success("삭제됨"); invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const invalidate = () => {
    utils.sales.listByMonth.invalidate();
    utils.sales.monthlyTotal.invalidate();
  };

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };

  // ─── OCR 촬영/선택 → 업로드 → 분석 ───
  const handleOcrCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 리셋 input
    e.target.value = "";

    try {
      setOcrLoading(true);
      setOcrResult(null);

      // 1. 이미지 리사이즈
      const resized = await resizeImage(file, OCR_HIGH);

      // 2. 업로드
      const formData = new FormData();
      formData.append("photo", resized);
      const uploadRes = await fetch("/api/upload/order-image", { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error("이미지 업로드 실패");
      const { url } = await uploadRes.json();

      // 3. OCR 분석
      toast.info("전표 분석 중...");
      const ocrRes = await fetch("/api/ocr/extract-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: url, restaurantId }),
      });
      if (!ocrRes.ok) {
        const errData = await ocrRes.json().catch(() => ({}));
        throw new Error(errData.error || "OCR 처리 실패");
      }
      const data: SalesOcrResponse = await ocrRes.json();
      setOcrResult(data);
      setShowOcr(true);
      toast.success("전표 인식 완료");
    } catch (err: any) {
      toast.error(err.message || "전표 인식 실패");
    } finally {
      setOcrLoading(false);
    }
  };

  if (!restaurantId) return <EmptyState icon={<Receipt size={40} />} title="매장을 선택해주세요" />;

  return (
    <div>
      <PageHeader
        title={`${restaurant?.name ?? ""} 매출`}
        action={
          <div className="flex gap-2">
            <Button onClick={() => fileInputRef.current?.click()} size="sm" variant="secondary" disabled={ocrLoading}>
              {ocrLoading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
              <span className="hidden sm:inline ml-1">전표 촬영</span>
            </Button>
            <Button onClick={() => setShowAdd(true)} size="sm">
              <Plus size={16} /> <span className="hidden sm:inline ml-1">매출 입력</span>
            </Button>
          </div>
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleOcrCapture}
      />

      <MonthNav
        year={year}
        month={month}
        onPrev={prevMonth}
        onNext={nextMonth}
        rightSlot={
          <span className="text-sm font-bold text-foreground tabular-nums">
            합계 {Number(monthlyTotal?.total ?? 0).toLocaleString()}원
          </span>
        }
      />

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="매출 입력">
        <AddSaleForm restaurantId={restaurantId} onDone={() => { setShowAdd(false); invalidate(); }} />
      </Modal>

      {showOcr && ocrResult && (
        <Modal open={showOcr} onClose={() => setShowOcr(false)} title="매출 전표 인식 결과" maxWidth="max-w-2xl">
          <OcrResultEditor
            restaurantId={restaurantId}
            ocrResult={ocrResult}
            onDone={() => { setShowOcr(false); setOcrResult(null); invalidate(); }}
            onCancel={() => { setShowOcr(false); setOcrResult(null); }}
          />
        </Modal>
      )}

      {isLoading ? <Loading /> : !salesList?.length ? (
        <EmptyState
          icon={<Receipt size={36} />}
          title="이번 달 매출 기록이 없습니다"
          description="매출 입력 또는 전표 촬영으로 기록을 시작하세요"
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">날짜</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">금액</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground hidden sm:table-cell">메모</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {salesList.map((s: any) => (
                  <tr key={s.id} className={`border-b border-border/50 hover:bg-accent/50 ${String(s.saleDate).slice(0, 10) === todayStr ? "bg-primary/5" : ""}`}>
                    <td className="px-4 py-3 tabular-nums">
                      <span className={String(s.saleDate).slice(0, 10) === todayStr ? "text-primary font-semibold" : "text-foreground"}>
                        {String(s.saleDate).slice(5)}
                      </span>
                      {String(s.saleDate).slice(0, 10) === todayStr && <span className="ml-1.5 text-[10px] text-primary font-medium">오늘</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground tabular-nums">{Number(s.amount).toLocaleString()}원</td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell truncate max-w-[200px]">{s.note || "—"}</td>
                    <td className="px-2">
                      <button
                        onClick={() => { if (confirm("삭제하시겠습니까?")) deleteSale.mutate({ id: s.id, restaurantId }); }}
                        className="text-muted-foreground/50 hover:text-red-500 p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── 수동 매출 입력 폼 ──────────────────────────────────────

function AddSaleForm({ restaurantId, onDone }: { restaurantId: number; onDone: () => void }) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const [saleDate, setSaleDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const create = trpc.sales.create.useMutation({
    onSuccess() { toast.success("매출 등록 완료"); onDone(); },
    onError(err) { toast.error(err.message); },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Input label="날짜" type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
        <Input label="금액 (원)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
      </div>
      <Input label="메모 (선택)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="메모" />
      <div className="flex gap-2 pt-2">
        <Button onClick={() => create.mutate({ restaurantId, saleDate, amount, note })} disabled={!amount || create.isPending}>
          {create.isPending ? "등록 중..." : "등록"}
        </Button>
        <Button variant="secondary" onClick={onDone}>취소</Button>
      </div>
    </div>
  );
}

// ─── OCR 결과 편집 모달 ─────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  cash: "현금", card: "카드", giftcard: "상품권", transfer: "이체",
  point: "포인트", delivery: "배달앱", discount: "할인", subtotal: "소계", other: "기타",
};

const CONFIDENCE_ICON: Record<string, string> = {
  high: "🟢", medium: "🟡", low: "🔴",
};

function OcrResultEditor({
  restaurantId,
  ocrResult,
  onDone,
  onCancel,
}: {
  restaurantId: number;
  ocrResult: SalesOcrResponse;
  onDone: () => void;
  onCancel: () => void;
}) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const [saleDate, setSaleDate] = useState(ocrResult.saleDate || todayStr);
  const [cashAmount, setCashAmount] = useState(String(ocrResult.mapped.cashAmount));
  const [cardAmount, setCardAmount] = useState(String(ocrResult.mapped.cardAmount));
  const [giftCardAmount, setGiftCardAmount] = useState(String(ocrResult.mapped.giftCardAmount));
  const [transferAmount, setTransferAmount] = useState(String(ocrResult.mapped.transferAmount));
  const [discountAmount, setDiscountAmount] = useState(String(ocrResult.mapped.discountAmount));
  const [otherAmount, setOtherAmount] = useState(String(ocrResult.mapped.otherAmount));

  const total = [cashAmount, cardAmount, giftCardAmount, transferAmount, otherAmount]
    .reduce((s, v) => s + (Number(v) || 0), 0);

  const upsert = trpc.sales.upsertDetail.useMutation({
    onSuccess(data) {
      toast.success(data.isUpdate ? "매출 상세 수정 완료" : "매출 상세 등록 완료");
      onDone();
    },
    onError(err) { toast.error(err.message); },
  });

  const handleSave = () => {
    upsert.mutate({
      restaurantId,
      saleDate,
      cashAmount,
      cardAmount,
      giftCardAmount,
      transferAmount,
      discountAmount,
      otherAmount,
      totalAmount: String(total),
      source: "ocr",
      ocrRawData: ocrResult as any,
    });
  };

  const paymentItems = ocrResult.items.filter(i => i.type !== "subtotal");

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto">
      {/* 전표 기본 정보 */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>POS: {ocrResult.posVendor || "—"}</span>
        {ocrResult.receiptNo && <span>전표 #{ocrResult.receiptNo}</span>}
        <span className="ml-auto">{CONFIDENCE_ICON[ocrResult.confidence] || "🟡"} 인식 신뢰도</span>
      </div>

      {/* 날짜 */}
      <Input label="날짜" type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />

      {/* OCR 추출 항목 (읽기 전용) */}
      {paymentItems.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">추출된 항목</p>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">항목명</th>
                  <th className="text-center px-2 py-2 text-xs font-medium text-muted-foreground">분류</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">건수</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">금액</th>
                </tr>
              </thead>
              <tbody>
                {paymentItems.map((item, idx) => (
                  <tr key={idx} className="border-t border-border/50">
                    <td className="px-3 py-2">
                      {CONFIDENCE_ICON[item.confidence || "high"]} {item.label}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{TYPE_LABELS[item.type] || item.type}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{item.count || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{item.amount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 합계 불일치 경고 */}
      {ocrResult.confidence === "low" && (
        <div className="flex items-start gap-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
          <AlertCircle size={16} className="text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
          <p className="text-xs text-yellow-700 dark:text-yellow-300">
            항목 합계와 총매출이 일치하지 않습니다. 금액을 확인해주세요.
          </p>
        </div>
      )}

      {/* 표준 분류 매핑 (수정 가능) */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">표준 분류 (수정 가능)</p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="현금" type="number" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} />
          <Input label="카드" type="number" value={cardAmount} onChange={(e) => setCardAmount(e.target.value)} />
          <Input label="상품권" type="number" value={giftCardAmount} onChange={(e) => setGiftCardAmount(e.target.value)} />
          <Input label="이체" type="number" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} />
          <Input label="할인" type="number" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} />
          <Input label="기타 (포인트/배달 등)" type="number" value={otherAmount} onChange={(e) => setOtherAmount(e.target.value)} />
        </div>
      </div>

      {/* 합계 */}
      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-sm font-medium text-muted-foreground">총매출</span>
        <span className="text-lg font-bold text-foreground tabular-nums">{total.toLocaleString()}원</span>
      </div>

      {/* 액션 */}
      <div className="flex gap-2 pt-2">
        <Button onClick={handleSave} disabled={upsert.isPending} className="flex-1">
          {upsert.isPending ? "저장 중..." : "저장"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>취소</Button>
      </div>
    </div>
  );
}
