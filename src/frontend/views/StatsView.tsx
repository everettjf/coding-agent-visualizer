import type { UnifiedSession } from "../../lib/types";
import { computeStats, fmtDuration, fmtTokens } from "../../lib/stats";
import { Bar, Sparkline, StatCard } from "../charts";

const TOOL_COLOR = "#f59e0b";

export function StatsView({ session }: { session: UnifiedSession }) {
  const stats = computeStats(session);
  const tokenSeries = stats.timeline.map((p) => p.cumulativeTokens);
  const maxToolCount = stats.tools.reduce((m, t) => Math.max(m, t.count), 0);

  return (
    <div className="view scroll">
      <div className="stat-grid">
        <StatCard label="Duration" value={fmtDuration(stats.durationMs)} accent="#4f9cf9" />
        <StatCard label="Messages" value={stats.totals.user + stats.totals.assistant} sub={`${stats.totals.user} user · ${stats.totals.assistant} assistant`} accent="#22c55e" />
        <StatCard label="Tool calls" value={stats.totals.tool} sub={`${stats.tools.length} distinct tools`} accent="#f59e0b" />
        <StatCard label="Files touched" value={stats.files.length} accent="#a78bfa" />
        <StatCard label="Input tokens" value={fmtTokens(stats.totals.inputTokens)} accent="#06b6d4" />
        <StatCard label="Output tokens" value={fmtTokens(stats.totals.outputTokens)} accent="#ec4899" />
        <StatCard label="Cache tokens" value={fmtTokens(stats.totals.cacheTokens)} accent="#64748b" />
        <StatCard label="Reasoning blocks" value={stats.totals.reasoning} accent="#a78bfa" />
      </div>

      <section className="panel-block">
        <h3>Cumulative tokens</h3>
        <Sparkline points={tokenSeries} color="#4f9cf9" height={72} />
      </section>

      <section className="panel-block">
        <h3>Tool usage</h3>
        {stats.tools.length === 0 && <div className="muted">No tool calls.</div>}
        <div className="tool-list">
          {stats.tools.map((t) => (
            <div className="tool-row" key={t.name}>
              <span className="tool-name">{t.name}</span>
              <Bar value={t.count} max={maxToolCount} color={TOOL_COLOR} />
              <span className="tool-count">
                {t.count}
                {t.errors > 0 && <span className="err"> · {t.errors} err</span>}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
