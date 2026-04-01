import { useState, useMemo, useRef } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/hooks/useAuth";
import {
  CheckCircle2, Circle, AlertTriangle, TrendingUp, TrendingDown,
  ChevronDown, ChevronUp, Lock, Loader2, ArrowUpRight, ArrowDownRight,
  Calendar, CreditCard, Banknote, Gift, ArrowRightLeft, MoreHorizontal,
  Camera, X, Image as ImageIcon, Trash2,
} from "lucide-react";
import { Card, MonthNav, PageHeader, EmptyState } from "@/components/ui/compat";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Section = "collection" | "income" | "metrics" | "comparison" | null;
type IncomeExpand = "sales" | "purchases" | "labor" | "fixed" | null;

export default function MonthlySettlementPage() {
  const { user } = useAuth();
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;

  const isPrivileged =
    user?.role === "master" || user?.role === "admin" || current?.storeRole === "owner";

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [expandedSection, setExpandedSection] = useState<Section>(null);
  const [incomeExpand, setIncomeExpand] = useState<IncomeExpand>(null);

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1);
    setExpandedSection(null); setIncomeExpand(null);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1);
    setExpandedSection(null); setIncomeExpand(null);
  };

  const { data, isLoading, refetch } = trpc.monthlyClosings.settlementData.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 },
  );

  const closeMutation = trpc.monthlyClosings.close.useMutation({
    onSuccess: () => refetch(),
  });

  // 증빙 이미지
  const imagesQuery = trpc.monthlyClosings.getImages.useQuery(
    { restaurantId, year, month },
    { enabled: restaurantId > 0 },
  );
  const addImageMut = trpc.monthlyClosings.addImage.useMutation({
    onSuccess: () => imagesQuery.refetch(),
  });
  const deleteImageMut = trpc.monthlyClosings.deleteImage.useMutation({
    onSuccess: () => imagesQuery.refetch(),
  });
  const updateAmountMut = trpc.monthlyClosings.updateImageAmount.useMutation({
    onSuccess: () => imagesQuery.refetch(),
  });
  const [uploadingCpId, setUploadingCpId] = useState<number | null>(null);
  const [viewImage, setViewImage] = useState<string | null>(null);
  const [editingAmountId, setEditingAmountId] = useState<number | null>(null);
  const [amountInput, setAmountInput] = useState("");

  const handleImageUpload = async (cpId: number | null, file: File) => {
    setUploadingCpId(cpId);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload/settlement-image", { method: "POST", body: form });
      if (!res.ok) throw new Error("업로드 실패");
      const { url } = await res.json();
      await addImageMut.mutateAsync({ restaurantId, year, month, counterpartyId: cpId, imageUrl: url });
      toast.success("증빙 사진이 저장되었습니다");
    } catch {
      toast.error("업로드 실패");
    } finally {
      setUploadingCpId(null);
    }
  };

  const handleClose = () => {
    if (!confirm(`${year}년 ${month}월 월정산을 확정하시겠습니까?\n\n확정 후에도 재확정이 가능합니다.`)) return;
    closeMutation.mutate({ restaurantId, year, month });
  };

  if (!restaurantId) return <EmptyState icon={<Calendar size={40} />} title="매장을 선택해주세요" />;
  if (isLoading || !data) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const { collection, income, metrics, prevMonth: prevData, closing } = data;
  const profit = income.profit;

  // 수집 완료율
  const checks = [
    { done: collection.unclosedDates.length === 0, label: "일마감" },
    { done: collection.salesMissingDates.length === 0, label: "매출" },
    { done: collection.purchaseCount > 0, label: "매입" },
    { done: collection.zeroLaborDates.length === 0 && collection.draftScheduleCount === 0, label: "인건비" },
    { done: collection.fixedCostCount > 0, label: "고정비" },
  ];
  const completedChecks = checks.filter(c => c.done).length;
  const completionPct = Math.round(completedChecks / checks.length * 100);

  return (
    <div>
      {/* ── Section 0: 헤더 ─────────────────────────────────────── */}
      <PageHeader
        title="월정산"
        description={current?.name}
        action={
          closing.isClosed ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              확정완료
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-medium">
              <Circle className="h-3.5 w-3.5" />
              미확정
            </span>
          )
        }
      />

      <MonthNav
        year={year} month={month}
        onPrev={prevMonth} onNext={nextMonth}
        rightSlot={
          <span className="text-xs text-muted-foreground">
            {collection.closedDays}/{collection.operatingDays}일 마감
          </span>
        }
      />

      {/* ── Section 1: 데이터 수집 현황 ──────────────────────────── */}
      <Card className="p-4 mb-4">
        <button
          className="w-full flex items-center justify-between"
          onClick={() => setExpandedSection(expandedSection === "collection" ? null : "collection")}
        >
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
              completionPct === 100
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            }`}>
              {completionPct}%
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-foreground">데이터 수집 현황</div>
              <div className="text-xs text-muted-foreground">
                {completionPct === 100 ? "모든 데이터가 수집되었습니다" : `${5 - completedChecks}개 항목 확인 필요`}
              </div>
            </div>
          </div>
          {expandedSection === "collection" ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {expandedSection === "collection" && (
          <div className="mt-4 pt-3 border-t border-border space-y-3">
            {/* 일마감 */}
            <CheckItem
              done={collection.unclosedDates.length === 0}
              label="일마감"
              detail={
                collection.unclosedDates.length > 0
                  ? `${collection.unclosedDates.length}일 미마감 (${collection.unclosedDates.map(d => `${parseInt(d.split("-")[2])}일`).join(", ")})`
                  : `${collection.closedDays}일 전체 마감 완료`
              }
            />
            {/* 매출 */}
            <CheckItem
              done={collection.salesMissingDates.length === 0}
              label="매출 입력"
              detail={
                collection.salesMissingDates.length > 0
                  ? `${collection.salesMissingDates.length}일 매출 미입력`
                  : `${collection.salesInputDays}일 입력 완료`
              }
            />
            {/* 매입 */}
            <CheckItem
              done={collection.purchaseCount > 0}
              label="매입 데이터"
              detail={collection.purchaseCount > 0 ? `${collection.purchaseTotal}건 등록` : "매입 데이터 없음"}
            />
            {/* 인건비 */}
            <CheckItem
              done={collection.zeroLaborDates.length === 0 && collection.draftScheduleCount === 0}
              label="인건비"
              detail={
                collection.zeroLaborDates.length > 0
                  ? `인건비 0원인 날 ${collection.zeroLaborDates.length}일`
                  : collection.draftScheduleCount > 0
                    ? `미확정 스케줄 ${collection.draftScheduleCount}건`
                    : "스케줄 기반 인건비 계산 완료"
              }
            />
            {/* 고정비 */}
            <CheckItem
              done={collection.fixedCostCount > 0}
              label="고정비"
              detail={collection.fixedCostCount > 0 ? `${collection.fixedCostCount}개 항목 등록` : "고정비 미등록"}
            />
          </div>
        )}
      </Card>

      {/* ── Section 2: 손익 요약 ──────────────────────────────────── */}
      <Card className={`p-4 mb-4 ${profit >= 0 ? "border-emerald-200 dark:border-emerald-800" : "border-red-200 dark:border-red-800"}`}>
        <div className="flex items-center gap-2 mb-1">
          {profit >= 0 ? <TrendingUp size={16} className="text-emerald-600" /> : <TrendingDown size={16} className="text-red-500" />}
          <span className="text-xs text-muted-foreground font-medium">월 순이익</span>
        </div>
        <p className={`text-2xl font-bold tabular-nums ${profit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {profit >= 0 ? "+" : ""}{profit.toLocaleString()}
          <span className="text-sm text-muted-foreground ml-1">원</span>
        </p>
        {income.salesTotal > 0 && (
          <p className="text-xs text-muted-foreground mt-0.5">수익률 {metrics.profitRatio}%</p>
        )}
      </Card>

      {/* 손익 항목별 상세 */}
      <div className="space-y-2 mb-4">
        {/* 매출 */}
        <IncomeRow
          label="매출"
          amount={income.salesTotal}
          positive
          expanded={incomeExpand === "sales"}
          onToggle={() => setIncomeExpand(incomeExpand === "sales" ? null : "sales")}
          locked={!isPrivileged}
        >
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground mb-2">결제수단별</div>
            <div className="grid grid-cols-2 gap-2">
              <MethodChip icon={<CreditCard className="h-3 w-3" />} label="카드" amount={income.salesByMethod.card} />
              <MethodChip icon={<Banknote className="h-3 w-3" />} label="현금" amount={income.salesByMethod.cash} />
              <MethodChip icon={<Gift className="h-3 w-3" />} label="상품권" amount={income.salesByMethod.giftCard} />
              <MethodChip icon={<ArrowRightLeft className="h-3 w-3" />} label="계좌이체" amount={income.salesByMethod.transfer} />
              {income.salesByMethod.other > 0 && (
                <MethodChip icon={<MoreHorizontal className="h-3 w-3" />} label="기타" amount={income.salesByMethod.other} />
              )}
            </div>
          </div>
        </IncomeRow>

        {/* 매입 */}
        <IncomeRow
          label="매입 (식재료비)"
          amount={income.purchasesTotal}
          ratio={metrics.costRatio}
          expanded={incomeExpand === "purchases"}
          onToggle={() => setIncomeExpand(incomeExpand === "purchases" ? null : "purchases")}
          locked={!isPrivileged}
        >
          {income.purchasesByCounterparty.length > 0 ? (
            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">거래처별 (입고 합계 vs 정산서)</div>
              {income.purchasesByCounterparty.map((cp) => {
                const cpImages = (imagesQuery.data ?? []).filter((img: any) => img.counterpartyId === cp.id);
                // 정산서 금액: 해당 거래처 이미지 중 claimedAmount가 있는 것들의 합
                const claimedTotal = cpImages.reduce((s: number, img: any) => s + (img.claimedAmount ?? 0), 0);
                const hasClaimedAmount = cpImages.some((img: any) => img.claimedAmount != null && img.claimedAmount > 0);
                const diff = hasClaimedAmount ? cp.amount - claimedTotal : null;
                const hasMismatch = diff !== null && diff !== 0;

                return (
                  <div key={cp.id} className="rounded-lg border border-border/50 p-2.5 space-y-1.5">
                    {/* 거래처명 + 업로드 버튼 */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground">{cp.name} <span className="text-muted-foreground">({cp.count}건)</span></span>
                      {isPrivileged && (
                        <label className="cursor-pointer text-muted-foreground hover:text-primary transition-colors">
                          {uploadingCpId === cp.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleImageUpload(cp.id, f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      )}
                    </div>

                    {/* 금액 비교 */}
                    <div className="grid grid-cols-2 gap-1 text-[11px]">
                      <div>
                        <span className="text-muted-foreground">입고 합계</span>
                        <div className="font-medium text-foreground tabular-nums">{cp.amount.toLocaleString()}원</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">정산서 금액</span>
                        {hasClaimedAmount ? (
                          <div className={`font-medium tabular-nums ${hasMismatch ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}`}>
                            {claimedTotal.toLocaleString()}원
                          </div>
                        ) : (
                          <div className="text-muted-foreground">미입력</div>
                        )}
                      </div>
                    </div>

                    {/* 차이 경고 */}
                    {hasMismatch && (
                      <div className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded ${
                        diff! > 0 ? "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400" : "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400"
                      }`}>
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        <span>
                          {diff! > 0
                            ? `입고가 정산서보다 ${diff!.toLocaleString()}원 많음`
                            : `정산서가 입고보다 ${Math.abs(diff!).toLocaleString()}원 많음`
                          }
                        </span>
                      </div>
                    )}

                    {/* 이미지 썸네일 + 정산서 금액 입력 */}
                    {cpImages.length > 0 && (
                      <div className="flex gap-1.5 overflow-x-auto pb-1">
                        {cpImages.map((img: any) => (
                          <div key={img.id} className="relative shrink-0 group">
                            <img
                              src={img.imageUrl}
                              alt="증빙"
                              className="w-14 h-14 object-cover rounded border border-border cursor-pointer"
                              onClick={() => setViewImage(img.imageUrl)}
                            />
                            {isPrivileged && (
                              <button
                                onClick={() => {
                                  if (confirm("이 증빙 사진을 삭제하시겠습니까?")) {
                                    deleteImageMut.mutate({ id: img.id, restaurantId });
                                  }
                                }}
                                className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            )}
                            {/* 금액 표시/입력 */}
                            {editingAmountId === img.id ? (
                              <input
                                type="number"
                                autoFocus
                                className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[9px] text-center py-0.5 rounded-b w-14 outline-none"
                                placeholder="금액"
                                value={amountInput}
                                onChange={(e) => setAmountInput(e.target.value)}
                                onBlur={() => {
                                  const val = amountInput ? parseInt(amountInput) : null;
                                  updateAmountMut.mutate({ id: img.id, restaurantId, claimedAmount: val });
                                  setEditingAmountId(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                }}
                              />
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingAmountId(img.id);
                                  setAmountInput(img.claimedAmount ? String(img.claimedAmount) : "");
                                }}
                                className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] text-center py-0.5 rounded-b truncate"
                              >
                                {img.claimedAmount ? `${(img.claimedAmount / 10000).toFixed(0)}만` : "금액입력"}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">매입 데이터 없음</p>
          )}
        </IncomeRow>

        {/* 인건비 */}
        <IncomeRow
          label="인건비"
          amount={income.laborCost}
          ratio={metrics.laborRatio}
          expanded={incomeExpand === "labor"}
          onToggle={() => setIncomeExpand(incomeExpand === "labor" ? null : "labor")}
          locked={!isPrivileged}
        >
          {income.laborByCompany.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground mb-2">소속회사별</div>
              {income.laborByCompany.map((co) => (
                <div key={co.company} className="flex items-center justify-between text-xs">
                  <span className="text-foreground">
                    {co.company}
                    <span className="text-muted-foreground ml-1">({co.headcount}명, {co.hours}h)</span>
                  </span>
                  <span className="font-medium text-foreground tabular-nums">{co.amount.toLocaleString()}원</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">인건비 데이터 없음</p>
          )}
        </IncomeRow>

        {/* 고정비 */}
        <IncomeRow
          label="고정비"
          amount={income.fixedCostsTotal}
          expanded={incomeExpand === "fixed"}
          onToggle={() => setIncomeExpand(incomeExpand === "fixed" ? null : "fixed")}
          locked={!isPrivileged}
        >
          {income.fixedBreakdown.length > 0 ? (
            <div className="space-y-1.5">
              {income.fixedBreakdown.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-foreground">
                    {f.name}
                    <span className="text-muted-foreground ml-1">
                      ({f.type === "monthly" ? "월납" : f.type === "yearly" ? "연납÷12" : f.type === "quarterly" ? "분기÷3" : f.type === "sales_ratio" ? "매출비례" : "일시"})
                    </span>
                  </span>
                  <span className="font-medium text-foreground tabular-nums">{f.amount.toLocaleString()}원</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">고정비 미등록</p>
          )}
        </IncomeRow>
      </div>

      {/* ── Section 3: 운영 지표 ──────────────────────────────────── */}
      {income.salesTotal > 0 && (
        <Card className="p-4 mb-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">운영 지표</h3>
          <div className="space-y-3">
            <MetricRow
              label="일평균 매출"
              value={`${metrics.dailyAvgSales.toLocaleString()}원`}
              target={metrics.targetSales > 0 ? `목표 ${Math.round(metrics.targetSales / collection.daysInMonth).toLocaleString()}원/일` : undefined}
            />
            <MetricRow
              label="매출원가율"
              value={`${metrics.costRatio}%`}
              target={metrics.targetCostRatio > 0 ? `목표 ${metrics.targetCostRatio}%` : undefined}
              warning={metrics.targetCostRatio > 0 && metrics.costRatio > metrics.targetCostRatio}
            />
            <MetricRow
              label="인건비율"
              value={`${metrics.laborRatio}%`}
              target={metrics.targetLaborRatio > 0 ? `목표 ${metrics.targetLaborRatio}%` : undefined}
              warning={metrics.targetLaborRatio > 0 && metrics.laborRatio > metrics.targetLaborRatio}
            />
            <MetricRow
              label="수익률"
              value={`${metrics.profitRatio}%`}
              good={metrics.profitRatio > 0}
            />
            {metrics.targetSales > 0 && (
              <div className="pt-2 border-t border-border">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-muted-foreground">매출 목표 달성률</span>
                  <span className="text-sm font-bold tabular-nums text-foreground">
                    {Math.round(income.salesTotal / metrics.targetSales * 100)}%
                  </span>
                </div>
                <div className="w-full bg-muted rounded-full h-2.5">
                  <div
                    className="bg-primary h-2.5 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(Math.round(income.salesTotal / metrics.targetSales * 100), 100)}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[11px] text-muted-foreground tabular-nums">{income.salesTotal.toLocaleString()}원</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">목표 {metrics.targetSales.toLocaleString()}원</span>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── Section 4: 전월 비교 ──────────────────────────────────── */}
      {prevData && (
        <Card className="p-4 mb-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">전월 비교</h3>
          <div className="space-y-2">
            <CompRow label="매출" current={income.salesTotal} prev={prevData.salesTotal} />
            <CompRow label="매입" current={income.purchasesTotal} prev={prevData.purchasesTotal} reverse />
            <CompRow label="인건비" current={income.laborCost} prev={prevData.laborCost} reverse />
            <CompRow label="고정비" current={income.fixedCostsTotal} prev={prevData.fixedCostsTotal} reverse />
            <div className="pt-2 border-t border-border">
              <CompRow label="순이익" current={income.profit} prev={prevData.profit} bold />
            </div>
          </div>
        </Card>
      )}

      {/* ── Section 5: 월정산 확정 ────────────────────────────────── */}
      <Card className="p-4 mb-6">
        {closing.isClosed ? (
          <div className="text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-foreground">
              {year}년 {month}월 월정산 확정 완료
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {closing.closedByName && `${closing.closedByName} · `}
              {closing.closedAt && new Date(closing.closedAt).toLocaleDateString("ko-KR")}
            </p>
            {isPrivileged && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={handleClose}
                disabled={closeMutation.isPending}
              >
                {closeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                재확정
              </Button>
            )}
          </div>
        ) : (
          <div className="text-center">
            {completionPct < 100 && (
              <div className="flex items-center justify-center gap-1.5 text-amber-600 dark:text-amber-400 text-xs mb-3">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>미완료 항목이 있습니다 (수집 {completionPct}%)</span>
              </div>
            )}
            <p className="text-sm text-muted-foreground mb-3">
              {year}년 {month}월 데이터를 확인하고 월정산을 확정하세요
            </p>
            {isPrivileged ? (
              <Button onClick={handleClose} disabled={closeMutation.isPending}>
                {closeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                월정산 확정
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <Lock className="h-3 w-3" /> 점장 이상만 확정 가능
              </p>
            )}
          </div>
        )}
      </Card>

      {/* 이미지 전체보기 오버레이 */}
      {viewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setViewImage(null)}
        >
          <button
            className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2"
            onClick={() => setViewImage(null)}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={viewImage}
            alt="증빙 사진"
            className="max-w-full max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

// ── 서브 컴포넌트들 ──────────────────────────────────────────────────────────

function CheckItem({ done, label, detail }: { done: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2.5">
      {done ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
      )}
      <div>
        <div className={`text-xs font-medium ${done ? "text-foreground" : "text-amber-700 dark:text-amber-300"}`}>{label}</div>
        <div className="text-[11px] text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function IncomeRow({ label, amount, ratio, positive, expanded, onToggle, locked, children }: {
  label: string; amount: number; ratio?: number; positive?: boolean;
  expanded: boolean; onToggle: () => void; locked?: boolean; children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-3 hover:bg-accent/50 transition-colors"
        onClick={() => { if (!locked) onToggle(); }}
      >
        <div className="text-left">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-base font-bold text-foreground tabular-nums mt-0.5">
            {positive ? "" : "-"}{amount.toLocaleString()}
            <span className="text-xs text-muted-foreground ml-1">원</span>
            {ratio !== undefined && (
              <span className="text-xs text-muted-foreground ml-2">{ratio}%</span>
            )}
          </div>
        </div>
        {locked ? (
          <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {expanded && !locked && (
        <div className="border-t border-border px-3 py-3 bg-muted/30 max-h-64 overflow-y-auto">
          {children}
        </div>
      )}
    </Card>
  );
}

function MethodChip({ icon, label, amount }: { icon: React.ReactNode; label: string; amount: number }) {
  if (amount === 0) return null;
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 text-xs">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-medium text-foreground tabular-nums">{amount.toLocaleString()}</span>
    </div>
  );
}

function MetricRow({ label, value, target, warning, good }: {
  label: string; value: string; target?: string; warning?: boolean; good?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className={`text-sm font-semibold tabular-nums ${
          warning ? "text-red-500" : good ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"
        }`}>
          {value}
        </span>
        {target && <span className="text-[11px] text-muted-foreground ml-2">{target}</span>}
      </div>
    </div>
  );
}

function CompRow({ label, current, prev, reverse, bold }: {
  label: string; current: number; prev: number; reverse?: boolean; bold?: boolean;
}) {
  const diff = current - prev;
  // reverse: 비용 항목은 감소가 긍정적
  const isGood = reverse ? diff <= 0 : diff >= 0;
  const pct = prev !== 0 ? Math.round(diff / prev * 100) : diff !== 0 ? 100 : 0;

  return (
    <div className="flex items-center justify-between text-xs">
      <span className={`text-muted-foreground ${bold ? "font-semibold text-foreground" : ""}`}>{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground tabular-nums">{prev.toLocaleString()}</span>
        <span className="text-muted-foreground">→</span>
        <span className={`font-medium tabular-nums ${bold ? "text-sm" : ""} ${
          bold ? (isGood ? "text-emerald-600 dark:text-emerald-400" : "text-red-500") : "text-foreground"
        }`}>
          {current.toLocaleString()}
        </span>
        {diff !== 0 && (
          <span className={`flex items-center gap-0.5 ${isGood ? "text-emerald-500" : "text-red-500"}`}>
            {isGood
              ? <ArrowUpRight className="h-3 w-3" />
              : <ArrowDownRight className="h-3 w-3" />
            }
            <span className="tabular-nums">{pct > 0 ? "+" : ""}{pct}%</span>
          </span>
        )}
      </div>
    </div>
  );
}
