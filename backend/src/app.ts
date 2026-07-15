import "express-async-errors";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { env } from "./config/env";
import { authRouter } from "./routes/auth.routes";
import { adminsRouter } from "./routes/admins.routes";
import { appsRouter } from "./routes/apps.routes";
import { messagesRouter } from "./routes/messages.routes";
import { widgetRouter } from "./routes/widget.routes";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.corsOrigins.length > 0 ? env.corsOrigins : "*",
      credentials: true,
    })
  );
  app.use(express.json());

  // Widget bundle is served from the root, matching the ScriptTag src (/widget.js).
  app.use("/", widgetRouter);

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter);
  app.use("/api/admins", adminsRouter);
  app.use("/api/apps", appsRouter);
  app.use("/api/messages", messagesRouter);

  // Centralized error handler: express-async-errors forwards any rejected
  // promise from an async route handler here instead of crashing the process.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  });

  return app;
}
