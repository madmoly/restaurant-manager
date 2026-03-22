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
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  isLoggedIn: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getStored(): { token: string | null; user: AuthUser | null } {
  try {
    const token = localStorage.getItem("token");
    const user = localStorage.getItem("user");
    return { token, user: user ? JSON.parse(user) : null };
  } catch {
    return { token: null, user: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = getStored();
  const [token, setToken] = useState<string | null>(stored.token);
  const [user, setUser] = useState<AuthUser | null>(stored.user);

  const login = useCallback((newToken: string, newUser: AuthUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem("token", newToken);
    localStorage.setItem("user", JSON.stringify(newUser));
    // Set cookie for server-side auth
    document.cookie = `session=${newToken}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    document.cookie = "session=; path=/; max-age=0";
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoggedIn: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
