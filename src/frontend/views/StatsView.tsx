import { useMemo } from "react";
import { Line, Bar, Doughnut } from "react-chartjs-2";
import "../lib/charts";
import type { UnifiedSession } from "../../lib/types";
import { computeStats, fmtDuration, fmtTokens } from "../../lib/stats";
import { fmtCost, modelPrice } from "../../lib/pricing";

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent: string;
}) {
  return (
    <div
      className="rounded-xl border border-border bg-panel-2 p-4"
      style={{ borderTopColor: accent, borderTopWidth: 2 }}
    >
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
      {sub && <div className="mt-1 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function StatsView({ session }: { session: UnifiedSession }) {
  const stats = useMemo(() => computeStats(session), [session]);

  const tokenLine = useMemo(
    () => ({
      labels: stats.timeline.map((_, i) => i),
      datasets: [
        {
          data: stats.timeline.map((p) => p.cumulativeTokens),
          borderColor: "#4f9cf9",
          backgroundColor: "rgba(79,156,249,0.15)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    }),
    [stats],
  );

  const toolBar = useMemo(() => {
    const top = stats.tools.slice(0, 12);
    return {
      labels: top.map((t) => t.name),
      datasets: [
        {
          data: top.map((t) => t.count),
          backgroundColor: "#f59e0b",
          borderRadius: 4,
        },
      ],
    };
  }, [stats]);

  const tokenDoughnut = useMemo(
    () => ({
      labels: ["Input", "Output", "Cache"],
      datasets: [
        {
          data: [
            stats.totals.inputTokens,
            stats.totals.outputTokens,
            stats.totals.cacheTokens,
          ],
          backgroundColor: ["#06b6d4", "#ec4899", "#64748b"],
          borderColor: "#151821",
          borderWidth: 2,
        },
      ],
    }),
    [stats],
  );

  return (
    <div className="h-full overflow-auto p-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Duration" value={fmtDuration(stats.durationMs)} accent="#4f9cf9" />
        <StatCard
          label="Messages"
          value={stats.totals.user + stats.totals.assistant}
          sub={`${stats.totals.user} user · ${stats.totals.assistant} assistant`}
          accent="#22c55e"
        />
        <StatCard
          label="Tool calls"
          value={stats.totals.tool}
          sub={`${stats.tools.length} distinct`}
          accent="#f59e0b"
        />
        <StatCard
          label="Estimated cost"
          value={modelPrice(session.model) ? fmtCost(stats.costUsd) : "—"}
          sub={modelPrice(session.model) ? session.model : "unpriced model"}
          accent="#22c55e"
        />
        <StatCard label="Files touched" value={stats.files.length} accent="#a78bfa" />
        <StatCard label="Input tokens" value={fmtTokens(stats.totals.inputTokens)} accent="#06b6d4" />
        <StatCard label="Output tokens" value={fmtTokens(stats.totals.outputTokens)} accent="#ec4899" />
        <StatCard label="Cache tokens" value={fmtTokens(stats.totals.cacheTokens)} accent="#64748b" />
        <StatCard label="Reasoning blocks" value={stats.totals.reasoning} accent="#a78bfa" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-border bg-panel p-4 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold">Cumulative tokens</h3>
          <div className="h-56">
            <Line
              data={tokenLine}
              options={{
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { display: false } },
              }}
            />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-panel p-4">
          <h3 className="mb-3 text-sm font-semibold">Token breakdown</h3>
          <div className="h-56">
            <Doughnut
              data={tokenDoughnut}
              options={{ maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }}
            />
          </div>
        </section>
      </div>

      <section className="mt-4 rounded-xl border border-border bg-panel p-4">
        <h3 className="mb-3 text-sm font-semibold">Tool usage</h3>
        {stats.tools.length === 0 ? (
          <div className="text-muted">No tool calls.</div>
        ) : (
          <div style={{ height: Math.max(140, stats.tools.slice(0, 12).length * 28) }}>
            <Bar
              data={toolBar}
              options={{
                indexAxis: "y",
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { grid: { display: true } }, y: { grid: { display: false } } },
              }}
            />
          </div>
        )}
      </section>
    </div>
  );
}
