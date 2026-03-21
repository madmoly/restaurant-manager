import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

interface Restaurant {
  id: number;
  name: string;
  address?: string | null;
  phone?: string | null;
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

  // 점장/직원은 본인 담당 매장 목록, 관리자/마스터는 전체 매장
  const isManagerOrEmployee = user?.role === "manager" || user?.role === "employee";
  const isAdminOrMaster = user?.role === "admin" || user?.role === "master";

  const myRestaurantsQuery = trpc.restaurants.listMine.useQuery(undefined, {
    enabled: !!user && isManagerOrEmployee,
  });
  const allRestaurantsQuery = trpc.restaurants.list.useQuery(undefined, {
    enabled: !!user && isAdminOrMaster,
  });

  const restaurants: Restaurant[] = isManagerOrEmployee
    ? (myRestaurantsQuery.data ?? [])
    : (allRestaurantsQuery.data ?? []);

  const isLoading = isManagerOrEmployee
    ? myRestaurantsQuery.isLoading
    : allRestaurantsQuery.isLoading;

  // 매장 목록이 로드되면 첫 번째 매장을 기본 선택
  useEffect(() => {
    if (restaurants.length > 0 && selectedId === null) {
      // localStorage에 저장된 마지막 선택 매장 복원
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
