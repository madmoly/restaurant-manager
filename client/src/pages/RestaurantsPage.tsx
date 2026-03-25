import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useAuth } from "../hooks/useAuth";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import { Plus, Store, Phone, MapPin } from "lucide-react";

// ─── 메인 ────────────────────────────────────────────────────────────────────
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
        <h2 className="text-lg font-semibold text-foreground">내 매장 관리</h2>
        {isAdmin && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90"
          >
            <Plus size={16} /> 매장 추가
          </button>
        )}
      </div>

      {showCreate && (
        <CreateRestaurantForm
          onDone={() => {
            setShowCreate(false);
            utils.restaurants.list.invalidate();
          }}
        />
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
    </div>
  );
}

// ─── 매장 생성 폼 ────────────────────────────────────────────────────────────
function CreateRestaurantForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const create = trpc.restaurants.create.useMutation({
    onSuccess() {
      toast.success("매장이 등록되었습니다");
      onDone();
    },
    onError(err) {
      toast.error(err.message);
    },
  });

  return (
    <div className="bg-card rounded-lg border border-primary/30 p-4 mb-4 space-y-3">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="매장명 *"
        className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground" />
      <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="주소"
        className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="전화번호"
        className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground" />
      <div className="flex gap-2">
        <button onClick={() => create.mutate({ name, address, phone })} disabled={!name}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 disabled:opacity-50">등록</button>
        <button onClick={onDone}
          className="px-4 py-2 text-muted-foreground text-sm rounded-lg hover:bg-accent">취소</button>
      </div>
    </div>
  );
}
