import crypto from "crypto";
import { Prisma, PrismaClient, type MessageReply } from "@prisma/client";
import { ADMINS_ROOM, SocketEvents, conversationRoom, type Attachment } from "@chat-support/shared";
import { env } from "../config/env";
import { prisma } from "../prisma";
import { getIO } from "../socket/ioInstance";
import { notifyAdminsNeedsHuman } from "./mail.service";
import { setDirectAdminTyping } from "./embeddedDirect.service";

/**
 * Generic embedded merchant-chat integration -- the same contract
 * wishkeeper.service.ts hardcodes for one app, generalized so any
 * connected Shopify app can use it without bespoke code here. Each
 * connected app is a row in the EmbeddedApp table (created from the
 * dashboard's Embedded Apps page) instead of env vars, so new apps don't
 * need a deploy on this side to connect.
 *
 * One row = one connected APP, not one shop -- identified by its secret,
 * not by a shop domain, so any number of shops that install that app all
 * reach the same connection (exactly like WishKeeper's dedicated
 * integration serves every WishKeeper-installing shop from one connection).
 * Which shop a given conversation is with is just data on that
 * conversation (and on the connected app's own SupportThread row), not
 * part of how we find the app.
 *
 *  - App -> us:  POST /internal/notify  { shop, message } | { shop, type: "typing" | "seen" | "reset" }
 *               POST /internal/register-url { url }
 *  - us -> App:  admin replies INSERTed into that app's own SupportMessage
 *               table directly (raw SQL against its own database), then
 *               pushed live via POST {appUrl}/app/support/internal-notify.
 *
 * WishKeeper is intentionally NOT migrated onto this -- it keeps using its
 * own dedicated, already-proven integration untouched.
 */

interface EmbeddedAppRow {
  id: number;
  name: string;
  databaseUrl: string | null; // null = DB-less app, see embeddedDirect.service.ts
  appUrl: string;
  internalSecret: string;
  adminDisplayName: string;
}

// Cached by id: the row itself (short TTL, since appUrl can change via
// register-url) and a long-lived PrismaClient pointed at that app's own
// database (expensive to create per-request, safe to reuse indefinitely).
const appCacheById = new Map<number, { row: EmbeddedAppRow; fetchedAt: number }>();
const appCacheBySecret = new Map<string, { row: EmbeddedAppRow; fetchedAt: number }>();
const dbCache = new Map<number, PrismaClient>();
const APP_CACHE_TTL_MS = 30_000;

function cacheApp(row: EmbeddedAppRow) {
  const entry = { row, fetchedAt: Date.now() };
  appCacheById.set(row.id, entry);
  appCacheBySecret.set(row.internalSecret, entry);
}

function invalidateApp(row: EmbeddedAppRow) {
  appCacheById.delete(row.id);
  appCacheBySecret.delete(row.internalSecret);
}

export async function getEmbeddedAppById(id: number): Promise<EmbeddedAppRow | null> {
  const cached = appCacheById.get(id);
  if (cached && Date.now() - cached.fetchedAt < APP_CACHE_TTL_MS) return cached.row;

  const row = await prisma.embeddedApp.findUnique({ where: { id } });
  if (!row) {
    appCacheById.delete(id);
    return null;
  }
  cacheApp(row);
  return row;
}

export async function getEmbeddedAppBySecret(secret: string): Promise<EmbeddedAppRow | null> {
  const cached = appCacheBySecret.get(secret);
  if (cached && Date.now() - cached.fetchedAt < APP_CACHE_TTL_MS) return cached.row;

  const row = await prisma.embeddedApp.findUnique({ where: { internalSecret: secret } });
  if (!row) return null;
  cacheApp(row);
  return row;
}

function getAppDb(row: EmbeddedAppRow): PrismaClient {
  if (!row.databaseUrl) throw new Error(`${row.name} has no database of its own -- use embeddedDirect.service.ts instead`);
  let db = dbCache.get(row.id);
  if (!db) {
    db = new PrismaClient({ datasourceUrl: row.databaseUrl });
    dbCache.set(row.id, db);
  }
  return db;
}

