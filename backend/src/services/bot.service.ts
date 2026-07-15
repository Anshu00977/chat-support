import { prisma } from "../prisma";

/**
 * Rule-based FAQ match: case-insensitive substring match of any keyword
 * against the message body. First match wins (keywords are ordered by
 * creation, so more specific/earlier entries can be prioritized by the admin).
 */
export async function matchBotKeyword(appId: number, body: string): Promise<string | null> {
  const keywords = await prisma.botKeyword.findMany({
    where: { appId },
    orderBy: { createdAt: "asc" },
  });

  const normalizedBody = body.toLowerCase();
  for (const entry of keywords) {
    if (normalizedBody.includes(entry.keyword.toLowerCase())) {
      return entry.answer;
    }
  }
  return null;
}
