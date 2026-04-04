import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  X, Plus, Check, AlertCircle, Clock, CheckCircle, Users, Pencil, Trash2,
} from 'lucide-react';
import { Button, Card, Input } from '@/components/ui/index';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TabChecklists } from './ChecklistSection';
import { fmtNum, parseNum, handleWonInput, fmtTs, SHIFT_LABELS, type OtherItem, type SpecialItem } from './helpers';

export function CloseTab({
  restaurantId,
  date,
}: {
  restaurantId: number;
  date: string;
}) {
  const [cashAmount, setCashAmount] = useState('');
  const [cardAmount, setCardAmount] = useState('');
  const [giftCardAmount, setGiftCardAmount] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDepositor, setTransferDepositor] = useState('');
  const [otherItems, setOtherItems] = useState<OtherItem[]>([]);
  const [specialItems, setSpecialItems] = useState<SpecialItem[]>([]);
  const [closeNote, setCloseNote] = useState('');

  const operationQuery = trpc.dailyOps.getByDate.useQuery({
    restaurantId,
    date,
  });

  // ── 전체 체크리스트 완료 검증 (4탭 모두) ──
  const openTemplates = trpc.storeChecklists.listTemplates.useQuery({ restaurantId, targetTab: 'open', date });
  const purchaseTemplates = trpc.storeChecklists.listTemplates.useQuery({ restaurantId, targetTab: 'purchase', date });
  const middayTemplates = trpc.storeChecklists.listTemplates.useQuery({ restaurantId, targetTab: 'midday', date });
  const closeTemplates = trpc.storeChecklists.listTemplates.useQuery({ restaurantId, targetTab: 'close', date });
  const openLog = trpc.storeChecklists.getLog.useQuery({ restaurantId, logDate: date, targetTab: 'open' });
  const purchaseLog = trpc.storeChecklists.getLog.useQuery({ restaurantId, logDate: date, targetTab: 'purchase' });
  const middayLog = trpc.storeChecklists.getLog.useQuery({ restaurantId, logDate: date, targetTab: 'midday' });
  const closeLog = trpc.storeChecklists.getLog.useQuery({ restaurantId, logDate: date, targetTab: 'close' });

  const checklistStatus = useMemo(() => {
    const tabs = [
      { key: 'open', label: '오픈', templates: openTemplates.data ?? [], log: openLog.data },
      { key: 'purchase', label: '매입', templates: purchaseTemplates.data ?? [], log: purchaseLog.data },
      { key: 'midday', label: '일간보고', templates: middayTemplates.data ?? [], log: middayLog.data },
      { key: 'close', label: '마감', templates: closeTemplates.data ?? [], log: closeLog.data },
    ];
    const incomplete: string[] = [];
    let totalItems = 0;
    let totalChecked = 0;
    for (const tab of tabs) {
      const total = tab.templates.length;
      if (total === 0) continue;
      // 현재 템플릿 ID와 로그의 체크 ID 교집합으로 비교 (템플릿 추가/삭제 대응)
      const templateIds = new Set(tab.templates.map((t: any) => t.id));
      const logChecked = (tab.log?.checkedItemIds as number[] ?? []).filter(id => templateIds.has(id));
      totalItems += total;
      totalChecked += logChecked.length;
      if (logChecked.length < total) incomplete.push(tab.label);
    }
    return { incomplete, totalItems, totalChecked, allDone: incomplete.length === 0 && totalItems > 0 };
  }, [
    openTemplates.data, purchaseTemplates.data, middayTemplates.data, closeTemplates.data,
    openLog.data, purchaseLog.data, middayLog.data, closeLog.data,
  ]);

  // ── 매입 확인 상태 (입고 내역 or 입고없음 확인) ──
  const purchaseOrdersQuery = trpc.purchasesV2.listByDate.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 },
  );
  const purchaseConfirmed = useMemo(() => {
    const hasPurchases = (purchaseOrdersQuery.data ?? []).length > 0;
    const noOrderConfirmed = purchaseLog.data?.noOrderToday === true;
    return hasPurchases || noOrderConfirmed;
  }, [purchaseOrdersQuery.data, purchaseLog.data]);

  // ── 스케줄 완료 상태 ──
  const daySchedulesQuery = trpc.schedules.getDaySchedules.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 },
  );
  const scheduleStatus = useMemo(() => {
    const schedules = daySchedulesQuery.data ?? [];
    if (schedules.length === 0) return { allDone: true, total: 0, completed: 0, confirmed: 0, draft: 0 };
    const completed = schedules.filter((s: any) => s.status === 'completed').length;
    const confirmed = schedules.filter((s: any) => s.status === 'confirmed').length;
    const draft = schedules.filter((s: any) => s.status === 'draft').length;
    // confirmed는 마감 시 자동 완료되므로, draft만 없으면 OK
    return { allDone: draft === 0, total: schedules.length, completed, confirmed, draft };
  }, [daySchedulesQuery.data]);

  const midSalesQuery = trpc.dailyOps.getMidSales.useQuery({
    restaurantId,
    date,
  });

  const salesQuery = trpc.dailyOps.getDailySales.useQuery({
    restaurantId,
    date,
  });

  const templatesQuery = trpc.dailyOps.getOtherItemTemplates.useQuery({
    restaurantId,
  });

  const utils = trpc.useUtils();
  const saveSalesMutation = trpc.dailyOps.saveDailySales.useMutation({
    onSuccess: () => {
      toast.success('매출이 저장되었습니다.');
      salesQuery.refetch();
      // 마감탭 매출/손익 갱신 → 마감 조건 재평가
      utils.dailyClosings.calculateDay.invalidate();
    },
    onError: (error: any) => {
      toast.error(`저장 실패: ${error.message}`);
    },
  });



  // Initialize from saved sales
  useEffect(() => {
    if (salesQuery.data) {
      const fmtSaved = (v: any) => { const n = Number(v); return n ? fmtNum(n) : ''; };
      setCashAmount(fmtSaved(salesQuery.data.cashAmount));
      setCardAmount(fmtSaved(salesQuery.data.cardAmount));
      setGiftCardAmount(fmtSaved(salesQuery.data.giftCardAmount));
      setTransferAmount(fmtSaved(salesQuery.data.transferAmount));
      setTransferDepositor(salesQuery.data.transferDepositor || '');
      setOtherItems((salesQuery.data.otherItems || []).map((i: any) => ({
        itemName: i.itemName,
        amount: typeof i.amount === 'string' ? parseInt(i.amount, 10) : i.amount,
      })));
      setSpecialItems((salesQuery.data.specialItems || []).map((i: any) => ({
        typeName: i.typeName,
        amount: typeof i.amount === 'string' ? parseInt(i.amount, 10) : i.amount,
        note: i.note || undefined,
      })));
      setCloseNote(salesQuery.data.note || '');
    }
  }, [salesQuery.data]);

  const handleSaveSales = async () => {
    const cash = parseNum(cashAmount);
    const card = parseNum(cardAmount);
    const giftCard = parseNum(giftCardAmount);
    const transfer = parseNum(transferAmount);

    saveSalesMutation.mutate({
      restaurantId,
      date,
      cashAmount: cash,
      cardAmount: card,
      giftCardAmount: giftCard,
      transferAmount: transfer,
      transferDepositor: transferDepositor || undefined,
      otherItems,
      specialItems,
      note: closeNote || undefined,
    });
  };

  const midSalesTotal = (midSalesQuery.data || []).reduce(
    (sum: number, sale: any) => sum + sale.amount,
    0
  );

  const totalAmount =
    (parseNum(cashAmount) +
      parseNum(cardAmount) +
      parseNum(giftCardAmount) +
      parseNum(transferAmount) +
      otherItems.reduce((sum, item) => sum + item.amount, 0));

  const templates = templatesQuery.data || [];

  return (
    <div className="space-y-4 p-4">
      {/* 마감 탭 체크리스트 */}
      <TabChecklists
        restaurantId={restaurantId}
        date={date}
        targetTab="close"
      />

      {/* 금일 운영 확인 */}
      <Card className="bg-card border-border p-4">
        <h3 className="font-semibold text-foreground mb-4">금일 운영 확인</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">오픈 시간:</span>
            <span className="text-foreground">
              {operationQuery.data?.openCheckedAt ? fmtTs(operationQuery.data.openCheckedAt) : '미확인'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">금일 출근 인원:</span>
            <span className="text-foreground">
              {operationQuery.data?.openHeadcount || 0}명
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">중간 매출:</span>
            <span className="text-foreground">₩{midSalesTotal.toLocaleString()}</span>
          </div>
        </div>
      </Card>

      {/* ─── 근무 스케줄 요약 ─── */}
      <ClosingScheduleSummary restaurantId={restaurantId} date={date} />

      {/* 매출 입력 */}
      <Card className="bg-card border-border p-4">
        <h3 className="font-semibold text-foreground mb-4">매출 입력</h3>
        <div className="space-y-3 mb-4">
          <div>
            <Label htmlFor="cash" className="text-sm">
              현금 매출
            </Label>
            <Input
              id="cash"
              type="text"
              inputMode="numeric"
              placeholder="0"
              autoComplete="off"
              value={cashAmount}
              onChange={(e) => setCashAmount(handleWonInput(e.target.value))}
              className="mt-1 text-right"
            />
          </div>
          <div>
            <Label htmlFor="card" className="text-sm">
              카드 매출
            </Label>
            <Input
              id="card"
              type="text"
              inputMode="numeric"
              placeholder="0"
              autoComplete="off"
              value={cardAmount}
              onChange={(e) => setCardAmount(handleWonInput(e.target.value))}
              className="mt-1 text-right"
            />
          </div>
          <div>
            <Label htmlFor="giftcard" className="text-sm">
              상품권 매출
            </Label>
            <Input
              id="giftcard"
              type="text"
              inputMode="numeric"
              placeholder="0"
              autoComplete="off"
              value={giftCardAmount}
              onChange={(e) => setGiftCardAmount(handleWonInput(e.target.value))}
              className="mt-1 text-right"
            />
          </div>
          <div>
            <Label htmlFor="transfer" className="text-sm">
              계좌이체 매출
            </Label>
            <div className="flex gap-2 mt-1">
              <Input
                id="transfer"
                type="text"
                inputMode="numeric"
                placeholder="금액"
                autoComplete="off"
                value={transferAmount}
                onChange={(e) => setTransferAmount(handleWonInput(e.target.value))}
                className="flex-1 text-right"
              />
              <Input
                placeholder="입금자명"
                autoComplete="off"
                value={transferDepositor}
                onChange={(e) => setTransferDepositor(e.target.value)}
                className="w-28"
              />
            </div>
          </div>

          {/* 기타 매출 */}
          <div className="border-t border-border pt-3">
            <Label className="text-sm">기타 매출</Label>
            {otherItems.map((item, idx) => (
              <div key={idx} className="flex gap-2 mt-2">
                <Input
                  placeholder="항목명"
                  autoComplete="off"
                  value={item.itemName}
                  onChange={(e) => {
                    const newItems = [...otherItems];
                    newItems[idx].itemName = e.target.value;
                    setOtherItems(newItems);
                  }}
                  className="text-sm h-8"
                />
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="금액"
                  autoComplete="off"
                  value={item.amount ? fmtNum(item.amount) : ''}
                  onChange={(e) => {
                    const newItems = [...otherItems];
                    newItems[idx].amount = parseNum(e.target.value);
                    setOtherItems(newItems);
                  }}
                  className="text-sm h-8 w-28 text-right"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOtherItems(otherItems.filter((_, i) => i !== idx));
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}

            {templates.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {templates.map((template: any) => (
                  <button
                    key={template.id}
                    onClick={() => {
                      setOtherItems([
                        ...otherItems,
                        { itemName: template.itemName, amount: 0 },
                      ]);
                    }}
                    className="text-xs px-2 py-1 bg-blue-500/10 text-blue-600 border border-blue-200 rounded hover:bg-blue-500/20"
                  >
                    + {template.itemName}
                  </button>
                ))}
              </div>
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOtherItems([...otherItems, { itemName: '', amount: 0 }])}
              className="w-full mt-2"
            >
              <Plus className="w-4 h-4 mr-2" /> 항목 추가
            </Button>
          </div>

          {/* 매출 특이사항 */}
          <div className="border-t border-border pt-3">
            <Label className="text-sm">매출 특이사항</Label>
            <div className="flex gap-2 mt-2 flex-wrap">
              {['할인', '외상', '미입금', '기타'].map((type) => (
                <Button
                  key={type}
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSpecialItems([...specialItems, { typeName: type, amount: 0 }]);
                  }}
                >
                  + {type}
                </Button>
              ))}
            </div>

            {specialItems.map((item, idx) => (
              <div key={idx} className="flex gap-2 mt-2">
                <Input
                  placeholder="유형"
                  value={item.typeName}
                  onChange={(e) => {
                    const newItems = [...specialItems];
                    newItems[idx].typeName = e.target.value;
                    setSpecialItems(newItems);
                  }}
                  className="text-sm h-8 w-20"
                />
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="금액"
                  value={item.amount ? fmtNum(item.amount) : ''}
                  onChange={(e) => {
                    const newItems = [...specialItems];
                    newItems[idx].amount = parseNum(e.target.value);
                    setSpecialItems(newItems);
                  }}
                  className="text-sm h-8 w-28 text-right"
                />
                <Input
                  placeholder="메모"
                  value={item.note || ''}
                  onChange={(e) => {
                    const newItems = [...specialItems];
                    newItems[idx].note = e.target.value;
                    setSpecialItems(newItems);
                  }}
                  className="text-sm h-8"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSpecialItems(specialItems.filter((_, i) => i !== idx));
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* 메모 */}
          <div className="border-t border-border pt-3">
            <Label htmlFor="close-note" className="text-sm">
              매출 메모
            </Label>
            <Textarea
              id="close-note"
              placeholder="특이사항, 메모 등"
              value={closeNote}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCloseNote(e.target.value)}
              className="mt-1 text-sm h-20"
            />
          </div>

          {/* 합계 */}
          <div className="border-t border-border pt-3 bg-blue-500/5 p-3 rounded">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-foreground">합계:</span>
              <span className="text-lg font-bold text-blue-600">
                {fmtNum(totalAmount)}원
              </span>
            </div>
          </div>

          <Button
            onClick={handleSaveSales}
            disabled={saveSalesMutation.isPending}
            className="w-full"
          >
            {saveSalesMutation.isPending ? '저장 중...' : '매출 저장'}
          </Button>
        </div>
      </Card>

      {/* ─── 일마감 손익 + 마감 확정 (통합) ─── */}
      <ClosingProfitSection
        restaurantId={restaurantId}
        date={date}
        closeNote={closeNote}
        checklistAllDone={checklistStatus.allDone}
        checklistStatus={checklistStatus}
        purchaseConfirmed={purchaseConfirmed}
        scheduleStatus={scheduleStatus}
        alreadyCloseChecked={!!operationQuery.data?.closeCheckedAt}
      />
    </div>
  );
}

// ============================================================================
// CLOSING SCHEDULE SUMMARY – 요약형 (금일운영확인 아래 배치)
// ============================================================================

export function ClosingScheduleSummary({ restaurantId, date }: { restaurantId: number; date: string }) {
  const [expanded, setExpanded] = useState(true);
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const { data: daySchedules = [], isLoading } = trpc.schedules.getDaySchedules.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 }
  );

  const completeDay = trpc.schedules.completeDay.useMutation({
    onSuccess(data: any) {
      toast.success(`${data.affected}건 근무완료 처리됨`);
      utils.schedules.getDaySchedules.invalidate();
    },
    onError(err: any) { toast.error(err.message); },
  });

  const completeOne = trpc.schedules.completeOne.useMutation({
    onSuccess() {
      toast.success('완료 처리됨');
      utils.schedules.getDaySchedules.invalidate();
    },
    onError(err: any) { toast.error(err.message); },
  });

  if (isLoading) return null;

  const confirmed = daySchedules.filter((s: any) => s.status === 'confirmed');
  const completed = daySchedules.filter((s: any) => s.status === 'completed');
  const draft = daySchedules.filter((s: any) => s.status === 'draft');
  const total = daySchedules.length;

  if (total === 0) return null;

  return (
    <Card className="bg-card border-border p-4 space-y-2">
      {/* 요약 헤더 (항상 표시) */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-foreground text-sm">근무 스케줄</span>
          <span className="text-xs text-muted-foreground">({total}명)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[10px]">
            {completed.length > 0 && <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 font-medium">완료 {completed.length}</span>}
            {confirmed.length > 0 && <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 font-medium">확정 {confirmed.length}</span>}
            {draft.length > 0 && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 font-medium">초안 {draft.length}</span>}
          </div>
          <svg className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </div>
      </button>

      {/* 펼친 상세 (접이식) */}
      {expanded && (
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="space-y-1.5">
            {daySchedules.map((s: any) => {
              const isConfirmed = s.status === 'confirmed';
              const isCompleted = s.status === 'completed';
              const isDraft = s.status === 'draft';
              return (
                <div
                  key={s.id}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm ${
                    isCompleted
                      ? 'bg-emerald-500/10 border-emerald-200 dark:border-emerald-800'
                      : isDraft
                      ? 'bg-muted/30 border-border opacity-60'
                      : 'bg-card border-border'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isCompleted ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : isDraft ? (
                      <AlertCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    )}
                    <span className="font-medium text-foreground truncate">
                      {s.userName ?? s.tempWorkerName ?? '미배정'}
                      {s.tempWorkerName && <span className="text-orange-500 ml-1 text-xs">(임시)</span>}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {fmtTs(s.startTime)}~{fmtTs(s.endTime)}
                      {s.shiftPreset && <span className="ml-1 opacity-70">({SHIFT_LABELS[s.shiftPreset] ?? s.shiftPreset})</span>}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isCompleted && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 font-medium">완료</span>
                    )}
                    {isDraft && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 font-medium">초안</span>
                    )}
                    {isConfirmed && (
                      <button
                        onClick={(e) => { e.stopPropagation(); completeOne.mutate({ id: s.id }); }}
                        disabled={completeOne.isPending}
                        className="text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 font-medium hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors"
                      >
                        완료처리
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 하단 액션 버튼 */}
          <div className="flex gap-2 pt-2">
            {confirmed.length > 0 && (
              <button
                onClick={() => completeDay.mutate({ restaurantId, date })}
                disabled={completeDay.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                <CheckCircle className="w-4 h-4" />
                전체 완료 처리 ({confirmed.length}건)
              </button>
            )}
            <button
              onClick={() => setLocation('/schedule')}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium border border-border bg-muted/50 text-foreground hover:bg-muted transition-colors ${confirmed.length > 0 ? '' : 'flex-1'}`}
            >
              <Pencil className="w-4 h-4" />
              스케줄 수정
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// CLOSING PROFIT SECTION – 일마감 손익 요약
// ============================================================================

export function ClosingProfitSection({ restaurantId, date, closeNote, checklistAllDone, checklistStatus, purchaseConfirmed, scheduleStatus, alreadyCloseChecked }: {
  restaurantId: number;
  date: string;
  closeNote?: string;
  checklistAllDone: boolean;
  checklistStatus: { totalChecked: number; totalItems: number; incomplete: string[] };
  purchaseConfirmed: boolean;
  scheduleStatus: { allDone: boolean; total: number; completed: number; confirmed: number; draft: number };
  alreadyCloseChecked: boolean;
}) {
  const [laborCost, setLaborCost] = useState('0');
  const [closingNote, setClosingNote] = useState('');
  const utils = trpc.useUtils();

  // 미입고 발주 건수 확인
  const purchaseOrdersQuery = trpc.purchasesV2.listByDate.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 }
  );
  const pendingOrderCount = (purchaseOrdersQuery.data ?? []).filter((o: any) => o.status !== 'received').length;

  const { data: calculated, isLoading: calcLoading } = trpc.dailyClosings.calculateDay.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 }
  );

  const { data: existing } = trpc.dailyClosings.getByDate.useQuery(
    { restaurantId, date },
    { enabled: restaurantId > 0 }
  );

  const dateObj = new Date(date);
  const daysInMonth = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0).getDate();
  const { data: fixedTotal } = trpc.fixedCosts.monthlyTotal.useQuery(
    { restaurantId, year: dateObj.getFullYear(), month: dateObj.getMonth() + 1 },
    { enabled: restaurantId > 0 }
  );
  const dailyFixed = fixedTotal ? Math.round(Number(fixedTotal.total) / daysInMonth) : 0;

  useEffect(() => {
    if (existing) {
      setLaborCost(existing.laborCost ?? '0');
      setClosingNote(existing.note ?? '');
    } else if (calculated?.laborCost) {
      // 신규 마감: 스케줄 기반 자동 계산된 인건비 반영
      setLaborCost(calculated.laborCost);
      setClosingNote('');
    } else {
      setLaborCost('0');
      setClosingNote('');
    }
  }, [existing, calculated]);

  const save = trpc.dailyClosings.save.useMutation({
    onSuccess(data: any) {
      toast.success(data.updated ? '마감 수정 완료' : '마감 저장 완료');
      utils.dailyClosings.getByDate.invalidate();
      utils.dailyClosings.listByMonth.invalidate();
      utils.dailyClosings.monthlySummary.invalidate();
    },
    onError(err: any) { toast.error(err.message); },
  });

  const checkCloseMutation = trpc.dailyOps.checkClose.useMutation({
    onSuccess() {
      utils.dailyOps.getByDate.invalidate();
    },
  });

  const completeDayMut = trpc.schedules.completeDay.useMutation();

  // 휴무일 확인 (지정 휴무 + 정기 휴무 요일) — Hook은 조건부 return 전에 선언
  const closedDaysQuery = trpc.storeClosures.listByMonth.useQuery(
    { restaurantId, year: dateObj.getFullYear(), month: dateObj.getMonth() + 1 },
    { enabled: restaurantId > 0 }
  );
  const weeklyClosuresQuery = trpc.storeClosures.getWeeklyClosures.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 }
  );
  const isClosedDay = useMemo(() => {
    const specificClosed = (closedDaysQuery.data ?? []).some(
      (d: any) => (typeof d.closedDate === 'string' ? d.closedDate : d.closedDate?.toISOString?.()?.slice(0, 10)) === date
    );
    if (specificClosed) return true;
    const dayOfWeek = dateObj.getDay();
    return (weeklyClosuresQuery.data ?? []).some((w: any) => w.weekday === dayOfWeek);
  }, [closedDaysQuery.data, weeklyClosuresQuery.data, date]);

  if (calcLoading) return null;

  const salesTotal = calculated?.salesTotal ?? '0';
  const purchasesTotal = calculated?.purchasesTotal ?? '0';
  const profit = Number(salesTotal) - Number(purchasesTotal) - Number(laborCost) - dailyFixed;

  // 마감 불가 조건: 체크리스트 + 매입확인 + 스케줄(draft 없어야 함) + 매출0 검증
  const checklistOk = checklistStatus.totalItems === 0 || checklistAllDone;
  const scheduleOk = scheduleStatus.allDone; // draft === 0
  const salesZero = !isClosedDay && Number(salesTotal) === 0;
  const canClose = checklistOk && purchaseConfirmed && scheduleOk;

  const handleSaveClosing = () => {
    if (salesZero && !existing) {
      if (!window.confirm('매출이 0원입니다. 매출 0원으로 마감하시겠습니까?')) return;
    }
    save.mutate({
      restaurantId,
      closingDate: date,
      salesTotal,
      purchasesTotal,
      laborCost,
      fixedCostShare: String(dailyFixed),
      profit: String(profit),
      note: closingNote || undefined,
    });
    // 마감 체크도 동시 실행 (아직 안 된 경우만)
    if (!alreadyCloseChecked) {
      checkCloseMutation.mutate({
        restaurantId,
        date,
        closeNote: closeNote || undefined,
      });
    }
    // confirmed 스케줄 → completed 자동 처리
    if (scheduleStatus.confirmed > 0) {
      completeDayMut.mutate({ restaurantId, date });
    }
  };

  return (
    <Card className="bg-card border-border p-4 space-y-3">
      <h3 className="font-semibold text-foreground text-sm">일마감 손익</h3>

      {existing && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 rounded-lg">
          <Check className="w-3.5 h-3.5 text-emerald-600" />
          <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">마감 완료됨 — 수정 가능</span>
        </div>
      )}

      {/* 자동 집계 */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="bg-muted/30 rounded-lg p-2.5">
          <span className="text-xs text-muted-foreground">매출</span>
          <div className="font-semibold text-foreground tabular-nums">{Number(salesTotal).toLocaleString()}원</div>
        </div>
        <div className="bg-muted/30 rounded-lg p-2.5">
          <span className="text-xs text-muted-foreground">매입</span>
          <div className="font-semibold text-foreground tabular-nums">{Number(purchasesTotal).toLocaleString()}원</div>
        </div>
      </div>

      {/* 인건비 */}
      <div>
        <div className="flex items-center gap-2">
          <Label className="text-xs">인건비 (원)</Label>
          {!existing && calculated?.laborCost && Number(calculated.laborCost) > 0 && (
            <span className="text-[10px] text-blue-600 dark:text-blue-400">스케줄 자동계산</span>
          )}
        </div>
        <Input
          type="number"
          value={laborCost}
          onChange={(e) => setLaborCost(e.target.value)}
          className="mt-1 text-sm h-9"
        />
      </div>

      {/* 고정비 */}
      <div className="text-xs text-muted-foreground">
        고정비 (일할): {dailyFixed.toLocaleString()}원
        <span className="ml-1 opacity-70">({Number(fixedTotal?.total ?? 0).toLocaleString()}원 ÷ {daysInMonth}일)</span>
      </div>

      {/* 손익 */}
      <div className={`p-3 rounded-lg ${profit >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">손익</span>
          <span className={`text-xl font-bold tabular-nums ${profit >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600'}`}>
            {profit >= 0 ? '+' : ''}{profit.toLocaleString()}원
          </span>
        </div>
      </div>

      {/* 메모 */}
      <Input
        value={closingNote}
        onChange={(e) => setClosingNote(e.target.value)}
        placeholder="마감 메모 (선택)"
        className="text-sm h-9"
      />

      {/* 마감 불가 사유 경고 */}
      {!canClose && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 p-3 space-y-1">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">마감 전 완료 필요 항목</p>
          {!checklistOk && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              · 체크리스트 미완료 ({checklistStatus.totalChecked}/{checklistStatus.totalItems}) — {checklistStatus.incomplete.join(', ')}
            </p>
          )}
          {!purchaseConfirmed && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              · 매입 미확인 — 매입탭에서 입고 등록 또는 "입고/발주 없음" 확인 필요
            </p>
          )}
          {!scheduleOk && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              · 미확정 스케줄 {scheduleStatus.draft}건 — <a href={`/schedule?date=${date}`} className="underline font-medium hover:text-amber-800">스케줄 수정</a> (초안 상태는 마감 불가)
            </p>
          )}
        </div>
      )}

      {/* 매출 0원 안내 (휴무일 아닌 경우) */}
      {salesZero && !existing && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-700 p-3">
          <p className="text-[11px] text-orange-700 dark:text-orange-300">
            ⚠ 매출이 0원입니다. 마감 확정 시 확인 메시지가 표시됩니다.
          </p>
        </div>
      )}

      {/* 미입고 발주 경고 (차단은 아님, 안내) */}
      {pendingOrderCount > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-700 p-3">
          <p className="text-[11px] text-blue-700 dark:text-blue-300">
            ⚠ 미입고 발주 {pendingOrderCount}건이 있습니다. 발주 상태의 매입은 정산에 반영되지 않습니다.
          </p>
        </div>
      )}

      {/* confirmed 스케줄 자동완료 안내 */}
      {canClose && !existing && scheduleStatus.confirmed > 0 && (
        <p className="text-[11px] text-blue-600 dark:text-blue-400">
          확정 스케줄 {scheduleStatus.confirmed}건이 마감 시 자동으로 완료 처리됩니다.
        </p>
      )}

      <Button
        onClick={handleSaveClosing}
        disabled={save.isPending || checkCloseMutation.isPending || completeDayMut.isPending || (!existing && !canClose)}
        className="w-full"
        size="lg"
      >
        {save.isPending || checkCloseMutation.isPending || completeDayMut.isPending
          ? '저장 중...'
          : !canClose && !existing
            ? '마감 조건 충족 후 확정 가능'
            : existing
              ? '마감 수정'
              : '마감 확정'}
      </Button>
    </Card>
  );
}
