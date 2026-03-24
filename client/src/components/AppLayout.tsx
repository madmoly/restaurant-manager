import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ROLE_LABELS, type EffectiveRole } from "@shared/permissions";
import { 
  UtensilsCrossed, LogOut, Menu, X, Sun, Moon, MoreHorizontal,
  Check, Building2,
  
  // 새롭게 개편된 직관적인 프리미엄 아이콘 세트
  LayoutGrid, Activity, CalendarRange, ListChecks, Clock,
  UsersRound, Coins, BarChart3, Receipt, ShoppingCart, ShieldCheck,
  Store, BellRing, Bell
} from "lucide-react";

// ─── 타입 ─────────────────────────────────────────────────────────────────────
interface NavItem {
  label: string;
  labelByRole?: Partial<Record<EffectiveRole, string>>;
  href: string;
  icon: ReactNode;
  mobileIcon: ReactNode;
  roles: EffectiveRole[];
  /** 역할별 모바일 하단탭 우선순위 (1~4만 탭에 표시, 나머지는 더보기) */
  mobileTabPriority?: Partial<Record<EffectiveRole, number>>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// ─── 카테고리 그룹 정의 ──────────────────────────────────────────────────────
// 모바일 하단탭 목표:
//   master/admin: 대시보드(1), 사용자관리(2), 스케줄(3), 수익분석(4)
//   manager:      대시보드(1), 일일운영(2), 스케줄(3), 분석캘린더(4)
//   employee:     대시보드(1), 일일운영(2), 스케줄(3)
const NAV_GROUPS: NavGroup[] = [
  {
    label: "일일 운영",
    items: [
      {
        label: "대시보드", href: "/",
        icon: <LayoutGrid className="h-4 w-4" />,
        mobileIcon: <LayoutGrid className="h-5 w-5" />,
        roles: ["master", "admin", "manager", "staff"],
        mobileTabPriority: { master: 1, admin: 1, manager: 1, staff: 1 },
      },
      {
        label: "일일 운영", href: "/daily-ops",
        icon: <Activity className="h-4 w-4" />,
        mobileIcon: <Activity className="h-5 w-5" />,
        roles: ["master", "admin", "manager", "staff"],
        mobileTabPriority: { manager: 2, staff: 2 },
      },
      {
        label: "운영 캘린더", href: "/ops-calendar",
        icon: <CalendarRange className="h-4 w-4" />,
        mobileIcon: <CalendarRange className="h-5 w-5" />,
        roles: ["master", "admin", "manager"],
      },
      {
        label: "내 매장 업무관리", href: "/task-management",
        icon: <ListChecks className="h-4 w-4" />,
        mobileIcon: <ListChecks className="h-5 w-5" />,
        roles: ["master", "admin", "manager"],
      },
    ],
  },
  {
    label: "인사 관리",
    items: [
      {
        label: "스케줄", href: "/schedule",
        icon: <Clock className="h-4 w-4" />,
        mobileIcon: <Clock className="h-5 w-5" />,
        roles: ["master", "admin", "manager", "staff"],
        mobileTabPriority: { master: 3, admin: 3, manager: 3, staff: 3 },
      },
      {
        label: "직원 관리", href: "/staff",
        icon: <UsersRound className="h-4 w-4" />,
        mobileIcon: <UsersRound className="h-5 w-5" />,
        roles: ["master", "admin", "manager"],
      },
      {
        label: "인건비 정산", href: "/labor-cost",
        icon: <Coins className="h-4 w-4" />,
        mobileIcon: <Coins className="h-5 w-5" />,
        roles: ["master", "admin", "manager"],
      },
    ],
  },
  {
    label: "재무 분석",
    items: [
      {
        label: "매출캘린더",
        href: "/profitability",
        icon: <BarChart3 className="h-4 w-4" />,
        mobileIcon: <BarChart3 className="h-5 w-5" />,
        roles: ["master", "admin", "manager", "staff"],
        mobileTabPriority: { master: 4, admin: 4, manager: 4 },
      },
      {
        label: "고정비 관리", href: "/fixed-costs",
        icon: <Receipt className="h-4 w-4" />,
        mobileIcon: <Receipt className="h-5 w-5" />,
        roles: ["manager"],
      },
      {
        label: "매입 관리", href: "/purchase-management",
        icon: <ShoppingCart className="h-4 w-4" />,
        mobileIcon: <ShoppingCart className="h-5 w-5" />,
        roles: ["master", "admin", "manager", "staff"],
      },
    ],
  },
  {
    label: "시스템",
    items: [
      {
        label: "사용자 관리", href: "/users",
        icon: <ShieldCheck className="h-4 w-4" />,
        mobileIcon: <ShieldCheck className="h-5 w-5" />,
        roles: ["master", "admin"],
        mobileTabPriority: { master: 2, admin: 2 },
      },
      {
        label: "매장 관리", href: "/restaurants",
        icon: <Store className="h-4 w-4" />,
        mobileIcon: <Store className="h-5 w-5" />,
        roles: ["master", "admin", "manager"],
      },
      {
        label: "알림", href: "/notifications",
        icon: <BellRing className="h-4 w-4" />,
        mobileIcon: <BellRing className="h-5 w-5" />,
        roles: ["master", "admin", "manager", "staff"],
      },
    ],
  },
];

const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(g => g.items);

// ─── 역할 색상 ───────────────────────────────────────────────────────────────
const ROLE_COLORS: Record<string, string> = {
  master: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  admin: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  manager: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  staff: "bg-slate-500/20 text-slate-300 border-slate-500/30",
};

// ─── Props ────────────────────────────────────────────────────────────────────
interface AppLayoutProps {
  children: ReactNode;
  effectiveRole: EffectiveRole;
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────
export default function AppLayout({ children, effectiveRole }: AppLayoutProps) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const { restaurants, selectedRestaurant, selectedRestaurantId, setSelectedRestaurantId } = useRestaurant();
  const { theme, toggleTheme } = useTheme();

