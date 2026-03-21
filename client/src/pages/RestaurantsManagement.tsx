import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { todayKST } from "@/lib/dateKST";
import { useAuth } from "@/_core/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Plus, Pencil, Store, MapPin, Phone, Target, Users, TrendingUp,
  DollarSign, ShoppingCart, FileText, RefreshCw, Trash2, Building2,
  CheckCircle, AlertTriangle, BarChart3, Send, Eye, PenLine, Clock, XCircle,
  Download, Share2, MessageCircle, Copy, Calendar, ArrowRight, History, TimerOff
} from "lucide-react";
import { cn } from "@/lib/utils";
import StoreOperationsTab from "@/components/StoreOperationsTab";

function fmt(n: number) { return n.toLocaleString("ko-KR") + "원"; }
function pct(n: number) { return n.toFixed(1) + "%"; }

const CONTRACT_TYPE_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  rent:       { label: "임대료",      color: "bg-blue-500/20 text-blue-400 border border-blue-500/30",      icon: "🏠" },
  commission: { label: "임대 수수료", color: "bg-purple-500/20 text-purple-400 border border-purple-500/30", icon: "💼" },
  royalty:    { label: "본사 로얄티", color: "bg-orange-500/20 text-orange-400 border border-orange-500/30", icon: "👑" },
  investor:   { label: "투자자 지분", color: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30", icon: "📈" },
  other:      { label: "기타",        color: "bg-slate-500/20 text-slate-400 border border-slate-500/30",    icon: "📋" },
};

const CALC_TYPE_LABELS: Record<string, string> = { fixed: "고정 금액", ratio: "매출 비율 (%)" };

type RestaurantWithStats = {
  id: number;
  name: string;
  address?: string | null;
  phone?: string | null;
  monthlyTargetSales?: string | null;
  targetLaborRatio?: string | null;
  targetCostRatio?: string | null;
  stats?: {
    salesTotal: number; purchasesTotal: number; fixedCostsTotal: number;
    laborCost: number; totalCost: number; profit: number; costRatio: number;
    salesAchievement: number; contractCount: number; year: number; month: number;
  } | null;
};

type Contract = {
  id: number; restaurantId: number;
  contractType: "rent" | "commission" | "royalty" | "investor" | "other";
  name: string; calcType: "fixed" | "ratio";
  fixedAmount: string | null; ratioPercent: string | null;
  startDate: string | null; endDate: string | null;
  note: string | null; autoApplyToFixedCost: boolean; isActive: boolean;
};

const emptyContractForm = {
  contractType: "rent" as Contract["contractType"],
  name: "", calcType: "fixed" as "fixed" | "ratio",
  fixedAmount: "", ratioPercent: "",
  startDate: "", endDate: "", note: "", autoApplyToFixedCost: true,
};

