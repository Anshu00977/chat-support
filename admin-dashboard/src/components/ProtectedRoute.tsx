import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function ProtectedRoute({ children, requireSuperAdmin }: { children: ReactNode; requireSuperAdmin?: boolean }) {
  const { admin, token } = useAuth();

  if (!token || !admin) return <Navigate to="/login" replace />;
  if (requireSuperAdmin && admin.role !== "SUPER_ADMIN") return <Navigate to="/" replace />;

  return <>{children}</>;
}
