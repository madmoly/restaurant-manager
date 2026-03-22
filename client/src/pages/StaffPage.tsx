import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import {
  Users,
  Plus,
  ChevronDown,
  ChevronUp,
  FileText,
  Trash2,
  X,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const STORE_ROLE_LABELS: Record<string, string> = {
  store_manager: "점장",
  manager: "매니저",
  employee: "직원",
};

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function StaffPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;

  const [showAddStaff, setShowAddStaff] = useState(false);
  const [showContractForm, setShowContractForm] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<any>(null);

  const utils = trpc.useUtils();

  const { data: staffList, isLoading } = trpc.restaurants.getStaff.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  const { data: contracts } = trpc.electronicContracts.listEmploymentContracts.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  const { data: allUsers } = trpc.users.list.useQuery(undefined, { enabled: showAddStaff });

  const addStaff = trpc.restaurants.addStaff.useMutation({
    onSuccess() {
      toast.success("직원 배정됨");
      setShowAddStaff(false);
      utils.restaurants.getStaff.invalidate();
    },
    onError(err) {
      toast.error(err.message);
    },
  });

  const updateRole = trpc.restaurants.updateStaffRole.useMutation({
    onSuccess() {
      toast.success("역할 변경됨");
      utils.restaurants.getStaff.invalidate();
    },
    onError(err) {
      toast.error(err.message);
    },
  });

  const removeStaff = trpc.restaurants.removeStaff.useMutation({
    onSuccess() {
      toast.success("제거됨");
      utils.restaurants.getStaff.invalidate();
    },
    onError(err) {
      toast.error(err.message);
    },
  });

  const sendContract = trpc.electronicContracts.sendContract.useMutation({
    onSuccess() {
      toast.success("계약서 발송됨");
      utils.electronicContracts.listEmploymentContracts.invalidate();
    },
    onError(err) {
      toast.error(err.message);
    },
  });

  if (!restaurantId) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-foreground">직원 관리</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowContractForm(true)}>
            <FileText className="w-4 h-4 mr-1" /> 계약서 작성
          </Button>
          <Button size="sm" onClick={() => setShowAddStaff(true)}>
            <Plus className="w-4 h-4 mr-1" /> 직원 배정
          </Button>
        </div>
      </div>

      {/* 직원 목록 */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">로딩 중...</div>
      ) : !staffList?.length ? (
        <div className="text-center py-12">
          <Users className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">배정된 직원이 없습니다</p>
        </div>
      ) : (
        <div className="space-y-2">
          {staffList.map((s: any) => (
            <div key={s.id} className="border border-border rounded-lg bg-card px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground">{s.name}</span>
                  <span className="text-xs text-muted-foreground">@{s.username}</span>
                  <select
                    className="text-xs px-2 py-0.5 rounded border border-input bg-background"
                    value={s.storeRole}
                    onChange={(e) =>
                      updateRole.mutate({
                        restaurantId,
                        userId: s.userId,
                        role: e.target.value as any,
                      })
                    }
                  >
                    <option value="store_manager">점장</option>
                    <option value="manager">매니저</option>
                    <option value="employee">직원</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  {s.phone && (
                    <span className="text-xs text-muted-foreground">{s.phone}</span>
                  )}
                  <button
                    onClick={() => {
                      if (confirm(`${s.name}을(를) 매장에서 제거하시겠습니까?`))
                        removeStaff.mutate({ restaurantId, userId: s.userId });
                    }}
                    className="text-muted-foreground hover:text-destructive p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 근로계약서 목록 */}
      {contracts && contracts.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold text-foreground mb-3">근로계약서</h2>
          <div className="space-y-2">
            {contracts.map((c: any) => {
              const statusMap: Record<string, { label: string; color: string }> = {
                draft: { label: "초안", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
                sent: { label: "발송됨", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300" },
                signed: { label: "서명완료", color: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300" },
                expired: { label: "만료", color: "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400" },
                cancelled: { label: "취소", color: "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400" },
              };
              const st = statusMap[c.status] ?? statusMap.draft;
              return (
                <div key={c.id} className="border border-border rounded-lg bg-card px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">{c.employeeName}</span>
                      <span className="text-xs text-muted-foreground">{c.position}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${st.color}`}>
                        {st.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {c.wageType === "hourly" ? "시급" : "월급"}{" "}
                        {Number(c.wageAmount).toLocaleString()}원
                      </span>
                      {c.status === "draft" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => sendContract.mutate({ id: c.id })}
                          disabled={sendContract.isPending}
                        >
                          발송
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    계약기간: {String(c.contractStart).slice(0, 10)}
                    {c.contractEnd && ` ~ ${String(c.contractEnd).slice(0, 10)}`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 직원 배정 모달 */}
      {showAddStaff && (
        <AddStaffModal
          restaurantId={restaurantId}
          allUsers={allUsers ?? []}
          existingStaff={staffList ?? []}
          onAdd={(userId, role) => addStaff.mutate({ restaurantId, userId, role: role as any })}
          onClose={() => setShowAddStaff(false)}
          isPending={addStaff.isPending}
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
    </div>
  );
}

// ─── 직원 배정 모달 ───────────────────────────────────────────────────────────

function AddStaffModal({
  restaurantId,
  allUsers,
  existingStaff,
  onAdd,
  onClose,
  isPending,
}: {
  restaurantId: number;
  allUsers: any[];
  existingStaff: any[];
  onAdd: (userId: number, role: string) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [userId, setUserId] = useState(0);
  const [role, setRole] = useState("employee");

  const existingIds = new Set(existingStaff.map((s: any) => s.userId));
  const available = allUsers.filter((u: any) => !existingIds.has(u.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">직원 배정</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-foreground">사용자</label>
            <select
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={userId}
              onChange={(e) => setUserId(Number(e.target.value))}
            >
              <option value={0}>선택...</option>
              {available.map((u: any) => (
                <option key={u.id} value={u.id}>
                  {u.name} (@{u.username})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">역할</label>
            <select
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="store_manager">점장</option>
              <option value="manager">매니저</option>
              <option value="employee">직원</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2 pt-4 justify-end">
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={() => onAdd(userId, role)} disabled={!userId || isPending}>
            {isPending ? "배정 중..." : "배정"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── 계약서 작성 모달 ─────────────────────────────────────────────────────────

function ContractFormModal({
  restaurantId,
  staffList,
  onClose,
}: {
  restaurantId: number;
  staffList: any[];
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    employeeId: 0,
    employeeName: "",
    position: "직원",
    contractType: "part_time" as any,
    contractStart: new Date().toISOString().slice(0, 10),
    contractEnd: "",
    wageType: "hourly" as any,
    wageAmount: "9860",
    weeklyHours: "40",
    workStartTime: "09:00",
    workEndTime: "18:00",
    breakMinutes: 60,
    weeklyHoliday: "일요일",
    payDay: 25,
  });

  const create = trpc.electronicContracts.createEmploymentContract.useMutation({
    onSuccess() {
      toast.success("계약서 초안 생성됨");
      utils.electronicContracts.listEmploymentContracts.invalidate();
      onClose();
    },
    onError(err) {
      toast.error(err.message);
    },
  });

  const selectStaff = (userId: number) => {
    const staff = staffList.find((s: any) => s.userId === userId);
    if (staff) {
      setForm({ ...form, employeeId: userId, employeeName: staff.name });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">근로계약서 작성</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-foreground">직원</label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.employeeId}
                onChange={(e) => selectStaff(Number(e.target.value))}
              >
                <option value={0}>선택 또는 직접입력</option>
                {staffList.map((s: any) => (
                  <option key={s.userId} value={s.userId}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">이름</label>
              <input
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.employeeName}
                onChange={(e) => setForm({ ...form, employeeName: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-foreground">직위</label>
              <input
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">계약유형</label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.contractType}
                onChange={(e) => setForm({ ...form, contractType: e.target.value as any })}
              >
                <option value="part_time">파트타임</option>
                <option value="permanent">정규직</option>
                <option value="fixed_term">기간제</option>
                <option value="daily">일용직</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-foreground">계약 시작</label>
              <input
                type="date"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.contractStart}
                onChange={(e) => setForm({ ...form, contractStart: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">계약 종료</label>
              <input
                type="date"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.contractEnd}
                onChange={(e) => setForm({ ...form, contractEnd: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium text-foreground">임금 유형</label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.wageType}
                onChange={(e) => setForm({ ...form, wageType: e.target.value as any })}
              >
                <option value="hourly">시급</option>
                <option value="monthly">월급</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">금액</label>
              <input
                type="number"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.wageAmount}
                onChange={(e) => setForm({ ...form, wageAmount: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">주 근무시간</label>
              <input
                type="number"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.weeklyHours}
                onChange={(e) => setForm({ ...form, weeklyHours: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium text-foreground">출근</label>
              <input
                type="time"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.workStartTime}
                onChange={(e) => setForm({ ...form, workStartTime: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">퇴근</label>
              <input
                type="time"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.workEndTime}
                onChange={(e) => setForm({ ...form, workEndTime: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">급여일</label>
              <input
                type="number"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.payDay}
                onChange={(e) => setForm({ ...form, payDay: Number(e.target.value) })}
                min={1}
                max={31}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-4 justify-end">
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            onClick={() =>
              create.mutate({
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
              })
            }
            disabled={!form.employeeName || create.isPending}
          >
            {create.isPending ? "생성 중..." : "초안 생성"}
          </Button>
        </div>
      </div>
    </div>
  );
}
