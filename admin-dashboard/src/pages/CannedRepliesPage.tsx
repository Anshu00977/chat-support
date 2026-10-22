import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";

interface CannedReply {
  id: number;
  shortcut: string;
  body: string;
}

export function CannedRepliesPage() {
  const [replies, setReplies] = useState<CannedReply[]>([]);
  const [shortcut, setShortcut] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const load = () => api.get("/canned-replies").then((res) => setReplies(res.data.replies));

  useEffect(() => {
    load();
  }, []);

  const createReply = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/canned-replies", { shortcut, body });
      setShortcut("");
      setBody("");
      load();
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Failed to create canned reply");
    }
  };

  const confirmRemoveReply = async () => {
    if (!removingId) return;
    await api.delete(`/canned-replies/${removingId}`);
    setReplies((prev) => prev.filter((r) => r.id !== removingId));
    setRemovingId(null);
  };

  return (
    <div className="canned-replies-page">
      <div className="page-header">
        <h2>Canned replies</h2>
        <p className="muted">Shared quick-insert replies, available to every admin from the composer.</p>
      </div>

      {replies.length === 0 ? (
        <p className="muted">No canned replies yet.</p>
      ) : (
        <ul className="bot-keywords-list">
          {replies.map((r) => (
            <li key={r.id}>
              <div>
                <strong>{r.shortcut}</strong>
                <div className="canned-reply-body">{r.body}</div>
              </div>
              <button className="btn-ghost" onClick={() => setRemovingId(r.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>Add canned reply</h3>
      <form className="keyword-form" onSubmit={createReply}>
        {error && <div className="error-banner">{error}</div>}
        <input placeholder="Shortcut (e.g. Refund policy)" value={shortcut} onChange={(e) => setShortcut(e.target.value)} required />
        <input placeholder="Reply text" value={body} onChange={(e) => setBody(e.target.value)} required />
        <button type="submit">Add</button>
      </form>

      {removingId && (
        <ConfirmDialog
          title="Remove this canned reply?"
          message="This only removes the shortcut from the picker -- it doesn't affect any messages already sent."
          confirmLabel="Remove"
          danger
          onConfirm={confirmRemoveReply}
          onCancel={() => setRemovingId(null)}
        />
      )}
    </div>
  );
}
