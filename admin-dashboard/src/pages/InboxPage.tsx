import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SocketEvents, type MessageDTO } from "@chat-support/shared";
import { api } from "../api/client";
import { useSocket } from "../context/SocketContext";
import { useAuth } from "../context/AuthContext";

interface AppOption {
  id: number;
  name: string;
  shop: string;
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  BOT_HANDLED: "Bot handled",
  NEEDS_HUMAN: "Needs human",
  CLAIMED: "Claimed",
  CLOSED: "Closed",
};

export function InboxPage() {
  const { admin } = useAuth();
  const socket = useSocket();
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [apps, setApps] = useState<AppOption[]>([]);
  const [appId, setAppId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [mineOnly, setMineOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const res = await api.get("/messages", {
      params: {
        appId: appId || undefined,
        status: status || undefined,
        mine: mineOnly ? "true" : undefined,
      },
    });
    setMessages(res.data.messages);
    setLoading(false);
  };

  useEffect(() => {
    api.get("/apps").then((res) => setApps(res.data.apps));
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, status, mineOnly]);

  // Live inbox: no polling — new conversations and replies push straight into the list.
  useEffect(() => {
    if (!socket) return;
    const onNewConversation = () => load();
    const onMessage = () => load();
    socket.on(SocketEvents.NEW_CONVERSATION, onNewConversation);
    socket.on(SocketEvents.MESSAGE_RECEIVED, onMessage);
    return () => {
      socket.off(SocketEvents.NEW_CONVERSATION, onNewConversation);
      socket.off(SocketEvents.MESSAGE_RECEIVED, onMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, appId, status, mineOnly]);

  return (
    <div className="inbox-page">
      <div className="page-header">
        <h2>Inbox</h2>
      </div>

      <div className="inbox-filters">
        <select value={appId} onChange={(e) => setAppId(e.target.value)}>
          <option value="">All apps</option>
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.shop})
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="checkbox-label">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          Assigned to me
        </label>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : messages.length === 0 ? (
        <p className="muted">No conversations match these filters.</p>
      ) : (
        <ul className="conversation-list">
          {messages.map((m) => (
            <li key={m.id}>
              <Link to={`/conversations/${m.id}`} className="conversation-row">
                <div className="conversation-row-top">
                  <span className="conversation-name">{m.name || m.email || "Anonymous visitor"}</span>
                  <span className={`badge badge-${m.status.toLowerCase()}`}>{STATUS_LABELS[m.status]}</span>
                </div>
                <div className="conversation-row-bottom">
                  <span className="conversation-shop">{m.shop}</span>
                  <span className="conversation-preview">{m.replies?.[0]?.body ?? m.body}</span>
                </div>
                {m.assignedAdmin && (
                  <div className="conversation-assignee">
                    Assigned to {m.assignedAdmin.name}
                    {m.assignedAdmin.id === admin?.id && " (you)"}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
