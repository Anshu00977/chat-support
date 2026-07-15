import React from "react";
import ReactDOM from "react-dom/client";
import { ChatWidget } from "./ChatWidget";
import { widgetStyles } from "./styles";

declare global {
  interface Window {
    Shopify?: { shop?: string };
    __chatSupportWidgetLoaded?: boolean;
  }
}

// Guard against the ScriptTag firing twice (e.g. SPA theme re-navigations).
if (!window.__chatSupportWidgetLoaded) {
  window.__chatSupportWidgetLoaded = true;

  // Must run synchronously at module top-level: document.currentScript is
  // only populated for the classic <script> the ScriptTag injects, not
  // inside any later callback/microtask.
  const scriptEl = document.currentScript as HTMLScriptElement | null;

  const apiUrl = import.meta.env.DEV
    ? import.meta.env.VITE_API_URL ?? "http://localhost:4000"
    : scriptEl
    ? new URL(scriptEl.src).origin
    : "";

  const shop = window.Shopify?.shop ?? scriptEl?.dataset.shop ?? "";

  if (apiUrl && shop) {
    const host = document.createElement("div");
    host.id = "chat-support-widget-host";
    document.body.appendChild(host);

    // Shadow DOM isolates our styles from (and protects them against) the storefront theme's CSS.
    const shadowRoot = host.attachShadow({ mode: "open" });
    const styleTag = document.createElement("style");
    styleTag.textContent = widgetStyles;
    shadowRoot.appendChild(styleTag);

    const mountPoint = document.createElement("div");
    shadowRoot.appendChild(mountPoint);

    ReactDOM.createRoot(mountPoint).render(
      <React.StrictMode>
        <ChatWidget apiUrl={apiUrl} shop={shop} />
      </React.StrictMode>
    );
  } else {
    console.warn("Chat widget: missing shop or API URL, widget not mounted.");
  }
}
