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
