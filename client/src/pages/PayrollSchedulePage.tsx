import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Clock, Banknote, CalendarOff,
  Leaf, RefreshCw, Users, Pencil, TrendingUp
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── 연차/대체휴무 편집 다이얼로그 ────────────────────────────────────────────
interface LeaveEditDialogProps {
  open: boolean;
  onClose: () => void;
  userId: number;
  userName: string;
  restaurantId: number;
  year: number;
  annualTotal: number;
  annualUsed: number;
  substituteTotal: number;
  substituteUsed: number;
  onSaved: () => void;
}

function LeaveEditDialog({
  open, onClose, userId, userName, restaurantId, year,
  annualTotal, annualUsed, substituteTotal, substituteUsed, onSaved
}: LeaveEditDialogProps) {
  const [aTotal, setATotal] = useState(String(annualTotal));
  const [aUsed, setAUsed] = useState(String(annualUsed));
  const [sTotal, setSTotal] = useState(String(substituteTotal));
  const [sUsed, setSUsed] = useState(String(substituteUsed));

  const upsertLeave = trpc.leaves.upsert.useMutation({
    onSuccess: () => { onSaved(); onClose(); toast.success("저장되었습니다."); },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = async () => {
    await upsertLeave.mutateAsync({ restaurantId, userId, year, leaveType: "annual", totalDays: Number(aTotal), usedDays: Number(aUsed) });
    await upsertLeave.mutateAsync({ restaurantId, userId, year, leaveType: "substitute", totalDays: Number(sTotal), usedDays: Number(sUsed) });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{userName} — 연차/대체휴무 관리</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-border p-3 space-y-3">
            <p className="text-sm font-medium text-foreground flex items-center gap-2">
              <Leaf className="w-4 h-4 text-emerald-400" /> 연차
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">발생 일수</Label>
                <Input type="number" step="0.5" value={aTotal} onChange={e => setATotal(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">사용 일수</Label>
                <Input type="number" step="0.5" value={aUsed} onChange={e => setAUsed(e.target.value)} className="mt-1" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">잔여: <span className="text-emerald-400 font-semibold">{Math.max(0, Number(aTotal) - Number(aUsed))}일</span></p>
          </div>
          <div className="rounded-lg border border-border p-3 space-y-3">
            <p className="text-sm font-medium text-foreground flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-blue-400" /> 대체휴무
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">발생 일수</Label>
                <Input type="number" step="0.5" value={sTotal} onChange={e => setSTotal(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">사용 일수</Label>
                <Input type="number" step="0.5" value={sUsed} onChange={e => setSUsed(e.target.value)} className="mt-1" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">잔여: <span className="text-blue-400 font-semibold">{Math.max(0, Number(sTotal) - Number(sUsed))}일</span></p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button onClick={handleSave} disabled={upsertLeave.isPending}>저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 직원 요약 카드 ────────────────────────────────────────────────────────────
interface StaffEntry {
  userId: number;
  userName: string;
  totalWorkHours: number;
  workDays: number;
  offDays: number;
  contractWeeklyHours: number | null;
  wageType: string | null;
  wageAmount: number | null;
  position: string | null;
  annualLeaveTotal: number;
  annualLeaveUsed: number;
  substituteLeaveTotal: number;
  substituteLeaveUsed: number;
  estimatedWage: number;
}

interface StaffSummaryCardProps {
  entry: StaffEntry;
  restaurantId: number;
  year: number;
  over5Employees: boolean;
  onEditLeave: () => void;
}

function StaffSummaryCard({ entry, over5Employees, onEditLeave }: StaffSummaryCardProps) {
  const annualRemain = Math.max(0, entry.annualLeaveTotal - entry.annualLeaveUsed);
  const substituteRemain = Math.max(0, entry.substituteLeaveTotal - entry.substituteLeaveUsed);

  return (
    <Card className="border border-border bg-card hover:border-emerald-500/40 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base font-semibold text-foreground">{entry.userName}</CardTitle>
            {entry.position && (
              <Badge variant="outline" className="mt-1 text-xs border-emerald-500/30 text-emerald-400">
                {entry.position}
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onEditLeave}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 근무 현황 */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted/30 p-3 text-center">
            <Clock className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
            <p className="text-lg font-bold text-foreground">{entry.totalWorkHours.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">총 근무시간</p>
          </div>
          <div className="rounded-lg bg-muted/30 p-3 text-center">
            <TrendingUp className="w-4 h-4 text-blue-400 mx-auto mb-1" />
            <p className="text-lg font-bold text-foreground">{entry.workDays}</p>
            <p className="text-xs text-muted-foreground">근무일수</p>
          </div>
          <div className="rounded-lg bg-muted/30 p-3 text-center">
            <CalendarOff className="w-4 h-4 text-amber-400 mx-auto mb-1" />
            <p className="text-lg font-bold text-foreground">{entry.offDays}</p>
            <p className="text-xs text-muted-foreground">휴무일수</p>
          </div>
        </div>

        {/* 예상 인건비 */}
        {entry.estimatedWage > 0 && (
          <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-emerald-300">
              <Banknote className="w-4 h-4" />
              <span>예상 인건비</span>
            </div>
            <span className="font-bold text-emerald-300">
              {entry.estimatedWage.toLocaleString()}원
            </span>
          </div>
        )}

        {/* 연차/대체휴무 (5인 이상 사업장만 표시) */}
        {over5Employees && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">연차 / 대체휴무</p>
            <div className="grid grid-cols-2 gap-2">
              {/* 연차 */}
              <div className="rounded-lg border border-border p-2.5">
                <div className="flex items-center gap-1.5 mb-2">
                  <Leaf className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs font-medium text-foreground">연차</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>발생</span><span className="text-foreground font-medium">{entry.annualLeaveTotal}일</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>사용</span><span className="text-foreground font-medium">{entry.annualLeaveUsed}일</span>
                </div>
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-muted-foreground">잔여</span>
                  <span className={cn("font-bold", annualRemain > 0 ? "text-emerald-400" : "text-red-400")}>
                    {annualRemain}일
                  </span>
                </div>
                {entry.annualLeaveTotal > 0 && (
                  <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.min(100, (entry.annualLeaveUsed / entry.annualLeaveTotal) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
              {/* 대체휴무 */}
              <div className="rounded-lg border border-border p-2.5">
                <div className="flex items-center gap-1.5 mb-2">
                  <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs font-medium text-foreground">대체휴무</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>발생</span><span className="text-foreground font-medium">{entry.substituteLeaveTotal}일</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>사용</span><span className="text-foreground font-medium">{entry.substituteLeaveUsed}일</span>
                </div>
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-muted-foreground">잔여</span>
                  <span className={cn("font-bold", substituteRemain > 0 ? "text-blue-400" : "text-red-400")}>
                    {substituteRemain}일
                  </span>
                </div>
                {entry.substituteLeaveTotal > 0 && (
                  <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all"
                      style={{ width: `${Math.min(100, (entry.substituteLeaveUsed / entry.substituteLeaveTotal) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function PayrollSchedulePage() {
  const { selectedRestaurantId } = useRestaurant();
  const rId = selectedRestaurantId;
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [leaveEditTarget, setLeaveEditTarget] = useState<null | {
    userId: number; userName: string;
    annualTotal: number; annualUsed: number;
    substituteTotal: number; substituteUsed: number;
  }>(null);

  // 매장 정보 (5인 이상 여부 — 추후 매장 설정에서 관리)
  const over5 = false; // TODO: 매장 설정 연동

  // 직원별 월별 근무 요약
  const summaryQuery = trpc.leaves.getStaffMonthlySummary.useQuery(
    { restaurantId: rId!, year, month },
    { enabled: !!rId }
  );

  const utils = trpc.useUtils();

  const handlePrevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const handleNextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  const summaryList = (summaryQuery.data ?? []) as StaffEntry[];

  // 전체 집계
  const totalWage = summaryList.reduce((acc, e) => acc + e.estimatedWage, 0);
  const totalHours = summaryList.reduce((acc, e) => acc + e.totalWorkHours, 0);

  return (
    <AppLayout title="인건비 정산">
      <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
        {/* 헤더 — 월 선택 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={handlePrevMonth}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <h2 className="text-lg font-bold text-foreground min-w-[120px] text-center">
              {year}년 {month}월
            </h2>
            <Button variant="ghost" size="icon" onClick={handleNextMonth}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
            <SelectTrigger className="w-24 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => (
                <SelectItem key={y} value={String(y)}>{y}년</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 요약 통계 카드 */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="border border-border bg-card">
            <CardContent className="p-4 text-center">
              <Users className="w-5 h-5 text-emerald-400 mx-auto mb-1" />
              <p className="text-2xl font-bold text-foreground">{summaryList.length}</p>
              <p className="text-xs text-muted-foreground">근무 직원</p>
            </CardContent>
          </Card>
          <Card className="border border-border bg-card">
            <CardContent className="p-4 text-center">
              <Clock className="w-5 h-5 text-blue-400 mx-auto mb-1" />
              <p className="text-2xl font-bold text-foreground">{totalHours.toFixed(0)}</p>
              <p className="text-xs text-muted-foreground">총 근무시간</p>
            </CardContent>
          </Card>
          <Card className="border border-border bg-card">
            <CardContent className="p-4 text-center">
              <Banknote className="w-5 h-5 text-amber-400 mx-auto mb-1" />
              <p className="text-xl font-bold text-foreground">{(totalWage / 10000).toFixed(0)}만</p>
              <p className="text-xs text-muted-foreground">예상 인건비</p>
            </CardContent>
          </Card>
        </div>

        {/* 직원별 카드 목록 */}
        {summaryQuery.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-48 rounded-xl bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : summaryList.length === 0 ? (
          <Card className="border border-border bg-card">
            <CardContent className="py-16 text-center">
              <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-muted-foreground">이번 달 완료된 근무 기록이 없습니다.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {summaryList.map(entry => (
              <StaffSummaryCard
                key={entry.userId}
                entry={entry}
                restaurantId={rId!}
                year={year}
                over5Employees={over5}
                onEditLeave={() => setLeaveEditTarget({
                  userId: entry.userId,
                  userName: entry.userName,
                  annualTotal: entry.annualLeaveTotal,
                  annualUsed: entry.annualLeaveUsed,
                  substituteTotal: entry.substituteLeaveTotal,
                  substituteUsed: entry.substituteLeaveUsed,
                })}
              />
            ))}
          </div>
        )}
      </div>

      {/* 연차/대체휴무 편집 다이얼로그 */}
      {leaveEditTarget && (
        <LeaveEditDialog
          open={!!leaveEditTarget}
          onClose={() => setLeaveEditTarget(null)}
          userId={leaveEditTarget.userId}
          userName={leaveEditTarget.userName}
          restaurantId={rId!}
          year={year}
          annualTotal={leaveEditTarget.annualTotal}
          annualUsed={leaveEditTarget.annualUsed}
          substituteTotal={leaveEditTarget.substituteTotal}
          substituteUsed={leaveEditTarget.substituteUsed}
          onSaved={() => utils.leaves.getStaffMonthlySummary.invalidate()}
        />
      )}
    </AppLayout>
  );
}
