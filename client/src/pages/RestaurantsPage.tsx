import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useAuth } from "../hooks/useAuth";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import {
  Plus,
  UserPlus,
  Trash2,
  Store,
  Phone,
  MapPin,
  ClipboardList,
  Pencil,
  Camera,
  MessageSquare,
  GripVertical,
  ChevronDown,
  ChevronUp,
  History,
} from "lucide-react";

// ─── 메인 ─────────────────────────────────────────────────────────────────────

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
        <h2 className="text-lg font-semibold text-foreground">매장 관리</h2>
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

      {/* 직원 관리 */}
      <div className="bg-card rounded-lg border border-border">
        <div className="p-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">직원 관리</h3>
          <p className="text-xs text-muted-foreground mt-0.5">이 매장에 배정된 직원을 관리합니다</p>
        </div>
        <StaffSection restaurantId={current.id} />
      </div>

      {/* 체크리스트 관리 */}
      <div className="bg-card rounded-lg border border-border">
        <div className="p-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">체크리스트 관리</h3>
          <p className="text-xs text-muted-foreground mt-0.5">오픈/발주/마감 체크리스트 항목을 설정합니다</p>
        </div>
        <ChecklistManager restaurantId={current.id} />
      </div>

      {/* 체크리스트 이력 */}
      <div className="bg-card rounded-lg border border-border">
        <div className="p-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">체크리스트 이력</h3>
          <p className="text-xs text-muted-foreground mt-0.5">날짜별 체크리스트 완료 현황을 확인합니다</p>
        </div>
        <ChecklistHistory restaurantId={current.id} />
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

// ─── 직원 관리 ────────────────────────────────────────────────────────────────

