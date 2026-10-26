import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

interface ShopifyAppRow {
  id: number;
  name: string;
  shop: string;
  scriptTagId: string | null;
  installMethod: "scripttag" | "manual" | null;
}

export function AppsPage() {
  const { admin } = useAuth();
  const [apps, setApps] = useState<ShopifyAppRow[]>([]);
  const [snippetAppId, setSnippetAppId] = useState<number | null>(null);
  const [snippet, setSnippet] = useState("");
  const [copied, setCopied] = useState(false);
  const [shopSearch, setShopSearch] = useState("");

  const filteredApps = apps.filter(
    (a) =>
      !shopSearch.trim() ||
      a.name.toLowerCase().includes(shopSearch.trim().toLowerCase()) ||
      a.shop.toLowerCase().includes(shopSearch.trim().toLowerCase())
  );

  const loadApps = () => api.get("/apps").then((res) => setApps(res.data.apps));

  useEffect(() => {
    loadApps();
  }, []);

  const registerScriptTag = async (appId: number) => {
    const res = await api.post(`/apps/${appId}/scripttag`);
    loadApps();
    if (res.data.snippet) {
      setSnippetAppId(appId);
      setSnippet(res.data.snippet);
      setCopied(false);
    }
  };

  const viewSnippet = async (appId: number) => {
    const res = await api.get(`/apps/${appId}/snippet`);
    setSnippetAppId(appId);
    setSnippet(res.data.snippet);
    setCopied(false);
  };

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) -- the textarea
      // below is already selectable/copyable by hand either way.
    }
  };

  return (
    <div className="apps-page">
      <h2>Apps</h2>

      {/* The rows below are every SHOP that installed this one product (the
          storefront Chat Widget) -- not separate apps. Grouped under a
          single product card so it doesn't read as a flat list of "apps". */}
      <details className="app-product-card" open>
        <summary>
          💬 Chat Widget <span className="app-product-count">{apps.length} shop{apps.length === 1 ? "" : "s"} connected</span>
        </summary>

        <input
          type="search"
          className="inbox-search app-product-search"
          placeholder="Search by shop name or domain…"
          value={shopSearch}
          onChange={(e) => setShopSearch(e.target.value)}
        />

        <table className="admin-table">
          <thead>
            <tr>
              <th>Shop</th>
              <th>Domain</th>
              <th>Widget status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredApps.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.shop}</td>
                <td>
                  {a.installMethod === "manual"
                    ? "Needs manual snippet paste"
                    : a.installMethod === "scripttag"
                      ? "Widget live (script tag)"
                      : "Not installed"}
                </td>
                <td>
                  {admin?.role === "SUPER_ADMIN" && !a.installMethod && (
                    <button onClick={() => registerScriptTag(a.id)}>Install widget</button>
                  )}
                  {a.installMethod === "manual" && <button onClick={() => viewSnippet(a.id)}>View snippet</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      {snippetAppId && (
        <div className="modal-overlay" onClick={() => setSnippetAppId(null)}>
          <div className="modal-card modal-card--wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="snippet-title">
            <h3 id="snippet-title">Install snippet — {apps.find((a) => a.id === snippetAppId)?.name}</h3>
            <p>
              ScriptTag auto-install isn't available for this app (Shopify restriction). Paste this once into the
              store's <code>theme.liquid</code>, right before <code>&lt;/body&gt;</code>, and the widget shows up
              immediately — no further setup needed after that.
            </p>
            <textarea readOnly value={snippet} rows={2} onClick={(e) => e.currentTarget.select()} />
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setSnippetAppId(null)} autoFocus>
                Close
              </button>
              <button onClick={copySnippet}>{copied ? "Copied!" : "Copy snippet"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
