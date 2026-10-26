import { useEffect, useState, type ReactNode } from "react";
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

type Theme = "light" | "dark";

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable (private browsing, etc.) -- default to light.
  }
  return "light";
}

export function Layout({ children }: { children: ReactNode }) {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // Best-effort only -- the toggle still works for the rest of the session.
    }
  }, [theme]);

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
          <NavLink to="/analytics" className={navItem}>
            Analytics
          </NavLink>
          <NavLink to="/canned-replies" className={navItem}>
            Canned replies
          </NavLink>
          {admin?.role === "SUPER_ADMIN" && (
            <NavLink to="/embedded-apps" className={navItem}>
              Embedded apps
            </NavLink>
          )}
          {admin?.role === "SUPER_ADMIN" && (
            <NavLink to="/admins" className={navItem}>
              Admins
            </NavLink>
          )}
          <NavLink to="/settings" className={navItem}>
            Settings
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <button
            className="btn-ghost theme-toggle"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
            title="Toggle dark mode"
          >
            {theme === "light" ? "🌙 Dark mode" : "☀️ Light mode"}
          </button>
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
