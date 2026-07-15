import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { Router } from "express";
import multer from "multer";

export const uploadsRouter = Router();

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = path.resolve(currentDir, "../../uploads");

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const unique = crypto.randomUUID();
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

// Public — both the widget (anonymous customers) and the dashboard (admins) use this.
uploadsRouter.post("/", (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      const message = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 10MB)" : err.message;
      return res.status(400).json({ error: message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    res.status(201).json({
      attachment: {
        url: `/uploads/${req.file.filename}`,
        name: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      },
    });
  });
});
