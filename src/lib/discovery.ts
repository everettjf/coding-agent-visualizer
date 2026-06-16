// Discovers local agent session files and dispatches them to the right adapter.

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseClaudeCodeSession } from "./adapters/claudeCode";
import { parseCodexSession } from "./adapters/codex";
import { parseGeminiSession } from "./adapters/gemini";
import { loadOpenCodeSessions, getOpenCodeSession } from "./adapters/opencode";
import { loadCursorSessions, getCursorSession } from "./adapters/cursor";
import { loadClineSessions, getClineSession } from "./adapters/cline";
import { aggregate, sessionToRecord, type Analytics, type SessionRecord } from "./analytics";
import type { Source, SessionSummary, UnifiedSession } from "./types";

export interface SearchHit {
  summary: SessionSummary;
  /** Number of matched terms found in the session body. */
  hits: number;
  /** A short excerpt of the body around the first match (original case). */
  snippet: string;
}

// Flatten a session's bodies (message text, reasoning, tool names + I/O) into one
// searchable string. Capped so a pathologically large session can't blow up memory.
const HAYSTACK_CAP = 500_000;
function sessionText(session: UnifiedSession): string {
  const parts: string[] = [session.title];
  for (const n of session.nodes) {
    if (n.text) parts.push(n.text);
    if (n.thinking) parts.push(n.thinking);
    if (n.tool) {
      parts.push(n.tool.name);
      if (n.tool.input != null) parts.push(stringify(n.tool.input));
      if (n.tool.result != null) parts.push(stringify(n.tool.result));
    }
    if (parts.reduce((a, p) => a + p.length, 0) > HAYSTACK_CAP) break;
  }
  return parts.join("\n").slice(0, HAYSTACK_CAP);
}

function stringify(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

// Non-file sources don't live as one JSONL per session (OpenCode = many small
// JSON files, Cursor = a SQLite DB), so each exposes a loader returning fully
// assembled sessions. They share the same UnifiedSession shape as everything else.
const EXTRA_SOURCES: (() => Promise<UnifiedSession[]>)[] = [
  loadOpenCodeSessions,
  loadCursorSessions,
  loadClineSessions,
];

async function loadExtraSessions(): Promise<UnifiedSession[]> {
  const groups = await Promise.all(
    EXTRA_SOURCES.map((load) => load().catch(() => [] as UnifiedSession[])),
  );
  return groups.flat();
}

const CLAUDE_DIR = join(homedir(), ".claude", "projects");
const CODEX_DIR = join(homedir(), ".codex", "sessions");
const GEMINI_DIR = join(homedir(), ".gemini", "tmp");

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Recursively collect files matching a predicate under a directory.
async function walk(
  dir: string,
  match: (name: string) => boolean,
): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, match)));
    else if (entry.isFile() && match(entry.name)) out.push(full);
  }
  return out;
}

const isJsonl = (name: string) => name.endsWith(".jsonl");
// Gemini stores chat checkpoints (`checkpoint-*.json`) and any recorded
// `*.jsonl` sessions; skip `logs.json` (just user-prompt history, no replies).
const isGeminiSession = (name: string) =>
  name.endsWith(".jsonl") ||
  (name.startsWith("checkpoint") && name.endsWith(".json"));

function parse(
  source: Source,
  raw: string,
  filePath: string,
): UnifiedSession | null {
  switch (source) {
    case "claude-code":
      return parseClaudeCodeSession(raw, filePath);
    case "codex":
      return parseCodexSession(raw, filePath);
    case "gemini":
      return parseGeminiSession(raw, filePath);
    default:
      return null; // opencode / cursor are not file-based (handled separately)
  }
}

