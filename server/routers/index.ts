import { router } from "../trpc";
import { authRouter } from "./auth";
import { usersRouter } from "./users";
import { restaurantsRouter } from "./restaurants";
import { salesRouter } from "./sales";
import { counterpartiesRouter } from "./counterparties";
import { purchasesRouter } from "./purchases";
import { fixedCostsRouter } from "./fixedCosts";
import { dailyClosingsRouter } from "./dailyClosings";
// Phase 2
import { schedulesRouter } from "./schedules";
import { scheduleChangeRequestsRouter } from "./scheduleChangeRequests";
import { dailyOpsRouter } from "./dailyOps";
import { storeClosuresRouter } from "./storeClosures";
import { storeChecklistsRouter } from "./storeChecklists";
// Phase 1-B
import { itemsRouter } from "./items";
import { counterpartyItemsRouter } from "./counterpartyItems";
import { purchasesV2Router } from "./purchasesV2";
import { pricingRouter } from "./pricing";
// Phase 3
import { monthlyClosingsRouter } from "./monthlyClosings";
import { notificationsRouter } from "./notifications";
import { electronicContractsRouter } from "./electronicContracts";
import { leaveRequestsRouter } from "./leaveRequests";
import { errorLogsRouter } from "./errorLogs";
import { adminRouter } from "./admin";
import { systemRouter } from "./system";
import { invitesRouter } from "./invites";
import { leaveBalanceRouter } from "./leaveBalance";
import { recipesRouter } from "./recipes";
import { recipeIngredientsRouter } from "./recipeIngredients";
import { storeInfoRouter } from "./storeInfo";
import { businessGroupsRouter } from "./businessGroups";
import { dailyExpensesRouter } from "./dailyExpenses";
import { staffRouter } from "./staff";
// POS Phase 1
import { posRouter } from "./pos";
// 정산표 OCR 대조 (2026-05-01)
import { settlementStatementsRouter } from "./settlementStatements";
// 계약·인건비 재설계 (2026-05-02)
import { affiliatedCompaniesRouter } from "./affiliatedCompanies";
// 피드백/버그 제보
import { feedbackRouter } from "./feedback";
// 매장 분석 (2026-07-02)
import { analysisRouter } from "./analysis";

export const appRouter = router({
  auth: authRouter,
  users: usersRouter,
  restaurants: restaurantsRouter,
  sales: salesRouter,
  counterparties: counterpartiesRouter,
  purchases: purchasesRouter,
  fixedCosts: fixedCostsRouter,
  dailyClosings: dailyClosingsRouter,
  // Phase 2
  schedules: schedulesRouter,
  scheduleChangeRequests: scheduleChangeRequestsRouter,
  dailyOps: dailyOpsRouter,
  storeClosures: storeClosuresRouter,
  storeChecklists: storeChecklistsRouter,
  // Phase 1-B
  items: itemsRouter,
  counterpartyItems: counterpartyItemsRouter,
  purchasesV2: purchasesV2Router,
  pricing: pricingRouter,
  // Phase 3
  monthlyClosings: monthlyClosingsRouter,
  notifications: notificationsRouter,
  electronicContracts: electronicContractsRouter,
  leaveRequests: leaveRequestsRouter,
  errorLogs: errorLogsRouter,
  admin: adminRouter,
  system: systemRouter,
  invites: invitesRouter,
  leaveBalance: leaveBalanceRouter,
  recipes: recipesRouter,
  recipeIngredients: recipeIngredientsRouter,
  storeInfo: storeInfoRouter,
  businessGroups: businessGroupsRouter,
  dailyExpenses: dailyExpensesRouter,
  staff: staffRouter,
  // POS Phase 1
  pos: posRouter,
  // 정산표 OCR 대조
  settlementStatements: settlementStatementsRouter,
  // 계약·인건비 재설계
  affiliatedCompanies: affiliatedCompaniesRouter,
  // 피드백/버그 제보
  feedback: feedbackRouter,
  // 매장 분석
  analysis: analysisRouter,
});

export type AppRouter = typeof appRouter;
