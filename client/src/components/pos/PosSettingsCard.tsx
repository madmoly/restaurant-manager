import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Card } from "@/components/ui/compat";
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
import { Settings } from "lucide-react";
import { toast } from "sonner";
import {
  STYLE_PRESET_LABEL,
  ORDER_MODE_LABEL,
  PAYMENT_PROVIDER_LABEL,
  KITCHEN_ROUTER_LABEL,
  labelOf,
} from "@/lib/posLabels";

const STYLE_PRESETS = [
  { value: "DEPT_PICKUP", label: "백화점 선불 셀프픽업" },
  { value: "SHOP_PICKUP", label: "로드샵 선불 셀프픽업" },
  { value: "SHOP_TABLE", label: "로드샵 후불 테이블" },
  { value: "COURT_PICKUP", label: "푸드코트 선불 테이블" },
  { value: "KIOSK_PICKUP", label: "키오스크 무인 선불" },
] as const;

type StylePreset = (typeof STYLE_PRESETS)[number]["value"];

interface Props {
  restaurantId: number;
  /** manager 이상이면 편집 가능. 호출 측에서 권한 판정 결과 전달. */
  canEdit: boolean;
}

/**
 * 매장의 POS 활성화 상태와 프리셋·세부 설정 카드.
 * StoreInfoPage 등에서 사용. 비활성이면 마스터 요청 안내.
 */
export function PosSettingsCard({ restaurantId, canEdit }: Props) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.pos.settings.getStatus.useQuery({
    restaurantId,
  });

  const applyPresetMutation = trpc.pos.settings.applyPreset.useMutation({
    onSuccess() {
      toast.success("프리셋 적용 완료");
      utils.pos.settings.getStatus.invalidate({ restaurantId });
    },
    onError(e) {
      toast.error(e.message);
    },
  });
  const overrideMutation = trpc.pos.settings.override.useMutation({
    onSuccess() {
      toast.success("설정 갱신 완료");
      utils.pos.settings.getStatus.invalidate({ restaurantId });
    },
    onError(e) {
      toast.error(e.message);
    },
  });

  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<StylePreset>("DEPT_PICKUP");
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [tolerance, setTolerance] = useState<string>("");

  const enabled = data?.posEnabled === true;

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-1">
        <Settings size={14} className="text-primary" /> POS 설정
      </h3>
      <p className="text-[11px] text-muted-foreground mb-4">
        이 매장의 POS 활성화 상태와 프리셋·세부 설정.
      </p>

      {isLoading ? (
        <p className="text-xs text-muted-foreground text-center py-6">
          로딩 중...
        </p>
      ) : !enabled ? (
        <div className="space-y-2">
          <Badge variant="secondary" className="text-xs">
            비활성
          </Badge>
          <p className="text-xs text-muted-foreground">
            POS가 이 매장에 활성화되지 않았습니다.{" "}
            <span className="font-medium text-foreground">마스터 관리자</span>
            에게 활성화를 요청하세요.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="default" className="text-xs">
              활성
            </Badge>
            {data?.posStylePreset && (
              <Badge variant="outline" className="text-xs">
                {labelOf(STYLE_PRESET_LABEL, data.posStylePreset)}
              </Badge>
            )}
          </div>
          <dl className="text-xs grid grid-cols-2 gap-y-1.5">
            <dt className="text-muted-foreground">주문 모드</dt>
            <dd className="text-foreground">
              {labelOf(ORDER_MODE_LABEL, data?.posDefaultOrderMode)}
            </dd>
            <dt className="text-muted-foreground">결제 처리</dt>
            <dd className="text-foreground">
              {labelOf(PAYMENT_PROVIDER_LABEL, data?.posPaymentProvider)}
            </dd>
            <dt className="text-muted-foreground">주방 라우터</dt>
            <dd className="text-foreground">
              {labelOf(KITCHEN_ROUTER_LABEL, data?.posKitchenRouter)}
            </dd>
            <dt className="text-muted-foreground">대조 허용 오차</dt>
            <dd className="text-foreground tabular-nums">
              {(data?.posReconcileTolerance ?? 0).toLocaleString("ko-KR")}원
            </dd>
          </dl>
          {canEdit && (
            <div className="flex gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => {
                  const initial = (data?.posStylePreset ??
                    "DEPT_PICKUP") as StylePreset;
                  setSelectedPreset(initial);
                  setPresetDialogOpen(true);
                }}
              >
                프리셋 변경
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => {
                  setTolerance(String(data?.posReconcileTolerance ?? 0));
                  setOverrideDialogOpen(true);
                }}
              >
                세부 설정
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 프리셋 변경 다이얼로그 — 라디오 카드 */}
      <Dialog open={presetDialogOpen} onOpenChange={setPresetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>매장 스타일 프리셋 변경</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <div className="grid grid-cols-1 gap-2">
              {STYLE_PRESETS.map((p) => (
                <label
                  key={p.value}
                  className={`flex items-center p-3 border rounded cursor-pointer transition-colors ${
                    selectedPreset === p.value
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="settings-preset"
                    value={p.value}
                    checked={selectedPreset === p.value}
                    onChange={() => setSelectedPreset(p.value)}
                    className="mr-3"
                  />
                  <div className="font-medium text-sm">{p.label}</div>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              프리셋을 변경하면 주문 모드·결제·주방·허용오차가 모두 새 값으로
              덮어씁니다. 기존 미세조정은 사라집니다.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPresetDialogOpen(false)}
            >
              취소
            </Button>
            <Button
              disabled={applyPresetMutation.isPending}
              onClick={() => {
                applyPresetMutation.mutate(
                  { restaurantId, stylePreset: selectedPreset },
                  { onSuccess: () => setPresetDialogOpen(false) }
                );
              }}
            >
              적용
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 세부 설정(오버라이드) 다이얼로그 */}
      <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>POS 세부 설정</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="text-sm font-medium">대조 허용 오차 (원)</label>
            <Input
              type="number"
              min={0}
              value={tolerance}
              onChange={(e) => setTolerance(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              일일 대조에서 차이가 이 금액 이내면 정상 표시. 초과 시 경고만
              (확정은 가능).
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOverrideDialogOpen(false)}
            >
              취소
            </Button>
            <Button
              disabled={overrideMutation.isPending}
              onClick={() => {
                const t = parseInt(tolerance, 10);
                if (Number.isNaN(t) || t < 0) {
                  toast.error("0 이상의 숫자를 입력하세요");
                  return;
                }
                overrideMutation.mutate(
                  { restaurantId, posReconcileTolerance: t },
                  { onSuccess: () => setOverrideDialogOpen(false) }
                );
              }}
            >
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