/** A SupportMessage row, as stored in the connected app's DB and sent in its notify payloads. */
export interface EmbeddedMessage {
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

const VARCHAR_MAX = 191;

/** Verifies the request's secret and returns the app it belongs to, or null. */
export async function verifyEmbeddedSecret(providedSecret: string | undefined): Promise<EmbeddedAppRow | null> {
  if (!providedSecret) return null;
  return getEmbeddedAppBySecret(providedSecret);
}

/**
 * Attachments live on the connected app at /uploads/support/<thread>/<file>.
 * Linked through our own redirect rather than an absolute app URL, since
 * that can change (e.g. a local dev tunnel restarting).
 */
function attachmentToAttachment(appId: number, m: EmbeddedMessage): Attachment[] | null {
  if (!m.attachmentUrl) return null;
  let url = m.attachmentUrl;
  if (url.startsWith("/uploads/support/")) {
    url = `${env.backendPublicUrl}/embedded-files/${appId}/${url.slice("/uploads/support/".length)}`;
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

function prettyShopName(shop: string) {
  const base = shop.replace(/\.myshopify\.com$/, "");
  return base
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

async function findOrCreateConversation(app: EmbeddedAppRow, shop: string, first: EmbeddedMessage) {
  const existing = await prisma.message.findUnique({ where: { externalThreadId: first.threadId } });
  if (existing) return { conversation: existing, isNew: false };

  try {
    const conversation = await prisma.message.create({
      data: {
        source: "EMBEDDED",
        embeddedAppId: app.id,
        externalThreadId: first.threadId,
        shop,
        visitorId: `embedded:${app.id}:${shop}`,
        name: `${prettyShopName(shop)} (${app.name})`,
        body: first.body || first.attachmentName || "(attachment)",
        status: first.sender === "admin" ? "OPEN" : "NEEDS_HUMAN",
      },
    });
    return { conversation, isNew: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const conversation = await prisma.message.findUniqueOrThrow({ where: { externalThreadId: first.threadId } });
    return { conversation, isNew: false };
  }
}

/** Mirrors one message from a connected app into our tables. Idempotent by externalId. */
export async function ingestEmbeddedMessage(
  app: EmbeddedAppRow,
  shop: string,
  msg: EmbeddedMessage,
  { live }: { live: boolean }
) {
  if (await prisma.messageReply.findUnique({ where: { externalId: msg.id }, select: { id: true } })) return;

  const { conversation, isNew } = await findOrCreateConversation(app, shop, msg);
  const fromMerchant = msg.sender !== "admin";

  let reply: MessageReply;
  try {
    reply = await prisma.messageReply.create({
      data: {
        messageId: conversation.id,
        sender: fromMerchant ? "SHOP" : "ADMIN",
        adminName: fromMerchant ? null : app.adminDisplayName,
        body: msg.body ?? "",
        attachments: (attachmentToAttachment(app.id, msg) as unknown as Prisma.InputJsonValue) ?? undefined,
        externalId: msg.id,
        createdAt: new Date(msg.createdAt),
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return;
    throw err;
  }

  const reopened = !isNew && fromMerchant && conversation.status === "CLOSED";
  let status = conversation.status;
  if (!isNew && fromMerchant) {
    status = conversation.assignedAdminId && !reopened ? "CLAIMED" : "NEEDS_HUMAN";
  } else if (!isNew && conversation.status === "NEEDS_HUMAN" && !conversation.assignedAdminId) {
    status = "OPEN";
  }
  const updated = await prisma.message.update({
    where: { id: conversation.id },
    data: { status, updatedAt: new Date(), snoozedUntil: fromMerchant ? null : undefined },
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
      body: msg.body || `(sent an attachment: ${msg.attachmentName ?? "file"})`,
      intro: `A merchant on ${app.name} (${shop}) sent a support message.`,
    });
  }
}

/** Imports every message not yet mirrored for one connected app, across all of its shops. Runs for all apps on boot. */
export async function syncEmbeddedApp(app: EmbeddedAppRow) {
  const db = getAppDb(app);
  const rows = await db.$queryRaw<(EmbeddedMessage & { shop: string })[]>`
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
    await ingestEmbeddedMessage(app, row.shop, row, { live: false });
    imported++;
  }
  if (imported > 0 || rows.length > 0) {
    console.log(`${app.name} support sync: ${imported} new message(s) imported (${rows.length} total).`);
  }
}

export async function syncAllEmbeddedAppsOnBoot() {
  const apps = await prisma.embeddedApp.findMany();
  for (const app of apps) {
    try {
      await syncEmbeddedApp(app);
    } catch (err) {
      console.error(`Embedded app sync failed for ${app.name}:`, err);
    }
  }
}

/** Best-effort push to a connected app's widget channel; never throws. */
async function pushToEmbeddedApp(app: EmbeddedAppRow, payload: Record<string, unknown>) {
  try {
    const res = await fetch(`${app.appUrl.replace(/\/$/, "")}/app/support/internal-notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": app.internalSecret },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.warn(`${app.name} internal-notify returned ${res.status}`);
  } catch (err) {
    console.warn(`${app.name} internal-notify failed:`, err instanceof Error ? err.message : err);
  }
}

function absoluteUrl(url: string) {
  return url.startsWith("/") ? `${env.backendPublicUrl}${url}` : url;
}

/** Sends an admin's reply to a connected app's merchant. */
export async function sendEmbeddedAdminReply(params: {
  conversation: { id: number; shop: string; embeddedAppId: number | null; externalThreadId: string | null };
  admin: { id: number; name: string | null };
  body: string;
  attachments: Attachment[];
}): Promise<MessageReply[]> {
  const { conversation, admin, attachments } = params;
  if (!conversation.embeddedAppId) throw new Error("This app is not connected");
  const app = await getEmbeddedAppById(conversation.embeddedAppId);
  if (!app) throw new Error("This app is not connected");
  if (!conversation.externalThreadId) throw new Error("Conversation is not linked to a thread");
  const threadId = conversation.externalThreadId;
  const db = getAppDb(app);

  const body = params.body.trim();
  const parts: { body: string | null; attachment: Attachment | null }[] = attachments.length
    ? attachments.map((a, i) => ({ body: i === 0 ? body || null : null, attachment: a }))
    : [{ body, attachment: null }];

  const baseTime = Date.now();
  const messages: EmbeddedMessage[] = parts.map((p, i) => ({
    id: crypto.randomUUID(),
    threadId,
    sender: "admin",
    body: p.body,
    attachmentUrl: p.attachment ? absoluteUrl(p.attachment.url).slice(0, VARCHAR_MAX) : null,
    attachmentName: p.attachment ? p.attachment.name.slice(0, VARCHAR_MAX) : null,
    attachmentType: p.attachment?.mimetype ?? null,
    attachmentSize: p.attachment?.size ?? null,
    createdAt: new Date(baseTime + i),
  }));

  await db.$transaction([
    ...messages.map(
      (m) => db.$executeRaw`
        INSERT INTO SupportMessage
          (id, threadId, sender, body, attachmentUrl, attachmentName, attachmentType, attachmentSize, createdAt)
        VALUES
          (${m.id}, ${m.threadId}, 'admin', ${m.body}, ${m.attachmentUrl}, ${m.attachmentName},
           ${m.attachmentType}, ${m.attachmentSize}, ${m.createdAt})`
    ),
    db.$executeRaw`
      UPDATE SupportThread
      SET shopUnreadCount = shopUnreadCount + ${messages.length}, updatedAt = ${new Date()}, closedAt = NULL
      WHERE id = ${threadId}`,
  ]);

  const replies: MessageReply[] = [];
  for (const [i, m] of messages.entries()) {
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
    const m = messages[i];
    void pushToEmbeddedApp(app, { shop: conversation.shop, message: { ...m, createdAt: (m.createdAt as Date).toISOString() } });
  }

  return replies;
}

const appByConversation = new Map<number, { shop: string; embeddedAppId: number } | null>();
const lastTypingPush = new Map<number, number>();
const TYPING_PUSH_INTERVAL_MS = 2000;

/** Forwards an admin's typing indicator to the merchant's widget (throttled), via DB timestamp (polling-based). */
export async function forwardEmbeddedTyping(conversationId: number) {
  if (!appByConversation.has(conversationId)) {
    const conversation = await prisma.message.findUnique({
      where: { id: conversationId },
      select: { source: true, shop: true, embeddedAppId: true },
    });
    appByConversation.set(
      conversationId,
      conversation?.source === "EMBEDDED" && conversation.embeddedAppId
        ? { shop: conversation.shop, embeddedAppId: conversation.embeddedAppId }
        : null
    );
  }
  const info = appByConversation.get(conversationId);
  if (!info) return;

  const now = Date.now();
  if (now - (lastTypingPush.get(conversationId) ?? 0) < TYPING_PUSH_INTERVAL_MS) return;
  lastTypingPush.set(conversationId, now);

  const app = await getEmbeddedAppById(info.embeddedAppId);
  if (!app) return;
  if (!app.databaseUrl) {
    await setDirectAdminTyping(conversationId);
    return;
  }
  const db = getAppDb(app);
  await db.$executeRaw`UPDATE SupportThread SET adminTypingAt = ${new Date()} WHERE shop = ${info.shop}`;
}

export async function setEmbeddedThreadClosed(
  conversation: { shop: string; embeddedAppId: number | null },
  closed: boolean
) {
  if (!conversation.embeddedAppId) return;
  const app = await getEmbeddedAppById(conversation.embeddedAppId);
  if (!app || !app.databaseUrl) return; // DB-less: status on our own Message row IS the closed state, nothing to propagate
  const db = getAppDb(app);
  await db.$executeRaw`UPDATE SupportThread SET closedAt = ${closed ? new Date() : null} WHERE shop = ${conversation.shop}`;
}

export async function recordEmbeddedReset(shop: string) {
  const conversationId = await findEmbeddedConversationId(shop);
  if (!conversationId) return;

  const reply = await prisma.messageReply.create({
    data: { messageId: conversationId, sender: "SYSTEM", body: "Merchant started a new conversation" },
  });
  await prisma.message.update({
    where: { id: conversationId },
    data: { status: "NEEDS_HUMAN", assignedAdminId: null, updatedAt: new Date() },
  });

  const io = getIO();
  io.to([conversationRoom(conversationId), ADMINS_ROOM]).emit(SocketEvents.MESSAGE_RECEIVED, reply);
  io.to(ADMINS_ROOM).emit(SocketEvents.NEW_CONVERSATION, { message: { id: conversationId } });
}

export async function findEmbeddedConversationId(shop: string): Promise<number | null> {
  const conversation = await prisma.message.findFirst({ where: { source: "EMBEDDED", shop }, select: { id: true } });
  return conversation?.id ?? null;
}

export async function setEmbeddedAppUrl(app: EmbeddedAppRow, url: string) {
  const normalized = url.replace(/\/$/, "");
  if (normalized === app.appUrl) return;
  await prisma.embeddedApp.update({ where: { id: app.id }, data: { appUrl: normalized } });
  invalidateApp(app); // force a fresh read next time, picking up the new URL
}
