import { createServer } from "http";
import { createApp } from "./app";
import { initSocket } from "./socket";
import { env } from "./config/env";
import { seedSuperAdminIfNeeded } from "./bootstrap/seedSuperAdmin";

// Defense in depth: request/socket handlers already catch their own errors,
// but this stops any error that slips through from taking the whole process down.
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));

async function main() {
  await seedSuperAdminIfNeeded();

  const app = createApp();
  const httpServer = createServer(app);
  initSocket(httpServer);

  httpServer.listen(env.port, () => {
    console.log(`Backend listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start backend:", err);
  process.exit(1);
});
