import crypto from "crypto";
import { Prisma, PrismaClient, type MessageReply } from "@prisma/client";
import { ADMINS_ROOM, SocketEvents, conversationRoom, type Attachment } from "@chat-support/shared";
import { env } from "../config/env";
import { prisma } from "../prisma";
import { getIO } from "../socket/ioInstance";
import { notifyAdminsNeedsHuman } from "./mail.service";

/**
 * WishKeeper merchant support chat integration.
 *
 * The WishKeeper Shopify app has its own in-admin chat widget for merchants,
 * storing messages in its own MySQL tables (SupportThread / SupportMessage)
 * and talking to "the admin dashboard" over a small HTTP contract guarded by
 * a shared secret. This backend takes over that dashboard role, unchanged on
 * the WishKeeper side:
 *
 *  - WishKeeper -> us:  POST /internal/notify  { shop, message } | { shop, type: "typing" | "seen" }
 *                       POST /internal/register-url { url }  (its dev server announcing its random port)
 *  - us -> WishKeeper:  admin replies are INSERTed into its SupportMessage table (it has no write
 *                       endpoint of its own), then pushed live to the merchant's open widget via
 *                       POST {WISHKEEPER_APP_URL}/app/support/internal-notify.
 *
 * Each WishKeeper SupportThread is mirrored as one Message (source WISHKEEPER) here so it shows up
 * in the normal inbox with claim/transfer/close, and each SupportMessage as one MessageReply,
 * de-duplicated by externalId.
 */

export const wishkeeperEnabled = Boolean(env.wishkeeper.databaseUrl && env.wishkeeper.internalSecret);

// Raw-SQL-only client pointed at WishKeeper's database. The generated models
// belong to *our* schema, so only $queryRaw / $executeRaw are used on it.
const wkDb = wishkeeperEnabled ? new PrismaClient({ datasourceUrl: env.wishkeeper.databaseUrl }) : null;

let wishkeeperAppUrl = env.wishkeeper.appUrl;

export function getWishkeeperAppUrl() {
  return wishkeeperAppUrl;
}

export function setWishkeeperAppUrl(url: string) {
  wishkeeperAppUrl = url.replace(/\/$/, "");
}

/** A WishKeeper SupportMessage row, as stored in its DB and sent in its notify payloads. */
export interface WkMessage {
  id: string;
  threadId: string;
  sender: string; // "shop" | "admin"
  body: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  attachmentSize: number | null;
  createdAt: string | Date;
}

const WK_VARCHAR_MAX = 191;

/**
 * Merchant attachments live on the WishKeeper app at /uploads/support/<thread>/<file>.
 * They're linked through our /wishkeeper-files redirect rather than stored as an
 * absolute WishKeeper URL, since that URL changes on every local dev restart.
 * Anything else that's relative (e.g. "/uploads/<thread>/<file>" from the old
 * standalone dashboard) is assumed to be served from our own /uploads.
 */
