import { useState } from "react";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Plus, Users, ChevronDown, ChevronUp, Phone, X, Building2,
  UserPlus, KeyRound, Store, Check,
} from "lucide-react";

const SYSTEM_ROLE_LABELS: Record<string, { label: string; color: string }> = {
  master: { label: "개발자", color: "bg-red-500/15 text-red-600 dark:text-red-400" },
  admin: { label: "대표", color: "bg-purple-500/15 text-purple-600 dark:text-purple-400" },
  user: { label: "일반", color: "bg-muted text-muted-foreground" },
  manager: { label: "매니져", color: "bg-muted text-muted-foreground" },
  employee: { label: "직원", color: "bg-muted text-muted-foreground" },
};

const STORE_ROLE_LABELS: Record<string, string> = {
  owner: "점장", supervisor: "매니져", staff: "직원",
  store_manager: "점장", manager: "매니져", employee: "직원",
};

export default function UsersPage() {
  const utils = trpc.useUtils();
  const { data: usersList, isLoading } = trpc.users.listWithAssignments.useQuery();
  const { data: restaurantList } = trpc.restaurants.list.useQuery();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  const [assignTarget, setAssignTarget] = useState<{ userId: number; name: string } | null>(null);
  const [assignRestaurantId, setAssignRestaurantId] = useState(0);
  const [assignRole, setAssignRole] = useState<"staff" | "supervisor" | "owner">("staff");

  const addStaff = trpc.restaurants.addStaff.useMutation({
    onSuccess() {
      toast.success("매장 배정 완료");
      setAssignTarget(null);
      setAssignRestaurantId(0);
      setAssignRole("staff");
      utils.users.listWithAssignments.invalidate();
    },
    onError(err) { toast.error(err.message); },
  });

  const removeStaff = trpc.restaurants.removeStaff.useMutation({
    onSuccess() { toast.success("매장 배정 해제됨"); utils.users.listWithAssignments.invalidate(); },
    onError(err) { toast.error(err.message); },
  });

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Users className="w-5 h-5" /> 사용자 관리
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            시스템 계정 (개발자 · 대표 · 일반) 관리 — 일반 직원 추가는 <a href="/staff" className="text-blue-600 dark:text-blue-400 hover:underline">/staff 페이지</a>에서 처리됩니다
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)} className="text-xs">
          <Plus className="w-3.5 h-3.5 mr-1" /> 사용자 추가
        </Button>
      </div>

      {/* 사용자 추가 폼 */}
      {showCreate && (
        <CreateUserForm onDone={() => {
          setShowCreate(false);
          utils.users.listWithAssignments.invalidate();
        }} />
      )}

      {/* 사용자 목록 */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">로딩 중...</div>
      ) : !usersList?.length ? (
        <div className="text-center py-12 bg-card border border-border rounded-lg">
          <Users className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">등록된 사용자가 없습니다</p>
        </div>
      ) : (
        <div className="space-y-2">
          {usersList.map((u: any) => {
            const isExpanded = expandedUser === u.id;
            const sysRole = SYSTEM_ROLE_LABELS[u.role] ?? SYSTEM_ROLE_LABELS.user;
            const hasAssignments = u.assignments && u.assignments.length > 0;

            return (
              <div key={u.id} className="border border-border rounded-lg bg-card overflow-hidden">
                {/* 메인 행 */}
                <div
                  className="px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-accent/30 transition-colors"
                  onClick={() => setExpandedUser(isExpanded ? null : u.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{u.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${sysRole.color}`}>
                        {sysRole.label}
                      </span>
                      {!u.isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
                          비활성
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                      <span>@{u.username}</span>
                      {u.phone && (
                        <span className="flex items-center gap-0.5">
                          <Phone className="w-3 h-3" />{u.phone}
                        </span>
                      )}
                    </div>
                    {/* 매장 배정 현황 (접힌 상태에서도 표시) */}
                    {hasAssignments && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {u.assignments.map((a: any) => (
                          <span key={a.restaurantId} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 flex items-center gap-1">
                            <Store className="w-3 h-3" />
                            {a.restaurantName}
                            <span className="text-blue-500 dark:text-blue-400">({STORE_ROLE_LABELS[a.storeRole] || a.storeRole})</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {!hasAssignments && u.role !== "master" && u.role !== "admin" && (
                      <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                        매장 미배정
                      </div>
                    )}
                  </div>
                  <div className="pt-1 shrink-0">
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </div>

                {/* 확장 패널 */}
                {isExpanded && (
                  <div className="border-t border-border px-4 py-3 space-y-3 bg-muted/30">
                    {/* 매장 배정 현황 */}
                    <div>
                      <div className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-2">
                        <Building2 className="w-3 h-3" /> 매장 배정
                      </div>
                      {hasAssignments ? (
                        <div className="space-y-1.5">
                          {u.assignments.map((a: any) => (
                            <div key={a.restaurantId} className="flex items-center justify-between text-xs bg-background border border-border rounded-md px-3 py-2">
                              <div className="flex items-center gap-2">
                                <Store className="w-3.5 h-3.5 text-muted-foreground" />
                                <span className="font-medium text-foreground">{a.restaurantName}</span>
                                <span className="text-muted-foreground">{STORE_ROLE_LABELS[a.storeRole] || a.storeRole}</span>
                              </div>
                              <button
                                onClick={() => {
                                  if (confirm(`${u.name}을(를) ${a.restaurantName}에서 제거하시겠습니까?`))
                                    removeStaff.mutate({ restaurantId: a.restaurantId, userId: u.id });
                                }}
                                className="text-muted-foreground hover:text-red-500 transition-colors p-1"
                                title="배정 해제"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground bg-background border border-border rounded-md px-3 py-2">
                          배정된 매장이 없습니다
                        </div>
                      )}

                      {/* 매장 배정 버튼 */}
                      {assignTarget?.userId === u.id ? (
                        <div className="mt-2 bg-background border border-border rounded-md p-3 space-y-2">
                          <div className="text-xs font-medium text-foreground">매장 배정</div>
                          <div className="flex items-center gap-2">
                            <select
                              className="text-xs px-2 py-1.5 rounded-md border border-input bg-background flex-1"
                              value={assignRestaurantId}
                              onChange={(e) => setAssignRestaurantId(Number(e.target.value))}
                            >
                              <option value={0}>매장 선택...</option>
                              {restaurantList?.filter((r: any) =>
                                !u.assignments?.some((a: any) => a.restaurantId === r.id)
                              ).map((r: any) => (
                                <option key={r.id} value={r.id}>{r.name}</option>
                              ))}
                            </select>
                            <select
                              className="text-xs px-2 py-1.5 rounded-md border border-input bg-background"
                              value={assignRole}
                              onChange={(e) => setAssignRole(e.target.value as any)}
                            >
                              <option value="staff">직원</option>
                              <option value="supervisor">매니져</option>
                              <option value="owner">점장</option>
                            </select>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm" className="text-xs h-7"
                              disabled={!assignRestaurantId || addStaff.isPending}
                              onClick={() => addStaff.mutate({
                                restaurantId: assignRestaurantId,
                                userId: u.id,
                                role: assignRole,
                              })}
                            >
                              {addStaff.isPending ? "배정 중..." : "배정"}
                            </Button>
                            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setAssignTarget(null)}>
                              취소
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setAssignTarget({ userId: u.id, name: u.name })}
                          className="mt-2 flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          <UserPlus className="w-3 h-3" /> 매장 배정 추가
                        </button>
                      )}
                    </div>

                    {/* 계정 정보 */}
                    <div className="border-t border-border pt-3">
                      <div className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
                        <KeyRound className="w-3 h-3" /> 계정 정보
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <div>아이디: <span className="text-foreground">@{u.username}</span></div>
                        <div>시스템 역할: <span className="text-foreground">{sysRole.label}</span></div>
                        {u.email && <div>이메일: <span className="text-foreground">{u.email}</span></div>}
                        {u.phone && <div>연락처: <span className="text-foreground">{u.phone}</span></div>}
                      </div>
                    </div>
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

// ─── 사용자 생성 폼 ──────────────────────────────────────────────────────────

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"master" | "admin" | "user">("user");
  const [phone, setPhone] = useState("");

  const create = trpc.users.create.useMutation({
    onSuccess() { toast.success("사용자가 생성되었습니다"); onDone(); },
    onError(err) { toast.error(err.message); },
  });

  const inputCls = "px-3 py-2 border border-input rounded-md text-sm bg-background text-foreground";

  return (
    <div className="bg-card rounded-lg border border-border p-4 space-y-3">
      <div className="text-sm font-semibold text-foreground">새 사용자 추가</div>
      <div className="grid grid-cols-2 gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 *" className={inputCls} />
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="아이디 *" className={inputCls} />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호 *" className={inputCls} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="전화번호" className={inputCls} />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">시스템 역할</label>
        <select value={role} onChange={(e) => setRole(e.target.value as any)} className={`mt-1 w-full ${inputCls}`}>
          <option value="user">일반 사용자</option>
          <option value="admin">대표</option>
          <option value="master">개발자</option>
        </select>
        <p className="text-[10px] text-muted-foreground mt-1">
          일반 사용자는 매장 배정 후 매장 역할(점장/매니져/직원)로 권한이 결정됩니다
        </p>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onDone} className="text-xs">취소</Button>
        <Button
          size="sm" className="text-xs"
          onClick={() => create.mutate({ username, password, name, role, phone })}
          disabled={!username || !password || !name || create.isPending}
        >
          {create.isPending ? "생성 중..." : "생성"}
        </Button>
      </div>
    </div>
  );
}
