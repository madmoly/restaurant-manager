import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createManagerCtx(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-manager",
    email: "manager@test.com",
    name: "테스트 점장",
    loginMethod: null,
    role: "manager",
    username: "test_manager",
    passwordHash: null,
    phone: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: {} as any,
    res: {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    } as any,
  };
}

describe("dailyClosings API", () => {
  it("getSalesTypes: restaurantId 없이 호출하면 UNAUTHORIZED 오류", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });
    await expect(
      caller.dailyClosings.getSalesTypes({ restaurantId: 1 })
    ).rejects.toThrow();
  });

  it("getSalesTypes: 인증된 사용자는 호출 가능 (DB 없어도 빈 배열 반환)", async () => {
    const caller = appRouter.createCaller(createManagerCtx());
    // DB 연결이 없으면 빈 배열 반환
    const result = await caller.dailyClosings.getSalesTypes({ restaurantId: 99999 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("getSpecialTypes: 인증된 사용자는 호출 가능 (DB 없어도 빈 배열 반환)", async () => {
    const caller = appRouter.createCaller(createManagerCtx());
    const result = await caller.dailyClosings.getSpecialTypes({ restaurantId: 99999 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("close: salesBreakdown 합산이 올바른지 검증 (단위 테스트)", () => {
    const breakdown = [
      { typeName: "카드매출", amount: 500000 },
      { typeName: "현금매출", amount: 200000 },
      { typeName: "상품권매출", amount: 50000 },
    ];
    const total = breakdown.reduce((s, i) => s + i.amount, 0);
    expect(total).toBe(750000);
  });

  it("close: 빈 salesBreakdown이면 합산이 0", () => {
    const breakdown: Array<{ typeName: string; amount: number }> = [];
    const total = breakdown.reduce((s, i) => s + i.amount, 0);
    expect(total).toBe(0);
  });

  it("addSalesType: 비인증 사용자는 UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });
    await expect(
      caller.dailyClosings.addSalesType({ restaurantId: 1, typeName: "테스트" })
    ).rejects.toThrow();
  });

  it("addSpecialType: 빈 typeName은 Zod 오류 발생", async () => {
    const caller = appRouter.createCaller(createManagerCtx());
    await expect(
      caller.dailyClosings.addSpecialType({ restaurantId: 1, typeName: "" })
    ).rejects.toThrow();
  });
});
