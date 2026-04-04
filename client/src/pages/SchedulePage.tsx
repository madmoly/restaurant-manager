import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { getEffectiveRole, isManagerLevel } from "@shared/permissions";
import ScheduleGridTab from "./ScheduleGridTab";
import LeaveRequestTab from "./LeaveRequestTab";
import ShiftPresetTab from "./ShiftPresetTab";

export default function SchedulePage() {
  const { user } = useAuth();
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;
  const effectiveRole = getEffectiveRole(user?.role ?? "user", current?.storeRole ?? null);
  const isManager = isManagerLevel(effectiveRole);

  const [activeTab, setActiveTab] = useState<"schedule" | "leave" | "settings">("schedule");

  // 공통 데이터 (한 번만 fetch)
  const { data: shiftPresets = [], refetch: refetchPresets } = trpc.restaurants.getShiftPresets.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  if (!current) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  const tabs = [
    { key: "schedule" as const, label: "스케줄" },
    { key: "leave" as const, label: "휴무신청" },
    ...(isManager ? [{ key: "settings" as const, label: "근무설정" }] : []),
  ];

  return (
    <div className="p-3 md:p-6 max-w-4xl mx-auto">
      {/* 탭 바 */}
      <div className="flex gap-1 border-b border-border mb-4">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "schedule" && (
        <ScheduleGridTab
          restaurantId={restaurantId}
          isManager={isManager}
          shiftPresets={shiftPresets}
          current={current}
        />
      )}
      {activeTab === "leave" && (
        <LeaveRequestTab restaurantId={restaurantId} isManager={isManager} />
      )}
      {activeTab === "settings" && isManager && (
        <ShiftPresetTab
          restaurantId={restaurantId}
          shiftPresets={shiftPresets}
          onPresetsChange={refetchPresets}
        />
      )}
    </div>
  );
}
