import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function Layout({ children }: { children: ReactNode }) {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="layout">
      <header className="topbar">
        <div className="topbar-left">
          <Link to="/" className="brand">
            Support Admin
          </Link>
          <Link to="/">Inbox</Link>
          <Link to="/apps">Stores</Link>
          {admin?.role === "SUPER_ADMIN" && <Link to="/admins">Admins</Link>}
        </div>
        <div className="topbar-right">
          <span className="muted">
            {admin?.name} ({admin?.role === "SUPER_ADMIN" ? "Super admin" : "Admin"})
          </span>
          <button
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            Log out
          </button>
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
