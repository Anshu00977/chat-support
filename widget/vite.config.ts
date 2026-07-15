import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Library build: one self-executing widget.js the ScriptTag points at.
// React is bundled in (not external) since the storefront has no React of its own.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  build: {
    cssCodeSplit: false,
    lib: {
      entry: "src/main.tsx",
      name: "ChatSupportWidget",
      formats: ["iife"],
      fileName: () => "widget.js",
    },
    rollupOptions: {
      output: { extend: true },
    },
  },
});
