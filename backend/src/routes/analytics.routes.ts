import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth);

const WINDOW_DAYS = 30;

analyticsRouter.get("/", async (_req, res) => {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const conversations = await prisma.message.findMany({
    where: { createdAt: { gte: since } },
    select: {
      id: true,
      status: true,
      source: true,
      app: { select: { name: true, shop: true } },
      csatScore: true,
      createdAt: true,
      replies: { select: { sender: true, internal: true, createdAt: true }, orderBy: { createdAt: "asc" } },
    },
  });

  const byStatus: Record<string, number> = {};
  const byApp: Record<string, number> = {};
  const csatScores: number[] = [];
  const firstResponseMinutes: number[] = [];

  for (const c of conversations) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;

    const appLabel = c.source === "WISHKEEPER" ? "WishKeeper merchants" : c.app ? `${c.app.name} (${c.app.shop})` : "Unknown";
    byApp[appLabel] = (byApp[appLabel] ?? 0) + 1;

    if (c.csatScore) csatScores.push(c.csatScore);

    // Minutes between the conversation's first customer message and the
    // first real (non-internal) admin reply after it -- the standard
    // "first response time" metric every major helpdesk leads with.
    const firstShopReply = c.replies.find((r) => r.sender === "SHOP");
    const anchor = firstShopReply?.createdAt ?? c.createdAt;
    const firstAdminReply = c.replies.find((r) => r.sender === "ADMIN" && !r.internal && r.createdAt > anchor);
    if (firstAdminReply) {
      firstResponseMinutes.push((firstAdminReply.createdAt.getTime() - anchor.getTime()) / 60000);
    }
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  res.json({
    windowDays: WINDOW_DAYS,
    total: conversations.length,
    byStatus,
    byApp,
    avgCsat: avg(csatScores),
    csatCount: csatScores.length,
    avgFirstResponseMinutes: avg(firstResponseMinutes),
    respondedCount: firstResponseMinutes.length,
  });
});
