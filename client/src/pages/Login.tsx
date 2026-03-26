import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Loader2, UtensilsCrossed, Lock, User, GraduationCap, Download, Smartphone, ShieldCheck, Users, UserCog } from "lucide-react";

// Tutorial 계정 (seed.ts 기준)
const TUTORIAL_ACCOUNTS = [
  {
    label: "Tutorial 점장",
    description: "매장 전체 관리 (재무·인사·운영)",
    username: "owner1",
    password: "1111",
    icon: ShieldCheck,
    color: "bg-emerald-600",
    textColor: "text-emerald-400",
    borderColor: "border-emerald-500/30",
    bgLight: "bg-emerald-500/10 hover:bg-emerald-500/20",
    badgeColor: "bg-emerald-500/20 text-emerald-300",
    badge: "점장",
  },
  {
    label: "Tutorial 매니져",
    description: "운영 실행 + 일부 관리 권한",
    username: "supervisor1",
    password: "1111",
    icon: UserCog,
    color: "bg-sky-600",
    textColor: "text-sky-400",
    borderColor: "border-sky-500/30",
    bgLight: "bg-sky-500/10 hover:bg-sky-500/20",
    badgeColor: "bg-sky-500/20 text-sky-300",
    badge: "매니져",
  },
  {
    label: "Tutorial 직원",
    description: "일일 업무 실행 (매출·체크리스트)",
    username: "staff1",
    password: "1111",
    icon: Users,
    color: "bg-amber-500",
    textColor: "text-amber-400",
    borderColor: "border-amber-500/30",
    bgLight: "bg-amber-500/10 hover:bg-amber-500/20",
    badgeColor: "bg-amber-500/20 text-amber-300",
    badge: "직원",
  },
];

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loadingAccount, setLoadingAccount] = useState<string | null>(null);
  const { login } = useAuth();
  const [, setLocation] = useLocation();

  // PWA 설치
  const deferredPrompt = useRef<any>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isIosSafari, setIsIosSafari] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as any).standalone === true;
    setIsStandalone(standalone);

    const ua = navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|Chrome/.test(ua);
    if (isIos && isSafari && !standalone) {
      setIsIosSafari(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e;
      setCanInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess(data) {
      login(data.token, data.user, data.mustChangePassword);
      if (data.mustChangePassword) {
        setLocation("/change-password");
        toast.info("비밀번호 변경이 필요합니다");
      } else {
        setLocation("/");
        toast.success(`${data.user.name}님 환영합니다`);
      }
      setLoadingAccount(null);
    },
    onError(err) {
      toast.error(err.message);
      setLoadingAccount(null);
    },
  });

  const handleInstall = async () => {
    if (!deferredPrompt.current) return;
    deferredPrompt.current.prompt();
    const result = await deferredPrompt.current.userChoice;
    if (result.outcome === 'accepted') {
      setCanInstall(false);
      toast.success('앱이 설치되었습니다');
    }
    deferredPrompt.current = null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error("아이디와 비밀번호를 입력해주세요.");
      return;
    }
    loginMutation.mutate({ username, password });
  };

  const handleTutorialLogin = (uname: string, pass: string) => {
    setLoadingAccount(uname);
    loginMutation.mutate({ username: uname, password: pass });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 p-4">
      {/* 배경 장식 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-green-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-4xl flex flex-col lg:flex-row gap-6 items-start justify-center">

        {/* ── 왼쪽: 로그인 폼 ── */}
        <div className="w-full lg:w-80 shrink-0">
          {/* 로고 */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-primary rounded-2xl mb-3 shadow-lg shadow-primary/40">
              <UtensilsCrossed className="h-7 w-7 text-primary-foreground" />
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
                      className="pl-9 h-9 text-sm bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-primary"
                      autoComplete="username"
                      autoFocus
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
                      className="pl-9 h-9 text-sm bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-primary"
                      autoComplete="current-password"
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full font-medium h-9 text-sm mt-1"
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending && !loadingAccount ? (
                    <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />로그인 중...</>
                  ) : "로그인"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* PWA 앱 설치 */}
          {!isStandalone && (canInstall || isIosSafari) && (
            <div className="mt-4 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-2">
                <Smartphone className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-300">앱으로 설치</span>
              </div>
              {canInstall ? (
                <Button
                  onClick={handleInstall}
                  variant="outline"
                  className="w-full h-9 text-sm border-emerald-500/40 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 hover:text-white"
                >
                  <Download className="mr-2 h-4 w-4" />
                  홈 화면에 추가
                </Button>
              ) : isIosSafari ? (
                <p className="text-xs text-slate-300 leading-relaxed">
                  Safari 하단의 <span className="inline-block px-1 py-0.5 bg-slate-700/60 rounded text-emerald-300 font-medium">공유 ↑</span> 버튼 →{" "}
                  <span className="text-emerald-300 font-medium">홈 화면에 추가</span>를 선택하세요
                </p>
              ) : null}
            </div>
          )}

          <p className="text-center text-slate-500 text-xs mt-4">
            계정 문의는 관리자에게 연락하세요
          </p>
        </div>

        {/* ── 오른쪽: Tutorial 체험 패널 ── */}
        <div className="w-full lg:w-96">
          <Card className="border-slate-700/50 bg-slate-800/60 backdrop-blur-sm shadow-2xl">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-7 h-7 bg-emerald-500/20 rounded-lg">
                  <GraduationCap className="h-4 w-4 text-emerald-400" />
                </div>
                <div>
                  <CardTitle className="text-white text-base">Tutorial 체험</CardTitle>
                  <CardDescription className="text-slate-400 text-xs">
                    역할별 체험 — 클릭하면 바로 로그인됩니다
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {TUTORIAL_ACCOUNTS.map((acc, i) => {
                const Icon = acc.icon;
                return (
                  <button
                    key={acc.username}
                    onClick={() => handleTutorialLogin(acc.username, acc.password)}
                    disabled={loginMutation.isPending}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg border ${acc.borderColor} ${acc.bgLight} transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed group`}
                  >
                    <div className={`flex items-center justify-center w-9 h-9 rounded-lg ${acc.color}/20`}>
                      {loadingAccount === acc.username ? (
                        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                      ) : (
                        <Icon className={`h-4 w-4 ${acc.textColor}`} />
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-200">{acc.label}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${acc.badgeColor}`}>
                          {acc.badge}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{acc.description}</p>
                    </div>
                  </button>
                );
              })}

              <Separator className="bg-slate-700/50 my-3" />
              <div className="bg-slate-700/30 rounded-lg p-2.5">
                <p className="text-xs text-slate-400 leading-relaxed">
                  <span className="text-slate-300 font-medium">Tutorial 매장</span>에 3개월치 샘플 데이터가 준비되어 있습니다.
                  각 역할별로 접근 가능한 메뉴와 기능이 다릅니다.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
