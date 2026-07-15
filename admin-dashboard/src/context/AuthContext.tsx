import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { AdminDTO } from "@chat-support/shared";
import { api } from "../api/client";

interface AuthContextValue {
  admin: AdminDTO | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("admin_token"));
  const [admin, setAdmin] = useState<AdminDTO | null>(() => {
    const raw = localStorage.getItem("admin_user");
    return raw ? JSON.parse(raw) : null;
  });

  const login = async (email: string, password: string) => {
    const res = await api.post("/auth/login", { email, password });
    localStorage.setItem("admin_token", res.data.token);
    localStorage.setItem("admin_user", JSON.stringify(res.data.admin));
    setToken(res.data.token);
    setAdmin(res.data.admin);
  };

  const logout = () => {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
    setToken(null);
    setAdmin(null);
  };

  const value = useMemo(() => ({ admin, token, login, logout }), [admin, token]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
