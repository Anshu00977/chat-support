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

// Value of the "app" filter that selects WishKeeper merchant threads, which aren't tied to a widget app.
const WISHKEEPER_FILTER = "wishkeeper";

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
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const res = await api.get("/messages", {
      params: {
        appId: appId && appId !== WISHKEEPER_FILTER ? appId : undefined,
        source: appId === WISHKEEPER_FILTER ? "WISHKEEPER" : undefined,
        status: status || undefined,
        mine: mineOnly ? "true" : undefined,
        search: search.trim() || undefined,
        archived: showArchived ? "true" : undefined,
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
  }, [appId, status, mineOnly, showArchived]);

  // Debounced separately from the other filters, which should refetch
  // immediately -- typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Live inbox: no polling — new conversations and replies push straight into the list.
  useEffect(() => {
    if (!socket) return;
    const onNewConversation = () => load();
    const onMessage = () => load();
    const onArchivedOrDeleted = () => load();
    socket.on(SocketEvents.NEW_CONVERSATION, onNewConversation);
    socket.on(SocketEvents.MESSAGE_RECEIVED, onMessage);
    socket.on(SocketEvents.CONVERSATION_ARCHIVED, onArchivedOrDeleted);
    socket.on(SocketEvents.CONVERSATION_DELETED, onArchivedOrDeleted);
    return () => {
      socket.off(SocketEvents.NEW_CONVERSATION, onNewConversation);
      socket.off(SocketEvents.MESSAGE_RECEIVED, onMessage);
      socket.off(SocketEvents.CONVERSATION_ARCHIVED, onArchivedOrDeleted);
      socket.off(SocketEvents.CONVERSATION_DELETED, onArchivedOrDeleted);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, appId, status, mineOnly, search, showArchived]);

  const statCounts = messages.reduce<Record<string, number>>((acc, m) => {
    acc[m.status] = (acc[m.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="inbox-page">
      <div className="page-header">
        <h2>Inbox</h2>
      </div>

      <div className="stats-bar">
        <div className="stat-tile">
          <span className="stat-value">{messages.length}</span>
          <span className="stat-label">In view</span>
        </div>
        <div className="stat-tile stat-tile--warning">
          <span className="stat-value">{statCounts.NEEDS_HUMAN ?? 0}</span>
          <span className="stat-label">Needs human</span>
        </div>
        <div className="stat-tile stat-tile--info">
          <span className="stat-value">{(statCounts.OPEN ?? 0) + (statCounts.CLAIMED ?? 0)}</span>
          <span className="stat-label">Open</span>
        </div>
        <div className="stat-tile stat-tile--success">
          <span className="stat-value">{statCounts.BOT_HANDLED ?? 0}</span>
          <span className="stat-label">Bot handled</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{statCounts.CLOSED ?? 0}</span>
          <span className="stat-label">Closed</span>
        </div>
      </div>

      <div className="inbox-filters">
        <input
          type="search"
          className="inbox-search"
          placeholder="Search by name, shop or message…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={appId} onChange={(e) => setAppId(e.target.value)}>
          <option value="">All apps</option>
          <option value={WISHKEEPER_FILTER}>WishKeeper merchants</option>
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
        <label className="checkbox-label">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Archived
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
                  <span className="conversation-badges">
                    {m.source === "WISHKEEPER" && <span className="badge badge-wishkeeper">WishKeeper</span>}
                    {m.archived && <span className="badge badge-archived">Archived</span>}
                    <span className={`badge badge-${m.status.toLowerCase()}`}>{STATUS_LABELS[m.status]}</span>
                  </span>
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
