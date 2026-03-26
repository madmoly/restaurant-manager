import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useAuth } from "../hooks/useAuth";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import {
  Plus,
  Store,
  Phone,
  MapPin,
  Edit3,
  Check,
  X,
} from "lucide-react";

// ─── 메인 ─────────────────────────────────────────────────────────────────────

export default function RestaurantsPage() {
  const { user } = useAuth();
  const { selectedRestaurant: current } = useRestaurant();
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editPhone, setEditPhone] = useState("");

  const isAdmin = user?.role === "admin" || user?.role === "master";

  // 점장 이상만 수정 가능 (master, admin, owner)
  const canEdit = isAdmin || current?.storeRole === "owner" || current?.storeRole === "store_manager";

  const updateMut = trpc.restaurants.update.useMutation({
    onSuccess() {
      toast.success("매장 정보가 수정되었습니다");
      utils.restaurants.list.invalidate();
      setEditing(false);
    },
    onError(err) { toast.error(err.message); },
  });

  const startEdit = () => {
    if (!current) return;
    setEditName(current.name);
    setEditAddress(current.address || "");
    setEditPhone(current.phone || "");
    setEditing(true);
  };

  const handleUpdate = () => {
    if (!current || !editName.trim()) return;
    updateMut.mutate({
      id: current.id,
      name: editName.trim(),
      address: editAddress.trim(),
      phone: editPhone.trim(),
    });
  };

  if (!current) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">매장 정보</h2>
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Store size={20} className="text-primary" />
            </div>
            <div>
              {editing ? (
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="text-base font-semibold bg-background border border-border rounded px-2 py-1 text-foreground"
                  placeholder="매장명"
                />
              ) : (
                <>
                  <h3 className="text-base font-semibold text-foreground">{current.name}</h3>
                  <p className="text-xs text-muted-foreground">현재 선택된 매장</p>
                </>
              )}
            </div>
          </div>
          {canEdit && !editing && (
            <button
              onClick={startEdit}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
            >
              <Edit3 size={13} /> 수정
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-muted-foreground/70 shrink-0" />
              <input
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
                placeholder="주소"
                className="flex-1 px-2.5 py-1.5 border border-border rounded text-sm bg-background text-foreground"
              />
            </div>
            <div className="flex items-center gap-2">
              <Phone size={14} className="text-muted-foreground/70 shrink-0" />
              <input
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder="전화번호"
                className="flex-1 px-2.5 py-1.5 border border-border rounded text-sm bg-background text-foreground"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleUpdate}
                disabled={!editName.trim() || updateMut.isPending}
                className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground text-xs rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                <Check size={13} /> 저장
              </button>
              <button
                onClick={() => setEditing(false)}
                className="flex items-center gap-1 px-3 py-1.5 text-muted-foreground text-xs rounded-lg hover:bg-accent"
              >
                <X size={13} /> 취소
              </button>
            </div>
          </div>
        ) : (
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
        )}
      </div>

      {/* 직원 관리 → StaffPage로 이동 안내 */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">직원 관리</h3>
            <p className="text-xs text-muted-foreground mt-0.5">직원 배정, 역할 변경, 계약서, 보건증 관리</p>
          </div>
          <a href="/staff" className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            직원관리로 이동
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
