import { createServer } from "http";
import { createApp } from "./app";
import { initSocket } from "./socket";
import { env } from "./config/env";
import { seedSuperAdminIfNeeded } from "./bootstrap/seedSuperAdmin";
import { seedAppsFromEnv } from "./bootstrap/seedAppsFromEnv";
import { syncWishkeeperOnBoot, wishkeeperEnabled } from "./services/wishkeeper.service";
import { syncAllEmbeddedAppsOnBoot } from "./services/embeddedChat.service";

// Defense in depth: request/socket handlers already catch their own errors,
// but this stops any error that slips through from taking the whole process down.
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));

async function main() {
  await seedSuperAdminIfNeeded();
  await seedAppsFromEnv();

  const app = createApp();
  const httpServer = createServer(app);
  initSocket(httpServer);

  httpServer.listen(env.port, () => {
    console.log(`Backend listening on http://localhost:${env.port}`);
  });

  // After listen: ingest emits socket events, so Socket.IO must exist. A
  // failure here (e.g. WishKeeper DB unreachable) must not stop the server.
  if (wishkeeperEnabled) {
    syncWishkeeperOnBoot().catch((err) => console.error("WishKeeper support sync failed:", err));
  } else {
    console.log("WishKeeper support integration disabled (set WISHKEEPER_DATABASE_URL + SUPPORT_INTERNAL_SECRET to enable).");
  }
  syncAllEmbeddedAppsOnBoot().catch((err) => console.error("Embedded app sync failed:", err));
}

main().catch((err) => {
  console.error("Failed to start backend:", err);
  process.exit(1);
});
