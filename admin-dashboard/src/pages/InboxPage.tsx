import { useEffect, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { SocketEvents, type MessageDTO } from "@chat-support/shared";
import { api } from "../api/client";
import { useSocket } from "../context/SocketContext";
import { useAuth } from "../context/AuthContext";
import { PromptDialog } from "../components/PromptDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";

interface EmbeddedAppOption {
  id: number;
  name: string;
}

interface SavedView {
  id: string;
  name: string;
  appId: string;
  status: string;
  mineOnly: boolean;
  showArchived: boolean;
  starredOnly?: boolean;
  shopFilter?: string;
}

const SAVED_VIEWS_KEY = "inbox-saved-views";
const NOTIFY_PREF_KEY = "inbox-notify-enabled";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function loadSavedViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(SAVED_VIEWS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Value of the "app" filter that selects WishKeeper merchant threads, which aren't tied to a widget app.
const WISHKEEPER_FILTER = "wishkeeper";
// Selects every storefront Chat Widget conversation, across all shops that installed it --
// the dropdown shows product types, not one entry per individual shop (that's what the
// separate "Filter by shop" box is for).
const WIDGET_FILTER = "widget";
// Embedded apps (e.g. ConvoBridge) are filtered by their own id, prefixed so
// it can't collide with a numeric ShopifyApp id in the same <select>.
const EMBEDDED_PREFIX = "embedded:";

// BOT_HANDLED is kept only so an old conversation from before the FAQ bot
// was removed still shows a readable badge -- it's never offered as a
// filter or counted in the stats bar anymore.
const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  BOT_HANDLED: "Bot handled",
  NEEDS_HUMAN: "Needs human",
  CLAIMED: "Claimed",
  CLOSED: "Closed",
};

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "NEEDS_HUMAN", label: "Unopened" },
  { value: "ONGOING", label: "Ongoing" },
  { value: "CLOSED", label: "Closed" },
];

