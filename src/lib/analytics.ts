// Cross-session analytics: aggregate many sessions into trends (cost over time,
// tool usage, per-source / per-model / per-project breakdowns). Pure and
// source-agnostic — discovery produces one compact record per session and this
// module folds them into chart-ready shapes.

import type { Source, UnifiedSession } from "./types";
import { computeStats } from "./stats";

/** A compact, cache-friendly per-session summary used only for aggregation. */
export interface SessionRecord {
  source: Source;
  model: string;
  project: string;
  /** YYYY-MM-DD from endedAt, or null when the session has no timestamps. */
  date: string | null;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  toolCalls: number;
  tools: Record<string, number>;
}

export interface CountTokens {
  sessions: number;
  tokens: number;
}
export interface DailyPoint extends CountTokens {
  date: string;
}
export interface NamedCountTokens extends CountTokens {
  name: string;
}

export interface Analytics {
  sessionCount: number;
  totalTokens: number;
  totalToolCalls: number;
  bySource: NamedCountTokens[];
  byModel: NamedCountTokens[];
  topProjects: NamedCountTokens[];
  topTools: { name: string; count: number }[];
  daily: DailyPoint[];
}

function projectName(cwd: string): string {
  if (!cwd) return "unknown";
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

/** Reduce a full session to the compact record used for cross-session trends. */
export function sessionToRecord(session: UnifiedSession): SessionRecord {
  const stats = computeStats(session);
  const tools: Record<string, number> = {};
  for (const t of stats.tools) tools[t.name] = t.count;
  return {
    source: session.source,
    model: session.model || "unknown",
    project: projectName(session.cwd),
    date: session.endedAt ? session.endedAt.slice(0, 10) : null,
    tokens: session.totalTokens,
    inputTokens: stats.totals.inputTokens,
    outputTokens: stats.totals.outputTokens,
    cacheTokens: stats.totals.cacheTokens,
    toolCalls: stats.totals.tool,
    tools,
  };
}

function topNamed(
  map: Map<string, CountTokens>,
  limit = 12,
): NamedCountTokens[] {
  return [...map.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.tokens - a.tokens || b.sessions - a.sessions)
    .slice(0, limit);
}

export function aggregate(records: SessionRecord[]): Analytics {
  const bySource = new Map<string, CountTokens>();
  const byModel = new Map<string, CountTokens>();
  const byProject = new Map<string, CountTokens>();
  const byDay = new Map<string, CountTokens>();
  const toolCounts = new Map<string, number>();

  let totalTokens = 0;
  let totalToolCalls = 0;

  const bump = (m: Map<string, CountTokens>, key: string, tokens: number) => {
    const e = m.get(key) ?? { sessions: 0, tokens: 0 };
    e.sessions++;
    e.tokens += tokens;
    m.set(key, e);
  };

  for (const r of records) {
    totalTokens += r.tokens;
    totalToolCalls += r.toolCalls;
    bump(bySource, r.source, r.tokens);
    bump(byModel, r.model, r.tokens);
    bump(byProject, r.project, r.tokens);
    if (r.date) bump(byDay, r.date, r.tokens);
    for (const [name, count] of Object.entries(r.tools)) {
      toolCounts.set(name, (toolCounts.get(name) ?? 0) + count);
    }
  }

  const daily: DailyPoint[] = [...byDay.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const topTools = [...toolCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return {
    sessionCount: records.length,
    totalTokens,
    totalToolCalls,
    bySource: topNamed(bySource, 10),
    byModel: topNamed(byModel, 10),
    topProjects: topNamed(byProject, 12),
    topTools,
    daily,
  };
}
