import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useAuth } from "../hooks/useAuth";
import { toast } from "sonner";
import { Plus, ChevronDown, ChevronUp, UserPlus, Trash2 } from "lucide-react";

export default function RestaurantsPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const { data: restaurants, isLoading } = trpc.restaurants.list.useQuery();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">매장 관리</h2>
          <p className="text-sm text-gray-500">매장 정보와 직원을 관리하세요</p>
        </div>
        {user?.role === "admin" && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
          >
            <Plus size={16} />
            매장 추가
          </button>
        )}
      </div>

      {showCreate && <CreateRestaurantForm onDone={() => { setShowCreate(false); utils.restaurants.list.invalidate(); }} />}

      {isLoading ? (
        <div className="text-sm text-gray-400 py-8 text-center">로딩 중...</div>
      ) : !restaurants?.length ? (
        <div className="text-sm text-gray-500 py-8 text-center">등록된 매장이 없습니다</div>
      ) : (
        <div className="space-y-3">
          {restaurants.map((r: any) => (
            <div key={r.id} className="bg-white rounded-lg border border-gray-200">
              <div
                className="p-4 flex items-center justify-between cursor-pointer"
                onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{r.name}</p>
                  <p className="text-xs text-gray-500">{r.address || "주소 미등록"} · {r.phone || "전화 미등록"}</p>
                </div>
                {expandedId === r.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
              </div>
              {expandedId === r.id && <StaffSection restaurantId={r.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateRestaurantForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");

  const create = trpc.restaurants.create.useMutation({
    onSuccess() { toast.success("매장이 등록되었습니다"); onDone(); },
    onError(err) { toast.error(err.message); },
  });

  return (
    <div className="bg-white rounded-lg border border-blue-200 p-4 mb-4 space-y-3">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="매장명 *" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="주소" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="전화번호" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      <div className="flex gap-2">
        <button onClick={() => create.mutate({ name, address, phone })} disabled={!name} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">등록</button>
        <button onClick={onDone} className="px-4 py-2 text-gray-600 text-sm rounded-lg hover:bg-gray-50">취소</button>
      </div>
    </div>
  );
}

function StaffSection({ restaurantId }: { restaurantId: number }) {
  const utils = trpc.useUtils();
  const { data: staff, isLoading } = trpc.restaurants.getStaff.useQuery({ restaurantId });
  const { data: allUsers } = trpc.users.list.useQuery(undefined, { retry: false });
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<"manager" | "sub_manager" | "employee">("employee");

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

  const roleLabel = (r: string) => r === "manager" ? "점장" : r === "sub_manager" ? "매니저" : "직원";

  return (
    <div className="border-t border-gray-100 p-4">
      <h4 className="text-xs font-medium text-gray-500 mb-3">직원 목록</h4>

      {isLoading ? (
        <p className="text-xs text-gray-400">로딩 중...</p>
      ) : !staff?.length ? (
        <p className="text-xs text-gray-400 mb-3">배정된 직원이 없습니다</p>
      ) : (
        <div className="space-y-2 mb-3">
          {staff.map((s: any) => (
            <div key={s.id} className="flex items-center justify-between text-sm">
              <div>
                <span className="text-gray-900">{s.name}</span>
                <span className="text-gray-400 ml-1.5">@{s.username}</span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={s.storeRole}
                  onChange={(e) => updateRole.mutate({ restaurantId, userId: s.userId, role: e.target.value as any })}
                  className="text-xs border border-gray-200 rounded px-2 py-1"
                >
                  <option value="manager">점장</option>
                  <option value="sub_manager">매니저</option>
                  <option value="employee">직원</option>
                </select>
                <button onClick={() => removeStaff.mutate({ restaurantId, userId: s.userId })} className="text-red-400 hover:text-red-600">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 직원 추가 */}
      {allUsers && (
        <div className="flex items-center gap-2 pt-2 border-t border-gray-50">
          <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)} className="flex-1 text-xs border border-gray-200 rounded px-2 py-1.5">
            <option value="">직원 선택...</option>
            {allUsers
              .filter((u: any) => !staff?.some((s: any) => s.userId === u.id))
              .map((u: any) => (
                <option key={u.id} value={u.id}>{u.name} (@{u.username})</option>
              ))}
          </select>
          <select value={addRole} onChange={(e) => setAddRole(e.target.value as any)} className="text-xs border border-gray-200 rounded px-2 py-1.5">
            <option value="manager">점장</option>
            <option value="sub_manager">매니저</option>
            <option value="employee">직원</option>
          </select>
          <button
            onClick={() => addUserId && addStaff.mutate({ restaurantId, userId: Number(addUserId), role: addRole })}
            disabled={!addUserId}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-100 text-gray-700 text-xs rounded hover:bg-gray-200 disabled:opacity-50"
          >
            <UserPlus size={12} />
            배정
          </button>
        </div>
      )}
    </div>
  );
}
