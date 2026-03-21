import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  UtensilsCrossed, LayoutDashboard, Users, Store, Calendar, TrendingUp,
  ShoppingCart, DollarSign, Bell, LogOut, ChevronRight, Menu, X,
  BarChart3, FileText, Sun, Moon, MoreHorizontal, ClipboardList, LockKeyhole,
  Banknote, Settings, Receipt, UserCog, Building2, CalendarCheck, Wrench,
  ChevronDown
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useTheme } from "@/contexts/ThemeContext";
import { getEffectiveRole } from "@shared/permissions";

// ─── 타입 ─────────────────────────────────────────────────────────────────────
interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  mobileIcon: React.ReactNode;
  roles: string[];
  mobileTabPriority?: number;
  badge?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// ─── 카테고리 그룹 정의 ──────────────────────────────────────────────────────
// 역할별로 필터링되므로 모든 역할 항목을 포함하여 정의
const NAV_GROUPS: NavGroup[] = [
  {
    label: "일일 운영",
    items: [
      {
        label: "대시보드", href: "/",
        icon: <LayoutDashboard className="h-4 w-4" />,
        mobileIcon: <LayoutDashboard className="h-5 w-5" />,
        roles: ["master", "admin", "manager", "employee"],
        mobileTabPriority: 1,
      },
      {
        label: "일일 운영", href: "/daily-ops",
        icon: <Wrench className="h-4 w-4" />,
        mobileIcon: <Wrench className="h-5 w-5" />,
        roles: ["manager", "employee"],
        mobileTabPriority: 2,
      },
    ],
  },
  {
    label: "인사 관리",
    items: [
      {
        label: "스케줄", href: "/schedule",
        icon: <Calendar className="h-4 w-4" />,
        mobileIcon: <Calendar className="h-5 w-5" />,
        roles: ["manager", "employee"],
        mobileTabPriority: 4,
      },
      {
        label: "인건비 정산", href: "/payroll-schedule",
        icon: <CalendarCheck className="h-4 w-4" />,
        mobileIcon: <CalendarCheck className="h-5 w-5" />,
        roles: ["manager"],
        mobileTabPriority: 10,
      },
      {
        label: "직원 관리", href: "/staff",
        icon: <UserCog className="h-4 w-4" />,
        mobileIcon: <UserCog className="h-5 w-5" />,
        roles: ["manager"],
        mobileTabPriority: 10,
      },
    ],
  },
      {
        label: "재무 분석",
        items: [
          {
            label: "분석캘린더", href: "/profitability",
            icon: <BarChart3 className="h-4 w-4" />,
            mobileIcon: <BarChart3 className="h-5 w-5" />,
            roles: ["master", "admin", "manager"],
            mobileTabPriority: 5,
          },
          {
            label: "고정비 관리", href: "/fixed-costs",
            icon: <Banknote className="h-4 w-4" />,
            mobileIcon: <Banknote className="h-5 w-5" />,
            roles: ["manager"],
            mobileTabPriority: 10,
          },
        ],
      },
  {
    label: "시스템",
    items: [
      {
        label: "알림", href: "/notifications",
        icon: <Bell className="h-4 w-4" />,
        mobileIcon: <Bell className="h-5 w-5" />,
        roles: ["master", "admin", "manager", "employee"],
        mobileTabPriority: 10,
      },
      {
        label: "사용자 관리", href: "/users",
        icon: <Users className="h-4 w-4" />,
        mobileIcon: <Users className="h-5 w-5" />,
        roles: ["master", "admin"],
        mobileTabPriority: 2,
      },
      {
        label: "매장 관리", href: "/restaurants",
        icon: <Store className="h-4 w-4" />,
        mobileIcon: <Store className="h-5 w-5" />,
        roles: ["master", "admin", "manager"],
        mobileTabPriority: 10,
      },
    ],
  },
];

// 모바일 탭용 flat list (우선순위 기반)
const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(g => g.items);

// ─── 역할 표시 ────────────────────────────────────────────────────────────────
const ROLE_LABELS: Record<string, string> = {
  master: "마스터",
  admin: "관리자",
  manager: "점장",
  employee: "직원",
};

const ROLE_COLORS: Record<string, string> = {
  master: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  admin: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  manager: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  employee: "bg-slate-500/20 text-slate-300 border-slate-500/30",
};

