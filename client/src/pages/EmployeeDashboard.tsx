import { trpc } from "../lib/trpc";
import { useAuth } from "../hooks/useAuth";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui/compat";
import { Store } from "lucide-react";

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const { data: myStores } = trpc.restaurants.listMine.useQuery();

  return (
    <div>
      <PageHeader
        title={`안녕하세요, ${user?.name}님`}
        description="오늘도 수고하세요"
      />

      {myStores?.length ? (
        <div className="space-y-2">
          {myStores.map((s: any) => (
            <Card key={s.restaurant.id} className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{s.restaurant.name}</p>
                <p className="text-xs text-muted-foreground">{s.restaurant.address || ""}</p>
              </div>
              <Badge variant={s.storeRole === "manager" ? "success" : s.storeRole === "sub_manager" ? "info" : "default"}>
                {s.storeRole === "employee" ? "직원" : s.storeRole === "sub_manager" ? "매니저" : "점장"}
              </Badge>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Store size={36} />} title="배정된 매장이 없습니다" />
      )}

      <Card className="mt-6 p-4">
        <p className="text-xs text-muted-foreground">스케줄 확인, 휴무 신청, 체크리스트는 Phase 2에서 구현됩니다</p>
      </Card>
    </div>
  );
}
