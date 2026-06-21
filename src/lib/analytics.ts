// Cross-session analytics: aggregate many sessions into trends (cost over time,
// tool usage, per-source / per-model / per-project breakdowns). Pure and
// source-agnostic — discovery produces one compact record per session and this
// module folds them into chart-ready shapes.

import type { Source, UnifiedSession } from "./types";
import { computeStats } from "./stats";
import { estimateCostUsd } from "./pricing";

/** A compact, cache-friendly per-session summary used only for aggregation. */
export interface SessionRecord {
  source: Source;
  model: string;
  project: string;
  title: string;
  filePath: string;
  /** YYYY-MM-DD from endedAt, or null when the session has no timestamps. */
  date: string | null;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  /** Estimated USD cost under the session model's published pricing. */
  cost: number;
  toolCalls: number;
  tools: Record<string, number>;
  /** Per-tool error counts (a subset of `tools` keys). */
  toolErrors: Record<string, number>;
}

export interface CountTokens {
  sessions: number;
  tokens: number;
  cost: number;
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
  totalCost: number;
  bySource: NamedCountTokens[];
  byModel: NamedCountTokens[];
  topProjects: NamedCountTokens[];
  topTools: { name: string; count: number }[];
  daily: DailyPoint[];
  /** Per-calendar-month rollup (date = "YYYY-MM"). */
  monthly: DailyPoint[];
  /** Spend rate: average per active day and recent windows up to the latest day. */
  burn: { perActiveDay: number; last7: number; last30: number };
  /** The priciest sessions, for spotting cost outliers. */
  topSessions: {
    title: string;
    source: Source;
    filePath: string;
    cost: number;
    tokens: number;
  }[];
  /** Per-tool call counts, error counts and error rate, ranked by errors. */
  toolReliability: { name: string; count: number; errors: number; rate: number }[];
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
  const toolErrors: Record<string, number> = {};
  for (const t of stats.tools) {
    tools[t.name] = t.count;
    if (t.errors) toolErrors[t.name] = t.errors;
  }
  return {
    source: session.source,
    model: session.model || "unknown",
    project: projectName(session.cwd),
    title: session.title,
    filePath: session.filePath,
    date: session.endedAt ? session.endedAt.slice(0, 10) : null,
    tokens: session.totalTokens,
    inputTokens: stats.totals.inputTokens,
    outputTokens: stats.totals.outputTokens,
    cacheTokens: stats.totals.cacheTokens,
    cost: stats.costUsd,
    toolCalls: stats.totals.tool,
    tools,
    toolErrors,
  };
}

function topNamed(
  map: Map<string, CountTokens>,
  limit = 12,
): NamedCountTokens[] {
  return [...map.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens || b.sessions - a.sessions)
    .slice(0, limit);
}

export function aggregate(records: SessionRecord[]): Analytics {
  const bySource = new Map<string, CountTokens>();
  const byModel = new Map<string, CountTokens>();
  const byProject = new Map<string, CountTokens>();
  const byDay = new Map<string, CountTokens>();
  const byMonth = new Map<string, CountTokens>();
  const toolCounts = new Map<string, number>();
  const toolErrorCounts = new Map<string, number>();

  let totalTokens = 0;
  let totalToolCalls = 0;
  let totalCost = 0;

  const bump = (
    m: Map<string, CountTokens>,
    key: string,
    tokens: number,
    cost: number,
  ) => {
    const e = m.get(key) ?? { sessions: 0, tokens: 0, cost: 0 };
    e.sessions++;
    e.tokens += tokens;
    e.cost += cost;
    m.set(key, e);
  };

  for (const r of records) {
    totalTokens += r.tokens;
    totalToolCalls += r.toolCalls;
    totalCost += r.cost;
    bump(bySource, r.source, r.tokens, r.cost);
    bump(byModel, r.model, r.tokens, r.cost);
    bump(byProject, r.project, r.tokens, r.cost);
    if (r.date) {
      bump(byDay, r.date, r.tokens, r.cost);
      bump(byMonth, r.date.slice(0, 7), r.tokens, r.cost);
    }
    for (const [name, count] of Object.entries(r.tools)) {
      toolCounts.set(name, (toolCounts.get(name) ?? 0) + count);
    }
    for (const [name, errs] of Object.entries(r.toolErrors)) {
      toolErrorCounts.set(name, (toolErrorCounts.get(name) ?? 0) + errs);
    }
  }

  // Priciest sessions (cost outliers) and per-tool reliability.
  const topSessions = records
    .map((r) => ({
      title: r.title,
      source: r.source,
      filePath: r.filePath,
      cost: r.cost,
      tokens: r.tokens,
    }))
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
    .slice(0, 12);

  const toolReliability = [...toolCounts.entries()]
    .map(([name, count]) => {
      const errors = toolErrorCounts.get(name) ?? 0;
      return { name, count, errors, rate: count ? errors / count : 0 };
    })
    .filter((t) => t.errors > 0)
    .sort((a, b) => b.errors - a.errors || b.rate - a.rate)
    .slice(0, 12);

  const daily: DailyPoint[] = [...byDay.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const monthly: DailyPoint[] = [...byMonth.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Spend rate, anchored to the most recent active day so it stays meaningful
  // even when the data isn't from "today".
  const burn = { perActiveDay: 0, last7: 0, last30: 0 };
  if (daily.length) {
    burn.perActiveDay = totalCost / daily.length;
    const latest = daily[daily.length - 1].date;
    const cutoff = (n: number) => {
      const d = new Date(`${latest}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - (n - 1));
      return d.toISOString().slice(0, 10);
    };
    const c7 = cutoff(7);
    const c30 = cutoff(30);
    for (const d of daily) {
      if (d.date >= c7) burn.last7 += d.cost;
      if (d.date >= c30) burn.last30 += d.cost;
    }
  }

  const topTools = [...toolCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return {
    sessionCount: records.length,
    totalTokens,
    totalToolCalls,
    totalCost,
    bySource: topNamed(bySource, 10),
    byModel: topNamed(byModel, 10),
    topProjects: topNamed(byProject, 12),
    topTools,
    daily,
    monthly,
    burn,
    topSessions,
    toolReliability,
  };
}
