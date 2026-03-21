import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, TrendingUp, Calculator } from "lucide-react";

interface QuickSalesModalProps {
  open: boolean;
  onClose: () => void;
  restaurantId: number;
  restaurantName?: string;
  onSuccess?: () => void;
}

export default function QuickSalesModal({
  open, onClose, restaurantId, restaurantName, onSuccess
}: QuickSalesModalProps) {
  const today = new Date();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const utils = trpc.useUtils();
  const createMutation = trpc.sales.create.useMutation({
    onSuccess: () => {
      toast.success("매출이 기록되었습니다.");
      utils.sales.listByMonth.invalidate();
      utils.profitability.monthly.invalidate();
      setAmount("");
      setNote("");
      onSuccess?.();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(amount.replace(/,/g, ""));
    if (!num || num <= 0) {
      toast.error("올바른 금액을 입력해주세요.");
      return;
    }
    createMutation.mutate({
      restaurantId,
      saleDate: today.toISOString().split("T")[0],
      amount: num,
      note: note || undefined,
    });
  };

  const formatAmount = (val: string) => {
    const num = val.replace(/[^0-9]/g, "");
    return num ? Number(num).toLocaleString() : "";
  };

  const PERIOD_LABELS: Record<string, string> = {
    lunch: "점심",
    dinner: "저녁",
    all_day: "전체",
  };

  const todayStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 bg-emerald-100 rounded-lg">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <DialogTitle className="text-base">매출 빠른 입력</DialogTitle>
              <DialogDescription className="text-xs">
                {restaurantName && <span className="font-medium text-foreground">{restaurantName}</span>}
                {restaurantName && " · "}{todayStr}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* 금액 입력 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">매출 금액</Label>
            <div className="relative">
              <Calculator className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(formatAmount(e.target.value))}
                className="pl-9 pr-8 text-right text-lg font-semibold h-12"
                autoFocus
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
            </div>
            {amount && (
              <p className="text-xs text-muted-foreground text-right">
                {Number(amount.replace(/,/g, "")).toLocaleString()}원
              </p>
            )}
          </div>

          {/* 메모 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              메모 <span className="text-muted-foreground font-normal">(선택)</span>
            </Label>
            <Textarea
              placeholder="특이사항, 행사, 날씨 등..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="resize-none h-20 text-sm"
            />
          </div>

          {/* 버튼 */}
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              취소
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />저장 중...</>
              ) : "매출 기록"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