  if (!user) return null;

  const isAdminLevel = effectiveRole === "master" || effectiveRole === "admin";

  // 역할 기반 필터링 + 중복 제거
  const seen = new Set<string>();
  const visibleGroups: NavGroup[] = NAV_GROUPS.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (!item.roles.includes(effectiveRole)) return false;
      if (seen.has(item.href)) return false;
      seen.add(item.href);
      return true;
    }),
  })).filter(g => g.items.length > 0);

  // flat list for mobile
  const seenMobile = new Set<string>();
  const visibleNav = ALL_NAV_ITEMS.filter(n => {
    if (!n.roles.includes(effectiveRole)) return false;
    if (seenMobile.has(n.href)) return false;
    seenMobile.add(n.href);
    return true;
  });

  // 역할별 라벨 해석 헬퍼
  const getLabel = (item: NavItem) => item.labelByRole?.[effectiveRole] ?? item.label;

  // 모바일 하단 탭: 역할별 priority가 설정된 항목만, 최대 4개
  const mobileTabItems = visibleNav
    .filter(n => (n.mobileTabPriority?.[effectiveRole] ?? 99) <= 4)
    .sort((a, b) => (a.mobileTabPriority?.[effectiveRole] ?? 99) - (b.mobileTabPriority?.[effectiveRole] ?? 99))
    .slice(0, 4);

  const mobileTabHrefs = new Set(mobileTabItems.map(n => n.href));
  const moreItems = visibleNav.filter(n => !mobileTabHrefs.has(n.href));

  const handleLogout = () => {
    logout();
    window.location.href = "/login";
  };

  // ─── 사이드바 내용 ─────────────────────────────────────────────────────────
  const SidebarInner = () => (
    <div className="flex flex-col h-full">
      {/* 로고 + 테마 토글 */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
        <div className="flex items-center justify-center w-9 h-9 bg-primary rounded-xl shrink-0 shadow-lg shadow-primary/40">
          <UtensilsCrossed className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-sidebar-foreground leading-tight truncate">
            331매장관리
          </p>
          <p className="text-[10px] text-sidebar-foreground/45 mt-0.5">Restaurant Manager</p>
        </div>
        {toggleTheme && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-sidebar-foreground/45 hover:text-sidebar-foreground hover:bg-sidebar-accent shrink-0"
            onClick={toggleTheme}
            title={theme === "dark" ? "라이트 모드" : "다크 모드"}
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
        )}
      </div>

      {/* 사용자 정보 */}
      <div className="px-3 py-3 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <Avatar className="h-9 w-9 shrink-0 ring-2 ring-primary/30">
            <AvatarFallback className="bg-primary/25 text-primary text-sm font-bold">
              {(user.name ?? user.username ?? "?").charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-sidebar-foreground truncate leading-tight">
              {user.name ?? user.username}
            </p>
            <Badge className={cn("text-[10px] px-1.5 py-0 h-4 mt-0.5 border font-medium", ROLE_COLORS[effectiveRole] ?? "bg-slate-500/20 text-slate-300")}>
              {ROLE_LABELS[effectiveRole] ?? effectiveRole}
            </Badge>
          </div>
        </div>
      </div>

      {/* 매장 선택 (admin이 아닌 경우에만 — admin은 전역 관리) */}
      {!isAdminLevel && restaurants.length > 1 && (
        <div className="px-3 py-2.5 border-b border-sidebar-border">
          <Select
            value={selectedRestaurantId ? String(selectedRestaurantId) : undefined}
            onValueChange={(v) => setSelectedRestaurantId(Number(v))}
          >
            <SelectTrigger className="h-8 text-xs bg-sidebar-accent border-sidebar-border text-sidebar-foreground gap-1.5">
              <Store className="h-3 w-3 shrink-0 text-sidebar-foreground/50" />
              <SelectValue placeholder="매장 선택" />
            </SelectTrigger>
            <SelectContent>
              {restaurants.map(r => (
                <SelectItem key={r.id} value={String(r.id)} className="text-xs">
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {!isAdminLevel && restaurants.length === 1 && selectedRestaurant && (
        <div className="px-3 py-2 border-b border-sidebar-border">
          <div className="flex items-center gap-1.5 px-1">
            <Store className="h-3 w-3 text-sidebar-foreground/40 shrink-0" />
            <p className="text-xs text-sidebar-foreground/60 truncate">{selectedRestaurant.name}</p>
          </div>
        </div>
      )}
      {/* admin/master용 매장 선택 */}
      {isAdminLevel && restaurants.length > 0 && (
        <div className="px-3 py-2.5 border-b border-sidebar-border">
          <Select
            value={selectedRestaurantId ? String(selectedRestaurantId) : undefined}
            onValueChange={(v) => setSelectedRestaurantId(Number(v))}
          >
            <SelectTrigger className="h-8 text-xs bg-sidebar-accent border-sidebar-border text-sidebar-foreground gap-1.5">
              <Store className="h-3 w-3 shrink-0 text-sidebar-foreground/50" />
              <SelectValue placeholder="매장 선택" />
            </SelectTrigger>
            <SelectContent>
              {restaurants.map(r => (
                <SelectItem key={r.id} value={String(r.id)} className="text-xs">
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* 네비게이션 — 카테고리 그룹 */}
      <nav className="flex-1 px-2 py-3 overflow-y-auto">
        {visibleGroups.map((group, gi) => (
          <div key={group.label} className={cn(gi > 0 && "mt-3")}>
            {group.items.length > 0 && (
              <div className="px-3 pb-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-sidebar-foreground/50 select-none">
                  {group.label}
                </p>
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = location === item.href;
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 cursor-pointer relative group",
                        isActive
                          ? "bg-primary/15 text-primary border border-primary/20"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )}
                      onClick={() => setSidebarOpen(false)}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
                      )}
                      <span className={cn(
                        "shrink-0 transition-colors",
                        isActive ? "text-primary" : "text-sidebar-foreground/45 group-hover:text-sidebar-accent-foreground"
                      )}>
                        {item.icon}
                      </span>
                      <span className="flex-1 truncate">
                        {item.href === "/restaurants" && !isAdminLevel ? "내 매장 관리" : getLabel(item)}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* 하단 — 로그아웃 */}
      <div className="px-3 py-3 border-t border-sidebar-border">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2.5 text-sidebar-foreground/50 hover:text-destructive hover:bg-destructive/10 text-[13px] font-medium transition-colors h-9 rounded-lg"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          로그아웃
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden selection:bg-primary/20">
      {/* 데스크탑 사이드바 (투명한 글래스 사양) */}
      <aside className="hidden lg:flex w-[240px] shrink-0 flex-col bg-sidebar/60 backdrop-blur-3xl border-r border-sidebar-border shadow-2xl z-10 transition-all duration-300">
        <SidebarInner />
      </aside>

      {/* 모바일 사이드바 오버레이 */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-[60] flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] glass-panel bg-sidebar/95 flex flex-col shadow-2xl animate-in slide-in-from-left duration-300">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4 text-sidebar-foreground/50 hover:text-foreground z-10 h-8 w-8 rounded-full bg-background/10 backdrop-blur-md"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
            <SidebarInner />
          </aside>
        </div>
      )}

      {/* 메인 콘텐츠 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* 상단 헤더 (블러 글래스) */}
        <header className="shrink-0 h-16 flex items-center gap-3 px-4 lg:px-6 border-b border-border/50 bg-background/60 backdrop-blur-xl z-20 shadow-[0_1px_10px_rgb(0,0,0,0.02)] sticky top-0 transition-all duration-300">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden h-10 w-10 shrink-0 hover:bg-white/10 rounded-xl"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* 로고 (모바일 전용) */}
          <div className="lg:hidden flex items-center gap-2 shrink-0 animate-in-up">
            <div className="flex items-center justify-center w-8 h-8 bg-gradient-to-br from-primary to-primary/80 rounded-xl shadow-lg shadow-primary/30">
              <UtensilsCrossed className="h-4 w-4 text-primary-foreground" />
            </div>
          </div>

          <div className="flex-1 min-w-0" />

          <div className="flex items-center gap-2">
            {/* 다크모드 토글 */}
            {toggleTheme && (
              <Button
                variant="ghost"
                size="icon"
                className="hidden lg:flex h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-xl transition-all"
                onClick={toggleTheme}
                title={theme === "dark" ? "라이트 모드" : "다크 모드"}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            )}

            {/* 알림 벨 */}
            <NotificationBell />

            {/* 유저 드롭다운 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-10 w-10 rounded-xl hover:bg-accent/50 p-0 border border-border/20 shadow-sm overflow-hidden transition-all hover:shadow-md hover:-translate-y-0.5">
                  <Avatar className="h-full w-full">
                    <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">
                      {(user.name ?? user.username ?? "?").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 glass-panel rounded-xl p-2 animate-in fade-in slide-in-from-top-2 border-border/50">
                <div className="px-3 py-2.5">
                  <p className="text-sm font-bold text-foreground">{user.name ?? user.username}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{ROLE_LABELS[effectiveRole] ?? effectiveRole}</p>
                </div>
                <DropdownMenuSeparator className="bg-border/30" />
                {toggleTheme && (
                  <>
                    <DropdownMenuItem onClick={toggleTheme} className="rounded-lg cursor-pointer my-1 transition-all hover:bg-primary/10 hover:text-primary">
                      {theme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                      {theme === "dark" ? "라이트 모드" : "다크 모드"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-border/30" />
                  </>
                )}
                <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive rounded-lg cursor-pointer my-1 font-medium transition-all hover:bg-destructive/10">
                  <LogOut className="mr-2 h-4 w-4" />
                  로그아웃
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* 페이지 콘텐츠 */}
        <main className="flex-1 overflow-y-auto relative z-0">
          <div className="pb-24 lg:pb-8 pt-4 lg:pt-6 h-full">
            {children}
          </div>
        </main>

        {/* 모바일 하단 플로팅 탭 네비게이션 */}
        <nav className="lg:hidden fixed bottom-4 inset-x-4 z-50 safe-area-bottom pointer-events-none">
          <div className="glass-panel bg-card/85 rounded-2xl p-1.5 shadow-2xl flex items-stretch justify-around h-[68px] pointer-events-auto border border-border/50 backdrop-blur-2xl">
            {mobileTabItems.map((item) => {
              const isActive = location === item.href;
              return (
                <Link key={item.href} href={item.href} className="flex-1">
                  <div
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 h-full px-1 rounded-xl transition-all duration-300",
                      isActive ? "text-primary" : "text-muted-foreground hover:bg-foreground/5"
                    )}
                  >
                    <div className={cn(
                      "relative flex items-center justify-center w-12 h-7 rounded-full transition-all duration-500",
                      isActive ? "bg-primary/20 scale-110" : "scale-100"
                    )}>
                      {item.mobileIcon}
                      {isActive && (
                        <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping opacity-20" />
                      )}
                    </div>
                    <span className={cn(
                      "text-[10px] font-bold tracking-wide transition-all duration-300",
                      isActive ? "text-primary" : "text-muted-foreground/70"
                    )}>
                      {getLabel(item)}
                    </span>
                  </div>
                </Link>
              );
            })}

            {/* 더보기 버튼 */}
            {moreItems.length > 0 && (
              <div className="flex-1 relative">
                <button
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 h-full w-full px-1 rounded-xl transition-all duration-300",
                    moreMenuOpen ? "text-primary" : "text-muted-foreground hover:bg-foreground/5"
                  )}
                  onClick={() => setMoreMenuOpen(v => !v)}
                >
                  <div className={cn(
                    "flex items-center justify-center w-12 h-7 rounded-full transition-all duration-500",
                    moreMenuOpen ? "bg-primary/20 scale-110" : "scale-100"
                  )}>
                    <MoreHorizontal className="h-5 w-5" />
                  </div>
                  <span className="text-[10px] font-bold tracking-wide text-muted-foreground/70">더보기</span>
                </button>

                {/* 더보기 팝업 — 글래스모피즘 */}
                {moreMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMoreMenuOpen(false)} />
                    <div className="absolute bottom-full right-0 mb-4 w-56 glass-panel rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-5 border-border/50">
                      {(() => {
                        const moreHrefs = new Set(moreItems.map(i => i.href));
                        const moreGroups = visibleGroups
                          .map(g => ({ ...g, items: g.items.filter(i => moreHrefs.has(i.href)) }))
                          .filter(g => g.items.length > 0);
                        return moreGroups.map((group, gi) => (
                          <div key={group.label}>
                            {gi > 0 && <div className="h-px bg-border/30 mx-3 my-1" />}
                            <div className="px-4 pt-3 pb-1">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                                {group.label}
                              </p>
                            </div>
                            <div className="p-1 space-y-0.5">
                              {group.items.map((item) => {
                                const active = location === item.href;
                                return (
                                  <Link key={item.href} href={item.href}>
                                    <div
                                      className={cn(
                                        "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                                        active
                                          ? "bg-primary/15 text-primary"
                                          : "text-foreground hover:bg-foreground/5 hover:translate-x-1"
                                      )}
                                      onClick={() => setMoreMenuOpen(false)}
                                    >
                                      <span className={active ? "text-primary" : "text-muted-foreground"}>{item.icon}</span>
                                      {getLabel(item)}
                                    </div>
                                  </Link>
                                );
                              })}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </nav>
      </div>
    </div>
  );
}

// ─── 알림 벨 드롭다운 ─────────────────────────────────────────────────────────

const NOTIF_TYPE_LABELS: Record<string, string> = {
  schedule_change: "스케줄 변경",
  schedule_assigned: "스케줄 배정",
  schedule_updated: "스케줄 수정",
  schedule_deleted: "스케줄 삭제",
  cost_exceeded: "비용 초과",
  target_achieved: "목표 달성",
  general: "일반",
};

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();

  const { data: unread } = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const { data: notifications } = trpc.notifications.listMine.useQuery(
    { limit: 20 },
    { enabled: open },
  );
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.unreadCount.invalidate();
      utils.notifications.listMine.invalidate();
    },
  });
  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.notifications.unreadCount.invalidate();
      utils.notifications.listMine.invalidate();
    },
  });

  const count = unread?.count ?? 0;

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 text-muted-foreground hover:text-foreground relative"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-primary-foreground bg-destructive rounded-full">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-80 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden">
            {/* 헤더 */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <span className="text-sm font-semibold text-foreground">알림</span>
              {count > 0 && (
                <button
                  onClick={() => markAllRead.mutate()}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <Check className="w-3 h-3" /> 모두 읽음
                </button>
              )}
            </div>

            {/* 목록 */}
            <div className="max-h-80 overflow-y-auto">
              {!notifications?.length ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  알림이 없습니다
                </div>
              ) : (
                notifications.map((n: any) => (
                  <div
                    key={n.id}
                    className={cn(
                      "px-4 py-2.5 border-b border-border/50 last:border-0 cursor-pointer hover:bg-accent/50 transition-colors",
                      !n.isRead && "bg-primary/5",
                    )}
                    onClick={() => {
                      if (!n.isRead) markRead.mutate({ id: n.id });
                    }}
                  >
                    <div className="flex items-start gap-2">
                      {!n.isRead && (
                        <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                            {NOTIF_TYPE_LABELS[n.type] ?? n.type}
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                            {new Date(n.createdAt).toLocaleDateString("ko-KR", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="text-sm text-foreground mt-0.5 truncate">{n.title}</p>
                        {n.content && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {n.content}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
