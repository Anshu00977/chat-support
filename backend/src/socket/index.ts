import type { Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";
import { ADMINS_ROOM, SocketEvents, conversationRoom, type Attachment, type ReplySender } from "@chat-support/shared";
import { env } from "../config/env";
import { prisma } from "../prisma";
import { verifyAdminToken } from "../utils/jwt";
import { setIO } from "./ioInstance";
import { setupTypingHandlers } from "./typing";
import { sendWishkeeperAdminReply } from "../services/wishkeeper.service";
import { sendEmbeddedAdminReply, getEmbeddedAppById } from "../services/embeddedChat.service";

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
        const conversation = await prisma.message.findUnique({
          where: { id: conversationId },
          select: { id: true, source: true },
        });
        if (!conversation) throw new Error("Conversation not found");
        // Merchant support threads are only ever viewed from the dashboard.
        if ((conversation.source === "WISHKEEPER" || conversation.source === "EMBEDDED") && !data.adminId) {
          throw new Error("Conversation not found");
        }
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
          internal?: boolean;
        }) => {
          const { conversationId, body, sender, adminName, attachments, internal } = payload;
          if (!body?.trim() && !attachments?.length) throw new Error("Message is empty");

          const conversation = await prisma.message.findUnique({
            where: { id: conversationId },
            select: { id: true, source: true, shop: true, externalThreadId: true, embeddedAppId: true },
          });
          if (!conversation) throw new Error("Conversation not found");

          // Internal notes never leave this backend -- not pushed to
          // WishKeeper, not emitted to the customer-facing conversation room,
          // regardless of conversation source. Admin-only, always.
          if (internal) {
            if (sender !== "ADMIN" || !data.adminId) throw new Error("Only admins can add internal notes");
            const note = await prisma.messageReply.create({
              data: {
                messageId: conversationId,
                sender: "ADMIN",
                adminId: data.adminId,
                adminName: adminName ?? null,
                body,
                internal: true,
                attachments: attachments?.length ? (attachments as unknown as object[]) : undefined,
              },
            });
            await prisma.message.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
            io.to(ADMINS_ROOM).emit(SocketEvents.MESSAGE_RECEIVED, note);
            return note;
          }

          // WishKeeper merchants write from their own app, so the only valid
          // sender here is a logged-in admin; the reply goes to WishKeeper's DB.
          if (conversation.source === "WISHKEEPER") {
            if (sender !== "ADMIN" || !data.adminId) throw new Error("Only admins can reply to WishKeeper conversations");
            const replies = await sendWishkeeperAdminReply({
              conversation,
              admin: { id: data.adminId, name: adminName ?? null },
              body: body ?? "",
              attachments: attachments ?? [],
            });
            return replies[replies.length - 1];
          }

          // Same idea, generalized for any other app connected via EmbeddedApp.
          if (conversation.source === "EMBEDDED") {
            if (sender !== "ADMIN" || !data.adminId) throw new Error("Only admins can reply to this conversation");
            const embeddedApp = conversation.embeddedAppId ? await getEmbeddedAppById(conversation.embeddedAppId) : null;
            if (embeddedApp?.databaseUrl) {
              // Old path: app keeps its own mirrored DB, push the reply there too.
              const replies = await sendEmbeddedAdminReply({
                conversation,
                admin: { id: data.adminId, name: adminName ?? null },
                body: body ?? "",
                attachments: attachments ?? [],
              });
              return replies[replies.length - 1];
            }
            // DB-less path: conversation lives entirely in Supportly's own tables.
            // Fall through to the standard reply-creation logic below.
          }

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
              // A customer reply wakes a snoozed conversation back up --
              // the whole point of snoozing is "nothing to do until they
              // respond", so a response ends that by definition.
              snoozedUntil: sender === "SHOP" ? null : undefined,
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
