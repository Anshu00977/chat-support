export type AdminRole = "ADMIN" | "SUPER_ADMIN";

export type MessageStatus =
  | "OPEN"
  | "BOT_HANDLED"
  | "NEEDS_HUMAN"
  | "CLAIMED"
  | "CLOSED";

export type ReplySender = "ADMIN" | "SHOP" | "BOT";

export interface AdminDTO {
  id: number;
  name: string;
  email: string;
  role: AdminRole;
  active: boolean;
  createdAt: string;
}

export interface MessageReplyDTO {
  id: number;
  messageId: number;
  sender: ReplySender;
  adminId: number | null;
  adminName: string | null;
  body: string;
  attachments: string[] | null;
  createdAt: string;
}

export interface MessageDTO {
  id: number;
  appId: number;
  shop: string;
  name: string | null;
  email: string | null;
  subject: string | null;
  body: string;
  status: MessageStatus;
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
} as const;

/** Room every authenticated admin socket auto-joins, used for inbox-wide broadcasts. */
export const ADMINS_ROOM = "admins";

export function conversationRoom(messageId: number | string): string {
  return `conversation:${messageId}`;
}
