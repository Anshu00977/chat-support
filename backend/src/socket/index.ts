import type { Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";
import { ADMINS_ROOM, SocketEvents, conversationRoom, type ReplySender } from "@chat-support/shared";
import { env } from "../config/env";
import { prisma } from "../prisma";
import { verifyAdminToken } from "../utils/jwt";
import { setIO } from "./ioInstance";
import { setupTypingHandlers } from "./typing";

interface SocketData {
  adminId?: number;
  adminName?: string;
}

// socket.io does not forward rejected promises anywhere (unlike Express with
// express-async-errors) — an uncaught rejection here would crash the whole
// process, so every async handler is wrapped to log and notify the client instead.
function safeHandler<T>(socket: Socket, handler: (payload: T) => Promise<void>) {
  return (payload: T) => {
    handler(payload).catch((err) => {
      console.error("Socket handler error:", err);
      socket.emit("error_message", { error: err instanceof Error ? err.message : "Unexpected server error" });
    });
  };
}

export function initSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: env.corsOrigins.length > 0 ? env.corsOrigins : "*",
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    const data = socket.data as SocketData;

    // Optional: dashboard sockets send an admin JWT so we know who's typing/replying.
    const token = socket.handshake.auth?.token as string | undefined;
    if (token) {
      try {
        const payload = verifyAdminToken(token);
        data.adminId = payload.adminId;
        socket.join(ADMINS_ROOM);
      } catch {
        // invalid token -> treat connection as an anonymous widget socket
      }
    }

    socket.on(
      SocketEvents.JOIN_CONVERSATION,
      safeHandler(socket, async ({ conversationId }: { conversationId: number }) => {
        const exists = await prisma.message.findUnique({ where: { id: conversationId }, select: { id: true } });
        if (!exists) return;
        socket.join(conversationRoom(conversationId));
      })
    );

    socket.on(
      SocketEvents.NEW_MESSAGE,
      safeHandler(
        socket,
        async (payload: { conversationId: number; body: string; sender: ReplySender; adminName?: string }) => {
          const { conversationId, body, sender, adminName } = payload;
          if (!body?.trim()) return;

          const reply = await prisma.messageReply.create({
            data: {
              messageId: conversationId,
              sender,
              adminId: sender === "ADMIN" ? data.adminId ?? null : null,
              adminName: sender === "ADMIN" ? adminName ?? null : null,
              body,
            },
          });

          await prisma.message.update({
            where: { id: conversationId },
            data: {
              updatedAt: new Date(),
              status: sender === "SHOP" ? "NEEDS_HUMAN" : undefined,
            },
          });

          // Single emit across both rooms: sockets in both (e.g. an admin with
          // this conversation open) get de-duplicated by Socket.IO automatically,
          // unlike two separate .emit() calls which would double-deliver.
          io.to([conversationRoom(conversationId), ADMINS_ROOM]).emit(SocketEvents.MESSAGE_RECEIVED, reply);
        }
      )
    );

    setupTypingHandlers(io, socket);
  });

  setIO(io);
  return io;
}