// Parse an uploaded/dropped file whose source is unknown: try every file-based
// adapter and keep whichever produced the richest session. Lets users drop a
// transcript that isn't in the auto-discovered locations.
const FILE_SOURCES: Source[] = ["claude-code", "codex", "gemini"];
export function parseUploaded(name: string, raw: string): UnifiedSession | null {
  const filePath = `upload:${name}`;
  let best: UnifiedSession | null = null;
  for (const source of FILE_SOURCES) {
    let candidate: UnifiedSession | null = null;
    try {
      candidate = parse(source, raw, filePath);
    } catch {
      candidate = null;
    }
    if (candidate?.nodes.length && (!best || candidate.nodes.length > best.nodes.length)) {
      best = candidate;
    }
  }
  if (best) best.filePath = filePath;
  return best;
}

interface FileRef {
  source: Source;
  filePath: string;
}

async function listFiles(): Promise<FileRef[]> {
  const refs: FileRef[] = [];
  if (await exists(CLAUDE_DIR)) {
    for (const f of await walk(CLAUDE_DIR, isJsonl))
      refs.push({ source: "claude-code", filePath: f });
  }
  if (await exists(CODEX_DIR)) {
    for (const f of await walk(CODEX_DIR, isJsonl))
      refs.push({ source: "codex", filePath: f });
  }
  if (await exists(GEMINI_DIR)) {
    for (const f of await walk(GEMINI_DIR, isGeminiSession))
      refs.push({ source: "gemini", filePath: f });
  }
  return refs;
}

// Session files are effectively immutable once written (only the live session
// grows), so we cache each file's parsed summary keyed by its mtime + size.
// A rescan then re-reads only the handful of files that actually changed,
// turning a multi-second full scan into a near-instant one.
interface CacheEntry {
  mtimeMs: number;
  size: number;
  summary: SessionSummary | null; // null = parsed but yielded no session
}
const summaryCache = new Map<string, CacheEntry>();

// Run `fn` over `items` with at most `limit` in flight. Reading 1600+ files at
// once spikes memory (every file's contents resident simultaneously) and thrashes
// the disk; a bounded pool keeps peak memory flat and is reliably faster.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

export async function listSessions(): Promise<SessionSummary[]> {
  const refs = await listFiles();
  const seen = new Set<string>();

  const results = await mapLimit(refs, 12, async ({ source, filePath }) => {
    seen.add(filePath);
    try {
      const st = await stat(filePath);
      const cached = summaryCache.get(filePath);
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        return cached.summary;
      }
      const raw = await readFile(filePath, "utf8");
      const session = parse(source, raw, filePath);
      const summary = session ? (({ nodes, ...rest }) => rest)(session) : null;
      summaryCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, summary });
      return summary;
    } catch {
      return null; // skip unreadable / vanished files
    }
  });

  // Drop cache entries for files that no longer exist.
  for (const key of summaryCache.keys()) {
    if (!seen.has(key)) summaryCache.delete(key);
  }

  const summaries = results.filter(
    (s): s is SessionSummary => s != null,
  );
  for (const s of await loadExtraSessions()) {
    const { nodes, ...summary } = s;
    summaries.push(summary);
  }
  // Most recent first.
  summaries.sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));
  return summaries;
}

// Cross-session analytics reuse the same scan-and-cache strategy as the session
// list: a compact per-session record is cached by mtime+size so a rescan only
// re-parses changed files.
interface AnalyticsCacheEntry {
  mtimeMs: number;
  size: number;
  record: SessionRecord | null;
}
const analyticsCache = new Map<string, AnalyticsCacheEntry>();

export async function getAnalytics(): Promise<Analytics> {
  const refs = await listFiles();
  const seen = new Set<string>();

  const records = await mapLimit(refs, 12, async ({ source, filePath }) => {
    seen.add(filePath);
    try {
      const st = await stat(filePath);
      const cached = analyticsCache.get(filePath);
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        return cached.record;
      }
      const raw = await readFile(filePath, "utf8");
      const session = parse(source, raw, filePath);
      const record = session ? sessionToRecord(session) : null;
      analyticsCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, record });
      return record;
    } catch {
      return null;
    }
  });

  for (const key of analyticsCache.keys()) {
    if (!seen.has(key)) analyticsCache.delete(key);
  }

  const all = records.filter((r): r is SessionRecord => r != null);
  for (const s of await loadExtraSessions()) all.push(sessionToRecord(s));
  return aggregate(all);
}

