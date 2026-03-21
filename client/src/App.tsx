import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "./_core/hooks/useAuth";
import Login from "./pages/Login";
import AdminDashboard from "./pages/AdminDashboard";
import ManagerDashboard from "./pages/ManagerDashboard";
import EmployeeDashboard from "./pages/EmployeeDashboard";
import UsersManagement from "./pages/UsersManagement";
import RestaurantsManagement from "./pages/RestaurantsManagement";
import SchedulePage from "./pages/SchedulePage";
import PayrollSchedulePage from "./pages/PayrollSchedulePage";
import SalesPage from "./pages/SalesPage";
import PurchasesPage from "./pages/PurchasesPage";
import FixedCostsPage from "./pages/FixedCostsPage";
import ProfitabilityPage from "./pages/ProfitabilityPage";
import StaffPage from "./pages/StaffPage";
import NotificationsPage from "./pages/NotificationsPage";
import ContractSignPage from "./pages/ContractSignPage";
import DailyOpsPage from "./pages/DailyOpsPage";
import DailyClosingPage from "./pages/DailyClosingPage";
import { Loader2 } from "lucide-react";
import { RestaurantProvider, useRestaurant } from "./contexts/RestaurantContext";
import { trpc } from "./lib/trpc";
import { getEffectiveRole } from "@shared/permissions";

function RoleRouter() {
  const { user, loading } = useAuth();
  const { selectedRestaurantId } = useRestaurant();

  // 매장 내 역할 조회 — employee가 store_manager/manager 역할을 가질 수 있음
  const storeRoleQuery = trpc.restaurants.getMyStoreRole.useQuery(
    { restaurantId: selectedRestaurantId! },
    {
      enabled: !!user && !!selectedRestaurantId && (user.role === "manager" || user.role === "employee"),
    }
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) {
    return <Login />;
  }

  const role = user.role;
  const storeRole = storeRoleQuery.data;
  // storeRole 로딩 중에는 라우트 깜빡임 방지 (employee가 manager 메뉴 접근 시)
  const storeRoleLoading =
    (role === "manager" || role === "employee") && !!selectedRestaurantId && storeRoleQuery.isLoading;

  if (storeRoleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // effectiveRole: shared/permissions.ts의 getEffectiveRole 공통 함수 사용
  const effectiveRole = getEffectiveRole(role ?? "employee", storeRole);

  return (
    <Switch>
      {/* 공통 */}
      <Route path="/notifications" component={NotificationsPage} />
      {/* 마스터/관리자 전용 */}
      {(effectiveRole === "master" || effectiveRole === "admin") && (
        <>
          <Route path="/" component={AdminDashboard} />
          <Route path="/users" component={UsersManagement} />
          <Route path="/restaurants" component={RestaurantsManagement} />
          <Route path="/profitability" component={ProfitabilityPage} />
          <Route path="/contracts">{() => { window.location.replace("/restaurants"); return null; }}</Route>
          <Route path="/contract-history">{() => { window.location.replace("/staff"); return null; }}</Route>
        </>
      )}
      {/* 점장/매니저 전용 (users.role=manager 또는 storeRole=store_manager/manager) */}
      {effectiveRole === "manager" && (
        <>
          <Route path="/" component={ManagerDashboard} />
          <Route path="/schedule" component={SchedulePage} />
          <Route path="/payroll-schedule" component={PayrollSchedulePage} />
          <Route path="/daily-ops" component={DailyOpsPage} />
          <Route path="/daily-closing" component={DailyClosingPage} />
          <Route path="/sales" component={SalesPage} />
          <Route path="/purchases" component={PurchasesPage} />
          <Route path="/fixed-costs" component={FixedCostsPage} />
          <Route path="/staff" component={StaffPage} />
          <Route path="/profitability" component={ProfitabilityPage} />
          <Route path="/contracts">{() => { window.location.replace("/restaurants"); return null; }}</Route>
          <Route path="/contract-history">{() => { window.location.replace("/staff"); return null; }}</Route>
          <Route path="/restaurants" component={RestaurantsManagement} />
        </>
      )}
      {/* 직원 전용 */}
      {effectiveRole === "employee" && (
        <>
          <Route path="/" component={EmployeeDashboard} />
          <Route path="/schedule" component={SchedulePage} />
          <Route path="/daily-ops" component={DailyOpsPage} />
          <Route path="/sales" component={SalesPage} />
          <Route path="/purchases" component={PurchasesPage} />
        </>
      )}
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        <TooltipProvider>
          <Toaster />
          <RestaurantProvider>
            <Switch>
              {/* 전자계약서 서명 페이지 — 로그인 불필요, 공개 라우트 */}
              <Route path="/contract/sign/:token" component={ContractSignPage} />
              {/* 기타 모든 라우트는 RoleRouter로 */}
              <Route component={RoleRouter} />
            </Switch>
          </RestaurantProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
