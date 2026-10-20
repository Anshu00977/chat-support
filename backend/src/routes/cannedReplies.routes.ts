import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const cannedRepliesRouter = Router();

cannedRepliesRouter.use(requireAuth);

// Shared across every admin -- any logged-in admin can read, create and
// delete them, same as bot keywords.
cannedRepliesRouter.get("/", async (_req, res) => {
  const replies = await prisma.cannedReply.findMany({ orderBy: { shortcut: "asc" } });
  res.json({ replies });
});

cannedRepliesRouter.post("/", async (req, res) => {
  const { shortcut, body } = req.body as { shortcut?: string; body?: string };
  if (!shortcut?.trim() || !body?.trim()) {
    return res.status(400).json({ error: "shortcut and body are required" });
  }

  const existing = await prisma.cannedReply.findUnique({ where: { shortcut: shortcut.trim() } });
  if (existing) {
    return res.status(409).json({ error: "A canned reply with this shortcut already exists" });
  }

  const reply = await prisma.cannedReply.create({ data: { shortcut: shortcut.trim(), body: body.trim() } });
  res.status(201).json({ reply });
});

cannedRepliesRouter.delete("/:id", async (req, res) => {
  await prisma.cannedReply.delete({ where: { id: Number(req.params.id) } });
  res.status(204).send();
});