function StaffSection({ restaurantId }: { restaurantId: number }) {
  const utils = trpc.useUtils();
  const { data: staff, isLoading } = trpc.restaurants.getStaff.useQuery({ restaurantId });
  const { data: allUsers } = trpc.users.list.useQuery(undefined, { retry: false });
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<"owner" | "supervisor" | "staff">("staff");

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

  return (
    <div className="p-4">
      {isLoading ? (
        <p className="text-xs text-muted-foreground">로딩 중...</p>
      ) : !staff?.length ? (
        <p className="text-xs text-muted-foreground mb-3">배정된 직원이 없습니다</p>
      ) : (
        <div className="space-y-2 mb-3">
          {staff.map((s: any) => (
            <div key={s.id} className="flex items-center justify-between text-sm">
              <div>
                <span className="text-foreground">{s.name}</span>
                <span className="text-muted-foreground ml-1.5">@{s.username}</span>
              </div>
              <div className="flex items-center gap-2">
                <select value={s.storeRole} onChange={(e) => updateRole.mutate({ restaurantId, userId: s.userId, role: e.target.value as any })} className="text-xs border border-input rounded px-2 py-1 bg-background text-foreground">
                  <option value="owner">점장</option>
                  <option value="supervisor">부점장</option>
                  <option value="staff">스태프</option>
                </select>
                <button onClick={() => removeStaff.mutate({ restaurantId, userId: s.userId })} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {allUsers && (
        <div className="flex items-center gap-2 pt-2 border-t border-border/50">
          <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)} className="flex-1 text-xs border border-input rounded px-2 py-1.5 bg-background text-foreground">
            <option value="">직원 선택...</option>
            {allUsers.filter((u: any) => !staff?.some((s: any) => s.userId === u.id)).map((u: any) => (
              <option key={u.id} value={u.id}>{u.name} (@{u.username})</option>
            ))}
          </select>
          <select value={addRole} onChange={(e) => setAddRole(e.target.value as any)} className="text-xs border border-input rounded px-2 py-1.5 bg-background text-foreground">
            <option value="owner">점장</option>
            <option value="supervisor">부점장</option>
            <option value="staff">스태프</option>
          </select>
          <button onClick={() => addUserId && addStaff.mutate({ restaurantId, userId: Number(addUserId), role: addRole })} disabled={!addUserId} className="flex items-center gap-1 px-2.5 py-1.5 bg-muted text-foreground text-xs rounded hover:bg-accent disabled:opacity-50">
            <UserPlus size={12} /> 배정
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 체크리스트 관리 ──────────────────────────────────────────────────────────

const CHECK_TYPES = [
  { key: "open" as const, label: "오픈" },
  { key: "order" as const, label: "발주" },
  { key: "cleaning" as const, label: "마감" },
];

const REQ_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  none: { label: "없음", icon: ClipboardList },
  text_input: { label: "답변입력", icon: MessageSquare },
  camera_photo: { label: "사진촬영", icon: Camera },
};

function ChecklistManager({ restaurantId }: { restaurantId: number }) {
  const [activeType, setActiveType] = useState<"open" | "order" | "cleaning">("open");
  const utils = trpc.useUtils();

  const { data: templates = [], isLoading } = trpc.storeChecklists.listAllTemplates.useQuery(
    { restaurantId, checkType: activeType },
    { enabled: restaurantId > 0 },
  );

  const activeTemplates = templates.filter((t: any) => t.isActive);

  const [showAdd, setShowAdd] = useState(false);
  const [addText, setAddText] = useState("");
  const [addReq, setAddReq] = useState<"none" | "text_input" | "camera_photo">("none");

  // 수정 상태
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [editReq, setEditReq] = useState<"none" | "text_input" | "camera_photo">("none");

  const createTemplate = trpc.storeChecklists.createTemplate.useMutation({
    onSuccess() {
      toast.success("항목 추가됨");
      utils.storeChecklists.listAllTemplates.invalidate();
      setAddText("");
      setAddReq("none");
      setShowAdd(false);
    },
    onError(err) { toast.error(err.message); },
  });

  const updateTemplate = trpc.storeChecklists.updateTemplate.useMutation({
    onSuccess() {
      toast.success("항목 수정됨");
      utils.storeChecklists.listAllTemplates.invalidate();
      setEditId(null);
    },
    onError(err) { toast.error(err.message); },
  });

  const deleteTemplate = trpc.storeChecklists.deleteTemplate.useMutation({
    onSuccess() {
      toast.success("항목 삭제됨");
      utils.storeChecklists.listAllTemplates.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const startEdit = (t: any) => {
    setEditId(t.id);
    setEditText(t.itemText);
    setEditReq(t.requirementType ?? "none");
  };

  return (
    <div className="p-4 space-y-3">
      {/* 타입 탭 */}
      <div className="flex gap-1">
        {CHECK_TYPES.map((ct) => (
          <button
            key={ct.key}
            onClick={() => { setActiveType(ct.key); setShowAdd(false); setEditId(null); }}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              activeType === ct.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
          >
            {ct.label}
          </button>
        ))}
      </div>

      {/* 항목 목록 */}
      {isLoading ? (
        <p className="text-xs text-muted-foreground">로딩 중...</p>
      ) : activeTemplates.length === 0 ? (
        <p className="text-xs text-muted-foreground">항목이 없습니다. 아래에서 추가하세요.</p>
      ) : (
        <div className="space-y-1.5">
          {activeTemplates.map((t: any) => (
            <div key={t.id} className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-muted/30">
              {editId === t.id ? (
                /* 수정 모드 */
                <div className="flex-1 space-y-2">
                  <input
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-input rounded text-sm bg-background text-foreground"
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-muted-foreground">요구사항:</label>
                    <select
                      value={editReq}
                      onChange={(e) => setEditReq(e.target.value as any)}
                      className="text-xs border border-input rounded px-2 py-1 bg-background text-foreground"
                    >
                      <option value="none">없음</option>
                      <option value="text_input">답변입력</option>
                      <option value="camera_photo">사진촬영</option>
                    </select>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => updateTemplate.mutate({ id: t.id, itemText: editText, requirementType: editReq })}
                      disabled={!editText.trim()}
                      className="px-2.5 py-1 bg-primary text-primary-foreground text-xs rounded hover:bg-primary/90 disabled:opacity-50"
                    >
                      저장
                    </button>
                    <button onClick={() => setEditId(null)} className="px-2.5 py-1 text-muted-foreground text-xs rounded hover:bg-accent">
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                /* 보기 모드 */
                <>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{t.itemText}</p>
                    {t.requirementType && t.requirementType !== "none" && (
                      <span className={`inline-flex items-center gap-0.5 mt-0.5 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        t.requirementType === "text_input"
                          ? "bg-sky-500/15 text-sky-600 dark:text-sky-400"
                          : "bg-orange-500/15 text-orange-600 dark:text-orange-400"
                      }`}>
                        {t.requirementType === "text_input" ? <MessageSquare size={10} /> : <Camera size={10} />}
                        {REQ_LABELS[t.requirementType]?.label}
                      </span>
                    )}
                  </div>
                  <button onClick={() => startEdit(t)} className="p-1 text-muted-foreground hover:text-primary">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => deleteTemplate.mutate({ id: t.id })} className="p-1 text-muted-foreground hover:text-destructive">
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 항목 추가 */}
      {showAdd ? (
        <div className="border border-primary/30 rounded-lg p-3 space-y-2 bg-primary/5">
          <input
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            placeholder="체크리스트 항목 입력..."
            className="w-full px-2.5 py-1.5 border border-input rounded text-sm bg-background text-foreground"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-muted-foreground">요구사항:</label>
            <select
              value={addReq}
              onChange={(e) => setAddReq(e.target.value as any)}
              className="text-xs border border-input rounded px-2 py-1 bg-background text-foreground"
            >
              <option value="none">없음</option>
              <option value="text_input">답변입력</option>
              <option value="camera_photo">사진촬영 (카메라만)</option>
            </select>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                if (!addText.trim()) return;
                createTemplate.mutate({
                  restaurantId,
                  checkType: activeType,
                  itemText: addText.trim(),
                  requirementType: addReq,
                  sortOrder: activeTemplates.length,
                });
              }}
              disabled={!addText.trim() || createTemplate.isPending}
              className="px-3 py-1.5 bg-primary text-primary-foreground text-xs rounded hover:bg-primary/90 disabled:opacity-50"
            >
              추가
            </button>
            <button onClick={() => { setShowAdd(false); setAddText(""); setAddReq("none"); }} className="px-3 py-1.5 text-muted-foreground text-xs rounded hover:bg-accent">
              취소
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="w-full py-2 text-xs text-primary hover:bg-primary/5 rounded-lg border border-dashed border-primary/30"
        >
          + 항목 추가
        </button>
      )}
    </div>
  );
}

// ─── 체크리스트 이력 ──────────────────────────────────────────────────────────

function ChecklistHistory({ restaurantId }: { restaurantId: number }) {
  const today = new Date();
  const [daysBack, setDaysBack] = useState(7);

  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - daysBack + 1);
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = today.toISOString().slice(0, 10);

  const { data: logs = [], isLoading } = trpc.storeChecklists.listLogs.useQuery(
    { restaurantId, startDate: startStr, endDate: endStr },
    { enabled: restaurantId > 0 },
  );

  const { data: templates = [] } = trpc.storeChecklists.listTemplates.useQuery(
    { restaurantId },
    { enabled: restaurantId > 0 },
  );

  // 날짜별로 그룹화
  const grouped: Record<string, typeof logs> = {};
  for (const log of logs) {
    const d = String(log.logDate).slice(0, 10);
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(log);
  }

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  const typeLabel = (t: string) => t === "open" ? "오픈" : t === "order" ? "발주" : "마감";

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <History size={14} className="text-muted-foreground" />
        <select
          value={daysBack}
          onChange={(e) => setDaysBack(Number(e.target.value))}
          className="text-xs border border-input rounded px-2 py-1 bg-background text-foreground"
        >
          <option value={7}>최근 7일</option>
          <option value={14}>최근 14일</option>
          <option value={30}>최근 30일</option>
        </select>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">로딩 중...</p>
      ) : sortedDates.length === 0 ? (
        <p className="text-xs text-muted-foreground">해당 기간에 완료된 체크리스트가 없습니다</p>
      ) : (
        <div className="space-y-1.5">
          {sortedDates.map((dateStr) => {
            const dayLogs = grouped[dateStr];
            const isExpanded = expandedDate === dateStr;

            // 각 타입별 완료율 계산
            const summaries = CHECK_TYPES.map((ct) => {
              const typeTemplates = templates.filter((t: any) => t.checkType === ct.key);
              const log = dayLogs.find((l) => l.checkType === ct.key);
              const checked = (log?.checkedItemIds as number[])?.length ?? 0;
              return { key: ct.key, label: ct.label, total: typeTemplates.length, checked, hasLog: !!log, log };
            }).filter((s) => s.total > 0);

            const allComplete = summaries.every((s) => s.checked >= s.total);

            return (
              <div key={dateStr} className="border border-border rounded-lg">
                <div
                  className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-accent/50"
                  onClick={() => setExpandedDate(isExpanded ? null : dateStr)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{dateStr.slice(5)}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      allComplete ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    }`}>
                      {allComplete ? "완료" : "미완료"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {summaries.map((s) => (
                      <span key={s.key} className="text-[10px] text-muted-foreground">
                        {s.label} {s.checked}/{s.total}
                      </span>
                    ))}
                    {isExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border px-3 py-2 space-y-2">
                    {summaries.map((s) => {
                      const typeTemplateList = templates.filter((t: any) => t.checkType === s.key);
                      const checkedIds = (s.log?.checkedItemIds as number[]) ?? [];
                      const checkedItems = (s.log?.checkedItems as any[]) ?? [];

                      return (
                        <div key={s.key}>
                          <p className="text-xs font-semibold text-foreground mb-1">
                            {s.label} ({s.checked}/{s.total})
                            {s.log && (
                              <span className="font-normal text-muted-foreground ml-2">
                                {(s.log as any).completedByName ?? ""} · {s.log.completedAt ? new Date(s.log.completedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : ""}
                              </span>
                            )}
                          </p>
                          <div className="space-y-0.5">
                            {typeTemplateList.map((t: any) => {
                              const isChecked = checkedIds.includes(t.id);
                              const itemData = checkedItems.find((ci: any) => ci.itemId === t.id);
                              return (
                                <div key={t.id} className="flex items-start gap-1.5 text-xs">
                                  <span className={isChecked ? "text-emerald-500" : "text-red-400"}>
                                    {isChecked ? "✓" : "✗"}
                                  </span>
                                  <div className="min-w-0">
                                    <span className={isChecked ? "text-foreground" : "text-muted-foreground"}>{t.itemText}</span>
                                    {itemData?.answer && (
                                      <p className="text-[10px] text-primary mt-0.5">답변: {itemData.answer}</p>
                                    )}
                                    {itemData?.photoUrl && (
                                      <a href={itemData.photoUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-orange-500 dark:text-orange-400 mt-0.5 block hover:underline">
                                        📷 사진 보기
                                      </a>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
