import { useEffect, useState, type FormEvent } from "react";
import type { AdminDTO } from "@chat-support/shared";
import { api } from "../api/client";

export function AdminsPage() {
  const [admins, setAdmins] = useState<AdminDTO[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "SUPER_ADMIN">("ADMIN");
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get("/admins").then((res) => setAdmins(res.data.admins));

  useEffect(() => {
    load();
  }, []);

  const createAdmin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/admins", { name, email, password, role });
      setName("");
      setEmail("");
      setPassword("");
      setRole("ADMIN");
      load();
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Failed to create admin");
    }
  };

  const setActive = async (id: number, active: boolean) => {
    await api.patch(`/admins/${id}/active`, { active });
    load();
  };

  const setRoleFor = async (id: number, newRole: "ADMIN" | "SUPER_ADMIN") => {
    await api.patch(`/admins/${id}/role`, { role: newRole });
    load();
  };

  return (
    <div className="admins-page">
      <h2>Admins</h2>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {admins.map((a) => (
            <tr key={a.id}>
              <td>{a.name}</td>
              <td>{a.email}</td>
              <td>
                <select value={a.role} onChange={(e) => setRoleFor(a.id, e.target.value as any)}>
                  <option value="ADMIN">Admin</option>
                  <option value="SUPER_ADMIN">Super admin</option>
                </select>
              </td>
              <td>{a.active ? "Active" : "Deactivated"}</td>
              <td>
                <button onClick={() => setActive(a.id, !a.active)}>{a.active ? "Deactivate" : "Reactivate"}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Add admin</h3>
      <form className="admin-create-form" onSubmit={createAdmin}>
        {error && <div className="error-banner">{error}</div>}
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input
          placeholder="Password (min 8 chars)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <select value={role} onChange={(e) => setRole(e.target.value as any)}>
          <option value="ADMIN">Admin</option>
          <option value="SUPER_ADMIN">Super admin</option>
        </select>
        <button type="submit">Create admin</button>
      </form>
    </div>
  );
}
