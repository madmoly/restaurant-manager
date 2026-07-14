import { lazy, Suspense, type ComponentType } from "react";
import { Route, Switch, Redirect } from "wouter";
import { useAuth } from "./hooks/useAuth";
import { RestaurantProvider, useRestaurant } from "./contexts/RestaurantContext";
import { trpc } from "./lib/trpc";
import { getEffectiveRole } from "@shared/permissions";
import { Loader2 } from "lucide-react";

import Login from "./pages/Login";
import MasterDashboard from "./pages/MasterDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import ManagerDashboard from "./pages/ManagerDashboard";
import EmployeeDashboard from "./pages/EmployeeDashboard";
import RestaurantsPage from "./pages/RestaurantsPage";
import SalesPage from "./pages/SalesPage";
import UsersPage from "./pages/UsersPage";

import CounterpartiesPage from "./pages/CounterpartiesPage";
import PurchaseManagementPage from "./pages/PurchaseManagementPage";
import FixedCostsPage from "./pages/FixedCostsPage";
import MonthlySettlementPage from "./pages/MonthlySettlementPage";
import SchedulePage from "./pages/SchedulePage";
import DailyOpsPage from "./pages/DailyOpsPage";
import StaffPage from "./pages/StaffPage";
import OpsCalendarPage from "./pages/OpsCalendarPage";
import TaskManagementPage from "./pages/TaskManagementPage";
import LaborCostPage from "./pages/LaborCostPage";
import WorkSummaryPage from "./pages/WorkSummaryPage";
import ContractSignPage from "./pages/ContractSignPage";
import JoinPage from "./pages/JoinPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import SystemPage from "./pages/SystemPage";
import FeedbackListPage from "./pages/FeedbackListPage";
import RecipesPage from "./pages/RecipesPage";
import StoreInfoPage from "./pages/StoreInfoPage";
import StoreAnalysisPage from "./pages/StoreAnalysisPage";
import AppLayout from "./components/AppLayout";

// POS 페이지 — 번들 분리(동적 import). 클라이언트 번들 1.5MB 부채 악화 방지.
const PosMenuPage = lazy(() => import("./pages/pos/PosMenuPage"));
const PosCounterPage = lazy(() => import("./pages/pos/PosCounterPage"));

function LazyPage({ Component }: { Component: ComponentType }) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <Component />
    </Suspense>
  );
}

const PosMenuRoute = () => <LazyPage Component={PosMenuPage} />;
const PosCounterRoute = () => <LazyPage Component={PosCounterPage} />;

