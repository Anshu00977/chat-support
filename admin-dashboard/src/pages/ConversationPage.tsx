import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { SocketEvents, type Attachment, type MessageDTO, type MessageReplyDTO } from "@chat-support/shared";
import { api } from "../api/client";
import { uploadFile } from "../api/uploads";
import { useSocket } from "../context/SocketContext";
import { useAuth } from "../context/AuthContext";
import { AttachmentChips, AttachmentList } from "../components/Attachments";
import { ConfirmDialog } from "../components/ConfirmDialog";

interface AdminOption {
  id: number;
  name: string;
  active: boolean;
}

interface CannedReply {
  id: number;
  shortcut: string;
  body: string;
}

const TYPING_STOP_DELAY_MS = 2000;

export function ConversationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const conversationId = Number(id);
  const socket = useSocket();
  const { admin } = useAuth();

  const [conversation, setConversation] = useState<MessageDTO | null>(null);
  const [draft, setDraft] = useState("");
  const [customerTyping, setCustomerTyping] = useState(false);
  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const [cannedReplies, setCannedReplies] = useState<CannedReply[]>([]);
  const [connected, setConnected] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [noteMode, setNoteMode] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Visible connection status — a disconnected socket used to fail silently
  // (message box would clear but nothing was ever sent, with no indication why).
  useEffect(() => {
    if (!socket) {
      setConnected(false);
      return;
    }
    setConnected(socket.connected);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [socket]);

  useEffect(() => {
    api.get(`/messages/${conversationId}`).then((res) => setConversation(res.data.message));
    api.get("/admins").then((res) => setAdmins(res.data.admins.filter((a: AdminOption) => a.active)));
  }, [conversationId]);

  // Shared across conversations, so only needs loading once per visit to the page.
  useEffect(() => {
    api.get("/canned-replies").then((res) => setCannedReplies(res.data.replies));
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket.emit(SocketEvents.JOIN_CONVERSATION, { conversationId });

    const onReply = (reply: MessageReplyDTO) => {
      if (reply.messageId !== conversationId) return;
      setConversation((prev) => (prev ? { ...prev, replies: [...prev.replies, reply] } : prev));
      setCustomerTyping(false);
    };
    const onTyping = ({ conversationId: cid, sender }: { conversationId: number; sender: string }) => {
      if (cid === conversationId && sender === "SHOP") setCustomerTyping(true);
    };
    const onStopTyping = ({ conversationId: cid, sender }: { conversationId: number; sender: string }) => {
      if (cid === conversationId && sender === "SHOP") setCustomerTyping(false);
    };
    const onClaimed = ({ conversationId: cid, admin: assignee }: any) => {
      if (cid === conversationId) setConversation((prev) => (prev ? { ...prev, assignedAdmin: assignee, status: "CLAIMED" } : prev));
    };
    const onClosed = ({ conversationId: cid }: { conversationId: number }) => {
      if (cid === conversationId) setConversation((prev) => (prev ? { ...prev, status: "CLOSED" } : prev));
    };
    const onCsat = ({ conversationId: cid, score }: { conversationId: number; score: number }) => {
      if (cid === conversationId) setConversation((prev) => (prev ? { ...prev, csatScore: score } : prev));
    };

    socket.on(SocketEvents.MESSAGE_RECEIVED, onReply);
    socket.on(SocketEvents.TYPING, onTyping);
    socket.on(SocketEvents.STOP_TYPING, onStopTyping);
    socket.on(SocketEvents.CONVERSATION_CLAIMED, onClaimed);
    socket.on(SocketEvents.CONVERSATION_TRANSFERRED, onClaimed);
    socket.on(SocketEvents.CONVERSATION_CLOSED, onClosed);
    socket.on(SocketEvents.CSAT_SUBMITTED, onCsat);

    return () => {
      socket.off(SocketEvents.MESSAGE_RECEIVED, onReply);
      socket.off(SocketEvents.TYPING, onTyping);
      socket.off(SocketEvents.STOP_TYPING, onStopTyping);
      socket.off(SocketEvents.CONVERSATION_CLAIMED, onClaimed);
      socket.off(SocketEvents.CONVERSATION_TRANSFERRED, onClaimed);
      socket.off(SocketEvents.CONVERSATION_CLOSED, onClosed);
      socket.off(SocketEvents.CSAT_SUBMITTED, onCsat);
    };
  }, [socket, conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.replies.length]);

  const sendMessage = () => {
    const hasContent = draft.trim() || pendingAttachments.length > 0;
    if (!hasContent || !socket || sending || uploading) return;
    setSendError(null);
    setSending(true);
    socket
      .timeout(5000)
      .emit(
        SocketEvents.NEW_MESSAGE,
        {
          conversationId,
          body: draft,
          sender: "ADMIN",
          adminName: admin?.name,
          attachments: pendingAttachments,
          internal: noteMode,
        },
        (err: Error | null, res?: { ok: true; data: unknown } | { ok: false; error: string }) => {
          setSending(false);
          if (err) {
            setSendError("Message failed to send — check your connection and try again.");
            return;
          }
          if (res && !res.ok) {
            setSendError(res.error);
            return;
          }
          // Only clear the draft once the server has actually confirmed it —
          // otherwise a dropped/failed send used to look identical to a sent one.
          setDraft("");
          setPendingAttachments([]);
        }
      );
    socket.emit(SocketEvents.STOP_TYPING, { conversationId, sender: "ADMIN" });
  };

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setSendError(null);
    try {
      const uploaded = await Promise.all(files.map(uploadFile));
      setPendingAttachments((prev) => [...prev, ...uploaded]);
    } catch (err: any) {
      setSendError(err.response?.data?.error ?? err.message ?? "Failed to upload file");
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (conversation?.status === "CLOSED") return;
    uploadFiles(Array.from(e.dataTransfer.files));
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length > 0) {
      e.preventDefault();
      uploadFiles(files);
    }
  };

  const insertCannedReply = (id: string) => {
    if (!id) return;
    const reply = cannedReplies.find((r) => String(r.id) === id);
    if (reply) onDraftChange(draft ? `${draft} ${reply.body}` : reply.body);
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    if (!socket || noteMode) return; // writing a note isn't something the customer should see "typing…" for
    socket.emit(SocketEvents.TYPING, { conversationId, sender: "ADMIN" });
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socket.emit(SocketEvents.STOP_TYPING, { conversationId, sender: "ADMIN" });
    }, TYPING_STOP_DELAY_MS);
  };

  // claim/close/transfer responses only include the fields that changed (status,
  // assignedAdmin) — not the full reply list — so merge into existing state
  // instead of replacing it wholesale, or the page crashes on the next render
  // trying to .map() over a now-missing `replies` field.
  const claim = async () => {
    const res = await api.post(`/messages/${conversationId}/claim`);
    setConversation((prev) => (prev ? { ...prev, ...res.data.message } : res.data.message));
  };

  const close = async () => {
    const res = await api.post(`/messages/${conversationId}/close`);
    setConversation((prev) => (prev ? { ...prev, ...res.data.message } : res.data.message));
  };

  const archive = async () => {
    const res = await api.post(`/messages/${conversationId}/archive`);
    setConversation((prev) => (prev ? { ...prev, ...res.data.message } : res.data.message));
  };

  const unarchive = async () => {
    const res = await api.post(`/messages/${conversationId}/unarchive`);
    setConversation((prev) => (prev ? { ...prev, ...res.data.message } : res.data.message));
  };

  const toggleStar = async () => {
    const res = await api.post(`/messages/${conversationId}/${conversation?.starred ? "unstar" : "star"}`);
    setConversation((prev) => (prev ? { ...prev, ...res.data.message } : res.data.message));
  };

  const snooze = async (hours: number) => {
    const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const res = await api.post(`/messages/${conversationId}/snooze`, { until });
    setConversation((prev) => (prev ? { ...prev, ...res.data.message } : res.data.message));
  };

  const unsnooze = async () => {
    const res = await api.post(`/messages/${conversationId}/unsnooze`);
    setConversation((prev) => (prev ? { ...prev, ...res.data.message } : res.data.message));
  };

  const confirmRemove = async () => {
    setDeleting(true);
    try {
      await api.delete(`/messages/${conversationId}`);
      navigate("/");
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  const transfer = async (targetAdminId: number) => {
    const res = await api.post(`/messages/${conversationId}/transfer`, { adminId: targetAdminId });
    setConversation((prev) => (prev ? { ...prev, ...res.data.message } : res.data.message));
  };

  if (!conversation) return <p className="muted">Loading conversation…</p>;

  const isMine = conversation.assignedAdmin?.id === admin?.id;
  const isClosed = conversation.status === "CLOSED";
  const customerLabel = conversation.source === "WISHKEEPER" ? "Merchant" : "Customer";

  return (
    <div className="conversation-page">
      <div className="conversation-header">
        <div>
          <h2>
            <button className={`star-btn${conversation.starred ? " starred" : ""}`} onClick={toggleStar} title={conversation.starred ? "Unstar" : "Star"} aria-label={conversation.starred ? "Unstar" : "Star"}>
              {conversation.starred ? "⭐" : "☆"}
            </button>{" "}
            {conversation.name || conversation.email || "Anonymous visitor"}
          </h2>
          <p className="muted">
            {conversation.source === "WISHKEEPER" && <span className="badge badge-wishkeeper">WishKeeper</span>} {conversation.shop} · <span className={`badge badge-${conversation.status.toLowerCase()}`}>{conversation.status.replace("_", " ")}</span>
            {conversation.archived && <> · <span className="badge badge-archived">Archived</span></>}
            {conversation.snoozedUntil && (
              <>
                {" · "}
                <span className="badge badge-snoozed">Snoozed until {new Date(conversation.snoozedUntil).toLocaleString()}</span>
              </>
            )}
            {conversation.csatScore && (
              <>
                {" · "}
                <span className="csat-score" title={`Rated ${conversation.csatScore}/5`}>
                  {"⭐".repeat(conversation.csatScore)}
                </span>
              </>
            )}
            {conversation.assignedAdmin && ` · assigned to ${conversation.assignedAdmin.name}`}
            {" · "}
            <span className={`conn-indicator ${connected ? "online" : "offline"}`}>
              {connected ? "Live" : "Reconnecting…"}
            </span>
          </p>
        </div>
        <div className="conversation-actions">
          {!conversation.assignedAdmin && !isClosed && <button onClick={claim}>Claim</button>}
          {isMine && !isClosed && (
            <select defaultValue="" onChange={(e) => e.target.value && transfer(Number(e.target.value))}>
              <option value="">Transfer to…</option>
              {admins
                .filter((a) => a.id !== admin?.id)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          )}
          {!isClosed && <button onClick={close}>Close</button>}
          {conversation.snoozedUntil ? (
            <button className="btn-ghost" onClick={unsnooze}>
              Unsnooze
            </button>
          ) : (
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) snooze(Number(e.target.value));
                e.target.value = "";
              }}
              title="Snooze until the customer replies or this time passes"
            >
              <option value="">Snooze…</option>
              <option value="3">3 hours</option>
              <option value="24">Tomorrow</option>
              <option value="168">Next week</option>
            </select>
          )}
          {conversation.archived ? (
            <button className="btn-ghost" onClick={unarchive}>
              Unarchive
            </button>
          ) : (
            <button className="btn-ghost" onClick={archive}>
              Archive
            </button>
          )}
          {admin?.role === "SUPER_ADMIN" && (
            <button className="btn-danger" onClick={() => setConfirmingDelete(true)}>
              Delete
            </button>
          )}
        </div>
      </div>

      <div
        className="dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          if (!isClosed) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {dragging && !isClosed && <div className="drop-overlay">Drop to attach</div>}

        <div className="message-list">
          {conversation.replies.map((r) =>
            r.sender === "SYSTEM" ? (
              <div key={r.id} className="system-divider">
                <span>{r.body}</span>
              </div>
            ) : (
              <div key={r.id} className={`bubble bubble-${r.sender.toLowerCase()}${r.internal ? " bubble-internal" : ""}`}>
                <div className="bubble-meta">
                  {r.internal && "🔒 "}
                  {r.sender === "ADMIN" ? r.adminName ?? "Admin" : r.sender === "BOT" ? "Bot" : customerLabel}
                  {r.internal && " · internal note"}
                </div>
                {r.body && <div className="bubble-body">{r.body}</div>}
                {r.attachments && r.attachments.length > 0 && <AttachmentList attachments={r.attachments} />}
              </div>
            )
          )}
          {customerTyping && <div className="typing-indicator">{customerLabel} is typing…</div>}
          <div ref={bottomRef} />
        </div>

        {!isClosed && (
          <div className={`composer-wrap${noteMode ? " composer-wrap--note" : ""}`}>
            {sendError && <div className="error-banner send-error">{sendError}</div>}
            <AttachmentChips attachments={pendingAttachments} uploading={uploading} onRemove={removeAttachment} />
            <div className="composer-mode-row">
              <label className="checkbox-label note-toggle">
                <input type="checkbox" checked={noteMode} onChange={(e) => setNoteMode(e.target.checked)} />
                🔒 Internal note (not sent to {customerLabel.toLowerCase()})
              </label>
            </div>
            <div className="composer">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  uploadFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <button type="button" className="btn-ghost attach-btn" onClick={() => fileInputRef.current?.click()} aria-label="Attach file" title="Attach file">
                📎
              </button>
              {cannedReplies.length > 0 && (
                <select
                  className="canned-reply-picker"
                  value=""
                  onChange={(e) => insertCannedReply(e.target.value)}
                  title="Insert a canned reply"
                  aria-label="Insert a canned reply"
                >
                  <option value="">Canned replies…</option>
                  {cannedReplies.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.shortcut}
                    </option>
                  ))}
                </select>
              )}
              <textarea
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                onPaste={onPaste}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder={noteMode ? "Write an internal note…" : "Type a reply…"}
              />
              <button onClick={sendMessage} disabled={(!draft.trim() && pendingAttachments.length === 0) || sending || uploading}>
                {sending ? "Sending…" : noteMode ? "Add note" : "Send"}
              </button>
            </div>
          </div>
        )}
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this conversation?"
          message={
            conversation.source === "WISHKEEPER"
              ? "This cannot be undone. This only deletes it from this dashboard -- the real history stays in WishKeeper's own database and may reappear on a future sync."
              : "This cannot be undone -- the conversation and all its messages will be permanently removed."
          }
          confirmLabel="Delete"
          danger
          busy={deleting}
          onConfirm={confirmRemove}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
