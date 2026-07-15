import type { Attachment, MessageDTO } from "@chat-support/shared";

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

    async endChat(conversationId: number, visitorId: string): Promise<MessageDTO> {
      const res = await fetch(`${apiUrl}/api/messages/${conversationId}/close-by-visitor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId }),
      });
      if (!res.ok) throw new Error("Failed to end chat");
      const data = await res.json();
      return data.message;
    },

    async uploadFile(file: File): Promise<Attachment> {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${apiUrl}/api/uploads`, { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to upload file");
      }
      const data = await res.json();
      return { ...data.attachment, url: `${apiUrl}${data.attachment.url}` };
    },
  };
}
