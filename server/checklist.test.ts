import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// DB 모킹
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getChecklistTemplates: vi.fn().mockResolvedValue([
      { id: 1, restaurantId: 1, checkType: "open", itemText: "전등 켜기", sortOrder: 0, isActive: true },
      { id: 2, restaurantId: 1, checkType: "open", itemText: "냉장고 온도 확인", sortOrder: 1, isActive: true },
    ]),
    getAllChecklistTemplates: vi.fn().mockResolvedValue([
      { id: 1, restaurantId: 1, checkType: "open", itemText: "전등 켜기", sortOrder: 0, isActive: true },
      { id: 2, restaurantId: 1, checkType: "open", itemText: "냉장고 온도 확인", sortOrder: 1, isActive: true },
      { id: 3, restaurantId: 1, checkType: "order", itemText: "발주서 확인", sortOrder: 0, isActive: true },
    ]),
    createChecklistTemplate: vi.fn().mockResolvedValue({ insertId: 10 }),
    updateChecklistTemplate: vi.fn().mockResolvedValue(undefined),
    deleteChecklistTemplate: vi.fn().mockResolvedValue(undefined),
    getDailyChecklistLog: vi.fn().mockResolvedValue(null),
    upsertDailyChecklistLog: vi.fn().mockResolvedValue(1),
    getDailyChecklistSummary: vi.fn().mockResolvedValue({
      open: { total: 2, checked: 2, completed: true },
      order: { total: 1, checked: 0, completed: false },
      cleaning: null,
    }),
  };
});

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createManagerCtx(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "manager-user",
    email: "manager@example.com",
    name: "Manager User",
    loginMethod: "manus",
    role: "manager",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function createEmployeeCtx(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 2,
    openId: "employee-user",
    email: "employee@example.com",
    name: "Employee User",
    loginMethod: "manus",
    role: "employee",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("storeChecklists", () => {
  describe("list", () => {
    it("직원도 체크리스트 템플릿 목록을 조회할 수 있다", async () => {
      const caller = appRouter.createCaller(createEmployeeCtx());
      const result = await caller.storeChecklists.list({ restaurantId: 1, checkType: "open" });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0].checkType).toBe("open");
    });
  });

  describe("listAll", () => {
    it("전체 체크리스트 템플릿을 조회할 수 있다", async () => {
      const caller = appRouter.createCaller(createManagerCtx());
      const result = await caller.storeChecklists.listAll({ restaurantId: 1 });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
    });
  });

  describe("create", () => {
    it("점장은 체크리스트 항목을 생성할 수 있다", async () => {
      const caller = appRouter.createCaller(createManagerCtx());
      const result = await caller.storeChecklists.create({
        restaurantId: 1,
        checkType: "open",
        itemText: "테스트 항목",
        sortOrder: 0,
      });
      expect(result.success).toBe(true);
    });

    it("직원은 체크리스트 항목을 생성할 수 없다 (FORBIDDEN)", async () => {
      const caller = appRouter.createCaller(createEmployeeCtx());
      await expect(
        caller.storeChecklists.create({
          restaurantId: 1,
          checkType: "open",
          itemText: "테스트 항목",
        })
      ).rejects.toThrow();
    });
  });

  describe("saveDailyLog", () => {
    it("직원도 일별 체크 기록을 저장할 수 있다", async () => {
      const caller = appRouter.createCaller(createEmployeeCtx());
      const result = await caller.storeChecklists.saveDailyLog({
        restaurantId: 1,
        logDate: "2026-03-20",
        checkType: "open",
        checkedItemIds: [1, 2],
        noOrderToday: false,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("getDailyLog", () => {
    it("일별 체크 기록을 조회할 수 있다", async () => {
      const caller = appRouter.createCaller(createEmployeeCtx());
      const result = await caller.storeChecklists.getDailyLog({
        restaurantId: 1,
        logDate: "2026-03-20",
        checkType: "open",
      });
      // 기록이 없으면 null 반환
      expect(result === null || typeof result === "object").toBe(true);
    });
  });

  describe("getDailySummary", () => {
    it("대시보드용 체크리스트 완료 요약을 반환한다", async () => {
      const caller = appRouter.createCaller(createEmployeeCtx());
      const result = await caller.storeChecklists.getDailySummary({
        restaurantId: 1,
        logDate: "2026-03-20",
      });
      expect(result).toBeDefined();
      expect(result.open).not.toBeNull();
      expect(result.open?.total).toBe(2);
      expect(result.open?.checked).toBe(2);
      expect(result.open?.completed).toBe(true);
      expect(result.order?.completed).toBe(false);
      expect(result.cleaning).toBeNull();
    });
  });
});
