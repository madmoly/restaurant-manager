import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { getEffectiveRole, isManagerLevel } from "@shared/permissions";
import { ORDER_STATUS_LABEL, PAY_METHOD_LABEL, labelOf } from "@/lib/posLabels";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { History, TriangleAlert, ChefHat, PackageCheck, Ban, Undo2 } from "lucide-react";

const STATUS_BADGE: Record<string, string> = {
  open: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  paid: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  ready: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  served: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  voided: "bg-red-500/15 text-red-600 dark:text-red-300",
  refunded: "bg-red-500/15 text-red-600 dark:text-red-300",
};

const ALL_STATUSES = ["open", "paid", "ready", "served", "voided", "refunded"] as const;

function formatWon(v: string | number): string {
  const n = typeof v === "string" ? Number(v) : v;
  if (Number.isNaN(n)) return String(v);
  return `${n.toLocaleString("ko-KR")}원`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 로컬(KST) 날짜의 하루 범위를 ISO 문자열로 (order.list from/to 입력) */
function dayRange(date: string): { from: string; to: string } {
  return {
    from: new Date(`${date}T00:00:00`).toISOString(),
    to: new Date(`${date}T23:59:59.999`).toISOString(),
  };
}

function timeOf(dt: string | Date): string {
  const d = new Date(dt);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ─── 메인 페이지 ────────────────────────────────────────────────────────────

export default function PosOrdersPage() {
  const { user } = useAuth();
  const { selectedRestaurant, selectedRestaurantId } = useRestaurant();
  const restaurantId = selectedRestaurantId ?? 0;
  const effectiveRole = getEffectiveRole(user?.role ?? "user", selectedRestaurant?.storeRole ?? null);
  const isManager = isManagerLevel(effectiveRole);

  const { data: status, isLoading: statusLoading } =
    trpc.pos.settings.getStatus.useQuery(
      { restaurantId },
      { enabled: restaurantId > 0 },
    );
  const posEnabled = status?.posEnabled === true;

  const [date, setDate] = useState(todayStr());
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);

  // G2: 페이지네이션 부재 — 날짜 범위는 항상 하루(기본 오늘), limit 200 고정
  const range = dayRange(date);
  const { data: orders, isLoading: listLoading } = trpc.pos.order.list.useQuery(
    { restaurantId, from: range.from, to: range.to, limit: 200 },
    { enabled: restaurantId > 0 && posEnabled },
  );

  // D2 가시화: 미완료(open/paid/ready)는 날짜 무관하게 POS 비활성화를 차단 → 전역 집계
  const qOpts = { enabled: restaurantId > 0 && posEnabled };
  const openQ = trpc.pos.order.list.useQuery({ restaurantId, status: "open", limit: 200 }, qOpts);
  const paidQ = trpc.pos.order.list.useQuery({ restaurantId, status: "paid", limit: 200 }, qOpts);
  const readyQ = trpc.pos.order.list.useQuery({ restaurantId, status: "ready", limit: 200 }, qOpts);
  const incompleteCount =
    (openQ.data?.length ?? 0) + (paidQ.data?.length ?? 0) + (readyQ.data?.length ?? 0);
  const incompleteCapped = [openQ, paidQ, readyQ].some((q) => (q.data?.length ?? 0) >= 200);

  if (restaurantId <= 0) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-4 text-center text-muted-foreground text-sm">
        매장을 먼저 선택하세요.
      </div>
    );
  }

  if (!statusLoading && !posEnabled) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-4">
        <div className="border border-border rounded-xl bg-card p-8 text-center space-y-2">
          <History className="w-8 h-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">POS가 활성화되지 않은 매장입니다</p>
          <p className="text-xs text-muted-foreground">마스터 관리자에게 활성화를 요청하세요.</p>
        </div>
      </div>
    );
  }

  const allOrders = orders ?? [];
  const visible =
    statusFilter === "all"
      ? allOrders
      : allOrders.filter((o) => o.status === statusFilter);
  // 유효 매출은 상태 필터와 무관하게 그 날짜 전체 기준
  const dayTotal = allOrders
    .filter((o) => ["paid", "ready", "served"].includes(o.status))
    .reduce((s, o) => s + Number(o.grandTotal), 0);

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 space-y-4">
      {/* 헤더 */}
      <div className="flex items-center gap-2">
        <History className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">주문 이력</h1>
        <span className="text-sm text-muted-foreground">{visible.length}건</span>
      </div>

      {/* 미완료 배너 (D2) */}
      {incompleteCount > 0 && (
        <div className="flex items-start gap-2 border border-amber-500/40 bg-amber-500/10 rounded-xl px-4 py-3">
          <TriangleAlert className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            미완료 주문 <b>{incompleteCapped ? "200+" : incompleteCount}건</b> (결제 대기·결제완료·준비완료, 전체 기간) —
            미완료가 남아 있으면 POS 비활성화가 차단됩니다. 전달이 끝난 주문은 [전달완료] 처리하세요.
          </p>
        </div>
      )}

      {/* 필터 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          type="date"
          className="h-9 w-40"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            {ALL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{ORDER_STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          유효 매출 {formatWon(dayTotal)}
        </span>
      </div>

      {/* 목록 (G3: 요약만 — 상세는 행 클릭 시 order.get) */}
      {listLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">로딩 중...</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <History className="w-10 h-10 mx-auto mb-2 text-muted-foreground/50" />
          <p className="text-sm">해당 조건의 주문이 없습니다</p>
        </div>
      ) : (
        <div className="border border-border rounded-xl bg-card divide-y divide-border">
          {visible.map((o) => (
            <button
              key={o.id}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
              onClick={() => setDetailOrderId(o.id)}
            >
              <span className="font-bold tabular-nums text-sm">#{o.orderNo}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{timeOf(o.createdAt)}</span>
              <Badge className={`text-[11px] px-1.5 py-0 border-0 ${STATUS_BADGE[o.status] ?? ""}`}>
                {ORDER_STATUS_LABEL[o.status] ?? o.status}
              </Badge>
              <span className="ml-auto text-sm font-semibold tabular-nums">
                {formatWon(o.grandTotal)}
              </span>
              <span className="text-xs text-muted-foreground min-w-[64px] text-right">
                {o.pagerNo ? `진동벨 ${o.pagerNo}` : ""}
              </span>
            </button>
          ))}
          {allOrders.length >= 200 && (
            <p className="text-[11px] text-muted-foreground px-4 py-2">
              최근 200건까지만 표시됩니다.
            </p>
          )}
        </div>
      )}

      {/* 상세 모달 */}
      {detailOrderId !== null && (
        <OrderDetailDialog
          restaurantId={restaurantId}
          orderId={detailOrderId}
          isManager={isManager}
          onClose={() => setDetailOrderId(null)}
        />
      )}
    </div>
  );
}

