import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { trpc } from "../lib/trpc";

interface StoreInfo {
  id: number;
  name: string;
  storeRole: string;
}

interface RestaurantContextType {
  /** 현재 선택된 매장 */
  current: StoreInfo | null;
  /** 내 매장 목록 */
  stores: StoreInfo[];
  /** 매장 전환 */
  switchStore: (id: number) => void;
  /** 로딩 */
  isLoading: boolean;
}

const RestaurantContext = createContext<RestaurantContextType | null>(null);

const STORAGE_KEY = "rm_selected_store";

export function RestaurantProvider({ children }: { children: ReactNode }) {
  const { data: myStores, isLoading } = trpc.restaurants.listMine.useQuery();

  const [currentId, setCurrentId] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? Number(saved) : null;
    } catch {
      return null;
    }
  });

  const stores: StoreInfo[] = (myStores ?? []).map((s: any) => ({
    id: s.restaurant.id,
    name: s.restaurant.name,
    storeRole: s.storeRole,
  }));

  // 저장된 매장이 목록에 없으면 첫 번째 매장 선택
  useEffect(() => {
    if (stores.length === 0) return;
    const exists = stores.find(s => s.id === currentId);
    if (!exists) {
      setCurrentId(stores[0].id);
      localStorage.setItem(STORAGE_KEY, String(stores[0].id));
    }
  }, [stores, currentId]);

  const current = stores.find(s => s.id === currentId) ?? stores[0] ?? null;

  const switchStore = useCallback((id: number) => {
    setCurrentId(id);
    localStorage.setItem(STORAGE_KEY, String(id));
  }, []);

  return (
    <RestaurantContext.Provider value={{ current, stores, switchStore, isLoading }}>
      {children}
    </RestaurantContext.Provider>
  );
}

export function useRestaurant() {
  const ctx = useContext(RestaurantContext);
  if (!ctx) throw new Error("useRestaurant must be used within RestaurantProvider");
  return ctx;
}
