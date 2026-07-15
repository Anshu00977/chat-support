import type { MessageDTO } from "@chat-support/shared";

export function createApi(apiUrl: string) {
  return {
    async createMessage(input: {
      shop: string;
      visitorId: string;
      name?: string;
      email?: string;
      subject?: string;
      body: string;
    }): Promise<MessageDTO> {
      const res = await fetch(`${apiUrl}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Failed to send message");
      const data = await res.json();
      return data.message;
    },

    async fetchHistory(conversationId: number, visitorId: string): Promise<MessageDTO | null> {
      const res = await fetch(
        `${apiUrl}/api/messages/${conversationId}/history?visitorId=${encodeURIComponent(visitorId)}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data.message;
    },
  };
}