export default function RestaurantsManagement() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "master";

  // ── 매장 목록 (실적 포함) ────────────────────────────────────────────────
  const listAllQuery = trpc.restaurants.listAll.useQuery(
    { withStats: true },
    { enabled: isAdmin }
  );
  const listMineQuery = trpc.restaurants.listMine.useQuery(
    undefined,
    { enabled: !isAdmin }
  );
  const restaurantsQuery = isAdmin ? listAllQuery : listMineQuery;
  const usersQuery = trpc.users.list.useQuery(undefined, { enabled: isAdmin });
  const restaurants = (restaurantsQuery.data ?? []) as RestaurantWithStats[];

  // ── 다이얼로그 상태 ─────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [editRestaurant, setEditRestaurant] = useState<RestaurantWithStats | null>(null);
  const [editTab, setEditTab] = useState("info");

  // ── 매장 생성 폼 ────────────────────────────────────────────────────────
  const [createForm, setCreateForm] = useState({
    name: "", address: "", phone: "",
    monthlyTargetSales: "", targetLaborRatio: "30", targetCostRatio: "80",
  });
  // ── 매장 수정 폼 ─────────────────────────────────────────────────────────────
  const [editForm, setEditForm] = useState({
    name: "", address: "", phone: "",
    monthlyTargetSales: "", targetLaborRatio: "30", targetCostRatio: "80",
    salesInputStartTime: "", salesInputEndTime: "",
  });
  const [showDeletedRestaurants, setShowDeletedRestaurants] = useState(false);// ── 계약 조건 상태 ──────────────────────────────────────────────────────
  const [contractForm, setContractForm] = useState(emptyContractForm);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [showContractForm, setShowContractForm] = useState(false);

  const contractsQuery = trpc.restaurantContracts.list.useQuery(
    { restaurantId: editRestaurant?.id ?? 0 },
    { enabled: !!editRestaurant && editTab === "contracts" }
  );
  const currentMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);
  const contractCostsQuery = trpc.restaurantContracts.applyToFixedCosts.useQuery(
    { restaurantId: editRestaurant?.id ?? 0, effectiveMonth: currentMonth },
    { enabled: !!editRestaurant && editTab === "contracts" }
  );

   // ── 휴무일 설정 상태 ────────────────────────────────────────
  const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
  const weeklyClosuresQuery = trpc.storeClosures.getWeekly.useQuery(
    { restaurantId: editRestaurant?.id ?? 0 },
    { enabled: !!editRestaurant && editTab === "closures" }
  );
  const setWeeklyMutation = trpc.storeClosures.setWeekly.useMutation({
    onSuccess: () => { weeklyClosuresQuery.refetch(); toast.success("정기 휴무 요일이 저장되었습니다."); },
    onError: (e) => toast.error(e.message),
  });
  const activeWeekdays = (weeklyClosuresQuery.data ?? []).filter((w: any) => w.isClosed).map((w: any) => w.weekday);
  const toggleWeekday = (day: number) => {
    if (!editRestaurant?.id) return;
    const next = activeWeekdays.includes(day)
      ? activeWeekdays.filter((d: number) => d !== day)
      : [...activeWeekdays, day];
    setWeeklyMutation.mutate({ restaurantId: editRestaurant.id, weekdays: next });
  };
  const closureNow = new Date();
  const [closureYear, setClosureYear] = useState(closureNow.getFullYear());
  const [closureMonth, setClosureMonth] = useState(closureNow.getMonth() + 1);
  const [newClosedDate, setNewClosedDate] = useState("");
  const [newClosedReason, setNewClosedReason] = useState("");
  const closedDaysQuery = trpc.storeClosures.getSpecial.useQuery(
    { restaurantId: editRestaurant?.id ?? 0, year: closureYear, month: closureMonth },
    { enabled: !!editRestaurant && editTab === "closures" }
  );
  const addClosedDayMutation = trpc.storeClosures.addSpecial.useMutation({
    onSuccess: () => { closedDaysQuery.refetch(); setNewClosedDate(""); setNewClosedReason(""); toast.success("휴무일이 등록되었습니다."); },
    onError: (e) => toast.error(e.message),
  });
  const removeClosedDayMutation = trpc.storeClosures.removeSpecial.useMutation({
    onSuccess: () => { closedDaysQuery.refetch(); toast.success("휴무일이 삭제되었습니다."); },
    onError: (e) => toast.error(e.message),
  });

  // ── 직원 관리 상태 ────────────────────────────────────────────
  const [addStaffForm, setAddStaffForm] = useState({ userId: "", role: "employee" as "manager" | "employee" });
  const staffQuery = trpc.restaurants.getStaff.useQuery(
    { restaurantId: editRestaurant?.id ?? 0 },
    { enabled: !!editRestaurant && editTab === "staff" }
  );

  // ── 전자계약 상태 ────────────────────────────────────────────────────────
  const [showContractWizard, setShowContractWizard] = useState(false);
  const [contractRestaurant, setContractRestaurant] = useState<RestaurantWithStats | null>(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [previewContractId, setPreviewContractId] = useState<number | null>(null);
  const minWageInfo = trpc.electronicContracts.getMinimumWageInfo.useQuery();
  const electronicContractsQuery = trpc.electronicContracts.list.useQuery(
    { restaurantId: editRestaurant?.id ?? 0 },
    { enabled: !!editRestaurant && editTab === "staff" }
  );
  const contractPreviewQuery = trpc.electronicContracts.getHtml.useQuery(
    { contractId: previewContractId ?? 0, restaurantName: editRestaurant?.name ?? "" },
    { enabled: !!previewContractId }
  );

  const today = useMemo(() => todayKST(), []);
  const [ecForm, setEcForm] = useState({
    employeeName: "", employeePhone: "", employeeBirthdate: "", employeeAddress: "",
    position: "직원", contractType: "part_time" as "permanent" | "fixed_term" | "part_time" | "daily",
    contractStart: today, contractEnd: "",
    hasProbation: false, probationMonths: 0,
    workPlace: "", jobDescription: "홀 서빙, 주방 보조 등 사용자 지시 업무",
    wageType: "hourly" as "hourly" | "monthly",
    wageAmount: "10320",
    weeklyHours: "40", workStartTime: "09:00", workEndTime: "18:00",
    breakMinutes: 60, weeklyHoliday: "일요일",
    payDay: 25, payMethod: "bank_transfer" as "bank_transfer" | "cash",
    mealProvided: false, mealAllowance: 0,
    socialInsurance: true, over5Employees: false, nightShiftConsent: false,
    specialTerms: "",
  });

  // ── Mutations ────────────────────────────────────────────────────────────
  const deleteRestaurantMutation = trpc.restaurants.delete.useMutation({
    onSuccess: () => { utils.restaurants.listAll.invalidate(); toast.success("매장이 삭제되었습니다. (1년간 보관)"); },
    onError: (e) => toast.error(e.message),
  });
  const restoreRestaurantMutation = trpc.restaurants.restore.useMutation({
    onSuccess: () => { utils.restaurants.listAll.invalidate(); toast.success("매장이 복원되었습니다."); },
    onError: (e) => toast.error(e.message),
  });
  const setSalesTimeMutation = trpc.restaurants.setSalesInputTime.useMutation({
    onSuccess: () => { utils.restaurants.listAll.invalidate(); toast.success("매출 입력 시간이 설정되었습니다."); },
    onError: (e) => toast.error(e.message),
  });
  const deletedRestaurantsQuery = trpc.restaurants.listDeleted.useQuery(
    undefined,
    { enabled: isAdmin && showDeletedRestaurants }
  );
  const createMutation = trpc.restaurants.create.useMutation({
    onSuccess: () => {
      utils.restaurants.listAll.invalidate();
      setShowCreate(false);
      setCreateForm({ name: "", address: "", phone: "", monthlyTargetSales: "", targetLaborRatio: "30", targetCostRatio: "80" });
      toast.success("매장이 생성되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.restaurants.update.useMutation({
    onSuccess: () => {
      utils.restaurants.listAll.invalidate();
      toast.success("매장 정보가 수정되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });

  const createContractMutation = trpc.restaurantContracts.create.useMutation({
    onSuccess: () => {
      utils.restaurantContracts.list.invalidate();
      utils.restaurantContracts.applyToFixedCosts.invalidate();
      utils.restaurants.listAll.invalidate();
      setShowContractForm(false);
      setContractForm(emptyContractForm);
      toast.success("계약 조건이 등록되었습니다. 고정비에 자동 반영되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateContractMutation = trpc.restaurantContracts.update.useMutation({
    onSuccess: () => {
      utils.restaurantContracts.list.invalidate();
      utils.restaurantContracts.applyToFixedCosts.invalidate();
      utils.restaurants.listAll.invalidate();
      setShowContractForm(false);
      setEditingContract(null);
      toast.success("계약 조건이 수정되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteContractMutation = trpc.restaurantContracts.delete.useMutation({
    onSuccess: () => {
      utils.restaurantContracts.list.invalidate();
      utils.restaurantContracts.applyToFixedCosts.invalidate();
      utils.restaurants.listAll.invalidate();
      toast.success("계약 조건이 삭제되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });

  const syncMutation = trpc.restaurantContracts.syncToFixedCosts.useMutation({
    onSuccess: (res) => {
      utils.restaurantContracts.applyToFixedCosts.invalidate();
      utils.restaurants.listAll.invalidate();
      toast.success(res.message);
    },
    onError: (e) => toast.error(e.message),
  });

  // ── 전자계약 Mutations ──────────────────────────────────────────────────────────
  const createEcMutation = trpc.electronicContracts.create.useMutation({
    onSuccess: (data) => {
      utils.electronicContracts.list.invalidate();
      setShowContractWizard(false);
      setWizardStep(1);
      toast.success("계약서 초안이 저장되었습니다.");
      // 저장 후 바로 발송 여부 확인
      if (data?.id) setPreviewContractId(data.id);
    },
    onError: (e) => toast.error(e.message),
  });
  const sendEcMutation = trpc.electronicContracts.send.useMutation({
    onSuccess: (data) => {
      utils.electronicContracts.list.invalidate();
      const link = `${window.location.origin}/contract/sign/${data.token}`;
      toast.success("계약서가 발송되었습니다.", { description: "서명 링크를 복사하여 직원에게 전달하세요." });
      navigator.clipboard.writeText(link).catch(() => {});
    },
    onError: (e) => toast.error(e.message),
  });
  const cancelEcMutation = trpc.electronicContracts.cancel.useMutation({
    onSuccess: () => { utils.electronicContracts.list.invalidate(); toast.success("계약서가 취소되었습니다."); },
    onError: (e) => toast.error(e.message),
  });

  // 계약 갱신 상태
  const [showRenewDialog, setShowRenewDialog] = useState(false);
  const [renewTargetContract, setRenewTargetContract] = useState<{ id: number; employeeName: string; isProbation: boolean } | null>(null);
  const [renewForm, setRenewForm] = useState({ newContractStart: "", newContractEnd: "", newWageAmount: "" });

  const renewMutation = trpc.electronicContracts.renew.useMutation({
    onSuccess: (data) => {
      utils.electronicContracts.list.invalidate();
      setShowRenewDialog(false);
      setRenewTargetContract(null);
      toast.success(data.message);
    },
    onError: (e) => toast.error(e.message),
  });

  const addStaffMutation = trpc.restaurants.addStaff.useMutation({
    onSuccess: () => { utils.restaurants.getStaff.invalidate(); setAddStaffForm({ userId: "", role: "employee" }); toast.success("직원이 추가되었습니다."); },
    onError: (e) => toast.error(e.message),
  });
  const removeStaffMutation = trpc.restaurants.removeStaff.useMutation({
    onSuccess: () => { utils.restaurants.getStaff.invalidate(); toast.success("직원이 제거되었습니다."); },
    onError: (e) => toast.error(e.message),
  });

  // ── 핸들러 ──────────────────────────────────────────────────────────────
  function openEdit(r: RestaurantWithStats) {
    setEditRestaurant(r);
    setEditForm({
      name: r.name,
      address: r.address ?? "",
      phone: r.phone ?? "",
      monthlyTargetSales: r.monthlyTargetSales ? String(parseFloat(r.monthlyTargetSales)) : "",
      targetLaborRatio: r.targetLaborRatio ? String(parseFloat(r.targetLaborRatio)) : "30",
      targetCostRatio: r.targetCostRatio ? String(parseFloat(r.targetCostRatio)) : "80",
      salesInputStartTime: (r as any).salesInputStartTime ?? "",
      salesInputEndTime: (r as any).salesInputEndTime ?? "",
    });
    setEditTab("info");
    setShowContractForm(false);
    setEditingContract(null);
  }

  function openContractEdit(c: Contract) {
    setEditingContract(c);
    setContractForm({
      contractType: c.contractType,
      name: c.name,
      calcType: c.calcType,
      fixedAmount: c.fixedAmount ?? "",
      ratioPercent: c.ratioPercent ?? "",
      startDate: c.startDate ? String(c.startDate).slice(0, 10) : "",
      endDate: c.endDate ? String(c.endDate).slice(0, 10) : "",
      note: c.note ?? "",
      autoApplyToFixedCost: c.autoApplyToFixedCost,
    });
    setShowContractForm(true);
  }

  function handleContractSubmit() {
    if (!contractForm.name.trim()) { toast.error("항목명을 입력해주세요."); return; }
    if (!editRestaurant) return;
    const payload = {
      restaurantId: editRestaurant.id,
      contractType: contractForm.contractType,
      name: contractForm.name,
      calcType: contractForm.calcType,
      fixedAmount: contractForm.calcType === "fixed" ? parseFloat(contractForm.fixedAmount) || 0 : 0,
      ratioPercent: contractForm.calcType === "ratio" ? parseFloat(contractForm.ratioPercent) || 0 : 0,
      startDate: contractForm.startDate || undefined,
      endDate: contractForm.endDate || undefined,
      note: contractForm.note || undefined,
      autoApplyToFixedCost: contractForm.autoApplyToFixedCost,
    };
    if (editingContract) {
      updateContractMutation.mutate({ id: editingContract.id, ...payload });
    } else {
      createContractMutation.mutate(payload);
    }
  }

  // ── 계약 유형별 합산 표시 ────────────────────────────────────────────────
  const contractsByType = useMemo(() => {
    const contracts = contractsQuery.data ?? [];
    const contractCosts = contractCostsQuery.data ?? [];
    const map: Record<string, { contracts: Contract[]; totalAmount: number }> = {};
    for (const c of contracts as Contract[]) {
      if (!map[c.contractType]) map[c.contractType] = { contracts: [], totalAmount: 0 };
      map[c.contractType].contracts.push(c);
      const cost = contractCosts.find(cc => cc.id === c.id);
      if (cost) map[c.contractType].totalAmount += cost.calculatedAmount;
      else if (c.calcType === "fixed") map[c.contractType].totalAmount += parseFloat(c.fixedAmount ?? "0");
    }
    return map;
  }, [contractsQuery.data, contractCostsQuery.data]);

  const totalContractCost = useMemo(() => {
    return (contractCostsQuery.data ?? []).reduce((s, c) => s + c.calculatedAmount, 0);
  }, [contractCostsQuery.data]);

  return (
    <AppLayout title="매장 관리" subtitle="전체 매장 등록 및 실적 현황">
      <div className="p-4 lg:p-6 space-y-4">
        <div className="flex justify-end gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowDeletedRestaurants(v => !v)}>
              <History className="h-4 w-4" /> {showDeletedRestaurants ? "삭제 목록 닫기" : "삭제된 매장"}
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> 매장 추가
            </Button>
          )}
        </div>
        {/* 삭제된 매장 목록 */}
        {isAdmin && showDeletedRestaurants && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-destructive flex items-center gap-2">
              <History className="h-4 w-4" /> 삭제된 매장 (1년 보관)
            </h3>
            {deletedRestaurantsQuery.isLoading && <p className="text-xs text-muted-foreground">불러오는 중...</p>}
            {(deletedRestaurantsQuery.data ?? []).length === 0 && !deletedRestaurantsQuery.isLoading && (
              <p className="text-xs text-muted-foreground">삭제된 매장이 없습니다.</p>
            )}
            {(deletedRestaurantsQuery.data ?? []).map((r: any) => (
              <div key={r.id} className="flex items-center justify-between bg-card rounded-lg p-3">
                <div>
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">삭제일: {new Date(r.deletedAt).toLocaleDateString("ko-KR")}</p>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                  onClick={() => { if (confirm(`"${r.name}" 매장을 복원하시겠습니까?`)) restoreRestaurantMutation.mutate({ id: r.id }); }}
                  disabled={restoreRestaurantMutation.isPending}>
                  복원
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* 매장 카드 목록 */}
        <div className={cn(
          "grid gap-4",
          isAdmin
            ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
            : restaurants.length === 1
              ? "grid-cols-1 max-w-2xl"
              : "grid-cols-1 md:grid-cols-2"
        )}>
          {restaurants.length === 0 ? (
            <div className="col-span-full text-center py-12 text-muted-foreground text-sm">등록된 매장이 없습니다</div>
          ) : restaurants.map(r => {
            const s = r.stats;
            const targetSales = parseFloat(r.monthlyTargetSales ?? "0");
            const targetCostRatio = parseFloat(r.targetCostRatio ?? "80");
            const targetLaborRatio = parseFloat(r.targetLaborRatio ?? "30");
            const achievement = s?.salesAchievement ?? 0;
            const achievementColor = achievement >= 100 ? "text-emerald-400" : achievement >= 80 ? "text-amber-400" : "text-red-400";
            const costOk = s ? s.costRatio <= targetCostRatio : true;
            const laborOk = s ? (s.salesTotal > 0 ? (s.laborCost / s.salesTotal) * 100 <= targetLaborRatio : true) : true;

            return (
              <Card key={r.id} className="hover:shadow-md transition-shadow border-border/60 cursor-pointer" onClick={() => openEdit(r)}>
                <CardContent className={cn("p-4", !isAdmin && restaurants.length === 1 && "p-6")}>
                  {/* 헤더 */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className={cn("bg-primary/15 rounded-xl flex items-center justify-center shrink-0", !isAdmin && restaurants.length === 1 ? "w-12 h-12" : "w-9 h-9")}>
                        <Store className={cn("text-primary", !isAdmin && restaurants.length === 1 ? "h-6 w-6" : "h-5 w-5")} />
                      </div>
                      <div>
                        <h3 className={cn("font-semibold", !isAdmin && restaurants.length === 1 ? "text-lg" : "text-sm")}>{r.name}</h3>
                        {r.address && (
                          <p className={cn("text-muted-foreground flex items-center gap-1", !isAdmin && restaurants.length === 1 ? "text-sm" : "text-xs")}>
                            <MapPin className="h-3 w-3" />{r.address}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => openEdit(r)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {isAdmin && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => { if (confirm(`"${r.name}" 매장을 삭제하시겠습니까?\n삭제된 데이터는 1년간 보관됩니다.`)) deleteRestaurantMutation.mutate({ id: r.id }); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* 이번 달 실적 */}
                  {s ? (
                    <div className="space-y-2 mb-3">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                        {s.year}년 {s.month}월 실적
                      </p>
                      {/* 매출 달성률 */}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <TrendingUp className="h-3 w-3" /> 매출
                        </span>
                        <div className="text-right">
                          <span className="font-semibold text-primary">{fmt(s.salesTotal)}</span>
                          {targetSales > 0 && (
                            <span className={cn("ml-1.5 font-bold", achievementColor)}>
                              {pct(achievement)}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* 목표 대비 진행 바 */}
                      {targetSales > 0 && (
                        <div className="w-full bg-muted/50 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={cn("h-full rounded-full transition-all", achievement >= 100 ? "bg-emerald-400" : achievement >= 80 ? "bg-amber-400" : "bg-red-400")}
                            style={{ width: `${Math.min(achievement, 100)}%` }}
                          />
                        </div>
                      )}
                      {/* 비용 구조 */}
                      <div className="grid grid-cols-3 gap-1 mt-1">
                        <div className="bg-muted/30 rounded-lg p-1.5 text-center">
                          <p className="text-[10px] text-muted-foreground">매입</p>
                          <p className="text-xs font-semibold text-amber-400">{(s.purchasesTotal / 10000).toFixed(0)}만</p>
                        </div>
                        <div className="bg-muted/30 rounded-lg p-1.5 text-center">
                          <p className="text-[10px] text-muted-foreground">고정비</p>
                          <p className="text-xs font-semibold text-orange-400">{(s.fixedCostsTotal / 10000).toFixed(0)}만</p>
                        </div>
                        <div className="bg-muted/30 rounded-lg p-1.5 text-center">
                          <p className="text-[10px] text-muted-foreground">인건비</p>
                          <p className="text-xs font-semibold text-purple-400">{(s.laborCost / 10000).toFixed(0)}만</p>
                        </div>
                      </div>
                      {/* 이익 & 비용율 */}
                      <div className="flex items-center justify-between text-xs pt-1 border-t border-border/40">
                        <span className={cn("font-bold", s.profit >= 0 ? "text-emerald-400" : "text-red-400")}>
                          순이익 {s.profit >= 0 ? "+" : ""}{fmt(s.profit)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {costOk
                            ? <CheckCircle className="h-3 w-3 text-emerald-400" />
                            : <AlertTriangle className="h-3 w-3 text-red-400" />}
                          <span className={cn("font-medium", costOk ? "text-emerald-400" : "text-red-400")}>
                            비용율 {pct(s.costRatio)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5 text-xs mb-3">
                      {r.phone && <p className="flex items-center gap-1.5 text-muted-foreground"><Phone className="h-3 w-3" />{r.phone}</p>}
                      <p className="flex items-center gap-1.5 text-muted-foreground"><Target className="h-3 w-3" />월 목표: {fmt(targetSales)}</p>
                    </div>
                  )}

                  {/* 목표 & 계약 요약 */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                      목표 {fmt(targetSales)}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                      비용 {targetCostRatio}%
                    </Badge>
                    {s && s.contractCount > 0 && (
                      <Badge className="text-[10px] h-5 px-1.5 bg-primary/15 text-primary border-primary/30">
                        계약 {s.contractCount}건
                      </Badge>
                    )}
                  </div>

                  <Button variant="outline" size="sm" className="w-full mt-3 h-7 text-xs gap-1.5" onClick={e => { e.stopPropagation(); openEdit(r); setEditTab("contracts"); }}>
                    <FileText className="h-3.5 w-3.5" /> 계약 조건 관리
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* ── 매장 생성 다이얼로그 ─────────────────────────────────────────── */}
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>새 매장 추가</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label className="text-xs">매장명 *</Label><Input value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} className="mt-1 h-9" /></div>
              <div><Label className="text-xs">주소</Label><Input value={createForm.address} onChange={e => setCreateForm(f => ({ ...f, address: e.target.value }))} className="mt-1 h-9" /></div>
              <div><Label className="text-xs">전화번호</Label><Input value={createForm.phone} onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))} className="mt-1 h-9" /></div>
              <div><Label className="text-xs">월 매출 목표 (원)</Label><Input type="number" value={createForm.monthlyTargetSales} onChange={e => setCreateForm(f => ({ ...f, monthlyTargetSales: e.target.value }))} className="mt-1 h-9" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">인건비 목표 (%)</Label><Input type="number" value={createForm.targetLaborRatio} onChange={e => setCreateForm(f => ({ ...f, targetLaborRatio: e.target.value }))} className="mt-1 h-9" /></div>
                <div><Label className="text-xs">총비용 목표 (%)</Label><Input type="number" value={createForm.targetCostRatio} onChange={e => setCreateForm(f => ({ ...f, targetCostRatio: e.target.value }))} className="mt-1 h-9" /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>취소</Button>
              <Button size="sm" onClick={() => createMutation.mutate({
                name: createForm.name, address: createForm.address || undefined, phone: createForm.phone || undefined,
                monthlyTargetSales: createForm.monthlyTargetSales ? Number(createForm.monthlyTargetSales) : undefined,
                targetLaborRatio: Number(createForm.targetLaborRatio), targetCostRatio: Number(createForm.targetCostRatio),
              })} disabled={createMutation.isPending}>생성</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── 매장 수정 다이얼로그 (탭 구조) ─────────────────────────────────── */}
        <Dialog open={!!editRestaurant} onOpenChange={(open) => { if (!open) { setEditRestaurant(null); setShowContractForm(false); setEditingContract(null); } }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                {editRestaurant?.name} — 매장 관리
              </DialogTitle>
            </DialogHeader>

            <Tabs value={editTab} onValueChange={setEditTab}>
              <TabsList className="grid grid-cols-5 w-full">
                <TabsTrigger value="info" className="text-xs">기본 정보</TabsTrigger>
                <TabsTrigger value="contracts" className="text-xs">계약 조건</TabsTrigger>
                <TabsTrigger value="staff" className="text-xs">직원 관리</TabsTrigger>
                <TabsTrigger value="operations" className="text-xs">업무 관리</TabsTrigger>
                <TabsTrigger value="closures" className="text-xs">휴무일</TabsTrigger>
              </TabsList>

              {/* ── 기본 정보 탭 ─────────────────────────────────────────── */}
              <TabsContent value="info" className="space-y-3 pt-2">
                <div><Label className="text-xs">매장명</Label><Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="mt-1 h-9" /></div>
                <div><Label className="text-xs">주소</Label><Input value={editForm.address} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} className="mt-1 h-9" /></div>
                <div><Label className="text-xs">전화번호</Label><Input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} className="mt-1 h-9" /></div>
                <div><Label className="text-xs">월 매출 목표 (원)</Label><Input type="number" value={editForm.monthlyTargetSales} onChange={e => setEditForm(f => ({ ...f, monthlyTargetSales: e.target.value }))} className="mt-1 h-9" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">인건비 목표 (%)</Label><Input type="number" value={editForm.targetLaborRatio} onChange={e => setEditForm(f => ({ ...f, targetLaborRatio: e.target.value }))} className="mt-1 h-9" /></div>
                  <div><Label className="text-xs">총비용 목표 (%)</Label><Input type="number" value={editForm.targetCostRatio} onChange={e => setEditForm(f => ({ ...f, targetCostRatio: e.target.value }))} className="mt-1 h-9" /></div>
                </div>
                <div className="flex justify-end pt-2">
                  <Button size="sm" onClick={() => editRestaurant && updateMutation.mutate({
                    id: editRestaurant.id, name: editForm.name,
                    address: editForm.address || undefined, phone: editForm.phone || undefined,
                    monthlyTargetSales: editForm.monthlyTargetSales ? Number(editForm.monthlyTargetSales) : undefined,
                    targetLaborRatio: Number(editForm.targetLaborRatio), targetCostRatio: Number(editForm.targetCostRatio),
                  })} disabled={updateMutation.isPending}>저장</Button>
                </div>
              </TabsContent>

              {/* ── 계약 조건 탭 ─────────────────────────────────────────── */}
              <TabsContent value="contracts" className="space-y-4 pt-2">
                {/* 계약 기반 고정비 합산 요약 */}
                {(contractCostsQuery.data ?? []).length > 0 && (
                  <Card className="border-primary/20 bg-primary/5">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-sm flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <BarChart3 className="h-4 w-4 text-primary" />
                          {currentMonth} 계약 기반 고정비 합산
                        </span>
                        <Button
                          size="sm" variant="ghost" className="h-7 text-xs gap-1"
                          onClick={() => editRestaurant && syncMutation.mutate({ restaurantId: editRestaurant.id, effectiveMonth: currentMonth })}
                          disabled={syncMutation.isPending}
                        >
                          <RefreshCw className={cn("h-3 w-3", syncMutation.isPending && "animate-spin")} />
                          동기화
                        </Button>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-3 space-y-2">
                      {/* 유형별 합산 */}
                      {Object.entries(contractsByType).map(([type, { contracts: cs, totalAmount }]) => {
                        const info = CONTRACT_TYPE_LABELS[type] ?? CONTRACT_TYPE_LABELS.other;
                        return (
                          <div key={type} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span>{info.icon}</span>
                              <span className="text-muted-foreground">{info.label}</span>
                              <span className="text-xs text-muted-foreground">({cs.length}건)</span>
                            </div>
                            <span className="font-semibold text-primary">{fmt(totalAmount)}</span>
                          </div>
                        );
                      })}
                      <div className="pt-2 border-t border-border/40 flex justify-between items-center">
                        <span className="text-sm font-medium">총 계약 고정비</span>
                        <span className="text-base font-bold text-primary">{fmt(totalContractCost)}</span>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* 계약 조건 목록 */}
                <div className="space-y-2">
                  {(contractsQuery.data ?? []).length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      등록된 계약 조건이 없습니다
                    </div>
                  ) : (contractsQuery.data ?? []).map((c: any) => {
                    const info = CONTRACT_TYPE_LABELS[c.contractType] ?? CONTRACT_TYPE_LABELS.other;
                    const cost = (contractCostsQuery.data ?? []).find((cc: any) => cc.id === c.id);
                    return (
                      <div key={c.id} className="flex items-start justify-between gap-2 p-3 rounded-lg border border-border/60 bg-card hover:bg-muted/20 transition-colors">
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          <span className="text-lg mt-0.5">{info.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm truncate">{c.name}</span>
                              <Badge className={cn("text-[10px] h-4 px-1.5", info.color)}>{info.label}</Badge>
                              {c.autoApplyToFixedCost && (
                                <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-emerald-400 border-emerald-500/30">자동반영</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                              {c.calcType === "fixed" ? (
                                <span className="font-semibold text-foreground">{fmt(parseFloat(c.fixedAmount ?? "0"))} / 월</span>
                              ) : (
                                <span>매출의 <span className="font-semibold text-foreground">{parseFloat(c.ratioPercent ?? "0")}%</span>
                                  {cost && <span className="ml-1 text-primary">≈ {fmt(cost.calculatedAmount)}</span>}
                                </span>
                              )}
                              {(c.startDate || c.endDate) && (
                                <span>{c.startDate ? String(c.startDate).slice(0, 10) : "—"} ~ {c.endDate ? String(c.endDate).slice(0, 10) : "무기한"}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openContractEdit(c as Contract)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => { if (confirm("이 계약 조건을 삭제하시겠습니까?")) deleteContractMutation.mutate({ id: c.id }); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 계약 조건 추가/수정 폼 */}
                {showContractForm ? (
                  <Card className="border-primary/30 bg-primary/5">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-sm">{editingContract ? "계약 조건 수정" : "새 계약 조건 추가"}</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">계약 유형 *</Label>
                          <Select value={contractForm.contractType} onValueChange={v => setContractForm(f => ({ ...f, contractType: v as any }))}>
                            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(CONTRACT_TYPE_LABELS).map(([v, { label, icon }]) => (
                                <SelectItem key={v} value={v}>{icon} {label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">계산 방식 *</Label>
                          <Select value={contractForm.calcType} onValueChange={v => setContractForm(f => ({ ...f, calcType: v as any }))}>
                            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="fixed">고정 금액</SelectItem>
                              <SelectItem value="ratio">매출 비율 (%)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">항목명 *</Label>
                        <Input value={contractForm.name} onChange={e => setContractForm(f => ({ ...f, name: e.target.value }))} placeholder="예: 매장 임대료" className="mt-1 h-9" />
                      </div>
                      {contractForm.calcType === "fixed" ? (
                        <div>
                          <Label className="text-xs">고정 금액 (원/월) *</Label>
                          <Input type="number" value={contractForm.fixedAmount} onChange={e => setContractForm(f => ({ ...f, fixedAmount: e.target.value }))} placeholder="0" className="mt-1 h-9" />
                        </div>
                      ) : (
                        <div>
                          <Label className="text-xs">매출 비율 (%) *</Label>
                          <Input type="number" value={contractForm.ratioPercent} onChange={e => setContractForm(f => ({ ...f, ratioPercent: e.target.value }))} placeholder="0.0" step="0.1" className="mt-1 h-9" />
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <div><Label className="text-xs">계약 시작일</Label><Input type="date" value={contractForm.startDate} onChange={e => setContractForm(f => ({ ...f, startDate: e.target.value }))} className="mt-1 h-9" /></div>
                        <div><Label className="text-xs">계약 종료일</Label><Input type="date" value={contractForm.endDate} onChange={e => setContractForm(f => ({ ...f, endDate: e.target.value }))} className="mt-1 h-9" /></div>
                      </div>
                      <div><Label className="text-xs">메모</Label><Textarea value={contractForm.note} onChange={e => setContractForm(f => ({ ...f, note: e.target.value }))} className="mt-1 text-sm" rows={2} /></div>
                      <div className="flex items-center gap-2">
                        <Switch checked={contractForm.autoApplyToFixedCost} onCheckedChange={v => setContractForm(f => ({ ...f, autoApplyToFixedCost: v }))} />
                        <Label className="text-xs cursor-pointer">고정비 자동 반영</Label>
                      </div>
                      <div className="flex gap-2 justify-end pt-1">
                        <Button variant="outline" size="sm" onClick={() => { setShowContractForm(false); setEditingContract(null); setContractForm(emptyContractForm); }}>취소</Button>
                        <Button size="sm" onClick={handleContractSubmit} disabled={createContractMutation.isPending || updateContractMutation.isPending}>
                          {editingContract ? "수정" : "등록"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => { setContractForm(emptyContractForm); setEditingContract(null); setShowContractForm(true); }}>
                    <Plus className="h-3.5 w-3.5" /> 계약 조건 추가
                  </Button>
                )}
              </TabsContent>

              {/* ── 직원 관리 / 전자계약 탭 ─────────────────────────────────────────── */}
              <TabsContent value="staff" className="space-y-3 pt-2">
                {/* 앱 내 직원 배정 */}
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">앱 직원 배정</p>
                  <div className="flex gap-2">
                    <Select value={addStaffForm.userId} onValueChange={v => setAddStaffForm(f => ({ ...f, userId: v }))}>
                      <SelectTrigger className="flex-1 h-9 text-sm"><SelectValue placeholder="직원 선택" /></SelectTrigger>
                      <SelectContent>
                        {(usersQuery.data ?? []).filter(u => u.role === "employee" || u.role === "manager").map(u => (
                          <SelectItem key={u.id} value={String(u.id)}>{u.name ?? u.username}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={addStaffForm.role} onValueChange={v => setAddStaffForm(f => ({ ...f, role: v as "manager" | "employee" }))}>
                      <SelectTrigger className="w-24 h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="employee">직원</SelectItem>
                        <SelectItem value="manager">점장</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-9" onClick={() => editRestaurant && addStaffForm.userId && addStaffMutation.mutate({ restaurantId: editRestaurant.id, userId: Number(addStaffForm.userId), role: addStaffForm.role })} disabled={addStaffMutation.isPending}>추가</Button>
                  </div>
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {(staffQuery.data ?? []).map(s => (
                      <div key={s.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30 text-sm">
                        <div>
                          <span className="font-medium">{s.name ?? s.username}</span>
                          <span className="text-xs text-muted-foreground ml-2">{s.restaurantRole === "manager" ? "점장" : "직원"}</span>
                        </div>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive"
                          onClick={() => editRestaurant && removeStaffMutation.mutate({ restaurantId: editRestaurant.id, userId: s.id })}>제거</Button>
                      </div>
                    ))}
                    {(staffQuery.data ?? []).length === 0 && <p className="text-xs text-muted-foreground text-center py-3">배정된 직원이 없습니다</p>}
                  </div>
                </div>

                {/* 전자 근로계약서 */}
                <div className="border-t border-border pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">전자 근로계약서</p>
                    <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setContractRestaurant(editRestaurant); setShowContractWizard(true); setWizardStep(1); setEcForm(f => ({ ...f, workPlace: editRestaurant?.name ?? "", contractStart: today })); }}>
                      <Plus className="h-3 w-3" /> 계약서 작성
                    </Button>
                  </div>
                  {minWageInfo.data && (
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2 text-xs">
                      <span className="font-semibold text-blue-400">2026년 최저임금</span>
                      <span className="text-muted-foreground ml-2">시급 {minWageInfo.data.hourlyWage.toLocaleString()}원 / 월급 {minWageInfo.data.monthlyWage.toLocaleString()}원 (주 40h)</span>
                    </div>
                  )}
                  <div className="space-y-1.5 max-h-52 overflow-y-auto">
                    {electronicContractsQuery.isLoading && <p className="text-xs text-muted-foreground text-center py-3">로딩 중...</p>}
                    {(electronicContractsQuery.data ?? []).length === 0 && !electronicContractsQuery.isLoading && (
                      <p className="text-xs text-muted-foreground text-center py-4">발송된 계약서가 없습니다</p>
                    )}
                    {(electronicContractsQuery.data ?? []).map(ec => {
                      const statusMap: Record<string, { label: string; color: string }> = {
                        draft:     { label: "초안", color: "bg-slate-500/20 text-slate-400" },
                        sent:      { label: "발송완료", color: "bg-yellow-500/20 text-yellow-400" },
                        signed:    { label: "서명완료", color: "bg-emerald-500/20 text-emerald-400" },
                        expired:   { label: "만료", color: "bg-red-500/20 text-red-400" },
                        cancelled: { label: "취소", color: "bg-red-500/20 text-red-400" },
                      };
                      const st = statusMap[ec.status] ?? statusMap.draft;
                      const ctLabel: Record<string, string> = { permanent: "정규직", fixed_term: "기간제", part_time: "단시간", daily: "일용직" };

                      // 수습 여부 판단 (기간제 + 3개월 이하)
                      const isProbation = ec.contractType === "fixed_term" && ec.contractEnd && ec.contractStart && (() => {
                        const s = new Date(String(ec.contractStart)); const e = new Date(String(ec.contractEnd));
                        return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) <= 3;
                      })();

                      // 갱신일 D-day 계산
                      const renewalInfo = ec.contractEnd ? (() => {
                        const endDate = new Date(String(ec.contractEnd));
                        const todayDate = new Date(); todayDate.setHours(0,0,0,0);
                        const diff = Math.round((endDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
                        const d = endDate;
                        const dateStr = `${d.getFullYear()}. ${d.getMonth()+1}. ${d.getDate()}.`;
                        return { dateStr, daysLeft: diff };
                      })() : null;

                      const signLink = `${window.location.origin}/contract/sign/${ec.token}`;
                      const pdfUrl = `/api/contract/pdf/${ec.token}`;

                      return (
                        <div key={ec.id} className="p-2.5 rounded-lg bg-muted/30 border border-border/40 text-sm space-y-2">
                          {/* 헤더 */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-sm">{ec.employeeName}</span>
                                <Badge className={cn("text-xs px-1.5 py-0 h-5 font-normal", st.color)}>{st.label}</Badge>
                                {isProbation
                                  ? <Badge className="text-xs px-1.5 py-0 h-5 font-normal bg-amber-500/20 text-amber-400">수습</Badge>
                                  : <span className="text-xs text-muted-foreground">{ctLabel[ec.contractType]}</span>
                                }
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {ec.wageType === "hourly" ? `시급 ${Number(ec.wageAmount).toLocaleString()}원` : `월급 ${Number(ec.wageAmount).toLocaleString()}원`}
                                {" · "}{(() => { const d = new Date(String(ec.contractStart)); return `${d.getFullYear()}. ${d.getMonth()+1}. ${d.getDate()}.`; })()}
                                {ec.contractEnd ? ` ~ ${(() => { const d = new Date(String(ec.contractEnd)); return `${d.getFullYear()}. ${d.getMonth()+1}. ${d.getDate()}.`; })()}` : " ~ 무기한"}
                              </p>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="미리보기" onClick={() => setPreviewContractId(ec.id)}>
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              {ec.status === "draft" && (
                                <Button size="sm" className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700"
                                  onClick={() => sendEcMutation.mutate({ contractId: ec.id })} disabled={sendEcMutation.isPending}>
                                  <Send className="h-3 w-3" /> 발송
                                </Button>
                              )}
                              {(ec.status === "draft" || ec.status === "sent") && (
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                  onClick={() => cancelEcMutation.mutate({ contractId: ec.id })}>
                                  <XCircle className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>

                          {/* 갱신일 및 수습→1년 전환 안내 */}
                          {renewalInfo && ec.status !== "cancelled" && (
                            <div className={cn(
                              "flex items-center gap-1.5 text-xs rounded-md px-2 py-1.5",
                              renewalInfo.daysLeft <= 30 ? "bg-red-500/10 text-red-400 border border-red-500/20" :
                              renewalInfo.daysLeft <= 90 ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                              "bg-muted/50 text-muted-foreground border border-border/30"
                            )}>
                              <Calendar className="h-3 w-3 shrink-0" />
                              <span className="flex-1">
                                {isProbation ? "수습 만료" : "계약 갱신일"}: <strong>{renewalInfo.dateStr}</strong>
                                {renewalInfo.daysLeft > 0 ? ` (D-${renewalInfo.daysLeft})` : renewalInfo.daysLeft === 0 ? " (오늘 만료!)": " (만료됨)"}
                              </span>
                              {isProbation && renewalInfo.daysLeft > 0 && (
                                <span className="flex items-center gap-0.5 text-blue-400 font-medium">
                                  1년 계약직 전환 <ArrowRight className="h-3 w-3" />
                                </span>
                              )}
                            </div>
                          )}

                          {/* 링크 공유 / PDF 다운로드 */}
                          {(ec.status === "sent" || ec.status === "signed") && (
                            <div className="flex flex-wrap gap-1.5">
                              {ec.status === "sent" && (
                                <>
                                  <button
                                    onClick={() => { navigator.clipboard.writeText(signLink); toast.success("서명 링크가 복사되었습니다"); }}
                                    className="inline-flex items-center gap-1 h-6 text-xs px-2 rounded-md border border-border/60 bg-transparent hover:bg-muted/50 text-foreground">
                                    <Copy className="h-3 w-3" /> 링크 복사
                                  </button>
                                  <a href={`sms:?body=${encodeURIComponent(`[근로계약서 서명 요청]\n${ec.employeeName}님, 아래 링크에서 계약서를 확인하고 서명해 주세요.\n${signLink}`)}`}
                                    className="inline-flex items-center gap-1 h-6 text-xs px-2 rounded-md border border-border/60 bg-transparent hover:bg-muted/50 text-foreground">
                                    <MessageCircle className="h-3 w-3" /> SMS
                                  </a>
                                  <a href={`https://open.kakao.com/o/share?url=${encodeURIComponent(signLink)}&text=${encodeURIComponent(`[${ec.employeeName}] 근로계약서 서명 요청`)}`}
                                    target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 h-6 text-xs px-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400">
                                    <Share2 className="h-3 w-3" /> 카카오
                                  </a>
                                </>
                              )}
                              {ec.status === "signed" && (
                                <a href={pdfUrl} download
                                  className="inline-flex items-center gap-1 h-6 text-xs px-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400">
                                  <Download className="h-3 w-3" /> PDF 다운로드
                                </a>
                              )}
                              {/* 계약 갱신 버튼 — 서명 완료된 계약에만 표시 */}
                              {ec.status === "signed" && (
                                <button
                                  onClick={() => {
                                    const durationMonths = ec.contractEnd
                                      ? Math.round((new Date(ec.contractEnd).getTime() - new Date(ec.contractStart).getTime()) / (1000 * 60 * 60 * 24 * 30))
                                      : 999;
                                    const isProbation = ec.contractType === "fixed_term" && durationMonths <= 3;
                                    const nextStart = ec.contractEnd
                                      ? new Date(new Date(ec.contractEnd).getTime() + 86400000).toISOString().split("T")[0] // contractEnd+1일 (UTC 기반 날짜 문자열 변환, 계약 종료일 다음날)
                                      : today;
                                    setRenewTargetContract({ id: ec.id, employeeName: ec.employeeName, isProbation });
                                    setRenewForm({
                                      newContractStart: nextStart,
                                      newContractEnd: isProbation
                                        ? new Date(new Date(nextStart).setFullYear(new Date(nextStart).getFullYear() + 1)).toISOString().split("T")[0] // 1년 후
                                        : ec.contractEnd ? new Date(new Date(ec.contractEnd).setFullYear(new Date(ec.contractEnd).getFullYear() + 1)).toISOString().split("T")[0] : "",
                                      newWageAmount: String(ec.wageAmount),
                                    });
                                    setShowRenewDialog(true);
                                  }}
                                  className="inline-flex items-center gap-1 h-6 text-xs px-2 rounded-md border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400">
                                  <RefreshCw className="h-3 w-3" /> 계약 갱신
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </TabsContent>

              {/* ── 업무 관리 탭 ─────────────────────────────────────────── */}
              <TabsContent value="operations" className="space-y-4 pt-2">
                <StoreOperationsTab
                  restaurantId={editRestaurant?.id ?? 0}
                  salesInputStartTime={editForm.salesInputStartTime}
                  salesInputEndTime={editForm.salesInputEndTime}
                  onSalesTimeChange={(start: string, end: string) => setEditForm(f => ({ ...f, salesInputStartTime: start, salesInputEndTime: end }))}
                  onSalesTimeSave={() => editRestaurant && setSalesTimeMutation.mutate({
                    restaurantId: editRestaurant.id,
                    salesInputStartTime: editForm.salesInputStartTime || null,
                    salesInputEndTime: editForm.salesInputEndTime || null,
                  })}
                  isSaving={setSalesTimeMutation.isPending}
                />
              </TabsContent>
              {/* ── 휴무일 탭 ─────────────────────────────────────────────── */}
              <TabsContent value="closures" className="space-y-6 pt-2">
                {/* 정기 휴무 요일 설정 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-primary" />
                    <h4 className="text-sm font-semibold">정기 휴무 요일</h4>
                    <span className="text-xs text-muted-foreground">매주 반복되는 휴무일</span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {WEEKDAY_LABELS.map((label, idx) => {
                      const isActive = activeWeekdays.includes(idx);
                      return (
                        <button
                          key={idx}
                          onClick={() => toggleWeekday(idx)}
                          disabled={setWeeklyMutation.isPending}
                          className={cn(
                            "w-10 h-10 rounded-lg text-sm font-medium transition-all border",
                            isActive
                              ? "bg-red-500/20 text-red-400 border-red-500/40 shadow-sm"
                              : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {activeWeekdays.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      매주 {activeWeekdays.sort((a: number, b: number) => a - b).map((d: number) => WEEKDAY_LABELS[d]).join(", ")}요일 휴무
                    </p>
                  )}
                </div>

                <div className="border-t border-border" />

                {/* 특정 휴무일 설정 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-primary" />
                    <h4 className="text-sm font-semibold">특정 휴무일</h4>
                    <span className="text-xs text-muted-foreground">연휴, 시설 점검 등</span>
                  </div>
                </div>

                {/* 월 선택 */}
                <div className="flex items-center gap-2">
                  <Select value={String(closureYear)} onValueChange={v => setClosureYear(Number(v))}>
                    <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[closureNow.getFullYear()-1, closureNow.getFullYear(), closureNow.getFullYear()+1].map(y => (
                        <SelectItem key={y} value={String(y)}>{y}년</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={String(closureMonth)} onValueChange={v => setClosureMonth(Number(v))}>
                    <SelectTrigger className="w-20 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({length:12},(_,i)=>i+1).map(m => (
                        <SelectItem key={m} value={String(m)}>{m}월</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* 휴무일 추가 폼 */}
                <div className="flex gap-2 items-end flex-wrap">
                  <div className="space-y-1">
                    <Label className="text-xs">날짜</Label>
                    <Input type="date" value={newClosedDate} onChange={e => setNewClosedDate(e.target.value)}
                      className="h-8 text-xs w-40" />
                  </div>
                  <div className="space-y-1 flex-1 min-w-[120px]">
                    <Label className="text-xs">사유 (선택)</Label>
                    <Input value={newClosedReason} onChange={e => setNewClosedReason(e.target.value)}
                      placeholder="예: 연휴, 시설 점검..." className="h-8 text-xs" />
                  </div>
                  <Button size="sm" className="h-8 text-xs gap-1.5"
                    disabled={!newClosedDate || addClosedDayMutation.isPending}
                    onClick={() => {
                      if (!editRestaurant?.id || !newClosedDate) return;
                      addClosedDayMutation.mutate({ restaurantId: editRestaurant.id, closedDate: newClosedDate, reason: newClosedReason || undefined });
                    }}>
                    <Plus className="h-3.5 w-3.5" /> 휴무일 추가
                  </Button>
                </div>

                {/* 휴무일 목록 */}
                <div className="space-y-2">
                  {closedDaysQuery.isLoading ? (
                    <p className="text-xs text-muted-foreground">로딩 중...</p>
                  ) : (closedDaysQuery.data ?? []).length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Calendar className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">{closureYear}년 {closureMonth}월에 등록된 휴무일이 없습니다.</p>
                    </div>
                  ) : (
                    (closedDaysQuery.data ?? []).map((d: any) => {
                      const raw = d.closedDate;
                      const dateStr = raw instanceof Date
                        ? `${raw.getFullYear()}-${String(raw.getMonth()+1).padStart(2,'0')}-${String(raw.getDate()).padStart(2,'0')}`
                        : String(raw).slice(0, 10);
                      return (
                        <div key={d.id} className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-card">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-red-400" />
                            <div>
                              <p className="text-sm font-medium">{dateStr}</p>
                              {d.reason && <p className="text-xs text-muted-foreground">{d.reason}</p>}
                            </div>
                          </div>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            onClick={() => removeClosedDayMutation.mutate({ id: d.id, restaurantId: editRestaurant!.id })}
                            disabled={removeClosedDayMutation.isPending}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>

      {/* ── 전자계약서 작성 위자드 ───────────────────────────────────────────────────── */}
      <Dialog open={showContractWizard} onOpenChange={v => { setShowContractWizard(v); if (!v) setWizardStep(1); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-400" />
              근로계약서 작성 — {wizardStep}/3단계
            </DialogTitle>
          </DialogHeader>

          {/* 스텝 진행표시 */}
          <div className="flex gap-1 mb-2">
            {[1,2,3].map(s => (
              <div key={s} className={cn("h-1 flex-1 rounded-full", s <= wizardStep ? "bg-blue-500" : "bg-muted")} />
            ))}
          </div>

          {/* ─ 1단계: 직원 기본정보 ─ */}
          {wizardStep === 1 && (
            <div className="space-y-3">
              {/* 수습→1년 계약직 구조 안내 */}
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2.5 text-xs space-y-1">
                <p className="font-semibold text-blue-400 flex items-center gap-1">📋 기본 계약 구조 안내</p>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-medium">수습</span>
                  <span>월단위 계약 갱신 (최대 3개월)</span>
                  <ArrowRight className="h-3 w-3 text-blue-400 shrink-0" />
                  <span className="bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-medium">1년 계약직</span>
                </div>
                <p className="text-muted-foreground">수습기간 중 최저임금 90% 적용 가능 · 수습 만료 D-90/D-30 자동 알림 발송</p>
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase">직원 기본정보</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">성명 *</Label>
                  <Input className="h-8 text-sm" value={ecForm.employeeName} onChange={e => setEcForm(f => ({ ...f, employeeName: e.target.value }))} placeholder="홍길동" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">연락수</Label>
                  <Input className="h-8 text-sm" value={ecForm.employeePhone} onChange={e => setEcForm(f => ({ ...f, employeePhone: e.target.value }))} placeholder="010-0000-0000" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">생년월일</Label>
                  <Input className="h-8 text-sm" type="date" value={ecForm.employeeBirthdate} onChange={e => setEcForm(f => ({ ...f, employeeBirthdate: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">직책</Label>
                  <Input className="h-8 text-sm" value={ecForm.position} onChange={e => setEcForm(f => ({ ...f, position: e.target.value }))} placeholder="직원" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">주소</Label>
                <Input className="h-8 text-sm" value={ecForm.employeeAddress} onChange={e => setEcForm(f => ({ ...f, employeeAddress: e.target.value }))} placeholder="주소 입력" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">계약 유형 *</Label>
                  <Select value={ecForm.contractType} onValueChange={v => setEcForm(f => ({ ...f, contractType: v as typeof f.contractType }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed_term">기간제 (수습/1년 계약직)</SelectItem>
                      <SelectItem value="part_time">단시간 근로자</SelectItem>
                      <SelectItem value="permanent">정규직 (무기계약)</SelectItem>
                      <SelectItem value="daily">일용직</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">계약 시작일 *</Label>
                  <Input className="h-8 text-sm" type="date" value={ecForm.contractStart} onChange={e => setEcForm(f => ({ ...f, contractStart: e.target.value }))} />
                </div>
              </div>
              {ecForm.contractType !== "permanent" && (
                <div className="space-y-1">
                  <Label className="text-xs">계약 종료일</Label>
                  <Input className="h-8 text-sm" type="date" value={ecForm.contractEnd} onChange={e => setEcForm(f => ({ ...f, contractEnd: e.target.value }))} />
                </div>
              )}
              <div className="flex items-center gap-2">
                <Switch checked={ecForm.hasProbation} onCheckedChange={v => setEcForm(f => ({ ...f, hasProbation: v }))} />
                <Label className="text-xs">수습기간 적용</Label>
                {ecForm.hasProbation && (
                  <Input className="h-7 w-16 text-xs" type="number" min={1} max={3} value={ecForm.probationMonths}
                    onChange={e => setEcForm(f => ({ ...f, probationMonths: Number(e.target.value) }))} />
                )}
                {ecForm.hasProbation && <span className="text-xs text-muted-foreground">개월 (최저임금 90% 적용)</span>}
              </div>
            </div>
          )}

          {/* ─ 2단계: 근무조건 & 임금 ─ */}
          {wizardStep === 2 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase">근무조건 & 임금</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">근무 시작</Label>
                  <Input className="h-8 text-sm" type="time" value={ecForm.workStartTime} onChange={e => setEcForm(f => ({ ...f, workStartTime: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">근무 종료</Label>
                  <Input className="h-8 text-sm" type="time" value={ecForm.workEndTime} onChange={e => setEcForm(f => ({ ...f, workEndTime: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">주 소정근로시간</Label>
                  <Input className="h-8 text-sm" type="number" min={1} max={52} value={ecForm.weeklyHours} onChange={e => setEcForm(f => ({ ...f, weeklyHours: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">휴게시간(분)</Label>
                  <Input className="h-8 text-sm" type="number" value={ecForm.breakMinutes} onChange={e => setEcForm(f => ({ ...f, breakMinutes: Number(e.target.value) }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">임금 형태 *</Label>
                  <Select value={ecForm.wageType} onValueChange={v => setEcForm(f => ({ ...f, wageType: v as "hourly" | "monthly" }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">시급</SelectItem>
                      <SelectItem value="monthly">월급</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{ecForm.wageType === "hourly" ? "시급" : "월급"} *</Label>
                  <Input className="h-8 text-sm" type="number" value={ecForm.wageAmount}
                    onChange={e => setEcForm(f => ({ ...f, wageAmount: e.target.value }))}
                    placeholder={ecForm.wageType === "hourly" ? "10320" : "2156880"} />
                </div>
              </div>
              {minWageInfo.data && (
                <p className="text-xs text-blue-400">
                  최저 {ecForm.wageType === "hourly" ? `시급 ${minWageInfo.data.hourlyWage.toLocaleString()}원` : `월급 ${minWageInfo.data.monthlyWage.toLocaleString()}원`} 이상 입력해야 합니다.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">임금 지급일</Label>
                  <Input className="h-8 text-sm" type="number" min={1} max={31} value={ecForm.payDay} onChange={e => setEcForm(f => ({ ...f, payDay: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">지급 방법</Label>
                  <Select value={ecForm.payMethod} onValueChange={v => setEcForm(f => ({ ...f, payMethod: v as "bank_transfer" | "cash" }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank_transfer">계좌이체</SelectItem>
                      <SelectItem value="cash">현금</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Switch checked={ecForm.mealProvided} onCheckedChange={v => setEcForm(f => ({ ...f, mealProvided: v }))} />
                  <Label className="text-xs">식대 현물 제공</Label>
                  {!ecForm.mealProvided && (
                    <Input className="h-7 w-24 text-xs" type="number" value={ecForm.mealAllowance}
                      onChange={e => setEcForm(f => ({ ...f, mealAllowance: Number(e.target.value) }))}
                      placeholder="식대수당" />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={ecForm.socialInsurance} onCheckedChange={v => setEcForm(f => ({ ...f, socialInsurance: v }))} />
                  <Label className="text-xs">4대보험 가입</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={ecForm.over5Employees} onCheckedChange={v => setEcForm(f => ({ ...f, over5Employees: v }))} />
                  <Label className="text-xs">5인 이상 사업장 (연장·야간·휴일 가산수당 적용)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={ecForm.nightShiftConsent} onCheckedChange={v => setEcForm(f => ({ ...f, nightShiftConsent: v }))} />
                  <Label className="text-xs">야간근무(22시~06시) 동의</Label>
                </div>
              </div>
            </div>
          )}

          {/* ─ 3단계: 담당업무 & 특약사항 ─ */}
          {wizardStep === 3 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase">담당업무 & 특약사항</p>
              <div className="space-y-1">
                <Label className="text-xs">근무 장소</Label>
                <Input className="h-8 text-sm" value={ecForm.workPlace} onChange={e => setEcForm(f => ({ ...f, workPlace: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">담당 업무</Label>
                <Textarea className="text-sm min-h-16" value={ecForm.jobDescription} onChange={e => setEcForm(f => ({ ...f, jobDescription: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">특약사항 (선택)</Label>
                <Textarea className="text-sm min-h-20" value={ecForm.specialTerms}
                  onChange={e => setEcForm(f => ({ ...f, specialTerms: e.target.value }))}
                  placeholder="유니폼 구매 비용 부담, 비밀유지 의무 등 추가 조항" />
              </div>
              {/* 요식업 기본 특약사항 예시 버튼 */}
              <Button variant="outline" size="sm" className="w-full text-xs h-8"
                onClick={() => setEcForm(f => ({ ...f, specialTerms: `1. 유니폼 및 위생복장 구매 비용은 근로자 부담으로 한다.\n2. 음식 조리 및 위생 관리 관련 교육을 성실히 이행한다.\n3. 고객의 개인정보 및 식당 영업 정보를 외부에 유출하지 아니한다.\n4. 퇴직 시 인수인계 절차를 준수하며 관련 서류를 제출한다.\n5. 근무 중 발생하는 사고는 즉시 사업주에게 보고한다.` }))}>
                ✨ 요식업 기본 특약사항 불러오기
              </Button>
            </div>
          )}

          <DialogFooter className="flex gap-2 pt-2">
            {wizardStep > 1 && (
              <Button variant="outline" size="sm" onClick={() => setWizardStep(s => s - 1)}>이전</Button>
            )}
            {wizardStep < 3 ? (
              <Button size="sm" onClick={() => {
                if (wizardStep === 1 && !ecForm.employeeName.trim()) { toast.error("직원 성명을 입력하세요."); return; }
                setWizardStep(s => s + 1);
              }}>다음</Button>
            ) : (
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700"
                disabled={createEcMutation.isPending}
                onClick={() => {
                  if (!ecForm.wageAmount || Number(ecForm.wageAmount) <= 0) { toast.error("임금을 입력하세요."); return; }
                  const targetRestaurant = contractRestaurant || editRestaurant;
                  if (!targetRestaurant) return;
                  createEcMutation.mutate({
                    restaurantId: targetRestaurant.id,
                    employeeName: ecForm.employeeName,
                    employeePhone: ecForm.employeePhone || undefined,
                    employeeBirthdate: ecForm.employeeBirthdate || undefined,
                    employeeAddress: ecForm.employeeAddress || undefined,
                    position: ecForm.position,
                    contractType: ecForm.contractType,
                    contractStart: ecForm.contractStart,
                    contractEnd: ecForm.contractEnd || undefined,
                    hasProbation: ecForm.hasProbation,
                    probationMonths: ecForm.probationMonths,
                    workPlace: ecForm.workPlace || undefined,
                    jobDescription: ecForm.jobDescription || undefined,
                    wageType: ecForm.wageType,
                    wageAmount: Number(ecForm.wageAmount),
                    weeklyHours: Number(ecForm.weeklyHours),
                    workStartTime: ecForm.workStartTime,
                    workEndTime: ecForm.workEndTime,
                    breakMinutes: ecForm.breakMinutes,
                    weeklyHoliday: ecForm.weeklyHoliday,
                    payDay: ecForm.payDay,
                    payMethod: ecForm.payMethod,
                    mealProvided: ecForm.mealProvided,
                    mealAllowance: ecForm.mealAllowance,
                    socialInsurance: ecForm.socialInsurance,
                    over5Employees: ecForm.over5Employees,
                    nightShiftConsent: ecForm.nightShiftConsent,
                    specialTerms: ecForm.specialTerms || undefined,
                  });
                }}>
                {createEcMutation.isPending ? "저장 중..." : "계약서 저장"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 계약서 미리보기 다이얼로그 ───────────────────────────────────────────────────── */}
      <Dialog open={!!previewContractId} onOpenChange={v => { if (!v) setPreviewContractId(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" /> 계약서 미리보기
            </DialogTitle>
          </DialogHeader>
          {contractPreviewQuery.isLoading && <p className="text-center py-8 text-muted-foreground">로딩 중...</p>}
          {contractPreviewQuery.data?.html && (
            <div
              className="border border-border rounded-lg overflow-hidden"
              dangerouslySetInnerHTML={{ __html: contractPreviewQuery.data.html }}
            />
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPreviewContractId(null)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ── 계약 갱신 다이얼로그 ──────────────────────────────────────────────────── */}
      <Dialog open={showRenewDialog} onOpenChange={v => { setShowRenewDialog(v); if (!v) setRenewTargetContract(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-blue-400" />
              계약 갱신 — {renewTargetContract?.employeeName}
            </DialogTitle>
          </DialogHeader>
          {renewTargetContract?.isProbation && (
            <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 text-xs text-blue-300">
              <strong>수습 계약 종료 → 1년 기간제 계약직 전환</strong><br />
              수습 기간이 종료됩니다. 아래 정보를 확인 후 1년 계약서를 발송하세요.
            </div>
          )}
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">새 계약 시작일</label>
              <input type="date" value={renewForm.newContractStart}
                onChange={e => setRenewForm(f => ({ ...f, newContractStart: e.target.value }))}
                className="w-full mt-1 h-8 rounded-md border border-border bg-background px-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                새 계약 종료일 {renewTargetContract?.isProbation ? "(1년 자동 설정됨)" : ""}
              </label>
              <input type="date" value={renewForm.newContractEnd}
                onChange={e => setRenewForm(f => ({ ...f, newContractEnd: e.target.value }))}
                className="w-full mt-1 h-8 rounded-md border border-border bg-background px-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">급여 변경 (변경 없으면 기존 유지)</label>
              <input type="number" value={renewForm.newWageAmount} placeholder="기존 급여 유지"
                onChange={e => setRenewForm(f => ({ ...f, newWageAmount: e.target.value }))}
                className="w-full mt-1 h-8 rounded-md border border-border bg-background px-2 text-sm" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowRenewDialog(false)}>취소</Button>
            <Button size="sm"
              disabled={!renewForm.newContractStart || renewMutation.isPending}
              onClick={() => {
                if (!renewTargetContract) return;
                renewMutation.mutate({
                  contractId: renewTargetContract.id,
                  newContractStart: renewForm.newContractStart,
                  newContractEnd: renewForm.newContractEnd || undefined,
                  newWageAmount: renewForm.newWageAmount ? Number(renewForm.newWageAmount) : undefined,
                });
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white">
              {renewMutation.isPending ? "생성 중..." : "갱신 계약서 생성"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
