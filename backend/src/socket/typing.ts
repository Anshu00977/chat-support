import type { Server, Socket } from "socket.io";
import { SocketEvents, conversationRoom, type ReplySender } from "@chat-support/shared";
import { forwardAdminTyping } from "../services/wishkeeper.service";

const TYPING_TIMEOUT_MS = 3000;

// Server-side safety net: even if a client never sends stop_typing (closed
// tab, dropped connection), the indicator still clears for everyone else.
const timers = new Map<string, NodeJS.Timeout>();

function timerKey(conversationId: number, sender: ReplySender) {
  return `${conversationId}:${sender}`;
}

/**
 * Emits a typing event to the conversation room (excluding `except`, the
 * typer's own socket, when given) and schedules the automatic stop_typing.
 * Also used for WishKeeper merchants, who type over HTTP rather than a socket.
 */
export function broadcastTyping(io: Server, conversationId: number, sender: ReplySender, except?: Socket) {
  const room = conversationRoom(conversationId);
  (except ? except.to(room) : io.to(room)).emit(SocketEvents.TYPING, { conversationId, sender });

  const key = timerKey(conversationId, sender);
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);

  timers.set(
    key,
    setTimeout(() => {
      io.to(room).emit(SocketEvents.STOP_TYPING, { conversationId, sender });
      timers.delete(key);
    }, TYPING_TIMEOUT_MS)
  );
}

export function setupTypingHandlers(io: Server, socket: Socket) {
  socket.on(SocketEvents.TYPING, ({ conversationId, sender }: { conversationId: number; sender: ReplySender }) => {
    broadcastTyping(io, conversationId, sender, socket);
    if (sender === "ADMIN") {
      forwardAdminTyping(conversationId).catch((err) => console.error("Failed to forward typing to WishKeeper:", err));
    }
  });

  socket.on(SocketEvents.STOP_TYPING, ({ conversationId, sender }: { conversationId: number; sender: ReplySender }) => {
    const room = conversationRoom(conversationId);
    const key = timerKey(conversationId, sender);
    const existing = timers.get(key);
    if (existing) {
      clearTimeout(existing);
      timers.delete(key);
    }
    socket.to(room).emit(SocketEvents.STOP_TYPING, { conversationId, sender });
  });
}
