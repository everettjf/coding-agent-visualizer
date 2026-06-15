import { useState } from "react";
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

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="copy-btn"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

// Render an Edit/MultiEdit/Write tool input as a colored diff when possible.
function DiffBlock({ input }: { input: any }) {
  const edits: { oldS: string; newS: string }[] = [];
  if (input?.old_string != null && input?.new_string != null) {
    edits.push({ oldS: String(input.old_string), newS: String(input.new_string) });
  }
  if (Array.isArray(input?.edits)) {
    for (const e of input.edits)
      edits.push({ oldS: String(e.old_string ?? ""), newS: String(e.new_string ?? "") });
  }
  if (input?.content != null && input?.old_string == null) {
    // Write: show added content
    return (
      <pre className="block diff">
        {String(input.content)
          .split("\n")
          .map((l, i) => (
            <div key={i} className="diff-add">+ {l}</div>
          ))}
      </pre>
    );
  }
  if (!edits.length) return null;
  return (
    <pre className="block diff">
      {edits.map((e, idx) => (
        <div key={idx}>
          {e.oldS.split("\n").map((l, i) => (
            <div key={`o${i}`} className="diff-del">- {l}</div>
          ))}
          {e.newS.split("\n").map((l, i) => (
            <div key={`n${i}`} className="diff-add">+ {l}</div>
          ))}
          {idx < edits.length - 1 && <div className="diff-sep" />}
        </div>
      ))}
    </pre>
  );
}

export function DetailPanel({
  node,
  onClose,
}: {
  node: SessionNode;
  onClose: () => void;
}) {
  const color = roleColor(node.role);
  const isFileEdit =
    node.tool &&
    /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(node.tool.name);

  return (
    <aside className="detail">
      <div className="detail-head">
        <span className="gnode-dot" style={{ background: color }} />
        <span className="detail-title">
          {node.role === "tool" ? node.tool?.name : roleLabel(node.role)}
        </span>
        <button className="close" onClick={onClose}>×</button>
      </div>
      <div className="detail-body">
        {node.timestamp && (
          <div className="muted small detail-ts">
            {new Date(node.timestamp).toLocaleString()}
            {node.isSidechain && <span className="ts-badge">sub-agent</span>}
          </div>
        )}

        {node.tokens && (
          <div className="kv">
            <span className="muted">tokens</span>
            <span>
              in {node.tokens.input} · out {node.tokens.output} · cache{" "}
              {node.tokens.cacheRead + node.tokens.cacheCreation}
            </span>
          </div>
        )}

        {node.thinking && (
          <section>
            <div className="sec-head">
              <h4>Reasoning</h4>
              <CopyButton text={node.thinking} />
            </div>
            <pre className="block think">{node.thinking}</pre>
          </section>
        )}

        {node.text && (
          <section>
            <div className="sec-head">
              <h4>Message</h4>
              <CopyButton text={node.text} />
            </div>
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

            {isFileEdit && <DiffBlock input={node.tool.input} />}

            <section>
              <div className="sec-head">
                <h4>Input</h4>
                <CopyButton text={pretty(node.tool.input)} />
              </div>
              <pre className="block">{pretty(node.tool.input)}</pre>
            </section>

            {node.tool.result !== undefined && (
              <section>
                <div className="sec-head">
                  <h4>Result {node.tool.isError ? "⚠️" : ""}</h4>
                  <CopyButton text={pretty(node.tool.result)} />
                </div>
                <pre className="block result">{pretty(node.tool.result).slice(0, 8000)}</pre>
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
