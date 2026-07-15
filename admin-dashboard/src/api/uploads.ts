import type { Attachment } from "@chat-support/shared";
import { API_URL, api } from "./client";

export async function uploadFile(file: File): Promise<Attachment> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await api.post("/uploads", formData, { headers: { "Content-Type": "multipart/form-data" } });
  return { ...res.data.attachment, url: `${API_URL}${res.data.attachment.url}` };
}
