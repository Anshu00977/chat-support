const VISITOR_KEY = "chat_support_visitor_id";

function conversationKey(shop: string) {
  return `chat_support_conversation_${shop}`;
}

export function getOrCreateVisitorId(): string {
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

export function getStoredConversationId(shop: string): number | null {
  const raw = localStorage.getItem(conversationKey(shop));
  return raw ? Number(raw) : null;
}

export function setStoredConversationId(shop: string, id: number) {
  localStorage.setItem(conversationKey(shop), String(id));
}

export function clearStoredConversationId(shop: string) {
  localStorage.removeItem(conversationKey(shop));
}
