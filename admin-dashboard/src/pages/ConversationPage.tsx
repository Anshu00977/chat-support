import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { SocketEvents, type MessageDTO, type MessageReplyDTO } from "@chat-support/shared";
import { api } from "../api/client";
import { useSocket } from "../context/SocketContext";
import { useAuth } from "../context/AuthContext";

interface AdminOption {
  id: number;
  name: string;
  active: boolean;
}

const TYPING_STOP_DELAY_MS = 2000;

export function ConversationPage() {
  const { id } = useParams();
  const conversationId = Number(id);
  const socket = useSocket();
  const { admin } = useAuth();

  const [conversation, setConversation] = useState<MessageDTO | null>(null);
  const [draft, setDraft] = useState("");
  const [customerTyping, setCustomerTyping] = useState(false);
  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get(`/messages/${conversationId}`).then((res) => setConversation(res.data.message));
    api.get("/admins").then((res) => setAdmins(res.data.admins.filter((a: AdminOption) => a.active)));
  }, [conversationId]);

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

    socket.on(SocketEvents.MESSAGE_RECEIVED, onReply);
    socket.on(SocketEvents.TYPING, onTyping);
    socket.on(SocketEvents.STOP_TYPING, onStopTyping);
    socket.on(SocketEvents.CONVERSATION_CLAIMED, onClaimed);
    socket.on(SocketEvents.CONVERSATION_TRANSFERRED, onClaimed);
    socket.on(SocketEvents.CONVERSATION_CLOSED, onClosed);

    return () => {
      socket.off(SocketEvents.MESSAGE_RECEIVED, onReply);
      socket.off(SocketEvents.TYPING, onTyping);
      socket.off(SocketEvents.STOP_TYPING, onStopTyping);
      socket.off(SocketEvents.CONVERSATION_CLAIMED, onClaimed);
      socket.off(SocketEvents.CONVERSATION_TRANSFERRED, onClaimed);
      socket.off(SocketEvents.CONVERSATION_CLOSED, onClosed);
    };
  }, [socket, conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.replies.length]);

  const sendMessage = () => {
    if (!draft.trim() || !socket) return;
    socket.emit(SocketEvents.NEW_MESSAGE, {
      conversationId,
      body: draft,
      sender: "ADMIN",
      adminName: admin?.name,
    });
    socket.emit(SocketEvents.STOP_TYPING, { conversationId, sender: "ADMIN" });
    setDraft("");
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    if (!socket) return;
    socket.emit(SocketEvents.TYPING, { conversationId, sender: "ADMIN" });
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socket.emit(SocketEvents.STOP_TYPING, { conversationId, sender: "ADMIN" });
    }, TYPING_STOP_DELAY_MS);
  };

  const claim = async () => {
    const res = await api.post(`/messages/${conversationId}/claim`);
    setConversation(res.data.message);
  };

  const close = async () => {
    const res = await api.post(`/messages/${conversationId}/close`);
    setConversation(res.data.message);
  };

  const transfer = async (targetAdminId: number) => {
    const res = await api.post(`/messages/${conversationId}/transfer`, { adminId: targetAdminId });
    setConversation(res.data.message);
  };

  if (!conversation) return <p className="muted">Loading conversation…</p>;

  const isMine = conversation.assignedAdmin?.id === admin?.id;
  const isClosed = conversation.status === "CLOSED";

  return (
    <div className="conversation-page">
      <div className="conversation-header">
        <div>
          <h2>{conversation.name || conversation.email || "Anonymous visitor"}</h2>
          <p className="muted">
            {conversation.shop} · {conversation.status}
            {conversation.assignedAdmin && ` · assigned to ${conversation.assignedAdmin.name}`}
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
        </div>
      </div>

      <div className="message-list">
        {conversation.replies.map((r) => (
          <div key={r.id} className={`bubble bubble-${r.sender.toLowerCase()}`}>
            <div className="bubble-meta">{r.sender === "ADMIN" ? r.adminName ?? "Admin" : r.sender === "BOT" ? "Bot" : "Customer"}</div>
            <div className="bubble-body">{r.body}</div>
          </div>
        ))}
        {customerTyping && <div className="typing-indicator">Customer is typing…</div>}
        <div ref={bottomRef} />
      </div>

      {!isClosed && (
        <div className="composer">
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Type a reply…"
          />
          <button onClick={sendMessage} disabled={!draft.trim()}>
            Send
          </button>
        </div>
      )}
    </div>
  );
}
