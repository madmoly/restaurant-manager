import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { todayKST } from "@/lib/dateKST";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/_core/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Plus, Trash2, UserPlus, FileText, Users, Send, Eye,
  CheckCircle2, Clock, XCircle, AlertTriangle, ChevronDown, ChevronUp,
  ArrowRight, RefreshCw, Search, ShieldCheck, KeyRound
} from "lucide-react";

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}
function fmtWage(wageType: string, wageAmount: string | number) {
  const n = typeof wageAmount === "string" ? parseFloat(wageAmount) : wageAmount;
  if (isNaN(n)) return "—";
  return wageType === "hourly" ? `시급 ${n.toLocaleString()}원` : `월급 ${n.toLocaleString()}원`;
}
function contractTypeLabel(t: string) {
  const map: Record<string, string> = { permanent: "정규직", fixed_term: "기간제", part_time: "단시간", daily: "일용직" };
  return map[t] || t;
}
function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    draft:     { label: "초안",     cls: "bg-zinc-700/60 text-zinc-300 border-zinc-600/40",         icon: <Clock className="h-3 w-3" /> },
    sent:      { label: "발송됨",   cls: "bg-blue-500/10 text-blue-400 border-blue-500/20",          icon: <Send className="h-3 w-3" /> },
    signed:    { label: "서명완료", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: <CheckCircle2 className="h-3 w-3" /> },
    expired:   { label: "만료",     cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",       icon: <AlertTriangle className="h-3 w-3" /> },
    cancelled: { label: "취소",     cls: "bg-red-500/10 text-red-400 border-red-500/20",             icon: <XCircle className="h-3 w-3" /> },
  };
  const m = map[status] || { label: status, cls: "bg-zinc-700/60 text-zinc-300 border-zinc-600/40", icon: null };
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${m.cls}`}>
      {m.icon}{m.label}
    </span>
  );
}
function dDayBadge(contractEnd: string | Date | null | undefined) {
  if (!contractEnd) return null;
  const diff = Math.ceil((new Date(contractEnd).getTime() - Date.now()) / 86400000);
  if (diff < 0) return <span className="text-xs text-zinc-500">만료됨</span>;
  const cls = diff <= 30 ? "text-red-400" : diff <= 90 ? "text-amber-400" : "text-zinc-400";
  return <span className={`text-xs font-medium ${cls}`}>D-{diff}</span>;
}

type EcContract = {
  id: number; token: string; status: string; contractType: string;
  contractStart: string | Date; contractEnd: string | Date | null;
  wageType: string; wageAmount: string; position: string;
  createdAt: string | Date; signedAt: string | Date | null;
  previousContractId: number | null;
  employeeName: string; employeePhone: string | null;
};

// ─── 계약서 카드 (계약 이력 탭용) ──────────────────────────────────────────────
function ContractCard({
  c, restaurantName, isFirst, onPreview, onSend, onRenew,
}: {
  c: EcContract; restaurantName: string; isFirst: boolean;
  onPreview: (id: number) => void;
  onSend: (id: number) => void;
  onRenew?: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const durationMonths = c.contractEnd
    ? Math.round((new Date(c.contractEnd).getTime() - new Date(c.contractStart).getTime()) / (1000 * 60 * 60 * 24 * 30))
    : null;
  const isProbation = c.contractType === "fixed_term" && durationMonths !== null && durationMonths <= 3;
  return (
    <div className={`rounded-xl border ${isFirst ? "border-blue-500/30 bg-blue-500/5" : "border-border/50 bg-card/50"} overflow-hidden`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isProbation ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"}`}>
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-medium">{isProbation ? "수습" : contractTypeLabel(c.contractType)}</span>
              {isFirst && <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">최신</span>}
              {statusBadge(c.status)}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {fmtDate(c.contractStart)} ~ {c.contractEnd ? fmtDate(c.contractEnd) : "무기한"}
              {c.contractEnd && <span className="ml-2">{dDayBadge(c.contractEnd)}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-muted-foreground hidden sm:block">{fmtWage(c.wageType, c.wageAmount)}</span>
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-border/30 pt-3 space-y-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div><span className="text-muted-foreground">직책</span><span className="ml-2 text-foreground">{c.position}</span></div>
            <div><span className="text-muted-foreground">급여</span><span className="ml-2 text-foreground">{fmtWage(c.wageType, c.wageAmount)}</span></div>
            <div><span className="text-muted-foreground">계약 시작</span><span className="ml-2 text-foreground">{fmtDate(c.contractStart)}</span></div>
            <div><span className="text-muted-foreground">계약 종료</span><span className="ml-2 text-foreground">{c.contractEnd ? fmtDate(c.contractEnd) : "무기한"}</span></div>
            {c.signedAt && (
              <div className="col-span-2"><span className="text-muted-foreground">서명 일시</span><span className="ml-2 text-emerald-400">{new Date(c.signedAt).toLocaleString("ko-KR")}</span></div>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => onPreview(c.id)}>
              <Eye className="h-3 w-3" /> 계약서 열람
            </Button>
            {c.status === "draft" && (
              <Button size="sm" className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => onSend(c.id)}>
                <Send className="h-3 w-3" /> 서명 요청 발송
              </Button>
            )}
            {(c.status === "signed" || c.status === "sent" || c.status === "expired") && onRenew && isFirst && (
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1 border-amber-500/40 text-amber-400 hover:bg-amber-500/10" onClick={() => onRenew(c.id)}>
                <RefreshCw className="h-3 w-3" /> 계약 갱신
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 전자계약 작성 위자드 ─────────────────────────────────────────────────────
const MINIMUM_WAGE_2026 = 10320;
const MINIMUM_MONTHLY_WAGE_2026 = 2156880;
const BASIC_SPECIAL_TERMS = `1. 수습기간 중 최저임금의 90% 적용 (3개월 이내)
2. 4대보험 가입 (국민연금, 건강보험, 고용보험, 산재보험)
3. 연차유급휴가: 1년 미만 근무 시 월 1일 발생
4. 퇴직금: 1년 이상 근무 시 지급 (근로기준법 제34조)
5. 근로계약 해지 시 30일 전 사전 통보 원칙`;

function ContractWizard({
  open, onClose, restaurantId, restaurantName,
  prefillName, prefillPhone,
}: {
  open: boolean; onClose: () => void;
  restaurantId: number; restaurantName: string;
  prefillName?: string; prefillPhone?: string;
}) {
  const utils = trpc.useUtils();
  const today = useMemo(() => todayKST(), []);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    employeeName: prefillName ?? "", employeePhone: prefillPhone ?? "",
    employeeBirthdate: "", employeeAddress: "",
    position: "직원",
    contractType: "part_time" as "permanent" | "fixed_term" | "part_time" | "daily",
    contractStart: today, contractEnd: "",
    hasProbation: false, probationMonths: 0,
    workPlace: restaurantName, jobDescription: "홀 서빙, 주방 보조 등 사용자 지시 업무",
    wageType: "hourly" as "hourly" | "monthly",
    wageAmount: String(MINIMUM_WAGE_2026),
    weeklyHours: "40", workStartTime: "09:00", workEndTime: "18:00",
    breakMinutes: 60, weeklyHoliday: "일요일",
    payDay: 25, payMethod: "bank_transfer" as "bank_transfer" | "cash",
    mealProvided: false, mealAllowance: 0,
    socialInsurance: true, over5Employees: false, nightShiftConsent: false,
    specialTerms: "",
  });
  const [previewId, setPreviewId] = useState<number | null>(null);
  const previewQuery = trpc.electronicContracts.getHtml.useQuery(
    { contractId: previewId ?? 0, restaurantName },
    { enabled: !!previewId }
  );
  const createMutation = trpc.electronicContracts.create.useMutation({
    onSuccess: (data) => {
      utils.electronicContracts.list.invalidate();
      if (data?.id) setPreviewId(data.id);
      toast.success("계약서 초안이 저장되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });
  const sendMutation = trpc.electronicContracts.send.useMutation({
    onSuccess: (data) => {
      utils.electronicContracts.list.invalidate();
      const signUrl = `${window.location.origin}/contract/sign/${data.token}`;
      navigator.clipboard.writeText(signUrl).catch(() => {});
      toast.success("서명 링크가 클립보드에 복사되었습니다.");
      handleClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = () => {
    if (!form.employeeName.trim()) { toast.error("직원 이름을 입력하세요."); return; }
    if (!form.wageAmount || Number(form.wageAmount) <= 0) { toast.error("급여를 입력하세요."); return; }
    createMutation.mutate({
      restaurantId,
      employeeName: form.employeeName,
      employeePhone: form.employeePhone || undefined,
      employeeBirthdate: form.employeeBirthdate || undefined,
      employeeAddress: form.employeeAddress || undefined,
      position: form.position,
      contractType: form.contractType,
      contractStart: form.contractStart,
      contractEnd: form.contractEnd || undefined,
      hasProbation: form.hasProbation,
      probationMonths: form.probationMonths,
      workPlace: form.workPlace,
      jobDescription: form.jobDescription,
      wageType: form.wageType,
      wageAmount: Number(form.wageAmount),
      weeklyHours: Number(form.weeklyHours),
      workStartTime: form.workStartTime,
      workEndTime: form.workEndTime,
      breakMinutes: form.breakMinutes,
      weeklyHoliday: form.weeklyHoliday,
      payDay: form.payDay,
      payMethod: form.payMethod,
      mealProvided: form.mealProvided,
      mealAllowance: form.mealAllowance,
      socialInsurance: form.socialInsurance,
      over5Employees: form.over5Employees,
      nightShiftConsent: form.nightShiftConsent,
      specialTerms: form.specialTerms || undefined,
    });
  };

  const handleClose = () => {
    setStep(1);
    setPreviewId(null);
    setForm(f => ({
      ...f,
      employeeName: prefillName ?? "",
      employeePhone: prefillPhone ?? "",
      wageAmount: String(MINIMUM_WAGE_2026),
    }));
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-400" />
            전자계약서 작성 {previewId ? "— 미리보기" : `(${step}/3)`}
          </DialogTitle>
        </DialogHeader>

        {/* 미리보기 모드 */}
        {previewId ? (
          <>
            {previewQuery.isLoading && <p className="text-center py-8 text-muted-foreground">로딩 중...</p>}
            {previewQuery.data?.html && (
              <div className="border border-border rounded-lg overflow-hidden"
                dangerouslySetInnerHTML={{ __html: previewQuery.data.html }} />
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={handleClose}>닫기</Button>
              <Button size="sm" className="gap-1 bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => sendMutation.mutate({ contractId: previewId })}
                disabled={sendMutation.isPending}>
                <Send className="h-3.5 w-3.5" /> 서명 링크 발송
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {/* 1단계: 기본 정보 */}
            {step === 1 && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground font-medium">기본 정보</p>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">직원 이름 *</Label><Input className="h-8 text-sm mt-1" value={form.employeeName} onChange={e => setForm(f => ({ ...f, employeeName: e.target.value }))} placeholder="홍길동" /></div>
                  <div><Label className="text-xs">연락처</Label><Input className="h-8 text-sm mt-1" value={form.employeePhone} onChange={e => setForm(f => ({ ...f, employeePhone: e.target.value }))} placeholder="010-0000-0000" /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">생년월일</Label><Input className="h-8 text-sm mt-1" type="date" value={form.employeeBirthdate} onChange={e => setForm(f => ({ ...f, employeeBirthdate: e.target.value }))} /></div>
                  <div><Label className="text-xs">직책</Label><Input className="h-8 text-sm mt-1" value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} placeholder="직원" /></div>
                </div>
                <div><Label className="text-xs">주소</Label><Input className="h-8 text-sm mt-1" value={form.employeeAddress} onChange={e => setForm(f => ({ ...f, employeeAddress: e.target.value }))} placeholder="주소 입력" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">계약 유형</Label>
                    <Select value={form.contractType} onValueChange={v => setForm(f => ({ ...f, contractType: v as typeof f.contractType }))}>
                      <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="permanent">정규직</SelectItem>
                        <SelectItem value="fixed_term">기간제</SelectItem>
                        <SelectItem value="part_time">단시간</SelectItem>
                        <SelectItem value="daily">일용직</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-xs">계약 시작일</Label><Input className="h-8 text-sm mt-1" type="date" value={form.contractStart} onChange={e => setForm(f => ({ ...f, contractStart: e.target.value }))} /></div>
                </div>
                {form.contractType !== "permanent" && (
                  <div><Label className="text-xs">계약 종료일</Label><Input className="h-8 text-sm mt-1" type="date" value={form.contractEnd} onChange={e => setForm(f => ({ ...f, contractEnd: e.target.value }))} /></div>
                )}
                <div className="flex items-center gap-2">
                  <Switch checked={form.hasProbation} onCheckedChange={v => setForm(f => ({ ...f, hasProbation: v }))} />
                  <span className="text-xs">수습기간 적용</span>
                  {form.hasProbation && (
                    <Input className="h-7 w-16 text-xs ml-2" type="number" min={1} max={3} value={form.probationMonths}
                      onChange={e => setForm(f => ({ ...f, probationMonths: Number(e.target.value) }))} />
                  )}
                  {form.hasProbation && <span className="text-xs text-muted-foreground">개월</span>}
                </div>
              </div>
            )}

            {/* 2단계: 근무 조건 */}
            {step === 2 && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground font-medium">근무 조건 및 급여</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">급여 유형</Label>
                    <Select value={form.wageType} onValueChange={v => setForm(f => ({ ...f, wageType: v as "hourly" | "monthly" }))}>
                      <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hourly">시급제</SelectItem>
                        <SelectItem value="monthly">월급제</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">{form.wageType === "hourly" ? `시급 (최저 ${MINIMUM_WAGE_2026.toLocaleString()}원)` : `월급 (최저 ${MINIMUM_MONTHLY_WAGE_2026.toLocaleString()}원)`}</Label>
                    <Input className="h-8 text-sm mt-1" type="number" value={form.wageAmount} onChange={e => setForm(f => ({ ...f, wageAmount: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div><Label className="text-xs">주 근무시간</Label><Input className="h-8 text-sm mt-1" type="number" value={form.weeklyHours} onChange={e => setForm(f => ({ ...f, weeklyHours: e.target.value }))} /></div>
                  <div><Label className="text-xs">출근 시간</Label><Input className="h-8 text-sm mt-1" type="time" value={form.workStartTime} onChange={e => setForm(f => ({ ...f, workStartTime: e.target.value }))} /></div>
                  <div><Label className="text-xs">퇴근 시간</Label><Input className="h-8 text-sm mt-1" type="time" value={form.workEndTime} onChange={e => setForm(f => ({ ...f, workEndTime: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">휴게시간 (분)</Label><Input className="h-8 text-sm mt-1" type="number" value={form.breakMinutes} onChange={e => setForm(f => ({ ...f, breakMinutes: Number(e.target.value) }))} /></div>
                  <div><Label className="text-xs">주휴일</Label><Input className="h-8 text-sm mt-1" value={form.weeklyHoliday} onChange={e => setForm(f => ({ ...f, weeklyHoliday: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">급여일 (매월)</Label><Input className="h-8 text-sm mt-1" type="number" min={1} max={31} value={form.payDay} onChange={e => setForm(f => ({ ...f, payDay: Number(e.target.value) }))} /></div>
                  <div>
                    <Label className="text-xs">지급 방법</Label>
                    <Select value={form.payMethod} onValueChange={v => setForm(f => ({ ...f, payMethod: v as "bank_transfer" | "cash" }))}>
                      <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bank_transfer">계좌이체</SelectItem>
                        <SelectItem value="cash">현금</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer"><Switch checked={form.socialInsurance} onCheckedChange={v => setForm(f => ({ ...f, socialInsurance: v }))} /><span>4대보험</span></label>
                  <label className="flex items-center gap-1.5 cursor-pointer"><Switch checked={form.mealProvided} onCheckedChange={v => setForm(f => ({ ...f, mealProvided: v }))} /><span>식사 제공</span></label>
                  <label className="flex items-center gap-1.5 cursor-pointer"><Switch checked={form.over5Employees} onCheckedChange={v => setForm(f => ({ ...f, over5Employees: v }))} /><span>5인 이상</span></label>
                  <label className="flex items-center gap-1.5 cursor-pointer"><Switch checked={form.nightShiftConsent} onCheckedChange={v => setForm(f => ({ ...f, nightShiftConsent: v }))} /><span>야간 동의</span></label>
                </div>
              </div>
            )}

            {/* 3단계: 특약사항 */}
            {step === 3 && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground font-medium">담당업무 및 특약사항</p>
                <div><Label className="text-xs">근무 장소</Label><Input className="h-8 text-sm mt-1" value={form.workPlace} onChange={e => setForm(f => ({ ...f, workPlace: e.target.value }))} /></div>
                <div><Label className="text-xs">담당 업무</Label><Input className="h-8 text-sm mt-1" value={form.jobDescription} onChange={e => setForm(f => ({ ...f, jobDescription: e.target.value }))} /></div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs">특약사항</Label>
                    <Button variant="ghost" size="sm" className="h-6 text-xs text-blue-400" onClick={() => setForm(f => ({ ...f, specialTerms: BASIC_SPECIAL_TERMS }))}>
                      기본 특약 불러오기
                    </Button>
                  </div>
                  <textarea
                    className="w-full h-32 rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                    value={form.specialTerms}
                    onChange={e => setForm(f => ({ ...f, specialTerms: e.target.value }))}
                    placeholder="특약사항을 입력하세요..."
                  />
                </div>
              </div>
            )}

            <DialogFooter className="gap-2">
              {step > 1 && <Button variant="outline" size="sm" onClick={() => setStep(s => s - 1)}>이전</Button>}
              <Button variant="outline" size="sm" onClick={handleClose}>취소</Button>
              {step < 3
                ? <Button size="sm" onClick={() => setStep(s => s + 1)}>다음</Button>
                : <Button size="sm" className="gap-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={handleSave} disabled={createMutation.isPending}>
                    <FileText className="h-3.5 w-3.5" /> 계약서 저장 및 미리보기
                  </Button>
              }
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function StaffPage() {
  const { selectedRestaurantId } = useRestaurant();
  const rId = selectedRestaurantId;
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "master";
  const isManager = user?.role === "manager" || isAdmin;
  const storeRoleQuery = trpc.restaurants.getMyStoreRole.useQuery(
    { restaurantId: rId! },
    { enabled: !!rId && !!user && !isAdmin }
  );
  const storeRole = isAdmin ? "store_manager" : (storeRoleQuery.data ?? null);
  const isLeader = isAdmin || storeRole === "store_manager";
  const utils = trpc.useUtils();

  // ── 쿼리 ──────────────────────────────────────────────────────────────────
  const staffQuery = trpc.restaurants.getStaff.useQuery(
    { restaurantId: rId! },
    { enabled: !!rId }
  );
  const allUsersQuery = trpc.users.list.useQuery(
    undefined,
    { enabled: !!user && isAdmin }
  );
  // 점장용: 매장 소속 직원 목록 (기존 계정 추가 시 사용)
  const restaurantUsersQuery = trpc.users.listByRestaurant.useQuery(
    { restaurantId: rId! },
    { enabled: !!rId && isManager && !isAdmin }
  );
  const ecContractsQuery = trpc.electronicContracts.list.useQuery(
    { restaurantId: rId! },
    { enabled: !!rId }
  );
  const restaurantQuery = trpc.restaurants.listMine.useQuery(
    undefined,
    { enabled: !!user && !isAdmin }
  );
  const restaurantAdminQuery = trpc.restaurants.listAll.useQuery(
    { withStats: false },
    { enabled: !!user && isAdmin }
  );
  const restaurantList = (isAdmin ? (restaurantAdminQuery.data ?? []) : (restaurantQuery.data ?? [])) as Array<{ id: number; name: string }>;
  const currentRestaurant = restaurantList.find(r => r.id === rId);

  // ── 상태 ──────────────────────────────────────────────────────────────────
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [addForm, setAddForm] = useState({ userId: "", role: "employee" as "store_manager" | "manager" | "employee" });
  const [createForm, setCreateForm] = useState({ username: "", password: "", name: "", phone: "", restaurantRole: "employee" as "store_manager" | "manager" | "employee" });
  const [previewContractId, setPreviewContractId] = useState<number | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardPrefill, setWizardPrefill] = useState<{ name?: string; phone?: string }>({});
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);
  const [searchName, setSearchName] = useState("");
  const [activeTab, setActiveTab] = useState("staff");
  // 아이디/비밀번호 수정
  const [credStaff, setCredStaff] = useState<{ id: number; name: string; username: string } | null>(null);
  const [credForm, setCredForm] = useState({ username: "", password: "", confirmPassword: "" });
  // 계약 갱신 다이얼로그
  const [renewContractId, setRenewContractId] = useState<number | null>(null);
  const [renewForm, setRenewForm] = useState({
    newContractStart: todayKST(),
    newContractEnd: "",
    newWageAmount: "",
    newContractType: "" as "" | "permanent" | "fixed_term" | "part_time" | "daily",
  });

  // ── 미리보기 쿼리 ─────────────────────────────────────────────────────────
  const previewQuery = trpc.electronicContracts.getHtml.useQuery(
    { contractId: previewContractId ?? 0, restaurantName: currentRestaurant?.name ?? "" },
    { enabled: !!previewContractId && !!currentRestaurant }
  );

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createUserMutation = trpc.users.create.useMutation({
    onSuccess: () => {
      utils.restaurants.getStaff.invalidate();
      setShowCreateUser(false);
      setCreateForm({ username: "", password: "", name: "", phone: "", restaurantRole: "employee" });
      toast.success("직원 계정이 생성되고 매장에 추가되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });
  const updateStaffRoleMutation = trpc.restaurants.updateStaffRole.useMutation({
    onSuccess: () => { utils.restaurants.getStaff.invalidate(); toast.success("역할이 변경되었습니다."); },
    onError: (e) => toast.error(e.message),
  });
  const addStaffMutation = trpc.restaurants.addStaff.useMutation({
    onSuccess: () => {
      utils.restaurants.getStaff.invalidate();
      setShowAddStaff(false);
      setAddForm({ userId: "", role: "employee" });
      toast.success("직원이 추가되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });
  const removeStaffMutation = trpc.restaurants.removeStaff.useMutation({
    onSuccess: () => { utils.restaurants.getStaff.invalidate(); toast.success("직원이 제거되었습니다."); },
    onError: (e) => toast.error(e.message),
  });
  const sendMutation = trpc.electronicContracts.send.useMutation({
    onSuccess: (data) => {
      utils.electronicContracts.list.invalidate();
      const signUrl = `${window.location.origin}/contract/sign/${data.token}`;
      navigator.clipboard.writeText(signUrl).catch(() => {});
      toast.success("서명 링크가 클립보드에 복사되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });
  const renewMutation = trpc.electronicContracts.renew.useMutation({
    onSuccess: (data) => {
      utils.electronicContracts.list.invalidate();
      const signUrl = `${window.location.origin}/contract/sign/${data.token}`;
      navigator.clipboard.writeText(signUrl).catch(() => {});
      toast.success("갱신 계약서가 생성되었습니다. 서명 링크가 클립보드에 복사되었습니다.");
      setRenewContractId(null);
      setRenewForm({ newContractStart: todayKST(), newContractEnd: "", newWageAmount: "", newContractType: "" });
    },
    onError: (e) => toast.error(e.message),
  });
  const updateCredentialsMutation = trpc.users.updateCredentials.useMutation({
    onSuccess: () => {
      utils.restaurants.getStaff.invalidate();
      setCredStaff(null);
      setCredForm({ username: "", password: "", confirmPassword: "" });
      toast.success("계정 정보가 수정되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });
  const handleCredSave = () => {
    if (!credStaff || !rId) return;
    if (!credForm.username && !credForm.password) { toast.error("아이디 또는 비밀번호 중 하나 이상 입력하세요."); return; }
    if (credForm.password && credForm.password !== credForm.confirmPassword) { toast.error("비밀번호가 일치하지 않습니다."); return; }
    if (credForm.password && credForm.password.length < 4) { toast.error("비밀번호는 4자 이상이어야 합니다."); return; }
    updateCredentialsMutation.mutate({
      userId: credStaff.id,
      restaurantId: rId,
      ...(credForm.username ? { username: credForm.username } : {}),
      ...(credForm.password ? { password: credForm.password } : {}),
    });
  };

  const staff = staffQuery.data ?? [];
  const allUsers = allUsersQuery.data ?? [];
  const ecContracts = ecContractsQuery.data ?? [];
  const nonStaffUsers = allUsers.filter((u: any) => !staff.some((s: any) => s.id === u.id));

  // 직원별 최신 전자계약서 매핑 (이름 기준)
  const contractsByName = useMemo(() => {
    const map = new Map<string, EcContract[]>();
    for (const c of ecContracts as EcContract[]) {
      if (!map.has(c.employeeName)) map.set(c.employeeName, []);
      map.get(c.employeeName)!.push(c);
    }
    // 각 직원별로 최신 순 정렬
    map.forEach((v: EcContract[], k: string) => {
      map.set(k, v.sort((a: EcContract, b: EcContract) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    });
    return map;
  }, [ecContracts]);

  // 계약 이력 탭 — 이름 기준 그룹핑
  const grouped = useMemo(() => {
    const filtered = searchName
      ? (ecContracts as EcContract[]).filter(c => c.employeeName.includes(searchName))
      : (ecContracts as EcContract[]);
    const map = new Map<string, EcContract[]>();
    for (const c of filtered) {
      if (!map.has(c.employeeName)) map.set(c.employeeName, []);
      map.get(c.employeeName)!.push(c);
    }
    return Array.from(map.entries()).map(([name, list]) => {
      const sorted = list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return {
        name,
        phone: sorted[0]?.employeePhone ?? "—",
        contracts: sorted,
        latestStatus: sorted[0]?.status ?? "draft",
      };
    });
  }, [ecContracts, searchName]);

  const roleLabel = (role: string) => {
    const map: Record<string, string> = { store_manager: "점장", manager: "매니저", employee: "직원", admin: "관리자", master: "마스터" };
    return map[role] ?? role;
  };
  const roleColor = (role: string) => {
    const map: Record<string, string> = {
      store_manager: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
      manager:  "bg-blue-500/20 text-blue-300 border-blue-500/30",
      employee: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
      admin:    "bg-purple-500/20 text-purple-300 border-purple-500/30",
      master:   "bg-red-500/20 text-red-300 border-red-500/30",
    };
    return map[role] ?? "bg-zinc-700/60 text-zinc-300 border-zinc-600/40";
  };

  return (
    <AppLayout title="직원 관리" subtitle="매장 직원 및 계약 관리">
      <div className="p-4 lg:p-6 space-y-4 max-w-4xl mx-auto">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <TabsList className="h-9">
              <TabsTrigger value="staff" className="text-xs gap-1.5">
                <Users className="h-3.5 w-3.5" /> 직원 목록
                {staff.length > 0 && (
                  <span className="ml-1 text-xs bg-muted rounded-full px-1.5">{staff.length}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="contracts" className="text-xs gap-1.5">
                <FileText className="h-3.5 w-3.5" /> 계약 이력
                {ecContracts.length > 0 && (
                  <span className="ml-1 text-xs bg-muted rounded-full px-1.5">{ecContracts.length}</span>
                )}
              </TabsTrigger>

            </TabsList>
            <div className="flex gap-2">
              <Button size="sm" className="gap-1.5 h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => { setWizardPrefill({}); setShowWizard(true); }}>
                <Plus className="h-3.5 w-3.5" /> 계약서 작성
              </Button>
              {isManager && (
                <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs"
                  onClick={() => setShowCreateUser(true)}>
                  <UserPlus className="h-3.5 w-3.5" /> 신규 계정 생성
                </Button>
              )}

            </div>
          </div>

          {/* ── 직원 목록 탭 ─────────────────────────────────────────────────── */}
          <TabsContent value="staff" className="mt-4">
            {!rId && (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">매장을 선택하면 직원 목록이 표시됩니다.</p>
              </div>
            )}
            {rId && staffQuery.isLoading && (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin mr-2" /> 불러오는 중...
              </div>
            )}
            {rId && !staffQuery.isLoading && staff.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">등록된 직원이 없습니다.</p>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {staff.map((s: any) => {
                const staffContracts = contractsByName.get(s.name ?? s.username) ?? [];
                const latestContract = staffContracts[0] ?? null;
                const hasSignedContract = staffContracts.some(c => c.status === "signed");
                const hasDraftContract = staffContracts.some(c => c.status === "draft");
                const hasSentContract = staffContracts.some(c => c.status === "sent");
                return (
                  <Card key={s.id} className="border-border/60 hover:border-border transition-colors">
                    <CardContent className="p-4 space-y-3">
                      {/* 직원 헤더 */}
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center text-sm font-bold text-blue-300 flex-shrink-0">
                            {(s.name ?? s.username)[0]}
                          </div>
                          <div>
                            <p className="font-semibold text-sm">{s.name ?? s.username}</p>
                            <p className="text-xs text-muted-foreground">@{s.username}</p>
                          </div>
                        </div>
                        <Badge className={`text-xs border ${roleColor(s.restaurantRole ?? s.role)}`}>
                          {roleLabel(s.restaurantRole ?? s.role)}
                        </Badge>
                      </div>

                      {/* 요약 계약정보 (읽기 전용) */}
                      {latestContract ? (
                        <div className="rounded-lg bg-muted/30 border border-border/40 p-3 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-foreground/80">계약 요약</span>
                            {statusBadge(latestContract.status)}
                          </div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                            <div><span className="text-muted-foreground">직책 </span><span className="text-foreground">{latestContract.position || "—"}</span></div>
                            <div><span className="text-muted-foreground">급여 </span><span className="text-foreground">{fmtWage(latestContract.wageType, latestContract.wageAmount)}</span></div>
                            <div><span className="text-muted-foreground">시작 </span><span className="text-foreground">{fmtDate(latestContract.contractStart)}</span></div>
                            <div><span className="text-muted-foreground">종료 </span><span className="text-foreground">{latestContract.contractEnd ? fmtDate(latestContract.contractEnd) : "무기한"}</span></div>
                          </div>
                          {latestContract.contractEnd && (
                            <div className="text-right">{dDayBadge(latestContract.contractEnd)}</div>
                          )}
                          <p className="text-xs text-muted-foreground/50 italic">※ 요약 정보는 직접 수정 불가. 새 계약서를 작성하세요.</p>
                        </div>
                      ) : (
                        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
                          <p className="text-xs text-amber-400 flex items-center gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                            계약 정보 미등록. 전자계약서를 작성하고 서명을 요청하세요.
                          </p>
                        </div>
                      )}

                      {/* 액션 버튼 */}
                      <div className="flex gap-2 flex-wrap">
                        {latestContract && (
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1 flex-1"
                            onClick={() => setPreviewContractId(latestContract.id)}>
                            <Eye className="h-3 w-3" /> 계약서 열람
                          </Button>
                        )}
                        {/* 계약 없거나 서명 완료된 경우 → 새 계약서 작성 */}
                        {(!latestContract || hasSignedContract) && !hasDraftContract && !hasSentContract && (
                          <Button size="sm" className="h-7 text-xs gap-1 flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                            onClick={() => {
                              setWizardPrefill({ name: s.name ?? s.username, phone: s.phone ?? "" });
                              setShowWizard(true);
                            }}>
                            <Send className="h-3 w-3" /> 전자서명 발송
                          </Button>
                        )}
                        {/* 초안 상태 → 서명 링크 발송 */}
                        {hasDraftContract && latestContract?.status === "draft" && (
                          <Button size="sm" className="h-7 text-xs gap-1 flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                            onClick={() => sendMutation.mutate({ contractId: latestContract.id })}
                            disabled={sendMutation.isPending}>
                            <Send className="h-3 w-3" /> 서명 링크 발송
                          </Button>
                        )}
                        {/* 발송됨 → 대기 중 표시 */}
                        {hasSentContract && latestContract?.status === "sent" && (
                          <span className="inline-flex items-center gap-1 text-xs text-blue-400 px-2">
                            <Clock className="h-3 w-3" /> 서명 대기 중
                          </span>
                        )}
                        {/* 역할 승격/강등 버튼 (점장/리더 이상) */}
                        {/* employee → manager 승격 */}
                        {isManager && s.restaurantRole === "employee" && s.id !== user?.id && (
                          <Button variant="outline" size="sm"
                            className="h-7 text-xs gap-1 border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                            onClick={() => {
                              if (confirm(`${s.name ?? s.username}을(를) 매니저로 승격하시겠습니까?`))
                                updateStaffRoleMutation.mutate({ restaurantId: rId!, userId: s.id, role: "manager" });
                            }}
                            disabled={updateStaffRoleMutation.isPending}>
                            <ShieldCheck className="h-3 w-3" /> 매니저 승격
                          </Button>
                        )}
                        {/* manager → employee 강등 */}
                        {isManager && s.restaurantRole === "manager" && s.id !== user?.id && (
                          <Button variant="outline" size="sm"
                            className="h-7 text-xs gap-1 border-zinc-500/30 text-zinc-400 hover:bg-zinc-500/10"
                            onClick={() => {
                              if (confirm(`${s.name ?? s.username}의 역할을 직원으로 변경하시겠습니까?`))
                                updateStaffRoleMutation.mutate({ restaurantId: rId!, userId: s.id, role: "employee" });
                            }}
                            disabled={updateStaffRoleMutation.isPending}>
                            <ShieldCheck className="h-3 w-3" /> 직원으로 변경
                          </Button>
                        )}
                        {/* manager → leader 승격 (admin/master만 가능) */}
                        {isAdmin && s.restaurantRole === "manager" && s.id !== user?.id && (
                          <Button variant="outline" size="sm"
                            className="h-7 text-xs gap-1 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10"
                            onClick={() => {
                              if (confirm(`${s.name ?? s.username}을(를) 점장으로 승격하시겠습니까?`))
                                updateStaffRoleMutation.mutate({ restaurantId: rId!, userId: s.id, role: "store_manager" });
                            }}
                            disabled={updateStaffRoleMutation.isPending}>
                            <ShieldCheck className="h-3 w-3" /> 점장 승격
                          </Button>
                        )}
                        {/* leader → manager 강등 (admin/master만 가능) */}
                        {isAdmin && s.restaurantRole === "store_manager" && s.id !== user?.id && (
                          <Button variant="outline" size="sm"
                            className="h-7 text-xs gap-1 border-zinc-500/30 text-zinc-400 hover:bg-zinc-500/10"
                            onClick={() => {
                              if (confirm(`${s.name ?? s.username}의 역할을 매니저로 변경하시겠습니까?`))
                                updateStaffRoleMutation.mutate({ restaurantId: rId!, userId: s.id, role: "manager" });
                            }}
                            disabled={updateStaffRoleMutation.isPending}>
                            <ShieldCheck className="h-3 w-3" /> 매니저로 변경
                          </Button>
                        )}
                        {isManager && (
                          <Button variant="outline" size="sm"
                            className="h-7 text-xs gap-1 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                            title="아이디/비밀번호 수정"
                            onClick={() => {
                              setCredStaff({ id: s.id, name: s.name ?? s.username, username: s.username ?? "" });
                              setCredForm({ username: s.username ?? "", password: "", confirmPassword: "" });
                            }}>
                            <KeyRound className="h-3 w-3" />
                          </Button>
                        )}
                        <Button variant="outline" size="sm"
                          className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/5"
                          onClick={() => {
                            if (confirm(`${s.name ?? s.username}을(를) 매장에서 제거하시겠습니까?`))
                              removeStaffMutation.mutate({ restaurantId: rId!, userId: s.id });
                          }}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* ── 계약 이력 탭 ─────────────────────────────────────────────────── */}
          <TabsContent value="contracts" className="mt-4 space-y-4">
            {/* 검색 */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="직원 이름으로 검색..."
                value={searchName}
                onChange={e => setSearchName(e.target.value)}
                className="pl-8 h-9 text-sm"
              />
            </div>

            {!rId && (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">매장을 선택하면 계약 이력이 표시됩니다.</p>
              </div>
            )}
            {rId && ecContractsQuery.isLoading && (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin mr-2" /> 불러오는 중...
              </div>
            )}
            {rId && !ecContractsQuery.isLoading && grouped.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">
                  {searchName ? `"${searchName}"에 해당하는 계약서가 없습니다.` : "등록된 계약서가 없습니다."}
                </p>
              </div>
            )}
            {grouped.map(({ name, phone, contracts: empContracts, latestStatus }) => {
              const isExpanded = expandedEmployee === name;
              const signedCount = empContracts.filter(c => c.status === "signed").length;
              const probationCount = empContracts.filter(c => {
                const dur = c.contractEnd
                  ? Math.round((new Date(c.contractEnd).getTime() - new Date(c.contractStart).getTime()) / (1000 * 60 * 60 * 24 * 30))
                  : null;
                return c.contractType === "fixed_term" && dur !== null && dur <= 3;
              }).length;
              return (
                <div key={name} className="rounded-xl border border-border/60 bg-card overflow-hidden">
                  <button
                    onClick={() => setExpandedEmployee(isExpanded ? null : name)}
                    className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-muted/20 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center text-sm font-bold text-blue-300">
                        {name[0]}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{name}</span>
                          {statusBadge(latestStatus)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {phone} · 계약 {empContracts.length}건
                          {probationCount > 0 && ` · 수습 ${probationCount}건`}
                          {signedCount > 0 && ` · 서명완료 ${signedCount}건`}
                        </p>
                      </div>
                    </div>
                    {isExpanded
                      ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-border/30 pt-3 space-y-3">
                      {/* 타임라인 요약 */}
                      <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground mb-2">
                        {empContracts.slice().reverse().map((c, i) => {
                          const dur = c.contractEnd
                            ? Math.round((new Date(c.contractEnd).getTime() - new Date(c.contractStart).getTime()) / (1000 * 60 * 60 * 24 * 30))
                            : null;
                          const isProb = c.contractType === "fixed_term" && dur !== null && dur <= 3;
                          return (
                            <span key={c.id} className="flex items-center gap-1">
                              {i > 0 && <ArrowRight className="h-3 w-3" />}
                              <span className={`px-1.5 py-0.5 rounded ${isProb ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"}`}>
                                {isProb ? "수습" : contractTypeLabel(c.contractType)}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                      <div className="space-y-2">
                        {empContracts.map((c, i) => (
                          <ContractCard
                            key={c.id}
                            c={c}
                            restaurantName={currentRestaurant?.name ?? ""}
                            isFirst={i === 0}
                            onPreview={setPreviewContractId}
                            onSend={id => sendMutation.mutate({ contractId: id })}
                            onRenew={isManager ? (id) => {
                              const contract = empContracts.find(c => c.id === id);
                              if (contract) {
                                const newWage = parseFloat(String(contract.wageAmount));
                                setRenewForm({
                                  newContractStart: todayKST(),
                                  newContractEnd: "",
                                  newWageAmount: isNaN(newWage) ? "" : String(newWage),
                                  newContractType: contract.contractType as "permanent" | "fixed_term" | "part_time" | "daily",
                                });
                              }
                              setRenewContractId(id);
                            } : undefined}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </TabsContent>

        </Tabs>
        {/* ── 아이디/비밀번호 수정 다이얼로그그 ─────────────────────────────────── */}
        <Dialog open={!!credStaff} onOpenChange={v => { if (!v) { setCredStaff(null); setCredForm({ username: "", password: "", confirmPassword: "" }); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-amber-400" />
                계정 정보 수정 — {credStaff?.name}
              </DialogTitle>
              <DialogDescription>아이디 또는 비밀번호를 변경할 수 있습니다.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">아이디</Label>
                <Input
                  value={credForm.username}
                  onChange={e => setCredForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="새 아이디 입력"
                  className="mt-1 h-9"
                />
              </div>
              <div>
                <Label className="text-xs">새 비밀번호 (변경 시에만 입력)</Label>
                <Input
                  type="password"
                  value={credForm.password}
                  onChange={e => setCredForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="4자 이상"
                  className="mt-1 h-9"
                />
              </div>
              <div>
                <Label className="text-xs">비밀번호 확인</Label>
                <Input
                  type="password"
                  value={credForm.confirmPassword}
                  onChange={e => setCredForm(f => ({ ...f, confirmPassword: e.target.value }))}
                  placeholder="비밀번호 재입력"
                  className="mt-1 h-9"
                />
                {credForm.password && credForm.confirmPassword && credForm.password !== credForm.confirmPassword && (
                  <p className="text-xs text-destructive mt-1">비밀번호가 일치하지 않습니다.</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">비밀번호를 변경하지 않으려면 비밀번호 칸을 비워두세요.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => { setCredStaff(null); setCredForm({ username: "", password: "", confirmPassword: "" }); }}>취소</Button>
              <Button size="sm" onClick={handleCredSave} disabled={updateCredentialsMutation.isPending}>
                {updateCredentialsMutation.isPending ? "저장 중..." : "저장"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── 계약서 미리보기 다이얼로그 ───────────────────────────────────────── */}
        <Dialog open={!!previewContractId} onOpenChange={v => { if (!v) setPreviewContractId(null); }}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Eye className="h-4 w-4" /> 계약서 열람
              </DialogTitle>
            </DialogHeader>
            {previewQuery.isLoading && <p className="text-center py-8 text-muted-foreground">로딩 중...</p>}
            {previewQuery.data?.html && (
              <div className="border border-border rounded-lg overflow-hidden"
                dangerouslySetInnerHTML={{ __html: previewQuery.data.html }} />
            )}
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setPreviewContractId(null)}>닫기</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>



        {/* ── 신규 직원 계정 생성 다이얼로그 ───────────────────────────────────── */}
        <Dialog open={showCreateUser} onOpenChange={setShowCreateUser}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>신규 직원 계정 생성</DialogTitle>
              <DialogDescription>새 직원 계정을 만들고 현재 매장에 자동으로 추가합니다.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">이름 *</Label>
                <Input className="mt-1 h-9 text-sm" placeholder="홍길동" value={createForm.name}
                  onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">아이디 *</Label>
                <Input className="mt-1 h-9 text-sm" placeholder="hong123" value={createForm.username}
                  onChange={e => setCreateForm(f => ({ ...f, username: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">비밀번호 * (4자 이상)</Label>
                <Input className="mt-1 h-9 text-sm" type="password" placeholder="••••" value={createForm.password}
                  onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">전화번호</Label>
                <Input className="mt-1 h-9 text-sm" placeholder="010-0000-0000" value={createForm.phone}
                  onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">역할</Label>
                <Select value={createForm.restaurantRole} onValueChange={v => setCreateForm(f => ({ ...f, restaurantRole: v as any }))}>
                  <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">직원</SelectItem>
                    <SelectItem value="manager">매니저</SelectItem>
                    {isAdmin && <SelectItem value="store_manager">점장</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setShowCreateUser(false)}>취소</Button>
              <Button size="sm"
                onClick={() => createUserMutation.mutate({
                  username: createForm.username,
                  password: createForm.password,
                  name: createForm.name,
                  phone: createForm.phone || undefined,
                  role: "employee",
                  restaurantId: rId!,
                  restaurantRole: createForm.restaurantRole,
                })}
                disabled={createUserMutation.isPending || !createForm.username || !createForm.password || !createForm.name}>
                {createUserMutation.isPending ? "생성 중..." : "계정 생성"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── 전자계약서 작성 위자드 ────────────────────────────────────────────── */}
        {rId && (
          <ContractWizard
            open={showWizard}
            onClose={() => setShowWizard(false)}
            restaurantId={rId}
            restaurantName={currentRestaurant?.name ?? ""}
            prefillName={wizardPrefill.name}
            prefillPhone={wizardPrefill.phone}
          />
        )}
        {/* ── 계약 갱신 다이얼로그 ────────────────────────────────────────────── */}
        <Dialog open={!!renewContractId} onOpenChange={open => { if (!open) setRenewContractId(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-amber-400" />
                계약 갱신
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                기존 계약을 기반으로 새 계약서를 생성합니다. 서명 링크가 자동 복사됩니다.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs">새 계약 시작일 *</Label>
                <Input
                  type="date"
                  value={renewForm.newContractStart}
                  onChange={e => setRenewForm(f => ({ ...f, newContractStart: e.target.value }))}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">새 계약 종료일 (선택)</Label>
                <Input
                  type="date"
                  value={renewForm.newContractEnd}
                  onChange={e => setRenewForm(f => ({ ...f, newContractEnd: e.target.value }))}
                  className="h-8 text-xs"
                  placeholder="무기한 계약이면 비워두세요"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">계약 유형</Label>
                <Select
                  value={renewForm.newContractType}
                  onValueChange={v => setRenewForm(f => ({ ...f, newContractType: v as "permanent" | "fixed_term" | "part_time" | "daily" }))}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="기존과 동일" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="permanent">정규직</SelectItem>
                    <SelectItem value="fixed_term">기간제</SelectItem>
                    <SelectItem value="part_time">단시간</SelectItem>
                    <SelectItem value="daily">일용직</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">새 급여 (선택, 비워두면 기존 유지)</Label>
                <Input
                  type="number"
                  value={renewForm.newWageAmount}
                  onChange={e => setRenewForm(f => ({ ...f, newWageAmount: e.target.value }))}
                  className="h-8 text-xs"
                  placeholder="예: 10320 (시급) 또는 2500000 (월급)"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setRenewContractId(null)}>취소</Button>
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white gap-1"
                disabled={!renewForm.newContractStart || renewMutation.isPending}
                onClick={() => {
                  if (!renewContractId) return;
                  renewMutation.mutate({
                    contractId: renewContractId,
                    newContractStart: renewForm.newContractStart,
                    newContractEnd: renewForm.newContractEnd || undefined,
                    newWageAmount: renewForm.newWageAmount ? Number(renewForm.newWageAmount) : undefined,
                    newContractType: renewForm.newContractType || undefined,
                  });
                }}
              >
                <RefreshCw className="h-3 w-3" />
                {renewMutation.isPending ? "갱신 중..." : "계약 갱신 및 서명 요청"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
