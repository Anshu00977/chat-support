import { env } from "../config/env";

const SHOPIFY_API_VERSION = "2024-07";

interface ScriptTagResponse {
  script_tag: { id: number; src: string; event: string };
}

/**
 * Registers our widget as a ScriptTag on the given shop, so it is injected
 * into every storefront page automatically — no theme editor step required.
 * Call this once, right after the merchant installs the Shopify app.
 */
export async function registerWidgetScriptTag(shop: string, accessToken: string): Promise<number> {
  const src = `${env.backendPublicUrl}/widget.js`;

  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/script_tags.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      script_tag: { event: "onload", src, display_scope: "online_store" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify ScriptTag registration failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as ScriptTagResponse;
  return data.script_tag.id;
}

export async function removeWidgetScriptTag(shop: string, accessToken: string, scriptTagId: number): Promise<void> {
  const res = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/script_tags/${scriptTagId}.json`,
    {
      method: "DELETE",
      headers: { "X-Shopify-Access-Token": accessToken },
    }
  );

  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Shopify ScriptTag removal failed (${res.status}): ${text}`);
  }
}

// --- Fallback for apps that can no longer use ScriptTags at all ---------
// Shopify rejects ScriptTag creation for every app created after its cutoff
// date ("This app can't create or update script tags. Use theme app
// extensions instead."). A real theme app extension would need its own
// extension code deployed per connecting app, which defeats the "one API
// call, zero code" promise this install endpoint makes. Writing the widget
// script directly into the active theme's layout file via the (still fully
// supported, not deprecated) Theme Assets API gets the same zero-code-change
// result for the connecting app, as long as its access token has the
// write_themes scope.

const WIDGET_MARKER_START = "<!-- chat-support-widget:start -->";
const WIDGET_MARKER_END = "<!-- chat-support-widget:end -->";

async function shopifyFetch(shop: string, accessToken: string, path: string, init?: RequestInit) {
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function getMainThemeId(shop: string, accessToken: string): Promise<number> {
  const data = (await shopifyFetch(shop, accessToken, "/themes.json")) as {
    themes: Array<{ id: number; role: string }>;
  };
  const main = data.themes.find((t) => t.role === "main");
  if (!main) throw new Error("No published (main) theme found");
  return main.id;
}

async function getThemeLiquid(shop: string, accessToken: string, themeId: number): Promise<string> {
  const data = (await shopifyFetch(
    shop,
    accessToken,
    `/themes/${themeId}/assets.json?asset[key]=layout/theme.liquid`
  )) as { asset: { value: string } };
  return data.asset.value;
}

async function putThemeLiquid(shop: string, accessToken: string, themeId: number, value: string): Promise<void> {
  await shopifyFetch(shop, accessToken, `/themes/${themeId}/assets.json`, {
    method: "PUT",
    body: JSON.stringify({ asset: { key: "layout/theme.liquid", value } }),
  });
}

/** Injects the widget script tag directly into the live theme, idempotently. */
export async function injectWidgetViaThemeAsset(shop: string, accessToken: string): Promise<void> {
  const themeId = await getMainThemeId(shop, accessToken);
  const liquid = await getThemeLiquid(shop, accessToken, themeId);
  if (liquid.includes(WIDGET_MARKER_START)) return; // already injected

  const src = `${env.backendPublicUrl}/widget.js`;
  const snippet = `${WIDGET_MARKER_START}\n<script defer src="${src}" data-shop="{{ shop.permanent_domain }}"></script>\n${WIDGET_MARKER_END}\n`;
  const updated = liquid.includes("</body>")
    ? liquid.replace("</body>", `${snippet}</body>`)
    : liquid + snippet;

  await putThemeLiquid(shop, accessToken, themeId, updated);
}

/** Strips the injected snippet back out, best-effort (used on app uninstall). */
export async function removeWidgetFromThemeAsset(shop: string, accessToken: string): Promise<void> {
  const themeId = await getMainThemeId(shop, accessToken);
  const liquid = await getThemeLiquid(shop, accessToken, themeId);
  const start = liquid.indexOf(WIDGET_MARKER_START);
  const end = liquid.indexOf(WIDGET_MARKER_END);
  if (start === -1 || end === -1) return; // not injected (or already removed)

  const updated = liquid.slice(0, start) + liquid.slice(end + WIDGET_MARKER_END.length + 1);
  await putThemeLiquid(shop, accessToken, themeId, updated);
}

/**
 * Installs the widget by whichever method actually works for this app.
 * Shopify blocks ScriptTag creation outright for every app created after its
 * cutoff date -- that's the common case now -- so this tries it first and
 * silently falls back to writing straight into the theme's layout file,
 * which isn't deprecated and needs no extension of its own. Either way the
 * connecting app's own code never has to change.
 */
export async function installWidget(
  shop: string,
  accessToken: string
): Promise<{ scriptTagId: string | null; installMethod: string }> {
  try {
    const scriptTagId = String(await registerWidgetScriptTag(shop, accessToken));
    return { scriptTagId, installMethod: "scripttag" };
  } catch (err) {
    console.warn(`[shopify] ScriptTag install failed for ${shop}, falling back to theme injection:`, err);
    await injectWidgetViaThemeAsset(shop, accessToken);
    return { scriptTagId: null, installMethod: "theme" };
  }
}
