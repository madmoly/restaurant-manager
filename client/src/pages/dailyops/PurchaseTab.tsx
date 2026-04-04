import React, { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  Camera, X, Plus, Check, AlertCircle, CheckCircle,
  Trash2, ZoomIn, RotateCw, RotateCcw, Search, Minus,
} from 'lucide-react';
import { Button, Card, Input } from '@/components/ui/index';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ImageViewer } from './ImageViewer';
import { TabChecklists } from './ChecklistSection';
import {
  fmtNum, parseNum, handleWonInput, fmtShortDate,
  UNIT_OPTIONS, PurchaseItemRow, emptyPurchaseItem, PurchaseInputMode,
} from './helpers';

export function PendingOrdersBanner({ restaurantId, onReceive }: { restaurantId: number; onReceive?: (orderId: number) => void }) {
  const pendingQuery = trpc.purchasesV2.pendingOrders.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  const pending = pendingQuery.data || [];
  if (pending.length === 0) return null;

  return (
    <Card className="bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">미입고 발주 {pending.length}건</span>
      </div>
      {pending.map((order: any) => (
        <div key={order.id} className="flex items-center justify-between text-xs">
          <div className="min-w-0">
            <span className="text-foreground font-medium">{order.counterpartyName || '미지정'}</span>
            {Number(order.totalAmount) > 0 && (
              <span className="text-muted-foreground ml-1.5">{fmtNum(Number(order.totalAmount))}원</span>
            )}
            <span className="text-muted-foreground ml-1.5">{fmtShortDate(order.purchaseDate)}</span>
            {order.itemCount > 0 && (
              <span className="text-muted-foreground ml-1">({order.itemCount}품목)</span>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-[10px] h-6 px-2 gap-0.5 border-green-300 text-green-600 hover:bg-green-50 dark:border-green-700 dark:text-green-400"
            onClick={() => onReceive?.(order.id)}
          >
            <Check className="w-2.5 h-2.5" /> 입고전환
          </Button>
        </div>
      ))}
    </Card>
  );
}

export function NoPurchaseConfirmation({ restaurantId, date, hasPurchases }: {
  restaurantId: number;
  date: string;
  hasPurchases: boolean;
}) {
  const purchaseLog = trpc.storeChecklists.getLog.useQuery({
    restaurantId,
    logDate: date,
    targetTab: 'purchase',
  });

  const saveLogMutation = trpc.storeChecklists.saveLog.useMutation({
    onSuccess: () => {
      toast.success('금일 입고/발주 없음이 확인되었습니다.');
      purchaseLog.refetch();
    },
    onError: (error: any) => {
      toast.error(`저장 실패: ${error.message}`);
    },
  });

  const isNoOrder = purchaseLog.data?.noOrderToday === true;

  // 매입 내역이 있으면 표시 불필요
  if (hasPurchases) return null;

  const handleConfirm = () => {
    const existingCheckedIds = (purchaseLog.data?.checkedItemIds as number[]) ?? [];
    saveLogMutation.mutate({
      restaurantId,
      logDate: date,
      targetTab: 'purchase',
      checkedItemIds: existingCheckedIds,
      noOrderToday: true,
    });
  };

  const handleCancel = () => {
    const existingCheckedIds = (purchaseLog.data?.checkedItemIds as number[]) ?? [];
    saveLogMutation.mutate({
      restaurantId,
      logDate: date,
      targetTab: 'purchase',
      checkedItemIds: existingCheckedIds,
      noOrderToday: false,
    });
  };

  if (isNoOrder) {
    return (
      <Card className="bg-emerald-500/10 border-emerald-200 dark:border-emerald-800 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">금일 입고/발주 없음 확인됨</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleCancel} disabled={saveLogMutation.isPending}>
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Button
      variant="outline"
      onClick={handleConfirm}
      disabled={saveLogMutation.isPending}
      className="w-full h-11 border-dashed border-muted-foreground/30 text-muted-foreground hover:text-foreground hover:border-foreground/50"
    >
      <Minus className="w-4 h-4 mr-2" />
      금일 입고/발주 없음
    </Button>
  );
}

export function PurchaseTab({
  restaurantId,
  date,
  onDateChange,
}: {
  restaurantId: number;
  date: string;
  onDateChange?: (newDate: string) => void;
}) {
  const [inputMode, setInputMode] = useState<PurchaseInputMode>('none');
  const [simpleMode, setSimpleMode] = useState(false);
  const [simpleTotalAmount, setSimpleTotalAmount] = useState('');
  const [counterpartyId, setCounterpartyId] = useState<number | undefined>(undefined);
  const [cpSearchText, setCpSearchText] = useState('');
  const [showCpDropdown, setShowCpDropdown] = useState(false);
  const [cpCandidates, setCpCandidates] = useState<{ id: number; name: string; score: number }[]>([]);
  const [note, setNote] = useState('');
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItemRow[]>([emptyPurchaseItem()]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState<string | undefined>(undefined);
  const [receivingOrderId, setReceivingOrderId] = useState<number | null>(null); // 입고전환 대상 발주 ID
  const [instantPurchase, setInstantPurchase] = useState(false); // 즉시구매(결제완료) — 발주=입고 동시

  // OCR 상태
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrOriginalItems, setOcrOriginalItems] = useState<any[] | null>(null); // AI 원본 (수정 비교용)
  const [ocrRotation, setOcrRotation] = useState(0); // 사용자 수동 회전 (0/90/180/270)
  const [ocrStep, setOcrStep] = useState<'idle' | 'uploaded' | 'analyzed'>('idle'); // 업로드→확인→분석 단계
  const [ocrDateSuggestion, setOcrDateSuggestion] = useState<string | null>(null); // OCR 감지 날짜 (인라인 알림용)
  const [ocrRetryCount, setOcrRetryCount] = useState(0); // OCR 재시도 횟수
  const [viewerImage, setViewerImage] = useState<string | null>(null); // 이미지 확대보기

  const utils = trpc.useUtils();

  const ordersQuery = trpc.purchasesV2.listByDate.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 },
  );

  const counterpartiesQuery = trpc.counterparties.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  const orderItemsQuery = trpc.purchasesV2.getOrderItems.useQuery(
    { orderId: expandedId! },
    { enabled: expandedId !== null },
  );

  // 거래처 선택 시 해당 품목 로드
  const cpItemsQuery = trpc.counterpartyItems.listByCounterparty.useQuery(
    { counterpartyId: counterpartyId! },
    { enabled: counterpartyId !== undefined && counterpartyId > 0 },
  );

  // ── 즉시지출 state ──
  const [expCategoryId, setExpCategoryId] = useState<number>(0);
  const [expTitle, setExpTitle] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expNote, setExpNote] = useState('');
  const [expAttachment, setExpAttachment] = useState<string | undefined>(undefined);
  const [expUploading, setExpUploading] = useState(false);

  // ── 즉시지출 queries ──
  const expensesQuery = trpc.dailyExpenses.listByDate.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 },
  );
  const categoriesQuery = trpc.dailyExpenses.listCategories.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );
  const categories = categoriesQuery.data || [];
  const expenses = expensesQuery.data || [];
  const totalExpenses = expenses.reduce((sum: number, e: any) => sum + Number(e.amount || 0), 0);

  // 카테고리 시드 (최초 1회)
  const seedCatMut = trpc.dailyExpenses.seedDefaultCategories.useMutation({
    onSuccess: () => categoriesQuery.refetch(),
  });
  if (categories.length === 0 && !categoriesQuery.isLoading && restaurantId > 0 && !seedCatMut.isPending) {
    seedCatMut.mutate({ restaurantId });
  }

  // ── 즉시지출 mutations ──
  const createExpenseMut = trpc.dailyExpenses.create.useMutation({
    onSuccess() {
      toast.success('즉시지출이 등록되었습니다.');
      utils.dailyExpenses.listByDate.invalidate();
      setExpCategoryId(0);
      setExpTitle('');
      setExpAmount('');
      setExpNote('');
      setExpAttachment(undefined);
      setInputMode('none');
    },
    onError(err: any) { toast.error(`등록 실패: ${err.message}`); },
  });

  const deleteExpenseMut = trpc.dailyExpenses.delete.useMutation({
    onSuccess() {
      toast.success('삭제됨');
      utils.dailyExpenses.listByDate.invalidate();
    },
    onError(err: any) { toast.error(`삭제 실패: ${err.message}`); },
  });

  // ── 즉시지출 사진 업로드 ──
  const handleExpensePhotoUpload = async (file: File) => {
    try {
      setExpUploading(true);
      const formData = new FormData();
      formData.append('photo', file);
      const res = await fetch('/api/upload/order-image', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('업로드 실패');
      const { url } = await res.json();
      setExpAttachment(url);
    } catch (err: any) {
      toast.error(err.message || '사진 업로드 실패');
    } finally {
      setExpUploading(false);
    }
  };

  // ── 즉시지출 등록 핸들러 ──
  const handleExpenseSubmit = () => {
    if (!expTitle.trim()) { toast.error('지출 내역을 입력하세요.'); return; }
    const amt = parseNum(expAmount);
    if (amt <= 0) { toast.error('금액을 입력하세요.'); return; }
    createExpenseMut.mutate({
      restaurantId,
      date,
      categoryId: expCategoryId > 0 ? expCategoryId : undefined,
      title: expTitle,
      amount: String(amt),
      note: expNote || undefined,
      attachmentUrl: expAttachment,
    });
  };

  const createOrder = trpc.purchasesV2.createOrder.useMutation({
    onSuccess() {
      toast.success(instantPurchase ? '즉시구매가 등록되었습니다.' : inputMode === 'order' ? '발주가 등록되었습니다.' : '입고가 등록되었습니다.');
      utils.purchasesV2.listByDate.invalidate();
      utils.purchasesV2.pendingOrders.invalidate();
      resetForm();
    },
    onError(err: any) { toast.error(`등록 실패: ${err.message}`); },
  });

  const receiveOrderMutation = trpc.purchasesV2.receiveOrder.useMutation({
    onSuccess() {
      toast.success('입고 전환 완료');
      utils.purchasesV2.listByDate.invalidate();
      utils.purchasesV2.pendingOrders.invalidate();
      resetForm();
    },
    onError(err: any) { toast.error(`입고 전환 실패: ${err.message}`); },
  });

  const deleteOrder = trpc.purchasesV2.deleteOrder.useMutation({
    onSuccess() {
      toast.success('삭제됨');
      utils.purchasesV2.listByDate.invalidate();
      setExpandedId(null);
    },
    onError(err: any) { toast.error(`삭제 실패: ${err.message}`); },
  });

  // 거래처 신규 생성
  const createCounterparty = trpc.counterparties.create.useMutation({
    onSuccess(data: any) {
      setCounterpartyId(data.id);
      setCpSearchText('');
      setShowCpDropdown(false);
      utils.counterparties.list.invalidate();
      toast.success('거래처가 등록되었습니다');
    },
    onError(err: any) { toast.error(`거래처 등록 실패: ${err.message}`); },
  });

  const resetForm = () => {
    setInputMode('none');
    setSimpleMode(false);
    setSimpleTotalAmount('');
    setCounterpartyId(undefined);
    setCpSearchText('');
    setShowCpDropdown(false);
    setNote('');
    setPurchaseItems([emptyPurchaseItem()]);
    setAttachmentUrl(undefined);
    setOcrPreviewUrl(null);
    setOcrError(null);
    setOcrRotation(0);
    setOcrStep('idle');
    setOcrDateSuggestion(null);
    setOcrRetryCount(0);
    setReceivingOrderId(null);
    setInstantPurchase(false);
  };

  // 미입고 발주 → 입고 전환 시작
  const startReceiveFromOrder = async (orderId: number) => {
    setInputMode('receive');
    setReceivingOrderId(orderId);
    // 기존 발주의 품목 로드
    const items = await utils.purchasesV2.getOrderItems.fetch({ orderId });
    if (items && items.length > 0) {
      setPurchaseItems(
        items.map((item: any) => ({
          rawItemName: item.rawItemName || item.itemName || '',
          quantity: item.quantity || '',
          unitName: item.unitName || '개',
          unitPrice: item.unitPrice || '',
          lineTotal: item.lineTotal || '',
          counterpartyItemId: item.counterpartyItemId || undefined,
        })),
      );
    }
    // 발주의 거래처도 프리필
    const pendingOrders = utils.purchasesV2.pendingOrders.getData({ restaurantId });
    const order = pendingOrders?.find((o: any) => o.id === orderId);
    if (order?.counterpartyId) setCounterpartyId(order.counterpartyId);
    if (order?.note) setNote(order.note);
  };

  const updateItem = (idx: number, field: keyof PurchaseItemRow, value: string) => {
    const newItems = [...purchaseItems];
    newItems[idx] = { ...newItems[idx], [field]: value };
    if (field === 'quantity' || field === 'unitPrice') {
      const qty = parseFloat(newItems[idx].quantity || '0');
      const price = parseFloat(newItems[idx].unitPrice || '0');
      if (qty > 0 && price > 0) {
        newItems[idx].lineTotal = String(Math.round(qty * price));
      }
    }
    setPurchaseItems(newItems);
  };

  // 거래처 품목 빠른 추가
  const addFromCpItem = (cpItem: any) => {
    const newItem: PurchaseItemRow = {
      rawItemName: cpItem.supplierItemName || cpItem.itemName,
      quantity: '',
      unitName: cpItem.purchaseUnit || '개',
      unitPrice: cpItem.lastPrice || cpItem.defaultPrice || '',
      lineTotal: '',
      counterpartyItemId: cpItem.id,
    };
    // 빈 항목이 하나뿐이면 교체, 아니면 추가
    if (purchaseItems.length === 1 && !purchaseItems[0].rawItemName) {
      setPurchaseItems([newItem]);
    } else {
      setPurchaseItems([...purchaseItems, newItem]);
    }
  };

  // ── STEP 1: 사진 업로드 + Tesseract 방향감지 1회 ───────────────
  const handleOcrUpload = async (file: File) => {
    try {
      setOcrProcessing(true);
      setOcrError(null);
      setOcrRotation(0);

      const formData = new FormData();
      formData.append('photo', file);

      const uploadRes = await fetch('/api/upload/order-image', {
        method: 'POST',
        body: formData,
      });
      if (!uploadRes.ok) throw new Error('이미지 업로드 실패');
      const { url } = await uploadRes.json();
      setAttachmentUrl(url);
      setOcrPreviewUrl(url + `?t=${Date.now()}`);
      setOcrStep('uploaded');

      // Tesseract OSD 1회 방향감지 (비동기 — 실패해도 무시)
      try {
        const orientRes = await fetch('/api/ocr/detect-orientation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: url }),
        });
        if (orientRes.ok) {
          const { suggestedRotation } = await orientRes.json();
          if (suggestedRotation && suggestedRotation !== 0) {
            setOcrRotation(suggestedRotation);
            toast.info(`방향 자동감지: ${suggestedRotation}° 회전 적용됨. 확인 후 수정 가능합니다.`);
          } else {
            toast.info('이미지 방향을 확인하세요. 필요시 회전 후 분석을 눌러주세요.');
          }
        }
      } catch {
        // 방향감지 실패는 무시 — 사람이 직접 회전
      }
    } catch (error: any) {
      setOcrError(error.message || '업로드 실패');
      toast.error(error.message || '업로드 실패');
    } finally {
      setOcrProcessing(false);
    }
  };

  // ── STEP 2: 회전 적용 + OCR 분석 실행 ───────────────
  const handleOcrAnalyze = async () => {
    if (!attachmentUrl) return;
    try {
      setOcrProcessing(true);
      setOcrError(null);

      toast.info('전표 분석중...');

      const ocrRes = await fetch('/api/ocr/extract-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: attachmentUrl,
          restaurantId,
          rotation: ocrRotation, // 사용자가 선택한 회전 각도
          counterpartyId: counterpartyId || undefined,
        }),
      });

      if (!ocrRes.ok) {
        const errData = await ocrRes.json().catch(() => ({}));
        throw new Error(errData.error || 'OCR 처리 실패');
      }

      const ocrData = await ocrRes.json();

      // 서버에서 실제 파일 회전 완료 → CSS 회전 리셋 + 프리뷰 갱신
      setOcrRotation(0);
      setOcrPreviewUrl(attachmentUrl + `?t=${Date.now()}`);
      setOcrStep('analyzed');

      // OCR 원본 저장
      if (ocrData.items && ocrData.items.length > 0) {
        setOcrOriginalItems(ocrData.items);
      }

      // 거래처 매칭 (사용자가 아직 선택 안 한 경우만)
      if (!counterpartyId && ocrData.counterpartyName) {
        if (ocrData.counterpartyId) {
          // 서버에서 정확 매칭됨
          const cpList = counterpartiesQuery.data || [];
          const matchedCp = cpList.find((cp: any) => cp.id === ocrData.counterpartyId);
          setCounterpartyId(ocrData.counterpartyId);
          toast.success(`거래처 자동선택: ${matchedCp?.name || ocrData.counterpartyName}`);
        } else if (ocrData.counterpartyCandidates && ocrData.counterpartyCandidates.length > 0) {
          // 유사 거래처 후보 있음 → 후보 배너 표시
          setCpCandidates(ocrData.counterpartyCandidates);
          setCpSearchText(ocrData.counterpartyName.trim());
          toast.info(`"${ocrData.counterpartyName}" — 비슷한 거래처가 있습니다. 확인해주세요`);
        } else {
          // 매칭 실패 → 검색란에 OCR 추출명 자동 입력
          setCpSearchText(ocrData.counterpartyName.trim());
          setShowCpDropdown(true);
          toast.info(`거래처 "${ocrData.counterpartyName}" — 목록에서 선택하거나 새로 등록하세요`);
        }
      }

      // 날짜 확인 → 인라인 알림 (toast 대신 — 모바일에서 버튼 가림 방지)
      if (ocrData.transactionDate && onDateChange) {
        const ocrDate = ocrData.transactionDate;
        if (ocrDate !== date) {
          setOcrDateSuggestion(ocrDate);
        }
      }

      // 거래처 정보 업데이트
      if (ocrData.counterpartyInfo && ocrData.counterpartyId) {
        const ci = ocrData.counterpartyInfo;
        const changes: string[] = [];
        if (ci.contactName) changes.push(`담당자: ${ci.contactName}`);
        if (ci.contactPhone) changes.push(`연락처: ${ci.contactPhone}`);
        if (changes.length > 0) {
          toast(`거래처 정보가 감지되었습니다.\n${changes.join(', ')}`, {
            duration: 15000,
            action: {
              label: '반영',
              onClick: async () => {
                try {
                  await fetch('/api/ocr/update-counterparty-info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      counterpartyId: ocrData.counterpartyId,
                      contactName: ci.contactName || undefined,
                      contactPhone: ci.contactPhone || undefined,
                    }),
                  });
                  toast.success('거래처 정보가 업데이트되었습니다.');
                } catch {
                  toast.error('거래처 정보 업데이트 실패');
                }
              },
            },
          });
        }
      }

      // 품목 프리필
      if (ocrData.items && ocrData.items.length > 0) {
        setPurchaseItems(
          ocrData.items.map((item: any) => ({
            rawItemName: item.matchedItemName || item.shortName || item.name || '',
            spec: item.spec || '',
            originalName: item.originalName || item.name || '',
            quantity: item.quantity ? String(Math.round(parseFloat(item.quantity) * 100) / 100) : '',
            unitName: item.unit || '개',
            unitPrice: item.unitPrice || '',
            lineTotal: item.lineTotal || '',
            confidence: item.confidence || 'high',
            matchedItemId: item.matchedItemId,
            matchedItemName: item.matchedItemName,
            itemCandidates: item.itemCandidates,
          }))
        );
        // 매칭 통계
        const matchedCount = ocrData.items.filter((i: any) => i.matchedItemId).length;
        const candidateCount = ocrData.items.filter((i: any) => !i.matchedItemId && i.itemCandidates?.length > 0).length;
        const lowConfCount = ocrData.items.filter((i: any) => i.confidence === 'low').length;
        if (candidateCount > 0 || lowConfCount > 0) {
          const parts: string[] = [];
          if (candidateCount > 0) parts.push(`${candidateCount}개 품목 확인 필요`);
          if (lowConfCount > 0) parts.push(`${lowConfCount}개 수량/단가 확인`);
          toast.success(`${ocrData.items.length}개 항목 추출 (${parts.join(', ')})`);
        } else {
          toast.success(`${ocrData.items.length}개 항목 추출${matchedCount > 0 ? ` (${matchedCount}개 자동매칭)` : ''}`);
        }
      } else {
        toast.info('항목을 추출하지 못했습니다. 직접 입력해주세요.');
      }
      if (ocrData.note) setNote(ocrData.note);
    } catch (error: any) {
      const nextRetry = ocrRetryCount + 1;
      setOcrRetryCount(nextRetry);

      if (nextRetry < 2) {
        // 자동 재시도 (최대 2회)
        toast.info(`분석 실패, 자동 재시도 중... (${nextRetry}/2)`);
        setOcrProcessing(false);
        // 약간의 딜레이 후 재시도
        setTimeout(() => handleOcrAnalyze(), 500);
        return;
      } else {
        // 2회 재시도 후에도 실패
        setOcrError('전표 분석에 실패했습니다. 이미지를 다시 올리거나 직접 입력해주세요.');
        setOcrStep('uploaded'); // 다시 업로드 상태로 (재촬영 유도)
        toast.error('분석 실패 — 이미지를 다시 올리거나 직접 입력해주세요');
      }
    } finally {
      setOcrProcessing(false);
    }
  };

  const handleCreate = () => {
    const isOrderMode = inputMode === 'order' && !instantPurchase;
    const isReceiveFromOrder = inputMode === 'receive' && receivingOrderId;

    // 날짜 불일치 미확인 시 저장 차단
    if (ocrDateSuggestion) {
      toast.error('명세서 날짜를 확인해주세요. 변경 또는 유지를 선택하세요.');
      return;
    }

    // 거래처 필수 (입고전환 제외 — 이미 거래처가 지정된 발주를 전환하는 경우)
    if (!isReceiveFromOrder && !counterpartyId) {
      toast.error('거래처를 선택하세요.');
      return;
    }

    if (simpleMode) {
      const total = parseFloat(simpleTotalAmount || '0');
      if (!isOrderMode && total <= 0) {
        toast.error('금액을 입력하세요.');
        return;
      }
      if (isReceiveFromOrder) {
        // 입고전환 (간편모드)
        receiveOrderMutation.mutate({
          id: receivingOrderId,
          totalAmount: simpleTotalAmount || '0',
        });
        return;
      }
      createOrder.mutate({
        restaurantId,
        purchaseDate: date,
        counterpartyId,
        status: isOrderMode ? 'ordered' : 'received',
        note: note || undefined,
        attachmentUrl,
        items: [{
          rawItemName: counterpartyId
            ? (counterpartiesQuery.data?.find((cp: any) => cp.id === counterpartyId)?.name || '매입')
            : '매입',
          lineTotal: simpleTotalAmount || '0',
        }],
      });
      return;
    }

    // 상세 모드
    const itemsWithName = purchaseItems.filter(i => i.rawItemName.trim());
    const validItems = isOrderMode
      ? itemsWithName  // 발주: 품명만 있으면 OK (금액 0 허용)
      : itemsWithName.filter(i => parseFloat(i.lineTotal || '0') > 0);  // 입고: 금액 필수

    // 발주: 품목 또는 사진 중 하나는 필요
    if (isOrderMode) {
      if (validItems.length === 0 && !attachmentUrl) {
        toast.error('품목 또는 발주서 사진을 입력하세요.');
        return;
      }
    } else if (validItems.length === 0) {
      toast.error('최소 1개 항목 (품명+금액)을 입력하세요.');
      return;
    }

    if (isReceiveFromOrder) {
      // 입고전환 (상세모드)
      receiveOrderMutation.mutate({
        id: receivingOrderId,
        items: validItems.map(i => ({
          rawItemName: i.rawItemName,
          counterpartyItemId: i.counterpartyItemId,
          quantity: i.quantity || undefined,
          unitName: i.unitName || undefined,
          unitPrice: i.unitPrice || undefined,
          lineTotal: i.lineTotal || '0',
        })),
      });
    } else {
      createOrder.mutate({
        restaurantId,
        purchaseDate: date,
        counterpartyId,
        status: isOrderMode ? 'ordered' : 'received',
        note: note || undefined,
        attachmentUrl,
        items: validItems.map(i => ({
          rawItemName: i.rawItemName,
          counterpartyItemId: i.counterpartyItemId,
          quantity: i.quantity || undefined,
          unitName: i.unitName || undefined,
          unitPrice: i.unitPrice || undefined,
          lineTotal: i.lineTotal || '0',
        })),
      });
    }

    // OCR 수정 데이터 비동기 제출 (품질 개선용, 실패해도 무시)
    if (ocrOriginalItems && attachmentUrl) {
      fetch('/api/ocr/submit-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId,
          counterpartyId: counterpartyId || null,
          imageUrl: attachmentUrl,
          originalItems: ocrOriginalItems,
          correctedItems: validItems.map(i => ({
            rawItemName: i.rawItemName,
            quantity: i.quantity || '',
            unitName: i.unitName || '',
            unitPrice: i.unitPrice || '',
            lineTotal: i.lineTotal || '',
          })),
        }),
      }).catch(() => {});
      setOcrOriginalItems(null);
    }
  };

  const orders = ordersQuery.data || [];
  const counterpartiesList = counterpartiesQuery.data || [];
  const cpItems = cpItemsQuery.data || [];
  const receivedOrders = orders.filter((o: any) => o.status === 'received');
  const pendingOrders = orders.filter((o: any) => o.status !== 'received');
  const totalAmount = receivedOrders.reduce((sum, o: any) => sum + Number(o.totalAmount || 0), 0);
  const formTotal = purchaseItems.reduce((sum, i) => sum + parseFloat(i.lineTotal || '0'), 0);

  return (
    <div className="space-y-4 p-4">
      {/* 매입 탭 체크리스트 */}
      <TabChecklists
        restaurantId={restaurantId}
        date={date}
        targetTab="purchase"
      />

      {/* ─── 일별 매입 현황 ─── */}
      <Card className="bg-card border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground">매입 현황</h3>
            {pendingOrders.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 font-medium">
                미입고 {pendingOrders.length}건
              </span>
            )}
          </div>
          <span className="text-sm font-bold text-foreground">₩{totalAmount.toLocaleString()}</span>
        </div>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">등록된 매입 전표가 없습니다</p>
        ) : (
          <div className="space-y-2">
            {orders.map((order: any) => (
              <div key={order.id} className="border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-foreground truncate">
                      {order.counterpartyName || '미지정 거래처'}
                    </span>
                    {order.status === 'ordered' ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 font-medium">발주 (미입고)</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 font-medium">입고</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground tabular-nums">₩{Number(order.totalAmount).toLocaleString()}</span>
                    <svg className={`w-4 h-4 text-muted-foreground transition-transform ${expandedId === order.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </div>
                </button>
                {expandedId === order.id && (
                  <div className="px-3 pb-3 border-t border-border pt-2 space-y-1.5">
                    {orderItemsQuery.isLoading ? (
                      <p className="text-xs text-muted-foreground">로딩 중...</p>
                    ) : (orderItemsQuery.data || []).map((item: any) => (
                      <div key={item.id} className="flex justify-between text-xs">
                        <span className="text-foreground">{item.rawItemName || item.itemName || '품목'}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {item.quantity && `${parseFloat(Number(item.quantity).toFixed(2))}${item.unitName ? item.unitName : ''} × `}
                          ₩{Number(item.lineTotal).toLocaleString()}
                        </span>
                      </div>
                    ))}
                    {order.note && <p className="text-xs text-muted-foreground mt-1">메모: {order.note}</p>}
                    <div className="flex justify-end pt-1">
                      <Button variant="ghost" size="sm" onClick={() => { if (confirm('이 매입 기록을 삭제할까요?')) deleteOrder.mutate({ id: order.id }); }} disabled={deleteOrder.isPending}>
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ─── 발주/입고 입력 버튼 (항상 표시, 토글) ─── */}
      <div className="flex gap-2">
        <button
          onClick={() => { resetForm(); setInputMode(inputMode === 'order' ? 'none' : 'order'); }}
          className={`flex-1 h-14 flex items-center justify-center gap-2 rounded-lg text-sm font-bold transition-all border-2 ${
            inputMode === 'order'
              ? 'bg-amber-500 text-white border-amber-600 ring-2 ring-amber-300 shadow-md'
              : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/50'
          }`}
        >
          <Plus className="w-5 h-5" />
          발주 입력
        </button>
        <button
          onClick={() => { resetForm(); setInputMode(inputMode === 'receive' ? 'none' : 'receive'); }}
          className={`flex-1 h-14 flex items-center justify-center gap-2 rounded-lg text-sm font-bold transition-all border-2 ${
            inputMode === 'receive'
              ? 'bg-blue-600 text-white border-blue-700 ring-2 ring-blue-300 shadow-md'
              : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/50'
          }`}
        >
          <Check className="w-5 h-5" />
          입고 입력
        </button>
        <button
          onClick={() => { resetForm(); setInputMode(inputMode === 'expense' ? 'none' : 'expense'); }}
          className={`flex-1 h-14 flex items-center justify-center gap-2 rounded-lg text-sm font-bold transition-all border-2 ${
            inputMode === 'expense'
              ? 'bg-violet-600 text-white border-violet-700 ring-2 ring-violet-300 shadow-md'
              : 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-700 hover:bg-violet-100 dark:hover:bg-violet-900/50'
          }`}
        >
          <Plus className="w-5 h-5" />
          즉시지출
        </button>
      </div>

      {/* ─── 발주/입고 입력 폼 ─── */}
      {(inputMode === 'order' || inputMode === 'receive') && (
        <Card className={`border p-4 space-y-3 ${inputMode === 'order' ? 'bg-amber-50/30 dark:bg-amber-900/5 border-amber-200 dark:border-amber-800' : 'bg-card border-border'}`}>
          {/* 헤더: 제목 + 간편입력 토글 + 닫기 */}
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground text-sm">
              {receivingOrderId ? '입고 전환' : inputMode === 'order' ? '발주 입력' : '입고 입력'}
            </h3>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <span className="text-xs text-muted-foreground">간편입력</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={simpleMode}
                  onClick={() => setSimpleMode(!simpleMode)}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${simpleMode ? 'bg-blue-600' : 'bg-muted'}`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${simpleMode ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </label>
              <button onClick={resetForm} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 발주 모드 안내 + 즉시구매 */}
          {inputMode === 'order' && !receivingOrderId && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-100/50 dark:bg-amber-900/20 px-2 py-1 rounded">
                {instantPurchase
                  ? '즉시구매: 발주와 동시에 입고/지출 처리됩니다 (쿠팡, 마트 등)'
                  : '거래처, 품목, 또는 발주서 사진만으로도 등록 가능 — 금액은 입고 시 입력'}
              </p>
              <label className="flex items-center gap-2 cursor-pointer px-1">
                <Checkbox
                  checked={instantPurchase}
                  onCheckedChange={(v) => setInstantPurchase(!!v)}
                />
                <span className="text-xs text-muted-foreground">즉시구매 (결제완료 — 발주 즉시 지출 처리)</span>
              </label>
            </div>
          )}
          {receivingOrderId && (
            <p className="text-[11px] text-green-600 dark:text-green-400 bg-green-100/50 dark:bg-green-900/20 px-2 py-1 rounded">
              발주 #{receivingOrderId} 입고 전환 — 품목을 확인하고 금액을 입력하세요
            </p>
          )}

          {/* 전표 촬영 영역 (항상 표시) */}
          {!ocrPreviewUrl && !ocrProcessing && (
            <label className="flex flex-col items-center border border-dashed border-border rounded-lg p-3 cursor-pointer hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium text-foreground">전표/영수증 촬영 또는 앨범 선택</p>
                  <p className="text-[10px] text-muted-foreground">사진 업로드 시 AI가 자동 입력합니다</p>
                </div>
              </div>
              <div className="mt-2 w-full bg-muted/30 rounded px-2.5 py-1.5 space-y-0.5">
                <p className="text-[10px] text-muted-foreground leading-relaxed">• 한 번에 전표 1장만 촬영/선택해주세요</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">• 거래처, 품목명, 단가, 수량, 합계가 잘 보이게 찍어주세요</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">• 그림자나 빛 반사를 피해주세요</p>
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    if (simpleMode) setSimpleMode(false);
                    handleOcrUpload(e.target.files[0]);
                  }
                }}
                className="hidden"
              />
            </label>
          )}

          {/* OCR 처리 중 */}
          {ocrProcessing && (
            <div className="flex flex-col items-center py-6 space-y-2">
              <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-foreground">전표 분석중...</p>
              <p className="text-[10px] text-muted-foreground">품목, 수량, 단가를 자동 추출합니다</p>
            </div>
          )}

          {/* OCR 에러 */}
          {ocrError && (
            <div className="bg-red-500/10 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <p className="text-sm text-red-600 dark:text-red-400">{ocrError}</p>
              <p className="text-xs text-muted-foreground mt-1">API 키가 설정되지 않았거나 서버 오류입니다.</p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => { setOcrError(null); setOcrPreviewUrl(null); }}>
                다시 촬영
              </Button>
            </div>
          )}

          {/* OCR 프리뷰 이미지 + 회전/분석 컨트롤 */}
          {ocrPreviewUrl && !ocrProcessing && (
            <div className="space-y-2">
              {/* 이미지 프리뷰 */}
              <div className="relative overflow-hidden rounded-lg border border-border bg-muted/20">
                <img
                  src={ocrPreviewUrl}
                  alt="전표 이미지"
                  className="w-full max-h-48 object-contain cursor-pointer transition-transform"
                  style={{ transform: `rotate(${ocrRotation}deg)` }}
                  onClick={() => setViewerImage(ocrPreviewUrl)}
                />
              </div>

              {/* 컨트롤 바: 확대 / 회전 / 닫기 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setViewerImage(ocrPreviewUrl)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/50"
                    title="확대 보기"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  {ocrStep === 'uploaded' && (
                    <>
                      <button
                        onClick={() => setOcrRotation((prev) => (prev - 90 + 360) % 360)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/50"
                        title="왼쪽 회전"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setOcrRotation((prev) => (prev + 90) % 360)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/50"
                        title="오른쪽 회전"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      {ocrRotation !== 0 && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 ml-1">{ocrRotation}° 회전</span>
                      )}
                    </>
                  )}
                </div>
                <button
                  onClick={() => {
                    const hasItems = purchaseItems.some(i => i.rawItemName.trim() || i.lineTotal);
                    if (hasItems && ocrStep === 'analyzed' && !confirm('분석된 품목이 초기화됩니다. 이미지를 삭제할까요?')) return;
                    setOcrPreviewUrl(null);
                    setAttachmentUrl(undefined);
                    setOcrStep('idle');
                    setOcrRotation(0);
                    setPurchaseItems([emptyPurchaseItem()]);
                  }}
                  className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-500/10"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>삭제</span>
                </button>
              </div>

              {/* 분석 시작 (uploaded 단계에서만) */}
              {ocrStep === 'uploaded' && (
                <>
                  <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
                    글씨가 정방향으로 읽히는지 확인하세요. 돌아가 있으면 회전 버튼을 눌러주세요.
                  </p>
                  <button
                    onClick={() => { setOcrRetryCount(0); handleOcrAnalyze(); }}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
                  >
                    <Search className="w-4 h-4" />
                    전표 분석 시작
                  </button>
                </>
              )}
            </div>
          )}

          {/* OCR 날짜 불일치 — 강제 확인 (해결 전 저장 차단) */}
          {ocrDateSuggestion && (() => {
            const diff = Math.round((new Date(date).getTime() - new Date(ocrDateSuggestion).getTime()) / 86400000);
            const absDiff = Math.abs(diff);
            return (
              <div className="bg-red-500/10 border-2 border-red-400 dark:border-red-600 rounded-lg p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                      날짜 불일치 — 확인 필수
                    </p>
                    <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">
                      명세서 날짜 <strong className="text-red-700 dark:text-red-300">{ocrDateSuggestion}</strong>
                      {' '}/ 현재 입고일 <strong>{date}</strong>
                      {absDiff > 0 && <span className="ml-1">({absDiff}일 차이)</span>}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (onDateChange) {
                        onDateChange(ocrDateSuggestion);
                        toast.success(`입고일이 ${ocrDateSuggestion}로 변경됨`);
                      }
                      setOcrDateSuggestion(null);
                    }}
                    className="flex-1 text-xs font-bold bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 transition-colors"
                  >
                    명세서 날짜({ocrDateSuggestion})로 변경
                  </button>
                  <button
                    onClick={() => {
                      if (absDiff >= 3) {
                        if (!confirm(`${absDiff}일 차이가 납니다. 정말 현재 날짜(${date})를 유지할까요?`)) return;
                      }
                      setOcrDateSuggestion(null);
                    }}
                    className="text-[11px] text-muted-foreground px-3 py-2 border border-border rounded-lg hover:bg-muted/50"
                  >
                    유지
                  </button>
                </div>
              </div>
            );
          })()}

          {/* 거래처 선택/입력 (검색 + 신규 생성) */}
          <div className="relative">
            <Label className="text-xs">거래처</Label>
            {counterpartyId ? (
              <div className="mt-1 flex items-center gap-2 h-9 rounded-md border border-border bg-background px-3">
                <span className="text-sm text-foreground flex-1">
                  {counterpartiesList.find((cp: any) => cp.id === counterpartyId)?.name ?? '거래처'}
                </span>
                <button
                  type="button"
                  onClick={() => { setCounterpartyId(undefined); setCpSearchText(''); setCpCandidates([]); }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={cpSearchText}
                  onChange={(e) => { setCpSearchText(e.target.value); setShowCpDropdown(true); }}
                  onFocus={() => setShowCpDropdown(true)}
                  onBlur={() => setTimeout(() => setShowCpDropdown(false), 200)}
                  placeholder="거래처 검색 또는 입력"
                  className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                />
                {showCpDropdown && (
                  <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto bg-card border border-border rounded-md shadow-lg">
                    {counterpartiesList
                      .filter((cp: any) => !cpSearchText || cp.name.toLowerCase().includes(cpSearchText.toLowerCase()))
                      .map((cp: any) => (
                        <button
                          key={cp.id}
                          type="button"
                          onClick={() => {
                            setCounterpartyId(cp.id);
                            setCpSearchText('');
                            setShowCpDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors"
                        >
                          {cp.name}
                        </button>
                      ))}
                    {cpSearchText.trim() && !counterpartiesList.some((cp: any) => cp.name === cpSearchText.trim()) && (
                      <button
                        type="button"
                        onClick={() => {
                          createCounterparty.mutate({
                            restaurantId,
                            name: cpSearchText.trim(),
                            counterpartyType: 'supplier',
                          });
                        }}
                        disabled={createCounterparty.isPending}
                        className="w-full text-left px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 transition-colors border-t border-border font-medium"
                      >
                        <Plus className="w-3.5 h-3.5 inline mr-1" />
                        "{cpSearchText.trim()}" 새 거래처 등록
                      </button>
                    )}
                    {counterpartiesList.filter((cp: any) => !cpSearchText || cp.name.toLowerCase().includes(cpSearchText.toLowerCase())).length === 0 && !cpSearchText.trim() && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">등록된 거래처가 없습니다</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 거래처 후보 매칭 배너 */}
          {cpCandidates.length > 0 && !counterpartyId && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-2.5 space-y-1.5">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                비슷한 거래처가 있습니다. 맞는 것을 선택하세요:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {cpCandidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCounterpartyId(c.id);
                      setCpSearchText('');
                      setCpCandidates([]);
                      toast.success(`거래처 선택: ${c.name}`);
                    }}
                    className="px-2.5 py-1.5 text-xs bg-amber-500/20 hover:bg-amber-500/40 text-amber-800 dark:text-amber-200 rounded-md transition-colors font-medium"
                  >
                    {c.name} ({c.score}%)
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setCpCandidates([]);
                    setShowCpDropdown(true);
                  }}
                  className="px-2.5 py-1.5 text-xs bg-muted/50 hover:bg-muted text-muted-foreground rounded-md transition-colors"
                >
                  해당없음
                </button>
              </div>
            </div>
          )}

          {/* 합계 표시 (거래처 아래) */}
          {!simpleMode && purchaseItems.some(i => parseFloat(i.lineTotal || '0') > 0) && (
            <div className="bg-blue-500/5 p-2.5 rounded flex justify-between items-center">
              <span className="text-xs text-muted-foreground">{purchaseItems.filter(i => i.rawItemName.trim()).length}개 항목</span>
              <span className="text-sm font-bold text-blue-600 tabular-nums">
                합계 ₩{formTotal.toLocaleString()}
              </span>
            </div>
          )}

          {/* ── 간편입력 모드: 금액만 ── */}
          {simpleMode ? (
            <div>
              <Label className="text-xs">매입 금액</Label>
              <Input
                placeholder="총 금액 입력"
                type="number"
                value={simpleTotalAmount}
                onChange={(e) => setSimpleTotalAmount(e.target.value)}
                className="mt-1 text-sm h-10 text-right font-medium"
                autoFocus
              />
            </div>
          ) : (
            <>
              {/* 거래처 품목 빠른선택 */}
              {counterpartyId && cpItems.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">빠른 품목 추가</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {cpItems.map((cpItem: any) => (
                      <button
                        key={cpItem.id}
                        onClick={() => addFromCpItem(cpItem)}
                        className="text-xs px-2 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-500/20 transition-colors"
                      >
                        {cpItem.supplierItemName || cpItem.itemName}
                        {cpItem.lastPrice && <span className="ml-1 opacity-70">₩{Number(cpItem.lastPrice).toLocaleString()}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 항목 입력 */}
              <div className="space-y-2">
                <Label className="text-xs">매입 항목</Label>
                {purchaseItems.map((item, idx) => {
                  const isLowConf = item.confidence === 'low';
                  const isMedConf = item.confidence === 'medium';
                  const cardBorder = isLowConf
                    ? 'border-red-300 dark:border-red-700 bg-red-50/30 dark:bg-red-900/10'
                    : isMedConf
                      ? 'border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-900/10'
                      : ocrPreviewUrl
                        ? 'border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-900/10'
                        : 'border-border bg-card/50';
                  return (
                  <div key={idx} className={`space-y-2 border rounded-lg p-3 ${cardBorder} relative`}>
                    {/* 항목 번호 */}
                    <span className="absolute -top-2 -left-1 bg-primary text-primary-foreground text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full shadow-sm">{idx + 1}</span>
                    {/* 신뢰도 배지 */}
                    {(isLowConf || isMedConf) && (
                      <div className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded w-fit ${isLowConf ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'}`}>
                        <AlertCircle className="w-3 h-3" />
                        {isLowConf ? '판독 불확실 — 확인 필요' : '합계 보정됨 — 확인 필요'}
                      </div>
                    )}
                    {/* 품명 + 규격 */}
                    <div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Input
                            placeholder="품명"
                            value={item.rawItemName}
                            onChange={(e) => updateItem(idx, 'rawItemName', e.target.value)}
                            className="w-full text-sm h-9 font-medium"
                          />
                        </div>
                        {(item.spec || ocrPreviewUrl) && (
                          <div className="w-24">
                            <Input
                              placeholder="규격"
                              value={item.spec || ''}
                              onChange={(e) => updateItem(idx, 'spec', e.target.value)}
                              className="w-full text-sm h-9 text-muted-foreground"
                            />
                          </div>
                        )}
                      </div>
                      {item.originalName && item.originalName !== item.rawItemName && !item.matchedItemName && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 px-1 truncate">원본: {item.originalName}</p>
                      )}
                      {/* 자동매칭된 경우 원본명 표시 */}
                      {item.matchedItemName && item.originalName && (
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5 px-1 truncate">
                          ✓ 자동매칭 (전표: {item.originalName || item.matchedItemName})
                        </p>
                      )}
                      {/* 후보가 있지만 자동매칭은 안 된 경우 → 선택 칩 */}
                      {!item.matchedItemId && item.itemCandidates && item.itemCandidates.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className="text-[10px] text-amber-600 dark:text-amber-400">혹시:</span>
                          {item.itemCandidates.map((c: any) => (
                            <button
                              key={c.itemId}
                              type="button"
                              onClick={() => {
                                const updated = [...purchaseItems];
                                updated[idx] = {
                                  ...updated[idx],
                                  rawItemName: c.itemName,
                                  matchedItemId: c.itemId,
                                  matchedItemName: c.itemName,
                                  itemCandidates: undefined,
                                };
                                setPurchaseItems(updated);
                              }}
                              className="px-1.5 py-0.5 text-[10px] bg-amber-500/15 hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 rounded transition-colors"
                            >
                              {c.itemName}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* 수량 + 단위 */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] text-muted-foreground mb-0.5 block">수량</span>
                        <Input placeholder="0" type="number" step="0.01" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} className="text-sm h-9" />
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground mb-0.5 block">단위</span>
                        {UNIT_OPTIONS.includes(item.unitName) && item.unitName !== '직접입력' ? (
                          <select value={item.unitName} onChange={(e) => {
                            if (e.target.value === '직접입력') updateItem(idx, 'unitName', '');
                            else updateItem(idx, 'unitName', e.target.value);
                          }} className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground">
                            {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        ) : (
                          <div className="flex gap-1">
                            <Input placeholder="단위 입력" value={item.unitName} onChange={(e) => updateItem(idx, 'unitName', e.target.value)} className="text-sm h-9 flex-1" />
                            <button onClick={() => updateItem(idx, 'unitName', '개')} className="px-2 h-9 text-xs text-muted-foreground border border-border rounded-md hover:bg-muted" title="목록으로">▼</button>
                          </div>
                        )}
                      </div>
                    </div>
                    {/* 단가 + 합계 */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] text-muted-foreground mb-0.5 block">단가</span>
                        <Input placeholder="0" type="number" value={item.unitPrice} onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)} className="text-sm h-9" />
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground mb-0.5 block">합계</span>
                        <Input placeholder="0" type="number" value={item.lineTotal} onChange={(e) => updateItem(idx, 'lineTotal', e.target.value)} className="text-sm h-9 font-semibold" />
                      </div>
                    </div>
                    {/* 삭제 (1개 남으면 숨김, 내용 있으면 확인) */}
                    {purchaseItems.length > 1 && (
                      <button
                        onClick={() => {
                          const hasContent = item.rawItemName.trim() || item.quantity || item.unitPrice || item.lineTotal;
                          if (hasContent && !confirm(`"${item.rawItemName || '이 항목'}" 을(를) 삭제할까요?`)) return;
                          setPurchaseItems(purchaseItems.filter((_, i) => i !== idx));
                        }}
                        className="w-full flex items-center justify-center gap-1 text-xs text-red-400 hover:text-red-500 py-1 border border-dashed border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" /> 이 항목 삭제
                      </button>
                    )}
                  </div>
                  );
                })}
                <Button variant="secondary" size="sm" onClick={() => setPurchaseItems([...purchaseItems, emptyPurchaseItem()])} className="w-full">
                  <Plus className="w-3 h-3 mr-1" /> 항목 추가
                </Button>
              </div>
            </>
          )}

          {/* 메모 */}
          <div>
            <Label className="text-xs">메모 (선택)</Label>
            <Input placeholder="메모" value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 text-sm h-8" />
          </div>

          {/* 합계 + 저장 */}
          <div className="bg-blue-500/5 p-3 rounded flex justify-between items-center">
            <span className="text-sm font-medium text-foreground">합계:</span>
            <span className="font-bold text-blue-600 tabular-nums">
              ₩{simpleMode ? (parseFloat(simpleTotalAmount || '0')).toLocaleString() : formTotal.toLocaleString()}
            </span>
          </div>

          <button
            onClick={handleCreate}
            disabled={createOrder.isPending || receiveOrderMutation.isPending}
            className={`w-full py-3 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 ${
              inputMode === 'order' && !instantPurchase
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {createOrder.isPending || receiveOrderMutation.isPending
              ? '등록 중...'
              : receivingOrderId ? '✓ 입고 확인'
              : instantPurchase ? '✓ 즉시구매 등록'
              : inputMode === 'order' ? '📋 발주 등록'
              : '✓ 입고 등록'}
          </button>
        </Card>
      )}

      {/* ═══════════════ 즉시지출 입력 폼 ═══════════════ */}
      {inputMode === 'expense' && (
        <Card className="bg-violet-50/30 dark:bg-violet-900/5 border-violet-200 dark:border-violet-800 border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground text-sm">즉시지출 등록</h3>
            <button onClick={() => setInputMode('none')} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-[11px] text-violet-600 dark:text-violet-400 bg-violet-100/50 dark:bg-violet-900/20 px-2 py-1 rounded">
            인터넷발주, 수리비, 소모품 등 발주/입고와 별개의 지출을 기록합니다
          </p>

          {/* 카테고리 */}
          <div>
            <Label className="text-xs">분류</Label>
            <select
              value={expCategoryId}
              onChange={(e) => setExpCategoryId(Number(e.target.value))}
              className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              <option value={0}>분류 선택</option>
              {categories.map((cat: any) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          {/* 내역 */}
          <div>
            <Label className="text-xs">내역</Label>
            <Input
              placeholder="지출 내역 (예: 쿠팡 세제, 화장실 수리)"
              value={expTitle}
              onChange={(e) => setExpTitle(e.target.value)}
              className="mt-1 text-sm h-9"
            />
          </div>

          {/* 금액 */}
          <div>
            <Label className="text-xs">금액</Label>
            <Input
              placeholder="0"
              value={expAmount}
              onChange={(e) => setExpAmount(handleWonInput(e.target.value))}
              className="mt-1 text-sm h-10 text-right font-medium"
              inputMode="numeric"
            />
          </div>

          {/* 메모 */}
          <div>
            <Label className="text-xs">메모 (선택)</Label>
            <Input placeholder="메모" value={expNote} onChange={(e) => setExpNote(e.target.value)} className="mt-1 text-sm h-8" />
          </div>

          {/* 증빙사진 */}
          {expAttachment ? (
            <div className="space-y-2">
              <img
                src={expAttachment}
                alt="증빙"
                className="w-full max-h-36 object-contain rounded border border-border cursor-pointer"
                onClick={() => setViewerImage(expAttachment)}
              />
              <div className="flex justify-end">
                <button onClick={() => setExpAttachment(undefined)} className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1">
                  <X className="w-3.5 h-3.5" /> 삭제
                </button>
              </div>
            </div>
          ) : expUploading ? (
            <div className="flex items-center justify-center py-4">
              <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-2 text-xs text-muted-foreground">업로드 중...</span>
            </div>
          ) : (
            <label className="flex items-center gap-2 border border-dashed border-violet-300 dark:border-violet-700 rounded-lg p-3 cursor-pointer hover:bg-violet-50/50 dark:hover:bg-violet-900/10 transition-colors">
              <Camera className="w-5 h-5 text-violet-500" />
              <div>
                <p className="text-xs font-medium text-foreground">증빙사진 첨부 (선택)</p>
                <p className="text-[10px] text-muted-foreground">영수증, 결제내역 등</p>
              </div>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                if (e.target.files?.[0]) handleExpensePhotoUpload(e.target.files[0]);
              }} />
            </label>
          )}

          <button
            onClick={handleExpenseSubmit}
            disabled={createExpenseMut.isPending}
            className="w-full py-3 rounded-lg text-sm font-bold bg-violet-600 hover:bg-violet-700 text-white transition-colors disabled:opacity-50"
          >
            {createExpenseMut.isPending ? '등록 중...' : `즉시지출 등록${expAmount ? ` (₩${expAmount})` : ''}`}
          </button>
        </Card>
      )}

      {/* ─── 즉시지출 목록 ─── */}
      {expenses.length > 0 && (
        <Card className="bg-card border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-foreground">즉시지출</h3>
            <span className="text-sm font-bold text-foreground">₩{totalExpenses.toLocaleString()}</span>
          </div>
          <div className="space-y-2">
            {expenses.map((exp: any) => (
              <div key={exp.id} className="flex items-center justify-between text-sm border border-border rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{exp.title}</span>
                  {exp.categoryName && (
                    <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">{exp.categoryName}</span>
                  )}
                  {exp.note && <p className="text-xs text-muted-foreground mt-0.5 truncate">{exp.note}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-medium tabular-nums">₩{Number(exp.amount).toLocaleString()}</span>
                  {exp.attachmentUrl && (
                    <button onClick={() => setViewerImage(exp.attachmentUrl)} className="text-violet-500">
                      <Camera className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { if (confirm('삭제할까요?')) deleteExpenseMut.mutate({ id: exp.id }); }} disabled={deleteExpenseMut.isPending}>
                    <Trash2 className="w-3 h-3 text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 미입고 발주 전표 요약 (매입탭 최하단) */}
      <PendingOrdersBanner restaurantId={restaurantId} onReceive={startReceiveFromOrder} />

      {/* ─── 금일 입고/발주 없음 확인 ─── */}
      <NoPurchaseConfirmation restaurantId={restaurantId} date={date} hasPurchases={orders.length > 0} />

      {/* 이미지 확대보기 모달 */}
      {viewerImage && (
        <ImageViewer src={viewerImage} onClose={() => setViewerImage(null)} />
      )}
    </div>
  );
}
