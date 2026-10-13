import "express-async-errors";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./config/env";
import { authRouter } from "./routes/auth.routes";
import { adminsRouter } from "./routes/admins.routes";
import { appsRouter } from "./routes/apps.routes";
import { messagesRouter } from "./routes/messages.routes";
import { widgetRouter } from "./routes/widget.routes";
import { uploadsRouter, UPLOADS_DIR } from "./routes/uploads.routes";
import { wishkeeperRouter } from "./routes/wishkeeper.routes";

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
  app.use("/uploads", express.static(UPLOADS_DIR));

  // Server-to-server contract with the WishKeeper Shopify app (/internal/*) + its attachment links.
  app.use("/", wishkeeperRouter);

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/", (_req, res) => res.redirect("/admin/"));
  // Catches people going straight to a dashboard route without the /admin
  // prefix (e.g. bookmarked /login), instead of just 404ing on them.
  app.get("/login", (_req, res) => res.redirect("/admin/login"));

  app.use("/api/auth", authRouter);
  app.use("/api/admins", adminsRouter);
  app.use("/api/apps", appsRouter);
  app.use("/api/messages", messagesRouter);
  app.use("/api/uploads", uploadsRouter);

  // Admin dashboard SPA, served at /admin (the backend's own domain, no
  // separate subdomain/deploy needed). VITE_API_URL is baked in at build
  // time to this same origin, so the dashboard's API/socket calls are
  // same-origin once served from here.
  const dashboardDist = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../admin-dashboard/dist");
  app.use("/admin", express.static(dashboardDist));
  app.get(/^\/admin(\/.*)?$/, (_req, res) => res.sendFile(path.join(dashboardDist, "index.html")));

  // Centralized error handler: express-async-errors forwards any rejected
  // promise from an async route handler here instead of crashing the process.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  });

  return app;
}
