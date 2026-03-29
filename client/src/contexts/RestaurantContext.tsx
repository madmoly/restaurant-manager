import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";

interface Restaurant {
  id: number;
  name: string;
  address?: string | null;
  phone?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  openTime?: string | null;
  closeTime?: string | null;
  monthlyTargetSales?: string | null;
  storeRole?: string | null;
}

interface RestaurantContextValue {
  restaurants: Restaurant[];
  selectedRestaurant: Restaurant | null;
  selectedRestaurantId: number | null;
  setSelectedRestaurantId: (id: number) => void;
  isLoading: boolean;
}

const RestaurantContext = createContext<RestaurantContextValue>({
  restaurants: [],
  selectedRestaurant: null,
  selectedRestaurantId: null,
  setSelectedRestaurantId: () => {},
  isLoading: false,
});

export function RestaurantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const isAdmin = user?.role === "admin" || user?.role === "master";

  // admin/master: 전체 매장, 그 외: 내 매장만
  const myStoresQuery = trpc.restaurants.listMine.useQuery(undefined, {
    enabled: !!user && !isAdmin,
  });
  const allStoresQuery = trpc.restaurants.list.useQuery(undefined, {
    enabled: !!user && isAdmin,
  });

  const restaurants: Restaurant[] = isAdmin
    ? (allStoresQuery.data ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        address: r.address,
        phone: r.phone,
        latitude: r.latitude,
        longitude: r.longitude,
        openTime: r.openTime,
        closeTime: r.closeTime,
        monthlyTargetSales: r.monthlyTargetSales,
      }))
    : (myStoresQuery.data ?? []).map((s: any) => ({
        id: s.restaurant?.id ?? s.id,
        name: s.restaurant?.name ?? s.name,
        address: s.restaurant?.address ?? s.address,
        phone: s.restaurant?.phone ?? s.phone,
        latitude: s.restaurant?.latitude ?? s.latitude,
        longitude: s.restaurant?.longitude ?? s.longitude,
        openTime: s.restaurant?.openTime ?? s.openTime,
        closeTime: s.restaurant?.closeTime ?? s.closeTime,
        monthlyTargetSales: s.restaurant?.monthlyTargetSales ?? s.monthlyTargetSales,
        storeRole: s.storeRole ?? null,
      }));

  const isLoading = isAdmin ? allStoresQuery.isLoading : myStoresQuery.isLoading;

  // 매장 목록 로드 시 기본 선택
  useEffect(() => {
    if (restaurants.length > 0 && selectedId === null) {
      const saved = localStorage.getItem(`selected_restaurant_${user?.id}`);
      const savedId = saved ? Number(saved) : null;
      const validSaved = savedId && restaurants.find(r => r.id === savedId);
      setSelectedId(validSaved ? savedId : restaurants[0].id);
    }
  }, [restaurants, selectedId, user?.id]);

  const handleSetSelectedId = (id: number) => {
    setSelectedId(id);
    if (user?.id) {
      localStorage.setItem(`selected_restaurant_${user.id}`, String(id));
    }
  };

  const selectedRestaurant = restaurants.find(r => r.id === selectedId) ?? null;

  return (
    <RestaurantContext.Provider value={{
      restaurants,
      selectedRestaurant,
      selectedRestaurantId: selectedId,
      setSelectedRestaurantId: handleSetSelectedId,
      isLoading,
    }}>
      {children}
    </RestaurantContext.Provider>
  );
}

export function useRestaurant() {
  return useContext(RestaurantContext);
}
