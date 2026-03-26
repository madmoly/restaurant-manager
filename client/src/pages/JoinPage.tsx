import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, Loader2, Store, UserPlus } from "lucide-react";

export default function JoinPage({ code }: { code: string }) {
  const { login } = useAuth();
  const [, navigate] = useLocation();

  // 초대코드 검증
  const validateQuery = trpc.invites.validate.useQuery(
    { code },
    { retry: false }
  );

  const registerMutation = trpc.invites.register.useMutation();

  const [form, setForm] = useState({
    name: "",
    username: "",
    password: "",
    passwordConfirm: "",
    phone: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!form.name.trim()) return setError("이름을 입력해주세요");
    if (form.username.length < 3) return setError("아이디는 3자 이상이어야 합니다");
    if (form.password.length < 4) return setError("비밀번호는 4자 이상이어야 합니다");
    if (form.password !== form.passwordConfirm) return setError("비밀번호가 일치하지 않습니다");

    try {
      const result = await registerMutation.mutateAsync({
        code,
        name: form.name.trim(),
        username: form.username.trim(),
        password: form.password,
        phone: form.phone.trim() || undefined,
      });

      // 등록 성공 → 로그인 처리
      login(result.token, result.user);
      setSuccess(true);

      // 1.5초 후 메인으로 이동
      setTimeout(() => navigate("/"), 1500);
    } catch (err: any) {
      setError(err.message || "등록 중 오류가 발생했습니다");
    }
  };

  // 로딩
  if (validateQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // 유효하지 않은 초대코드
  if (!validateQuery.data?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">초대코드 오류</h2>
            <p className="text-muted-foreground">
              {validateQuery.data?.reason ?? "유효하지 않은 초대코드입니다"}
            </p>
            <Button variant="outline" className="mt-6" onClick={() => navigate("/login")}>
              로그인 페이지로
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 등록 성공
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">등록 완료!</h2>
            <p className="text-muted-foreground">
              {validateQuery.data.restaurantName}에 {validateQuery.data.roleLabel}(으)로 등록되었습니다.
            </p>
            <p className="text-sm text-muted-foreground mt-2">잠시 후 메인 페이지로 이동합니다...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const inviteData = validateQuery.data;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <div className="bg-primary/10 rounded-full p-3">
              <UserPlus className="h-6 w-6 text-primary" />
            </div>
          </div>
          <CardTitle className="text-xl">매장 직원 등록</CardTitle>
          <CardDescription className="space-y-1">
            <span className="flex items-center justify-center gap-1.5 mt-1">
              <Store className="h-4 w-4" />
              <span className="font-medium text-foreground">{inviteData.restaurantName}</span>
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                {inviteData.roleLabel}
              </span>
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">이름 *</Label>
              <Input
                id="name"
                placeholder="실명을 입력하세요"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">아이디 *</Label>
              <Input
                id="username"
                placeholder="로그인에 사용할 아이디"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">비밀번호 *</Label>
              <Input
                id="password"
                type="password"
                placeholder="4자 이상"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="passwordConfirm">비밀번호 확인 *</Label>
              <Input
                id="passwordConfirm"
                type="password"
                placeholder="비밀번호를 다시 입력"
                value={form.passwordConfirm}
                onChange={(e) => setForm({ ...form, passwordConfirm: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">연락처</Label>
              <Input
                id="phone"
                placeholder="010-0000-0000 (선택)"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950 p-3 rounded-lg">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={registerMutation.isPending}
            >
              {registerMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> 등록 중...</>
              ) : (
                "등록하기"
              )}
            </Button>

            <div className="text-center">
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-primary"
                onClick={() => navigate("/login")}
              >
                이미 계정이 있나요? 로그인
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