function wkAttachmentToAttachment(m: WkMessage): Attachment[] | null {
  if (!m.attachmentUrl) return null;
  let url = m.attachmentUrl;
  if (url.startsWith("/uploads/support/")) {
    url = `${env.backendPublicUrl}/wishkeeper-files/${url.slice("/uploads/support/".length)}`;
  } else if (url.startsWith("/")) {
    url = `${env.backendPublicUrl}${url}`;
  }
  return [
    {
      url,
      name: m.attachmentName ?? "Attachment",
      mimetype: m.attachmentType ?? "application/octet-stream",
      size: m.attachmentSize ?? 0,
    },
  ];
}

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** "convobridge.myshopify.com" -> "Convobridge" -- shown in the inbox instead of the raw domain. */
function prettyShopName(shop: string) {
  const base = shop.replace(/\.myshopify\.com$/, "");
  return base
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

async function findOrCreateConversation(shop: string, first: WkMessage) {
  const existing = await prisma.message.findUnique({ where: { externalThreadId: first.threadId } });
  if (existing) return { conversation: existing, isNew: false };

  try {
    const conversation = await prisma.message.create({
      data: {
        source: "WISHKEEPER",
        externalThreadId: first.threadId,
        shop,
        visitorId: `wishkeeper:${shop}`,
        name: prettyShopName(shop),
        body: first.body || first.attachmentName || "(attachment)",
        status: first.sender === "admin" ? "OPEN" : "NEEDS_HUMAN",
      },
    });
    return { conversation, isNew: true };
  } catch (err) {
    // Two notifications for a brand-new thread raced each other — use the winner's row.
    if (!isUniqueViolation(err)) throw err;
    const conversation = await prisma.message.findUniqueOrThrow({ where: { externalThreadId: first.threadId } });
    return { conversation, isNew: false };
  }
}

/**
 * Mirrors one WishKeeper message into our tables. Idempotent: a message that
 * was already ingested (by externalId) is skipped. With `live`, pushes it to
 * open dashboards and emails admins when a thread starts or is reopened.
 */
export async function ingestWishkeeperMessage(shop: string, wk: WkMessage, { live }: { live: boolean }) {
  if (await prisma.messageReply.findUnique({ where: { externalId: wk.id }, select: { id: true } })) return;

  const { conversation, isNew } = await findOrCreateConversation(shop, wk);
  const fromMerchant = wk.sender !== "admin";

  let reply: MessageReply;
  try {
    reply = await prisma.messageReply.create({
      data: {
        messageId: conversation.id,
        sender: fromMerchant ? "SHOP" : "ADMIN",
        adminName: fromMerchant ? null : env.wishkeeper.adminDisplayName,
        body: wk.body ?? "",
        attachments: (wkAttachmentToAttachment(wk) as unknown as Prisma.InputJsonValue) ?? undefined,
        externalId: wk.id,
        createdAt: new Date(wk.createdAt),
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return; // ingested concurrently
    throw err;
  }

  const reopened = !isNew && fromMerchant && conversation.status === "CLOSED";
  let status = conversation.status;
  if (!isNew && fromMerchant) {
    status = conversation.assignedAdminId && !reopened ? "CLAIMED" : "NEEDS_HUMAN";
  } else if (!isNew && conversation.status === "NEEDS_HUMAN" && !conversation.assignedAdminId) {
    status = "OPEN"; // answered (only reachable when backfilling replies sent from the old dashboard)
  }
  const updated = await prisma.message.update({
    where: { id: conversation.id },
    data: { status, updatedAt: new Date() },
  });

  if (!live) return;

  const io = getIO();
  if (isNew) {
    io.to(ADMINS_ROOM).emit(SocketEvents.NEW_CONVERSATION, { message: { ...updated, replies: [reply] } });
  }
  io.to([conversationRoom(conversation.id), ADMINS_ROOM]).emit(SocketEvents.MESSAGE_RECEIVED, reply);

  if (fromMerchant && (isNew || reopened)) {
    void notifyAdminsNeedsHuman({
      messageId: conversation.id,
      shop,
      name: shop,
      email: null,
      body: wk.body || `(sent an attachment: ${wk.attachmentName ?? "file"})`,
      intro: `A WishKeeper merchant (${shop}) sent a support message.`,
    });
  }
}

/**
 * Imports every WishKeeper message we don't have yet. Runs on boot so
 * anything sent while this backend was down (when WishKeeper's live notify
 * had nowhere to go) still lands in the inbox — and on first connection,
 * brings over the full history from the old standalone dashboard.
 */
export async function syncWishkeeperOnBoot() {
  if (!wkDb) return;

  const rows = await wkDb.$queryRaw<(WkMessage & { shop: string })[]>`
    SELECT m.id, m.threadId, m.sender, m.body, m.attachmentUrl, m.attachmentName,
           m.attachmentType, m.attachmentSize, m.createdAt, t.shop
    FROM SupportMessage m
    JOIN SupportThread t ON t.id = m.threadId
    ORDER BY m.createdAt ASC`;

  const known = new Set(
    (await prisma.messageReply.findMany({ where: { externalId: { not: null } }, select: { externalId: true } })).map(
      (r) => r.externalId
    )
  );

  let imported = 0;
  for (const row of rows) {
    if (known.has(row.id)) continue;
    await ingestWishkeeperMessage(row.shop, row, { live: false });
    imported++;
  }
  console.log(`WishKeeper support sync: ${imported} new message(s) imported (${rows.length} total).`);
}

/** Best-effort push to WishKeeper's widget channel; never throws. */
async function pushToWishkeeper(payload: Record<string, unknown>) {
  if (!wishkeeperAppUrl || !env.wishkeeper.internalSecret) return;
  try {
    const res = await fetch(`${wishkeeperAppUrl}/app/support/internal-notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": env.wishkeeper.internalSecret },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.warn(`WishKeeper internal-notify returned ${res.status}`);
  } catch (err) {
    console.warn("WishKeeper internal-notify failed:", err instanceof Error ? err.message : err);
  }
}

function absoluteUrl(url: string) {
  return url.startsWith("/") ? `${env.backendPublicUrl}${url}` : url;
}

/**
 * Sends an admin's reply to a WishKeeper merchant. WishKeeper messages hold at
 * most one attachment, so a reply with several becomes one message per
 * attachment (text on the first) — mirrored 1:1 as local replies so the
 * dashboard shows exactly what the merchant sees.
 */
export async function sendWishkeeperAdminReply(params: {
  conversation: { id: number; shop: string; externalThreadId: string | null };
  admin: { id: number; name: string | null };
  body: string;
  attachments: Attachment[];
}): Promise<MessageReply[]> {
  const { conversation, admin, attachments } = params;
  if (!wkDb) throw new Error("WishKeeper integration is not configured on this server");
  if (!conversation.externalThreadId) throw new Error("Conversation is not linked to a WishKeeper thread");
  const threadId = conversation.externalThreadId;

  const body = params.body.trim();
  const parts: { body: string | null; attachment: Attachment | null }[] = attachments.length
    ? attachments.map((a, i) => ({ body: i === 0 ? body || null : null, attachment: a }))
    : [{ body, attachment: null }];

  const baseTime = Date.now();
  const wkMessages: WkMessage[] = parts.map((p, i) => ({
    id: crypto.randomUUID(),
    threadId,
    sender: "admin",
    body: p.body,
    attachmentUrl: p.attachment ? absoluteUrl(p.attachment.url).slice(0, WK_VARCHAR_MAX) : null,
    attachmentName: p.attachment ? p.attachment.name.slice(0, WK_VARCHAR_MAX) : null,
    attachmentType: p.attachment?.mimetype ?? null,
    attachmentSize: p.attachment?.size ?? null,
    // Keep multi-part replies in order — WishKeeper sorts by createdAt.
    createdAt: new Date(baseTime + i),
  }));

  // Written to WishKeeper first: if that fails, nothing is recorded locally
  // and the admin sees the error, rather than a reply the merchant never gets.
  await wkDb.$transaction([
    ...wkMessages.map(
      (m) => wkDb.$executeRaw`
        INSERT INTO SupportMessage
          (id, threadId, sender, body, attachmentUrl, attachmentName, attachmentType, attachmentSize, createdAt)
        VALUES
          (${m.id}, ${m.threadId}, 'admin', ${m.body}, ${m.attachmentUrl}, ${m.attachmentName},
           ${m.attachmentType}, ${m.attachmentSize}, ${m.createdAt})`
    ),
    wkDb.$executeRaw`
      UPDATE SupportThread
      SET shopUnreadCount = shopUnreadCount + ${wkMessages.length}, updatedAt = ${new Date()}, closedAt = NULL
      WHERE id = ${threadId}`,
  ]);

  const replies: MessageReply[] = [];
  for (const [i, m] of wkMessages.entries()) {
    replies.push(
      await prisma.messageReply.create({
        data: {
          messageId: conversation.id,
          sender: "ADMIN",
          adminId: admin.id,
          adminName: admin.name,
          body: m.body ?? "",
          attachments: parts[i].attachment ? ([parts[i].attachment] as unknown as Prisma.InputJsonValue) : undefined,
          externalId: m.id,
          createdAt: m.createdAt as Date,
        },
      })
    );
  }
  await prisma.message.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });

  const io = getIO();
  for (const [i, reply] of replies.entries()) {
    io.to([conversationRoom(conversation.id), ADMINS_ROOM]).emit(SocketEvents.MESSAGE_RECEIVED, reply);
    const m = wkMessages[i];
    void pushToWishkeeper({
      shop: conversation.shop,
      message: { ...m, createdAt: (m.createdAt as Date).toISOString() },
    });
  }

  return replies;
}

// conversationId -> WishKeeper shop (null for widget conversations), so
// typing events don't hit the DB on every keystroke.
const shopByConversation = new Map<number, string | null>();
const lastTypingPush = new Map<number, number>();
const TYPING_PUSH_INTERVAL_MS = 2000;

/** Forwards an admin's typing indicator to the merchant's widget (throttled). */
export async function forwardAdminTyping(conversationId: number) {
  if (!wishkeeperEnabled) return;

  if (!shopByConversation.has(conversationId)) {
    const conversation = await prisma.message.findUnique({
      where: { id: conversationId },
      select: { source: true, shop: true },
    });
    shopByConversation.set(conversationId, conversation?.source === "WISHKEEPER" ? conversation.shop : null);
  }
  const shop = shopByConversation.get(conversationId);
  if (!shop) return;

  const now = Date.now();
  if (now - (lastTypingPush.get(conversationId) ?? 0) < TYPING_PUSH_INTERVAL_MS) return;
  lastTypingPush.set(conversationId, now);

  // pushToWishkeeper's HTTP push only reaches a listener on a live
  // WebSocket/SSE channel WishKeeper no longer runs in production (it
  // polls instead), so the timestamp written here is what its widget
  // actually reads to show "typing...".
  if (wkDb) {
    await wkDb.$executeRaw`UPDATE SupportThread SET adminTypingAt = ${new Date()} WHERE shop = ${shop}`;
  }
}

/**
 * Marks a WishKeeper merchant's thread closed (or reopens it) in WishKeeper's
 * own database. The merchant's widget polls that same row, so this is all
 * that's needed for the close action to reach their open chat panel.
 */
export async function setWishkeeperThreadClosed(shop: string, closed: boolean) {
  if (!wkDb) return;
  await wkDb.$executeRaw`
    UPDATE SupportThread SET closedAt = ${closed ? new Date() : null} WHERE shop = ${shop}`;
}

/**
 * Marks where a merchant clicked "Start new chat" on WishKeeper. The mirrored
 * history here isn't trimmed (unlike the merchant's own widget, which hides
 * it) -- this just drops a divider row so the dashboard reads clearly instead
 * of looking like one continuous resumed conversation.
 */
export async function recordWishkeeperReset(shop: string) {
  const conversationId = await findWishkeeperConversationId(shop);
  if (!conversationId) return;

  const reply = await prisma.messageReply.create({
    data: {
      messageId: conversationId,
      sender: "SYSTEM",
      body: "Merchant started a new conversation",
    },
  });
  await prisma.message.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

  const io = getIO();
  io.to([conversationRoom(conversationId), ADMINS_ROOM]).emit(SocketEvents.MESSAGE_RECEIVED, reply);
}

export async function findWishkeeperConversationId(shop: string): Promise<number | null> {
  const conversation = await prisma.message.findFirst({
    where: { source: "WISHKEEPER", shop },
    select: { id: true },
  });
  return conversation?.id ?? null;
}