// ─── Props ────────────────────────────────────────────────────────────────────
interface AppLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────
export default function AppLayout({ children, title, subtitle }: AppLayoutProps) {
  const { user } = useAuth();
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const { restaurants, selectedRestaurant, selectedRestaurantId, setSelectedRestaurantId } = useRestaurant();
  const { theme, toggleTheme } = useTheme();

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => { window.location.reload(); },
    onError: () => toast.error("로그아웃 실패"),
  });
  const notifQuery = trpc.notifications.list.useQuery(undefined, { refetchInterval: 30000 });
  const unreadCount = notifQuery.data?.filter(n => !n.isRead).length ?? 0;

  const storeRoleQuery = trpc.restaurants.getMyStoreRole.useQuery(
    { restaurantId: selectedRestaurantId! },
    { enabled: !!user && !!selectedRestaurantId && (user.role === "manager" || user.role === "employee") }
  );
  const storeRole = storeRoleQuery.data;

  if (!user) return null;
  const role = user.role;
  const isManagerOrEmployee = role === "manager" || role === "employee";
  const effectiveRole = getEffectiveRole(role ?? "employee", storeRole);

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

  // 모바일 하단 탭: priority ≤ 5, 최대 4개
  const mobileTabItems = visibleNav
    .filter(n => (n.mobileTabPriority ?? 99) <= 5)
    .sort((a, b) => (a.mobileTabPriority ?? 99) - (b.mobileTabPriority ?? 99))
    .slice(0, 4);

  const mobileTabHrefs = new Set(mobileTabItems.map(n => n.href));
  const moreItems = visibleNav.filter(n => !mobileTabHrefs.has(n.href));

  // ─── 사이드바 내용 ─────────────────────────────────────────────────────────
  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* 로고 */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
        <div className="flex items-center justify-center w-9 h-9 bg-primary rounded-xl shrink-0 shadow-lg shadow-primary/40">
          <UtensilsCrossed className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-sidebar-foreground leading-tight truncate">
            {import.meta.env.VITE_APP_TITLE || "331매장관리"}
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

      {/* 매장 선택 */}
      {isManagerOrEmployee && restaurants.length > 1 && (
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
      {isManagerOrEmployee && restaurants.length === 1 && selectedRestaurant && (
        <div className="px-3 py-2 border-b border-sidebar-border">
          <div className="flex items-center gap-1.5 px-1">
            <Store className="h-3 w-3 text-sidebar-foreground/40 shrink-0" />
            <p className="text-xs text-sidebar-foreground/60 truncate">{selectedRestaurant.name}</p>
          </div>
        </div>
      )}

      {/* 네비게이션 — 카테고리 그룹 */}
      <nav className="flex-1 px-2 py-3 overflow-y-auto scroll-smooth-mobile">
        {visibleGroups.map((group, gi) => (
          <div key={group.label} className={cn(gi > 0 && "mt-3")}>
            {/* 섹션 헤더 */}
            {group.items.length > 0 && group.label !== "홈" && (
              <div className="px-3 pb-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-sidebar-foreground/50 select-none">
                  {group.label}
                </p>
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = location === item.href;
                const isNotif = item.href === "/notifications";
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
                      {/* 활성 메뉴 좌측 액센트 바 */}
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
                        {item.href === "/restaurants" && isManagerOrEmployee
                          ? "내 매장 관리"
                          : item.label}
                      </span>
                      {isNotif && unreadCount > 0 && (
                        <Badge className="bg-red-500 text-white text-[10px] px-1.5 py-0 h-4.5 min-w-5 flex items-center justify-center shrink-0">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </Badge>
                      )}
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
          onClick={() => logoutMutation.mutate()}
        >
          <LogOut className="h-4 w-4" />
          로그아웃
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* 데스크탑 사이드바 */}
      <aside className="hidden lg:flex w-56 shrink-0 flex-col bg-sidebar border-r border-sidebar-border">
        <SidebarContent />
      </aside>

      {/* 모바일 사이드바 오버레이 */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-64 max-w-[85vw] bg-sidebar flex flex-col shadow-2xl animate-in slide-in-from-left duration-200">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3 text-sidebar-foreground/50 hover:text-sidebar-foreground z-10 h-8 w-8"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* 메인 콘텐츠 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 상단 헤더 */}
        <header className="shrink-0 h-14 flex items-center gap-3 px-3 lg:px-5 border-b border-border bg-background/80 backdrop-blur-sm">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden h-9 w-9 shrink-0"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* 로고 (모바일 전용) */}
          <div className="lg:hidden flex items-center gap-2 shrink-0">
            <div className="flex items-center justify-center w-7 h-7 bg-primary rounded-lg">
              <UtensilsCrossed className="h-4 w-4 text-primary-foreground" />
            </div>
          </div>

          <div className="flex-1 min-w-0">
            {title && <h1 className="text-sm font-semibold text-foreground truncate lg:text-[15px]">{title}</h1>}
            {subtitle && <p className="text-xs text-muted-foreground truncate hidden sm:block">{subtitle}</p>}
          </div>

          <div className="flex items-center gap-1">
            {/* 다크모드 토글 (헤더, 데스크탑) */}
            {toggleTheme && (
              <Button
                variant="ghost"
                size="icon"
                className="hidden lg:flex h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={toggleTheme}
                title={theme === "dark" ? "라이트 모드" : "다크 모드"}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            )}

            {/* 알림 버튼 */}
            <Link href="/notifications">
              <Button variant="ghost" size="icon" className="relative h-9 w-9">
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-card" />
                )}
              </Button>
            </Link>

            {/* 유저 드롭다운 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9">
                  <Avatar className="h-7 w-7 ring-2 ring-primary/20">
                    <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">
                      {(user.name ?? user.username ?? "?").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <div className="px-2 py-2">
                  <p className="text-sm font-semibold">{user.name ?? user.username}</p>
                  <p className="text-xs text-muted-foreground">{ROLE_LABELS[effectiveRole] ?? effectiveRole}</p>
                </div>
                <DropdownMenuSeparator />
                {toggleTheme && (
                  <>
                    <DropdownMenuItem onClick={toggleTheme}>
                      {theme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                      {theme === "dark" ? "라이트 모드" : "다크 모드"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={() => logoutMutation.mutate()} className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  로그아웃
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* 페이지 콘텐츠 */}
        <main className="flex-1 overflow-y-auto scroll-smooth-mobile">
          <div className="pb-20 lg:pb-0">
            {children}
          </div>
        </main>

        {/* 모바일 하단 탭 네비게이션 */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border safe-area-bottom">
          <div className="flex items-stretch justify-around h-16">
            {mobileTabItems.map((item) => {
              const isActive = location === item.href;
              const isNotif = item.href === "/notifications";
              return (
                <Link key={item.href} href={item.href} className="flex-1">
                  <div
                    className={cn(
                      "flex flex-col items-center justify-center gap-0.5 h-full px-1 transition-all duration-150 touch-highlight",
                      isActive ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    <div className={cn(
                      "relative flex items-center justify-center w-10 h-6 rounded-full transition-all duration-150",
                      isActive && "bg-primary/15"
                    )}>
                      {item.mobileIcon}
                      {isNotif && unreadCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-white text-[9px] flex items-center justify-center font-bold ring-2 ring-card">
                          {unreadCount > 9 ? "9+" : unreadCount}
                        </span>
                      )}
                    </div>
                    <span className={cn(
                      "text-[10px] font-medium leading-tight",
                      isActive ? "text-primary" : "text-muted-foreground/70"
                    )}>
                      {item.label}
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
                    "flex flex-col items-center justify-center gap-0.5 h-full w-full px-1 transition-all duration-150",
                    moreMenuOpen ? "text-primary" : "text-muted-foreground"
                  )}
                  onClick={() => setMoreMenuOpen(v => !v)}
                >
                  <div className={cn(
                    "flex items-center justify-center w-10 h-6 rounded-full transition-all duration-150",
                    moreMenuOpen && "bg-primary/15"
                  )}>
                    <MoreHorizontal className="h-5 w-5" />
                  </div>
                  <span className="text-[10px] font-medium leading-tight text-muted-foreground/70">더보기</span>
                </button>

                {/* 더보기 팝업 — 카테고리 그룹핑 */}
                {moreMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMoreMenuOpen(false)} />
                    <div className="absolute bottom-full right-0 mb-2 w-52 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden">
                      {/* 더보기 항목을 그룹별로 표시 */}
                      {(() => {
                        const moreHrefs = new Set(moreItems.map(i => i.href));
                        const moreGroups = visibleGroups
                          .map(g => ({ ...g, items: g.items.filter(i => moreHrefs.has(i.href)) }))
                          .filter(g => g.items.length > 0);
                        return moreGroups.map((group, gi) => (
                          <div key={group.label}>
                            {gi > 0 && <div className="h-px bg-border mx-2" />}
                            {group.label !== "홈" && (
                              <div className="px-3 pt-2 pb-0.5">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                                  {group.label}
                                </p>
                              </div>
                            )}
                            {group.items.map((item) => {
                              const isActive = location === item.href;
                              return (
                                <Link key={item.href} href={item.href}>
                                  <div
                                    className={cn(
                                      "flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors",
                                      isActive
                                        ? "bg-primary/10 text-primary"
                                        : "text-foreground hover:bg-accent"
                                    )}
                                    onClick={() => setMoreMenuOpen(false)}
                                  >
                                    {item.icon}
                                    {item.label}
                                  </div>
                                </Link>
                              );
                            })}
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
