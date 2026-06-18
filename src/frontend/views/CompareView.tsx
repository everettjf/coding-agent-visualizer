import { useEffect, useMemo, useState } from "react";
import type { SessionSummary, UnifiedSession } from "../../lib/types";
import { computeStats, fmtDuration, fmtTokens } from "../../lib/stats";
import { fmtCost } from "../../lib/pricing";
import { SourceBadge } from "../ui";

// Pick two sessions and diff them metric-by-metric — built for "what changed
// when I tweaked the prompt / the agent config" comparisons.

function useSession(path: string | null): UnifiedSession | null {
  const [session, setSession] = useState<UnifiedSession | null>(null);
  useEffect(() => {
    setSession(null);
    if (!path) return;
    let cancelled = false;
    fetch(`/api/session?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((s: UnifiedSession) => !cancelled && setSession(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [path]);
  return session;
}

function Picker({
  label,
  sessions,
  value,
  onChange,
}: {
  label: string;
  sessions: SessionSummary[];
  value: string | null;
  onChange: (path: string | null) => void;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <select
        className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Select a session…</option>
        {sessions.map((s) => (
          <option key={s.filePath} value={s.filePath}>
            [{s.source}] {s.title}
          </option>
        ))}
      </select>
    </label>
  );
}

interface Metric {
  label: string;
  a: number;
  b: number;
  fmt: (n: number) => string;
  /** When true, a lower value is "better" (shown green). */
  lowerBetter?: boolean;
}

function Delta({ m }: { m: Metric }) {
  const d = m.b - m.a;
  if (m.a === 0 && m.b === 0) return <span className="text-muted">—</span>;
  if (d === 0) return <span className="text-muted">±0</span>;
  const pct = m.a === 0 ? null : (d / m.a) * 100;
  const good = m.lowerBetter ? d < 0 : d > 0;
  return (
    <span className={good ? "text-emerald-400" : "text-rose-400"}>
      {d > 0 ? "+" : ""}
      {m.fmt(d)}
      {pct != null ? ` (${d > 0 ? "+" : ""}${pct.toFixed(0)}%)` : ""}
    </span>
  );
}

export function CompareView({ sessions }: { sessions: SessionSummary[] }) {
  const [aPath, setAPath] = useState<string | null>(null);
  const [bPath, setBPath] = useState<string | null>(null);
  const a = useSession(aPath);
  const b = useSession(bPath);

  // computeStats walks every node, so derive each session's stats once and
  // share them across the metric table and the tool diff.
  const sa = useMemo(() => (a ? computeStats(a) : null), [a]);
  const sb = useMemo(() => (b ? computeStats(b) : null), [b]);

  const metrics = useMemo<Metric[] | null>(() => {
    if (!a || !b || !sa || !sb) return null;
    return [
      { label: "Duration", a: sa.durationMs, b: sb.durationMs, fmt: fmtDuration, lowerBetter: true },
      { label: "Messages", a: sa.totals.user + sa.totals.assistant, b: sb.totals.user + sb.totals.assistant, fmt: String },
      { label: "Tool calls", a: sa.totals.tool, b: sb.totals.tool, fmt: String },
      { label: "Files touched", a: sa.files.length, b: sb.files.length, fmt: String },
      { label: "Input tokens", a: sa.totals.inputTokens, b: sb.totals.inputTokens, fmt: fmtTokens, lowerBetter: true },
      { label: "Output tokens", a: sa.totals.outputTokens, b: sb.totals.outputTokens, fmt: fmtTokens, lowerBetter: true },
      { label: "Cache tokens", a: sa.totals.cacheTokens, b: sb.totals.cacheTokens, fmt: fmtTokens },
      { label: "Total tokens", a: a.totalTokens, b: b.totalTokens, fmt: fmtTokens, lowerBetter: true },
      { label: "Est. cost", a: sa.costUsd, b: sb.costUsd, fmt: (n) => fmtCost(n), lowerBetter: true },
    ];
  }, [a, b, sa, sb]);

  const tools = useMemo(() => {
    if (!sa || !sb) return null;
    const names = new Set([...sa.tools.map((t) => t.name), ...sb.tools.map((t) => t.name)]);
    const ca = new Map(sa.tools.map((t) => [t.name, t.count]));
    const cb = new Map(sb.tools.map((t) => [t.name, t.count]));
    return [...names]
      .map((name) => ({ name, a: ca.get(name) ?? 0, b: cb.get(name) ?? 0 }))
      .sort((x, y) => y.a + y.b - (x.a + x.b));
  }, [sa, sb]);

  return (
    <div className="h-full overflow-auto p-5">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Picker label="Session A" sessions={sessions} value={aPath} onChange={setAPath} />
        <Picker label="Session B" sessions={sessions} value={bPath} onChange={setBPath} />
      </div>

      {(!a || !b) && (
        <div className="loading-center muted mt-10">
          {aPath && !a ? "Loading A…" : bPath && !b ? "Loading B…" : "Pick two sessions to compare."}
        </div>
      )}

      {a && b && metrics && (
        <>
          <div className="mt-5 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-panel p-4 text-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Metric</div>
            <div className="flex items-center justify-end gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <SourceBadge source={a.source} /> A
            </div>
            <div className="flex items-center justify-end gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <SourceBadge source={b.source} /> B
            </div>
            <div className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted">Δ B−A</div>
            {metrics.map((m) => (
              <div key={m.label} className="contents">
                <div className="border-t border-border py-2">{m.label}</div>
                <div className="border-t border-border py-2 text-right tabular-nums">{m.fmt(m.a)}</div>
                <div className="border-t border-border py-2 text-right tabular-nums">{m.fmt(m.b)}</div>
                <div className="border-t border-border py-2 text-right tabular-nums">
                  <Delta m={m} />
                </div>
              </div>
            ))}
          </div>

          {tools && tools.length > 0 && (
            <section className="mt-4 rounded-xl border border-border bg-panel p-4">
              <h3 className="mb-3 text-sm font-semibold">Tool usage</h3>
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-1 text-sm">
                {tools.map((t) => (
                  <div key={t.name} className="contents">
                    <div className="border-t border-border py-1.5 font-mono text-xs">{t.name}</div>
                    <div className="border-t border-border py-1.5 text-right tabular-nums">{t.a}</div>
                    <div className="border-t border-border py-1.5 text-right tabular-nums">{t.b}</div>
                    <div className="border-t border-border py-1.5 text-right tabular-nums">
                      {t.b - t.a === 0 ? (
                        <span className="text-muted">±0</span>
                      ) : (
                        <span className={t.b > t.a ? "text-rose-400" : "text-emerald-400"}>
                          {t.b > t.a ? "+" : ""}
                          {t.b - t.a}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
