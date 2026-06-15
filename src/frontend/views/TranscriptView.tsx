import { useState } from "react";
import type { SessionNode, UnifiedSession } from "../../lib/types";
import { roleColor, roleLabel } from "../ui";

function ToolBlock({ node }: { node: SessionNode }) {
  const [open, setOpen] = useState(false);
  if (!node.tool) return null;
  return (
    <div className="ts-tool">
      <button className="ts-tool-head" onClick={() => setOpen((o) => !o)}>
        <span className="ts-tool-icon">⚙</span>
        <span className="ts-tool-name">{node.tool.name}</span>
        {node.tool.files?.length ? (
          <span className="muted small">{node.tool.files.join(", ")}</span>
        ) : null}
        {node.tool.isError && <span className="err">error</span>}
        <span className="ts-tool-toggle muted">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="ts-tool-body">
          <pre className="block">
            {typeof node.tool.input === "string"
              ? node.tool.input
              : JSON.stringify(node.tool.input, null, 2)}
          </pre>
          {node.tool.result !== undefined && (
            <pre className="block result">
              {(typeof node.tool.result === "string"
                ? node.tool.result
                : JSON.stringify(node.tool.result, null, 2)
              ).slice(0, 4000)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function TranscriptView({ session }: { session: UnifiedSession }) {
  return (
    <div className="view scroll">
      <div className="transcript">
        {session.nodes.map((node) => {
          if (node.role === "tool") return <ToolBlock key={node.id} node={node} />;
          const body = node.text ?? node.thinking;
          if (!body) return null;
          return (
            <div
              key={node.id}
              className={`ts-msg ts-${node.role} ${node.isSidechain ? "ts-side" : ""}`}
            >
              <div className="ts-role" style={{ color: roleColor(node.role) }}>
                {roleLabel(node.role)}
                {node.isSidechain && <span className="ts-badge">sub-agent</span>}
              </div>
              <div className={`ts-text ${node.role === "reasoning" ? "ts-think" : ""}`}>
                {body}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
