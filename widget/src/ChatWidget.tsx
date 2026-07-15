import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { SocketEvents, type Attachment, type MessageDTO, type MessageReplyDTO } from "@chat-support/shared";
import { createApi } from "./api";
import { clearStoredConversationId, getOrCreateVisitorId, getStoredConversationId, setStoredConversationId } from "./storage";
import { AttachmentChips, AttachmentList, extractFiles } from "./Attachments";

const TYPING_STOP_DELAY_MS = 2000;

export function ChatWidget({ apiUrl, shop }: { apiUrl: string; shop: string }) {
  const api = useRef(createApi(apiUrl)).current;
  const visitorId = useRef(getOrCreateVisitorId()).current;
  const socketRef = useRef<Socket | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [endingChat, setEndingChat] = useState(false);
  const [confirmingEndChat, setConfirmingEndChat] = useState(false);
  const [conversation, setConversation] = useState<MessageDTO | null>(null);
  const [agentTyping, setAgentTyping] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Resume an existing conversation for this shop/visitor, if any.
  useEffect(() => {
    const existingId = getStoredConversationId(shop);
    if (existingId) {
      api.fetchHistory(existingId, visitorId).then((msg) => {
        if (msg) setConversation(msg);
      });
    }
  }, [api, shop, visitorId]);

  // Socket connects once; joins the conversation room once one exists.
  useEffect(() => {
    const socket = io(apiUrl, { autoConnect: true });
    socketRef.current = socket;

    if (conversation) {
      socket.emit(SocketEvents.JOIN_CONVERSATION, { conversationId: conversation.id });
    }

    const onReply = (reply: MessageReplyDTO) => {
      setConversation((prev) => (prev && prev.id === reply.messageId ? { ...prev, replies: [...prev.replies, reply] } : prev));
      setAgentTyping(false);
    };
    const onTyping = ({ conversationId, sender }: { conversationId: number; sender: string }) => {
      if (conversation?.id === conversationId && sender === "ADMIN") setAgentTyping(true);
    };
    const onStopTyping = ({ conversationId, sender }: { conversationId: number; sender: string }) => {
      if (conversation?.id === conversationId && sender === "ADMIN") setAgentTyping(false);
    };
    const onClosed = ({ conversationId }: { conversationId: number }) => {
      setConversation((prev) => (prev?.id === conversationId ? { ...prev, status: "CLOSED" } : prev));
    };

    socket.on(SocketEvents.MESSAGE_RECEIVED, onReply);
    socket.on(SocketEvents.TYPING, onTyping);
    socket.on(SocketEvents.STOP_TYPING, onStopTyping);
    socket.on(SocketEvents.CONVERSATION_CLOSED, onClosed);

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, conversation?.id]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [conversation?.replies.length, agentTyping]);

  const startConversation = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      const message = await api.createMessage({ shop, visitorId, name: name || undefined, email: email || undefined, body: draft });
      setStoredConversationId(shop, message.id);
      setConversation(message);
      setDraft("");
    } finally {
      setSending(false);
    }
  };

  const sendFollowUp = () => {
    const hasContent = draft.trim() || pendingAttachments.length > 0;
    if (!hasContent || !conversation || !socketRef.current || sending || uploading) return;
    setSendError(null);
    setSending(true);
    socketRef.current
      .timeout(5000)
      .emit(
        SocketEvents.NEW_MESSAGE,
        { conversationId: conversation.id, body: draft, sender: "SHOP", attachments: pendingAttachments },
        (err: Error | null, res?: { ok: true; data: unknown } | { ok: false; error: string }) => {
          setSending(false);
          if (err || (res && !res.ok)) {
            setSendError("Message failed to send — check your connection and try again.");
            return;
          }
          // Only clear the draft once the server confirms it, so a dropped send
          // doesn't just make the customer's message vanish with no explanation.
          setDraft("");
          setPendingAttachments([]);
        }
      );
    socketRef.current.emit(SocketEvents.STOP_TYPING, { conversationId: conversation.id, sender: "SHOP" });
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    if (!conversation || !socketRef.current) return;
    socketRef.current.emit(SocketEvents.TYPING, { conversationId: conversation.id, sender: "SHOP" });
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socketRef.current?.emit(SocketEvents.STOP_TYPING, { conversationId: conversation.id, sender: "SHOP" });
    }, TYPING_STOP_DELAY_MS);
  };

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setSendError(null);
    try {
      const uploaded = await Promise.all(files.map((f) => api.uploadFile(f)));
      setPendingAttachments((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to upload file");
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
    if (!conversation || isClosed) return;
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

  const isClosed = conversation?.status === "CLOSED";

  const confirmEndChat = async () => {
    if (!conversation || endingChat) return;
    setEndingChat(true);
    try {
      const updated = await api.endChat(conversation.id, visitorId);
      setConversation((prev) => (prev ? { ...prev, status: updated.status } : prev));
    } finally {
      setEndingChat(false);
      setConfirmingEndChat(false);
    }
  };

  const startNewChat = () => {
    clearStoredConversationId(shop);
    setConversation(null);
    setDraft("");
    setName("");
    setEmail("");
  };

  return (
    <div className="csw-root">
      {open && (
        <div className={`csw-panel${maximized ? " maximized" : ""}`}>
          <div className="csw-header">
            <h3>Chat with us</h3>
            <div className="csw-header-actions">
              {conversation && !isClosed && (
                <button onClick={() => setConfirmingEndChat(true)} disabled={endingChat} aria-label="End chat" title="End chat">
                  End
                </button>
              )}
              <button onClick={() => setMaximized((v) => !v)} aria-label={maximized ? "Restore chat" : "Maximize chat"} title={maximized ? "Restore" : "Maximize"}>
                {maximized ? "⤡" : "⛶"}
              </button>
              <button onClick={() => setOpen(false)} aria-label="Minimize chat" title="Minimize">
                –
              </button>
            </div>
          </div>

          <div className="csw-content">
            {confirmingEndChat && (
              <div className="csw-confirm-overlay">
                <div className="csw-confirm-card">
                  <p className="csw-confirm-title">End this chat?</p>
                  <p className="csw-confirm-sub">You can always start a new one.</p>
                  <div className="csw-confirm-actions">
                    <button
                      className="csw-confirm-cancel"
                      onClick={() => setConfirmingEndChat(false)}
                      disabled={endingChat}
                    >
                      Cancel
                    </button>
                    <button className="csw-confirm-end" onClick={confirmEndChat} disabled={endingChat}>
                      {endingChat ? "Ending…" : "End chat"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!conversation ? (
              <form
                className="csw-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  startConversation();
                }}
              >
                <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
                <input placeholder="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <textarea placeholder="How can we help?" value={draft} onChange={(e) => setDraft(e.target.value)} required />
                <button type="submit" disabled={sending || !draft.trim()}>
                  {sending ? "Sending…" : "Start chat"}
                </button>
              </form>
            ) : (
              <div
                className="csw-dropzone"
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!isClosed) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                {dragging && !isClosed && (
                  <div className="csw-drop-overlay">Drop to attach</div>
                )}
                <div className="csw-body" ref={bodyRef}>
                  {conversation.replies.map((r) => (
                    <div key={r.id} className={`csw-bubble-msg ${r.sender.toLowerCase()}`}>
                      {r.body && <div>{r.body}</div>}
                      {r.attachments && r.attachments.length > 0 && <AttachmentList attachments={r.attachments} />}
                    </div>
                  ))}
                  {agentTyping && <div className="csw-typing">Agent is typing…</div>}
                </div>
                {isClosed ? (
                  <div className="csw-closed-banner">
                    <p>This conversation has been closed.</p>
                    <button onClick={startNewChat}>Start new chat</button>
                  </div>
                ) : (
                  <div className="csw-composer-wrap">
                    {sendError && <div className="csw-error">{sendError}</div>}
                    <AttachmentChips attachments={pendingAttachments} uploading={uploading} onRemove={removeAttachment} />
                    <div className="csw-composer">
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
                      <button
                        type="button"
                        className="csw-attach-btn"
                        onClick={() => fileInputRef.current?.click()}
                        aria-label="Attach file"
                        title="Attach file"
                      >
                        📎
                      </button>
                      <textarea
                        value={draft}
                        onChange={(e) => onDraftChange(e.target.value)}
                        onPaste={onPaste}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            sendFollowUp();
                          }
                        }}
                        placeholder="Type a message…"
                      />
                      <button
                        onClick={sendFollowUp}
                        disabled={(!draft.trim() && pendingAttachments.length === 0) || sending || uploading}
                      >
                        {sending ? "…" : "Send"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <button className="csw-bubble" onClick={() => setOpen((v) => !v)} aria-label="Toggle chat">
        {open ? "✕" : "💬"}
      </button>
    </div>
  );
}
