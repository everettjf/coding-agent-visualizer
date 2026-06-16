// Export a UnifiedSession to portable formats: Markdown (for pasting into docs
// / issues) and a single self-contained HTML file (for sharing a readable
// transcript with no server, no dependencies, nothing uploaded anywhere).

import type { SessionNode, UnifiedSession } from "../../lib/types";
import { fmtDuration, fmtTokens } from "../../lib/stats";

function roleHeading(node: SessionNode): string {
  switch (node.role) {
    case "user": return "👤 User";
    case "assistant": return "🤖 Assistant";
    case "reasoning": return "💭 Reasoning";
    case "system": return "⚙️ System";
    case "tool": return `🔧 ${node.tool?.name ?? "Tool"}`;
  }
}

function durationMs(s: UnifiedSession): number {
  const a = s.startedAt ? Date.parse(s.startedAt) : NaN;
  const b = s.endedAt ? Date.parse(s.endedAt) : NaN;
  return Number.isFinite(a) && Number.isFinite(b) ? b - a : 0;
}

function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// Choose a fenced-code language hint from the first edited file, for nicer
// Markdown rendering of tool inputs that contain code.
function langHint(node: SessionNode): string {
  const file = node.tool?.files?.[0];
  const ext = file?.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", py: "python", rb: "ruby",
    go: "go", rs: "rust", java: "java", c: "c", cpp: "cpp", json: "json",
    sh: "bash", md: "markdown", css: "css", html: "html", yml: "yaml", yaml: "yaml",
  };
  return (ext && map[ext]) || "";
}

const RESULT_CAP = 4000;

export function toMarkdown(session: UnifiedSession): string {
  const out: string[] = [];
  out.push(`# ${session.title}`, "");
  const meta = [
    `- **Source:** ${session.source}`,
    session.model ? `- **Model:** ${session.model}` : "",
    session.cwd ? `- **Directory:** \`${session.cwd}\`` : "",
    session.gitBranch ? `- **Branch:** ${session.gitBranch}` : "",
    session.startedAt ? `- **Started:** ${new Date(session.startedAt).toLocaleString()}` : "",
    `- **Duration:** ${fmtDuration(durationMs(session))}`,
    `- **Messages:** ${session.messageCount} · **Tool calls:** ${session.toolCallCount} · **Tokens:** ${fmtTokens(session.totalTokens)}`,
  ].filter(Boolean);
  out.push(...meta, "", "---", "");

  for (const node of session.nodes) {
    const side = node.isSidechain ? " _(sub-agent)_" : "";
    if (node.role === "tool" && node.tool) {
      out.push(`#### ${roleHeading(node)}${side}`);
      if (node.tool.files?.length) out.push(`> Files: ${node.tool.files.map((f) => `\`${f}\``).join(", ")}`);
      const input = asText(node.tool.input);
      if (input) out.push("", "**Input**", "```" + langHint(node), input, "```");
      if (node.tool.result !== undefined) {
        const res = asText(node.tool.result).slice(0, RESULT_CAP);
        out.push("", `**Result${node.tool.isError ? " ⚠️" : ""}**`, "```", res, "```");
      }
      out.push("");
      continue;
    }
    const body = node.text ?? node.thinking;
    if (!body) continue;
    out.push(`### ${roleHeading(node)}${side}`, "");
    out.push(node.role === "reasoning" ? body.split("\n").map((l) => `> ${l}`).join("\n") : body, "");
  }

  out.push("---", "", "_Exported from Coding Agent Visualizer._");
  return out.join("\n");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const ROLE_HTML_COLOR: Record<SessionNode["role"], string> = {
  user: "#4f9cf9",
  assistant: "#22c55e",
  reasoning: "#a78bfa",
  tool: "#f59e0b",
  system: "#64748b",
};

export function toHTML(session: UnifiedSession): string {
  const blocks: string[] = [];
  for (const node of session.nodes) {
    const color = ROLE_HTML_COLOR[node.role];
    const side = node.isSidechain ? `<span class="badge">sub-agent</span>` : "";
    if (node.role === "tool" && node.tool) {
      const files = node.tool.files?.length
        ? `<div class="files">${esc(node.tool.files.join(", "))}</div>`
        : "";
      const result =
        node.tool.result !== undefined
          ? `<div class="label">Result${node.tool.isError ? " ⚠️" : ""}</div><pre class="result">${esc(asText(node.tool.result).slice(0, RESULT_CAP))}</pre>`
          : "";
      blocks.push(
        `<details class="msg tool" style="--c:${color}"><summary><b>🔧 ${esc(node.tool.name)}</b>${side}</summary>${files}<div class="label">Input</div><pre>${esc(asText(node.tool.input))}</pre>${result}</details>`,
      );
      continue;
    }
    const body = node.text ?? node.thinking;
    if (!body) continue;
    blocks.push(
      `<div class="msg ${node.role}" style="--c:${color}"><div class="role">${esc(roleHeading(node))}${side}</div><div class="body">${esc(body)}</div></div>`,
    );
  }

  const sub = [
    session.model,
    session.cwd,
    session.gitBranch,
    `${session.messageCount} msgs · ${session.toolCallCount} tools · ${fmtTokens(session.totalTokens)} tokens · ${fmtDuration(durationMs(session))}`,
  ].filter((x): x is string => !!x).map(esc).join(" · ");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(session.title)} — Agent Transcript</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0d0f14; color:#e6e9f0;
    font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  .wrap { max-width:860px; margin:0 auto; padding:32px 20px 80px; }
  h1 { font-size:22px; margin:0 0 6px; }
  .sub { color:#8a92a6; font-size:13px; margin-bottom:24px; }
  .msg { border:1px solid #262b38; border-left:3px solid var(--c); border-radius:12px;
    padding:12px 16px; margin:12px 0; background:#151821; }
  .role { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.5px;
    color:var(--c); margin-bottom:6px; }
  .body { white-space:pre-wrap; word-break:break-word; }
  .reasoning .body { color:#b9c0d0; font-style:italic; }
  details.tool { background:#1b1f2a; }
  details.tool summary { cursor:pointer; color:#f59e0b; font-family:ui-monospace,Menlo,monospace; }
  .label { font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:#8a92a6; margin:10px 0 4px; }
  .files { font-family:ui-monospace,Menlo,monospace; font-size:12px; color:#8a92a6; margin-top:6px; }
  pre { background:#0d0f14; border:1px solid #262b38; border-radius:8px; padding:10px;
    overflow:auto; font:12px/1.5 ui-monospace,"SF Mono",Menlo,monospace; max-height:360px; white-space:pre-wrap; word-break:break-word; }
  pre.result { border-left:3px solid #f59e0b; }
  .badge { font-size:10px; background:rgba(167,139,250,.2); color:#c4b5fd; padding:1px 6px;
    border-radius:999px; margin-left:8px; vertical-align:middle; }
  footer { color:#8a92a6; font-size:12px; margin-top:40px; text-align:center; }
</style></head>
<body><div class="wrap">
<h1>${esc(session.title)}</h1>
<div class="sub">${sub}</div>
${blocks.join("\n")}
<footer>Exported from Coding Agent Visualizer · everything stays local.</footer>
</div></body></html>`;
}

/** Trigger a browser download of `content` as `filename`. */
export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A filesystem-safe slug for the export filename. */
export function slugify(s: string): string {
  return (
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) ||
    "session"
  );
}
