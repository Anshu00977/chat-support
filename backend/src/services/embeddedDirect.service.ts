import { ADMINS_ROOM, SocketEvents, conversationRoom, type Attachment } from "@chat-support/shared";
import { prisma } from "../prisma";
import { getIO } from "../socket/ioInstance";
import { broadcastTyping } from "../socket/typing";
import { notifyAdminsNeedsHuman } from "./mail.service";

/**
 * DB-less path for the generic embedded-chat integration: for an app with
 * no databaseUrl (see EmbeddedApp in schema.prisma), the conversation lives
 * entirely in Supportly's own Message/MessageReply rows -- nothing is
 * mirrored into (or read from) a database the connected app owns. Its
 * widget talks straight to these functions via the /embedded/thread/*
 * routes, instead of polling its own local tables.
 */

interface DirectApp {
  id: number;
  name: string;
}

const AUTO_REPLY_TEXT =
  "Thanks for reaching out! A support agent will be with you shortly -- feel free to add more detail in the meantime.";

function prettyShopName(shop: string) {
  const base = shop.replace(/\.myshopify\.com$/, "");
  return base
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

async function findOrCreateDirectConversation(app: DirectApp, shop: string) {
  const existing = await prisma.message.findFirst({ where: { source: "EMBEDDED", embeddedAppId: app.id, shop } });
  if (existing) return { conversation: existing, isNew: false };

  const conversation = await prisma.message.create({
    data: {
      source: "EMBEDDED",
      embeddedAppId: app.id,
      shop,
      visitorId: `embedded-direct:${app.id}:${shop}`,
      name: `${prettyShopName(shop)} (${app.name})`,
      body: "(new conversation)",
      status: "NEEDS_HUMAN",
    },
  });
  return { conversation, isNew: true };
}

function toWidgetMessage(r: { id: number; sender: string; body: string; attachments: unknown; createdAt: Date }) {
  const attachment = Array.isArray(r.attachments) ? (r.attachments[0] as Attachment | undefined) : undefined;
  return {
    id: String(r.id),
    sender: r.sender === "SHOP" ? "shop" : "admin",
    body: r.body || null,
    attachmentUrl: attachment?.url ?? null,
    attachmentName: attachment?.name ?? null,
    attachmentType: attachment?.mimetype ?? null,
    createdAt: r.createdAt,
  };
}

export async function getDirectThread(app: DirectApp, shop: string) {
  const { conversation } = await findOrCreateDirectConversation(app, shop);
  const replies = await prisma.messageReply.findMany({
    where: {
      messageId: conversation.id,
      internal: false,
      ...(conversation.embeddedResetAt ? { createdAt: { gt: conversation.embeddedResetAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  return {
    thread: {
      closedAt: conversation.status === "CLOSED" ? conversation.updatedAt : null,
      adminTypingAt: conversation.adminTypingAt,
    },
    messages: replies.map(toWidgetMessage),
  };
}

export async function sendDirectMessage(app: DirectApp, shop: string, body: string, attachment: Attachment | null) {
  const { conversation, isNew } = await findOrCreateDirectConversation(app, shop);
  if (conversation.status === "CLOSED") throw new Error("This conversation is closed.");

  const isConversationStart =
    isNew ||
    (await prisma.messageReply.count({
      where: {
        messageId: conversation.id,
        internal: false,
        ...(conversation.embeddedResetAt ? { createdAt: { gt: conversation.embeddedResetAt } } : {}),
      },
    })) === 0;

  const reply = await prisma.messageReply.create({
    data: {
      messageId: conversation.id,
      sender: "SHOP",
      body,
      attachments: attachment ? ([attachment] as unknown as object[]) : undefined,
    },
  });

  const updated = await prisma.message.update({
    where: { id: conversation.id },
    data: { status: conversation.assignedAdminId ? "CLAIMED" : "NEEDS_HUMAN", updatedAt: new Date() },
  });

  const io = getIO();
  if (isNew) io.to(ADMINS_ROOM).emit(SocketEvents.NEW_CONVERSATION, { message: { ...updated, replies: [reply] } });
  io.to([conversationRoom(conversation.id), ADMINS_ROOM]).emit(SocketEvents.MESSAGE_RECEIVED, reply);

  let autoReply = null;
  if (isConversationStart) {
    void notifyAdminsNeedsHuman({
      messageId: conversation.id,
      shop,
      name: shop,
      email: null,
      body,
      intro: `A merchant on ${app.name} (${shop}) sent a support message.`,
    });

    autoReply = await prisma.messageReply.create({
      data: { messageId: conversation.id, sender: "BOT", body: AUTO_REPLY_TEXT },
    });
    io.to([conversationRoom(conversation.id), ADMINS_ROOM]).emit(SocketEvents.MESSAGE_RECEIVED, autoReply);
  }

  return toWidgetMessage(reply);
}

export async function closeDirectThread(app: DirectApp, shop: string) {
  const { conversation } = await findOrCreateDirectConversation(app, shop);
  await prisma.message.update({ where: { id: conversation.id }, data: { status: "CLOSED" } });
  getIO().to(conversationRoom(conversation.id)).emit(SocketEvents.CONVERSATION_CLOSED, { conversationId: conversation.id });
}

export async function reopenDirectThread(app: DirectApp, shop: string) {
  const { conversation } = await findOrCreateDirectConversation(app, shop);
  const reply = await prisma.messageReply.create({
    data: { messageId: conversation.id, sender: "SYSTEM", body: "Merchant started a new conversation" },
  });
  await prisma.message.update({
    where: { id: conversation.id },
    data: { status: "NEEDS_HUMAN", embeddedResetAt: new Date(), updatedAt: new Date() },
  });
  getIO().to([conversationRoom(conversation.id), ADMINS_ROOM]).emit(SocketEvents.MESSAGE_RECEIVED, reply);
}

export async function forwardDirectTyping(app: DirectApp, shop: string) {
  const { conversation } = await findOrCreateDirectConversation(app, shop);
  broadcastTyping(getIO(), conversation.id, "SHOP");
}

/** Admin -> merchant direction, called from forwardEmbeddedTyping when the app has no database of its own. */
export async function setDirectAdminTyping(conversationId: number) {
  await prisma.message.update({ where: { id: conversationId }, data: { adminTypingAt: new Date() } });
}
