import { useState, useRef } from "react";
import { trpc } from "../lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import {
  Users, Plus, ChevronDown, ChevronUp, FileText, Trash2, X, UserCog,
  Copy, ExternalLink, Send, Eye, KeyRound, Camera, ShieldCheck,
  AlertTriangle, Loader2, Building2, Edit3, Check, UserPlus, Link,
  Phone, Clock, CalendarDays, Briefcase, Info, Download, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";

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
  const [showInviteSection, setShowInviteSection] = useState(false);
  const [expandedStaff, setExpandedStaff] = useState<number | null>(null);
  const [editingCredentials, setEditingCredentials] = useState<any>(null);
  const [editingCompany, setEditingCompany] = useState<{ userId: number; value: string } | null>(null);
  const [renewTarget, setRenewTarget] = useState<{ userId: number; name: string; affiliatedCompany?: string } | null>(null);

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
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  const { data: contracts } = trpc.electronicContracts.listEmploymentContracts.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );


  const updateRole = trpc.restaurants.updateStaffRole.useMutation({
    onSuccess() { toast.success("역할 변경됨"); utils.restaurants.getStaff.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const removeStaff = trpc.restaurants.removeStaff.useMutation({
    onSuccess() { toast.success("제거됨"); utils.restaurants.getStaff.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const updateCredentials = trpc.users.updateStaffCredentials.useMutation({
    onSuccess() { toast.success("정보 수정됨"); setEditingCredentials(null); utils.restaurants.getStaff.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const updateHealthCert = trpc.users.updateHealthCert.useMutation({
    onSuccess() { toast.success("보건증 정보 업데이트됨"); utils.restaurants.getStaff.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const updateCompany = trpc.restaurants.updateStaffCompany.useMutation({
    onSuccess() { toast.success("소속회사 변경됨"); setEditingCompany(null); utils.restaurants.getStaff.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  const sendContract = trpc.electronicContracts.sendContract.useMutation({
    onSuccess(data) {
      toast.success("계약서 발송됨");
      utils.electronicContracts.listEmploymentContracts.invalidate();
      if (data.token) {
        const url = `${window.location.origin}/sign/${data.token}`;
        navigator.clipboard.writeText(url).then(() => toast.success("서명 링크가 클립보드에 복사되었습니다"));
      }
    },
    onError(err) { toast.error(err.message); },
  });

  // 보건증 업로드 핸들러
  const healthCertInputRef = useRef<HTMLInputElement>(null);
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

  // 소속회사별 직원 수 집계
  const companyCounts: Record<string, number> = {};
  staffList?.forEach((s: any) => {
    const company = s.affiliatedCompany || "(미지정)";
    companyCounts[company] = (companyCounts[company] || 0) + 1;
  });

  if (!restaurantId) {
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
        <div className="flex gap-2">
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
              {Object.entries(companyCounts).map(([company, count]) => (
                <div key={company} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-xs">
                  <Building2 className="w-3 h-3 text-muted-foreground" />
                  <span className="font-medium">{company}</span>
                  <span className="text-muted-foreground">{count}명</span>
                  <span className={`ml-1 font-medium ${count >= 5 ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {count >= 5 ? "5인↑" : "5인↓"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
                      {/* 보건증 경고 */}
                      {healthStatus?.urgent && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${healthStatus.bg} ${healthStatus.color}`}>
                          <AlertTriangle className="w-3 h-3 inline mr-0.5" />보건증 {healthStatus.label}
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
                {isExpanded && (
                  <div className="border-t border-border px-4 py-3 space-y-3 bg-muted/30">
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

                    {/* 소속회사 */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium text-muted-foreground w-16 flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> 소속
                      </label>
                      {editingCompany?.userId === s.userId ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            className="text-xs px-2 py-1 rounded border border-input bg-background flex-1 max-w-[200px]"
                            value={editingCompany!.value}
                            onChange={(e) => setEditingCompany({ userId: s.userId, value: e.target.value })}
                            placeholder="소속회사명"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") updateCompany.mutate({ restaurantId, userId: s.userId, affiliatedCompany: editingCompany!.value || null });
                              if (e.key === "Escape") setEditingCompany(null);
                            }}
                          />
                          <button
                            onClick={() => updateCompany.mutate({ restaurantId, userId: s.userId, affiliatedCompany: editingCompany!.value || null })}
                            className="p-1 rounded hover:bg-accent text-green-600"
                          ><Check className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setEditingCompany(null)} className="p-1 rounded hover:bg-accent text-muted-foreground">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-foreground">{s.affiliatedCompany || "(미지정)"}</span>
                          <button
                            onClick={() => setEditingCompany({ userId: s.userId, value: s.affiliatedCompany || "" })}
                            className="p-1 rounded hover:bg-accent text-muted-foreground"
                          ><Edit3 className="w-3 h-3" /></button>
                        </div>
                      )}
                    </div>

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
                            ref={healthCertInputRef}
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
                            onClick={() => healthCertInputRef.current?.click()}
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

                    {/* 삭제 */}
                    <div className="flex items-center gap-3 pt-2 border-t border-border">
                      <label className="text-xs font-medium text-muted-foreground w-16 flex items-center gap-1">
                        <Trash2 className="w-3 h-3" /> 관리
                      </label>
                      <button
                        onClick={() => {
                          if (confirm(`${s.name}을(를) 매장에서 제거하시겠습니까?`))
                            removeStaff.mutate({ restaurantId, userId: s.userId });
                        }}
                        className="text-xs text-destructive hover:underline flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" /> 매장에서 제거
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 근로계약서 목록 — 점장 이상 표시 */}
      {isOwnerOrAdmin && contracts && contracts.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">근로계약서</h2>
            <span className="text-xs text-muted-foreground">{contracts.length}건</span>
          </div>
          <div className="space-y-2">
            {contracts.map((c: any) => {
              const statusMap: Record<string, { label: string; color: string; icon: string }> = {
                draft: { label: "초안", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400", icon: "📝" },
                sent: { label: "서명 대기중", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300", icon: "📨" },
                signed: { label: "서명 완료", color: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300", icon: "✅" },
                expired: { label: "만료", color: "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400", icon: "⏰" },
                cancelled: { label: "취소됨", color: "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400", icon: "❌" },
              };
              const st = statusMap[c.status] ?? statusMap.draft;
              const signUrl = `${window.location.origin}/sign/${c.token}`;
              const copyLink = () => { navigator.clipboard.writeText(signUrl).then(() => toast.success("서명 링크가 클립보드에 복사되었습니다")); };
              return (
                <div key={c.id} className="border border-border rounded-lg bg-card overflow-hidden">
                  {/* 상단: 직원 정보 + 상태 */}
                  <div className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">{c.employeeName}</span>
                          <span className="text-xs text-muted-foreground">{c.position}</span>
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
                      <button
                        onClick={copyLink}
                        className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 px-2.5 py-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                      >
                        <Link className="w-3.5 h-3.5" /> 서명 링크 복사
                      </button>
                    )}
                    {c.status === "draft" && (
                      <Button
                        size="sm" variant="default"
                        className="h-7 text-xs ml-auto"
                        onClick={() => sendContract.mutate({ id: c.id })}
                        disabled={sendContract.isPending}
                      >
                        <Send className="w-3.5 h-3.5 mr-1" /> 직원에게 발송
                      </Button>
                    )}
                    {c.status === "sent" && (
                      <span className="text-[11px] text-muted-foreground ml-auto flex items-center gap-1">
                        <Info className="w-3 h-3" /> 직원이 링크를 열어 서명하면 완료됩니다
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
          onClose={() => setShowContractForm(false)}
        />
      )}

      {/* 서명갱신/재계약 모달 */}
      {renewTarget && (
        <ContractFormModal
          restaurantId={restaurantId}
          staffList={staffList ?? []}
          defaultEmployee={renewTarget}
          onClose={() => setRenewTarget(null)}
        />
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

function ContractFormModal({ restaurantId, staffList, onClose, defaultEmployee }: {
  restaurantId: number; staffList: any[]; onClose: () => void;
  defaultEmployee?: { userId: number; name: string; affiliatedCompany?: string };
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    employeeId: defaultEmployee?.userId ?? 0,
    employeeName: defaultEmployee?.name ?? "",
    position: "직원",
    affiliatedCompany: defaultEmployee?.affiliatedCompany ?? "",
    contractType: "part_time" as "permanent" | "fixed_term" | "part_time" | "daily",
    contractStart: new Date().toISOString().slice(0, 10),
    contractEnd: "",
    wageType: "hourly" as "hourly" | "monthly",
    wageAmount: "9860",
    weeklyHours: "40",
    workStartTime: "09:00",
    workEndTime: "18:00",
    breakMinutes: 60,
    weeklyHoliday: "일요일",
    payDay: 25,
    payMethod: "bank_transfer" as "bank_transfer" | "cash",
    over5Employees: false,
    socialInsurance: true,
    hasProbation: false,
    probationMonths: 0,
    mealProvided: false,
    mealAllowance: "",
    workPlace: "",
    jobDescription: "",
    specialTerms: "",
  });

  const create = trpc.electronicContracts.createEmploymentContract.useMutation({
    onSuccess() { toast.success("계약서 초안 생성됨"); utils.electronicContracts.listEmploymentContracts.invalidate(); onClose(); },
    onError(err) { toast.error(err.message); },
  });

  const selectStaff = (userId: number) => {
    const staff = staffList.find((s: any) => s.userId === userId);
    if (staff) {
      setForm({ ...form, employeeId: userId, employeeName: staff.name, affiliatedCompany: staff.affiliatedCompany || "" });
    }
  };

  const weeklyHoursNum = Number(form.weeklyHours) || 0;
  const isUnder15Hours = weeklyHoursNum < 15;
  const wageNum = Number(form.wageAmount) || 0;
  const probationWage = Math.round(wageNum * 0.9);

  const inputCls = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  const labelCls = "text-sm font-medium text-foreground";
  const subLabelCls = "text-[10px] text-muted-foreground";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">{defaultEmployee ? "서명갱신/재계약" : "근로계약서 작성"}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          {/* ═══ 소속회사 + 사업장 규모 ═══ */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div>
              <label className={labelCls}>소속회사</label>
              <input className={inputCls} value={form.affiliatedCompany}
                onChange={(e) => setForm({ ...form, affiliatedCompany: e.target.value })}
                placeholder="인건비 정산 귀속 회사명" />
              <p className={subLabelCls}>인건비 정산 시 소속회사별로 분류됩니다</p>
            </div>
            <div className="flex items-center justify-between pt-2">
              <label className={labelCls}>사업장 규모</label>
              <div className="flex gap-1 bg-muted p-0.5 rounded-lg">
                <button type="button" onClick={() => setForm({ ...form, over5Employees: false })}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${!form.over5Employees ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
                  5인 미만
                </button>
                <button type="button" onClick={() => setForm({ ...form, over5Employees: true })}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${form.over5Employees ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
                  5인 이상
                </button>
              </div>
            </div>
            <div className={`text-[11px] rounded-md px-3 py-2 space-y-0.5 ${form.over5Employees ? "bg-blue-500/10 text-blue-700 dark:text-blue-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
              {form.over5Employees ? (
                <><p className="font-semibold">근로기준법 전면 적용</p><p>연차유급휴가, 야간/휴일 가산수당(1.5배), 부당해고 제한, 주휴수당 의무</p></>
              ) : (
                <><p className="font-semibold">근로기준법 일부 적용</p><p>해고예고(30일), 퇴직금, 최저임금 적용 / 연차·가산수당·부당해고 규정 미적용</p></>
              )}
            </div>
            <p className={subLabelCls}>※ 사업장 규모는 계약서 생성 기준 참고용이며, 실제 계약서에는 기재되지 않습니다</p>
          </div>

          {/* ═══ 직원 정보 ═══ */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>직원</label>
              <select className={inputCls} value={form.employeeId} onChange={(e) => selectStaff(Number(e.target.value))}>
                <option value={0}>선택 또는 직접입력</option>
                {staffList.map((s: any) => <option key={s.userId} value={s.userId}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>이름</label>
              <input className={inputCls} value={form.employeeName} onChange={(e) => setForm({ ...form, employeeName: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>직위</label>
              <input className={inputCls} value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>계약유형</label>
              <select className={inputCls} value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value as any })}>
                <option value="part_time">파트타임</option>
                <option value="permanent">정규직</option>
                <option value="fixed_term">기간제</option>
                <option value="daily">일용직</option>
              </select>
            </div>
          </div>

          {/* ═══ 근무장소 / 업무내용 ═══ */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>근무장소</label>
              <input className={inputCls} value={form.workPlace} onChange={(e) => setForm({ ...form, workPlace: e.target.value })} placeholder="예: 청계산뚝배기 천호점" />
            </div>
            <div>
              <label className={labelCls}>업무내용</label>
              <input className={inputCls} value={form.jobDescription} onChange={(e) => setForm({ ...form, jobDescription: e.target.value })} placeholder="예: 홀서빙, 주방보조" />
            </div>
          </div>

          {/* ═══ 계약기간 ═══ */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>계약 시작</label>
              <input type="date" className={inputCls} value={form.contractStart} onChange={(e) => setForm({ ...form, contractStart: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>계약 종료</label>
              <input type="date" className={inputCls} value={form.contractEnd} onChange={(e) => setForm({ ...form, contractEnd: e.target.value })} />
              <p className={subLabelCls}>미입력 시 기간정함 없음</p>
            </div>
          </div>

          {/* ═══ 수습기간 ═══ */}
          <div className="flex items-center gap-3 py-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.hasProbation}
                onChange={(e) => setForm({ ...form, hasProbation: e.target.checked, probationMonths: e.target.checked ? 3 : 0 })}
                className="rounded border-input" />
              <span className="text-sm text-foreground">수습기간 적용</span>
            </label>
            {form.hasProbation && (
              <div className="flex items-center gap-1.5">
                <input type="number" className="w-16 rounded-md border border-input bg-background px-2 py-1 text-sm text-center"
                  value={form.probationMonths} onChange={(e) => setForm({ ...form, probationMonths: Number(e.target.value) })} min={1} max={6} />
                <span className="text-xs text-muted-foreground">개월</span>
              </div>
            )}
          </div>
          {form.hasProbation && form.wageType === "hourly" && (
            <p className="text-[11px] text-muted-foreground px-1">
              수습 중 최저임금의 90% 적용 가능 (1년 이상 계약 시) → 시급 {probationWage.toLocaleString()}원
            </p>
          )}

          {/* ═══ 임금 ═══ */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>임금 유형</label>
              <select className={inputCls} value={form.wageType} onChange={(e) => setForm({ ...form, wageType: e.target.value as any })}>
                <option value="hourly">시급</option>
                <option value="monthly">월급</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>금액</label>
              <input type="number" className={inputCls} value={form.wageAmount} onChange={(e) => setForm({ ...form, wageAmount: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>주 근무시간</label>
              <input type="number" className={inputCls} value={form.weeklyHours} onChange={(e) => setForm({ ...form, weeklyHours: e.target.value })} />
              {isUnder15Hours && <p className="text-[10px] text-amber-500 mt-0.5">주 15시간 미만: 주휴수당·4대보험 미적용</p>}
            </div>
          </div>

          {/* ═══ 근무시간 ═══ */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>출근</label>
              <input type="time" className={inputCls} value={form.workStartTime} onChange={(e) => setForm({ ...form, workStartTime: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>퇴근</label>
              <input type="time" className={inputCls} value={form.workEndTime} onChange={(e) => setForm({ ...form, workEndTime: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>휴게(분)</label>
              <input type="number" className={inputCls} value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: Number(e.target.value) })} min={0} />
            </div>
          </div>

          {/* ═══ 급여 / 복리 ═══ */}
          <div className="grid grid-cols-3 gap-3">
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
            <div>
              <label className={labelCls}>주휴일</label>
              <input className={inputCls} value={form.weeklyHoliday} onChange={(e) => setForm({ ...form, weeklyHoliday: e.target.value })} />
            </div>
          </div>

          {/* ═══ 4대보험 / 식대 ═══ */}
          <div className="space-y-2 py-1">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.socialInsurance}
                  onChange={(e) => setForm({ ...form, socialInsurance: e.target.checked })}
                  className="rounded border-input" disabled={isUnder15Hours} />
                <span className="text-sm text-foreground">4대보험 가입</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.mealProvided}
                  onChange={(e) => setForm({ ...form, mealProvided: e.target.checked })}
                  className="rounded border-input" />
                <span className="text-sm text-foreground">식사 제공</span>
              </label>
            </div>
            {form.mealProvided && (
              <div className="flex items-center gap-2 pl-6">
                <label className="text-xs text-muted-foreground">식대(월)</label>
                <input type="number" className="w-28 rounded-md border border-input bg-background px-2 py-1 text-sm"
                  value={form.mealAllowance} onChange={(e) => setForm({ ...form, mealAllowance: e.target.value })} placeholder="0" />
                <span className="text-xs text-muted-foreground">원</span>
              </div>
            )}
            {isUnder15Hours && form.socialInsurance && (
              <p className="text-[10px] text-amber-500 pl-6">주 15시간 미만 시 4대보험 의무가입 대상 아님</p>
            )}
          </div>

          {/* ═══ 특약사항 ═══ */}
          <div>
            <label className={labelCls}>특약사항</label>
            <textarea className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
              value={form.specialTerms} onChange={(e) => setForm({ ...form, specialTerms: e.target.value })}
              placeholder="추가 약정사항이 있으면 기재" />
          </div>
        </div>

        <div className="flex gap-2 pt-4 justify-end">
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button
            onClick={() => create.mutate({
              restaurantId,
              employeeId: form.employeeId || undefined,
              employeeName: form.employeeName,
              position: form.position,
              contractType: form.contractType,
              contractStart: form.contractStart,
              contractEnd: form.contractEnd || undefined,
              wageType: form.wageType,
              wageAmount: form.wageAmount,
              weeklyHours: form.weeklyHours,
              workStartTime: form.workStartTime,
              workEndTime: form.workEndTime,
              breakMinutes: form.breakMinutes,
              weeklyHoliday: form.weeklyHoliday,
              payDay: form.payDay,
              payMethod: form.payMethod,
              over5Employees: form.over5Employees,
              socialInsurance: form.socialInsurance,
              hasProbation: form.hasProbation,
              probationMonths: form.hasProbation ? form.probationMonths : 0,
              mealProvided: form.mealProvided,
              mealAllowance: form.mealProvided ? form.mealAllowance || undefined : undefined,
              workPlace: form.workPlace || undefined,
              jobDescription: form.jobDescription || undefined,
              specialTerms: form.specialTerms || undefined,
              affiliatedCompany: form.affiliatedCompany || undefined,
            })}
            disabled={!form.employeeName || create.isPending}
          >
            {create.isPending ? "생성 중..." : "초안 생성"}
          </Button>
        </div>
      </div>
    </div>
  );
}