export function InboxPage() {
  const { admin } = useAuth();
  const socket = useSocket();
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [embeddedApps, setEmbeddedApps] = useState<EmbeddedAppOption[]>([]);
  const [shops, setShops] = useState<{ shop: string; name: string }[]>([]);
  const [appId, setAppId] = useState<string>("");
  // Default view is the one that needs attention, not everything mixed together.
  const [status, setStatus] = useState<string>("NEEDS_HUMAN");
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [shopFilter, setShopFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savedViews, setSavedViews] = useState<SavedView[]>(loadSavedViews);
  const [savingView, setSavingView] = useState(false);
  const [removingViewId, setRemovingViewId] = useState<string | null>(null);
  const [notifyEnabled, setNotifyEnabled] = useState(
    () => localStorage.getItem(NOTIFY_PREF_KEY) === "true" && typeof Notification !== "undefined" && Notification.permission === "granted"
  );

  const load = async () => {
    setLoading(true);
    const isEmbedded = appId.startsWith(EMBEDDED_PREFIX);
    const res = await api.get("/messages", {
      params: {
        embeddedAppId: isEmbedded ? appId.slice(EMBEDDED_PREFIX.length) : undefined,
        source: appId === WISHKEEPER_FILTER ? "WISHKEEPER" : appId === WIDGET_FILTER ? "WIDGET" : isEmbedded ? "EMBEDDED" : undefined,
        status: status || undefined,
        mine: mineOnly ? "true" : undefined,
        search: search.trim() || undefined,
        shop: shopFilter.trim() || undefined,
        archived: showArchived ? "true" : undefined,
        snoozed: showSnoozed ? "true" : undefined,
        starred: starredOnly ? "true" : undefined,
      },
    });
    setMessages(res.data.messages);
    setLoading(false);
  };

  useEffect(() => {
    api.get("/embedded-apps").then((res) => setEmbeddedApps(res.data.apps));
    api.get("/messages/shops").then((res) => setShops(res.data.shops));
  }, []);

  const toggleNotifications = async () => {
    if (notifyEnabled) {
      setNotifyEnabled(false);
      localStorage.setItem(NOTIFY_PREF_KEY, "false");
      return;
    }
    if (typeof Notification === "undefined") return;
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission === "granted") {
      setNotifyEnabled(true);
      localStorage.setItem(NOTIFY_PREF_KEY, "true");
    }
  };

  const toggleStar = async (e: MouseEvent, id: number, currentlyStarred: boolean) => {
    e.preventDefault(); // don't navigate into the conversation
    e.stopPropagation();
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, starred: !currentlyStarred } : m)));
    await api.post(`/messages/${id}/${currentlyStarred ? "unstar" : "star"}`);
  };

  const saveCurrentView = (name: string) => {
    const view: SavedView = { id: crypto.randomUUID(), name, appId, status, mineOnly, showArchived, starredOnly, shopFilter };
    const next = [...savedViews, view];
    setSavedViews(next);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
    setSavingView(false);
  };

  const applyView = (view: SavedView) => {
    setAppId(view.appId);
    setStatus(view.status);
    setMineOnly(view.mineOnly);
    setShowArchived(view.showArchived);
    setStarredOnly(view.starredOnly ?? false);
    setShopFilter(view.shopFilter ?? "");
  };

  const confirmRemoveView = () => {
    if (!removingViewId) return;
    const next = savedViews.filter((v) => v.id !== removingViewId);
    setSavedViews(next);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
    setRemovingViewId(null);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, status, mineOnly, showArchived, showSnoozed, starredOnly]);

  // Debounced separately from the other filters, which should refetch
  // immediately -- typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, shopFilter]);

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
  }, [socket, appId, status, mineOnly, search, shopFilter, showArchived, showSnoozed, starredOnly]);

  // Desktop notification on any new conversation, independent of the current
  // filters -- otherwise switching to "My open" would silently stop alerting
  // about brand-new unassigned ones. Only fires while the tab isn't focused;
  // a visible tab already shows the new row live.
  useEffect(() => {
    if (!socket || !notifyEnabled) return;
    const onNewConversation = (payload: { message?: { name?: string | null; shop?: string; body?: string } }) => {
      if (!document.hidden || typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const who = payload?.message?.name || payload?.message?.shop || "A customer";
      new Notification("New support conversation", { body: `${who}: ${payload?.message?.body ?? ""}`.slice(0, 120) });
    };
    socket.on(SocketEvents.NEW_CONVERSATION, onNewConversation);
    return () => {
      socket.off(SocketEvents.NEW_CONVERSATION, onNewConversation);
    };
  }, [socket, notifyEnabled]);

  const statCounts = messages.reduce<Record<string, number>>((acc, m) => {
    acc[m.status] = (acc[m.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="inbox-page">
      <div className="page-header page-header-row">
        <h2>Inbox</h2>
        <button className="btn-ghost" onClick={toggleNotifications} title="Desktop notifications for new conversations">
          {notifyEnabled ? "🔔 Notifications on" : "🔕 Notifications off"}
        </button>
      </div>

      {savedViews.length > 0 && (
        <div className="saved-views">
          {savedViews.map((v) => (
            <span key={v.id} className="saved-view-chip">
              <button className="btn-ghost" onClick={() => applyView(v)}>
                {v.name}
              </button>
              <button className="saved-view-remove" onClick={() => setRemovingViewId(v.id)} title="Remove this saved view" aria-label="Remove this saved view">
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="stats-bar">
        <div className="stat-tile">
          <span className="stat-value">{messages.length}</span>
          <span className="stat-label">In view</span>
        </div>
        <div className="stat-tile stat-tile--info">
          <span className="stat-value">{(statCounts.OPEN ?? 0) + (statCounts.CLAIMED ?? 0)}</span>
          <span className="stat-label">Open</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{statCounts.CLOSED ?? 0}</span>
          <span className="stat-label">Closed</span>
        </div>
      </div>

      <div className="status-tabs">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            className={`status-tab${status === t.value ? " status-tab--active" : ""}`}
            onClick={() => setStatus(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="inbox-filters">
        <input
          type="search"
          className="inbox-search"
          placeholder="Search by name or message…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          type="search"
          className="inbox-search"
          placeholder="Filter by shop…"
          list="inbox-shop-options"
          value={shopFilter}
          onChange={(e) => setShopFilter(e.target.value)}
        />
        <datalist id="inbox-shop-options">
          {shops.map((s) => (
            <option key={s.shop} value={s.shop}>
              {s.name}
            </option>
          ))}
        </datalist>
        <select value={appId} onChange={(e) => setAppId(e.target.value)}>
          <option value="">All apps</option>
          <option value={WIDGET_FILTER}>Chat Widget</option>
          <option value={WISHKEEPER_FILTER}>WishKeeper merchants</option>
          {embeddedApps.map((a) => (
            <option key={`embedded-${a.id}`} value={`${EMBEDDED_PREFIX}${a.id}`}>
              {a.name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS)
            // BOT_HANDLED: no FAQ bot anymore. NEEDS_HUMAN: already covered
            // by the "Unopened" tab above, kept here only as a filter value.
            .filter(([value]) => value !== "BOT_HANDLED" && value !== "NEEDS_HUMAN")
            .map(([value, label]) => (
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
        <label className="checkbox-label">
          <input type="checkbox" checked={showSnoozed} onChange={(e) => setShowSnoozed(e.target.checked)} />
          Snoozed
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={starredOnly} onChange={(e) => setStarredOnly(e.target.checked)} />
          ⭐ Starred
        </label>
        <button className="btn-ghost" onClick={() => setSavingView(true)} title="Save the current filter combination">
          + Save view
        </button>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : messages.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📭</div>
          <p>No conversations match these filters.</p>
        </div>
      ) : (
        <ul className="conversation-list">
          {messages.map((m) => (
            <li key={m.id}>
              <Link
                to={`/conversations/${m.id}`}
                className={`conversation-row${m.status === "NEEDS_HUMAN" ? " conversation-row--unopened" : ""}`}
              >
                <button
                  className={`star-btn${m.starred ? " starred" : ""}`}
                  onClick={(e) => toggleStar(e, m.id, m.starred)}
                  title={m.starred ? "Unstar" : "Star"}
                  aria-label={m.starred ? "Unstar" : "Star"}
                >
                  {m.starred ? "⭐" : "☆"}
                </button>
                <div className="conversation-avatar">{initials(m.name || m.shop || "?")}</div>
                <div className="conversation-row-main">
                  <div className="conversation-row-top">
                    <span className="conversation-name">{m.name || m.email || "Anonymous visitor"}</span>
                    <span className="conversation-badges">
                      {m.source === "WISHKEEPER" && <span className="badge badge-wishkeeper">WishKeeper</span>}
                      {m.archived && <span className="badge badge-archived">Archived</span>}
                      {m.snoozedUntil && <span className="badge badge-snoozed">Snoozed</span>}
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
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {savingView && (
        <PromptDialog
          title="Save this view"
          label="Name"
          placeholder="e.g. My open, Needs human"
          confirmLabel="Save"
          onSubmit={saveCurrentView}
          onCancel={() => setSavingView(false)}
        />
      )}

      {removingViewId && (
        <ConfirmDialog
          title="Remove this saved view?"
          message="You can always save it again later -- this only removes the shortcut, not any conversations."
          confirmLabel="Remove"
          danger
          onConfirm={confirmRemoveView}
          onCancel={() => setRemovingViewId(null)}
        />
      )}
    </div>
  );
}
