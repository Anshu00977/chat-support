import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { registerWidgetScriptTag, removeWidgetScriptTag } from "../services/shopify.service";

export const appsRouter = Router();

/**
 * Called by a Shopify app's own OAuth install callback once it has an
 * offline access token for the shop. Upserts the ShopifyApp row and
 * immediately registers the widget ScriptTag so it goes live with zero
 * merchant setup. Protected by a shared secret instead of admin JWT, since
 * the caller is a server-to-server integration, not a logged-in admin.
 */
appsRouter.post("/install", async (req, res) => {
  const secret = req.headers["x-install-secret"];
  if (!secret || secret !== process.env.INSTALL_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Invalid install secret" });
  }

  const { shop, name, accessToken } = req.body as { shop?: string; name?: string; accessToken?: string };
  if (!shop || !accessToken) {
    return res.status(400).json({ error: "shop and accessToken are required" });
  }

  const app = await prisma.shopifyApp.upsert({
    where: { shop },
    update: { accessToken, name: name ?? shop },
    create: { shop, accessToken, name: name ?? shop },
  });

  let scriptTagId = app.scriptTagId;
  if (!scriptTagId) {
    scriptTagId = String(await registerWidgetScriptTag(shop, accessToken));
    await prisma.shopifyApp.update({ where: { id: app.id }, data: { scriptTagId } });
  }

  res.status(201).json({ appId: app.id, shop: app.shop, scriptTagId });
});

appsRouter.use(requireAuth);

appsRouter.get("/", async (_req, res) => {
  const apps = await prisma.shopifyApp.findMany({
    select: { id: true, name: true, shop: true, scriptTagId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  res.json({ apps });
});

// Manual re-trigger button in the dashboard, in case install-time registration failed.
appsRouter.post("/:id/scripttag", requireRole("SUPER_ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const app = await prisma.shopifyApp.findUnique({ where: { id } });
  if (!app) return res.status(404).json({ error: "App not found" });

  const scriptTagId = String(await registerWidgetScriptTag(app.shop, app.accessToken));
  await prisma.shopifyApp.update({ where: { id }, data: { scriptTagId } });
  res.json({ scriptTagId });
});

appsRouter.delete("/:id/scripttag", requireRole("SUPER_ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const app = await prisma.shopifyApp.findUnique({ where: { id } });
  if (!app) return res.status(404).json({ error: "App not found" });
  if (!app.scriptTagId) return res.status(400).json({ error: "No ScriptTag registered" });

  await removeWidgetScriptTag(app.shop, app.accessToken, Number(app.scriptTagId));
  await prisma.shopifyApp.update({ where: { id }, data: { scriptTagId: null } });
  res.status(204).send();
});

// --- Bot keyword management, scoped per Shopify app/store ---

appsRouter.get("/:id/keywords", async (req, res) => {
  const appId = Number(req.params.id);
  const keywords = await prisma.botKeyword.findMany({ where: { appId }, orderBy: { createdAt: "asc" } });
  res.json({ keywords });
});

appsRouter.post("/:id/keywords", async (req, res) => {
  const appId = Number(req.params.id);
  const { keyword, answer } = req.body as { keyword?: string; answer?: string };
  if (!keyword || !answer) {
    return res.status(400).json({ error: "keyword and answer are required" });
  }
  const entry = await prisma.botKeyword.create({ data: { appId, keyword, answer } });
  res.status(201).json({ keyword: entry });
});

appsRouter.delete("/:id/keywords/:keywordId", async (req, res) => {
  await prisma.botKeyword.delete({ where: { id: Number(req.params.keywordId) } });
  res.status(204).send();
});
