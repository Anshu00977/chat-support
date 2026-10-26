export type AdminRole = "ADMIN" | "SUPER_ADMIN";

export type MessageStatus =
  | "OPEN"
  | "BOT_HANDLED"
  | "NEEDS_HUMAN"
  | "CLAIMED"
  | "CLOSED";

export type ReplySender = "ADMIN" | "SHOP" | "BOT" | "SYSTEM";

/** WIDGET = storefront customer chat; WISHKEEPER = a WishKeeper merchant's in-admin support chat. */
export type MessageSource = "WIDGET" | "WISHKEEPER" | "EMBEDDED";

export interface AdminDTO {
  id: number;
  name: string;
  email: string;
  role: AdminRole;
  active: boolean;
  createdAt: string;
}

export interface Attachment {
  url: string;
  name: string;
  mimetype: string;
  size: number;
}

export interface MessageReplyDTO {
  id: number;
  messageId: number;
  sender: ReplySender;
  adminId: number | null;
  adminName: string | null;
  body: string;
  attachments: Attachment[] | null;
  internal: boolean;
  createdAt: string;
}

/** "mystore.myshopify.com" -> "Mystore", used wherever a shop has no registered display name. */
export function formatShopName(shop: string): string {
  const base = shop.replace(/\.myshopify\.com$/, "");
  return base
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

type ConversationLabelInput = Pick<MessageDTO, "source" | "shop" | "name" | "app" | "embeddedApp">;

/** Which product/integration this conversation came through -- WishKeeper, an embedded app, or the storefront widget. */
export function conversationAppLabel(m: Pick<ConversationLabelInput, "source" | "embeddedApp">): string {
  if (m.source === "WISHKEEPER") return "WishKeeper";
  if (m.source === "EMBEDDED") return m.embeddedApp?.name ?? "Embedded app";
  return "Chat Widget";
}

/**
 * Full display label for a conversation row: App · Store [· Chatter name].
 * The chatter name only applies to the storefront widget -- WishKeeper and
 * embedded-app conversations are with the store itself, not an individual.
 */
export function conversationLabel(m: ConversationLabelInput): string {
  const app = conversationAppLabel(m);
  const store = m.app?.name ?? formatShopName(m.shop);
  if (m.source !== "WIDGET") return `${app} · ${store}`;
  return `${app} · ${store} · ${m.name?.trim() || "Anonymous visitor"}`;
}

export interface MessageDTO {
  id: number;
  appId: number | null;
  app: { name: string } | null;
  embeddedAppId: number | null;
  embeddedApp: { name: string } | null;
  source: MessageSource;
  shop: string;
  name: string | null;
  email: string | null;
  subject: string | null;
  body: string;
  status: MessageStatus;
  archived: boolean;
  starred: boolean;
  snoozedUntil: string | null;
  csatScore: number | null;
  csatSubmittedAt: string | null;
  assignedAdminId: number | null;
  assignedAdmin: Pick<AdminDTO, "id" | "name"> | null;
  visitorId: string;
  createdAt: string;
  updatedAt: string;
  replies: MessageReplyDTO[];
}

/** Socket.IO event names shared between backend, dashboard and widget. */
export const SocketEvents = {
  JOIN_CONVERSATION: "join_conversation",
  NEW_MESSAGE: "new_message",
  MESSAGE_RECEIVED: "message_received",
  TYPING: "typing",
  STOP_TYPING: "stop_typing",
  CONVERSATION_CLAIMED: "conversation_claimed",
  CONVERSATION_TRANSFERRED: "conversation_transferred",
  CONVERSATION_CLOSED: "conversation_closed",
  /** Broadcast to all connected admin dashboards when a brand-new conversation starts, so the inbox updates instantly with no polling. */
  NEW_CONVERSATION: "new_conversation",
  CONVERSATION_ARCHIVED: "conversation_archived",
  CONVERSATION_DELETED: "conversation_deleted",
  CSAT_SUBMITTED: "csat_submitted",
} as const;

/** Room every authenticated admin socket auto-joins, used for inbox-wide broadcasts. */
export const ADMINS_ROOM = "admins";

export function conversationRoom(messageId: number | string): string {
  return `conversation:${messageId}`;
}
