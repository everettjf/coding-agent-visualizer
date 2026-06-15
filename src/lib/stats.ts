// Derived analytics computed from a UnifiedSession. Pure + source-agnostic so
// every view (stats, timeline, file heatmap) shares one implementation.

import type { SessionNode, UnifiedSession } from "./types";

export interface ToolStat {
  name: string;
  count: number;
  errors: number;
}

export interface FileStat {
  path: string;
  touches: number;
  tools: Set<string>;
}

export interface TimelinePoint {
  node: SessionNode;
  /** ms offset from session start */
  offset: number;
  cumulativeTokens: number;
}

export interface SessionStats {
  durationMs: number;
  tools: ToolStat[];
  files: { path: string; touches: number; tools: string[] }[];
  timeline: TimelinePoint[];
  totals: {
    user: number;
    assistant: number;
    tool: number;
    reasoning: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
  };
  maxFileTouches: number;
}

export function computeStats(session: UnifiedSession): SessionStats {
  const toolMap = new Map<string, ToolStat>();
  const fileMap = new Map<string, FileStat>();
  const totals = {
    user: 0,
    assistant: 0,
    tool: 0,
    reasoning: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
  };

  const start = session.startedAt ? Date.parse(session.startedAt) : null;
  const end = session.endedAt ? Date.parse(session.endedAt) : null;

  let cumulativeTokens = 0;
  const timeline: TimelinePoint[] = [];

  for (const node of session.nodes) {
    if (node.role in totals) (totals as any)[node.role]++;
    if (node.tokens) {
      totals.inputTokens += node.tokens.input;
      totals.outputTokens += node.tokens.output;
      totals.cacheTokens += node.tokens.cacheRead + node.tokens.cacheCreation;
      cumulativeTokens += node.tokens.input + node.tokens.output;
    }

    if (node.role === "tool" && node.tool) {
      const t =
        toolMap.get(node.tool.name) ??
        { name: node.tool.name, count: 0, errors: 0 };
      t.count++;
      if (node.tool.isError) t.errors++;
      toolMap.set(node.tool.name, t);

      for (const f of node.tool.files ?? []) {
        const fs = fileMap.get(f) ?? { path: f, touches: 0, tools: new Set() };
        fs.touches++;
        fs.tools.add(node.tool.name);
        fileMap.set(f, fs);
      }
    }

    if (node.timestamp && start != null) {
      timeline.push({
        node,
        offset: Date.parse(node.timestamp) - start,
        cumulativeTokens,
      });
    }
  }

  const tools = [...toolMap.values()].sort((a, b) => b.count - a.count);
  const files = [...fileMap.values()]
    .map((f) => ({ path: f.path, touches: f.touches, tools: [...f.tools] }))
    .sort((a, b) => b.touches - a.touches);
  const maxFileTouches = files.reduce((m, f) => Math.max(m, f.touches), 0);

  return {
    durationMs: start != null && end != null ? end - start : 0,
    tools,
    files,
    timeline,
    totals,
    maxFileTouches,
  };
}

export function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Short basename for a file path. */
export function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}
