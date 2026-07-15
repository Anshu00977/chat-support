import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const navItem = ({ isActive }: { isActive: boolean }) => `sidebar-link${isActive ? " active" : ""}`;

export function Layout({ children }: { children: ReactNode }) {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark">💬</span>
          <span>Support Admin</span>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/" end className={navItem}>
            Inbox
          </NavLink>
          <NavLink to="/apps" className={navItem}>
            Apps
          </NavLink>
          {admin?.role === "SUPER_ADMIN" && (
            <NavLink to="/admins" className={navItem}>
              Admins
            </NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="avatar">{admin ? initials(admin.name) : "?"}</div>
            <div className="user-chip-text">
              <div className="user-chip-name">{admin?.name}</div>
              <div className="user-chip-role">{admin?.role === "SUPER_ADMIN" ? "Super admin" : "Admin"}</div>
            </div>
          </div>
          <button
            className="btn-ghost logout-btn"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            Log out
          </button>
        </div>
      </aside>

      <main className="main-panel">{children}</main>
    </div>
  );
}
