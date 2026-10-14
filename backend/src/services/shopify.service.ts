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
// extensions instead."). Writing the widget script directly into the theme
// was tried next (both REST PUT and the themeFilesUpsert GraphQL mutation)
// but both are gated behind a write_themes-plus-Shopify-granted-exemption
// requirement -- confirmed live 2026-10-14, not something any amount of
// retrying or code changes gets around. installWidget() below now just
// returns a copy-paste snippet instead when ScriptTag isn't available;
// these two functions are kept for the rare app that already holds that
// exemption (e.g. from before Shopify locked this down).

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

// Confirmed live (2026-10-14): the REST PUT .../assets.json write path 404s
// even with a valid write_themes token, while the same GET still works fine
// -- Shopify has evidently restricted the REST write side the same way it
// restricted ScriptTags, without a corresponding error message pointing
// anywhere. The themeFilesUpsert GraphQL mutation is the current supported
// replacement for writing theme files and isn't affected.
async function putThemeLiquid(shop: string, accessToken: string, themeId: number, value: string): Promise<void> {
  const query = `
    mutation ThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
      themeFilesUpsert(themeId: $themeId, files: $files) {
        upsertedThemeFiles { filename }
        userErrors { field message }
      }
    }`;
  const variables = {
    themeId: `gid://shopify/OnlineStoreTheme/${themeId}`,
    files: [{ filename: "layout/theme.liquid", body: { type: "TEXT", value } }],
  };

  const data = (await shopifyFetch(shop, accessToken, "/graphql.json", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  })) as {
    data?: { themeFilesUpsert: { userErrors: Array<{ field: string[]; message: string }> } };
    errors?: Array<{ message: string }>;
  };

  if (data.errors?.length) {
    throw new Error(`themeFilesUpsert GraphQL error: ${data.errors.map((e) => e.message).join("; ")}`);
  }
  const userErrors = data.data?.themeFilesUpsert.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(`themeFilesUpsert failed: ${userErrors.map((e) => e.message).join("; ")}`);
  }
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

/** The install snippet to paste once into the theme, manual-install fallback. */
export function buildWidgetSnippet(shop: string): string {
  const src = `${env.backendPublicUrl}/widget.js`;
  return `<script defer src="${src}" data-shop="${shop}"></script>`;
}

/**
 * Installs the widget by whichever method actually works for this app.
 * ScriptTag creation is blocked for every app created after Shopify's
 * cutoff date -- the common case now -- and direct theme-file writes
 * (REST or GraphQL) are gated behind an exemption Shopify grants per app,
 * not something obtainable here. So the fallback is a one-time manual
 * snippet paste into the theme instead of a second silent API attempt that
 * would just fail the same way.
 */
export async function installWidget(
  shop: string,
  accessToken: string
): Promise<{ scriptTagId: string | null; installMethod: string; snippet: string | null }> {
  try {
    const scriptTagId = String(await registerWidgetScriptTag(shop, accessToken));
    return { scriptTagId, installMethod: "scripttag", snippet: null };
  } catch (err) {
    console.warn(`[shopify] ScriptTag install failed for ${shop}, falling back to a manual snippet:`, err);
    return { scriptTagId: null, installMethod: "manual", snippet: buildWidgetSnippet(shop) };
  }
}
