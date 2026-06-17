import { useMemo } from "react";
import type { SessionNode, UnifiedSession } from "../../lib/types";
import { buildTrace, fmtDuration } from "../../lib/stats";
import { roleColor, roleLabel, nodeIcon } from "../ui";

// A distributed-tracing-style waterfall: every event is a span, indented by tree
// depth, positioned on a shared time axis, width = inferred duration. This is the
// view LangSmith / Langfuse / Phoenix / Jaeger converged on for agent traces.
export function WaterfallView({
  session,
  activeId,
  onSelect,
}: {
  session: UnifiedSession;
  activeId: string | null;
  onSelect: (n: SessionNode) => void;
}) {
  const { spans, totalMs } = useMemo(() => buildTrace(session), [session]);

  if (!spans.length) {
    return (
      <div className="p-6 text-muted">No timestamped events to chart.</div>
    );
  }

  // Sparse axis ticks across the duration.
  const ticks = Array.from({ length: 5 }, (_, i) => (totalMs * i) / 4);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold">Execution waterfall</h3>
          <p className="text-xs text-muted">
            {spans.length} spans · {fmtDuration(totalMs)} · width = inferred
            duration, indent = call depth
          </p>
        </div>
      </div>

      {/* Time axis */}
      <div className="relative ml-[260px] mr-4 h-5 shrink-0 border-b border-border text-[10px] text-muted">
        {ticks.map((t, i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 tabular-nums"
            style={{ left: `${(t / totalMs) * 100}%` }}
          >
            {fmtDuration(t)}
          </span>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {spans.map((s) => {
          const color = roleColor(s.node.role);
          const Icon = nodeIcon(s.node.role, s.node.tool?.name);
          const left = (s.start / totalMs) * 100;
          const width = Math.max((s.duration / totalMs) * 100, 0.5);
          const label =
            s.node.role === "tool"
              ? s.node.tool?.name ?? "tool"
              : roleLabel(s.node.role);
          const preview = (s.node.text ?? s.node.thinking ?? "")
            .replace(/\s+/g, " ")
            .slice(0, 60);
          const active = s.node.id === activeId;

          return (
            <button
              key={s.node.id}
              onClick={() => onSelect(s.node)}
              className={`group flex w-full items-center gap-2 px-2 py-[3px] text-left hover:bg-white/5 ${
                active ? "bg-white/[0.07]" : ""
              }`}
            >
              {/* Label column (fixed width, indented by sub-agent depth).
                  Cap the indent so labels never get pushed out of the column. */}
              <div
                className="flex w-[250px] shrink-0 items-center gap-1.5 overflow-hidden"
                style={{ paddingLeft: Math.min(s.depth, 10) * 12 }}
              >
                <Icon size={12} style={{ color }} className="shrink-0" />
                <span className="shrink-0 text-xs" style={{ color }}>
                  {label}
                </span>
                {s.node.tool?.isError && (
                  <span className="shrink-0 text-[10px] text-red-400">err</span>
                )}
                <span className="truncate text-[11px] text-muted">{preview}</span>
              </div>

              {/* Track */}
              <div className="relative h-4 flex-1">
                <div
                  className={`absolute top-0 h-4 rounded ${active ? "ring-1 ring-white/60" : ""}`}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: color,
                    opacity: s.node.role === "reasoning" ? 0.55 : 0.85,
                  }}
                />
                {s.duration > 0 && width < 8 && (
                  <span
                    className="absolute top-0 ml-1 text-[10px] text-muted opacity-0 group-hover:opacity-100"
                    style={{ left: `${Math.min(left + width, 92)}%` }}
                  >
                    {fmtDuration(s.duration)}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
