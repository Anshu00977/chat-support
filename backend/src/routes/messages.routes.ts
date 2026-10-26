import { Router } from "express";
import { ADMINS_ROOM, SocketEvents, conversationRoom } from "@chat-support/shared";
import { prisma } from "../prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { notifyAdminsNeedsHuman } from "../services/mail.service";
import { getIO } from "../socket/ioInstance";
import { setWishkeeperThreadClosed } from "../services/wishkeeper.service";
import { setEmbeddedThreadClosed } from "../services/embeddedChat.service";

export const messagesRouter = Router();

// Shown instantly to every new conversation -- there's no FAQ bot anymore,
// so this always applies rather than only on a missed keyword match.
const FALLBACK_REPLY = "Thanks for reaching out! A human will get back to you shortly.";

const replyInclude = {
  replies: { orderBy: { createdAt: "asc" as const } },
};

/**
 * Public endpoint the widget calls to start a conversation. Always needs a
 * human -- there's no auto-answering bot -- so admins are emailed right
 * away and the customer sees an instant "a human will get back to you"
 * placeholder reply while they wait, built but not persisted (it's UI
 * reassurance for the widget, not something an admin needs in their inbox).
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

  const message = await prisma.message.create({
    data: { appId: app.id, shop, visitorId, name, email, subject, body, status: "NEEDS_HUMAN" },
  });

  const reply = {
    id: -1,
    messageId: message.id,
    sender: "BOT" as const,
    body: FALLBACK_REPLY,
    adminId: null,
    adminName: null,
    attachments: null,
    externalId: null,
    createdAt: new Date(),
  };

  void notifyAdminsNeedsHuman({ messageId: message.id, shop, name: name ?? null, email: email ?? null, body });

  getIO().to(ADMINS_ROOM).emit(SocketEvents.NEW_CONVERSATION, { message: { ...message, replies: [] } });

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

/** One-time customer satisfaction rating, prompted by the widget once a conversation closes. */
messagesRouter.post("/:id/csat", async (req, res) => {
  const id = Number(req.params.id);
  const { visitorId, score } = req.body as { visitorId?: string; score?: number };
  if (!visitorId) return res.status(400).json({ error: "visitorId is required" });
  if (!score || score < 1 || score > 5) return res.status(400).json({ error: "score must be 1-5" });

  const message = await prisma.message.findFirst({ where: { id, visitorId, source: "WIDGET" } });
  if (!message) return res.status(404).json({ error: "Conversation not found" });
  if (message.csatSubmittedAt) return res.status(409).json({ error: "Rating already submitted" });

  const updated = await prisma.message.update({
    where: { id },
    data: { csatScore: score, csatSubmittedAt: new Date() },
  });
  getIO().to(ADMINS_ROOM).emit(SocketEvents.CSAT_SUBMITTED, { conversationId: id, score });

  res.json({ message: updated });
});

// --- Everything below is for the admin dashboard ---
messagesRouter.use(requireAuth);

messagesRouter.get("/", async (req, res) => {
  const { appId, embeddedAppId, status, mine, source, search, shop, archived, starred, snoozed } = req.query as {
    appId?: string;
    embeddedAppId?: string;
    status?: string;
    mine?: string;
    source?: string;
    search?: string;
    shop?: string;
    archived?: string;
    starred?: string;
    snoozed?: string;
  };

  const term = search?.trim();
  const shopTerm = shop?.trim();
  const now = new Date();

  // "Ongoing" bundles OPEN and CLAIMED into one Inbox tab, since both just
  // mean "not waiting on a human and not closed" from a glance-view's
  // perspective -- everything else is still a single exact status.
  const statusFilter =
    status === "ONGOING" ? { in: ["OPEN", "CLAIMED"] as const } : status ? (status as any) : undefined;

  const messages = await prisma.message.findMany({
    where: {
      // Archived conversations are hidden from every normal view -- only
      // the explicit ?archived=true request (the dashboard's Archived
      // filter) shows them, same idea as an email client's Archive folder.
      archived: archived === "true",
      starred: starred === "true" ? true : undefined,
      appId: appId ? Number(appId) : undefined,
      embeddedAppId: embeddedAppId ? Number(embeddedAppId) : undefined,
      status: statusFilter,
      assignedAdminId: mine === "true" ? req.admin!.id : undefined,
      source: source === "WIDGET" || source === "WISHKEEPER" || source === "EMBEDDED" ? source : undefined,
      // Each OR-based condition goes in its own AND slot -- a search term
      // and the snooze exclusion both need their own OR, and two top-level
      // OR keys on the same object would just silently overwrite each other.
      AND: [
        // Snoozed conversations are hidden from the default view until
        // their wake time passes -- ?snoozed=true shows only the ones
        // still waiting, for the Snoozed filter.
        snoozed === "true" ? { snoozedUntil: { gt: now } } : { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
        // Separate from the app/shop filters above -- this is the free-text
        // search box, which still matches across name/email/shop/body.
        term
          ? {
              OR: [
                { name: { contains: term } },
                { email: { contains: term } },
                { shop: { contains: term } },
                { body: { contains: term } },
              ],
            }
          : {},
        shopTerm ? { shop: { contains: shopTerm } } : {},
      ],
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

  const io = getIO();
  io.to(conversationRoom(id)).emit(SocketEvents.CONVERSATION_CLAIMED, {
    conversationId: id,
    admin: updated.assignedAdmin,
  });

  // Lets the customer/merchant's own widget show a "connected" notice the
  // instant an admin accepts, same as any other message in the thread.
  const systemReply = await prisma.messageReply.create({
    data: { messageId: id, sender: "SYSTEM", body: "Admin is connected" },
  });
  io.to([conversationRoom(id), ADMINS_ROOM]).emit(SocketEvents.MESSAGE_RECEIVED, systemReply);

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
  } else if (updated.source === "EMBEDDED") {
    void setEmbeddedThreadClosed(updated, true);
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

messagesRouter.post("/:id/star", async (req, res) => {
  const id = Number(req.params.id);
  const updated = await prisma.message.update({ where: { id }, data: { starred: true } });
  res.json({ message: updated });
});

messagesRouter.post("/:id/unstar", async (req, res) => {
  const id = Number(req.params.id);
  const updated = await prisma.message.update({ where: { id }, data: { starred: false } });
  res.json({ message: updated });
});

// Hides the conversation from the default inbox until `until`, or until the
// customer replies again (whichever comes first -- see the SHOP-sender
// branch in socket/index.ts and ingestWishkeeperMessage, both of which clear
// snoozedUntil on an inbound customer/merchant message).
messagesRouter.post("/:id/snooze", async (req, res) => {
  const id = Number(req.params.id);
  const { until } = req.body as { until?: string };
  const date = until ? new Date(until) : null;
  if (!date || Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    return res.status(400).json({ error: "until must be a valid future date" });
  }
  const updated = await prisma.message.update({ where: { id }, data: { snoozedUntil: date } });
  getIO().to(ADMINS_ROOM).emit(SocketEvents.CONVERSATION_ARCHIVED, { conversationId: id }); // reuses the same "remove from view" refresh signal
  res.json({ message: updated });
});

messagesRouter.post("/:id/unsnooze", async (req, res) => {
  const id = Number(req.params.id);
  const updated = await prisma.message.update({ where: { id }, data: { snoozedUntil: null } });
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