function RoleRouter() {
  const { user } = useAuth();
  const { selectedRestaurantId } = useRestaurant();

  // 매장 내 역할 조회 — admin/master가 아닌 경우에만
  const storeRoleQuery = trpc.restaurants.getMyStoreRole.useQuery(
    { restaurantId: selectedRestaurantId! },
    {
      enabled: !!user && !!selectedRestaurantId && user.role !== "master" && user.role !== "admin",
    }
  );

  if (!user) return <Login />;

  const role = user.role;
  const storeRole = storeRoleQuery.data?.storeRole ?? null;

  // storeRole 로딩 중에는 라우트 깜빡임 방지
  const storeRoleLoading =
    role !== "master" && role !== "admin" && !!selectedRestaurantId && storeRoleQuery.isLoading;

  if (storeRoleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const effectiveRole = getEffectiveRole(role, storeRole);

  return (
    <AppLayout effectiveRole={effectiveRole} storeRole={storeRole}>
      <Switch>
        {/* 개발자(master): 시스템 대시보드 + 전체 접근 */}
        {effectiveRole === "master" && (
          <>
            <Route path="/" component={ManagerDashboard} />
            <Route path="/business" component={AdminDashboard} />
            <Route path="/store-analysis" component={StoreAnalysisPage} />
            <Route path="/groups" component={MasterDashboard} />
            <Route path="/users" component={UsersPage} />
            <Route path="/restaurants" component={RestaurantsPage} />
            <Route path="/monthly-settlement" component={MonthlySettlementPage} />
            <Route path="/profitability">{() => <Redirect to="/monthly-settlement" />}</Route>
            <Route path="/sales" component={SalesPage} />

            <Route path="/counterparties" component={CounterpartiesPage} />
            <Route path="/purchase-management" component={PurchaseManagementPage} />
            <Route path="/fixed-costs" component={FixedCostsPage} />
            <Route path="/schedule" component={SchedulePage} />
            <Route path="/daily-ops" component={DailyOpsPage} />
            <Route path="/ops-calendar" component={OpsCalendarPage} />
            <Route path="/work-summary" component={WorkSummaryPage} />
            <Route path="/staff" component={StaffPage} />
            <Route path="/recipes" component={RecipesPage} />
            <Route path="/store-info" component={StoreInfoPage} />
            <Route path="/pos/menu" component={PosMenuRoute} />
            <Route path="/pos/counter" component={PosCounterRoute} />
            <Route path="/system" component={SystemPage} />
            <Route path="/feedback" component={FeedbackListPage} />
          </>
        )}

        {/* 대표(admin): 매장 대시보드(/) + 사업 대시보드(/business) */}
        {effectiveRole === "admin" && (
          <>
            <Route path="/" component={ManagerDashboard} />
            <Route path="/business" component={AdminDashboard} />
            <Route path="/store-analysis" component={StoreAnalysisPage} />
            <Route path="/users" component={UsersPage} />
            <Route path="/restaurants" component={RestaurantsPage} />
            <Route path="/monthly-settlement" component={MonthlySettlementPage} />
            <Route path="/profitability">{() => <Redirect to="/monthly-settlement" />}</Route>
            <Route path="/sales" component={SalesPage} />
            <Route path="/daily-closing" component={SalesPage} />

            <Route path="/counterparties" component={CounterpartiesPage} />
            <Route path="/purchase-management" component={PurchaseManagementPage} />
            <Route path="/fixed-costs" component={FixedCostsPage} />
            <Route path="/schedule" component={SchedulePage} />
            <Route path="/daily-ops" component={DailyOpsPage} />
            <Route path="/ops-calendar" component={OpsCalendarPage} />
            <Route path="/task-management" component={TaskManagementPage} />
            <Route path="/labor-cost" component={LaborCostPage} />
            <Route path="/work-summary" component={WorkSummaryPage} />
            <Route path="/staff" component={StaffPage} />
            <Route path="/recipes" component={RecipesPage} />
            <Route path="/store-info" component={StoreInfoPage} />
            <Route path="/pos/menu" component={PosMenuRoute} />
            <Route path="/pos/counter" component={PosCounterRoute} />
          </>
        )}

        {/* manager (점장/매니져) */}
        {effectiveRole === "manager" && (
          <>
            <Route path="/" component={ManagerDashboard} />
            <Route path="/sales" component={SalesPage} />

            <Route path="/counterparties" component={CounterpartiesPage} />
            <Route path="/purchase-management" component={PurchaseManagementPage} />
            <Route path="/fixed-costs" component={FixedCostsPage} />
            <Route path="/monthly-settlement" component={MonthlySettlementPage} />
            <Route path="/profitability">{() => <Redirect to="/monthly-settlement" />}</Route>
            <Route path="/restaurants" component={RestaurantsPage} />
            <Route path="/schedule" component={SchedulePage} />
            <Route path="/daily-ops" component={DailyOpsPage} />
            <Route path="/ops-calendar" component={OpsCalendarPage} />
            <Route path="/task-management" component={TaskManagementPage} />
            <Route path="/labor-cost" component={LaborCostPage} />
            <Route path="/work-summary" component={WorkSummaryPage} />
            <Route path="/staff" component={StaffPage} />
            <Route path="/recipes" component={RecipesPage} />
            <Route path="/store-info" component={StoreInfoPage} />
            <Route path="/pos/menu" component={PosMenuRoute} />
            <Route path="/pos/counter" component={PosCounterRoute} />
          </>
        )}

        {/* staff */}
        {effectiveRole === "staff" && (
          <>
            <Route path="/" component={EmployeeDashboard} />
            <Route path="/daily-ops" component={DailyOpsPage} />
            <Route path="/schedule" component={SchedulePage} />
            <Route path="/sales" component={SalesPage} />
            <Route path="/monthly-settlement" component={MonthlySettlementPage} />
            <Route path="/profitability">{() => <Redirect to="/monthly-settlement" />}</Route>
            <Route path="/purchase-management" component={PurchaseManagementPage} />
            <Route path="/recipes" component={RecipesPage} />
            <Route path="/store-info" component={StoreInfoPage} />
            <Route path="/pos/counter" component={PosCounterRoute} />
          </>
        )}

        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    </AppLayout>
  );
}

export default function App() {
  const { isLoggedIn, mustChangePassword } = useAuth();

  return (
    <Switch>
      {/* 전자계약 서명 — 비로그인 접근 가능 */}
      <Route path="/sign/:token">
        {(params: { token: string }) => <ContractSignPage token={params.token} />}
      </Route>
      {/* 초대코드 자가등록 — 비로그인 접근 가능 */}
      <Route path="/join/:code">
        {(params: { code: string }) => <JoinPage code={params.code} />}
      </Route>
      {/* 비밀번호 강제 변경 */}
      <Route path="/change-password">
        {isLoggedIn ? <ChangePasswordPage /> : <Redirect to="/login" />}
      </Route>
      <Route path="/login">
        {isLoggedIn ? <Redirect to="/" /> : <Login />}
      </Route>
      <Route>
        {!isLoggedIn ? (
          <Redirect to="/login" />
        ) : mustChangePassword ? (
          <Redirect to="/change-password" />
        ) : (
          <RestaurantProvider>
            <RoleRouter />
          </RestaurantProvider>
        )}
      </Route>
    </Switch>
  );
}
