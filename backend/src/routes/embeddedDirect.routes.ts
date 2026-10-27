import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { Router } from "express";
import multer from "multer";
import { verifyEmbeddedSecret } from "../services/embeddedChat.service";
import {
  getDirectThread,
  sendDirectMessage,
  closeDirectThread,
  reopenDirectThread,
  forwardDirectTyping,
} from "../services/embeddedDirect.service";
import type { Attachment } from "@chat-support/shared";

/**
 * DB-less embedded-chat routes -- for apps with no databaseUrl on their
 * EmbeddedApp row, so their conversation lives entirely in Supportly's own
 * Message/MessageReply tables. The connected app's widget calls these instead
 * of polling its own local tables.
 *
 * Auth: every route expects the app's internalSecret in X-Internal-Secret.
 */
export const embeddedDirectRouter = Router();

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(currentDir, "../../uploads");
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) { cb(new Error(`Unsupported file type: ${file.mimetype}`)); return; }
    cb(null, true);
  },
});

// GET /embedded/thread/messages?shop=... -- poll for thread state + all messages
embeddedDirectRouter.get("/embedded/thread/messages", async (req, res) => {
  const shop = req.query.shop as string | undefined;
  if (!shop) return res.status(400).json({ error: "Missing shop" });

  const app = await verifyEmbeddedSecret(req.headers["x-internal-secret"] as string | undefined);
  if (!app) return res.status(403).json({ error: "Forbidden" });
  if (app.databaseUrl) return res.status(400).json({ error: "This app uses the database-backed path, not the direct path" });

  const result = await getDirectThread(app, shop);
  res.json(result);
});

// POST /embedded/thread/send -- merchant sends a message (optionally with attachment)
embeddedDirectRouter.post("/embedded/thread/send", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      const message = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
        ? "File is too large (max 10MB)"
        : err.message;
      return res.status(400).json({ error: message });
    }

    const shop = req.body.shop as string | undefined;
    const body = (req.body.body as string | undefined) || "";
    if (!shop) return res.status(400).json({ error: "Missing shop" });
    if (!body.trim() && !req.file) return res.status(400).json({ error: "Write a message or attach a file" });

    const app = await verifyEmbeddedSecret(req.headers["x-internal-secret"] as string | undefined);
    if (!app) return res.status(403).json({ error: "Forbidden" });
    if (app.databaseUrl) return res.status(400).json({ error: "This app uses the database-backed path, not the direct path" });

    let attachment: Attachment | null = null;
    if (req.file) {
      attachment = {
        url: `/uploads/${req.file.filename}`,
        name: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      };
    }

    const reply = await sendDirectMessage(app, shop, body, attachment);
    res.status(201).json({ reply });
  });
});

// POST /embedded/thread/close -- merchant closes the conversation
embeddedDirectRouter.post("/embedded/thread/close", async (req, res) => {
  const { shop } = (req.body ?? {}) as { shop?: string };
  if (!shop) return res.status(400).json({ error: "Missing shop" });

  const app = await verifyEmbeddedSecret(req.headers["x-internal-secret"] as string | undefined);
  if (!app) return res.status(403).json({ error: "Forbidden" });
  if (app.databaseUrl) return res.status(400).json({ error: "This app uses the database-backed path, not the direct path" });

  await closeDirectThread(app, shop);
  res.json({ ok: true });
});

// POST /embedded/thread/reopen -- merchant starts a new conversation after closing
embeddedDirectRouter.post("/embedded/thread/reopen", async (req, res) => {
  const { shop } = (req.body ?? {}) as { shop?: string };
  if (!shop) return res.status(400).json({ error: "Missing shop" });

  const app = await verifyEmbeddedSecret(req.headers["x-internal-secret"] as string | undefined);
  if (!app) return res.status(403).json({ error: "Forbidden" });
  if (app.databaseUrl) return res.status(400).json({ error: "This app uses the database-backed path, not the direct path" });

  await reopenDirectThread(app, shop);
  res.json({ ok: true });
});

// POST /embedded/thread/typing -- merchant is typing
embeddedDirectRouter.post("/embedded/thread/typing", async (req, res) => {
  const { shop } = (req.body ?? {}) as { shop?: string };
  if (!shop) return res.status(400).json({ error: "Missing shop" });

  const app = await verifyEmbeddedSecret(req.headers["x-internal-secret"] as string | undefined);
  if (!app) return res.status(403).json({ error: "Forbidden" });
  if (app.databaseUrl) return res.status(400).json({ error: "This app uses the database-backed path, not the direct path" });

  await forwardDirectTyping(app, shop);
  res.json({ ok: true });
});
