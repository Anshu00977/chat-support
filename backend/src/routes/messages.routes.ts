import { Router } from "express";
import { ADMINS_ROOM, SocketEvents, conversationRoom } from "@chat-support/shared";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { matchBotKeyword } from "../services/bot.service";
import { notifyAdminsNeedsHuman } from "../services/mail.service";
import { getIO } from "../socket/ioInstance";

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

  const reply = await prisma.messageReply.create({
    data: {
      messageId: message.id,
      sender: "BOT",
      body: botAnswer ?? FALLBACK_REPLY,
    },
  });

  if (!botAnswer) {
    void notifyAdminsNeedsHuman({ messageId: message.id, shop, name: name ?? null, email: email ?? null, body });
  }

  getIO().to(ADMINS_ROOM).emit(SocketEvents.NEW_CONVERSATION, { message: { ...message, replies: [reply] } });

  res.status(201).json({ message: { ...message, replies: [reply] } });
});

/** Widget re-hydration on return visits — scoped to the visitor that owns the conversation. */
messagesRouter.get("/:id/history", async (req, res) => {
  const id = Number(req.params.id);
  const { visitorId } = req.query as { visitorId?: string };
  if (!visitorId) return res.status(400).json({ error: "visitorId is required" });

  const message = await prisma.message.findFirst({
    where: { id, visitorId },
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

  const message = await prisma.message.findFirst({ where: { id, visitorId } });
  if (!message) return res.status(404).json({ error: "Conversation not found" });

  const updated = await prisma.message.update({ where: { id }, data: { status: "CLOSED" } });
  getIO().to(conversationRoom(id)).emit(SocketEvents.CONVERSATION_CLOSED, { conversationId: id });

  res.json({ message: updated });
});

// --- Everything below is for the admin dashboard ---
messagesRouter.use(requireAuth);

messagesRouter.get("/", async (req, res) => {
  const { appId, status, mine } = req.query as { appId?: string; status?: string; mine?: string };

  const messages = await prisma.message.findMany({
    where: {
      appId: appId ? Number(appId) : undefined,
      status: status ? (status as any) : undefined,
      assignedAdminId: mine === "true" ? req.admin!.id : undefined,
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

  res.json({ message: updated });
});
