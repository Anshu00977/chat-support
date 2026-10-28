import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";

interface EmbeddedAppRow {
  id: number;
  name: string;
  appUrl: string;
  adminDisplayName: string;
}

interface EditState {
  id: number;
  appUrl: string;
  databaseUrl: string;
  adminDisplayName: string;
}

export function EmbeddedAppsPage() {
  const [apps, setApps] = useState<EmbeddedAppRow[]>([]);
  const [name, setName] = useState("");
  const [databaseUrl, setDatabaseUrl] = useState("");
  const [appUrl, setAppUrl] = useState("");
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<{ name: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const load = () => api.get("/embedded-apps").then((res) => setApps(res.data.apps));

  useEffect(() => {
    load();
  }, []);

  const createApp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.post("/embedded-apps", { name, databaseUrl, appUrl, adminDisplayName });
      setNewSecret({ name: res.data.app.name, secret: res.data.internalSecret });
      setCopied(false);
      setName("");
      setDatabaseUrl("");
      setAppUrl("");
      setAdminDisplayName("");
      load();
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Failed to connect app");
    }
  };

  const confirmRemove = async () => {
    if (!removingId) return;
    await api.delete(`/embedded-apps/${removingId}`);
    setApps((prev) => prev.filter((a) => a.id !== removingId));
    setRemovingId(null);
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setEditError(null);
    try {
      await api.patch(`/embedded-apps/${editing.id}`, {
        appUrl: editing.appUrl,
        databaseUrl: editing.databaseUrl,
        adminDisplayName: editing.adminDisplayName,
      });
      setEditing(null);
      load();
    } catch (err: any) {
      setEditError(err.response?.data?.error ?? "Failed to save");
    }
  };

  const copySecret = async () => {
    if (!newSecret) return;
    try {
      await navigator.clipboard.writeText(newSecret.secret);
      setCopied(true);
    } catch {
      // Clipboard API unavailable -- the field below is still selectable by hand.
    }
  };

  return (
    <div className="embedded-apps-page">
      <div className="page-header">
        <h2>Embedded apps</h2>
        <p className="muted">
          Connects an app's merchant support chat to this dashboard. One connection serves every shop that installs
          that app. Leave "Database URL" blank to use DB-less mode — the conversation lives here in Supportly and
          the app's widget polls <code>/embedded/thread/*</code> directly instead of its own database.
        </p>
      </div>

      {apps.length === 0 ? (
        <p className="muted">No apps connected yet.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>App URL</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.appUrl}</td>
                <td style={{ display: "flex", gap: 8 }}>
                  <button className="btn-ghost" onClick={() => setEditing({ id: a.id, appUrl: a.appUrl, databaseUrl: "", adminDisplayName: a.adminDisplayName })}>
                    Edit
                  </button>
                  <button className="btn-ghost" onClick={() => setRemovingId(a.id)}>
                    Disconnect
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Connect a new app</h3>
      <form className="admin-create-form" onSubmit={createApp}>
        {error && <div className="error-banner">{error}</div>}
        <input placeholder="App name (e.g. ConvoBridge)" value={name} onChange={(e) => setName(e.target.value)} required />
        <input
          placeholder="App URL (e.g. https://convobridge.example.com)"
          value={appUrl}
          onChange={(e) => setAppUrl(e.target.value)}
          required
        />
        <input
          placeholder="Database URL (mysql://...) — leave blank for DB-less mode"
          value={databaseUrl}
          onChange={(e) => setDatabaseUrl(e.target.value)}
        />
        <input
          placeholder='Shown as reply sender (default "Support")'
          value={adminDisplayName}
          onChange={(e) => setAdminDisplayName(e.target.value)}
        />
        <button type="submit">Connect</button>
      </form>

      {newSecret && (
        <div className="snippet-panel">
          <h3>{newSecret.name} connected</h3>
          <p>
            Copy this secret into that app's own <code>.env</code> as <code>SUPPORT_INTERNAL_SECRET</code> (alongside{" "}
            <code>ADMIN_DASHBOARD_URL</code> pointing back at this dashboard). You won't be able to view it again from
            here after closing this.
          </p>
          <textarea readOnly value={newSecret.secret} rows={2} onClick={(e) => e.currentTarget.select()} />
          <div className="snippet-actions">
            <button onClick={copySecret}>{copied ? "Copied!" : "Copy secret"}</button>
            <button onClick={() => setNewSecret(null)}>Close</button>
          </div>
        </div>
      )}

      {editing && (
        <div className="snippet-panel">
          <h3>Edit app</h3>
          <form onSubmit={saveEdit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {editError && <div className="error-banner">{editError}</div>}
            <input
              placeholder="App URL"
              value={editing.appUrl}
              onChange={(e) => setEditing({ ...editing, appUrl: e.target.value })}
              required
            />
            <input
              placeholder="Database URL (mysql://...) — leave blank for DB-less mode"
              value={editing.databaseUrl}
              onChange={(e) => setEditing({ ...editing, databaseUrl: e.target.value })}
            />
            <input
              placeholder='Reply sender name (default "Support")'
              value={editing.adminDisplayName}
              onChange={(e) => setEditing({ ...editing, adminDisplayName: e.target.value })}
            />
            <div className="snippet-actions">
              <button type="submit">Save</button>
              <button type="button" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {removingId && (
        <ConfirmDialog
          title="Disconnect this app?"
          message="Its merchant chat will stop reaching this dashboard until it's reconnected. Already-mirrored conversations stay in the inbox."
          confirmLabel="Disconnect"
          danger
          onConfirm={confirmRemove}
          onCancel={() => setRemovingId(null)}
        />
      )}
    </div>
  );
}
