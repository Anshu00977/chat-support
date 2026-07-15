import path from "path";
import { fileURLToPath } from "url";
import { Router } from "express";

export const widgetRouter = Router();

const currentDir = path.dirname(fileURLToPath(import.meta.url));
// The widget package builds to widget/dist/widget.js (see widget/vite.config.ts).
const WIDGET_BUNDLE_PATH = path.resolve(currentDir, "../../../widget/dist/widget.js");

widgetRouter.get("/widget.js", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300"); // short TTL so updates roll out quickly
  res.sendFile(WIDGET_BUNDLE_PATH, (err) => {
    if (err) {
      res.status(404).send("// widget bundle not built yet — run `npm run build:widget`");
    }
  });
});
