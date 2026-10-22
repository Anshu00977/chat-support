import { Router } from "express";
import { prisma } from "../prisma";
import { broadcastTyping } from "../socket/typing";
import { getIO } from "../socket/ioInstance";
import {
  findEmbeddedConversationId,
  getEmbeddedAppUrl,
  ingestEmbeddedMessage,
  recordEmbeddedReset,
  setEmbeddedAppUrl,
  verifyEmbeddedSecret,
  type EmbeddedMessage,
} from "../services/embeddedChat.service";

/**
 * Generic version of wishkeeper.routes.ts -- same contract, but the secret
 * is verified per-app (looked up by the shop in the request body) instead
 * of a single shared one, since any number of apps can be connected here.
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

  const app = await verifyEmbeddedSecret(shop, req.headers["x-internal-secret"] as string | undefined);
  if (!app) return res.status(403).json({ error: "Forbidden" });

  if (message?.id && message.threadId) {
    await ingestEmbeddedMessage(app, message, { live: true });
  } else if (type === "typing") {
    const conversationId = await findEmbeddedConversationId(shop);
    if (conversationId) broadcastTyping(getIO(), conversationId, "SHOP");
  } else if (type === "reset") {
    await recordEmbeddedReset(shop);
  }
  // "seen" (merchant opened the widget) has no dashboard UI yet — accepted and ignored.

  res.json({ ok: true });
});

// A connected app's dev server announcing its current (random) local port.
embeddedChatRouter.post("/embedded/internal/register-url", async (req, res) => {
  const { shop, url } = (req.body ?? {}) as { shop?: string; url?: string };
  if (!shop) return res.status(400).json({ error: "Missing shop" });

  const app = await verifyEmbeddedSecret(shop, req.headers["x-internal-secret"] as string | undefined);
  if (!app) return res.status(403).json({ error: "Forbidden" });

  if (typeof url === "string" && /^https?:\/\//.test(url)) {
    await setEmbeddedAppUrl(shop, url);
  }
  res.json({ ok: true });
});

// Stable link for merchant attachments, which live on the connected app at a
// URL that can change (see attachmentToAttachment in embeddedChat.service.ts).
const SAFE_SEGMENT = /^[\w.-]+$/;
embeddedChatRouter.get("/embedded-files/:appId/:threadId/:file", async (req, res) => {
  const { appId, threadId, file } = req.params;
  if (!SAFE_SEGMENT.test(threadId) || !SAFE_SEGMENT.test(file)) return res.status(404).send("Not found");

  const app = await prisma.embeddedApp.findUnique({ where: { id: Number(appId) }, select: { shop: true } });
  if (!app) return res.status(404).send("Not found");
  const appUrl = await getEmbeddedAppUrl(app.shop);
  if (!appUrl) return res.status(404).send("Not found");

  res.redirect(302, `${appUrl}/uploads/support/${threadId}/${file}`);
});
