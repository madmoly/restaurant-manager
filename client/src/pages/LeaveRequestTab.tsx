import { useState, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";
import { CalendarOff, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate, LEAVE_LABELS, REQ_STATUS } from "@/lib/scheduleHelpers";

interface LeaveRequestTabProps {
  restaurantId: number;
  isManager: boolean;
}

export default function LeaveRequestTab({ restaurantId, isManager }: LeaveRequestTabProps) {
  const [showForm, setShowForm] = useState(false);
  const [leaveDate, setLeaveDate] = useState("");
  const [leaveType, setLeaveType] = useState<"dayoff" | "half_morning" | "half_evening">("dayoff");
  const [reason, setReason] = useState("");

  const utils = trpc.useUtils();

  const myLeaves = trpc.leaveRequests.listMine.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 && !isManager },
  );
  const allLeaves = trpc.leaveRequests.list.useQuery(
    { restaurantId, status: "pending" },
    { enabled: restaurantId > 0 && isManager },
  );

  const createLeave = trpc.leaveRequests.create.useMutation({
    onSuccess() {
      toast.success("휴무/반차 신청 완료");
      setShowForm(false);
      setLeaveDate("");
      setLeaveType("dayoff");
      setReason("");
      utils.leaveRequests.listMine.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const cancelLeave = trpc.leaveRequests.cancel.useMutation({
    onSuccess() {
      toast.success("신청이 취소되었습니다");
      utils.leaveRequests.listMine.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const reviewLeave = trpc.leaveRequests.review.useMutation({
    onSuccess() {
      toast.success("처리 완료");
      utils.leaveRequests.list.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const handleSubmit = () => {
    if (!leaveDate) { toast.error("날짜를 선택해주세요"); return; }
    createLeave.mutate({ restaurantId, leaveDate, leaveType, reason: reason || undefined });
  };

  const minDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    return fmtDate(d);
  }, []);

  const leaves = isManager ? (allLeaves.data || []) : (myLeaves.data || []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarOff className="h-4 w-4 text-primary" />
            {isManager ? "휴무/반차 신청 관리" : "휴무/반차 신청"}
          </CardTitle>
          {!isManager && (
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setShowForm(!showForm)}>
              {showForm ? "취소" : "신청하기"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showForm && !isManager && (
          <div className="p-3 rounded-lg bg-muted/50 border space-y-3">
            <p className="text-[10px] text-muted-foreground">최소 5일 전 신청 필요</p>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">날짜</label>
              <input
                type="date"
                min={minDate}
                value={leaveDate}
                onChange={(e) => setLeaveDate(e.target.value)}
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">유형</label>
              <div className="grid grid-cols-3 gap-1.5">
                {(["dayoff", "half_morning", "half_evening"] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setLeaveType(t)}
                    className={`text-xs py-2 rounded-md border transition-colors ${
                      leaveType === t
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {t === "dayoff" ? "휴무" : t === "half_morning" ? "반차출근" : "반차퇴근"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">사유 (선택)</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="사유를 입력하세요"
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              />
            </div>
            <Button size="sm" className="w-full" onClick={handleSubmit} disabled={createLeave.isPending}>
              {createLeave.isPending ? "신청 중..." : "신청"}
            </Button>
          </div>
        )}

        {leaves.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">
            {isManager ? "대기 중인 신청이 없습니다" : "신청 내역이 없습니다"}
          </p>
        ) : (
          <div className="space-y-2">
            {leaves.map((l: any) => (
              <div key={l.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                <div className="min-w-0">
                  {isManager && l.userName && (
                    <span className="font-medium text-foreground mr-1.5">{l.userName}</span>
                  )}
                  <span className="text-foreground">
                    {typeof l.leaveDate === "string" ? l.leaveDate : new Date(l.leaveDate).toISOString().substring(0, 10)}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1.5">
                    {LEAVE_LABELS[l.leaveType] || l.leaveType}
                  </span>
                  {l.reason && <span className="text-xs text-muted-foreground ml-1.5">· {l.reason}</span>}
                  {l.reviewNote && <span className="text-xs text-amber-600 dark:text-amber-400 ml-1.5">({l.reviewNote})</span>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isManager && l.status === "pending" ? (
                    <>
                      <Button
                        size="sm" variant="outline"
                        className="text-[10px] h-6 px-2 border-green-300 text-green-600 hover:bg-green-50"
                        onClick={() => reviewLeave.mutate({ id: l.id, status: "approved" })}
                        disabled={reviewLeave.isPending}
                      >
                        <Check className="w-3 h-3 mr-0.5" /> 승인
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        className="text-[10px] h-6 px-2 border-red-300 text-red-600 hover:bg-red-50"
                        onClick={() => reviewLeave.mutate({ id: l.id, status: "rejected" })}
                        disabled={reviewLeave.isPending}
                      >
                        <X className="w-3 h-3 mr-0.5" /> 거절
                      </Button>
                    </>
                  ) : (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${REQ_STATUS[l.status]?.color || ""}`}>
                      {REQ_STATUS[l.status]?.label || l.status}
                    </span>
                  )}
                  {!isManager && l.status === "pending" && (
                    <Button
                      size="sm" variant="ghost"
                      className="text-[10px] h-6 px-1.5 text-muted-foreground hover:text-destructive"
                      onClick={() => cancelLeave.mutate({ id: l.id })}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
