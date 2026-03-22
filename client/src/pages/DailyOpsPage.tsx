import { useState, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import {
  Sun,
  Moon,
  CheckSquare,
  ClipboardList,
  Truck,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtTime(d: Date | string | null) {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// ─── 체크리스트 섹션 ──────────────────────────────────────────────────────────

function ChecklistSection({
  restaurantId,
  date,
  checkType,
  label,
  icon: Icon,
}: {
  restaurantId: number;
  date: string;
  checkType: "open" | "order" | "cleaning";
  label: string;
  icon: React.ElementType;
}) {
  const utils = trpc.useUtils();

  const { data: templates = [] } = trpc.storeChecklists.listTemplates.useQuery(
    { restaurantId, checkType },
    { enabled: restaurantId > 0 }
  );

  const { data: log } = trpc.storeChecklists.getLog.useQuery(
    { restaurantId, logDate: date, checkType },
    { enabled: restaurantId > 0 }
  );

  const saveLog = trpc.storeChecklists.saveLog.useMutation({
    onSuccess() {
      toast.success(`${label} 저장됨`);
      utils.storeChecklists.getLog.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const checkedIds = (log?.checkedItemIds as number[]) ?? [];

  const toggleItem = (itemId: number) => {
    const newIds = checkedIds.includes(itemId)
      ? checkedIds.filter((id) => id !== itemId)
      : [...checkedIds, itemId];
    saveLog.mutate({
      restaurantId,
      logDate: date,
      checkType,
      checkedItemIds: newIds,
    });
  };

  if (templates.length === 0) {
    return (
      <div className="border border-border rounded-lg p-4 bg-card">
        <div className="flex items-center gap-2 mb-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">{label}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          템플릿이 없습니다. 매장 설정에서 체크리스트 항목을 추가해주세요.
        </p>
      </div>
    );
  }

  const totalItems = templates.length;
  const checkedCount = templates.filter((t) => checkedIds.includes(t.id)).length;
  const allDone = checkedCount === totalItems;

  return (
    <div className={`border rounded-lg p-4 ${allDone ? "border-green-500/50 bg-green-50/50 dark:bg-green-950/20" : "border-border bg-card"}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${allDone ? "text-green-600" : "text-muted-foreground"}`} />
          <span className="text-sm font-semibold text-foreground">{label}</span>
        </div>
        <span className={`text-xs font-medium ${allDone ? "text-green-600" : "text-muted-foreground"}`}>
          {checkedCount}/{totalItems}
        </span>
      </div>
      <div className="space-y-1.5">
        {templates.map((t) => {
          const checked = checkedIds.includes(t.id);
          return (
            <label
              key={t.id}
              className="flex items-center gap-2 cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleItem(t.id)}
                className="rounded border-input"
              />
              <span
                className={`text-sm ${
                  checked ? "line-through text-muted-foreground" : "text-foreground"
                }`}
              >
                {t.itemText}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function DailyOpsPage() {
  const { selectedRestaurant: current } = useRestaurant();
  const restaurantId = current?.id ?? 0;

  const [date, setDate] = useState(new Date());
  const dateStr = fmtDate(date);

  const utils = trpc.useUtils();

  const { data: ops } = trpc.dailyOps.getByDate.useQuery(
    { restaurantId, date: dateStr },
    { enabled: restaurantId > 0 }
  );

  const checkOpen = trpc.dailyOps.checkOpen.useMutation({
    onSuccess() {
      toast.success("오픈 체크 완료");
      utils.dailyOps.getByDate.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const checkClose = trpc.dailyOps.checkClose.useMutation({
    onSuccess() {
      toast.success("마감 체크 완료");
      utils.dailyOps.getByDate.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const prevDay = () => {
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    setDate(d);
  };
  const nextDay = () => {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    setDate(d);
  };
  const goToday = () => setDate(new Date());

  if (!current) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  const isToday = dateStr === fmtDate(new Date());

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
      {/* 헤더 */}
      <h1 className="text-xl font-bold text-foreground">일일 운영</h1>

      {/* 날짜 네비게이션 */}
      <div className="flex items-center justify-center gap-4">
        <Button variant="ghost" size="icon" onClick={prevDay}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <button
          onClick={goToday}
          className={`text-sm font-medium ${isToday ? "text-primary" : "text-foreground"} hover:text-primary`}
        >
          {date.getFullYear()}년 {date.getMonth() + 1}월 {date.getDate()}일
          {isToday && " (오늘)"}
        </button>
        <Button variant="ghost" size="icon" onClick={nextDay}>
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>

      {/* 오픈/마감 상태 */}
      <div className="grid grid-cols-2 gap-3">
        {/* 오픈 체크 */}
        <div className={`border rounded-lg p-4 ${ops?.openCheckedAt ? "border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20" : "border-border bg-card"}`}>
          <div className="flex items-center gap-2 mb-2">
            <Sun className={`w-4 h-4 ${ops?.openCheckedAt ? "text-amber-600" : "text-muted-foreground"}`} />
            <span className="text-sm font-semibold text-foreground">오픈 체크</span>
          </div>
          {ops?.openCheckedAt ? (
            <div className="text-xs text-muted-foreground space-y-1">
              <div>체크 시각: {fmtTime(ops.openCheckedAt)}</div>
              <div>출근 인원: {ops.openHeadcount}명</div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="w-full mt-2"
              onClick={() => checkOpen.mutate({ restaurantId, date: dateStr })}
              disabled={checkOpen.isPending}
            >
              오픈 체크하기
            </Button>
          )}
        </div>

        {/* 마감 체크 */}
        <div className={`border rounded-lg p-4 ${ops?.closeCheckedAt ? "border-indigo-500/50 bg-indigo-50/50 dark:bg-indigo-950/20" : "border-border bg-card"}`}>
          <div className="flex items-center gap-2 mb-2">
            <Moon className={`w-4 h-4 ${ops?.closeCheckedAt ? "text-indigo-600" : "text-muted-foreground"}`} />
            <span className="text-sm font-semibold text-foreground">마감 체크</span>
          </div>
          {ops?.closeCheckedAt ? (
            <div className="text-xs text-muted-foreground space-y-1">
              <div>체크 시각: {fmtTime(ops.closeCheckedAt)}</div>
              <div>최종 인원: {ops.closeHeadcount}명</div>
              {ops.closeNote && <div>메모: {ops.closeNote}</div>}
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="w-full mt-2"
              onClick={() => checkClose.mutate({ restaurantId, date: dateStr })}
              disabled={checkClose.isPending}
            >
              마감 체크하기
            </Button>
          )}
        </div>
      </div>

      {/* 체크리스트 섹션들 */}
      <div className="space-y-3">
        <ChecklistSection
          restaurantId={restaurantId}
          date={dateStr}
          checkType="open"
          label="오픈 체크리스트"
          icon={ClipboardList}
        />
        <ChecklistSection
          restaurantId={restaurantId}
          date={dateStr}
          checkType="order"
          label="발주 확인"
          icon={Truck}
        />
        <ChecklistSection
          restaurantId={restaurantId}
          date={dateStr}
          checkType="cleaning"
          label="청소 체크리스트"
          icon={Sparkles}
        />
      </div>
    </div>
  );
}
