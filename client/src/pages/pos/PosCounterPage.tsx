import { useEffect, useReducer, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
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
  ConciergeBell, CreditCard, Banknote, Smartphone, Wallet, ReceiptText,
  Minus, Plus, Trash2, ChevronLeft, CheckCircle2, Loader2, MonitorUp,
} from "lucide-react";

// ─── 결제 수단 (F3: providerType은 매장 설정에서 자동 주입, 버튼은 5종) ─────
const PAY_METHODS = [
  { method: "card", label: "카드", icon: CreditCard },
  { method: "cash", label: "현금", icon: Banknote },
  { method: "samsungpay", label: "삼성페이", icon: Smartphone },
  { method: "kakaopay", label: "카카오페이", icon: Wallet },
  { method: "etc", label: "기타", icon: ReceiptText },
] as const;

type PayMethod = (typeof PAY_METHODS)[number]["method"];

function formatWon(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

// ─── 장바구니 상태 (useReducer, URL 서브라우트 없음 — Q-P2-2 (a)) ────────────

type CartOption = { id: number; name: string; priceDelta: number };

type CartLine = {
  /** menuItemId + 옵션 조합 시그니처 — 같은 조합은 수량 합산 */
  key: string;
  menuItemId: number;
  name: string;
  unitPrice: number;
  options: CartOption[];
  qty: number;
  note: string;
};

type Screen = "menu" | "cart" | "pay" | "done";

type DoneInfo = { orderNo: string; pagerNo: string; grandTotal: number };

type State = {
  screen: Screen;
  lines: CartLine[];
  discount: string;
  pagerNo: string;
  /** 주문 생성 멱등키. 순수 재시도에는 유지하고, create 입력이 바뀌는
   *  모든 변경(장바구니·할인·진동벨)에서 회전 — 실패로 서버에 남은 이전
   *  주문이 멱등 반환되어 변경 전 내용으로 결제되는 사고 방지. */
  idempotencyKey: string;
  done: DoneInfo | null;
};

type Action =
  | { type: "ADD_LINE"; line: Omit<CartLine, "qty" | "note"> }
  | { type: "SET_QTY"; key: string; delta: number }
  | { type: "REMOVE_LINE"; key: string }
  | { type: "SET_NOTE"; key: string; note: string }
  | { type: "SET_DISCOUNT"; value: string }
  | { type: "SET_PAGER"; value: string }
  | { type: "GO"; screen: Screen }
  | { type: "ORDER_DONE"; done: DoneInfo }
  | { type: "RESET" };

function initialState(): State {
  return {
    screen: "menu",
    lines: [],
    discount: "",
    pagerNo: "",
    idempotencyKey: crypto.randomUUID(),
    done: null,
  };
}

function reducer(state: State, action: Action): State {
  const rotated = { ...state, idempotencyKey: crypto.randomUUID() };
  switch (action.type) {
    case "ADD_LINE": {
      const existing = state.lines.find((l) => l.key === action.line.key);
      const lines = existing
        ? state.lines.map((l) =>
            l.key === action.line.key ? { ...l, qty: l.qty + 1 } : l
          )
        : [...state.lines, { ...action.line, qty: 1, note: "" }];
      return { ...rotated, lines };
    }
    case "SET_QTY": {
      const lines = state.lines
        .map((l) =>
          l.key === action.key ? { ...l, qty: Math.max(0, l.qty + action.delta) } : l
        )
        .filter((l) => l.qty > 0);
      return { ...rotated, lines };
    }
    case "REMOVE_LINE":
      return { ...rotated, lines: state.lines.filter((l) => l.key !== action.key) };
    case "SET_NOTE":
      return {
        ...rotated,
        lines: state.lines.map((l) =>
          l.key === action.key ? { ...l, note: action.note } : l
        ),
      };
    case "SET_DISCOUNT":
      return { ...rotated, discount: action.value };
    case "SET_PAGER":
      return { ...rotated, pagerNo: action.value };
    case "GO":
      return { ...state, screen: action.screen };
    case "ORDER_DONE":
      return { ...initialState(), screen: "done", done: action.done };
    case "RESET":
      return initialState();
  }
}

function lineAmount(l: CartLine): number {
  const deltas = l.options.reduce((s, o) => s + o.priceDelta, 0);
  return (l.unitPrice + deltas) * l.qty;
}

// ─── 메인 페이지 ────────────────────────────────────────────────────────────

export default function PosCounterPage() {
  const { selectedRestaurantId } = useRestaurant();
  const restaurantId = selectedRestaurantId ?? 0;

  const { data: status, isLoading: statusLoading } =
    trpc.pos.settings.getStatus.useQuery(
      { restaurantId },
      { enabled: restaurantId > 0 },
    );
  const posEnabled = status?.posEnabled === true;

  const { data: categories } = trpc.pos.menu.listCategories.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 && posEnabled },
  );
  const { data: items, isLoading: itemLoading } = trpc.pos.menu.listItems.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 && posEnabled },
  );

  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [optionItem, setOptionItem] = useState<{ id: number; name: string; price: string } | null>(null);
  const [paying, setPaying] = useState(false);

  const utils = trpc.useUtils();
  const createOrder = trpc.pos.order.create.useMutation();
  const recordPayment = trpc.pos.payment.record.useMutation();

  const subtotal = state.lines.reduce((s, l) => s + lineAmount(l), 0);
  const discountNum = Math.max(0, parseInt(state.discount, 10) || 0);
  const grandTotal = subtotal - discountNum;
  const itemCount = state.lines.reduce((s, l) => s + l.qty, 0);

  // 완료 화면 3초 후 [1]로 자동 복귀
  useEffect(() => {
    if (state.screen !== "done") return;
    const t = setTimeout(() => dispatch({ type: "RESET" }), 3000);
    return () => clearTimeout(t);
  }, [state.screen]);

  // 메뉴 탭 → 옵션 그룹 있으면 모달, 없으면 바로 담기
  const handleMenuTap = async (item: { id: number; name: string; price: string }) => {
    try {
      const groups = await utils.pos.menu.listOptionGroups.fetch({
        restaurantId,
        menuItemId: item.id,
      });
      const hasOptions = groups.some((g) => g.options.some((o) => o.isActive));
      if (hasOptions) {
        setOptionItem(item);
      } else {
        dispatch({
          type: "ADD_LINE",
          line: {
            key: `${item.id}:`,
            menuItemId: item.id,
            name: item.name,
            unitPrice: Number(item.price),
            options: [],
          },
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "옵션 조회 실패");
    }
  };

  // 결제수단 탭 = 결제완료 확인 (F1: pagerNo는 create 입력으로 이미 확보됨)
  const confirmPayment = async (method: PayMethod) => {
    if (paying || state.lines.length === 0) return;
    const provider = status?.posPaymentProvider;
    if (!provider) {
      toast.error("매장 POS 결제 방식이 설정되지 않았습니다. 매장 정보에서 POS 설정을 확인하세요.");
      return;
    }
    setPaying(true);
    try {
      const created = await createOrder.mutateAsync({
        restaurantId,
        orderMode: status?.posDefaultOrderMode ?? "prepaid_pickup",
        pagerNo: state.pagerNo || undefined,
        items: state.lines.map((l) => ({
          menuItemId: l.menuItemId,
          qty: l.qty,
          optionIds: l.options.map((o) => o.id),
          note: l.note.trim() || undefined,
        })),
        discountTotal: String(discountNum),
        idempotencyKey: state.idempotencyKey,
      });

      // 서버 권위 금액과 클라 추정 불일치 → 결제 중단 (가격 변경/멱등 반환 케이스)
      if (Number(created.grandTotal) !== grandTotal) {
        utils.pos.menu.listItems.invalidate();
        toast.error(
          `주문 금액이 서버와 다릅니다 (서버: ${formatWon(Number(created.grandTotal))}). 장바구니를 확인하세요.`
        );
        dispatch({ type: "GO", screen: "cart" });
        return;
      }

      try {
        const pay = await recordPayment.mutateAsync({
          restaurantId,
          orderId: created.id,
          method,
          amount: created.grandTotal,
          providerType: provider,
        });
        if (pay.orderStatus === "paid") {
          dispatch({
            type: "ORDER_DONE",
            done: { orderNo: created.orderNo, pagerNo: state.pagerNo, grandTotal },
          });
          return;
        }
        toast.error(`결제는 기록됐지만 주문 상태가 ${pay.orderStatus}입니다. 주문 이력을 확인하세요.`);
        dispatch({ type: "GO", screen: "cart" });
      } catch (payErr) {
        // 응답 유실 재시도로 이미 paid였을 수 있음 — 서버 상태로 최종 판정
        const order = await utils.pos.order.get
          .fetch({ restaurantId, id: created.id })
          .catch(() => null);
        if (order?.status === "paid") {
          dispatch({
            type: "ORDER_DONE",
            done: { orderNo: created.orderNo, pagerNo: state.pagerNo, grandTotal },
          });
          return;
        }
        toast.error(payErr instanceof Error ? payErr.message : "결제 기록 실패");
        dispatch({ type: "GO", screen: "cart" });
      }
    } catch (e) {
      // 주문 생성 실패 — 장바구니 보존, 같은 멱등키로 재시도 가능
      toast.error(e instanceof Error ? e.message : "주문 생성 실패");
      dispatch({ type: "GO", screen: "cart" });
    } finally {
      setPaying(false);
    }
  };

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
          <ConciergeBell className="w-8 h-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">POS가 활성화되지 않은 매장입니다</p>
          <p className="text-xs text-muted-foreground">
            마스터 관리자에게 활성화를 요청하세요.
          </p>
        </div>
      </div>
    );
  }

  const cats = categories ?? [];
  const allItems = items ?? [];
  const visibleItems =
    selectedCategoryId === null
      ? allItems
      : allItems.filter((i) => i.categoryId === selectedCategoryId);

  return (
    <div className="max-w-5xl mx-auto py-4 px-4 pb-24 space-y-4">
      {/* 헤더 */}
      <div className="flex items-center gap-2">
        <ConciergeBell className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">카운터</h1>
        {state.screen !== "menu" && state.screen !== "done" && (
          <span className="text-sm text-muted-foreground">
            {state.screen === "cart" ? "장바구니 확인" : "진동벨 · 결제수단"}
          </span>
        )}
      </div>

      {/* [1] 메뉴 선택 */}
      {state.screen === "menu" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">
          <div className="space-y-3">
            {/* 카테고리 탭 */}
            <div className="flex gap-1.5 flex-wrap">
              <button
                className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${selectedCategoryId === null ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-accent"}`}
                onClick={() => setSelectedCategoryId(null)}
              >전체</button>
              {cats.map((c) => (
                <button
                  key={c.id}
                  className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${selectedCategoryId === c.id ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-accent"}`}
                  onClick={() => setSelectedCategoryId(selectedCategoryId === c.id ? null : c.id)}
                >{c.name}</button>
              ))}
            </div>

            {/* 메뉴 그리드 (큰 터치 버튼, 품절 dim) */}
            {itemLoading ? (
              <div className="text-center py-12 text-muted-foreground text-sm">로딩 중...</div>
            ) : visibleItems.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                판매 중인 메뉴가 없습니다. [메뉴 관리]에서 메뉴를 등록하세요.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {visibleItems.map((item) => (
                  <button
                    key={item.id}
                    disabled={item.isSoldOut}
                    onClick={() => handleMenuTap(item)}
                    className={`min-h-[72px] border border-border rounded-xl bg-card p-3 text-left transition-colors ${item.isSoldOut ? "opacity-40 cursor-not-allowed" : "hover:bg-accent active:scale-[0.98]"}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-foreground truncate">{item.name}</span>
                      {item.isSoldOut && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">품절</Badge>
                      )}
                    </div>
                    <p className="text-sm font-bold text-foreground mt-1 tabular-nums">
                      {formatWon(Number(item.price))}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 장바구니 미리보기 */}
          <div className="border border-border rounded-xl bg-card p-4 space-y-2 lg:sticky lg:top-4">
            <p className="text-xs font-medium text-muted-foreground">장바구니</p>
            {state.lines.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3">메뉴를 탭해서 담으세요</p>
            ) : (
              <div className="space-y-1.5">
                {state.lines.map((l) => (
                  <div key={l.key} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{l.name}</p>
                      {l.options.length > 0 && (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {l.options.map((o) => o.name).join(", ")}
                        </p>
                      )}
                    </div>
                    <button
                      className="w-7 h-7 rounded-md border border-border flex items-center justify-center hover:bg-accent"
                      onClick={() => dispatch({ type: "SET_QTY", key: l.key, delta: -1 })}
                    ><Minus className="w-3.5 h-3.5" /></button>
                    <span className="text-sm font-bold tabular-nums min-w-[20px] text-center">{l.qty}</span>
                    <button
                      className="w-7 h-7 rounded-md border border-border flex items-center justify-center hover:bg-accent"
                      onClick={() => dispatch({ type: "SET_QTY", key: l.key, delta: 1 })}
                    ><Plus className="w-3.5 h-3.5" /></button>
                    <span className="text-sm font-semibold tabular-nums min-w-[64px] text-right">
                      {formatWon(lineAmount(l))}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-sm text-muted-foreground">합계</span>
              <span className="text-base font-bold tabular-nums">{formatWon(subtotal)}</span>
            </div>
            <Button
              className="w-full h-11 text-base"
              disabled={state.lines.length === 0}
              onClick={() => dispatch({ type: "GO", screen: "cart" })}
            >
              결제로 진행{itemCount > 0 ? ` (${itemCount}개)` : ""}
            </Button>
          </div>
        </div>
      )}

      {/* [2] 장바구니 확인 (수량·메모·정액할인 + F2 가드) */}
      {state.screen === "cart" && (
        <div className="max-w-xl mx-auto space-y-3">
          <Button variant="ghost" size="sm" className="px-2 -ml-2" onClick={() => dispatch({ type: "GO", screen: "menu" })}>
            <ChevronLeft className="w-4 h-4 mr-1" /> 메뉴로
          </Button>

          <div className="border border-border rounded-xl bg-card divide-y divide-border">
            {state.lines.map((l) => (
              <div key={l.key} className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{l.name}</p>
                    {l.options.length > 0 && (
                      <p className="text-[11px] text-muted-foreground truncate">
                        {l.options.map((o) => `${o.name}${o.priceDelta !== 0 ? ` (${o.priceDelta > 0 ? "+" : ""}${o.priceDelta.toLocaleString("ko-KR")}원)` : ""}`).join(", ")}
                      </p>
                    )}
                  </div>
                  <button
                    className="w-8 h-8 rounded-md border border-border flex items-center justify-center hover:bg-accent"
                    onClick={() => dispatch({ type: "SET_QTY", key: l.key, delta: -1 })}
                  ><Minus className="w-4 h-4" /></button>
                  <span className="text-base font-bold tabular-nums min-w-[24px] text-center">{l.qty}</span>
                  <button
                    className="w-8 h-8 rounded-md border border-border flex items-center justify-center hover:bg-accent"
                    onClick={() => dispatch({ type: "SET_QTY", key: l.key, delta: 1 })}
                  ><Plus className="w-4 h-4" /></button>
                  <span className="text-sm font-semibold tabular-nums min-w-[72px] text-right">
                    {formatWon(lineAmount(l))}
                  </span>
                  <Button
                    size="sm" variant="ghost" className="h-8 px-1.5 text-red-500 hover:text-red-600"
                    onClick={() => dispatch({ type: "REMOVE_LINE", key: l.key })}
                  ><Trash2 className="w-4 h-4" /></Button>
                </div>
                <Input
                  className="h-8 text-xs"
                  placeholder="메모 (예: 덜 맵게)"
                  maxLength={200}
                  value={l.note}
                  onChange={(e) => dispatch({ type: "SET_NOTE", key: l.key, note: e.target.value })}
                />
              </div>
            ))}
            {state.lines.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">장바구니가 비었습니다</p>
            )}
          </div>

          <div className="border border-border rounded-xl bg-card p-4 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground shrink-0">주문 할인 (원)</span>
              <Input
                className="h-9 w-32 text-right tabular-nums"
                type="number"
                min={0}
                placeholder="0"
                value={state.discount}
                onChange={(e) => dispatch({ type: "SET_DISCOUNT", value: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">소계</span>
              <span className="tabular-nums">{formatWon(subtotal)}</span>
            </div>
            {discountNum > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">할인</span>
                <span className="tabular-nums text-red-500">-{formatWon(discountNum)}</span>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-sm font-medium">결제 금액</span>
              <span className="text-lg font-bold tabular-nums">{formatWon(Math.max(0, grandTotal))}</span>
            </div>
            {/* F2 가드: 0원 주문은 결제 기록 불가 → open 잔류. 진행 차단 */}
            {state.lines.length > 0 && grandTotal <= 0 && (
              <p className="text-xs text-red-500">
                할인 후 금액이 0원입니다. 0원 주문은 결제를 기록할 수 없어 진행할 수 없습니다. 할인 금액을 줄이세요.
              </p>
            )}
          </div>

          <Button
            className="w-full h-12 text-base"
            disabled={state.lines.length === 0 || grandTotal <= 0}
            onClick={() => dispatch({ type: "GO", screen: "pay" })}
          >
            진동벨 · 결제수단 선택
          </Button>
        </div>
      )}

      {/* [3] 진동벨 + 결제수단 (F1: 진동벨을 결제 전 입력 → create에 포함) */}
      {state.screen === "pay" && (
        <div className="max-w-xl mx-auto space-y-3">
          <Button
            variant="ghost" size="sm" className="px-2 -ml-2" disabled={paying}
            onClick={() => dispatch({ type: "GO", screen: "cart" })}
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> 장바구니로
          </Button>

          <div className="border border-border rounded-xl bg-card p-4 text-center">
            <p className="text-xs text-muted-foreground">결제 금액</p>
            <p className="text-3xl font-extrabold tabular-nums mt-1">{formatWon(grandTotal)}</p>
          </div>

          {/* 진동벨 숫자패드 (선택) */}
          <div className="border border-border rounded-xl bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">진동벨 번호 <span className="text-xs text-muted-foreground">(선택)</span></p>
              <span className="text-2xl font-bold tabular-nums min-h-[32px]">
                {state.pagerNo || <span className="text-muted-foreground/40 text-base font-normal">없음</span>}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map((k) => (
                <button
                  key={k}
                  disabled={paying}
                  className="h-11 rounded-lg border border-border bg-background text-lg font-semibold hover:bg-accent active:scale-[0.97] transition-transform"
                  onClick={() => {
                    if (k === "C") dispatch({ type: "SET_PAGER", value: "" });
                    else if (k === "⌫") dispatch({ type: "SET_PAGER", value: state.pagerNo.slice(0, -1) });
                    else if (state.pagerNo.length < 4) dispatch({ type: "SET_PAGER", value: state.pagerNo + k });
                  }}
                >{k}</button>
              ))}
            </div>
          </div>

          {/* 결제수단 버튼 — 탭 = 결제완료 확인 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PAY_METHODS.map(({ method, label, icon: Icon }) => (
              <button
                key={method}
                disabled={paying}
                onClick={() => confirmPayment(method)}
                className="min-h-[76px] border border-border rounded-xl bg-card flex flex-col items-center justify-center gap-1.5 hover:bg-accent active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                {paying ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icon className="w-5 h-5 text-primary" />}
                <span className="text-sm font-semibold">{label}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground text-center">
            결제는 외부 단말에서 진행하고, 수단을 탭하면 <b>결제완료 확인</b>으로 기록됩니다.
          </p>
        </div>
      )}

      {/* [4] 완료 — 3초 후 [1]로 복귀 */}
      {state.screen === "done" && state.done && (
        <div className="max-w-xl mx-auto space-y-3 pt-6">
          <div className="border border-border rounded-xl bg-card p-8 text-center space-y-3">
            <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500" />
            <div>
              <p className="text-lg font-bold">주문 #{state.done.orderNo} 결제완료 확인</p>
              <p className="text-sm text-muted-foreground mt-1 tabular-nums">
                {formatWon(state.done.grandTotal)}
                {state.done.pagerNo && ` · 진동벨 ${state.done.pagerNo}번`}
              </p>
            </div>
            {/* ④ KDS 구현 완료(/pos/kds 폴링 수신) — §7.2 롤백 */}
            {status?.posKitchenRouter === "kds" && (
              <p className="text-sm font-medium text-primary flex items-center justify-center gap-1.5">
                <MonitorUp className="w-4 h-4" /> 주방 KDS로 전송됨
              </p>
            )}
            <p className="text-xs text-muted-foreground">3초 후 메뉴 화면으로 돌아갑니다</p>
          </div>
          <Button className="w-full h-11" onClick={() => dispatch({ type: "RESET" })}>
            새 주문 받기
          </Button>
        </div>
      )}

      {/* 옵션 선택 모달 */}
      {optionItem && (
        <OptionSelectDialog
          restaurantId={restaurantId}
          item={optionItem}
          onClose={() => setOptionItem(null)}
          onConfirm={(options) => {
            const sig = options.map((o) => o.id).sort((a, b) => a - b).join(",");
            dispatch({
              type: "ADD_LINE",
              line: {
                key: `${optionItem.id}:${sig}`,
                menuItemId: optionItem.id,
                name: optionItem.name,
                unitPrice: Number(optionItem.price),
                options,
              },
            });
            setOptionItem(null);
          }}
        />
      )}
    </div>
  );
}

// ─── 옵션 선택 다이얼로그 (minSelect/maxSelect/isRequired 준수) ──────────────

function OptionSelectDialog({ restaurantId, item, onClose, onConfirm }: {
  restaurantId: number;
  item: { id: number; name: string; price: string };
  onClose: () => void;
  onConfirm: (options: CartOption[]) => void;
}) {
  const { data: groups, isLoading } = trpc.pos.menu.listOptionGroups.useQuery({
    restaurantId,
    menuItemId: item.id,
  });

  // groupId → 선택된 optionId 배열
  const [selected, setSelected] = useState<Record<number, number[]>>({});

  const toggle = (groupId: number, optionId: number, maxSelect: number) => {
    setSelected((prev) => {
      const cur = prev[groupId] ?? [];
      if (cur.includes(optionId)) {
        return { ...prev, [groupId]: cur.filter((id) => id !== optionId) };
      }
      // 단일 선택 그룹은 교체, 복수 선택은 maxSelect까지
      if (maxSelect === 1) return { ...prev, [groupId]: [optionId] };
      if (cur.length >= maxSelect) {
        toast.error(`최대 ${maxSelect}개까지 선택할 수 있습니다`);
        return prev;
      }
      return { ...prev, [groupId]: [...cur, optionId] };
    });
  };

  const activeGroups = (groups ?? [])
    .map((g) => ({ ...g, options: g.options.filter((o) => o.isActive) }))
    .filter((g) => g.options.length > 0);

  const violation = activeGroups.find((g) => {
    const count = (selected[g.id] ?? []).length;
    const effectiveMin = g.isRequired ? Math.max(1, g.minSelect) : g.minSelect;
    return count < effectiveMin;
  });

  const confirm = () => {
    if (violation) {
      toast.error(`'${violation.name}' 옵션을 선택하세요`);
      return;
    }
    const options: CartOption[] = activeGroups.flatMap((g) =>
      (selected[g.id] ?? []).map((oid) => {
        const o = g.options.find((x) => x.id === oid)!;
        return { id: o.id, name: o.name, priceDelta: Number(o.priceDelta) };
      })
    );
    onConfirm(options);
  };

  const deltaSum = activeGroups.flatMap((g) =>
    (selected[g.id] ?? []).map((oid) => Number(g.options.find((x) => x.id === oid)?.priceDelta ?? 0))
  ).reduce((s, d) => s + d, 0);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {isLoading ? (
            <p className="text-xs text-muted-foreground text-center py-4">로딩 중...</p>
          ) : (
            activeGroups.map((g) => (
              <div key={g.id} className="space-y-1.5">
                <p className="text-sm font-medium">
                  {g.name}
                  <span className="text-xs text-muted-foreground ml-1.5">
                    {g.isRequired ? "필수" : "선택"} · 최대 {g.maxSelect}개
                  </span>
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {g.options.map((o) => {
                    const on = (selected[g.id] ?? []).includes(o.id);
                    return (
                      <button
                        key={o.id}
                        onClick={() => toggle(g.id, o.id, g.maxSelect)}
                        className={`min-h-[44px] px-3 py-2 rounded-lg border text-left transition-colors ${on ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-accent"}`}
                      >
                        <span className="text-sm font-medium">{o.name}</span>
                        <span className="text-xs text-muted-foreground ml-1.5 tabular-nums">
                          {Number(o.priceDelta) === 0 ? "" : `${Number(o.priceDelta) > 0 ? "+" : ""}${Number(o.priceDelta).toLocaleString("ko-KR")}원`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button onClick={confirm} disabled={isLoading}>
            담기 · {formatWon(Number(item.price) + deltaSum)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
