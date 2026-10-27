import { Router } from "express";
import { prisma } from "../prisma";
import { ADMINS_ROOM, SocketEvents, conversationRoom } from "@chat-support/shared";
import { broadcastTyping } from "../socket/typing";
import { getIO } from "../socket/ioInstance";
import {
  findEmbeddedConversationId,
  ingestEmbeddedMessage,
  recordEmbeddedReset,
  setEmbeddedAppUrl,
  verifyEmbeddedSecret,
  type EmbeddedMessage,
} from "../services/embeddedChat.service";

/**
 * Generic version of wishkeeper.routes.ts -- same contract, but the secret
 * identifies which APP this is (not which shop), since any number of shops
 * can share one connected app here.
 */
export const embeddedChatRouter = Router();

// Distinct path prefix from wishkeeper.routes.ts's /internal/* -- that
// router is mounted first and always responds (even 403) rather than
// falling through, so sharing a path would mean a non-WishKeeper app's
// request never reaches this router at all.

// Merchant sent a message, is typing, opened their chat ("seen"), or started a new one ("reset").
embeddedChatRouter.post("/embedded/internal/notify", async (req, res) => {
  const { shop, message, type } = (req.body ?? {}) as { shop?: string; message?: EmbeddedMessage; type?: string };
  if (!shop) return res.status(400).json({ error: "Missing shop" });

  const app = await verifyEmbeddedSecret(req.headers["x-internal-secret"] as string | undefined);
  if (!app) return res.status(403).json({ error: "Forbidden" });

  if (message?.id && message.threadId) {
    await ingestEmbeddedMessage(app, shop, message, { live: true });
  } else if (type === "typing") {
    // Filter by app.id so a store with multiple apps doesn't target the wrong conversation.
    const conv = await prisma.message.findFirst({ where: { source: "EMBEDDED", embeddedAppId: app.id, shop }, select: { id: true } });
    if (conv) broadcastTyping(getIO(), conv.id, "SHOP");
  } else if (type === "reset") {
    await recordEmbeddedReset(shop, app.id);
  } else if (type === "closed") {
    const conv = await prisma.message.findFirst({ where: { source: "EMBEDDED", embeddedAppId: app.id, shop }, select: { id: true } });
    if (conv) {
      await prisma.message.update({ where: { id: conv.id }, data: { status: "CLOSED" } });
      getIO().to([conversationRoom(conv.id), ADMINS_ROOM]).emit(SocketEvents.CONVERSATION_CLOSED, { conversationId: conv.id });
    }
  }
  // "seen" (merchant opened the widget) has no dashboard UI yet — accepted and ignored.

  res.json({ ok: true });
});

// A connected app's dev server announcing its current (random) local port.
embeddedChatRouter.post("/embedded/internal/register-url", async (req, res) => {
  const { url } = (req.body ?? {}) as { url?: string };

  const app = await verifyEmbeddedSecret(req.headers["x-internal-secret"] as string | undefined);
  if (!app) return res.status(403).json({ error: "Forbidden" });

  if (typeof url === "string" && /^https?:\/\//.test(url)) {
    await setEmbeddedAppUrl(app, url);
  }
  res.json({ ok: true });
});

// Stable link for merchant attachments, which live on the connected app at a
// URL that can change (see attachmentToAttachment in embeddedChat.service.ts).
const SAFE_SEGMENT = /^[\w.-]+$/;
embeddedChatRouter.get("/embedded-files/:appId/:threadId/:file", async (req, res) => {
  const { appId, threadId, file } = req.params;
  if (!SAFE_SEGMENT.test(threadId) || !SAFE_SEGMENT.test(file)) return res.status(404).send("Not found");

  const app = await prisma.embeddedApp.findUnique({ where: { id: Number(appId) }, select: { appUrl: true } });
  if (!app) return res.status(404).send("Not found");

  res.redirect(302, `${app.appUrl}/uploads/support/${threadId}/${file}`);
});
