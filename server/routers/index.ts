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
});

export type AppRouter = typeof appRouter;
