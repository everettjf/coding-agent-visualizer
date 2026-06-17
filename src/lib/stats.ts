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

// ---------------------------------------------------------------------------
// Trace span model (distributed-tracing style waterfall)
// ---------------------------------------------------------------------------

export interface TraceSpan {
  node: SessionNode;
  depth: number;
  /** ms from session start */
  start: number;
  /** inferred ms duration (gap to the next chronological event) */
  duration: number;
  hasChildren: boolean;
}

export interface Trace {
  spans: TraceSpan[];
  totalMs: number;
}

function childMap(nodes: SessionNode[]): {
  childrenOf: Map<string | null, SessionNode[]>;
  byId: Map<string, SessionNode>;
} {
  const byId = new Map<string, SessionNode>();
  for (const n of nodes) byId.set(n.id, n);
  const childrenOf = new Map<string | null, SessionNode[]>();
  for (const n of nodes) {
    const key = n.parentId && byId.has(n.parentId) ? n.parentId : null;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(n);
  }
  return { childrenOf, byId };
}

// Tree order (DFS) with depth, but bar geometry driven by real time: each span's
// duration is the gap to the next chronological event. This is the agent-trace
// equivalent of a Jaeger/Honeycomb span waterfall.
export function buildTrace(session: UnifiedSession): Trace {
  const start = session.startedAt ? Date.parse(session.startedAt) : null;
  const end = session.endedAt ? Date.parse(session.endedAt) : null;

  // Chronological gaps → per-node start + duration.
  const timed = session.nodes
    .filter((n) => n.timestamp)
    .map((n) => ({ id: n.id, t: Date.parse(n.timestamp!) }))
    .sort((a, b) => a.t - b.t);
  const base = start ?? (timed.length ? timed[0].t : 0);
  const span = new Map<string, { start: number; duration: number }>();
  for (let i = 0; i < timed.length; i++) {
    const next = i < timed.length - 1 ? timed[i + 1].t : end ?? timed[i].t;
    span.set(timed[i].id, {
      start: timed[i].t - base,
      duration: Math.max(0, next - timed[i].t),
    });
  }

  const { childrenOf } = childMap(session.nodes);
  const spans: TraceSpan[] = [];
  // Indent by *sub-agent nesting*, not raw parent-chain depth: a coding-agent
  // conversation is a linear chain (each turn's parent is the previous one), so
  // tree depth would stair-step the main spine off-screen. Instead we only step
  // in when a branch crosses into a sidechain (sub-agent), which is the "call
  // depth" the waterfall is meant to show.
  const visit = (n: SessionNode, depth: number, parentStart: number) => {
    const s = span.get(n.id) ?? { start: parentStart, duration: 0 };
    const kids = childrenOf.get(n.id) ?? [];
    spans.push({ node: n, depth, start: s.start, duration: s.duration, hasChildren: kids.length > 0 });
    for (const c of kids) {
      const entersSidechain = !!c.isSidechain && !n.isSidechain;
      visit(c, entersSidechain ? depth + 1 : depth, s.start);
    }
  };
  for (const root of childrenOf.get(null) ?? []) visit(root, 0, 0);

  const totalMs =
    start != null && end != null
      ? end - start
      : spans.reduce((m, s) => Math.max(m, s.start + s.duration), 1);
  return { spans, totalMs: totalMs || 1 };
}

// ---------------------------------------------------------------------------
// Hierarchy for the cost icicle / flame graph (weight = tokens)
// ---------------------------------------------------------------------------

export interface HierNode {
  node: SessionNode | null;
  /** self weight (own tokens) */
  self: number;
  children: HierNode[];
}

export function nodeTokens(n: SessionNode): number {
  return n.tokens ? n.tokens.input + n.tokens.output : 0;
}

/** Build a single rooted hierarchy (synthetic root) weighted by token cost. */
export function buildHierarchy(session: UnifiedSession): HierNode {
  const { childrenOf } = childMap(session.nodes);
  const build = (n: SessionNode): HierNode => ({
    node: n,
    self: nodeTokens(n),
    children: (childrenOf.get(n.id) ?? []).map(build),
  });
  return {
    node: null,
    self: 0,
    children: (childrenOf.get(null) ?? []).map(build),
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
