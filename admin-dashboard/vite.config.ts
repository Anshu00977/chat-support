import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  // Production is served by the backend under /admin (see backend/src/app.ts),
  // not from the domain root -- asset URLs need that prefix baked in or the
  // built index.html references /assets/... instead of /admin/assets/...
  // and the page loads blank. Dev server still runs at the root as its own
  // standalone origin, so this only applies to `vite build`.
  base: command === "build" ? "/admin/" : "/",
  plugins: [react()],
  server: { port: 5173 },
}));
