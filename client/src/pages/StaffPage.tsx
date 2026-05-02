import { useState, useRef, useEffect } from "react";
import { trpc } from "../lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import {
  Users, Plus, ChevronDown, ChevronUp, FileText, Trash2, X, UserCog,
  Copy, ExternalLink, Send, Eye, KeyRound, Camera, ShieldCheck,
  AlertTriangle, Loader2, Building2, Edit3, Check, UserPlus, Link,
  Phone, CalendarDays, Briefcase, Info, Download, RefreshCw, Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatKRW, formatKoreanDate } from "@/lib/utils";

const STORE_ROLE_LABELS: Record<string, string> = {
  owner: "점장",
  supervisor: "매니져",
  staff: "직원",
  store_manager: "점장",  // 레거시
  manager: "매니져",      // 레거시
  employee: "직원",       // 레거시
};

// ─── 보건증 만료일 계산 헬퍼 ──────────────────────────────────────────────────
function getHealthCertStatus(expiry: string | null | undefined) {
  if (!expiry) return null;
  const exp = new Date(expiry);
  const now = new Date();
  const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: "만료됨", color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-900/20", urgent: true };
  if (diffDays <= 30) return { label: `${diffDays}일 남음`, color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-900/20", urgent: true };
  if (diffDays <= 90) return { label: `${diffDays}일 남음`, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-900/20", urgent: false };
  return { label: `${diffDays}일 남음`, color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-900/20", urgent: false };
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function StaffPage() {
  const { user } = useAuth();
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;
  const isAdmin = user?.role === "admin" || user?.role === "master";
  const isOwnerOrAdmin = isAdmin || current?.storeRole === "owner";
  const canChangeRole = user?.role === "master" || current?.storeRole === "owner";

  const [showContractForm, setShowContractForm] = useState(false);
  const [editingDraftContract, setEditingDraftContract] = useState<any>(null);
  const [showInviteSection, setShowInviteSection] = useState(false);
  const [expandedStaff, setExpandedStaff] = useState<number | null>(null);
  const [editingCredentials, setEditingCredentials] = useState<any>(null);
  const [editingCompany, setEditingCompany] = useState<{ userId: number; value: string } | null>(null);
  const [editingHireDate, setEditingHireDate] = useState<{ userId: number; value: string } | null>(null);
  const [editingOffDays, setEditingOffDays] = useState<{ userId: number; value: number } | null>(null);
  // Phase E (2026-05-02): 운영 SSOT 영역 인라인 편집 (단일 state로 영역 관리)
  const [editingEmpField, setEditingEmpField] = useState<{ userId: number; field: string; value: any } | null>(null);
  const [editingWage, setEditingWage] = useState<{
    userId: number;
    wageType: "hourly" | "monthly";
    wageAmount: string;
    effectiveFrom: string;
  } | null>(null);
  const [resignTarget, setResignTarget] = useState<{ userId: number; name: string } | null>(null);
  const [resignDate, setResignDate] = useState(new Date().toISOString().slice(0, 10));
  const [resignReason, setResignReason] = useState("");
  const [showResigned, setShowResigned] = useState(false);
  const [showResignedContracts, setShowResignedContracts] = useState(false);
  const [renewTarget, setRenewTarget] = useState<{ userId: number; name: string; affiliatedCompany?: string } | null>(null);

  // 빠른 직원 추가 (staff.quickAdd)
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showRecentlyResigned, setShowRecentlyResigned] = useState(false);

  const utils = trpc.useUtils();

  // 초대코드
  const [inviteRole, setInviteRole] = useState<"staff" | "supervisor" | "owner">("staff");
  const { data: inviteList } = trpc.invites.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 && showInviteSection },
  );
  const generateInvite = trpc.invites.generate.useMutation({
    onSuccess(data) {
      const url = `${window.location.origin}/join/${data.code}`;
      navigator.clipboard.writeText(url).then(() => toast.success(`초대 링크 복사됨: ${data.code}`));
      utils.invites.list.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });
  const deleteInvite = trpc.invites.delete.useMutation({
    onSuccess() { toast.success("초대코드 삭제됨"); utils.invites.list.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const { data: staffList, isLoading } = trpc.restaurants.getStaff.useQuery(
    { restaurantId, includeResigned: showResigned },
    { enabled: restaurantId > 0 },
  );

  const { data: contracts } = trpc.electronicContracts.listEmploymentContracts.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  // 재설계 2026-05-02: 소속회사 마스터 (5인 미만/이상 자동 결정 + select 옵션 제공)
  const { data: affiliatedCompaniesList = [] } = trpc.affiliatedCompanies.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  // 최근 90일 내 퇴사자 — 재입사 원클릭 UI
  const { data: recentlyResigned } = trpc.staff.listRecentlyResigned.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 && isOwnerOrAdmin },
  );

  const quickAdd = trpc.staff.quickAdd.useMutation({
    onSuccess(data) {
      if (data.status === "rehire") {
        toast.success("재입사 복귀 처리되었습니다");
      } else if (data.status === "concurrent") {
        toast.success("다른 매장 근무자 — 본 매장에 추가되었습니다");
      } else if (data.status === "existing") {
        toast.success("기존 사용자를 이 매장에 배정했습니다");
      } else {
        let msg = "직원이 추가되었습니다";
        if (data.tempPassword) {
          msg += ` (임시비번: ${data.tempPassword})`;
          navigator.clipboard.writeText(data.tempPassword).catch(() => {});
        }
        toast.success(msg);
      }
      if (data.inviteCode) {
        const url = `${window.location.origin}/join/${data.inviteCode}`;
        navigator.clipboard.writeText(url).catch(() => {});
        toast.info(`초대 링크 복사됨: ${data.inviteCode}`);
      }
      setShowQuickAdd(false);
      utils.restaurants.getStaff.invalidate();
      utils.staff.listRecentlyResigned.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });


  const updateRole = trpc.restaurants.updateStaffRole.useMutation({
    onSuccess() { toast.success("역할 변경됨"); utils.restaurants.getStaff.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  // removeStaff 기능 제거됨 (퇴사처리만 사용)

  const updateCredentials = trpc.users.updateStaffCredentials.useMutation({
    onSuccess() { toast.success("정보 수정됨"); setEditingCredentials(null); utils.restaurants.getStaff.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const updateHealthCert = trpc.users.updateHealthCert.useMutation({
    onSuccess() { toast.success("보건증 정보 업데이트됨"); utils.restaurants.getStaff.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const updateBankBook = trpc.users.updateBankBook.useMutation({
    onSuccess() { toast.success("통장사본 업데이트됨"); utils.restaurants.getStaff.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const updateCompany = trpc.restaurants.updateStaffCompany.useMutation({
    onSuccess() { toast.success("소속회사 변경됨"); setEditingCompany(null); utils.restaurants.getStaff.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const updateHireDate = trpc.restaurants.updateStaffHireDate.useMutation({
    onSuccess() { toast.success("입사일 변경됨"); setEditingHireDate(null); utils.restaurants.getStaff.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const updateWeeklyOffDays = trpc.restaurants.updateWeeklyOffDays.useMutation({
    onSuccess() { toast.success("주당 휴무일수 변경됨"); setEditingOffDays(null); utils.restaurants.getStaff.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  // ── Phase E (2026-05-02): 운영 SSOT + 임금 SSOT 인라인 편집 ──
  const updateEmployment = trpc.staff.updateEmployment.useMutation({
    onSuccess() {
      toast.success("저장됨");
      setEditingEmpField(null);
      utils.restaurants.getStaff.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const updateWage = trpc.staff.updateWage.useMutation({
    onSuccess() {
      toast.success("임금이 저장됨 (effectiveFrom 적용)");
      setEditingWage(null);
      utils.restaurants.getStaff.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const applyContractSnapshot = trpc.staff.applyContractSnapshot.useMutation({
    onSuccess(r) {
      toast.success(`계약서 값 ${r.fields}건이 직원정보에 반영됨`);
      utils.restaurants.getStaff.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const resignStaff = trpc.restaurants.resignStaff.useMutation({
    onSuccess() { toast.success("퇴사 처리 완료"); setResignTarget(null); setResignReason(""); utils.restaurants.getStaff.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const reinstateStaff = trpc.restaurants.reinstateStaff.useMutation({
    onSuccess() { toast.success("복직 처리 완료"); utils.restaurants.getStaff.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const sendContract = trpc.electronicContracts.sendContract.useMutation({
    onSuccess(data) {
      toast.success("계약서 발송됨");
      utils.electronicContracts.listEmploymentContracts.invalidate();
      if (data.token) {
        const url = `${window.location.origin}/sign/${data.token}`;
        const msg = `[근로계약서 서명]\n아래 링크를 눌러 계약서를 확인하고 서명해주세요.\n${url}`;
        navigator.clipboard.writeText(msg).then(() => toast.success("계약서 서명 링크가 클립보드에 복사되었습니다"));
      }
    },
    onError(err) { toast.error(err.message); },
  });

  const deleteContract = trpc.electronicContracts.deleteContract.useMutation({
    onSuccess() { toast.success("초안 삭제됨"); utils.electronicContracts.listEmploymentContracts.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  // 보건증 업로드 핸들러
  const [uploadingHealthCert, setUploadingHealthCert] = useState<number | null>(null);

  const handleHealthCertUpload = async (userId: number, file: File) => {
    setUploadingHealthCert(userId);
    try {
      // 1. 이미지 업로드
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      const { url: imageUrl } = await uploadRes.json();

      // 2. AI로 보건증 정보 추출
      let expiryDate: string | undefined;
      try {
        const ocrRes = await fetch("/api/ocr/extract-health-cert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl }),
        });
        const ocrData = await ocrRes.json();
        if (ocrData.expiryDate) expiryDate = ocrData.expiryDate;
        else if (ocrData.issueDate) {
          // 보건증 유효기간: 발급일로부터 1년
          const issue = new Date(ocrData.issueDate);
          issue.setFullYear(issue.getFullYear() + 1);
          expiryDate = issue.toISOString().slice(0, 10);
        }
      } catch {
        // OCR 실패해도 이미지는 저장
      }

      // 3. 서버에 저장
      await updateHealthCert.mutateAsync({
        userId,
        healthCertUrl: imageUrl,
        healthCertExpiry: expiryDate,
      });

      if (expiryDate) toast.success(`보건증 만료일: ${expiryDate}`);
      else toast.info("보건증 이미지 저장됨 (만료일 수동 입력 필요)");
    } catch (err: any) {
      toast.error("보건증 업로드 실패: " + err.message);
    } finally {
      setUploadingHealthCert(null);
    }
  };

  // 통장사본 업로드 핸들러
  const [uploadingBankBook, setUploadingBankBook] = useState<number | null>(null);

  const handleBankBookUpload = async (userId: number, file: File) => {
    setUploadingBankBook(userId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      const { url: imageUrl } = await uploadRes.json();
      await updateBankBook.mutateAsync({ userId, bankBookUrl: imageUrl });
    } catch (err: any) {
      toast.error("통장사본 업로드 실패: " + err.message);
    } finally {
      setUploadingBankBook(null);
    }
  };

  // 소속회사별 직원 수 집계
  const companyCounts: Record<string, number> = {};
  staffList?.forEach((s: any) => {
    const company = s.affiliatedCompany || "(미지정)";
    companyCounts[company] = (companyCounts[company] || 0) + 1;
  });
  // 회사명 → over5Employees(소속회사 마스터 기준) 맵
  const companyOver5Map = new Map<string, boolean>();
  affiliatedCompaniesList.forEach((c: any) => companyOver5Map.set(c.companyName, !!c.over5Employees));

  // 재설계 2026-05-02 Phase E: 17 항목 SSOT vs 최신 서명 박제 어긋남 판정 (갱신 필요 배너용)
  const computeNeedsRenewal = (s: any): { needs: boolean; fields: string[] } => {
    if (!s.latestContractSignedAt) return { needs: false, fields: [] };
    const f: string[] = [];
    const dateEq = (a: any, b: any): boolean => {
      const norm = (x: any) =>
        x == null || x === "" ? "" : String(x).slice(0, 10);
      return norm(a) === norm(b);
    };
    const numEq = (a: any, b: any): boolean => {
      if ((a == null || a === "") && (b == null || b === "")) return true;
      return Number(a) === Number(b);
    };
    const strEq = (a: any, b: any): boolean =>
      String(a ?? "").trim() === String(b ?? "").trim();
    const boolEq = (a: any, b: any): boolean => Boolean(a) === Boolean(b);

    // 기본
    if ((s.snapshotAffiliatedCompany ?? null) !== (s.affiliatedCompany ?? null)) f.push("소속회사");
    if (s.snapshotHireDate != null && !dateEq(s.snapshotHireDate, s.hireDate)) f.push("입사일");
    if ((s.snapshotWeeklyOffDays ?? null) !== (s.weeklyOffDays ?? null)) f.push("주휴무일수");
    if (s.snapshotOver5Employees != null && !boolEq(s.snapshotOver5Employees, s.effectiveOver5)) f.push("5인 여부");
    // 계약
    if ((s.snapshotContractType ?? null) != null || (s.contractType ?? null) != null) {
      if (!strEq(s.snapshotContractType, s.contractType)) f.push("계약유형");
    }
    if (s.snapshotContractStart != null || s.contractStart != null) {
      if (!dateEq(s.snapshotContractStart, s.contractStart)) f.push("계약시작");
    }
    if (s.snapshotContractEnd != null || s.contractEnd != null) {
      if (!dateEq(s.snapshotContractEnd, s.contractEnd)) f.push("계약종료");
    }
    // 근무
    if (s.snapshotWorkStartTime != null || s.workStartTime != null) {
      if (!strEq(s.snapshotWorkStartTime, s.workStartTime)) f.push("근무시작");
    }
    if (s.snapshotWorkEndTime != null || s.workEndTime != null) {
      if (!strEq(s.snapshotWorkEndTime, s.workEndTime)) f.push("근무종료");
    }
    if (s.snapshotBreakMinutes != null || s.breakMinutes != null) {
      if (!numEq(s.snapshotBreakMinutes, s.breakMinutes)) f.push("휴게시간");
    }
    if (s.snapshotWeeklyHours != null || s.weeklyHours != null) {
      if (!numEq(s.snapshotWeeklyHours, s.weeklyHours)) f.push("주근무시간");
    }
    // 세무
    if (s.snapshotTaxMode != null || s.taxMode != null) {
      if (!strEq(s.snapshotTaxMode, s.taxMode)) f.push("세무유형");
    }
    if (
      s.snapshotHourlyWageIncludesHolidayPay != null &&
      !boolEq(s.snapshotHourlyWageIncludesHolidayPay, s.hourlyWageIncludesHolidayPay)
    ) {
      f.push("주휴포함");
    }
    // 임금
    if (s.snapshotWageType != null || s.wageType != null || s.snapshotWage != null || s.wageAmount != null) {
      const typeMismatch = (s.snapshotWageType ?? "") !== (s.wageType ?? "");
      const amtMismatch = !numEq(s.snapshotWage, s.wageAmount);
      if (typeMismatch || amtMismatch) f.push("임금");
    }
    // 기타
    if (s.snapshotSpecialTerms != null || s.specialTerms != null) {
      if (!strEq(s.snapshotSpecialTerms, s.specialTerms)) f.push("특이사항");
    }
    return { needs: f.length > 0, fields: f };
  };

  if (!restaurantId || restaurantId <= 0) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Users className="w-5 h-5" /> 직원 관리
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{current?.name}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isOwnerOrAdmin && (
            <Button size="sm" onClick={() => setShowQuickAdd(true)} className="text-xs">
              <UserPlus className="w-3.5 h-3.5 mr-1" /> 직원 추가
            </Button>
          )}
          {isOwnerOrAdmin && (
            <Button size="sm" variant="outline" onClick={() => setShowContractForm(true)} className="text-xs">
              <FileText className="w-3.5 h-3.5 mr-1" /> 계약서
            </Button>
          )}
          <Button size="sm" variant={showInviteSection ? "secondary" : "outline"} onClick={() => setShowInviteSection(!showInviteSection)} className="text-xs">
            <UserPlus className="w-3.5 h-3.5 mr-1" /> 초대
          </Button>
        </div>
      </div>

      {/* ═══ 지난 3개월 나간 사람 (재입사 빠른 복귀) ═══ */}
      {isOwnerOrAdmin && recentlyResigned && recentlyResigned.length > 0 && (
        <div className="border border-border rounded-lg bg-card">
          <button
            onClick={() => setShowRecentlyResigned(!showRecentlyResigned)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent/20 transition-colors"
          >
            <div className="flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">지난 3개월 나간 사람</span>
              <span className="text-[11px] text-muted-foreground">{recentlyResigned.length}명</span>
            </div>
            {showRecentlyResigned ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {showRecentlyResigned && (
            <div className="border-t border-border px-4 py-3 space-y-2 bg-muted/20">
              {recentlyResigned.map((r: any) => (
                <div key={r.userId} className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-background border border-border">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {STORE_ROLE_LABELS[r.storeRole] || r.storeRole} · {r.phone || "연락처 없음"} · 퇴사 {r.resignedAt}
                      {r.resignReason && ` — ${r.resignReason}`}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] shrink-0"
                    disabled={!r.phone || quickAdd.isPending}
                    onClick={() => {
                      if (!r.phone) {
                        toast.error("전화번호가 없어 재입사 처리할 수 없습니다");
                        return;
                      }
                      if (!confirm(`${r.name}을(를) 다시 등록합니다. 역할은 "${STORE_ROLE_LABELS[r.storeRole] || "직원"}"으로 복원됩니다.`)) return;
                      quickAdd.mutate({
                        restaurantId,
                        name: r.name,
                        phone: r.phone,
                        role: (r.storeRole === "supervisor" ? "supervisor" : "staff"),
                        sendInvite: false,
                      });
                    }}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" /> 복귀
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ 초대코드 섹션 ═══ */}
      {showInviteSection && (
        <div className="border border-border rounded-lg bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">초대코드로 직원 등록</h3>
            <div className="flex items-center gap-2">
              <select
                className="text-xs rounded-md border border-input bg-background px-2 py-1"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "staff" | "supervisor" | "owner")}
              >
                <option value="staff">직원</option>
                <option value="supervisor">매니져</option>
                {isAdmin && <option value="owner">점장</option>}
              </select>
              <Button
                size="sm"
                onClick={() => generateInvite.mutate({ restaurantId, role: inviteRole })}
                disabled={generateInvite.isPending}
              >
                {generateInvite.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                코드 생성
              </Button>
            </div>
          </div>
          <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2 space-y-0.5">
            <p>1. 아래에서 역할을 선택하고 "코드 생성"을 누르세요</p>
            <p>2. 생성된 링크가 자동 복사됩니다 → 직원에게 카톡 등으로 전달</p>
            <p>3. 직원이 링크를 열어 이름/ID/비밀번호를 입력하면 자동으로 매장에 등록됩니다</p>
            <p className="text-muted-foreground/70">유효기간: 48시간</p>
          </div>
          {inviteList && inviteList.length > 0 && (
            <div className="space-y-2">
              {inviteList.map((inv: any) => {
                const joinUrl = `${window.location.origin}/join/${inv.code}`;
                return (
                  <div key={inv.id} className={`flex items-center justify-between px-3 py-2 rounded-md border text-xs ${
                    inv.isUsed ? "bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800" :
                    inv.isExpired ? "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 opacity-60" :
                    "bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800"
                  }`}>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="font-mono font-bold">{inv.code}</span>
                      <span className="text-muted-foreground">
                        {inv.role === "owner" ? "점장" : inv.role === "supervisor" ? "매니져" : "직원"}
                      </span>
                      {inv.isUsed && <span className="text-green-600 dark:text-green-400">사용됨 ({inv.usedByName})</span>}
                      {!inv.isUsed && inv.isExpired && <span className="text-muted-foreground">만료</span>}
                      {!inv.isUsed && !inv.isExpired && <span className="text-blue-600 dark:text-blue-400">활성</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      {!inv.isUsed && !inv.isExpired && (
                        <button
                          onClick={() => { navigator.clipboard.writeText(joinUrl); toast.success("링크 복사됨"); }}
                          className="p-1 rounded hover:bg-accent" title="링크 복사"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {!inv.isUsed && (
                        <button
                          onClick={() => { if (confirm("삭제하시겠습니까?")) deleteInvite.mutate({ id: inv.id }); }}
                          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500" title="삭제"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 소속회사별 요약 + 직원수 */}
      {staffList && staffList.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Users className="w-3 h-3" /> 총 {staffList.length}명
            </span>
          </div>
          {Object.keys(companyCounts).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(companyCounts).map(([company, count]) => {
                const over5 = companyOver5Map.get(company);
                return (
                  <div key={company} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-xs">
                    <Building2 className="w-3 h-3 text-muted-foreground" />
                    <span className="font-medium">{company}</span>
                    <span className="text-muted-foreground">{count}명</span>
                    {over5 != null && (
                      <span className={`ml-1 font-medium ${over5 ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400"}`}>
                        {over5 ? "5인↑" : "5인↓"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 퇴사자 포함 토글 */}
      <div className="flex items-center justify-end gap-2 mb-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={showResigned} onChange={(e) => setShowResigned(e.target.checked)} className="rounded" />
          퇴사자 포함
        </label>
      </div>

      {/* 직원 목록 */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">로딩 중...</div>
      ) : !staffList?.length ? (
        <div className="text-center py-12 bg-card border border-border rounded-lg">
          <Users className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium text-muted-foreground mb-1">배정된 직원이 없습니다</p>
          <p className="text-xs text-muted-foreground mb-4">초대 링크를 생성하여 직원을 추가하세요</p>
          <Button size="sm" variant="outline" onClick={() => setShowInviteSection(true)} className="text-xs">
            <UserPlus className="w-3.5 h-3.5 mr-1" /> 초대 링크 생성
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {staffList.map((s: any) => {
            const isExpanded = expandedStaff === s.userId;
            const healthStatus = getHealthCertStatus(s.healthCertExpiry);

            return (
              <div key={s.id} className="border border-border rounded-lg bg-card overflow-hidden">
                {/* 메인 행 */}
                <div
                  className="px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-accent/30 transition-colors"
                  onClick={() => setExpandedStaff(isExpanded ? null : s.userId)}
                >
                  {/* 왼쪽: 이름 + 메타 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{s.name}</span>
                      {/* 역할 배지 */}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        s.storeRole === "owner" ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800" :
                        s.storeRole === "supervisor" ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800" :
                        "border border-border text-muted-foreground"
                      }`}>
                        {STORE_ROLE_LABELS[s.storeRole] || s.storeRole}
                      </span>
                      {/* 소속회사 배지 */}
                      {s.affiliatedCompany && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-muted-foreground">
                          {s.affiliatedCompany}
                        </span>
                      )}
                      {/* 퇴사 배지 */}
                      {s.resignedAt && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 font-medium">
                          퇴사 {s.resignedAt}
                        </span>
                      )}
                      {/* 보건증 경고 */}
                      {healthStatus?.urgent && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${healthStatus.bg} ${healthStatus.color}`}>
                          <AlertTriangle className="w-3 h-3 inline mr-0.5" />보건증 {healthStatus.label}
                        </span>
                      )}
                      {/* 계약서 미작성 */}
                      {isOwnerOrAdmin && contracts && !contracts.some((c: any) => c.employeeId === s.userId) && !s.resignedAt && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
                          계약서 없음
                        </span>
                      )}
                    </div>
                    {/* 부가 정보 행 */}
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-0.5">@{s.username}</span>
                      {s.phone && (
                        <span className="flex items-center gap-0.5">
                          <Phone className="w-3 h-3" />{s.phone}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* 오른쪽: 펼침 */}
                  <div className="pt-1 shrink-0">
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </div>

                {/* 확장 패널 */}
                {isExpanded && (() => {
                  const renewal = computeNeedsRenewal(s);
                  return (
                  <div className="border-t border-border px-4 py-3 space-y-3 bg-muted/30">
                    {/* 운영 SSOT 안내: 직원정보 필드가 스케줄·인건비 정산의 기준 */}
                    <div className="text-[11px] rounded-md px-3 py-2 bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20 leading-relaxed">
                      <Info className="w-3 h-3 inline mr-1" />
                      <strong>직원 정보 필드가 기준입니다.</strong> 아래 입력값으로 스케줄과 인건비 정산이 계산됩니다. 계약서는 법적 박제용입니다.
                    </div>
                    {/* SSOT-스냅샷 어긋날 때 갱신 필요 배너 + [계약서 값으로 채우기] 버튼 */}
                    {renewal.needs && (
                      <div className="text-[11px] rounded-md px-3 py-2 bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                        <div className="flex items-start gap-2 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <AlertTriangle className="w-3 h-3 inline mr-1" />
                            계약서 갱신 필요 — 직원정보가 최신 서명 계약서와 다릅니다 ({renewal.fields.join(", ")}).
                          </div>
                          {isOwnerOrAdmin && (
                            <button
                              onClick={() => {
                                if (confirm(`최신 서명 계약서의 박제값으로 직원정보를 일괄 덮어씁니다.\n어긋난 항목: ${renewal.fields.join(", ")}\n진행할까요?`)) {
                                  applyContractSnapshot.mutate({ restaurantId, userId: s.userId });
                                }
                              }}
                              disabled={applyContractSnapshot.isPending}
                              className="text-[11px] px-2 py-1 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap"
                            >
                              계약서 값으로 채우기
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 역할 변경 */}
                    {canChangeRole && (
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-medium text-muted-foreground w-16 flex items-center gap-1">
                          <UserCog className="w-3 h-3" /> 역할
                        </label>
                        <select
                          className="text-xs px-2 py-1.5 rounded-md border border-input bg-background"
                          value={s.storeRole}
                          onChange={(e) => updateRole.mutate({ restaurantId, userId: s.userId, role: e.target.value as any })}
                        >
                          <option value="owner">점장</option>
                          <option value="supervisor">매니져</option>
                          <option value="staff">직원</option>
                        </select>
                      </div>
                    )}

                    {/* 소속회사 (재설계 2026-05-02: free text → select) */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="text-xs font-medium text-muted-foreground w-16 flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> 소속
                      </label>
                      {editingCompany?.userId === s.userId ? (
                        <div className="flex items-center gap-2 flex-1">
                          <select
                            className="text-xs px-2 py-1.5 rounded border border-input bg-background flex-1 max-w-[220px]"
                            value={editingCompany!.value}
                            onChange={(e) => setEditingCompany({ userId: s.userId, value: e.target.value })}
                            autoFocus
                          >
                            <option value="">(미지정)</option>
                            {affiliatedCompaniesList.map((c: any) => (
                              <option key={c.id} value={c.companyName}>
                                {c.companyName} {c.over5Employees ? "(5인↑)" : "(5인↓)"}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => updateCompany.mutate({ restaurantId, userId: s.userId, affiliatedCompany: editingCompany!.value || null })}
                            className="p-1 rounded hover:bg-accent text-green-600"
                          ><Check className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setEditingCompany(null)} className="p-1 rounded hover:bg-accent text-muted-foreground">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-foreground">{s.affiliatedCompany || "(미지정)"}</span>
                          {/* 5인 미만/이상 배지 (소속회사 마스터 기준, 읽기 전용) */}
                          {s.affiliatedCompany && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                              s.effectiveOver5 ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" : "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                            }`}>
                              {s.effectiveOver5 ? "5인 이상" : "5인 미만"}
                            </span>
                          )}
                          <button
                            onClick={() => setEditingCompany({ userId: s.userId, value: s.affiliatedCompany || "" })}
                            className="p-1 rounded hover:bg-accent text-muted-foreground"
                          ><Edit3 className="w-3 h-3" /></button>
                        </div>
                      )}
                      {affiliatedCompaniesList.length === 0 && editingCompany?.userId === s.userId && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 basis-full">
                          ⚠ 등록된 소속회사가 없습니다. 매장 정보에서 먼저 등록하세요.
                        </span>
                      )}
                    </div>

                    {/* 입사일 */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium text-muted-foreground w-16 flex items-center gap-1">
                        <CalendarDays className="w-3 h-3" /> 입사일
                      </label>
                      {editingHireDate?.userId === s.userId ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="date"
                            className="text-xs px-2 py-1 rounded border border-input bg-background"
                            value={editingHireDate!.value}
                            onChange={(e) => setEditingHireDate({ userId: s.userId, value: e.target.value })}
                            autoFocus
                          />
                          <button
                            onClick={() => updateHireDate.mutate({ restaurantId, userId: s.userId, hireDate: editingHireDate!.value || null })}
                            className="p-1 rounded hover:bg-accent text-green-600"
                          ><Check className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setEditingHireDate(null)} className="p-1 rounded hover:bg-accent text-muted-foreground">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-foreground">{s.hireDate ? formatKoreanDate(s.hireDate) : "(미설정)"}</span>
                          <button
                            onClick={() => setEditingHireDate({ userId: s.userId, value: String(s.hireDate || "").slice(0, 10) })}
                            className="p-1 rounded hover:bg-accent text-muted-foreground"
                          ><Edit3 className="w-3 h-3" /></button>
                        </div>
                      )}
                    </div>

                    {/* 주당 휴무 (재설계 2026-05-02: 1·2·3) */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium text-muted-foreground w-16 flex items-center gap-1">
                        <CalendarDays className="w-3 h-3" /> 휴무
                      </label>
                      {editingOffDays?.userId === s.userId ? (
                        <div className="flex items-center gap-2 flex-1">
                          <select
                            className="text-xs px-2 py-1 rounded border border-input bg-background"
                            value={editingOffDays!.value}
                            onChange={(e) => setEditingOffDays({ userId: s.userId, value: Number(e.target.value) })}
                            autoFocus
                          >
                            {[1,2,3].map(v => (
                              <option key={v} value={v}>주 {v}일</option>
                            ))}
                          </select>
                          <button
                            onClick={() => updateWeeklyOffDays.mutate({ restaurantId, userId: s.userId, weeklyOffDays: editingOffDays!.value })}
                            className="p-1 rounded hover:bg-accent text-green-600"
                          ><Check className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setEditingOffDays(null)} className="p-1 rounded hover:bg-accent text-muted-foreground">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-foreground">주 {s.weeklyOffDays ?? 1}일</span>
                          <button
                            onClick={() => {
                              const v = s.weeklyOffDays ?? 1;
                              setEditingOffDays({ userId: s.userId, value: v >= 1 && v <= 3 ? v : 1 });
                            }}
                            className="p-1 rounded hover:bg-accent text-muted-foreground"
                          ><Edit3 className="w-3 h-3" /></button>
                        </div>
                      )}
                    </div>

                    {/* ─── Phase E (2026-05-02): 운영 SSOT 영역 ─── */}
                    {isOwnerOrAdmin && (() => {
                      const isField = (field: string) =>
                        editingEmpField?.userId === s.userId && editingEmpField.field === field;
                      const startEdit = (field: string, value: any) =>
                        setEditingEmpField({ userId: s.userId, field, value });
                      const saveEmp = (patch: Record<string, any>) =>
                        updateEmployment.mutate({ restaurantId, userId: s.userId, ...patch });

                      return (
                        <>
                          {/* [계약] */}
                          <div className="border-t border-border pt-2 mt-1">
                            <div className="text-[11px] font-semibold text-muted-foreground mb-2">계약</div>
                            {/* 계약유형 */}
                            <div className="flex items-center gap-3 mb-1">
                              <label className="text-xs text-muted-foreground w-20">계약유형</label>
                              {isField("contractType") ? (
                                <div className="flex items-center gap-2 flex-1">
                                  <select className="text-xs px-2 py-1 rounded border border-input bg-background"
                                    value={editingEmpField!.value ?? "part_time"}
                                    onChange={(e) => setEditingEmpField({ ...editingEmpField!, value: e.target.value })}>
                                    <option value="permanent">정규직</option>
                                    <option value="fixed_term">계약직</option>
                                    <option value="part_time">파트타임</option>
                                    <option value="daily">일용직</option>
                                  </select>
                                  <button onClick={() => saveEmp({ contractType: editingEmpField!.value })} className="p-1 rounded hover:bg-accent text-green-600"><Check className="w-3.5 h-3.5" /></button>
                                  <button onClick={() => setEditingEmpField(null)} className="p-1 rounded hover:bg-accent text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-foreground">{
                                    { permanent: "정규직", fixed_term: "계약직", part_time: "파트타임", daily: "일용직" }[s.contractType as string] || "(미설정)"
                                  }</span>
                                  <button onClick={() => startEdit("contractType", s.contractType || "part_time")} className="p-1 rounded hover:bg-accent text-muted-foreground"><Edit3 className="w-3 h-3" /></button>
                                </div>
                              )}
                            </div>
                            {/* 계약시작/종료 */}
                            <div className="flex items-center gap-3 mb-1">
                              <label className="text-xs text-muted-foreground w-20">계약시작</label>
                              {isField("contractStart") ? (
                                <div className="flex items-center gap-2 flex-1">
                                  <input type="date" className="text-xs px-2 py-1 rounded border border-input bg-background"
                                    value={editingEmpField!.value ?? ""}
                                    onChange={(e) => setEditingEmpField({ ...editingEmpField!, value: e.target.value })} />
                                  <button onClick={() => saveEmp({ contractStart: editingEmpField!.value || null })} className="p-1 rounded hover:bg-accent text-green-600"><Check className="w-3.5 h-3.5" /></button>
                                  <button onClick={() => setEditingEmpField(null)} className="p-1 rounded hover:bg-accent text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-foreground">{s.contractStart ? String(s.contractStart).slice(0, 10) : "(미설정)"}</span>
                                  <button onClick={() => startEdit("contractStart", s.contractStart ? String(s.contractStart).slice(0, 10) : "")} className="p-1 rounded hover:bg-accent text-muted-foreground"><Edit3 className="w-3 h-3" /></button>
                                </div>
                              )}
                            </div>
                            <div className="flex items-start gap-3">
                              <label className="text-xs text-muted-foreground w-20 mt-1">계약종료</label>
                              {isField("contractEnd") ? (
                                <div className="flex flex-col gap-1 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <input type="date" className="text-xs px-2 py-1 rounded border border-input bg-background"
                                      value={editingEmpField!.value ?? ""}
                                      onChange={(e) => setEditingEmpField({ ...editingEmpField!, value: e.target.value })} />
                                    <button onClick={() => saveEmp({ contractEnd: editingEmpField!.value || null })} className="p-1 rounded hover:bg-accent text-green-600"><Check className="w-3.5 h-3.5" /></button>
                                    <button onClick={() => setEditingEmpField(null)} className="p-1 rounded hover:bg-accent text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                                  </div>
                                  {/* 시작일 기준 빠른 자동완성 */}
                                  {s.contractStart && (() => {
                                    const start = new Date(String(s.contractStart).slice(0, 10));
                                    const addMonthsEnd = (months: number) => {
                                      const d = new Date(start);
                                      d.setMonth(d.getMonth() + months);
                                      d.setDate(d.getDate() - 1);
                                      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                                    };
                                    const set = (v: string) => setEditingEmpField({ ...editingEmpField!, value: v });
                                    return (
                                      <div className="flex items-center gap-1 flex-wrap text-[10px]">
                                        <span className="text-muted-foreground">자동:</span>
                                        <button onClick={() => set(addMonthsEnd(1))} className="px-1.5 py-0.5 rounded border border-border hover:bg-accent">+1개월</button>
                                        <button onClick={() => set(addMonthsEnd(3))} className="px-1.5 py-0.5 rounded border border-border hover:bg-accent">+3개월</button>
                                        <button onClick={() => set(addMonthsEnd(12))} className="px-1.5 py-0.5 rounded border border-border hover:bg-accent">+1년</button>
                                        <button onClick={() => set("")} className="px-1.5 py-0.5 rounded border border-border hover:bg-accent">무기한</button>
                                      </div>
                                    );
                                  })()}
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs text-foreground">{s.contractEnd ? String(s.contractEnd).slice(0, 10) : "(무기한)"}</span>
                                  <button onClick={() => startEdit("contractEnd", s.contractEnd ? String(s.contractEnd).slice(0, 10) : "")} className="p-1 rounded hover:bg-accent text-muted-foreground"><Edit3 className="w-3 h-3" /></button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* [근무] */}
                          <div className="border-t border-border pt-2 mt-1">
                            <div className="text-[11px] font-semibold text-muted-foreground mb-2">근무</div>
                            <div className="flex items-center gap-3 mb-1">
                              <label className="text-xs text-muted-foreground w-20">시작/종료</label>
                              {isField("workTime") ? (
                                <div className="flex items-center gap-2 flex-1">
                                  <input type="time" className="text-xs px-2 py-1 rounded border border-input bg-background"
                                    value={editingEmpField!.value?.start ?? "09:00"}
                                    onChange={(e) => setEditingEmpField({ ...editingEmpField!, value: { ...editingEmpField!.value, start: e.target.value } })} />
                                  <span className="text-xs">~</span>
                                  <input type="time" className="text-xs px-2 py-1 rounded border border-input bg-background"
                                    value={editingEmpField!.value?.end ?? "18:00"}
                                    onChange={(e) => setEditingEmpField({ ...editingEmpField!, value: { ...editingEmpField!.value, end: e.target.value } })} />
                                  <button onClick={() => saveEmp({ workStartTime: editingEmpField!.value.start, workEndTime: editingEmpField!.value.end })} className="p-1 rounded hover:bg-accent text-green-600"><Check className="w-3.5 h-3.5" /></button>
                                  <button onClick={() => setEditingEmpField(null)} className="p-1 rounded hover:bg-accent text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-foreground">{s.workStartTime ?? "09:00"} ~ {s.workEndTime ?? "18:00"}</span>
                                  <button onClick={() => startEdit("workTime", { start: s.workStartTime ?? "09:00", end: s.workEndTime ?? "18:00" })} className="p-1 rounded hover:bg-accent text-muted-foreground"><Edit3 className="w-3 h-3" /></button>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mb-1">
                              <label className="text-xs text-muted-foreground w-20">휴게(분)</label>
                              {isField("breakMinutes") ? (
                                <div className="flex items-center gap-2 flex-1">
                                  <input type="number" min="0" max="480" className="text-xs px-2 py-1 rounded border border-input bg-background w-20"
                                    value={editingEmpField!.value ?? 60}
                                    onChange={(e) => setEditingEmpField({ ...editingEmpField!, value: Number(e.target.value) })} />
                                  <button onClick={() => saveEmp({ breakMinutes: Number(editingEmpField!.value) })} className="p-1 rounded hover:bg-accent text-green-600"><Check className="w-3.5 h-3.5" /></button>
                                  <button onClick={() => setEditingEmpField(null)} className="p-1 rounded hover:bg-accent text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-foreground">{s.breakMinutes ?? 60}분</span>
                                  <button onClick={() => startEdit("breakMinutes", s.breakMinutes ?? 60)} className="p-1 rounded hover:bg-accent text-muted-foreground"><Edit3 className="w-3 h-3" /></button>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <label className="text-xs text-muted-foreground w-20">주근무시간</label>
                              {isField("weeklyHours") ? (
                                <div className="flex items-center gap-2 flex-1">
                                  <input type="number" min="0" max="80" step="0.5" className="text-xs px-2 py-1 rounded border border-input bg-background w-20"
                                    value={editingEmpField!.value ?? "40"}
                                    onChange={(e) => setEditingEmpField({ ...editingEmpField!, value: e.target.value })} />
                                  <button onClick={() => saveEmp({ weeklyHours: String(editingEmpField!.value) })} className="p-1 rounded hover:bg-accent text-green-600"><Check className="w-3.5 h-3.5" /></button>
                                  <button onClick={() => setEditingEmpField(null)} className="p-1 rounded hover:bg-accent text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-foreground">{s.weeklyHours ?? "40"}시간</span>
                                  <button onClick={() => startEdit("weeklyHours", s.weeklyHours ?? "40")} className="p-1 rounded hover:bg-accent text-muted-foreground"><Edit3 className="w-3 h-3" /></button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* [세무] */}
                          <div className="border-t border-border pt-2 mt-1">
                            <div className="text-[11px] font-semibold text-muted-foreground mb-2">세무</div>
                            <div className="flex items-center gap-3 mb-1">
                              <label className="text-xs text-muted-foreground w-20">유형</label>
                              <div className="flex items-center gap-3">
                                <label className="flex items-center gap-1 text-xs">
                                  <input type="radio" checked={s.taxMode === "social_insurance"} onChange={() => saveEmp({ taxMode: "social_insurance" })} /> 4대보험
                                </label>
                                <label className="flex items-center gap-1 text-xs">
                                  <input type="radio" checked={s.taxMode === "biz_income_3_3"} onChange={() => saveEmp({ taxMode: "biz_income_3_3" })} /> 3.3% 사업소득
                                </label>
                              </div>
                            </div>
                          </div>

                          {/* [임금] */}
                          <div className="border-t border-border pt-2 mt-1">
                            <div className="text-[11px] font-semibold text-muted-foreground mb-2">임금</div>
                            {editingWage?.userId === s.userId ? (
                              <div className="space-y-2">
                                <div className="flex items-center gap-3">
                                  <label className="text-xs text-muted-foreground w-20">유형</label>
                                  <div className="flex items-center gap-3">
                                    <label className="flex items-center gap-1 text-xs">
                                      <input type="radio" checked={editingWage.wageType === "hourly"} onChange={() => setEditingWage({ ...editingWage, wageType: "hourly" })} /> 시급
                                    </label>
                                    <label className="flex items-center gap-1 text-xs">
                                      <input type="radio" checked={editingWage.wageType === "monthly"} onChange={() => setEditingWage({ ...editingWage, wageType: "monthly" })} /> 월급
                                    </label>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <label className="text-xs text-muted-foreground w-20">금액</label>
                                  <input type="number" min="0" className="text-xs px-2 py-1 rounded border border-input bg-background w-32"
                                    value={editingWage.wageAmount}
                                    onChange={(e) => setEditingWage({ ...editingWage, wageAmount: e.target.value })} />
                                  <span className="text-xs text-muted-foreground">원</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <label className="text-xs text-muted-foreground w-20">적용일</label>
                                  <input type="date" className="text-xs px-2 py-1 rounded border border-input bg-background"
                                    value={editingWage.effectiveFrom}
                                    onChange={(e) => setEditingWage({ ...editingWage, effectiveFrom: e.target.value })} />
                                </div>
                                <div className="flex items-center gap-2 pt-1">
                                  <button onClick={() => updateWage.mutate(editingWage)} className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground">저장</button>
                                  <button onClick={() => setEditingWage(null)} className="px-3 py-1 text-xs rounded border border-input">취소</button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-3">
                                <label className="text-xs text-muted-foreground w-20">현재</label>
                                <div className="flex items-center gap-2 flex-wrap flex-1">
                                  {s.wageType ? (
                                    <span className="text-xs text-foreground font-medium">
                                      {s.wageType === "hourly" ? "시급" : "월급"} {formatKRW(Number(s.wageAmount ?? 0))}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">(미설정)</span>
                                  )}
                                  {s.wageEffectiveFrom && (
                                    <span className="text-[10px] text-muted-foreground">{String(s.wageEffectiveFrom).slice(0, 10)} 부터</span>
                                  )}
                                  <button onClick={() => {
                                    const today = new Date();
                                    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
                                    setEditingWage({
                                      userId: s.userId,
                                      wageType: (s.wageType as any) ?? "hourly",
                                      wageAmount: String(s.wageAmount ?? "0"),
                                      effectiveFrom: nextMonth.toISOString().slice(0, 10),
                                    });
                                  }} className="p-1 rounded hover:bg-accent text-muted-foreground"><Edit3 className="w-3 h-3" /></button>
                                </div>
                              </div>
                            )}
                            {/* 시급제: 주휴포함 여부 */}
                            {s.wageType === "hourly" && (
                              <div className="flex items-center gap-3 mt-1">
                                <label className="text-xs text-muted-foreground w-20">주휴포함</label>
                                <label className="flex items-center gap-1 text-xs cursor-pointer">
                                  <input type="checkbox" checked={!!s.hourlyWageIncludesHolidayPay}
                                    onChange={(e) => saveEmp({ hourlyWageIncludesHolidayPay: e.target.checked })} />
                                  시급에 주휴수당 포함 (주15h 미만은 미발생)
                                </label>
                              </div>
                            )}
                          </div>

                          {/* [기타] */}
                          <div className="border-t border-border pt-2 mt-1">
                            <div className="text-[11px] font-semibold text-muted-foreground mb-2">기타</div>
                            <div className="flex items-start gap-3">
                              <label className="text-xs text-muted-foreground w-20 pt-1">특이사항</label>
                              {isField("specialTerms") ? (
                                <div className="flex items-start gap-2 flex-1">
                                  <textarea className="text-xs px-2 py-1 rounded border border-input bg-background flex-1" rows={2}
                                    value={editingEmpField!.value ?? ""}
                                    onChange={(e) => setEditingEmpField({ ...editingEmpField!, value: e.target.value })} />
                                  <button onClick={() => saveEmp({ specialTerms: editingEmpField!.value || null })} className="p-1 rounded hover:bg-accent text-green-600"><Check className="w-3.5 h-3.5" /></button>
                                  <button onClick={() => setEditingEmpField(null)} className="p-1 rounded hover:bg-accent text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 flex-1">
                                  <span className="text-xs text-foreground flex-1 whitespace-pre-wrap">{s.specialTerms || "(없음)"}</span>
                                  <button onClick={() => startEdit("specialTerms", s.specialTerms || "")} className="p-1 rounded hover:bg-accent text-muted-foreground"><Edit3 className="w-3 h-3" /></button>
                                </div>
                              )}
                            </div>
                          </div>
                        </>
                      );
                    })()}

                    {/* ID/비밀번호 수정 */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium text-muted-foreground w-16 flex items-center gap-1">
                        <KeyRound className="w-3 h-3" /> 계정
                      </label>
                      <Button
                        size="sm" variant="outline"
                        className="h-7 text-xs"
                        onClick={() => setEditingCredentials({ userId: s.userId, name: s.name, username: s.username, phone: s.phone || "", newUsername: s.username, newPassword: "", newName: s.name, newPhone: s.phone || "" })}
                      >
                        <KeyRound className="w-3 h-3 mr-1" /> ID/비밀번호 수정
                      </Button>
                    </div>

                    {/* 보건증 */}
                    <div className="flex items-start gap-3">
                      <label className="text-xs font-medium text-muted-foreground w-16 pt-1 flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" /> 보건증
                      </label>
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            id={`health-cert-${s.userId}`}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleHealthCertUpload(s.userId, file);
                              e.target.value = "";
                            }}
                          />
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-xs"
                            onClick={() => document.getElementById(`health-cert-${s.userId}`)?.click()}
                            disabled={uploadingHealthCert === s.userId}
                          >
                            {uploadingHealthCert === s.userId ? (
                              <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> 분석 중...</>
                            ) : (
                              <><Camera className="w-3 h-3 mr-1" /> {s.healthCertUrl ? "재업로드" : "업로드"}</>
                            )}
                          </Button>
                          {s.healthCertUrl && (
                            <a href={s.healthCertUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                              이미지 보기
                            </a>
                          )}
                        </div>
                        {/* 만료일 표시 */}
                        {healthStatus ? (
                          <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded ${healthStatus.bg} ${healthStatus.color}`}>
                            {healthStatus.urgent ? <AlertTriangle className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                            만료: {s.healthCertExpiry} ({healthStatus.label})
                          </div>
                        ) : s.healthCertUrl ? (
                          <span className="text-xs text-muted-foreground">만료일 정보 없음</span>
                        ) : null}
                      </div>
                    </div>

                    {/* 통장사본 */}
                    <div className="flex items-start gap-3">
                      <label className="text-xs font-medium text-muted-foreground w-16 pt-1 flex items-center gap-1">
                        <Wallet className="w-3 h-3" /> 통장사본
                      </label>
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          id={`bank-book-${s.userId}`}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleBankBookUpload(s.userId, file);
                            e.target.value = "";
                          }}
                        />
                        <Button
                          size="sm" variant="outline"
                          className="h-7 text-xs"
                          onClick={() => document.getElementById(`bank-book-${s.userId}`)?.click()}
                          disabled={uploadingBankBook === s.userId}
                        >
                          {uploadingBankBook === s.userId ? (
                            <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> 업로드 중...</>
                          ) : (
                            <><Camera className="w-3 h-3 mr-1" /> {s.bankBookUrl ? "재업로드" : "업로드"}</>
                          )}
                        </Button>
                        {s.bankBookUrl && (
                          <a href={s.bankBookUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                            이미지 보기
                          </a>
                        )}
                      </div>
                    </div>

                    {/* 퇴사/복직 */}
                    <div className="flex items-center gap-3 pt-2 border-t border-border flex-wrap">
                      {s.resignedAt ? (
                        <button
                          onClick={() => {
                            if (confirm(`${s.name}을(를) 복직 처리하시겠습니까?`))
                              reinstateStaff.mutate({ restaurantId, userId: s.userId });
                          }}
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                        >
                          <RefreshCw className="w-3 h-3" /> 복직 처리
                        </button>
                      ) : (
                        <button
                          onClick={() => { setResignTarget({ userId: s.userId, name: s.name }); setResignDate(new Date().toISOString().slice(0, 10)); setResignReason(""); }}
                          className="text-xs text-orange-600 hover:underline flex items-center gap-1"
                        >
                          <X className="w-3 h-3" /> 퇴사 처리
                        </button>
                      )}
                    </div>
                  </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      {/* 근로계약서 목록 — 점장 이상 표시 */}
      {isOwnerOrAdmin && contracts && contracts.length > 0 && (() => {
        const activeContracts = contracts.filter((c: any) => !c.resignedAt);
        const resignedContracts = contracts.filter((c: any) => c.resignedAt);
        const displayContracts = showResignedContracts ? contracts : activeContracts;
        return (
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">근로계약서</h2>
            <span className="text-xs text-muted-foreground">{activeContracts.length}건</span>
            {resignedContracts.length > 0 && (
              <button
                onClick={() => setShowResignedContracts(!showResignedContracts)}
                className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${showResignedContracts ? "border-orange-300 bg-orange-50 text-orange-600 dark:border-orange-700 dark:bg-orange-900/30 dark:text-orange-400" : "border-input text-muted-foreground hover:bg-accent"}`}
              >
                퇴사자 {resignedContracts.length}건 {showResignedContracts ? "숨기기" : "보기"}
              </button>
            )}
          </div>
          <div className="space-y-2">
            {displayContracts.map((c: any) => {
              const statusMap: Record<string, { label: string; color: string; icon: string }> = {
                draft: { label: "초안", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400", icon: "📝" },
                sent: { label: "서명 대기중", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300", icon: "📨" },
                signed: { label: "서명 완료", color: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300", icon: "✅" },
                expired: { label: "만료", color: "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400", icon: "⏰" },
                cancelled: { label: "취소됨", color: "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400", icon: "❌" },
              };
              const st = statusMap[c.status] ?? statusMap.draft;
              const isResigned = !!c.resignedAt;
              const signUrl = `${window.location.origin}/sign/${c.token}`;
              const copyLink = () => {
                const msg = `[근로계약서 서명]\n아래 링크를 눌러 계약서를 확인하고 서명해주세요.\n${signUrl}`;
                navigator.clipboard.writeText(msg).then(() => toast.success("계약서 서명 링크가 클립보드에 복사되었습니다"));
              };
              return (
                <div key={c.id} className={`border rounded-lg overflow-hidden ${isResigned ? "border-orange-200 bg-orange-50/30 dark:border-orange-800 dark:bg-orange-950/20" : "border-border bg-card"}`}>
                  {/* 상단: 직원 정보 + 상태 */}
                  <div className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-semibold ${isResigned ? "text-muted-foreground line-through" : "text-foreground"}`}>{c.employeeName}</span>
                          {isResigned && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-400">퇴사</span>}
                          {c.affiliatedCompany && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-muted-foreground">{c.affiliatedCompany}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Briefcase className="w-3 h-3" />
                            {c.wageType === "hourly" ? "시급" : "월급"} {Number(c.wageAmount).toLocaleString()}원
                          </span>
                          <span className="flex items-center gap-1">
                            <CalendarDays className="w-3 h-3" />
                            {String(c.contractStart).slice(0, 10)}
                            {c.contractEnd ? ` ~ ${String(c.contractEnd).slice(0, 10)}` : " ~"}
                          </span>
                        </div>
                        {c.signedAt && (
                          <div className="text-[11px] text-green-600 dark:text-green-400 mt-1 flex items-center gap-1">
                            <Check className="w-3 h-3" /> 서명일: {String(c.signedAt).slice(0, 10)}
                          </div>
                        )}
                      </div>
                      <span className={`text-[10px] px-2 py-1 rounded-md font-medium whitespace-nowrap ${st.color}`}>
                        {st.label}
                      </span>
                    </div>
                  </div>

                  {/* 하단: 액션 버튼들 */}
                  <div className="border-t border-border bg-muted/20 px-4 py-2 flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => window.open(signUrl, "_blank")}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-md hover:bg-accent transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" /> 근로계약서 미리보기
                    </button>
                    {c.status === "signed" && (
                      <button
                        onClick={() => {
                          setRenewTarget({
                            userId: c.employeeId,
                            name: c.employeeName,
                            affiliatedCompany: c.affiliatedCompany || "",
                          });
                        }}
                        className="flex items-center gap-1.5 text-xs text-orange-600 dark:text-orange-400 hover:text-orange-800 dark:hover:text-orange-200 px-2.5 py-1.5 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/30 transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> 서명갱신/재계약
                      </button>
                    )}
                    {c.status === "sent" && (
                      <>
                        <button
                          onClick={copyLink}
                          className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 px-2.5 py-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                        >
                          <Link className="w-3.5 h-3.5" /> 서명 링크 복사
                        </button>
                        {!isResigned && (
                          <button
                            onClick={() => {
                              if (confirm("서명 대기중인 계약서를 수정합니다. 직원이 보는 내용이 즉시 변경되니, 이미 링크를 안내했다면 다시 안내해 주세요.")) {
                                setEditingDraftContract(c);
                              }
                            }}
                            className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 px-2.5 py-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" /> 수정
                          </button>
                        )}
                      </>
                    )}
                    {c.status === "expired" && (
                      <button
                        onClick={() => {
                          if (confirm("만료된 계약서를 삭제하시겠습니까?")) {
                            deleteContract.mutate({ id: c.id });
                          }
                        }}
                        disabled={deleteContract.isPending}
                        className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 px-2 py-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> 삭제
                      </button>
                    )}
                    {c.status === "draft" && (
                      <div className="flex items-center gap-1.5 ml-auto">
                        <button
                          onClick={() => setEditingDraftContract(c)}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 px-2 py-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> 수정
                        </button>
                        <button
                          onClick={() => {
                            if (confirm("이 초안을 삭제하시겠습니까?")) {
                              deleteContract.mutate({ id: c.id });
                            }
                          }}
                          disabled={deleteContract.isPending}
                          className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 px-2 py-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> 삭제
                        </button>
                        <Button
                          size="sm" variant="default"
                          className="h-7 text-xs"
                          onClick={() => sendContract.mutate({ id: c.id })}
                          disabled={sendContract.isPending}
                        >
                          <Send className="w-3.5 h-3.5 mr-1" /> 직원에게 발송
                        </Button>
                      </div>
                    )}
                    {c.status === "sent" && !isResigned && (
                      <span className="text-[11px] text-muted-foreground ml-auto flex items-center gap-1">
                        <Info className="w-3 h-3" /> 직원이 링크를 열어 서명하면 완료됩니다
                      </span>
                    )}
                    {isResigned && c.status !== "draft" && c.status !== "expired" && (
                      <button
                        onClick={() => {
                          if (confirm(`퇴사자 ${c.employeeName}의 계약서를 삭제하시겠습니까?`)) {
                            deleteContract.mutate({ id: c.id, force: true });
                          }
                        }}
                        disabled={deleteContract.isPending}
                        className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 px-2 py-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> 삭제
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}

      {/* ID/비밀번호 수정 모달 */}
      {editingCredentials && (
        <CredentialEditModal
          data={editingCredentials}
          restaurantId={restaurantId}
          onSave={(data) => updateCredentials.mutate(data)}
          onClose={() => setEditingCredentials(null)}
          isPending={updateCredentials.isPending}
        />
      )}

      {/* 계약서 작성 모달 */}
      {showContractForm && (
        <ContractFormModal
          restaurantId={restaurantId}
          staffList={staffList ?? []}
          restaurantInfo={{ name: current?.name ?? "", address: current?.address ?? "" }}
          onClose={() => setShowContractForm(false)}
        />
      )}

      {/* 초안 수정 모달 */}
      {editingDraftContract && (
        <ContractFormModal
          restaurantId={restaurantId}
          staffList={staffList ?? []}
          restaurantInfo={{ name: current?.name ?? "", address: current?.address ?? "" }}
          editingContract={editingDraftContract}
          onClose={() => setEditingDraftContract(null)}
        />
      )}

      {/* 서명갱신/재계약 모달 */}
      {renewTarget && (
        <ContractFormModal
          restaurantId={restaurantId}
          staffList={staffList ?? []}
          restaurantInfo={{ name: current?.name ?? "", address: current?.address ?? "" }}
          defaultEmployee={renewTarget}
          onClose={() => setRenewTarget(null)}
        />
      )}

      {/* 빠른 직원 추가 모달 */}
      {showQuickAdd && (
        <QuickAddModal
          restaurantId={restaurantId}
          onClose={() => setShowQuickAdd(false)}
          onSubmit={(form) => quickAdd.mutate({ restaurantId, ...form })}
          isPending={quickAdd.isPending}
        />
      )}

      {/* 퇴사 처리 다이얼로그 */}
      {resignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setResignTarget(null)}>
          <div className="bg-card border border-border rounded-xl p-6 w-[90vw] max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold mb-4">퇴사 처리 — {resignTarget.name}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">퇴사일</label>
                <input type="date" value={resignDate} onChange={e => setResignDate(e.target.value)}
                  className="w-full text-sm px-3 py-2 rounded-md border border-input bg-background" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">사유 (선택)</label>
                <input value={resignReason} onChange={e => setResignReason(e.target.value)}
                  placeholder="자발적 퇴사, 계약 만료 등"
                  className="w-full text-sm px-3 py-2 rounded-md border border-input bg-background" />
              </div>
              <p className="text-xs text-muted-foreground">퇴사일 이후 미확정 스케줄은 자동 취소됩니다.</p>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <Button size="sm" variant="outline" onClick={() => setResignTarget(null)}>취소</Button>
              <Button size="sm" variant="destructive" disabled={!resignDate || resignStaff.isPending}
                onClick={() => resignStaff.mutate({ restaurantId, userId: resignTarget.userId, resignedAt: resignDate, resignReason: resignReason || undefined })}>
                {resignStaff.isPending ? "처리 중..." : "퇴사 처리"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ID/비밀번호 수정 모달 ────────────────────────────────────────────────────

function CredentialEditModal({ data, restaurantId, onSave, onClose, isPending }: {
  data: any; restaurantId: number;
  onSave: (d: any) => void; onClose: () => void; isPending: boolean;
}) {
  const [form, setForm] = useState({
    newUsername: data.username,
    newPassword: "",
    newName: data.name,
    newPhone: data.phone || "",
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">{data.name} 계정 수정</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-foreground">아이디</label>
            <input className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.newUsername} onChange={(e) => setForm({ ...form, newUsername: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">새 비밀번호</label>
            <input type="password" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
              placeholder="변경 시에만 입력" />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">이름</label>
            <input className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.newName} onChange={(e) => setForm({ ...form, newName: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">연락처</label>
            <input className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.newPhone} onChange={(e) => setForm({ ...form, newPhone: e.target.value })} placeholder="010-0000-0000" />
          </div>
        </div>
        <div className="flex gap-2 pt-4 justify-end">
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button
            onClick={() => onSave({
              userId: data.userId,
              restaurantId,
              ...(form.newUsername !== data.username && { username: form.newUsername }),
              ...(form.newPassword && { password: form.newPassword }),
              ...(form.newName !== data.name && { name: form.newName }),
              ...(form.newPhone !== (data.phone || "") && { phone: form.newPhone }),
            })}
            disabled={isPending}
          >
            {isPending ? "저장 중..." : "저장"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── 계약서 작성 모달 ─────────────────────────────────────────────────────────

function ContractFormModal({ restaurantId, staffList, onClose, defaultEmployee, restaurantInfo, editingContract }: {
  restaurantId: number; staffList: any[]; onClose: () => void;
  defaultEmployee?: { userId: number; name: string; affiliatedCompany?: string };
  restaurantInfo?: { name: string; address: string };
  editingContract?: any; // draft 상태 계약서 수정 시 전달
}) {
  const utils = trpc.useUtils();

  // ── 최근 계약서 템플릿 + 스케줄 프리셋 + 소속회사 마스터 조회 ──
  // 갱신(defaultEmployee) 시에도 활성화 + 해당 직원의 기존 계약서 우선 prefill (사용자 요청 2026-05-02)
  const templateEmployeeId = defaultEmployee?.userId ?? undefined;
  const { data: latestTemplate } = trpc.electronicContracts.getLatestTemplate.useQuery(
    { restaurantId, employeeId: templateEmployeeId },
    { enabled: restaurantId > 0 && !editingContract },
  );
  const { data: shiftPresets = [] } = trpc.restaurants.getShiftPresets.useQuery(
    { restaurantId },
  );
  // 재설계 2026-05-02: 소속회사 마스터 (TDZ 회피 위해 useEffect 위에 선언 필수)
  const { data: affiliatedCompaniesMaster = [] } = trpc.affiliatedCompanies.list.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );
  const [templateApplied, setTemplateApplied] = useState(false);

  const ec = editingContract; // 수정 모드 시 기존 데이터
  const [form, setForm] = useState({
    employeeId: ec?.employeeId ?? defaultEmployee?.userId ?? 0,
    employeeName: ec?.employeeName ?? defaultEmployee?.name ?? "",
    employeePhone: ec?.employeePhone ?? "",
    affiliatedCompany: ec?.affiliatedCompany ?? defaultEmployee?.affiliatedCompany ?? "",
    contractType: (ec?.contractType ?? "fixed_term") as "permanent" | "fixed_term" | "part_time" | "daily",
    contractStart: ec?.contractStart ? String(ec.contractStart).slice(0, 10) : new Date().toISOString().slice(0, 10),
    contractEnd: ec?.contractEnd ? String(ec.contractEnd).slice(0, 10) : (() => {
      if (defaultEmployee) return "";
      const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })(),
    wageType: (ec?.wageType ?? "monthly") as "hourly" | "monthly",
    wageAmount: ec?.wageAmount ?? "",
    weeklyHours: ec?.weeklyHours ?? "40",
    workStartTime: ec?.workStartTime ?? "09:00",
    workEndTime: ec?.workEndTime ?? "18:00",
    breakMinutes: ec?.breakMinutes ?? 60,
    payDay: ec?.payDay ?? 20,
    payMethod: (ec?.payMethod ?? "bank_transfer") as "bank_transfer" | "cash",
    over5Employees: (ec as any)?.over5Employees ?? false, // 표시 전용 (서버가 소속회사 마스터에서 자동 결정)
    // 재설계 2026-05-02 신규
    taxMode: ((ec as any)?.taxMode ?? "social_insurance") as "social_insurance" | "biz_income_3_3",
    hourlyWageIncludesHolidayPay: (ec as any)?.hourlyWageIncludesHolidayPay ?? true,
    hireDate: "" as string,
    hasProbation: false,
    probationMonths: 0,
    workPlace: ec?.workPlace ?? restaurantInfo?.name ?? "",
    workPlaceAddress: ec?.workPlaceAddress ?? restaurantInfo?.address ?? "",
    jobDescription: ec?.jobDescription ?? "",
    specialTerms: ec?.specialTerms ?? "",
    employerBusinessNumber: ec?.employerBusinessNumber ?? "",
    weeklyOffDays: (() => {
      const v = (ec?.weeklyOffDays ?? 1) as number;
      return v >= 1 && v <= 3 ? v : 1;
    })(),
  });

  // Phase E (2026-05-02): 신규 모드(박제 없음)에서 운영 SSOT를 폼 기본값으로 사용.
  // 갱신 모드(박제 있음)에서는 latestTemplate(현행)이 박제값 우선 prefill.
  const { data: empSSOT } = trpc.staff.getEmployment.useQuery(
    { restaurantId, userId: defaultEmployee?.userId ?? 0 },
    { enabled: !!defaultEmployee?.userId && !editingContract && restaurantId > 0 },
  );
  const [empSSOTApplied, setEmpSSOTApplied] = useState(false);
  useEffect(() => {
    if (empSSOT && !empSSOTApplied && !editingContract) {
      setForm((prev) => ({
        ...prev,
        contractType: ((empSSOT.contractType as any) || prev.contractType),
        contractStart: empSSOT.contractStart ? String(empSSOT.contractStart).slice(0, 10) : prev.contractStart,
        contractEnd: empSSOT.contractEnd ? String(empSSOT.contractEnd).slice(0, 10) : prev.contractEnd,
        workStartTime: empSSOT.workStartTime || prev.workStartTime,
        workEndTime: empSSOT.workEndTime || prev.workEndTime,
        breakMinutes: empSSOT.breakMinutes ?? prev.breakMinutes,
        weeklyHours: empSSOT.weeklyHours || prev.weeklyHours,
        weeklyOffDays: (() => {
          const v = (empSSOT.weeklyOffDays ?? prev.weeklyOffDays) as number;
          return v >= 1 && v <= 3 ? v : 1;
        })(),
        taxMode: ((empSSOT.taxMode as any) || prev.taxMode),
        hourlyWageIncludesHolidayPay: empSSOT.hourlyWageIncludesHolidayPay ?? prev.hourlyWageIncludesHolidayPay,
        specialTerms: empSSOT.specialTerms ?? prev.specialTerms,
        affiliatedCompany: empSSOT.affiliatedCompany ?? prev.affiliatedCompany,
        hireDate: prev.hireDate || (empSSOT.hireDate ? String(empSSOT.hireDate).slice(0, 10) : ""),
        wageType: ((empSSOT.wageType as any) || prev.wageType),
        wageAmount: empSSOT.wageAmount ? String(empSSOT.wageAmount) : prev.wageAmount,
      }));
      setEmpSSOTApplied(true);
    }
  }, [empSSOT, empSSOTApplied, editingContract]);

  // ── 최근 계약서 템플릿 자동 적용 (새 계약서 + 갱신 시, 첫 로드 1회) ──
  useEffect(() => {
    if (!editingContract && latestTemplate && !templateApplied) {
      setForm((prev) => {
        const company = latestTemplate.affiliatedCompany || prev.affiliatedCompany;
        const sel = affiliatedCompaniesMaster.find((c: any) => c.companyName === company);
        return {
          ...prev,
          contractType: (latestTemplate.contractType as any) || prev.contractType,
          wageType: (latestTemplate.wageType as any) || prev.wageType,
          wageAmount: latestTemplate.wageAmount || prev.wageAmount,
          weeklyHours: latestTemplate.weeklyHours || prev.weeklyHours,
          workStartTime: latestTemplate.workStartTime || prev.workStartTime,
          workEndTime: latestTemplate.workEndTime || prev.workEndTime,
          breakMinutes: latestTemplate.breakMinutes ?? prev.breakMinutes,
          weeklyOffDays: (() => {
            const v = ((latestTemplate as any).weeklyOffDays ?? prev.weeklyOffDays) as number;
            return v >= 1 && v <= 3 ? v : 1;
          })(),
          payDay: latestTemplate.payDay ?? prev.payDay,
          payMethod: (latestTemplate.payMethod as any) || prev.payMethod,
          // 재설계 2026-05-02: over5는 소속회사 마스터에서 자동 결정 (표시 전용)
          over5Employees: sel ? !!sel.over5Employees : (latestTemplate.over5Employees ?? prev.over5Employees),
          taxMode: ((latestTemplate as any).taxMode ?? prev.taxMode) as "social_insurance" | "biz_income_3_3",
          hourlyWageIncludesHolidayPay: (latestTemplate as any).hourlyWageIncludesHolidayPay ?? prev.hourlyWageIncludesHolidayPay,
          // 갱신/재계약 시 기존 hireDate 박제값을 폼에 prefill (사용자 요청 2026-05-02)
          hireDate: prev.hireDate || ((latestTemplate as any).hireDate ? String((latestTemplate as any).hireDate).slice(0, 10) : ""),
          hasProbation: latestTemplate.hasProbation ?? prev.hasProbation,
          probationMonths: latestTemplate.probationMonths ?? prev.probationMonths,
          workPlace: latestTemplate.workPlace || prev.workPlace,
          jobDescription: latestTemplate.jobDescription || prev.jobDescription,
          specialTerms: latestTemplate.specialTerms || prev.specialTerms,
          affiliatedCompany: company,
          employerBusinessNumber: (latestTemplate as any).employerBusinessNumber || sel?.businessNumber || prev.employerBusinessNumber,
          workPlaceAddress: (latestTemplate as any).workPlaceAddress || prev.workPlaceAddress,
        };
      });
      setTemplateApplied(true);
    }
  }, [latestTemplate, defaultEmployee, editingContract, templateApplied, affiliatedCompaniesMaster]);

  // ── 스케줄 풀타임 프리셋 → 출퇴근/휴게/주근로시간 자동 반영 (항상 적용) ──
  const [presetApplied, setPresetApplied] = useState(false);
  useEffect(() => {
    if (presetApplied) return;
    const fullPreset = shiftPresets.find((p: any) => p.presetType === "full" || p.presetType === "fullday");
    if (!fullPreset) return;
    const wd = shiftPresets.find((p: any) => (p.presetType === "full" || p.presetType === "fullday") && p.dayType === "weekday") || fullPreset;
    setForm((prev) => {
      const start = (wd as any).startTime || prev.workStartTime;
      const end = (wd as any).endTime || prev.workEndTime;
      const brk = (wd as any).breakMinutes ?? prev.breakMinutes;
      // 1일 소정근로시간(분) = 출~퇴 - 휴게
      const [sh, sm] = start.split(":").map(Number);
      const [eh, em] = end.split(":").map(Number);
      let dailyMin = (eh * 60 + em) - (sh * 60 + sm) - brk;
      if (dailyMin <= 0) dailyMin += 24 * 60;
      // 주 5일 기준 주근로시간
      const weeklyH = Math.round(dailyMin * 5 / 60);
      return { ...prev, workStartTime: start, workEndTime: end, breakMinutes: brk, weeklyHours: String(weeklyH) };
    });
    setPresetApplied(true);
  }, [shiftPresets, presetApplied]);

  const create = trpc.electronicContracts.createEmploymentContract.useMutation({
    onSuccess() { toast.success("계약서 초안 생성됨"); utils.electronicContracts.listEmploymentContracts.invalidate(); onClose(); },
    onError(err) { toast.error(err.message); },
  });
  const updateContract = trpc.electronicContracts.updateEmploymentContract.useMutation({
    onSuccess() { toast.success("계약서 수정됨"); utils.electronicContracts.listEmploymentContracts.invalidate(); onClose(); },
    onError(err) { toast.error(err.message); },
  });

  const selectStaff = (userId: number) => {
    const staff = staffList.find((s: any) => s.userId === userId);
    if (staff) {
      // 직원정보 SSOT의 hireDate를 default로 채움 (계약서 박제 시 사용자 변경 가능)
      const ssotHireDate = staff.hireDate ? String(staff.hireDate).slice(0, 10) : "";
      const company = staff.affiliatedCompany || "";
      const sel = affiliatedCompaniesMaster.find((c: any) => c.companyName === company);
      setForm({
        ...form,
        employeeId: userId,
        employeeName: staff.name,
        employeePhone: staff.phone || "",
        affiliatedCompany: company,
        employerBusinessNumber: sel?.businessNumber || form.employerBusinessNumber,
        over5Employees: sel ? !!sel.over5Employees : form.over5Employees,
        hireDate: form.hireDate || ssotHireDate,
      });
    }
  };

  const weeklyHoursNum = Number(form.weeklyHours) || 0;
  const isUnder15Hours = weeklyHoursNum < 15;
  const wageNum = Number(form.wageAmount) || 0;

  // ── 포괄임금 역산 (월급제 전용) ──
  // 월급제 정산 정책 재설계 2026-05-02 §2.1: 통상시급 분모 209h 고정 (5인 여부 무관).
  // 기본급 표시 분모: 5인↑ 201h (포괄연차 8h 분리), 5인↓ 209h (연차 미발생 → 전부 기본급).
  const divisor = 209;
  const hourlyWageCalc = divisor > 0 ? wageNum / divisor : 0;
  const monthlyContractHours = form.over5Employees ? 201 : 209;
  const basePayCalc = Math.round(hourlyWageCalc * monthlyContractHours);
  const annualLeavePayCalc = form.over5Employees ? Math.round(hourlyWageCalc * 8) : 0;
  const wageCheckSum = basePayCalc + annualLeavePayCalc;
  const annualSalaryCalc = wageNum * 12;

  const inputCls = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  const labelCls = "text-sm font-medium text-foreground";
  const subLabelCls = "text-[10px] text-muted-foreground";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto pb-20 lg:pb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">{
            editingContract
              ? (editingContract.status === "sent" ? "서명 대기 계약서 수정" : "초안 계약서 수정")
              : defaultEmployee ? "서명갱신/재계약" : "근로계약서 작성"
          }</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          {/* ═══ 기존 계약서 기반 자동 불러오기 안내 ═══ */}
          {!defaultEmployee && templateApplied && (
            <div className="rounded-lg bg-blue-500/10 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
              이전 계약서 내용이 자동으로 불러와졌습니다. 필요한 항목만 수정하세요.
            </div>
          )}

          {/* Phase E (2026-05-02 사양 §3.7): 박제 ↔ 운영 SSOT 분리 안내 */}
          <div className="rounded-lg bg-amber-500/10 border border-amber-200 dark:border-amber-800 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
            <strong>박제 안내:</strong> 본 폼의 입력값은 <strong>서명 시점 박제(법적 증거)</strong>로만 사용됩니다.
            정산에 즉시 반영되는 운영값(임금·근무시간 등)은 <strong>직원 카드</strong>에서 직접 수정해야 합니다.
            여기서 변경한 값은 SSOT에 자동 반영되지 않으므로, 박제와 SSOT가 어긋나면 갱신 필요 배너가 출현합니다.
          </div>

          {/* ═══ 사업주 (소속회사) — 재설계 2026-05-02: select + over5 자동 ═══ */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div>
              <label className={labelCls}>사업주 (소속회사)</label>
              <select className={inputCls} value={form.affiliatedCompany}
                onChange={(e) => {
                  const sel = affiliatedCompaniesMaster.find((c: any) => c.companyName === e.target.value);
                  setForm({
                    ...form,
                    affiliatedCompany: e.target.value,
                    employerBusinessNumber: sel?.businessNumber || form.employerBusinessNumber,
                    // 표시 전용 (서버가 마스터에서 다시 결정)
                    over5Employees: sel ? !!sel.over5Employees : false,
                  });
                }}
              >
                <option value="">선택하세요</option>
                {affiliatedCompaniesMaster.map((c: any) => (
                  <option key={c.id} value={c.companyName}>
                    {c.companyName} {c.over5Employees ? "(5인↑)" : "(5인↓)"}
                  </option>
                ))}
              </select>
              {affiliatedCompaniesMaster.length === 0 && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                  ⚠ 등록된 소속회사가 없습니다. 매장 정보에서 먼저 등록하세요.
                </p>
              )}
            </div>
            <div>
              <label className={labelCls}>사업자등록번호</label>
              <input className={inputCls} value={form.employerBusinessNumber}
                onChange={(e) => setForm({ ...form, employerBusinessNumber: e.target.value })}
                placeholder="000-00-00000" />
            </div>
            {form.affiliatedCompany && (
              <div className={`text-[11px] rounded-md px-3 py-2 space-y-0.5 ${form.over5Employees ? "bg-blue-500/10 text-blue-700 dark:text-blue-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
                {form.over5Employees ? (
                  <><p className="font-semibold">5인 이상 — 근로기준법 전면 적용</p><p>연차유급휴가, 부당해고 제한, 주휴수당 의무</p></>
                ) : (
                  <><p className="font-semibold">5인 미만 — 근로기준법 일부 적용</p><p>해고예고(30일), 퇴직금, 최저임금 적용 / 연차·가산수당·부당해고 규정 미적용</p></>
                )}
              </div>
            )}
            <p className={subLabelCls}>※ 5인 여부는 소속회사 마스터(매장 정보)에서 토글합니다</p>
          </div>

          {/* ═══ 직원 정보 ═══ */}
          <div>
            <label className={labelCls}>직원</label>
            <select className={inputCls} value={form.employeeId} onChange={(e) => selectStaff(Number(e.target.value))}>
              <option value={0}>선택</option>
              {staffList.map((s: any) => <option key={s.userId} value={s.userId}>{s.name}</option>)}
            </select>
            {form.employeeId === 0 && (
              <input className={inputCls + " mt-1"} value={form.employeeName} onChange={(e) => setForm({ ...form, employeeName: e.target.value })} placeholder="미등록 직원 이름 직접입력" />
            )}
            <input className={inputCls + " mt-1"} value={form.employeePhone} onChange={(e) => setForm({ ...form, employeePhone: e.target.value })} placeholder="연락처 (예: 010-1234-5678)" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>계약유형</label>
              <select className={inputCls} value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value as any })}>
                <option value="fixed_term">계약직</option>
                <option value="part_time">파트타임</option>
                <option value="permanent">정규직</option>
                <option value="daily">일용직</option>
              </select>
            </div>
            <div>
              {/* 재설계 2026-05-02: 입사일 — 계약서 박제용 (직원정보 hireDate와 분리) */}
              <label className={labelCls}>입사일</label>
              <input type="date" className={inputCls} value={form.hireDate}
                onChange={(e) => setForm({ ...form, hireDate: e.target.value })} />
              <p className={subLabelCls}>계약서 시점에 박제됩니다 (직원정보 SSOT와 분리)</p>
            </div>
          </div>

          {/* ═══ 근무장소 / 업무내용 ═══ */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>근무장소 (매장명)</label>
                <input className={inputCls} value={form.workPlace} onChange={(e) => setForm({ ...form, workPlace: e.target.value })} placeholder="매장명" />
              </div>
              <div>
                <label className={labelCls}>업무내용</label>
                <input className={inputCls} value={form.jobDescription} onChange={(e) => setForm({ ...form, jobDescription: e.target.value })} placeholder="홀 및 주방 그외 제반 업무" />
              </div>
            </div>
            <div>
              <label className={labelCls}>근무장소 주소</label>
              <input className={inputCls} value={form.workPlaceAddress} onChange={(e) => setForm({ ...form, workPlaceAddress: e.target.value })} placeholder="매장 주소" />
            </div>
          </div>

          {/* ═══ 계약기간 ═══ */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>계약 시작</label>
                <input type="date" className={inputCls} value={form.contractStart} onChange={(e) => {
                  setForm({ ...form, contractStart: e.target.value });
                }} />
              </div>
              <div>
                <label className={labelCls}>계약 종료</label>
                <input type="date" className={inputCls} value={form.contractEnd} onChange={(e) => setForm({ ...form, contractEnd: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {[
                { label: "1개월", months: 1 },
                { label: "3개월", months: 3 },
                { label: "6개월", months: 6 },
                { label: "1년", months: 12 },
              ].map((preset) => {
                const calcEnd = () => {
                  const d = new Date(form.contractStart || new Date());
                  d.setMonth(d.getMonth() + preset.months);
                  d.setDate(d.getDate() - 1);
                  return d.toISOString().slice(0, 10);
                };
                const isActive = form.contractEnd === calcEnd();
                return (
                  <button key={preset.label} type="button"
                    onClick={() => setForm({ ...form, contractEnd: calcEnd() })}
                    className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${isActive ? "border-primary bg-primary/10 text-primary font-medium" : "border-input text-muted-foreground hover:bg-accent"}`}
                  >
                    {preset.label}
                  </button>
                );
              })}
              <button type="button"
                onClick={() => setForm({ ...form, contractEnd: "" })}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${!form.contractEnd ? "border-primary bg-primary/10 text-primary font-medium" : "border-input text-muted-foreground hover:bg-accent"}`}
              >
                무기한
              </button>
            </div>
          </div>

          {/* ═══ 임금 ═══ */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>임금 유형</label>
              <select className={inputCls} value={form.wageType} onChange={(e) => {
                const newType = e.target.value as "hourly" | "monthly";
                setForm({ ...form, wageType: newType, wageAmount: newType === "hourly" ? "10320" : "" });
              }}>
                <option value="monthly">월급</option>
                <option value="hourly">시급</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>{form.wageType === "hourly" ? "시급(원)" : "월급(원)"}</label>
              <input type="number" className={inputCls} value={form.wageAmount} onChange={(e) => setForm({ ...form, wageAmount: e.target.value })}
                placeholder={form.wageType === "hourly" ? "10320" : "계약급여 입력"} />
              {form.wageType === "hourly" && wageNum > 0 && wageNum < 10320 && (
                <p className="text-[10px] text-red-600 font-semibold mt-0.5">⚠ 2026년 최저시급(10,320원) 미만</p>
              )}
            </div>
            <div>
              <label className={labelCls}>주 근무시간</label>
              {form.wageType === "hourly" && form.weeklyHours === "0" ? (
                <input type="text" className={inputCls} value="미정" disabled />
              ) : (
                <input type="number" className={inputCls} value={form.weeklyHours}
                  onChange={(e) => setForm({ ...form, weeklyHours: e.target.value })} />
              )}
              {form.wageType === "hourly" && (
                <label className="flex items-center gap-1 mt-1 cursor-pointer">
                  <input type="checkbox" checked={form.weeklyHours === "0"}
                    onChange={(e) => setForm({ ...form, weeklyHours: e.target.checked ? "0" : "40" })}
                    className="rounded border-input" />
                  <span className="text-[10px] text-muted-foreground">미정 (시급제 변동근무)</span>
                </label>
              )}
              {form.wageType === "monthly" && isUnder15Hours && (
                <p className="text-[10px] text-amber-500 mt-0.5">주 15시간 미만: 주휴수당·4대보험 미적용</p>
              )}
            </div>
            <div>
              <label className={labelCls}>주당 휴무일수</label>
              <select className={inputCls} value={form.weeklyOffDays}
                onChange={(e) => setForm({ ...form, weeklyOffDays: Number(e.target.value) })}>
                <option value={1}>1일</option>
                <option value={2}>2일</option>
                <option value={3}>3일</option>
              </select>
            </div>
          </div>

          {/* ═══ 시급제 + 주휴수당 처리 — 재설계 2026-05-02: 임금 영역 직후 배치 ═══ */}
          {form.wageType === "hourly" && (
            <div className="space-y-2 py-1">
              <label className={labelCls}>주휴수당 처리</label>
              <div className="flex items-center gap-4 pl-1 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="hourlyWageHoliday" checked={form.hourlyWageIncludesHolidayPay}
                    onChange={() => setForm({ ...form, hourlyWageIncludesHolidayPay: true })}
                    className="rounded border-input" />
                  <span className="text-sm text-foreground">시급에 주휴수당 포함</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="hourlyWageHoliday" checked={!form.hourlyWageIncludesHolidayPay}
                    onChange={() => setForm({ ...form, hourlyWageIncludesHolidayPay: false })}
                    className="rounded border-input" />
                  <span className="text-sm text-foreground">주휴수당 별도 산정</span>
                </label>
              </div>
              {!form.hourlyWageIncludesHolidayPay && (
                <p className="text-[10px] text-blue-600 dark:text-blue-400 pl-1">
                  {weeklyHoursNum >= 15
                    ? "주 15시간 이상 — 정산 시 주휴수당(주1회 8h × 시급) 자동 가산"
                    : weeklyHoursNum > 0
                    ? "주 15시간 미만 — 주휴수당 미발생"
                    : "근무시간 미정 — 주별 실근무 15시간 도달 시 정산에서 자동 가산"}
                </p>
              )}
            </div>
          )}

          {/* ═══ 포괄임금 구성항목 (월급제 전용) — 재설계 2026-05-02: 5인 미만이면 연차수당 행 숨김 ═══ */}
          {form.wageType === "monthly" && wageNum > 0 && (
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-500/5 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">임금 구성항목 (근기법 제17조)</p>
                <p className="text-[10px] text-blue-500">
                  월소정근로 209h
                </p>
              </div>

              <div className="text-xs space-y-1.5 pt-1">
                <div className="flex justify-between items-center">
                  <span style={{ color: "#6b7280" }}>통상시급</span>
                  <span className="font-mono font-medium">{Math.round(hourlyWageCalc).toLocaleString()}원</span>
                </div>
                <div className="flex justify-between items-center">
                  <span style={{ color: "#6b7280" }}>기본급 ({monthlyContractHours}h × 통상시급)</span>
                  <span className="font-mono font-medium">{basePayCalc.toLocaleString()}원</span>
                </div>
                {form.over5Employees && (
                  <div className="flex justify-between items-center">
                    <span style={{ color: "#6b7280" }}>포괄연차수당 (8h × 통상시급)</span>
                    <span className="font-mono font-medium">{annualLeavePayCalc.toLocaleString()}원</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-1.5" style={{ borderTop: "1px solid #e5e7eb" }}>
                  <span className="font-semibold">합계</span>
                  <span className="font-mono font-semibold">{wageCheckSum.toLocaleString()}원</span>
                </div>
                {Math.abs(wageCheckSum - wageNum) > 10 && (
                  <p className="text-[10px] text-amber-600">※ 단수 차이 {(wageCheckSum - wageNum).toLocaleString()}원 — 반올림에 의한 차이입니다</p>
                )}
                {hourlyWageCalc > 0 && hourlyWageCalc < 10320 && (
                  <p className="text-[10px] text-red-600 font-semibold">⚠ 통상시급이 2026년 최저시급(10,320원) 미만입니다</p>
                )}
                {form.over5Employees && annualLeavePayCalc <= 0 && (
                  <p className="text-[10px] text-red-600 font-semibold">⚠ 5인 이상 사업장의 월급제 계약은 포괄연차수당이 0원일 수 없습니다. 월급액을 확인하세요.</p>
                )}
              </div>
            </div>
          )}

          {/* ═══ 근무시간 ═══ */}
          <div className="space-y-2">
            {shiftPresets.length > 0 ? (
              <div>
                <label className={labelCls}>근무유형 (프리셋)</label>
                <div className="flex gap-1.5 mt-1">
                  {(() => {
                    const types = [...new Set(shiftPresets.map((p: any) => p.presetType))];
                    const typeLabels: Record<string, string> = { open: "오픈", full: "풀타임", fullday: "풀타임", close: "마감" };
                    return types.map((t: string) => {
                      const wd = shiftPresets.find((p: any) => p.presetType === t && p.dayType === "weekday")
                        || shiftPresets.find((p: any) => p.presetType === t);
                      if (!wd) return null;
                      const isActive = form.workStartTime === (wd as any).startTime && form.workEndTime === (wd as any).endTime;
                      return (
                        <button key={t} type="button"
                          onClick={() => {
                            const start = (wd as any).startTime || form.workStartTime;
                            const end = (wd as any).endTime || form.workEndTime;
                            const brk = (wd as any).breakMinutes ?? form.breakMinutes;
                            const [sh, sm] = start.split(":").map(Number);
                            const [eh, em] = end.split(":").map(Number);
                            let dailyMin = (eh * 60 + em) - (sh * 60 + sm) - brk;
                            if (dailyMin <= 0) dailyMin += 24 * 60;
                            const weeklyH = Math.round(dailyMin * 5 / 60);
                            setForm({ ...form, workStartTime: start, workEndTime: end, breakMinutes: brk, weeklyHours: String(weeklyH) });
                          }}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${isActive ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground hover:bg-accent"}`}
                        >
                          {typeLabels[t] || t}
                          <span className="ml-1 text-[10px] opacity-70">{(wd as any).startTime}~{(wd as any).endTime}</span>
                        </button>
                      );
                    });
                  })()}
                  <button type="button"
                    onClick={() => {}}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-input text-muted-foreground opacity-50"
                    style={{ cursor: "default" }}
                  >
                    직접입력 ↓
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-amber-500/10 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                근무 프리셋이 설정되지 않았습니다. <strong>업무정보 &gt; 매장 기본정보</strong>에서 프리셋을 먼저 등록하면 자동 반영됩니다.
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>출근</label>
                <input type="time" step="600" className={inputCls} value={form.workStartTime} onChange={(e) => setForm({ ...form, workStartTime: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>퇴근</label>
                <input type="time" step="600" className={inputCls} value={form.workEndTime} onChange={(e) => setForm({ ...form, workEndTime: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>휴게(분)</label>
                <input type="number" className={inputCls} value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: Number(e.target.value) })} min={0} />
              </div>
            </div>
          </div>

          {/* ═══ 급여 / 복리 ═══ */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>급여일</label>
              <input type="number" className={inputCls} value={form.payDay} onChange={(e) => setForm({ ...form, payDay: Number(e.target.value) })} min={1} max={31} />
            </div>
            <div>
              <label className={labelCls}>지급방법</label>
              <select className={inputCls} value={form.payMethod} onChange={(e) => setForm({ ...form, payMethod: e.target.value as any })}>
                <option value="bank_transfer">계좌이체</option>
                <option value="cash">현금</option>
              </select>
            </div>
          </div>

          {/* ═══ 세무처리 (4대보험 / 3.3% 사업소득) — 재설계 2026-05-02: 라디오 필수 ═══ */}
          <div className="space-y-2 py-1">
            <label className={labelCls}>세무처리</label>
            <div className="flex items-center gap-4 pl-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="taxMode" checked={form.taxMode === "social_insurance"}
                  onChange={() => setForm({ ...form, taxMode: "social_insurance" })}
                  className="rounded border-input" />
                <span className="text-sm text-foreground">4대보험 가입</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="taxMode" checked={form.taxMode === "biz_income_3_3"}
                  onChange={() => setForm({ ...form, taxMode: "biz_income_3_3" })}
                  className="rounded border-input" />
                <span className="text-sm text-foreground">사업소득 3.3% 원천공제</span>
              </label>
            </div>
            {isUnder15Hours && form.taxMode === "social_insurance" && (
              <p className="text-[10px] text-amber-500 pl-6">주 15시간 미만 시 4대보험 의무가입 대상 아님</p>
            )}
          </div>

          {/* (주휴수당 처리 라디오는 임금 영역 직후로 이동됨 — 재설계 2026-05-02 위치 변경) */}

          {/* ═══ 특약사항 ═══ */}
          <div>
            <label className={labelCls}>특약사항</label>
            <textarea className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
              value={form.specialTerms} onChange={(e) => setForm({ ...form, specialTerms: e.target.value })}
              placeholder="추가 약정사항이 있으면 기재" />
          </div>

          {/* 재설계 2026-05-02: 비밀유지서약서·개인정보 동의서는 항상 첨부 (체크박스 폐기) */}
        </div>

        <div className="flex gap-2 pt-4 justify-end">
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button
            onClick={() => {
              // 재설계 2026-05-02: 클라 측 선택 검증
              if (!form.affiliatedCompany) {
                toast.error("소속회사를 선택하세요"); return;
              }
              if (form.taxMode !== "social_insurance" && form.taxMode !== "biz_income_3_3") {
                toast.error("세무처리(4대보험/3.3%)를 선택하세요"); return;
              }
              // 임금액 검증 — DB가 NOT NULL이라 빈 값/0이면 INSERT 실패
              const wageAmountNum = Number(form.wageAmount);
              if (!form.wageAmount || !isFinite(wageAmountNum) || wageAmountNum <= 0) {
                toast.error(`${form.wageType === "hourly" ? "시급" : "월급"} 금액을 입력하세요`); return;
              }
              // 포괄연차수당 검증 (2026-05-02): 5인 이상 + 월급제 → 0원 금지
              if (form.over5Employees && form.wageType === "monthly" && annualLeavePayCalc <= 0) {
                toast.error("5인 이상 사업장의 월급제 계약은 포괄연차수당이 0원일 수 없습니다.");
                return;
              }
              const payload = {
                employeeName: form.employeeName,
                employeePhone: form.employeePhone || undefined,
                contractType: form.contractType,
                contractStart: form.contractStart,
                contractEnd: form.contractEnd || undefined,
                wageType: form.wageType,
                wageAmount: form.wageAmount,
                weeklyHours: form.weeklyHours,
                workStartTime: form.workStartTime,
                workEndTime: form.workEndTime,
                breakMinutes: form.breakMinutes,
                weeklyOffDays: form.weeklyOffDays,
                payDay: form.payDay,
                payMethod: form.payMethod,
                // 재설계 2026-05-02 폐기: position·weeklyHoliday·nightShiftConsent (계약서 박제도 제거)
                taxMode: form.taxMode,
                hourlyWageIncludesHolidayPay: form.hourlyWageIncludesHolidayPay,
                hireDate: form.hireDate || undefined,
                workPlace: form.workPlace || undefined,
                jobDescription: form.jobDescription || undefined,
                specialTerms: form.specialTerms || undefined,
                affiliatedCompany: form.affiliatedCompany || undefined,
                employerBusinessNumber: form.employerBusinessNumber || undefined,
                workPlaceAddress: form.workPlaceAddress || undefined,
                ...(form.wageType === "monthly" && wageNum > 0 ? {
                  annualSalary: String(annualSalaryCalc),
                  basePay: String(basePayCalc),
                  annualLeavePay: String(annualLeavePayCalc),
                  hourlyWage: String(Math.round(hourlyWageCalc)),
                  monthlyContractHours: String(monthlyContractHours),
                } : {}),
              };
              if (editingContract) {
                updateContract.mutate({ id: editingContract.id, ...payload });
              } else {
                create.mutate({ restaurantId, employeeId: form.employeeId || undefined, hasProbation: false, probationMonths: 0, ...payload });
              }
            }}
            disabled={
              !form.employeeName ||
              !form.affiliatedCompany ||
              create.isPending ||
              updateContract.isPending ||
              (form.over5Employees && form.wageType === "monthly" && wageNum > 0 && annualLeavePayCalc <= 0)
            }
          >
            {(create.isPending || updateContract.isPending) ? "처리 중..." : editingContract ? "수정 저장" : "초안 생성"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── 빠른 직원 추가 모달 (staff.quickAdd) ────────────────────────────────────

function QuickAddModal({ restaurantId, onClose, onSubmit, isPending }: {
  restaurantId: number;
  onClose: () => void;
  onSubmit: (f: { name: string; phone: string; role: "supervisor" | "staff"; sendInvite: boolean }) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"supervisor" | "staff">("staff");
  const [sendInvite, setSendInvite] = useState(true);

  // 전화번호 실시간 체크 — 3자리 이상 입력 시 쿼리 활성화
  const phoneQueryEnabled = phone.replace(/[^0-9]/g, "").length >= 8 && restaurantId > 0;
  const { data: phoneCheck } = trpc.staff.checkPhone.useQuery(
    { restaurantId, phone },
    { enabled: phoneQueryEnabled },
  );

  const canSubmit = name.trim() && phone.trim() && phoneCheck?.status !== "duplicate" && !isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <UserPlus className="w-4 h-4" /> 직원 추가
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">이름 *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="홍길동"
              className="w-full text-sm px-3 py-2 rounded-md border border-input bg-background"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">전화번호 *</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="010-1234-5678"
              className="w-full text-sm px-3 py-2 rounded-md border border-input bg-background"
              inputMode="tel"
            />
            {phoneCheck && phoneCheck.status !== "new" && phoneCheck.status !== "empty" && (
              <div className={`mt-1.5 text-[11px] px-2 py-1.5 rounded ${
                phoneCheck.status === "duplicate" ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" :
                phoneCheck.status === "rehire" ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" :
                "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
              }`}>
                {phoneCheck.status === "duplicate" && `⚠ 이미 본 매장에 등록된 직원입니다 (${(phoneCheck as any).name})`}
                {phoneCheck.status === "rehire" && `↻ 본 매장 퇴사자 — 재입사 처리됩니다 (${(phoneCheck as any).name}, ${(phoneCheck as any).resignedAt} 퇴사)`}
                {phoneCheck.status === "concurrent" && `ℹ 다른 매장 근무자 (${(phoneCheck as any).name}) — 겸직 등록됩니다`}
                {phoneCheck.status === "existing" && `ℹ 기존 사용자 (${(phoneCheck as any).name}) — 본 매장에 추가됩니다`}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">역할</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRole("staff")}
                className={`flex-1 text-xs py-2 rounded-md border transition-colors ${
                  role === "staff" ? "border-primary bg-primary/10 text-foreground" : "border-input bg-background text-muted-foreground"
                }`}
              >직원</button>
              <button
                type="button"
                onClick={() => setRole("supervisor")}
                className={`flex-1 text-xs py-2 rounded-md border transition-colors ${
                  role === "supervisor" ? "border-primary bg-primary/10 text-foreground" : "border-input bg-background text-muted-foreground"
                }`}
              >매니져</button>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={sendInvite}
              onChange={(e) => setSendInvite(e.target.checked)}
              className="rounded"
            />
            초대 링크도 같이 발급 (48시간 유효, 직원 자가등록용)
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <Button size="sm" variant="outline" onClick={onClose}>취소</Button>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={() => onSubmit({ name: name.trim(), phone: phone.trim(), role, sendInvite })}
          >
            {isPending ? "처리 중..." : "추가"}
          </Button>
        </div>
      </div>
    </div>
  );
}
