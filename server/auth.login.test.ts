import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock bcryptjs
vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}));

// Mock jose - SignJWT must be a constructor (class-like)
vi.mock("jose", () => {
  const mockChain = {
    setProtectedHeader: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: vi.fn().mockResolvedValue("mock-jwt-token"),
  };
  function SignJWT() {
    return mockChain;
  }
  return {
    SignJWT,
    jwtVerify: vi.fn().mockResolvedValue({ payload: {} }),
  };
});

// Mock db module
vi.mock("./db", async (importOriginal) => {
  const original = await importOriginal<typeof import("./db")>();
  return {
    ...original,
    getUserByUsername: vi.fn(),
    updateUser: vi.fn(),
    upsertUser: vi.fn(),
    getUserByOpenId: vi.fn(),
  };
});

import bcrypt from "bcryptjs";
import { getUserByUsername, updateUser } from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createContext(): TrpcContext {
  const cookies: Record<string, unknown> = {};
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      cookie: vi.fn((name, val, opts) => { cookies[name] = val; }),
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("auth.loginWithPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("올바른 자격증명으로 로그인 성공", async () => {
    const mockUser = {
      id: 1,
      openId: "test-open-id",
      username: "testuser",
      passwordHash: "$2b$10$hashedpassword",
      name: "테스트 사용자",
      role: "employee" as const,
      email: null,
      loginMethod: null,
      phone: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };

    vi.mocked(getUserByUsername).mockResolvedValue(mockUser);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    vi.mocked(updateUser).mockResolvedValue(undefined as never);

    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.loginWithPassword({ username: "testuser", password: "correct-password" });

    expect(result.success).toBe(true);
    expect(result.user.username).toBe("testuser");
    expect(ctx.res.cookie).toHaveBeenCalled();
  });

  it("잘못된 비밀번호로 로그인 실패", async () => {
    const mockUser = {
      id: 1,
      openId: "test-open-id",
      username: "testuser",
      passwordHash: "$2b$10$hashedpassword",
      name: "테스트 사용자",
      role: "employee" as const,
      email: null,
      loginMethod: null,
      phone: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };

    vi.mocked(getUserByUsername).mockResolvedValue(mockUser);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.auth.loginWithPassword({ username: "testuser", password: "wrong-password" }))
      .rejects.toThrow("아이디 또는 비밀번호가 올바르지 않습니다.");
  });

  it("존재하지 않는 사용자로 로그인 실패", async () => {
    vi.mocked(getUserByUsername).mockResolvedValue(undefined);

    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.auth.loginWithPassword({ username: "nonexistent", password: "any-password" }))
      .rejects.toThrow("아이디 또는 비밀번호가 올바르지 않습니다.");
  });
});
