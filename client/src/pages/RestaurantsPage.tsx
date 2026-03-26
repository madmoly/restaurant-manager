import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useAuth } from "../hooks/useAuth";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import {
  Plus,
  UserPlus,
  Trash2,
  Store,
  Phone,
  MapPin,
} from "lucide-react";

// ─── 메인 ─────────────────────────────────────────────────────────────────────

export default function RestaurantsPage() {
  const { user } = useAuth();
  const { selectedRestaurant: current } = useRestaurant();
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);

  const isAdmin = user?.role === "admin" || user?.role === "master";

  if (!current) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">매장 관리</h2>
        {isAdmin && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90"
          >
            <Plus size={16} />
            매장 추가
          </button>
        )}
      </div>

      {showCreate && (
        <CreateRestaurantForm onDone={() => { setShowCreate(false); utils.restaurants.list.invalidate(); }} />
      )}

      {/* 매장 정보 카드 */}
      <div className="bg-card rounded-lg border border-border p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Store size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">{current.name}</h3>
            <p className="text-xs text-muted-foreground">현재 선택된 매장</p>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin size={14} className="text-muted-foreground/70 shrink-0" />
            <span>{current.address || "주소 미등록"}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Phone size={14} className="text-muted-foreground/70 shrink-0" />
            <span>{current.phone || "전화번호 미등록"}</span>
          </div>
        </div>
      </div>

      {/* 직원 관리 */}
      <div className="bg-card rounded-lg border border-border">
        <div className="p-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">직원 관리</h3>
          <p className="text-xs text-muted-foreground mt-0.5">이 매장에 배정된 직원을 관리합니다</p>
        </div>
        <StaffSection restaurantId={current.id} />
      </div>

      {/* 체크리스트 설정 → 업무관리로 이동 안내 */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">일일운영 체크리스트 설정</h3>
            <p className="text-xs text-muted-foreground mt-0.5">오픈/매입/일간보고/마감 체크리스트 항목 관리 및 이력</p>
          </div>
          <a href="/task-management" className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            업무관리로 이동
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── 매장 생성 폼 ─────────────────────────────────────────────────────────────

function CreateRestaurantForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");

  const create = trpc.restaurants.create.useMutation({
    onSuccess() { toast.success("매장이 등록되었습니다"); onDone(); },
    onError(err) { toast.error(err.message); },
  });

  return (
    <div className="bg-card rounded-lg border border-primary/30 p-4 mb-4 space-y-3">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="매장명 *" className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground" />
      <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="주소" className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="전화번호" className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground" />
      <div className="flex gap-2">
        <button onClick={() => create.mutate({ name, address, phone })} disabled={!name} className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 disabled:opacity-50">등록</button>
        <button onClick={onDone} className="px-4 py-2 text-muted-foreground text-sm rounded-lg hover:bg-accent">취소</button>
      </div>
    </div>
  );
}

// ─── 직원 관리 ────────────────────────────────────────────────────────────────

function StaffSection({ restaurantId }: { restaurantId: number }) {
  const utils = trpc.useUtils();
  const { data: staff, isLoading } = trpc.restaurants.getStaff.useQuery({ restaurantId });
  const { data: allUsers } = trpc.users.list.useQuery(undefined, { retry: false });
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<"manager" | "store_manager" | "employee">("employee");

  const addStaff = trpc.restaurants.addStaff.useMutation({
    onSuccess() { toast.success("직원이 배정되었습니다"); utils.restaurants.getStaff.invalidate({ restaurantId }); setAddUserId(""); },
    onError(err) { toast.error(err.message); },
  });
  const removeStaff = trpc.restaurants.removeStaff.useMutation({
    onSuccess() { toast.success("직원이 해제되었습니다"); utils.restaurants.getStaff.invalidate({ restaurantId }); },
    onError(err) { toast.error(err.message); },
  });
  const updateRole = trpc.restaurants.updateStaffRole.useMutation({
    onSuccess() { toast.success("역할이 변경되었습니다"); utils.restaurants.getStaff.invalidate({ restaurantId }); },
    onError(err) { toast.error(err.message); },
  });

  return (
    <div className="p-4">
      {isLoading ? (
        <p className="text-xs text-muted-foreground">로딩 중...</p>
      ) : !staff?.length ? (
        <p className="text-xs text-muted-foreground mb-3">배정된 직원이 없습니다</p>
      ) : (
        <div className="space-y-2 mb-3">
          {staff.map((s: any) => (
            <div key={s.id} className="flex items-center justify-between text-sm">
              <div>
                <span className="text-foreground">{s.name}</span>
                <span className="text-muted-foreground ml-1.5">@{s.username}</span>
              </div>
              <div className="flex items-center gap-2">
                <select value={s.storeRole} onChange={(e) => updateRole.mutate({ restaurantId, userId: s.userId, role: e.target.value as any })} className="text-xs border border-input rounded px-2 py-1 bg-background text-foreground">
                  <option value="store_manager">점장</option>
                  <option value="manager">매니저</option>
                  <option value="employee">직원</option>
                </select>
                <button onClick={() => removeStaff.mutate({ restaurantId, userId: s.userId })} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {allUsers && (
        <div className="flex items-center gap-2 pt-2 border-t border-border/50">
          <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)} className="flex-1 text-xs border border-input rounded px-2 py-1.5 bg-background text-foreground">
            <option value="">직원 선택...</option>
            {allUsers.filter((u: any) => !staff?.some((s: any) => s.userId === u.id)).map((u: any) => (
              <option key={u.id} value={u.id}>{u.name} (@{u.username})</option>
            ))}
          </select>
          <select value={addRole} onChange={(e) => setAddRole(e.target.value as any)} className="text-xs border border-input rounded px-2 py-1.5 bg-background text-foreground">
            <option value="store_manager">점장</option>
            <option value="manager">매니저</option>
            <option value="employee">직원</option>
          </select>
          <button onClick={() => addUserId && addStaff.mutate({ restaurantId, userId: Number(addUserId), role: addRole })} disabled={!addUserId} className="flex items-center gap-1 px-2.5 py-1.5 bg-muted text-foreground text-xs rounded hover:bg-accent disabled:opacity-50">
            <UserPlus size={12} /> 배정
          </button>
        </div>
      )}
    </div>
  );
}

// ChecklistManager / ChecklistHistory → TaskManagementPage로 통합됨
