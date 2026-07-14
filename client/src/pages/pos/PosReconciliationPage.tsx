import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { getEffectiveRole, isManagerLevel } from "@shared/permissions";
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
import { Scale, TriangleAlert, LockKeyhole, CheckCircle2 } from "lucide-react";

function formatWon(v: string | number): string {
  const n = typeof v === "string" ? Number(v) : v;
  if (Number.isNaN(n)) return String(v);
  return `${n.toLocaleString("ko-KR")}원`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthStartStr(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function dayRange(date: string): { from: string; to: string } {
  return {
    from: new Date(`${date}T00:00:00`).toISOString(),
    to: new Date(`${date}T23:59:59.999`).toISOString(),
  };
}

function dateOnly(v: string | Date): string {
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── 메인 페이지 ────────────────────────────────────────────────────────────

export default function PosReconciliationPage() {
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
  const tolerance = Number(status?.posReconcileTolerance ?? 0);

  const [date, setDate] = useState(todayStr());
  const [externalInput, setExternalInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  const utils = trpc.useUtils();

  // G5: setExternal 전에 getOrCreate 선행 필수 — 페이지 진입/날짜 변경 시 먼저 조회
  const { data: recon, isLoading: reconLoading } =
    trpc.pos.reconciliation.getOrCreate.useQuery(
      { restaurantId, date },
      { enabled: restaurantId > 0 && posEnabled },
    );

  // G1 완화: 해당일 주문 합계와 posGross의 차 = 환불(타일 주문)·이월 반영액 추정
  const range = dayRange(date);
  const { data: dayOrders } = trpc.pos.order.list.useQuery(
    { restaurantId, from: range.from, to: range.to, limit: 200 },
    { enabled: restaurantId > 0 && posEnabled },
  );

  // 서버 값이 오면 입력 필드 동기화
  useEffect(() => {
    if (!recon) return;
    setExternalInput(Number(recon.externalGross) > 0 ? String(Number(recon.externalGross)) : "");
    setNoteInput(recon.note ?? "");
  }, [recon]);

  const setExternal = trpc.pos.reconciliation.setExternal.useMutation({
    onSuccess() {
      toast.success("외부 금액이 저장되었습니다");
      utils.pos.reconciliation.getOrCreate.invalidate();
      utils.pos.reconciliation.list.invalidate();
    },
    onError(e) { toast.error(e.message); },
  });
  const confirmMutation = trpc.pos.reconciliation.confirm.useMutation({
    onSuccess(d) {
      setConfirmDialogOpen(false);
      // confirm 응답은 이미 확정된 경우 warning 필드가 없는 형태 — 유니언 분기
      if ("warning" in d && d.warning) toast.warning(d.warning);
      else toast.success("일일 대조가 확정되었습니다");
      utils.pos.reconciliation.getOrCreate.invalidate();
      utils.pos.reconciliation.list.invalidate();
    },
    onError(e) { toast.error(e.message); },
  });

  // 월별 이력
  const { data: history } = trpc.pos.reconciliation.list.useQuery(
    { restaurantId, from: monthStartStr(date), to: date, limit: 31 },
    { enabled: restaurantId > 0 && posEnabled },
  );

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
          <Scale className="w-8 h-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">POS가 활성화되지 않은 매장입니다</p>
          <p className="text-xs text-muted-foreground">마스터 관리자에게 활성화를 요청하세요.</p>
        </div>
      </div>
    );
  }

  const confirmed = !!recon?.confirmedAt;
  const posGross = Number(recon?.posGross ?? 0);
  const externalGross = Number(recon?.externalGross ?? 0);
  const diff = Number(recon?.diff ?? 0);
  const overTolerance = Math.abs(diff) > tolerance;

  // 해당일 유효 주문(결제완료 이상, 미환불) 합계 — posGross와의 차가 조정액
  const validOrderSum = (dayOrders ?? [])
    .filter((o) => ["paid", "ready", "served"].includes(o.status))
    .reduce((s, o) => s + Number(o.grandTotal), 0);
  const adjustment = dayOrders ? posGross - validOrderSum : 0;

  const canEdit = isManager && !confirmed && !!recon && !reconLoading;

  const saveExternal = () => {
    const v = externalInput.trim() || "0";
    if (!/^\d+(\.\d{1,2})?$/.test(v)) {
      toast.error("외부 금액은 숫자로 입력하세요");
      return;
    }
    setExternal.mutate({
      restaurantId,
      date,
      externalGross: v,
      note: noteInput.trim() || undefined,
    });
  };

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-4">
      {/* 헤더 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Scale className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">일일 대조</h1>
        <Input
          type="date"
          className="h-9 w-40 ml-auto"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </div>

      {reconLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">로딩 중...</div>
      ) : (
        <>
          {/* 확정 상태 */}
          {confirmed && (
            <div className="flex items-start gap-2 border border-emerald-500/40 bg-emerald-500/10 rounded-xl px-4 py-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                확정된 대조입니다 ({new Date(recon!.confirmedAt!).toLocaleString("ko-KR")}).
                수정하려면 마스터에게 확정 해제(unconfirm)를 요청하세요.
              </p>
            </div>
          )}

          {/* 집계 표 */}
          <div className="border border-border rounded-xl bg-card divide-y divide-border">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-muted-foreground">POS 매출 (자동 집계)</span>
              <span className="text-sm font-bold tabular-nums">{formatWon(posGross)}</span>
            </div>
            {/* G1 완화: 환불·이월 반영액 별도 행 */}
            <div className="px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  환불·이월 조정액 (추정)
                  {adjustment !== 0 && (
                    <Badge className="text-[10px] px-1.5 py-0 border-0 bg-amber-500/15 text-amber-600 dark:text-amber-300">
                      <TriangleAlert className="w-3 h-3 mr-0.5" /> 주의
                    </Badge>
                  )}
                </span>
                <span className={`text-sm font-bold tabular-nums ${adjustment !== 0 ? "text-amber-600" : ""}`}>
                  {formatWon(adjustment)}
                </span>
              </div>
              {adjustment !== 0 && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  이 날짜의 POS 매출에 다른 날 주문의 환불(또는 이월 결제)이 반영되어 있습니다.
                  외부 정산서는 원래 판매일 기준이라 차이가 발생할 수 있습니다.
                </p>
              )}
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-muted-foreground">외부 매출 (백화점/단말)</span>
              <span className="text-sm font-bold tabular-nums">{formatWon(externalGross)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-medium flex items-center gap-1.5">
                차이 (외부 − POS)
                {overTolerance && (
                  <Badge className="text-[10px] px-1.5 py-0 border-0 bg-red-500/15 text-red-600 dark:text-red-300">
                    허용오차 {formatWon(tolerance)} 초과
                  </Badge>
                )}
              </span>
              <span className={`text-base font-extrabold tabular-nums ${overTolerance ? "text-red-500" : diff !== 0 ? "text-amber-600" : "text-emerald-600"}`}>
                {diff > 0 ? "+" : ""}{formatWon(diff)}
              </span>
            </div>
          </div>

          {/* 외부 금액 입력 (manager+, 미확정, getOrCreate 성공 후 — G5) */}
          <div className="border border-border rounded-xl bg-card p-4 space-y-3">
            <p className="text-sm font-medium flex items-center gap-1.5">
              외부 금액 입력
              {!isManager && <span className="text-xs text-muted-foreground">(매니저 이상만 입력 가능)</span>}
              {confirmed && <LockKeyhole className="w-3.5 h-3.5 text-muted-foreground" />}
            </p>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                placeholder="백화점 정산서 금액"
                className="tabular-nums"
                disabled={!canEdit}
                value={externalInput}
                onChange={(e) => setExternalInput(e.target.value)}
              />
              <Button disabled={!canEdit || setExternal.isPending} onClick={saveExternal}>
                저장
              </Button>
            </div>
            <Input
              placeholder="메모 (선택)"
              maxLength={500}
              disabled={!canEdit}
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
            />
            <Button
              variant={overTolerance ? "destructive" : "default"}
              className="w-full"
              disabled={!canEdit || confirmMutation.isPending}
              onClick={() => setConfirmDialogOpen(true)}
            >
              이 날짜 대조 확정
            </Button>
          </div>

          {/* 월별 이력 */}
          <div className="space-y-2">
            <p className="text-sm font-medium">{date.slice(0, 7).replace("-", "년 ")}월 이력</p>
            <div className="border border-border rounded-xl bg-card divide-y divide-border">
              {(history ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">이력이 없습니다</p>
              ) : (
                (history ?? []).map((h) => (
                  <button
                    key={h.id}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/50 transition-colors"
                    onClick={() => setDate(dateOnly(h.date))}
                  >
                    <span className="text-xs tabular-nums">{dateOnly(h.date)}</span>
                    {h.confirmedAt ? (
                      <Badge className="text-[10px] px-1.5 py-0 border-0 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">확정</Badge>
                    ) : (
                      <Badge className="text-[10px] px-1.5 py-0 border-0 bg-slate-500/15 text-slate-600 dark:text-slate-300">미확정</Badge>
                    )}
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      POS {formatWon(h.posGross)} / 외부 {formatWon(h.externalGross)}
                    </span>
                    <span className={`text-xs font-semibold tabular-nums min-w-[80px] text-right ${Math.abs(Number(h.diff)) > tolerance ? "text-red-500" : "text-muted-foreground"}`}>
                      {Number(h.diff) > 0 ? "+" : ""}{formatWon(h.diff)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* 확정 2단계 확인 (G4: 비가역 — unconfirm은 master 전용) */}
      {confirmDialogOpen && recon && (
        <Dialog open onOpenChange={(o) => { if (!o) setConfirmDialogOpen(false); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{date} 대조 확정</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">POS 매출</span>
                <span className="tabular-nums">{formatWon(posGross)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">외부 매출</span>
                <span className="tabular-nums">{formatWon(externalGross)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>차이</span>
                <span className={`tabular-nums ${overTolerance ? "text-red-500" : ""}`}>
                  {diff > 0 ? "+" : ""}{formatWon(diff)}
                </span>
              </div>
              {overTolerance && (
                <div className="flex items-start gap-2 border border-red-500/40 bg-red-500/10 rounded-lg px-3 py-2">
                  <TriangleAlert className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-600 dark:text-red-300">
                    차이가 허용오차({formatWon(tolerance)})를 <b>{formatWon(Math.abs(diff) - tolerance)}</b> 초과합니다.
                    원인을 확인한 뒤 확정하세요.
                  </p>
                </div>
              )}
              <p className="text-xs text-muted-foreground pt-1">
                확정 후에는 <b>마스터만 되돌릴 수 있습니다.</b> 외부 금액도 더 이상 수정할 수 없습니다.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>취소</Button>
              <Button
                variant={overTolerance ? "destructive" : "default"}
                disabled={confirmMutation.isPending}
                onClick={() => confirmMutation.mutate({ restaurantId, date })}
              >
                {confirmMutation.isPending ? "확정 중..." : "확정"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
