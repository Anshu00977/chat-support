import type { Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";
import { ADMINS_ROOM, SocketEvents, conversationRoom, type Attachment, type ReplySender } from "@chat-support/shared";
import { env } from "../config/env";
import { prisma } from "../prisma";
import { verifyAdminToken } from "../utils/jwt";
import { setIO } from "./ioInstance";
import { setupTypingHandlers } from "./typing";

interface SocketData {
  adminId?: number;
  adminName?: string;
}

type Ack<T> = (res: { ok: true; data: T } | { ok: false; error: string }) => void;

// socket.io does not forward rejected promises anywhere (unlike Express with
// express-async-errors) — an uncaught rejection here would crash the whole
// process. Wrapping every handler this way also sends an acknowledgement back
// to the caller so a failed (or silently dropped) event is visible client-side
// instead of just vanishing — e.g. a chat message that never reaches the DB.
function withAck<TPayload, TResult>(handler: (payload: TPayload) => Promise<TResult>) {
  return (payload: TPayload, callback?: Ack<TResult>) => {
    handler(payload)
      .then((data) => callback?.({ ok: true, data }))
      .catch((err) => {
        console.error("Socket handler error:", err);
        callback?.({ ok: false, error: err instanceof Error ? err.message : "Unexpected server error" });
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
      withAck(async ({ conversationId }: { conversationId: number }) => {
        const exists = await prisma.message.findUnique({ where: { id: conversationId }, select: { id: true } });
        if (!exists) throw new Error("Conversation not found");
        socket.join(conversationRoom(conversationId));
        return { conversationId };
      })
    );

    socket.on(
      SocketEvents.NEW_MESSAGE,
      withAck(
        async (payload: {
          conversationId: number;
          body: string;
          sender: ReplySender;
          adminName?: string;
          attachments?: Attachment[];
        }) => {
          const { conversationId, body, sender, adminName, attachments } = payload;
          if (!body?.trim() && !attachments?.length) throw new Error("Message is empty");

          const reply = await prisma.messageReply.create({
            data: {
              messageId: conversationId,
              sender,
              adminId: sender === "ADMIN" ? data.adminId ?? null : null,
              adminName: sender === "ADMIN" ? adminName ?? null : null,
              body,
              attachments: attachments?.length ? (attachments as unknown as object[]) : undefined,
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

          return reply;
        }
      )
    );

    setupTypingHandlers(io, socket);
  });

  setIO(io);
  return io;
}
