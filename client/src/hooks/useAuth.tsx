// Auth context with cookie management

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: string;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  mustChangePassword: boolean;
  login: (token: string, user: AuthUser, mustChangePassword?: boolean) => void;
  logout: () => void;
  clearMustChangePassword: () => void;
  isLoggedIn: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getStored(): { token: string | null; user: AuthUser | null; mustChangePassword: boolean } {
  try {
    const token = localStorage.getItem("token");
    const user = localStorage.getItem("user");
    const mcp = localStorage.getItem("mustChangePassword");
    return { token, user: user ? JSON.parse(user) : null, mustChangePassword: mcp === "true" };
  } catch {
    return { token: null, user: null, mustChangePassword: false };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = getStored();
  const [token, setToken] = useState<string | null>(stored.token);
  const [user, setUser] = useState<AuthUser | null>(stored.user);
  const [mustChangePassword, setMustChangePassword] = useState(stored.mustChangePassword);

  const login = useCallback((newToken: string, newUser: AuthUser, mcp?: boolean) => {
    setToken(newToken);
    setUser(newUser);
    setMustChangePassword(!!mcp);
    localStorage.setItem("token", newToken);
    localStorage.setItem("user", JSON.stringify(newUser));
    localStorage.setItem("mustChangePassword", mcp ? "true" : "false");
    // Set cookie for server-side auth
    document.cookie = `session=${newToken}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setMustChangePassword(false);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("mustChangePassword");
    document.cookie = "session=; path=/; max-age=0";
  }, []);

  const clearMustChangePassword = useCallback(() => {
    setMustChangePassword(false);
    localStorage.setItem("mustChangePassword", "false");
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, mustChangePassword, login, logout, clearMustChangePassword, isLoggedIn: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
