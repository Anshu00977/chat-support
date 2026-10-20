import { Router } from "express";
import { ADMINS_ROOM, SocketEvents, conversationRoom } from "@chat-support/shared";
import { prisma } from "../prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { matchBotKeyword } from "../services/bot.service";
import { notifyAdminsNeedsHuman } from "../services/mail.service";
import { getIO } from "../socket/ioInstance";
import { setWishkeeperThreadClosed } from "../services/wishkeeper.service";

export const messagesRouter = Router();

const FALLBACK_REPLY =
  "Thanks for reaching out! Our team couldn't auto-answer that, but a human will get back to you shortly.";

const replyInclude = {
  replies: { orderBy: { createdAt: "asc" as const } },
};

/**
 * Public endpoint the widget calls to start a conversation. Runs the
 * rule-based FAQ bot against the message body; on a match the customer
 * gets an instant answer, otherwise admins are emailed that a human is
 * needed. The full message + any bot reply is returned in the response so
 * the widget can render it immediately, before it even joins the socket room.
 */
messagesRouter.post("/", async (req, res) => {
  const { shop, name, email, subject, body, visitorId } = req.body as {
    shop?: string;
    name?: string;
    email?: string;
    subject?: string;
    body?: string;
    visitorId?: string;
  };

  if (!shop || !body?.trim() || !visitorId) {
    return res.status(400).json({ error: "shop, body and visitorId are required" });
  }

  const app = await prisma.shopifyApp.findUnique({ where: { shop } });
  if (!app) return res.status(404).json({ error: "Unknown shop" });

  const botAnswer = await matchBotKeyword(app.id, body);

  const message = await prisma.message.create({
    data: {
      appId: app.id,
      shop,
      visitorId,
      name,
      email,
      subject,
      body,
      status: botAnswer ? "BOT_HANDLED" : "NEEDS_HUMAN",
    },
  });

  // Only a real keyword match is worth keeping in the thread -- the generic
  // "couldn't auto-answer" placeholder is just UI reassurance for whoever's
  // waiting on the widget, not a message an admin needs to see repeated in
  // their inbox every time. Built but not persisted when there's no match,
  // so it's never part of what the dashboard loads for this conversation.
  const reply = botAnswer
    ? await prisma.messageReply.create({ data: { messageId: message.id, sender: "BOT", body: botAnswer } })
    : { id: -1, messageId: message.id, sender: "BOT" as const, body: FALLBACK_REPLY, adminId: null, adminName: null, attachments: null, externalId: null, createdAt: new Date() };

  if (!botAnswer) {
    void notifyAdminsNeedsHuman({ messageId: message.id, shop, name: name ?? null, email: email ?? null, body });
  }

  getIO().to(ADMINS_ROOM).emit(SocketEvents.NEW_CONVERSATION, { message: { ...message, replies: botAnswer ? [reply] : [] } });

  res.status(201).json({ message: { ...message, replies: [reply] } });
});

/** Widget re-hydration on return visits — scoped to the visitor that owns the conversation. */
messagesRouter.get("/:id/history", async (req, res) => {
  const id = Number(req.params.id);
  const { visitorId } = req.query as { visitorId?: string };
  if (!visitorId) return res.status(400).json({ error: "visitorId is required" });

  const message = await prisma.message.findFirst({
    where: { id, visitorId, source: "WIDGET" },
    include: replyInclude,
  });
  if (!message) return res.status(404).json({ error: "Conversation not found" });

  res.json({ message });
});

/** Lets the customer end their own conversation from the widget — scoped to the visitor that owns it. */
messagesRouter.post("/:id/close-by-visitor", async (req, res) => {
  const id = Number(req.params.id);
  const { visitorId } = req.body as { visitorId?: string };
  if (!visitorId) return res.status(400).json({ error: "visitorId is required" });

  const message = await prisma.message.findFirst({ where: { id, visitorId, source: "WIDGET" } });
  if (!message) return res.status(404).json({ error: "Conversation not found" });

  const updated = await prisma.message.update({ where: { id }, data: { status: "CLOSED" } });
  getIO().to(conversationRoom(id)).emit(SocketEvents.CONVERSATION_CLOSED, { conversationId: id });

  res.json({ message: updated });
});

// --- Everything below is for the admin dashboard ---
messagesRouter.use(requireAuth);

