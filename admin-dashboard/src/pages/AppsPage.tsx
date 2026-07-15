import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

interface ShopifyAppRow {
  id: number;
  name: string;
  shop: string;
  scriptTagId: string | null;
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

  const removeKeyword = async (id: number) => {
    if (!selectedAppId) return;
    await api.delete(`/apps/${selectedAppId}/keywords/${id}`);
    setKeywords((prev) => prev.filter((k) => k.id !== id));
  };

  const registerScriptTag = async (appId: number) => {
    await api.post(`/apps/${appId}/scripttag`);
    loadApps();
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
              <td>{a.scriptTagId ? "Widget live" : "Not installed"}</td>
              <td>
                <button onClick={() => setSelectedAppId(a.id)}>Manage bot</button>
                {admin?.role === "SUPER_ADMIN" && !a.scriptTagId && (
                  <button onClick={() => registerScriptTag(a.id)}>Install widget</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedAppId && (
        <div className="bot-keywords">
          <h3>FAQ bot keywords — {apps.find((a) => a.id === selectedAppId)?.name}</h3>
          <ul>
            {keywords.map((k) => (
              <li key={k.id}>
                <strong>{k.keyword}</strong> → {k.answer}
                <button onClick={() => removeKeyword(k.id)}>Remove</button>
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
    </div>
  );
}
