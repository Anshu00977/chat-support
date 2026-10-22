import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { ConfirmDialog } from "../components/ConfirmDialog";

interface ShopifyAppRow {
  id: number;
  name: string;
  shop: string;
  scriptTagId: string | null;
  installMethod: "scripttag" | "manual" | null;
}

interface BotKeyword {
  id: number;
  keyword: string;
  answer: string;
}

export function AppsPage() {
  const { admin } = useAuth();
  const [apps, setApps] = useState<ShopifyAppRow[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);
  const [keywords, setKeywords] = useState<BotKeyword[]>([]);
  const [keyword, setKeyword] = useState("");
  const [answer, setAnswer] = useState("");
  const [snippetAppId, setSnippetAppId] = useState<number | null>(null);
  const [snippet, setSnippet] = useState("");
  const [copied, setCopied] = useState(false);
  const [removingKeywordId, setRemovingKeywordId] = useState<number | null>(null);

  const loadApps = () => api.get("/apps").then((res) => setApps(res.data.apps));

  useEffect(() => {
    loadApps();
  }, []);

  useEffect(() => {
    if (selectedAppId) {
      api.get(`/apps/${selectedAppId}/keywords`).then((res) => setKeywords(res.data.keywords));
    }
  }, [selectedAppId]);

  const addKeyword = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedAppId) return;
    await api.post(`/apps/${selectedAppId}/keywords`, { keyword, answer });
    setKeyword("");
    setAnswer("");
    const res = await api.get(`/apps/${selectedAppId}/keywords`);
    setKeywords(res.data.keywords);
  };

  const confirmRemoveKeyword = async () => {
    if (!selectedAppId || !removingKeywordId) return;
    await api.delete(`/apps/${selectedAppId}/keywords/${removingKeywordId}`);
    setKeywords((prev) => prev.filter((k) => k.id !== removingKeywordId));
    setRemovingKeywordId(null);
  };

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
      <h2>Connected Shopify apps</h2>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Shop</th>
            <th>Widget status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {apps.map((a) => (
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
                <button onClick={() => setSelectedAppId(a.id)}>Manage bot</button>
                {admin?.role === "SUPER_ADMIN" && !a.installMethod && (
                  <button onClick={() => registerScriptTag(a.id)}>Install widget</button>
                )}
                {a.installMethod === "manual" && <button onClick={() => viewSnippet(a.id)}>View snippet</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {snippetAppId && (
        <div className="snippet-panel">
          <h3>Install snippet — {apps.find((a) => a.id === snippetAppId)?.name}</h3>
          <p>
            ScriptTag auto-install isn't available for this app (Shopify restriction). Paste this once into the
            store's <code>theme.liquid</code>, right before <code>&lt;/body&gt;</code>, and the widget shows up
            immediately — no further setup needed after that.
          </p>
          <textarea readOnly value={snippet} rows={2} onClick={(e) => e.currentTarget.select()} />
          <div className="snippet-actions">
            <button onClick={copySnippet}>{copied ? "Copied!" : "Copy snippet"}</button>
            <button onClick={() => setSnippetAppId(null)}>Close</button>
          </div>
        </div>
      )}

      {selectedAppId && (
        <div className="bot-keywords">
          <h3>FAQ bot keywords — {apps.find((a) => a.id === selectedAppId)?.name}</h3>
          <ul>
            {keywords.map((k) => (
              <li key={k.id}>
                <strong>{k.keyword}</strong> → {k.answer}
                <button onClick={() => setRemovingKeywordId(k.id)}>Remove</button>
              </li>
            ))}
          </ul>
          <form onSubmit={addKeyword} className="keyword-form">
            <input placeholder="Keyword (e.g. refund)" value={keyword} onChange={(e) => setKeyword(e.target.value)} required />
            <input placeholder="Auto-reply answer" value={answer} onChange={(e) => setAnswer(e.target.value)} required />
            <button type="submit">Add</button>
          </form>
        </div>
      )}

      {removingKeywordId && (
        <ConfirmDialog
          title="Remove this keyword?"
          message="Customer messages matching it will no longer get an automatic bot answer."
          confirmLabel="Remove"
          danger
          onConfirm={confirmRemoveKeyword}
          onCancel={() => setRemovingKeywordId(null)}
        />
      )}
    </div>
  );
}