// Full-text search across every session body. Like the summary scan, the
// flattened searchable text is cached by mtime+size so repeated queries only
// re-read files that actually changed.
interface SearchCacheEntry {
  mtimeMs: number;
  size: number;
  summary: SessionSummary;
  text: string;
}
const searchCache = new Map<string, SearchCacheEntry>();

function scoreText(text: string, terms: string[]): { hits: number; at: number } {
  const lower = text.toLowerCase();
  let hits = 0;
  let at = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx === -1) return { hits: 0, at: -1 }; // AND: every term must appear
    hits++;
    if (at === -1 || idx < at) at = idx;
  }
  return { hits, at };
}

function snippetAround(text: string, at: number, span = 120): string {
  const start = Math.max(0, at - span / 3);
  const raw = text.slice(start, start + span).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + raw + (start + span < text.length ? "…" : "");
}

/** Pure search core: rank pre-flattened {summary, text} entries against terms. */
export function rankSearch(
  entries: { summary: SessionSummary; text: string }[],
  query: string,
): SearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const results: SearchHit[] = [];
  for (const e of entries) {
    const { hits, at } = scoreText(e.text, terms);
    if (hits > 0) {
      results.push({ summary: e.summary, hits, snippet: snippetAround(e.text, at) });
    }
  }
  results.sort(
    (a, b) =>
      b.hits - a.hits ||
      (b.summary.endedAt ?? "").localeCompare(a.summary.endedAt ?? ""),
  );
  return results.slice(0, 50);
}

/** Flatten a session into the {summary, text} entry the search core consumes. */
export function searchEntry(session: UnifiedSession): {
  summary: SessionSummary;
  text: string;
} {
  const { nodes, ...summary } = session;
  return { summary, text: sessionText(session) };
}

export async function searchSessions(query: string): Promise<SearchHit[]> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  const refs = await listFiles();
  const seen = new Set<string>();
  const entries = await mapLimit(refs, 12, async ({ source, filePath }) => {
    seen.add(filePath);
    try {
      const st = await stat(filePath);
      const cached = searchCache.get(filePath);
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        return cached;
      }
      const raw = await readFile(filePath, "utf8");
      const session = parse(source, raw, filePath);
      if (!session) return null;
      const { nodes, ...summary } = session;
      const entry: SearchCacheEntry = {
        mtimeMs: st.mtimeMs,
        size: st.size,
        summary,
        text: sessionText(session),
      };
      searchCache.set(filePath, entry);
      return entry;
    } catch {
      return null;
    }
  });
  for (const key of searchCache.keys()) {
    if (!seen.has(key)) searchCache.delete(key);
  }

  const all: { summary: SessionSummary; text: string }[] = entries.filter(
    (e): e is SearchCacheEntry => e != null,
  );
  for (const s of await loadExtraSessions()) all.push(searchEntry(s));

  return rankSearch(all, query);
}

export async function getSession(
  filePath: string,
): Promise<UnifiedSession | null> {
  if (filePath.startsWith("opencode:"))
    return getOpenCodeSession(filePath.slice("opencode:".length));
  if (filePath.startsWith("cursor:"))
    return getCursorSession(filePath.slice("cursor:".length));
  if (filePath.startsWith("cline:"))
    return getClineSession(filePath.slice("cline:".length));

  const source: Source = filePath.includes(`${join(".codex", "sessions")}`)
    ? "codex"
    : filePath.includes(`${join(".gemini", "tmp")}`)
      ? "gemini"
      : "claude-code";
  try {
    const raw = await readFile(filePath, "utf8");
    return parse(source, raw, filePath);
  } catch {
    return null;
  }
}
