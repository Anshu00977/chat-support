import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { SocketEvents, type MessageDTO, type MessageReplyDTO } from "@chat-support/shared";
import { createApi } from "./api";
import { getOrCreateVisitorId, getStoredConversationId, setStoredConversationId } from "./storage";

const TYPING_STOP_DELAY_MS = 2000;

export function ChatWidget({ apiUrl, shop }: { apiUrl: string; shop: string }) {
  const api = useRef(createApi(apiUrl)).current;
  const visitorId = useRef(getOrCreateVisitorId()).current;
  const socketRef = useRef<Socket | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [conversation, setConversation] = useState<MessageDTO | null>(null);
  const [agentTyping, setAgentTyping] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

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
    if (!draft.trim() || !conversation || !socketRef.current) return;
    socketRef.current.emit(SocketEvents.NEW_MESSAGE, { conversationId: conversation.id, body: draft, sender: "SHOP" });
    socketRef.current.emit(SocketEvents.STOP_TYPING, { conversationId: conversation.id, sender: "SHOP" });
    setDraft("");
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

  const isClosed = conversation?.status === "CLOSED";

  return (
    <div className="csw-root">
      {open && (
        <div className="csw-panel">
          <div className="csw-header">
            <h3>Chat with us</h3>
            <button onClick={() => setOpen(false)} aria-label="Close chat">
              ✕
            </button>
          </div>

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
            <>
              <div className="csw-body" ref={bodyRef}>
                {conversation.replies.map((r) => (
                  <div key={r.id} className={`csw-bubble-msg ${r.sender.toLowerCase()}`}>
                    {r.body}
                  </div>
                ))}
                {agentTyping && <div className="csw-typing">Agent is typing…</div>}
              </div>
              {isClosed ? (
                <div className="csw-closed-banner">This conversation has been closed.</div>
              ) : (
                <div className="csw-composer">
                  <textarea
                    value={draft}
                    onChange={(e) => onDraftChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendFollowUp();
                      }
                    }}
                    placeholder="Type a message…"
                  />
                  <button onClick={sendFollowUp} disabled={!draft.trim()}>
                    Send
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <button className="csw-bubble" onClick={() => setOpen((v) => !v)} aria-label="Toggle chat">
        {open ? "✕" : "💬"}
      </button>
    </div>
  );
}
