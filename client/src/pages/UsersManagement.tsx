import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search, Users, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<string, string> = { master: "마스터", admin: "관리자", manager: "점장", employee: "직원" };
const ROLE_COLORS: Record<string, string> = {
  master: "bg-purple-100 text-purple-700",
  admin: "bg-blue-100 text-blue-700",
  manager: "bg-green-100 text-green-700",
  employee: "bg-slate-100 text-slate-700",
};

export default function UsersManagement() {
  const utils = trpc.useUtils();
  const usersQuery = trpc.users.list.useQuery();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<{ id: number; name: string; role: string; phone?: string | null } | null>(null);
  const [credUser, setCredUser] = useState<{ id: number; name: string; username: string } | null>(null);
  const [credForm, setCredForm] = useState({ username: "", password: "", confirmPassword: "" });
  const [form, setForm] = useState({ username: "", password: "", name: "", role: "employee" as "master" | "admin" | "manager" | "employee", phone: "" });

  const createMutation = trpc.users.create.useMutation({
    onSuccess: () => { utils.users.list.invalidate(); setShowCreate(false); setForm({ username: "", password: "", name: "", role: "employee", phone: "" }); toast.success("사용자가 생성되었습니다."); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.users.update.useMutation({
    onSuccess: () => { utils.users.list.invalidate(); setEditUser(null); toast.success("수정되었습니다."); },
    onError: (e) => toast.error(e.message),
  });
  const updateCredMutation = trpc.users.update.useMutation({
    onSuccess: () => {
      utils.users.list.invalidate();
      setCredUser(null);
      setCredForm({ username: "", password: "", confirmPassword: "" });
      toast.success("계정 정보가 수정되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.users.delete.useMutation({
    onSuccess: () => { utils.users.list.invalidate(); toast.success("비활성화되었습니다."); },
    onError: (e) => toast.error(e.message),
  });

  const users = (usersQuery.data ?? []).filter(u =>
    !search || u.name?.includes(search) || u.username?.includes(search)
  );

  const handleCredSave = () => {
    if (!credUser) return;
    if (!credForm.username && !credForm.password) {
      toast.error("아이디 또는 비밀번호 중 하나 이상 입력하세요.");
      return;
    }
    if (credForm.password && credForm.password !== credForm.confirmPassword) {
      toast.error("비밀번호가 일치하지 않습니다.");
      return;
    }
    if (credForm.password && credForm.password.length < 4) {
      toast.error("비밀번호는 4자 이상이어야 합니다.");
      return;
    }
    updateCredMutation.mutate({
      id: credUser.id,
      ...(credForm.username ? { username: credForm.username } : {}),
      ...(credForm.password ? { password: credForm.password } : {}),
    });
  };

  return (
    <AppLayout title="사용자 관리" subtitle="전체 계정 관리">
      <div className="p-4 lg:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="이름 또는 아이디 검색" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> 사용자 추가
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4" /> 전체 사용자 ({users.length}명)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-2 text-xs font-medium text-muted-foreground">이름</th>
                    <th className="text-left py-2 px-2 text-xs font-medium text-muted-foreground">아이디</th>
                    <th className="text-left py-2 px-2 text-xs font-medium text-muted-foreground">역할</th>
                    <th className="text-left py-2 px-2 text-xs font-medium text-muted-foreground">연락처</th>
                    <th className="text-left py-2 px-2 text-xs font-medium text-muted-foreground">가입일</th>
                    <th className="text-right py-2 px-2 text-xs font-medium text-muted-foreground">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-xs">사용자가 없습니다</td></tr>
                  ) : users.map(u => (
                    <tr key={u.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 px-2 font-medium">{u.name ?? "-"}</td>
                      <td className="py-2.5 px-2 text-muted-foreground">{u.username ?? "-"}</td>
                      <td className="py-2.5 px-2">
                        <Badge className={cn("text-xs", ROLE_COLORS[u.role] ?? "bg-slate-100 text-slate-700")}>
                          {ROLE_LABELS[u.role] ?? u.role}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-2 text-muted-foreground text-xs">{u.phone ?? "-"}</td>
                      <td className="py-2.5 px-2 text-muted-foreground text-xs">{new Date(u.createdAt).toLocaleDateString("ko-KR")}</td>
                      <td className="py-2.5 px-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-amber-600 hover:text-amber-700"
                            title="아이디/비밀번호 수정"
                            onClick={() => {
                              setCredUser({ id: u.id, name: u.name ?? "", username: u.username ?? "" });
                              setCredForm({ username: u.username ?? "", password: "", confirmPassword: "" });
                            }}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditUser({ id: u.id, name: u.name ?? "", role: u.role, phone: u.phone })}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => { if (confirm(`${u.name}을(를) 비활성화하시겠습니까?`)) deleteMutation.mutate({ id: u.id }); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* 아이디/비밀번호 수정 다이얼로그 */}
        <Dialog open={!!credUser} onOpenChange={v => { if (!v) { setCredUser(null); setCredForm({ username: "", password: "", confirmPassword: "" }); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-amber-600" />
                계정 정보 수정 — {credUser?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">아이디</Label>
                <Input
                  value={credForm.username}
                  onChange={e => setCredForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="새 아이디 입력"
                  className="mt-1 h-9"
                />
              </div>
              <div>
                <Label className="text-xs">새 비밀번호 (변경 시에만 입력)</Label>
                <Input
                  type="password"
                  value={credForm.password}
                  onChange={e => setCredForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="4자 이상"
                  className="mt-1 h-9"
                />
              </div>
              <div>
                <Label className="text-xs">비밀번호 확인</Label>
                <Input
                  type="password"
                  value={credForm.confirmPassword}
                  onChange={e => setCredForm(f => ({ ...f, confirmPassword: e.target.value }))}
                  placeholder="비밀번호 재입력"
                  className="mt-1 h-9"
                />
                {credForm.password && credForm.confirmPassword && credForm.password !== credForm.confirmPassword && (
                  <p className="text-xs text-destructive mt-1">비밀번호가 일치하지 않습니다.</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">비밀번호를 변경하지 않으려면 비밀번호 칸을 비워두세요.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => { setCredUser(null); setCredForm({ username: "", password: "", confirmPassword: "" }); }}>취소</Button>
              <Button size="sm" onClick={handleCredSave} disabled={updateCredMutation.isPending}>
                {updateCredMutation.isPending ? "저장 중..." : "저장"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 사용자 생성 다이얼로그 */}
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>새 사용자 추가</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label className="text-xs">아이디 *</Label><Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="로그인 아이디" className="mt-1 h-9" /></div>
              <div><Label className="text-xs">비밀번호 *</Label><Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="4자 이상" className="mt-1 h-9" /></div>
              <div><Label className="text-xs">이름 *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="실명" className="mt-1 h-9" /></div>
              <div>
                <Label className="text-xs">역할 *</Label>
                <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v as typeof form.role }))}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">직원</SelectItem>
                    <SelectItem value="manager">점장</SelectItem>
                    <SelectItem value="admin">관리자</SelectItem>
                    <SelectItem value="master">마스터</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">연락처</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="010-0000-0000" className="mt-1 h-9" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>취소</Button>
              <Button size="sm" onClick={() => createMutation.mutate(form)} disabled={createMutation.isPending}>생성</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 사용자 수정 다이얼로그 */}
        <Dialog open={!!editUser} onOpenChange={() => setEditUser(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>사용자 수정</DialogTitle></DialogHeader>
            {editUser && (
              <div className="space-y-3">
                <div><Label className="text-xs">이름</Label><Input value={editUser.name} onChange={e => setEditUser(u => u ? { ...u, name: e.target.value } : null)} className="mt-1 h-9" /></div>
                <div>
                  <Label className="text-xs">역할</Label>
                  <Select value={editUser.role} onValueChange={v => setEditUser(u => u ? { ...u, role: v } : null)}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">직원</SelectItem>
                      <SelectItem value="manager">점장</SelectItem>
                      <SelectItem value="admin">관리자</SelectItem>
                      <SelectItem value="master">마스터</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">연락처</Label><Input value={editUser.phone ?? ""} onChange={e => setEditUser(u => u ? { ...u, phone: e.target.value } : null)} className="mt-1 h-9" /></div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setEditUser(null)}>취소</Button>
              <Button size="sm" onClick={() => editUser && updateMutation.mutate({ id: editUser.id, name: editUser.name, role: editUser.role as "master" | "admin" | "manager" | "employee", phone: editUser.phone ?? undefined })} disabled={updateMutation.isPending}>저장</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
