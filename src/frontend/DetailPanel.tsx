import type { SessionNode } from "../lib/types";
import { roleColor, roleLabel } from "./ui";

function pretty(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function DetailPanel({
  node,
  onClose,
}: {
  node: SessionNode;
  onClose: () => void;
}) {
  const color = roleColor(node.role);
  return (
    <aside className="detail">
      <div className="detail-head">
        <span className="gnode-dot" style={{ background: color }} />
        <span className="detail-title">
          {node.role === "tool" ? node.tool?.name : roleLabel(node.role)}
        </span>
        <button className="close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="detail-body">
        {node.timestamp && (
          <div className="muted small detail-ts">
            {new Date(node.timestamp).toLocaleString()}
          </div>
        )}

        {node.tokens && (
          <div className="kv">
            <span className="muted">tokens</span>
            <span>
              in {node.tokens.input} · out {node.tokens.output} · cache{" "}
              {node.tokens.cacheRead}
            </span>
          </div>
        )}

        {node.thinking && (
          <section>
            <h4>Reasoning</h4>
            <pre className="block think">{node.thinking}</pre>
          </section>
        )}

        {node.text && (
          <section>
            <h4>Message</h4>
            <pre className="block">{node.text}</pre>
          </section>
        )}

        {node.tool && (
          <>
            {node.tool.files?.length ? (
              <div className="kv">
                <span className="muted">files</span>
                <span>{node.tool.files.join(", ")}</span>
              </div>
            ) : null}
            <section>
              <h4>Input</h4>
              <pre className="block">{pretty(node.tool.input)}</pre>
            </section>
            {node.tool.result !== undefined && (
              <section>
                <h4>Result {node.tool.isError ? "⚠️" : ""}</h4>
                <pre className="block result">
                  {pretty(node.tool.result).slice(0, 6000)}
                </pre>
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
