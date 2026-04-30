import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Card } from "@/components/ui/compat";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Power } from "lucide-react";
import { toast } from "sonner";
import { STYLE_PRESET_SHORT, labelOf } from "@/lib/posLabels";

const STYLE_PRESETS = [
  { value: "DEPT_PICKUP", label: "백화점 선불 셀프픽업" },
  { value: "SHOP_PICKUP", label: "로드샵 선불 셀프픽업" },
  { value: "SHOP_TABLE", label: "로드샵 후불 테이블" },
  { value: "COURT_PICKUP", label: "푸드코트 선불 테이블" },
  { value: "KIOSK_PICKUP", label: "키오스크 무인 선불" },
] as const;

type StylePreset = (typeof STYLE_PRESETS)[number]["value"];

/**
 * 매장별 POS 활성화 토글 (master 전용).
 * SystemPage SettingsTab에서 사용. restaurants.list로 전체 매장 받아 처리.
 */
export function PosToggleCard() {
  const utils = trpc.useUtils();
  const { data: restaurants, isLoading } = trpc.restaurants.list.useQuery();

  const enableMutation = trpc.pos.settings.enable.useMutation({
    onSuccess() {
      toast.success("POS 활성화 완료");
      utils.restaurants.list.invalidate();
    },
    onError(e) {
      toast.error(e.message);
    },
  });
  const disableMutation = trpc.pos.settings.disable.useMutation({
    onSuccess() {
      toast.success("POS 비활성화 완료");
      utils.restaurants.list.invalidate();
    },
    onError(e) {
      toast.error(e.message);
    },
  });

  const [enableTarget, setEnableTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [stylePreset, setStylePreset] = useState<StylePreset>("DEPT_PICKUP");

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-1">
        <Power size={14} className="text-primary" /> POS 활성화 관리
      </h3>
      <p className="text-[11px] text-muted-foreground mb-4">
        매장별로 POS 시스템을 켜고 끕니다. 마스터 전용.
      </p>

      {isLoading ? (
        <p className="text-xs text-muted-foreground text-center py-6">
          로딩 중...
        </p>
      ) : !restaurants || restaurants.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">
          매장이 없습니다
        </p>
      ) : (
        <div className="space-y-2">
          {restaurants.map((r) => {
            const enabled = (r as { posEnabled?: boolean }).posEnabled === true;
            const preset = (r as { posStylePreset?: string | null })
              .posStylePreset;
            return (
              <div
                key={r.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">
                    {r.name}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    매장 ID: {r.id}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-3">
                  {enabled ? (
                    <>
                      <Badge variant="default" className="text-xs">
                        활성
                        {preset
                          ? ` · ${labelOf(STYLE_PRESET_SHORT, preset)}`
                          : ""}
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={disableMutation.isPending}
                        onClick={() =>
                          disableMutation.mutate({ restaurantId: r.id })
                        }
                      >
                        비활성화
                      </Button>
                    </>
                  ) : (
                    <>
                      <Badge variant="secondary" className="text-xs">
                        비활성
                      </Badge>
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setEnableTarget({ id: r.id, name: r.name });
                          setStylePreset("DEPT_PICKUP");
                        }}
                      >
                        활성화
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 활성화 다이얼로그 — 라디오 카드 */}
      <Dialog
        open={!!enableTarget}
        onOpenChange={(open) => !open && setEnableTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>POS 활성화 — {enableTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <div className="text-sm font-medium">매장 스타일 프리셋</div>
            <div className="grid grid-cols-1 gap-2">
              {STYLE_PRESETS.map((p) => (
                <label
                  key={p.value}
                  className={`flex items-center p-3 border rounded cursor-pointer transition-colors ${
                    stylePreset === p.value
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="enable-preset"
                    value={p.value}
                    checked={stylePreset === p.value}
                    onChange={() => setStylePreset(p.value)}
                    className="mr-3"
                  />
                  <div className="font-medium text-sm">{p.label}</div>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              프리셋 선택 시 주문 모드·결제 처리기·주방 라우터·허용 오차가 자동
              적용됩니다. 점장이 추후 변경 가능.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnableTarget(null)}>
              취소
            </Button>
            <Button
              disabled={enableMutation.isPending}
              onClick={() => {
                if (!enableTarget) return;
                enableMutation.mutate(
                  { restaurantId: enableTarget.id, stylePreset },
                  { onSuccess: () => setEnableTarget(null) }
                );
              }}
            >
              활성화 적용
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
