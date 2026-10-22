import { useEffect, useState } from "react";
import { api } from "../api/client";

interface AnalyticsData {
  windowDays: number;
  total: number;
  byStatus: Record<string, number>;
  byApp: Record<string, number>;
  avgCsat: number | null;
  csatCount: number;
  avgFirstResponseMinutes: number | null;
  respondedCount: number;
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  BOT_HANDLED: "Bot handled",
  NEEDS_HUMAN: "Needs human",
  CLAIMED: "Claimed",
  CLOSED: "Closed",
};

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 60 * 24) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / (60 * 24)).toFixed(1)}d`;
}

export function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    api.get("/analytics").then((res) => setData(res.data));
  }, []);

  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div className="analytics-page">
      <div className="page-header">
        <h2>Analytics</h2>
        <p className="muted">Last {data.windowDays} days, across every connected app.</p>
      </div>

      <div className="stats-bar">
        <div className="stat-tile">
          <span className="stat-value">{data.total}</span>
          <span className="stat-label">Conversations</span>
        </div>
        <div className="stat-tile stat-tile--info">
          <span className="stat-value">{data.avgFirstResponseMinutes != null ? formatMinutes(data.avgFirstResponseMinutes) : "—"}</span>
          <span className="stat-label">Avg first response ({data.respondedCount} replied)</span>
        </div>
        <div className="stat-tile stat-tile--success">
          <span className="stat-value">{data.avgCsat != null ? `${data.avgCsat.toFixed(1)} ⭐` : "—"}</span>
          <span className="stat-label">Avg rating ({data.csatCount} rated)</span>
        </div>
      </div>

      <div className="analytics-columns">
        <div className="analytics-card">
          <h3>By status</h3>
          <ul className="analytics-breakdown">
            {Object.entries(data.byStatus).map(([status, count]) => (
              <li key={status}>
                <span className={`badge badge-${status.toLowerCase()}`}>{STATUS_LABELS[status] ?? status}</span>
                <span>{count}</span>
              </li>
            ))}
            {Object.keys(data.byStatus).length === 0 && <li className="muted">No conversations yet.</li>}
          </ul>
        </div>

        <div className="analytics-card">
          <h3>By app</h3>
          <ul className="analytics-breakdown">
            {Object.entries(data.byApp)
              .sort((a, b) => b[1] - a[1])
              .map(([app, count]) => (
                <li key={app}>
                  <span>{app}</span>
                  <span>{count}</span>
                </li>
              ))}
            {Object.keys(data.byApp).length === 0 && <li className="muted">No conversations yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
