import { useEffect, useState } from "react";
import { Line, Bar, Doughnut } from "react-chartjs-2";
import "../lib/charts";
import type { Analytics } from "../../lib/analytics";
import { fmtTokens } from "../../lib/stats";
import { fmtCost } from "../../lib/pricing";

const SOURCE_COLOR: Record<string, string> = {
  "claude-code": "#22c55e",
  codex: "#4f9cf9",
  gemini: "#a78bfa",
};

function Card({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div
      className="rounded-xl border border-border bg-panel-2 p-4"
      style={{ borderTopColor: accent, borderTopWidth: 2 }}
    >
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </div>
  );
}

export function AnalyticsView() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    fetch("/api/analytics")
      .then((r) => r.json())
      .then((d: Analytics) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <div className="loading-center muted">Failed to load analytics.</div>;
  }
  if (!data) {
    return (
      <div className="loading-center">
        <span className="spinner spinner-lg" />
        <span className="muted small">Aggregating every session…</span>
      </div>
    );
  }
  if (!data.sessionCount) {
    return <div className="loading-center muted">No sessions to analyze yet.</div>;
  }

  const daily = {
    labels: data.daily.map((d) => d.date),
    datasets: [
      {
        data: data.daily.map((d) => d.tokens),
        borderColor: "#4f9cf9",
        backgroundColor: "rgba(79,156,249,0.15)",
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  };

  const sourceDoughnut = {
    labels: data.bySource.map((s) => s.name),
    datasets: [
      {
        data: data.bySource.map((s) => s.tokens),
        backgroundColor: data.bySource.map((s) => SOURCE_COLOR[s.name] ?? "#64748b"),
        borderColor: "#151821",
        borderWidth: 2,
      },
    ],
  };

  const toolsBar = {
    labels: data.topTools.map((t) => t.name),
    datasets: [{ data: data.topTools.map((t) => t.count), backgroundColor: "#f59e0b", borderRadius: 4 }],
  };

  const projectsBar = {
    labels: data.topProjects.map((p) => p.name),
    datasets: [{ data: data.topProjects.map((p) => p.tokens), backgroundColor: "#a78bfa", borderRadius: 4 }],
  };

  return (
    <div className="h-full overflow-auto p-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Card label="Sessions" value={data.sessionCount} accent="#4f9cf9" />
        <Card label="Est. cost" value={fmtCost(data.totalCost)} accent="#22c55e" />
        <Card label="Total tokens" value={fmtTokens(data.totalTokens)} accent="#ec4899" />
        <Card label="Tool calls" value={data.totalToolCalls.toLocaleString()} accent="#f59e0b" />
        <Card label="Active days" value={data.daily.length} accent="#a78bfa" />
      </div>

      <section className="mt-5 rounded-xl border border-border bg-panel p-4">
        <h3 className="mb-3 text-sm font-semibold">Token cost over time</h3>
        <div className="h-56">
          <Line
            data={daily}
            options={{
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: { x: { ticks: { maxTicksLimit: 8 } } },
            }}
          />
        </div>
      </section>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-border bg-panel p-4">
          <h3 className="mb-3 text-sm font-semibold">Tokens by source</h3>
          <div className="h-56">
            <Doughnut
              data={sourceDoughnut}
              options={{ maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }}
            />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-panel p-4 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold">Tool usage trends</h3>
          {data.topTools.length === 0 ? (
            <div className="text-muted">No tool calls.</div>
          ) : (
            <div style={{ height: Math.max(160, data.topTools.length * 24) }}>
              <Bar
                data={toolsBar}
                options={{
                  indexAxis: "y",
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: { y: { grid: { display: false } } },
                }}
              />
            </div>
          )}
        </section>
      </div>

      <section className="mt-4 rounded-xl border border-border bg-panel p-4">
        <h3 className="mb-3 text-sm font-semibold">Top projects by tokens</h3>
        <div style={{ height: Math.max(160, data.topProjects.length * 26) }}>
          <Bar
            data={projectsBar}
            options={{
              indexAxis: "y",
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: { y: { grid: { display: false } } },
            }}
          />
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-border bg-panel p-4">
        <h3 className="mb-3 text-sm font-semibold">By model</h3>
        <div className="flex flex-col gap-2">
          {data.byModel.map((m) => (
            <div key={m.name} className="flex items-center gap-3 text-sm">
              <span className="w-48 truncate font-mono text-xs">{m.name}</span>
              <span className="text-muted">{m.sessions} sessions</span>
              <span className="ml-auto tabular-nums text-muted">{fmtTokens(m.tokens)} tok</span>
              <span className="w-20 text-right tabular-nums text-emerald-400">
                {m.cost > 0 ? fmtCost(m.cost) : "—"}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