messagesRouter.get("/", async (req, res) => {
  const { appId, status, mine, source, search, archived } = req.query as {
    appId?: string;
    status?: string;
    mine?: string;
    source?: string;
    search?: string;
    archived?: string;
  };

  const term = search?.trim();

  const messages = await prisma.message.findMany({
    where: {
      // Archived conversations are hidden from every normal view -- only
      // the explicit ?archived=true request (the dashboard's Archived
      // filter) shows them, same idea as an email client's Archive folder.
      archived: archived === "true",
      appId: appId ? Number(appId) : undefined,
      status: status ? (status as any) : undefined,
      assignedAdminId: mine === "true" ? req.admin!.id : undefined,
      source: source === "WIDGET" || source === "WISHKEEPER" ? source : undefined,
      ...(term
        ? {
            OR: [
              { name: { contains: term } },
              { email: { contains: term } },
              { shop: { contains: term } },
              { body: { contains: term } },
            ],
          }
        : {}),
    },
    include: {
      assignedAdmin: { select: { id: true, name: true } },
      replies: { orderBy: { createdAt: "desc" as const }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });

  res.json({ messages });
});

messagesRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const message = await prisma.message.findUnique({
    where: { id },
    include: { ...replyInclude, assignedAdmin: { select: { id: true, name: true } } },
  });
  if (!message) return res.status(404).json({ error: "Conversation not found" });
  res.json({ message });
});

messagesRouter.post("/:id/claim", async (req, res) => {
  const id = Number(req.params.id);
  const message = await prisma.message.findUnique({ where: { id } });
  if (!message) return res.status(404).json({ error: "Conversation not found" });
  if (message.assignedAdminId && message.assignedAdminId !== req.admin!.id) {
    return res.status(409).json({ error: "Already claimed by another admin" });
  }

  const updated = await prisma.message.update({
    where: { id },
    data: { assignedAdminId: req.admin!.id, status: "CLAIMED" },
    include: { assignedAdmin: { select: { id: true, name: true } } },
  });

  getIO().to(conversationRoom(id)).emit(SocketEvents.CONVERSATION_CLAIMED, {
    conversationId: id,
    admin: updated.assignedAdmin,
  });

  res.json({ message: updated });
});

messagesRouter.post("/:id/transfer", async (req, res) => {
  const id = Number(req.params.id);
  const { adminId } = req.body as { adminId?: number };
  if (!adminId) return res.status(400).json({ error: "adminId is required" });

  const message = await prisma.message.findUnique({ where: { id } });
  if (!message) return res.status(404).json({ error: "Conversation not found" });
  if (message.assignedAdminId && message.assignedAdminId !== req.admin!.id && req.admin!.role !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "Only the assigned admin or a super admin can transfer this conversation" });
  }

  const target = await prisma.admin.findUnique({ where: { id: adminId } });
  if (!target || !target.active) return res.status(400).json({ error: "Target admin not found or inactive" });

  const updated = await prisma.message.update({
    where: { id },
    data: { assignedAdminId: adminId, status: "CLAIMED" },
    include: { assignedAdmin: { select: { id: true, name: true } } },
  });

  getIO().to(conversationRoom(id)).emit(SocketEvents.CONVERSATION_TRANSFERRED, {
    conversationId: id,
    admin: updated.assignedAdmin,
  });

  res.json({ message: updated });
});

messagesRouter.post("/:id/close", async (req, res) => {
  const id = Number(req.params.id);
  const updated = await prisma.message.update({ where: { id }, data: { status: "CLOSED" } });

  getIO().to(conversationRoom(id)).emit(SocketEvents.CONVERSATION_CLOSED, { conversationId: id });

  if (updated.source === "WISHKEEPER") {
    void setWishkeeperThreadClosed(updated.shop, true);
  }

  res.json({ message: updated });
});

messagesRouter.post("/:id/archive", async (req, res) => {
  const id = Number(req.params.id);
  const updated = await prisma.message.update({ where: { id }, data: { archived: true } });
  getIO().to(ADMINS_ROOM).emit(SocketEvents.CONVERSATION_ARCHIVED, { conversationId: id });
  res.json({ message: updated });
});

messagesRouter.post("/:id/unarchive", async (req, res) => {
  const id = Number(req.params.id);
  const updated = await prisma.message.update({ where: { id }, data: { archived: false } });
  res.json({ message: updated });
});

// Permanent -- gated to super admins, same bar as the other destructive
// actions in this app (e.g. removing an app's ScriptTag). For a
// WISHKEEPER-sourced conversation this only deletes Supportly's own mirror;
// the real history still lives in WishKeeper's own database and can
// resurface on a future sync, which the dashboard copy explains.
messagesRouter.delete("/:id", requireRole("SUPER_ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const message = await prisma.message.findUnique({ where: { id } });
  if (!message) return res.status(404).json({ error: "Conversation not found" });

  await prisma.message.delete({ where: { id } });
  getIO().to(ADMINS_ROOM).emit(SocketEvents.CONVERSATION_DELETED, { conversationId: id });
  res.status(204).send();
});
