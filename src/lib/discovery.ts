// Discovers local agent session files and dispatches them to the right adapter.

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseClaudeCodeSession } from "./adapters/claudeCode";
import { parseCodexSession } from "./adapters/codex";
import { parseGeminiSession } from "./adapters/gemini";
import { aggregate, sessionToRecord, type Analytics, type SessionRecord } from "./analytics";
import type { Source, SessionSummary, UnifiedSession } from "./types";

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
  }
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

  return aggregate(records.filter((r): r is SessionRecord => r != null));
}

export async function getSession(
  filePath: string,
): Promise<UnifiedSession | null> {
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
