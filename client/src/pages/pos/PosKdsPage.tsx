import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChefHat,
  PackageCheck,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  MonitorUp,
  TriangleAlert,
} from "lucide-react";

/**
 * ④ /pos/kds — 주방 KDS 웹 화면 (TASK_pos_p2_ui.md §2 표 ④)
 *
 * 실시간성: tRPC subscription 전례가 코드베이스에 없어 폴링 폴백 채택
 * (TASK §주의 L44, pos-plan §10 리스크 표). 5초 간격 refetch.
 * 신규 주문 감지 시 WebAudio 비프음 (오디오 파일 자산 불필요).
 *
 * 상태 전이: paid →[조리완료] ready →[전달완료] served.
 * paid에서 바로 [전달완료]도 허용 (서버 markServed가 paid/ready 모두 수용).
 */

const POLL_MS = 5000;
/** paid 상태로 이 시간(분) 초과 시 지연 경고색 */
const DELAY_WARN_MIN = 10;

function timeOf(dt: string | Date | null): string {
  if (!dt) return "-";
  const d = new Date(dt);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function elapsedMin(dt: string | Date | null, now: number): number {
  if (!dt) return 0;
  return Math.max(0, Math.floor((now - new Date(dt).getTime()) / 60000));
}

/** WebAudio 비프 2회 — 사용자 제스처 이후에만 AudioContext 생성 가능 */
function playBeep(ctxRef: { current: AudioContext | null }) {
  try {
    if (!ctxRef.current) return;
    const ac = ctxRef.current;
    if (ac.state === "suspended") void ac.resume();
    [0, 0.25].forEach((delay) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ac.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + delay + 0.18);
      osc.start(ac.currentTime + delay);
      osc.stop(ac.currentTime + delay + 0.2);
    });
  } catch {
    /* 오디오 실패는 무시 — 표시가 본질 */
  }
}

