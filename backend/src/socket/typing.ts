import type { Server, Socket } from "socket.io";
import { SocketEvents, conversationRoom, type ReplySender } from "@chat-support/shared";

const TYPING_TIMEOUT_MS = 3000;

// Server-side safety net: even if a client never sends stop_typing (closed
// tab, dropped connection), the indicator still clears for everyone else.
const timers = new Map<string, NodeJS.Timeout>();

function timerKey(conversationId: number, sender: ReplySender) {
  return `${conversationId}:${sender}`;
}

export function setupTypingHandlers(io: Server, socket: Socket) {
  socket.on(SocketEvents.TYPING, ({ conversationId, sender }: { conversationId: number; sender: ReplySender }) => {
    const room = conversationRoom(conversationId);
    socket.to(room).emit(SocketEvents.TYPING, { conversationId, sender });

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
