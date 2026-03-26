import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function ChangePasswordPage() {
  const { user, mustChangePassword, clearMustChangePassword, logout } = useAuth();
  const [, navigate] = useLocation();

  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    newPasswordConfirm: "",
  });
  const [error, setError] = useState("");

  const changePw = trpc.auth.changePassword.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (form.newPassword.length < 4) return setError("새 비밀번호는 4자 이상이어야 합니다");
    if (form.newPassword !== form.newPasswordConfirm) return setError("새 비밀번호가 일치하지 않습니다");
    if (form.currentPassword === form.newPassword) return setError("현재 비밀번호와 다른 비밀번호를 입력하세요");

    try {
      await changePw.mutateAsync({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });

      clearMustChangePassword();
      toast.success("비밀번호가 변경되었습니다");
      navigate("/");
    } catch (err: any) {
      setError(err.message || "비밀번호 변경 중 오류가 발생했습니다");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <div className="bg-amber-100 dark:bg-amber-900/30 rounded-full p-3">
              <KeyRound className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </div>
          </div>
          <CardTitle className="text-xl">비밀번호 변경</CardTitle>
          <CardDescription>
            {mustChangePassword
              ? "보안을 위해 비밀번호를 변경해주세요. 관리자가 초기화한 비밀번호는 변경이 필요합니다."
              : "새 비밀번호를 설정합니다."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">현재 비밀번호</Label>
              <Input
                id="currentPassword"
                type="password"
                value={form.currentPassword}
                onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">새 비밀번호</Label>
              <Input
                id="newPassword"
                type="password"
                placeholder="4자 이상"
                value={form.newPassword}
                onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPasswordConfirm">새 비밀번호 확인</Label>
              <Input
                id="newPasswordConfirm"
                type="password"
                value={form.newPasswordConfirm}
                onChange={(e) => setForm({ ...form, newPasswordConfirm: e.target.value })}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950 p-3 rounded-lg">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={changePw.isPending}>
              {changePw.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> 변경 중...</>
              ) : (
                "비밀번호 변경"
              )}
            </Button>

            {!mustChangePassword && (
              <div className="text-center">
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-primary"
                  onClick={() => navigate("/")}
                >
                  돌아가기
                </button>
              </div>
            )}

            {mustChangePassword && (
              <div className="text-center">
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-destructive"
                  onClick={() => { logout(); navigate("/login"); }}
                >
                  로그아웃
                </button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