// ─── 주문 상세 모달 (order.get + 상태 액션) ─────────────────────────────────

function OrderDetailDialog({ restaurantId, orderId, isManager, onClose }: {
  restaurantId: number;
  orderId: number;
  isManager: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: order, isLoading } = trpc.pos.order.get.useQuery({
    restaurantId,
    id: orderId,
  });

  const invalidate = () => {
    utils.pos.order.list.invalidate();
    utils.pos.order.get.invalidate({ restaurantId, id: orderId });
  };
  const onError = (e: { message: string }) => toast.error(e.message);

  const markReady = trpc.pos.order.markReady.useMutation({
    onSuccess() { toast.success("준비완료 처리됨"); invalidate(); },
    onError,
  });
  const markServed = trpc.pos.order.markServed.useMutation({
    onSuccess() { toast.success("전달완료 처리됨"); invalidate(); },
    onError,
  });
  const voidOrder = trpc.pos.order.void.useMutation({
    onSuccess() { toast.success("주문이 취소되었습니다"); invalidate(); setReasonMode(null); },
    onError,
  });
  const refundOrder = trpc.pos.order.refund.useMutation({
    onSuccess(d) { toast.success(`환불 처리됨 (${formatWon(d.refundedAmount)})`); invalidate(); setReasonMode(null); },
    onError,
  });

  // 취소/환불은 사유 필수(min 1) — 인라인 사유 입력 단계
  const [reasonMode, setReasonMode] = useState<"void" | "refund" | null>(null);
  const [reason, setReason] = useState("");

  const busy =
    markReady.isPending || markServed.isPending ||
    voidOrder.isPending || refundOrder.isPending;

  const submitReason = () => {
    const r = reason.trim();
    if (!r) { toast.error("사유를 입력하세요"); return; }
    if (reasonMode === "void") voidOrder.mutate({ restaurantId, id: orderId, reason: r });
    if (reasonMode === "refund") refundOrder.mutate({ restaurantId, id: orderId, reason: r });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            주문 #{order?.orderNo ?? "..."}
            {order && (
              <Badge className={`ml-2 text-[11px] px-1.5 py-0 border-0 ${STATUS_BADGE[order.status] ?? ""}`}>
                {ORDER_STATUS_LABEL[order.status] ?? order.status}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading || !order ? (
          <p className="text-xs text-muted-foreground text-center py-6">로딩 중...</p>
        ) : (
          <div className="space-y-3 py-1">
            {/* 기본 정보 */}
            <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
              <span>{new Date(order.createdAt).toLocaleString("ko-KR")}</span>
              {order.pagerNo && <span>진동벨 {order.pagerNo}번</span>}
            </div>

            {/* 품목 */}
            <div className="border border-border rounded-lg divide-y divide-border">
              {order.items.map((it) => (
                <div key={it.id} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium flex-1 truncate">
                      {it.menuItemNameSnapshot}
                    </span>
                    <span className="text-xs text-muted-foreground">×{it.qty}</span>
                    <span className="text-sm font-semibold tabular-nums">{formatWon(it.lineTotal)}</span>
                  </div>
                  {it.options.length > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {it.options.map((op) => `${op.optionName}${Number(op.priceDelta) !== 0 ? ` (${Number(op.priceDelta) > 0 ? "+" : ""}${Number(op.priceDelta).toLocaleString("ko-KR")}원)` : ""}`).join(", ")}
                    </p>
                  )}
                  {it.note && (
                    <p className="text-[11px] text-amber-600 mt-0.5">메모: {it.note}</p>
                  )}
                </div>
              ))}
            </div>

            {/* 금액 */}
            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>소계</span><span className="tabular-nums">{formatWon(order.subtotal)}</span>
              </div>
              {Number(order.discountTotal) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>할인</span><span className="tabular-nums text-red-500">-{formatWon(order.discountTotal)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold pt-1 border-t border-border">
                <span>합계</span><span className="tabular-nums">{formatWon(order.grandTotal)}</span>
              </div>
            </div>

            {/* 결제 내역 */}
            {order.payments.length > 0 && (
              <div className="border border-border rounded-lg divide-y divide-border">
                {order.payments.map((p) => (
                  <div key={p.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                    <span className={p.voidedAt ? "line-through text-muted-foreground" : ""}>
                      {labelOf(PAY_METHOD_LABEL, p.method)}
                    </span>
                    <span className="text-muted-foreground">{timeOf(p.createdAt)}</span>
                    {Number(p.amount) < 0 && (
                      <Badge className="text-[10px] px-1.5 py-0 border-0 bg-red-500/15 text-red-600 dark:text-red-300">환불</Badge>
                    )}
                    <span className={`ml-auto font-semibold tabular-nums ${Number(p.amount) < 0 ? "text-red-500" : ""} ${p.voidedAt ? "line-through" : ""}`}>
                      {formatWon(p.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 취소/환불 사유 */}
            {order.voidReason && (
              <p className="text-xs text-red-500">사유: {order.voidReason}</p>
            )}

            {/* 사유 입력 (void/refund) */}
            {reasonMode && (
              <div className="border border-red-500/40 rounded-lg p-3 space-y-2 bg-red-500/5">
                <p className="text-xs font-medium">
                  {reasonMode === "void" ? "주문 취소" : "환불"} 사유 (필수)
                </p>
                <Input
                  placeholder={reasonMode === "void" ? "예: 고객 요청" : "예: 메뉴 오전달"}
                  maxLength={200}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitReason(); }}
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setReasonMode(null)}>취소</Button>
                  <Button size="sm" variant="destructive" disabled={busy} onClick={submitReason}>
                    {reasonMode === "void" ? "주문 취소 확정" : "환불 확정"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 상태별 액션 */}
        {order && !reasonMode && (
          <DialogFooter className="flex-wrap gap-2">
            {order.status === "paid" && (
              <Button size="sm" variant="outline" disabled={busy}
                onClick={() => markReady.mutate({ restaurantId, id: orderId })}>
                <ChefHat className="w-4 h-4 mr-1" /> 준비완료
              </Button>
            )}
            {(order.status === "paid" || order.status === "ready") && (
              <Button size="sm" disabled={busy}
                onClick={() => markServed.mutate({ restaurantId, id: orderId })}>
                <PackageCheck className="w-4 h-4 mr-1" /> 전달완료
              </Button>
            )}
            {isManager && order.status === "open" && (
              <Button size="sm" variant="destructive" disabled={busy}
                onClick={() => { setReason(""); setReasonMode("void"); }}>
                <Ban className="w-4 h-4 mr-1" /> 주문취소
              </Button>
            )}
            {isManager && ["paid", "ready", "served"].includes(order.status) && (
              <Button size="sm" variant="destructive" disabled={busy}
                onClick={() => { setReason(""); setReasonMode("refund"); }}>
                <Undo2 className="w-4 h-4 mr-1" /> 환불
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onClose}>닫기</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
