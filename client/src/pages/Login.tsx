import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Loader2, UtensilsCrossed, Lock, User, Zap } from "lucide-react";
import PWAInstallBanner from "@/components/PWAInstallBanner";

// 튜토리얼 계정 목록
const DEMO_ACCOUNTS = [
  {
    group: "관리자",
    color: "bg-violet-600",
    textColor: "text-violet-600",
    borderColor: "border-violet-200",
    bgLight: "bg-violet-50 hover:bg-violet-100",
    accounts: [
      { label: "마스터 관리자", username: "master", password: "1111", badge: "master", badgeColor: "bg-violet-100 text-violet-700" },
      { label: "관리자", username: "admin", password: "1111", badge: "admin", badgeColor: "bg-blue-100 text-blue-700" },
    ],
  },
  {
    group: "점장",
    color: "bg-emerald-600",
    textColor: "text-emerald-600",
    borderColor: "border-emerald-200",
    bgLight: "bg-emerald-50 hover:bg-emerald-100",
    accounts: [
      { label: "박점장 (천호점)", username: "tutorial_mgr1", password: "1111", badge: "천호점", badgeColor: "bg-emerald-100 text-emerald-700" },
      { label: "이점장 (강남점)", username: "tutorial_mgr2", password: "1111", badge: "강남점", badgeColor: "bg-teal-100 text-teal-700" },
    ],
  },
  {
    group: "직원",
    color: "bg-amber-500",
    textColor: "text-amber-600",
    borderColor: "border-amber-200",
    bgLight: "bg-amber-50 hover:bg-amber-100",
    accounts: [
      { label: "김민준 (천호점)", username: "tutorial_emp1", password: "1111", badge: "천호점", badgeColor: "bg-amber-100 text-amber-700" },
      { label: "이수진 (천호점)", username: "tutorial_emp2", password: "1111", badge: "천호점", badgeColor: "bg-amber-100 text-amber-700" },
      { label: "정태호 (강남점)", username: "tutorial_emp4", password: "1111", badge: "강남점", badgeColor: "bg-orange-100 text-orange-700" },
      { label: "한소희 (강남점)", username: "tutorial_emp5", password: "1111", badge: "강남점", badgeColor: "bg-yellow-100 text-yellow-700" },
    ],
  },
];

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loadingAccount, setLoadingAccount] = useState<string | null>(null);

  const loginMutation = trpc.auth.loginWithPassword.useMutation({
    onSuccess: () => {
      window.location.reload();
    },
    onError: (err) => {
      toast.error(err.message);
      setLoadingAccount(null);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error("아이디와 비밀번호를 입력해주세요.");
      return;
    }
    loginMutation.mutate({ username, password });
  };

  const handleDemoLogin = (uname: string, pass: string) => {
    setLoadingAccount(uname);
    loginMutation.mutate({ username: uname, password: pass });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-4">
      {/* 배경 장식 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-4xl flex flex-col lg:flex-row gap-6 items-start justify-center">

        {/* ── 왼쪽: 로그인 폼 ── */}
        <div className="w-full lg:w-80 shrink-0">
          {/* 로고 */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-600 rounded-2xl mb-3 shadow-lg">
              <UtensilsCrossed className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-xl font-bold text-white">331매장관리 시스템</h1>
            <p className="text-slate-400 mt-1 text-xs">Restaurant Management System</p>
          </div>

          <Card className="border-slate-700/50 bg-slate-800/60 backdrop-blur-sm shadow-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="text-white text-base">로그인</CardTitle>
              <CardDescription className="text-slate-400 text-xs">
                아이디와 비밀번호를 입력하세요
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="username" className="text-slate-300 text-xs">아이디</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <Input
                      id="username"
                      type="text"
                      placeholder="아이디를 입력하세요"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="pl-9 h-9 text-sm bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                      autoComplete="username"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-slate-300 text-xs">비밀번호</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="비밀번호를 입력하세요"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-9 h-9 text-sm bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                      autoComplete="current-password"
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium h-9 text-sm mt-1"
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending && !loadingAccount ? (
                    <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />로그인 중...</>
                  ) : "로그인"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <p className="text-center text-slate-500 text-xs mt-4">
            계정 문의는 관리자에게 연락하세요
          </p>

          {/* PWA 설치 배너 */}
          <PWAInstallBanner />
        </div>

        {/* ── 오른쪽: 원클릭 테스트 계정 패널 ── */}
        <div className="w-full lg:w-96">
          <Card className="border-slate-700/50 bg-slate-800/60 backdrop-blur-sm shadow-2xl">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-7 h-7 bg-amber-500/20 rounded-lg">
                  <Zap className="h-4 w-4 text-amber-400" />
                </div>
                <div>
                  <CardTitle className="text-white text-base">튜토리얼 계정</CardTitle>
                  <CardDescription className="text-slate-400 text-xs">
                    버튼을 클릭하면 바로 로그인됩니다
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {DEMO_ACCOUNTS.map((group, gi) => (
                <div key={gi}>
                  {gi > 0 && <Separator className="bg-slate-700/50 mb-4" />}
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-2 h-2 rounded-full ${group.color}`} />
                    <span className={`text-xs font-semibold ${group.textColor}`}>{group.group}</span>
                  </div>
                  <div className="space-y-1.5">
                    {group.accounts.map((acc) => (
                      <button
                        key={acc.username}
                        onClick={() => handleDemoLogin(acc.username, acc.password)}
                        disabled={loginMutation.isPending}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border ${group.borderColor} ${group.bgLight} transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed group`}
                      >
                        <div className="flex items-center gap-2">
                          {loadingAccount === acc.username ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
                          ) : (
                            <div className={`w-2 h-2 rounded-full ${group.color} opacity-70 group-hover:opacity-100`} />
                          )}
                          <span className="text-sm font-medium text-slate-700">{acc.label}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${acc.badgeColor}`}>
                            {acc.badge}
                          </span>
                          <span className="text-xs text-slate-400 font-mono">{acc.username}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <Separator className="bg-slate-700/50" />
              <div className="bg-slate-700/30 rounded-lg p-2.5">
                <p className="text-xs text-slate-400 leading-relaxed">
                  <span className="text-slate-300 font-medium">매장:</span> [튜토리얼] 청계산뚝배기 천호점 · 강남점<br />
                  <span className="text-slate-300 font-medium">비밀번호:</span> 모든 계정 통합 <span className="font-mono text-amber-400">1111</span>
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
