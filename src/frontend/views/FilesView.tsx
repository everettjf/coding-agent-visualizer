import type { UnifiedSession } from "../../lib/types";
import { basename, computeStats } from "../../lib/stats";

// Heat color from cool (few touches) to hot (many).
function heat(ratio: number): string {
  const hue = 210 - ratio * 190; // 210 (blue) -> 20 (orange/red)
  return `hsl(${hue}, 85%, 55%)`;
}

export function FilesView({ session }: { session: UnifiedSession }) {
  const { files, maxFileTouches } = computeStats(session);

  if (!files.length) {
    return (
      <div className="view scroll">
        <div className="empty-inline muted">
          This session didn't touch any files (no file-path tool inputs found).
        </div>
      </div>
    );
  }

  return (
    <div className="view scroll">
      <section className="panel-block">
        <h3>File-edit heatmap</h3>
        <p className="muted small">
          {files.length} files · darker/warmer = touched more often
        </p>
        <div className="file-list">
          {files.map((f) => {
            const ratio = maxFileTouches > 0 ? f.touches / maxFileTouches : 0;
            return (
              <div className="file-row" key={f.path} title={f.path}>
                <span
                  className="file-chip"
                  style={{ background: heat(ratio) }}
                >
                  {f.touches}
                </span>
                <div className="file-info">
                  <span className="file-name">{basename(f.path)}</span>
                  <span className="file-path muted small">{f.path}</span>
                </div>
                <span className="file-tools muted small">{f.tools.join(", ")}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
