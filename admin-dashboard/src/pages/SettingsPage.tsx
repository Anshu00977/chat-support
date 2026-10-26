import { useState, type FormEvent } from "react";
import { api } from "../api/client";

export function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match");
      return;
    }
    setSaving(true);
    try {
      await api.patch("/admins/me/password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Failed to change password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-page">
      <h2>Settings</h2>

      <h3>Change password</h3>
      <form className="admin-create-form" onSubmit={changePassword}>
        {error && <div className="error-banner">{error}</div>}
        {success && <div className="success-banner">Password changed.</div>}
        <input
          placeholder="Current password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
        <input
          placeholder="New password (min 8 chars)"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
        <input
          placeholder="Confirm new password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Change password"}
        </button>
      </form>
    </div>
  );
}
