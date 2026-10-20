import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api/client";

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

  const removeReply = async (id: number) => {
    await api.delete(`/canned-replies/${id}`);
    setReplies((prev) => prev.filter((r) => r.id !== id));
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
              <button className="btn-ghost" onClick={() => removeReply(r.id)}>
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
    </div>
  );
}
