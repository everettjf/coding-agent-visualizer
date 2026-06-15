import type { SessionNode, UnifiedSession } from "../../lib/types";
import { computeStats, fmtDuration } from "../../lib/stats";
import { roleColor, roleLabel } from "../ui";

export function TimelineView({
  session,
  onSelect,
}: {
  session: UnifiedSession;
  onSelect: (n: SessionNode) => void;
}) {
  const { timeline, durationMs } = computeStats(session);

  if (!timeline.length) {
    return (
      <div className="view scroll">
        <div className="empty-inline muted">No timestamped events.</div>
      </div>
    );
  }

  const total = durationMs || 1;

  return (
    <div className="view scroll">
      <section className="panel-block">
        <h3>Execution timeline</h3>
        <p className="muted small">
          {timeline.length} events over {fmtDuration(durationMs)}
        </p>
        <div className="timeline">
          {timeline.map((p, i) => {
            const left = (p.offset / total) * 100;
            const label =
              p.node.role === "tool"
                ? p.node.tool?.name ?? "tool"
                : roleLabel(p.node.role);
            const preview = (p.node.text ?? p.node.thinking ?? "")
              .replace(/\s+/g, " ")
              .slice(0, 80);
            return (
              <button
                className="tl-row"
                key={p.node.id + i}
                onClick={() => onSelect(p.node)}
              >
                <span className="tl-time muted small">
                  {fmtDuration(p.offset)}
                </span>
                <span className="tl-track">
                  <span
                    className="tl-dot"
                    style={{ left: `${left}%`, background: roleColor(p.node.role) }}
                  />
                </span>
                <span className="tl-label" style={{ color: roleColor(p.node.role) }}>
                  {label}
                </span>
                <span className="tl-preview muted small">{preview}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
