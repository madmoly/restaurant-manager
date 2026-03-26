import { useState, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { useAuth } from "../hooks/useAuth";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import { Card } from "@/components/ui/compat";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus, Store, Phone, MapPin, Edit3, Check, X,
  Users, TrendingUp, Clock, Target, ChevronRight,
  CalendarOff, ChevronLeft, Trash2,
} from "lucide-react";

// ─── 메인 ─────────────────────────────────────────────────────────────────────

export default function RestaurantsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "master";

  // admin/master → 전체 매장 종합 뷰, 그 외 → 단일 매장 정보
  if (isAdmin) return <AllRestaurantsView />;
  return <SingleRestaurantView />;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 전체 매장 종합 뷰 (admin/master)
// ═══════════════════════════════════════════════════════════════════════════════

function AllRestaurantsView() {
  const utils = trpc.useUtils();
  const { setSelectedRestaurantId } = useRestaurant();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: restaurants, isLoading } = trpc.restaurants.listWithSummary.useQuery();

  const now = new Date();
  const monthLabel = `${now.getFullYear()}년 ${now.getMonth() + 1}월`;

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-40" />
          <div className="grid gap-4 md:grid-cols-2">{[1, 2, 3].map(i => <div key={i} className="h-48 bg-muted rounded-lg" />)}</div>
        </div>
      </div>
    );
  }

  const totalStaff = restaurants?.reduce((s, r) => s + r.staffCount, 0) ?? 0;
  const totalSales = restaurants?.reduce((s, r) => s + r.monthlySales, 0) ?? 0;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">전체 매장</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {restaurants?.length ?? 0}개 매장 · 직원 {totalStaff}명 · {monthLabel} 매출 {Math.round(totalSales).toLocaleString()}원
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)} className="gap-1.5">
          <Plus size={14} />
          매장 추가
        </Button>
      </div>

      {showCreate && (
        <CreateRestaurantForm onDone={() => { setShowCreate(false); utils.restaurants.listWithSummary.invalidate(); }} />
      )}

      {/* 매장 카드 그리드 */}
      <div className="grid gap-4 md:grid-cols-2">
        {restaurants?.map(r => {
          const expanded = expandedId === r.id;
          const targetSales = Number(r.monthlyTargetSales ?? 0);
          const salesAchieve = targetSales > 0 ? Math.round(r.monthlySales / targetSales * 100) : 0;

          return (
            <Card
              key={r.id}
              className="overflow-hidden transition-all duration-200 hover:shadow-md"
            >
              {/* 상단: 매장명 + 핵심 수치 */}
              <div
                className="p-4 cursor-pointer"
                onClick={() => setExpandedId(expanded ? null : r.id)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Store size={18} className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-foreground truncate">{r.name}</h3>
                      <p className="text-[11px] text-muted-foreground truncate">{r.address || "주소 미등록"}</p>
                    </div>
                  </div>
                  <ChevronRight
                    size={16}
                    className={`text-muted-foreground shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
                  />
                </div>

                {/* KPI 행 */}
                <div className="grid grid-cols-3 gap-2">
                  <KpiPill icon={<Users size={12} />} label="직원" value={`${r.staffCount}명`} />
                  <KpiPill icon={<TrendingUp size={12} />} label={monthLabel.slice(-3)} value={`${Math.round(r.monthlySales / 10000).toLocaleString()}만`} />
                  <KpiPill
                    icon={<Target size={12} />}
                    label="달성률"
                    value={targetSales > 0 ? `${salesAchieve}%` : "-"}
                    color={salesAchieve >= 100 ? "text-emerald-600" : salesAchieve >= 70 ? "text-amber-600" : "text-muted-foreground"}
                  />
                </div>

                {/* 목표 달성 프로그레스 바 */}
                {targetSales > 0 && (
                  <div className="mt-3">
                    <div className="w-full bg-muted rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all duration-500 ${salesAchieve >= 100 ? "bg-emerald-500" : salesAchieve >= 70 ? "bg-amber-500" : "bg-red-400"}`}
                        style={{ width: `${Math.min(salesAchieve, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 확장: 상세 정보 */}
              {expanded && (
                <RestaurantDetail restaurant={r} onNavigate={() => setSelectedRestaurantId(r.id)} />
              )}
            </Card>
          );
        })}
      </div>

      {(!restaurants || restaurants.length === 0) && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          등록된 매장이 없습니다
        </div>
      )}
    </div>
  );
}

// ── KPI 알약 ──────────────────────────────────────────────────────────────────

function KpiPill({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string; color?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 bg-muted/50 rounded-lg px-2 py-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
        <p className={`text-xs font-bold tabular-nums leading-tight ${color ?? "text-foreground"}`}>{value}</p>
      </div>
    </div>
  );
}

// ── 매장 상세 펼침 ────────────────────────────────────────────────────────────

function RestaurantDetail({ restaurant: r, onNavigate }: {
  restaurant: any;
  onNavigate: () => void;
}) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: r.name, address: r.address ?? "", phone: r.phone ?? "",
    monthlyTargetSales: r.monthlyTargetSales ?? "0",
    targetLaborRatio: r.targetLaborRatio ?? "30",
    targetCostRatio: r.targetCostRatio ?? "80",
    openTime: r.openTime ?? "09:00", closeTime: r.closeTime ?? "22:00",
  });

  const updateMut = trpc.restaurants.update.useMutation({
    onSuccess() {
      toast.success("매장 정보 수정 완료");
      utils.restaurants.listWithSummary.invalidate();
      utils.restaurants.list.invalidate();
      setEditing(false);
    },
    onError(err) { toast.error(err.message); },
  });

  const handleSave = () => {
    updateMut.mutate({
      id: r.id,
      name: form.name,
      address: form.address,
      phone: form.phone,
      monthlyTargetSales: form.monthlyTargetSales,
      targetLaborRatio: form.targetLaborRatio,
      targetCostRatio: form.targetCostRatio,
      openTime: form.openTime,
      closeTime: form.closeTime,
    });
  };

  const { data: staff } = trpc.restaurants.getStaff.useQuery({ restaurantId: r.id });
  const roleLabel = (role: string) => {
    const map: Record<string, string> = { owner: "점장", supervisor: "매니져", staff: "직원", store_manager: "점장", manager: "매니져", employee: "직원" };
    return map[role] ?? role;
  };

  return (
    <div className="border-t border-border bg-muted/20 px-4 py-3 space-y-3 text-sm">
      {!editing ? (
        <>
          {/* 기본 정보 */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <InfoRow icon={<Phone size={12} />} label="전화" value={r.phone || "-"} />
            <InfoRow icon={<Clock size={12} />} label="운영" value={`${r.openTime ?? "09:00"} ~ ${r.closeTime ?? "22:00"}`} />
            <InfoRow icon={<Target size={12} />} label="월 목표" value={Number(r.monthlyTargetSales) > 0 ? `${Math.round(Number(r.monthlyTargetSales) / 10000).toLocaleString()}만원` : "미설정"} />
            <InfoRow icon={<TrendingUp size={12} />} label="원가/인건비" value={`${r.targetCostRatio ?? 80}% / ${r.targetLaborRatio ?? 30}%`} />
            <InfoRow icon={<MapPin size={12} />} label="좌표" value={r.latitude && r.longitude ? `${Number(r.latitude).toFixed(4)}, ${Number(r.longitude).toFixed(4)} (자동)` : "주소 입력 시 자동 설정"} />
          </div>

          {/* 직원 목록 */}
          {staff && staff.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">소속 직원 ({staff.length}명)</p>
              <div className="flex flex-wrap gap-1.5">
                {staff.map((s: any) => (
                  <Badge key={s.userId} variant="secondary" className="text-[11px] px-2 py-0.5 font-normal">
                    {s.name} <span className="text-muted-foreground ml-1">{roleLabel(s.storeRole)}</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setEditing(true)}>
              <Edit3 size={12} className="mr-1" /> 정보 수정
            </Button>
            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => { onNavigate(); window.location.href = "/"; }}>
              이 매장으로 이동
            </Button>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <EditField label="매장명" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
            <EditField label="전화번호" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} />
            <EditField label="주소" value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} full />
            <EditField label="운영 시작" value={form.openTime} onChange={v => setForm(f => ({ ...f, openTime: v }))} placeholder="09:00" />
            <EditField label="운영 종료" value={form.closeTime} onChange={v => setForm(f => ({ ...f, closeTime: v }))} placeholder="22:00" />
            <EditField label="월 목표매출" value={form.monthlyTargetSales} onChange={v => setForm(f => ({ ...f, monthlyTargetSales: v }))} placeholder="0" />
            <EditField label="목표 원가율(%)" value={form.targetCostRatio} onChange={v => setForm(f => ({ ...f, targetCostRatio: v }))} placeholder="80" />
            <EditField label="목표 인건비율(%)" value={form.targetLaborRatio} onChange={v => setForm(f => ({ ...f, targetLaborRatio: v }))} placeholder="30" />
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="text-xs h-7 gap-1" onClick={handleSave} disabled={!form.name.trim() || updateMut.isPending}>
              <Check size={12} /> 저장
            </Button>
            <Button size="sm" variant="ghost" className="text-xs h-7 gap-1" onClick={() => setEditing(false)}>
              <X size={12} /> 취소
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground/70">{icon}</span>
      <span className="text-muted-foreground w-12 shrink-0">{label}</span>
      <span className="text-foreground truncate">{value}</span>
    </div>
  );
}

function EditField({ label, value, onChange, placeholder, full }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; full?: boolean;
}) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <label className="text-[10px] text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2 py-1 border border-border rounded text-xs bg-background text-foreground"
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 단일 매장 정보 뷰 (manager/staff)
// ═══════════════════════════════════════════════════════════════════════════════

function SingleRestaurantView() {
  const { selectedRestaurant: current } = useRestaurant();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editPhone, setEditPhone] = useState("");

  const canEdit = current?.storeRole === "owner" || current?.storeRole === "store_manager";

  const updateMut = trpc.restaurants.update.useMutation({
    onSuccess() { toast.success("매장 정보가 수정되었습니다"); utils.restaurants.list.invalidate(); setEditing(false); },
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
    updateMut.mutate({ id: current.id, name: editName.trim(), address: editAddress.trim(), phone: editPhone.trim() });
  };

  if (!current) {
    return <div className="p-6 text-center text-muted-foreground">매장을 선택해주세요</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
      <h2 className="text-lg font-semibold text-foreground">매장 정보</h2>

      <div className="bg-card rounded-lg border border-border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Store size={20} className="text-primary" />
            </div>
            <div>
              {editing ? (
                <input value={editName} onChange={(e) => setEditName(e.target.value)}
                  className="text-base font-semibold bg-background border border-border rounded px-2 py-1 text-foreground" placeholder="매장명" />
              ) : (
                <>
                  <h3 className="text-base font-semibold text-foreground">{current.name}</h3>
                  <p className="text-xs text-muted-foreground">현재 선택된 매장</p>
                </>
              )}
            </div>
          </div>
          {canEdit && !editing && (
            <button onClick={startEdit} className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors">
              <Edit3 size={13} /> 수정
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-muted-foreground/70 shrink-0" />
              <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="주소"
                className="flex-1 px-2.5 py-1.5 border border-border rounded text-sm bg-background text-foreground" />
            </div>
            <div className="flex items-center gap-2">
              <Phone size={14} className="text-muted-foreground/70 shrink-0" />
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="전화번호"
                className="flex-1 px-2.5 py-1.5 border border-border rounded text-sm bg-background text-foreground" />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleUpdate} disabled={!editName.trim() || updateMut.isPending}
                className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground text-xs rounded-lg hover:bg-primary/90 disabled:opacity-50">
                <Check size={13} /> 저장
              </button>
              <button onClick={() => setEditing(false)} className="flex items-center gap-1 px-3 py-1.5 text-muted-foreground text-xs rounded-lg hover:bg-accent">
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

      {/* 휴무일 관리 */}
      <ClosedDaysManager restaurantId={current.id} canEdit={!!canEdit} />

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

// ─── 휴무일 관리 ──────────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function ClosedDaysManager({ restaurantId, canEdit }: { restaurantId: number; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth() + 1);
  const [addDate, setAddDate] = useState("");
  const [addReason, setAddReason] = useState("");

  // 정기 휴무 요일 조회
  const weeklyQ = trpc.storeClosures.getWeeklyClosures.useQuery({ restaurantId });
  const weeklyClosedSet = useMemo(() => new Set((weeklyQ.data || []).map((w: any) => w.weekday)), [weeklyQ.data]);

  // 특정 휴무일 조회
  const closedQ = trpc.storeClosures.listByMonth.useQuery({ restaurantId, year: viewYear, month: viewMonth });

  // Mutations
  const setWeekly = trpc.storeClosures.setWeeklyClosures.useMutation({
    onSuccess() { utils.storeClosures.getWeeklyClosures.invalidate(); toast.success("정기 휴무 저장됨"); },
    onError(err: any) { toast.error(err.message); },
  });
  const addClosed = trpc.storeClosures.create.useMutation({
    onSuccess() { utils.storeClosures.listByMonth.invalidate(); setAddDate(""); setAddReason(""); toast.success("휴무일 추가됨"); },
    onError(err: any) { toast.error(err.message); },
  });
  const delClosed = trpc.storeClosures.delete.useMutation({
    onSuccess() { utils.storeClosures.listByMonth.invalidate(); toast.success("휴무일 삭제됨"); },
    onError(err: any) { toast.error(err.message); },
  });

  const toggleWeekday = (wd: number) => {
    const next = new Set(weeklyClosedSet);
    if (next.has(wd)) next.delete(wd);
    else next.add(wd);
    setWeekly.mutate({ restaurantId, closedDays: Array.from(next) });
  };

  const prevMonth = () => {
    if (viewMonth === 1) { setViewYear(viewYear - 1); setViewMonth(12); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 12) { setViewYear(viewYear + 1); setViewMonth(1); }
    else setViewMonth(viewMonth + 1);
  };

  // 달력 렌더링용 데이터
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth - 1, 1).getDay(); // 0=일
  const closedDateSet = useMemo(
    () => new Set((closedQ.data || []).map((d: any) => typeof d.closedDate === "string" ? d.closedDate : new Date(d.closedDate).toISOString().split("T")[0])),
    [closedQ.data]
  );
  const closedDateMap = useMemo(() => {
    const m: Record<string, { id: number; reason?: string | null }> = {};
    for (const d of closedQ.data || []) {
      const ds = typeof d.closedDate === "string" ? d.closedDate : new Date(d.closedDate).toISOString().split("T")[0];
      m[ds] = { id: d.id, reason: d.reason };
    }
    return m;
  }, [closedQ.data]);

  return (
    <div className="bg-card rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center gap-2">
        <CalendarOff size={16} className="text-red-500" />
        <h3 className="text-sm font-semibold text-foreground">휴무일 관리</h3>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">지정된 휴무일에는 스케줄 배정이 제한됩니다.</p>

      {/* 정기 휴무 요일 */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground">정기 휴무 요일</h4>
        <div className="flex gap-1.5">
          {WEEKDAY_LABELS.map((label, idx) => {
            const active = weeklyClosedSet.has(idx);
            return (
              <button
                key={idx}
                disabled={!canEdit || setWeekly.isPending}
                onClick={() => toggleWeekday(idx)}
                className={`w-9 h-9 rounded-lg text-xs font-semibold transition-all ${
                  active
                    ? "bg-red-500 text-white shadow-sm"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                } ${!canEdit ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 특정 휴무일 캘린더 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-muted-foreground">특정 휴무일</h4>
          <div className="flex items-center gap-1">
            <button onClick={prevMonth} className="p-1 rounded hover:bg-muted"><ChevronLeft size={14} /></button>
            <span className="text-xs font-medium text-foreground min-w-[80px] text-center">{viewYear}년 {viewMonth}월</span>
            <button onClick={nextMonth} className="p-1 rounded hover:bg-muted"><ChevronRight size={14} /></button>
          </div>
        </div>

        {/* 미니 캘린더 */}
        <div className="grid grid-cols-7 gap-0.5 text-center">
          {WEEKDAY_LABELS.map((l, i) => (
            <div key={i} className={`text-[10px] font-medium py-1 ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-muted-foreground"}`}>{l}</div>
          ))}
          {Array.from({ length: firstDow }).map((_, i) => <div key={`e-${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const ds = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const dow = new Date(viewYear, viewMonth - 1, day).getDay();
            const isWeeklyClosed = weeklyClosedSet.has(dow);
            const isSpecificClosed = closedDateSet.has(ds);
            const isClosed = isWeeklyClosed || isSpecificClosed;
            const closedInfo = closedDateMap[ds];

            return (
              <button
                key={day}
                disabled={!canEdit || isWeeklyClosed}
                title={closedInfo?.reason || (isWeeklyClosed ? "정기 휴무" : undefined)}
                onClick={() => {
                  if (isSpecificClosed && closedInfo) {
                    delClosed.mutate({ id: closedInfo.id });
                  } else if (!isWeeklyClosed) {
                    addClosed.mutate({ restaurantId, closedDate: ds });
                  }
                }}
                className={`h-8 rounded text-xs transition-all ${
                  isClosed
                    ? isWeeklyClosed
                      ? "bg-red-500/20 text-red-500 font-bold cursor-default"
                      : "bg-red-500 text-white font-bold hover:bg-red-600"
                    : "text-foreground hover:bg-primary/10"
                } ${dow === 0 ? "text-red-400" : dow === 6 ? "text-blue-400" : ""} ${!canEdit ? "cursor-default" : ""}`}
              >
                {day}
              </button>
            );
          })}
        </div>

        {/* 범례 */}
        <div className="flex gap-3 text-[10px] text-muted-foreground pt-1">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500/20 inline-block" /> 정기 휴무</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500 inline-block" /> 지정 휴무</span>
          <span className="flex items-center gap-1">클릭으로 지정/해제</span>
        </div>

        {/* 이번 달 특정 휴무일 리스트 */}
        {(closedQ.data || []).length > 0 && (
          <div className="space-y-1 pt-1">
            {(closedQ.data || []).map((d: any) => {
              const ds = typeof d.closedDate === "string" ? d.closedDate : new Date(d.closedDate).toISOString().split("T")[0];
              const dt = new Date(d.closedDate);
              const dow = dt.getDay();
              return (
                <div key={d.id} className="flex items-center justify-between py-1.5 px-2 rounded bg-red-50 dark:bg-red-500/10 text-xs">
                  <span className="text-foreground">
                    {ds.split("-")[1]}/{ds.split("-")[2]} ({WEEKDAY_LABELS[dow]})
                    {d.reason && <span className="text-muted-foreground ml-1">— {d.reason}</span>}
                  </span>
                  {canEdit && (
                    <button onClick={() => delClosed.mutate({ id: d.id })} className="text-red-400 hover:text-red-600 p-1">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
    <Card className="border-primary/30 p-4 space-y-3">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="매장명 *" className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground" />
      <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="주소" className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="전화번호" className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground" />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => create.mutate({ name, address, phone })} disabled={!name}>등록</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>취소</Button>
      </div>
    </Card>
  );
}
