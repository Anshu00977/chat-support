import { Router, type NextFunction, type Request, type Response } from "express";
import { env } from "../config/env";
import { broadcastTyping } from "../socket/typing";
import { getIO } from "../socket/ioInstance";
import {
  findWishkeeperConversationId,
  getWishkeeperAppUrl,
  ingestWishkeeperMessage,
  recordWishkeeperReset,
  setWishkeeperAppUrl,
  wishkeeperEnabled,
  type WkMessage,
} from "../services/wishkeeper.service";

/**
 * Endpoints the WishKeeper Shopify app calls — the same contract its old
 * standalone admin dashboard exposed, so pointing WishKeeper's
 * ADMIN_DASHBOARD_URL at this backend is the only change needed on its side.
 * See wishkeeper.service.ts for the full picture.
 */
export const wishkeeperRouter = Router();

function requireInternalSecret(req: Request, res: Response, next: NextFunction) {
  if (!wishkeeperEnabled || req.headers["x-internal-secret"] !== env.wishkeeper.internalSecret) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// Merchant sent a message, is typing, or opened their chat ("seen").
wishkeeperRouter.post("/internal/notify", requireInternalSecret, async (req, res) => {
  const { shop, message, type } = (req.body ?? {}) as { shop?: string; message?: WkMessage; type?: string };
  if (!shop) return res.status(400).json({ error: "Missing shop" });

  if (message?.id && message.threadId) {
    await ingestWishkeeperMessage(shop, message, { live: true });
  } else if (type === "typing") {
    const conversationId = await findWishkeeperConversationId(shop);
    if (conversationId) broadcastTyping(getIO(), conversationId, "SHOP");
  } else if (type === "reset") {
    await recordWishkeeperReset(shop);
  }
  // "seen" (merchant opened the widget) has no dashboard UI yet — accepted and ignored.

  res.json({ ok: true });
});

// WishKeeper's dev server announcing its current (random) local port.
wishkeeperRouter.post("/internal/register-url", requireInternalSecret, (req, res) => {
  const { url } = (req.body ?? {}) as { url?: string };
  if (typeof url === "string" && /^https?:\/\//.test(url) && url.replace(/\/$/, "") !== getWishkeeperAppUrl()) {
    setWishkeeperAppUrl(url);
    console.log("WishKeeper app URL updated to:", getWishkeeperAppUrl());
  }
  res.json({ ok: true });
});

// Stable link for merchant attachments, which live on the WishKeeper app at a
// URL that can change (see wkAttachmentToAttachment in wishkeeper.service.ts).
const SAFE_SEGMENT = /^[\w.-]+$/;
wishkeeperRouter.get("/wishkeeper-files/:threadId/:file", (req, res) => {
  const { threadId, file } = req.params;
  const appUrl = getWishkeeperAppUrl();
  if (!appUrl || !SAFE_SEGMENT.test(threadId) || !SAFE_SEGMENT.test(file)) {
    return res.status(404).send("Not found");
  }
  res.redirect(302, `${appUrl}/uploads/support/${threadId}/${file}`);
});