export default function PosKdsPage() {
  const { selectedRestaurantId } = useRestaurant();
  const restaurantId = selectedRestaurantId ?? 0;

  const { data: status, isLoading: statusLoading } =
    trpc.pos.settings.getStatus.useQuery(
      { restaurantId },
      { enabled: restaurantId > 0 },
    );
  const posEnabled = status?.posEnabled === true;

  const utils = trpc.useUtils();
  const boardQ = trpc.pos.order.kdsBoard.useQuery(
    { restaurantId },
    {
      enabled: restaurantId > 0 && posEnabled,
      refetchInterval: POLL_MS,
      refetchIntervalInBackground: true,
    },
  );
  const orders = boardQ.data ?? [];

  // ── 신규 주문 감지 → 비프음 ─────────────────────────────────────────────
  const [soundOn, setSoundOn] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const knownIdsRef = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!boardQ.data) return;
    const ids = new Set(boardQ.data.map((o) => o.id));
    if (knownIdsRef.current === null) {
      // 첫 로드는 기존 주문 — 울리지 않음
      knownIdsRef.current = ids;
      return;
    }
    const hasNew = [...ids].some((id) => !knownIdsRef.current!.has(id));
    knownIdsRef.current = ids;
    if (hasNew && soundOn) playBeep(audioCtxRef);
  }, [boardQ.data, soundOn]);

  const toggleSound = () => {
    setSoundOn((prev) => {
      const next = !prev;
      if (next && !audioCtxRef.current) {
        // 사용자 제스처 시점에 생성 (브라우저 autoplay 정책)
        audioCtxRef.current = new AudioContext();
        playBeep(audioCtxRef); // 확인음
      }
      return next;
    });
  };

  // ── 경과시간 갱신용 1분 타이머 ──────────────────────────────────────────
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // ── 전체화면 ────────────────────────────────────────────────────────────
  const [isFull, setIsFull] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  };

  // ── 상태 전이 ───────────────────────────────────────────────────────────
  const invalidate = () => {
    void utils.pos.order.kdsBoard.invalidate();
    void utils.pos.order.list.invalidate();
  };
  const markReady = trpc.pos.order.markReady.useMutation({
    onSuccess: invalidate,
    onError: (e) => {
      toast.error(e.message);
      invalidate(); // 상태 경합(다른 기기 선전이) 시 최신화
    },
  });
  const markServed = trpc.pos.order.markServed.useMutation({
    onSuccess: invalidate,
    onError: (e) => {
      toast.error(e.message);
      invalidate();
    },
  });
  const mutating = markReady.isPending || markServed.isPending;

  const { paidOrders, readyOrders } = useMemo(() => {
    return {
      paidOrders: orders.filter((o) => o.status === "paid"),
      readyOrders: orders.filter((o) => o.status === "ready"),
    };
  }, [orders]);

  // ── 게이트 ──────────────────────────────────────────────────────────────
  if (restaurantId <= 0) {
    return <div className="p-6 text-muted-foreground">매장을 먼저 선택하세요.</div>;
  }
  if (statusLoading) {
    return <div className="p-6 text-muted-foreground">불러오는 중…</div>;
  }
  if (!posEnabled) {
    return (
      <div className="p-6">
        <div className="border border-border rounded-xl bg-card p-8 text-center space-y-2">
          <MonitorUp className="w-10 h-10 mx-auto text-muted-foreground" />
          <p className="font-medium">이 매장은 POS가 비활성 상태입니다</p>
          <p className="text-sm text-muted-foreground">
            매장 기본정보에서 POS를 활성화한 뒤 사용할 수 있습니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ChefHat className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-bold">주방 KDS</h1>
          <Badge variant="secondary" className="tabular-nums">
            조리 대기 {paidOrders.length} · 픽업 대기 {readyOrders.length}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {status?.posKitchenRouter !== "kds" && (
            <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-300 gap-1">
              <TriangleAlert className="w-3.5 h-3.5" />
              주방 전달 설정이 KDS가 아닙니다
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={toggleSound}
            title={soundOn ? "알림음 끄기" : "알림음 켜기"}
          >
            {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            <span className="ml-1.5 hidden sm:inline">{soundOn ? "알림음 켜짐" : "알림음 꺼짐"}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={toggleFullscreen} title="전체화면">
            {isFull ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {boardQ.isError && (
        <div className="border border-red-500/40 rounded-lg bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
          주방 연결 오류 — 주문 갱신이 지연될 수 있습니다. 수기 전달을 병행하세요. ({boardQ.error.message})
        </div>
      )}

      {orders.length === 0 && !boardQ.isLoading && (
        <div className="border border-border rounded-xl bg-card p-12 text-center text-muted-foreground">
          대기 중인 주문이 없습니다
        </div>
      )}

      {/* 주문 카드 그리드 — 조리 대기(paid) 먼저, 픽업 대기(ready) 이어서 */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[...paidOrders, ...readyOrders].map((o) => {
          const isPaid = o.status === "paid";
          const anchor = isPaid ? o.paidAt : o.readyAt;
          const mins = elapsedMin(anchor, now);
          const delayed = isPaid && mins >= DELAY_WARN_MIN;
          return (
            <div
              key={o.id}
              className={`border rounded-xl bg-card flex flex-col overflow-hidden ${
                delayed
                  ? "border-red-500/60"
                  : isPaid
                    ? "border-blue-500/40"
                    : "border-amber-500/40"
              }`}
            >
              {/* 카드 헤더 */}
              <div
                className={`px-3 py-2 flex items-center justify-between text-sm font-medium ${
                  isPaid
                    ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                }`}
              >
                <span className="font-bold text-base">#{o.orderNo}</span>
                <span className="flex items-center gap-2 tabular-nums">
                  {o.pagerNo && <span>진동벨 {o.pagerNo}</span>}
                  {o.tableNo && <span>테이블 {o.tableNo}</span>}
                  <span className={delayed ? "text-red-600 dark:text-red-400 font-bold" : ""}>
                    {timeOf(anchor)} · {mins}분
                  </span>
                </span>
              </div>

              {/* 품목 */}
              <div className="p-3 space-y-1.5 flex-1">
                {o.items.map((it) => (
                  <div key={it.id} className="text-sm leading-snug">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{it.menuItemNameSnapshot}</span>
                      <span className="tabular-nums font-bold">×{it.qty}</span>
                    </div>
                    {it.options.length > 0 && (
                      <div className="text-xs text-muted-foreground pl-2">
                        {it.options.map((op) => op.optionName).join(" · ")}
                      </div>
                    )}
                    {it.note && (
                      <div className="text-xs text-amber-600 dark:text-amber-400 pl-2">
                        메모: {it.note}
                      </div>
                    )}
                  </div>
                ))}
                {o.customerNote && (
                  <div className="text-xs text-amber-600 dark:text-amber-400 border-t border-border pt-1.5 mt-1.5">
                    요청: {o.customerNote}
                  </div>
                )}
              </div>

              {/* 액션 */}
              <div className="p-2 pt-0 grid grid-cols-2 gap-2">
                {isPaid ? (
                  <>
                    <Button
                      className="h-11"
                      disabled={mutating}
                      onClick={() => markReady.mutate({ restaurantId, id: o.id })}
                    >
                      <ChefHat className="w-4 h-4 mr-1.5" /> 조리완료
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11"
                      disabled={mutating}
                      onClick={() => markServed.mutate({ restaurantId, id: o.id })}
                    >
                      <PackageCheck className="w-4 h-4 mr-1.5" /> 전달완료
                    </Button>
                  </>
                ) : (
                  <Button
                    className="h-11 col-span-2"
                    disabled={mutating}
                    onClick={() => markServed.mutate({ restaurantId, id: o.id })}
                  >
                    <PackageCheck className="w-4 h-4 mr-1.5" /> 전달완료 (호출종료)
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
