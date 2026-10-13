import { prisma } from "../prisma";
import { env } from "../config/env";
import { registerWidgetScriptTag } from "../services/shopify.service";

/**
 * Auto-registers Shopify apps declared in SEED_APPS (backend/.env) instead of
 * requiring each one to go through the OAuth install webhook manually. Runs
 * on every boot so editing .env + restarting is enough to add/rotate an app —
 * upserts by shop, so re-running never creates duplicates.
 */
export async function seedAppsFromEnv() {
  for (const seed of env.seedApps) {
    const existing = await prisma.shopifyApp.findUnique({ where: { shop: seed.shop } });

    const app = await prisma.shopifyApp.upsert({
      where: { shop: seed.shop },
      update: { name: seed.name, accessToken: seed.accessToken },
      create: { name: seed.name, shop: seed.shop, accessToken: seed.accessToken },
    });

    const tokenChanged = existing && existing.accessToken !== seed.accessToken;
    if (!app.scriptTagId || tokenChanged) {
      try {
        const scriptTagId = String(await registerWidgetScriptTag(seed.shop, seed.accessToken));
        await prisma.shopifyApp.update({ where: { id: app.id }, data: { scriptTagId } });
        console.log(`Seeded app "${seed.name}" (${seed.shop}) — widget ScriptTag registered.`);
      } catch (err) {
        console.warn(
          `Seeded app "${seed.name}" (${seed.shop}) but ScriptTag registration failed — retry from the dashboard's Apps page. Reason:`,
          err instanceof Error ? err.message : err
        );
      }
    } else {
      console.log(`Seeded app "${seed.name}" (${seed.shop}) — already up to date.`);
    }
  }
}
