import { Route, Switch, Redirect } from "wouter";
import { useAuth } from "./hooks/useAuth";
import { RestaurantProvider, useRestaurant } from "./contexts/RestaurantContext";
import { trpc } from "./lib/trpc";
import { getEffectiveRole } from "@shared/permissions";
import { Loader2 } from "lucide-react";

import Login from "./pages/Login";
import AdminDashboard from "./pages/AdminDashboard";
import ManagerDashboard from "./pages/ManagerDashboard";
import EmployeeDashboard from "./pages/EmployeeDashboard";
import RestaurantsPage from "./pages/RestaurantsPage";
import SalesPage from "./pages/SalesPage";
import UsersPage from "./pages/UsersPage";

import CounterpartiesPage from "./pages/CounterpartiesPage";
import PurchaseManagementPage from "./pages/PurchaseManagementPage";
import FixedCostsPage from "./pages/FixedCostsPage";
import ProfitPage from "./pages/ProfitPage";
import SchedulePage from "./pages/SchedulePage";
import DailyOpsPage from "./pages/DailyOpsPage";
import StaffPage from "./pages/StaffPage";
import OpsCalendarPage from "./pages/OpsCalendarPage";
import TaskManagementPage from "./pages/TaskManagementPage";
import LaborCostPage from "./pages/LaborCostPage";
import ContractSignPage from "./pages/ContractSignPage";
import AppLayout from "./components/AppLayout";

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
    <AppLayout effectiveRole={effectiveRole}>
      <Switch>
        {/* master/admin */}
        {(effectiveRole === "master" || effectiveRole === "admin") && (
          <>
            <Route path="/" component={AdminDashboard} />
            <Route path="/users" component={UsersPage} />
            <Route path="/restaurants" component={RestaurantsPage} />
            <Route path="/profitability" component={ProfitPage} />
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
            <Route path="/staff" component={StaffPage} />
          </>
        )}

        {/* manager (점장/매니저) */}
        {effectiveRole === "manager" && (
          <>
            <Route path="/" component={ManagerDashboard} />
            <Route path="/sales" component={SalesPage} />

            <Route path="/counterparties" component={CounterpartiesPage} />
            <Route path="/purchase-management" component={PurchaseManagementPage} />
            <Route path="/fixed-costs" component={FixedCostsPage} />
            <Route path="/profitability" component={ProfitPage} />
            <Route path="/restaurants" component={RestaurantsPage} />
            <Route path="/schedule" component={SchedulePage} />
            <Route path="/daily-ops" component={DailyOpsPage} />
            <Route path="/ops-calendar" component={OpsCalendarPage} />
            <Route path="/task-management" component={TaskManagementPage} />
            <Route path="/labor-cost" component={LaborCostPage} />
            <Route path="/staff" component={StaffPage} />
          </>
        )}

        {/* staff */}
        {effectiveRole === "staff" && (
          <>
            <Route path="/" component={EmployeeDashboard} />
            <Route path="/daily-ops" component={DailyOpsPage} />
            <Route path="/schedule" component={SchedulePage} />
            <Route path="/sales" component={SalesPage} />
            <Route path="/profitability" component={ProfitPage} />
            <Route path="/purchase-management" component={PurchaseManagementPage} />
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
  const { isLoggedIn } = useAuth();

  return (
    <Switch>
      {/* 전자계약 서명 — 비로그인 접근 가능 */}
      <Route path="/sign/:token">
        {(params: { token: string }) => <ContractSignPage token={params.token} />}
      </Route>
      <Route path="/login">
        {isLoggedIn ? <Redirect to="/" /> : <Login />}
      </Route>
      <Route>
        {isLoggedIn ? (
          <RestaurantProvider>
            <RoleRouter />
          </RestaurantProvider>
        ) : (
          <Redirect to="/login" />
        )}
      </Route>
    </Switch>
  );
}
