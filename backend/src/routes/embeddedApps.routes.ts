import crypto from "crypto";
import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole } from "../middleware/auth";

export const embeddedAppsRouter = Router();

embeddedAppsRouter.use(requireAuth);

// The secret itself isn't returned here -- only at creation time, same
// pattern as a typical API key UI (shown once, then write-only).
embeddedAppsRouter.get("/", async (_req, res) => {
  const apps = await prisma.embeddedApp.findMany({
    select: { id: true, name: true, appUrl: true, adminDisplayName: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  res.json({ apps });
});

embeddedAppsRouter.post("/", requireRole("SUPER_ADMIN"), async (req, res) => {
  const { name, databaseUrl, appUrl, adminDisplayName } = req.body as {
    name?: string;
    databaseUrl?: string;
    appUrl?: string;
    adminDisplayName?: string;
  };
  if (!name?.trim() || !databaseUrl?.trim() || !appUrl?.trim()) {
    return res.status(400).json({ error: "name, databaseUrl and appUrl are required" });
  }

  const internalSecret = crypto.randomBytes(24).toString("hex");
  const app = await prisma.embeddedApp.create({
    data: {
      name: name.trim(),
      databaseUrl: databaseUrl.trim(),
      appUrl: appUrl.trim().replace(/\/$/, ""),
      internalSecret,
      adminDisplayName: adminDisplayName?.trim() || "Support",
    },
  });

  // Returned once, same as the embedded-apps/scripttag snippet flow -- the
  // caller has to copy it into the connecting app's own .env now.
  res.status(201).json({ app: { id: app.id, name: app.name }, internalSecret });
});

embeddedAppsRouter.delete("/:id", requireRole("SUPER_ADMIN"), async (req, res) => {
  await prisma.embeddedApp.delete({ where: { id: Number(req.params.id) } });
  res.status(204).send();
});
