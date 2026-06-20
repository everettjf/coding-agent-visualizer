// Discovers local agent session files and dispatches them to the right adapter.

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseClaudeCodeSession } from "./adapters/claudeCode";
import { parseCodexSession } from "./adapters/codex";
import { parseGeminiSession, parseQwenSession } from "./adapters/gemini";
import { loadOpenCodeSessions, getOpenCodeSession } from "./adapters/opencode";
import { loadCursorSessions, getCursorSession } from "./adapters/cursor";
import { loadClineSessions, getClineSession } from "./adapters/cline";
import { aggregate, sessionToRecord, type Analytics, type SessionRecord } from "./analytics";
import { buildIndex, type SearchDoc, type SearchHit, type SearchIndex } from "./search";
import type { Source, SessionSummary, UnifiedSession } from "./types";

export type { SearchHit } from "./search";

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
// Qwen Code is a Gemini CLI fork with the identical on-disk format.
const QWEN_DIR = join(homedir(), ".qwen", "tmp");

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
    case "qwen":
      return parseQwenSession(raw, filePath);
    default:
      return null; // opencode / cursor are not file-based (handled separately)
  }
}

// Parse an uploaded/dropped file whose source is unknown: try every file-based
// adapter and keep whichever produced the richest session. Lets users drop a
// transcript that isn't in the auto-discovered locations.
const FILE_SOURCES: Source[] = ["claude-code", "codex", "gemini", "qwen"];
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
  if (await exists(QWEN_DIR)) {
    for (const f of await walk(QWEN_DIR, isGeminiSession))
      refs.push({ source: "qwen", filePath: f });
  }
  return refs;
}

// Session files are effectively immutable once written (only the live session
// grows), so we cache each file's parsed artifacts keyed by its mtime + size.
// One entry per file is shared by the session-list, analytics and search scans,
// so an unchanged file is read and parsed at most once across all three. A
// rescan then re-reads only the handful of files that actually changed.
//
// `summary` + `record` are small and always derived together when a file is
// parsed. `text` (the flattened searchable body) is heavy, so it's built only
// when a search needs it and is bounded separately (see evictSearchText).
interface FileEntry {
  mtimeMs: number;
  size: number;
  summary: SessionSummary | null; // null = parsed but yielded no session
  record: SessionRecord | null;
  text: string | null; // search body; null until a search needs it
}
const fileCache = new Map<string, FileEntry>();
// Bumped whenever the cache mutates, so the search index knows when to rebuild.
let cacheVersion = 0;

// Cap on total cached search-body text. Files are immutable, so dropping a
// file's text just means re-parsing it the next time it's searched.
const TEXT_BUDGET_BYTES = 64 * 1024 * 1024;
function evictSearchText(): void {
  let total = 0;
  for (const e of fileCache.values()) if (e.text) total += e.text.length;
  if (total <= TEXT_BUDGET_BYTES) return;
  // Map iteration is insertion order → oldest first; drop their text until under budget.
  for (const e of fileCache.values()) {
    if (total <= TEXT_BUDGET_BYTES) break;
    if (e.text) {
      total -= e.text.length;
      e.text = null;
    }
  }
}

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

// The one scan every endpoint shares. Re-reads/parses only files whose
// mtime+size changed, deriving summary + analytics record together; the heavy
// search body is built only when `needText` is set (and reused if already
// cached). Vanished files are pruned from the cache.
async function scanFiles(needText: boolean): Promise<FileEntry[]> {
  const refs = await listFiles();
  const seen = new Set<string>();

  const results = await mapLimit(refs, 12, async ({ source, filePath }) => {
    seen.add(filePath);
    try {
      const st = await stat(filePath);
      const cached = fileCache.get(filePath);
      const fresh = cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size;
      // Reuse the cached entry unless a search needs text this entry lacks
      // (a parsed-but-empty file has no body to fetch, so it's fine as-is).
      if (fresh && (!needText || cached!.text != null || cached!.summary == null)) {
        return cached!;
      }
      const raw = await readFile(filePath, "utf8");
      const session = parse(source, raw, filePath);
      const entry: FileEntry = {
        mtimeMs: st.mtimeMs,
        size: st.size,
        summary: session ? (({ nodes, ...rest }) => rest)(session) : null,
        record: session ? sessionToRecord(session) : null,
        text: session && needText ? sessionText(session) : null,
      };
      fileCache.set(filePath, entry);
      cacheVersion++; // a file was (re)parsed → search index is stale
      return entry;
    } catch {
      return null; // skip unreadable / vanished files
    }
  });

  // Drop cache entries for files that no longer exist.
  for (const key of fileCache.keys()) {
    if (!seen.has(key)) {
      fileCache.delete(key);
      cacheVersion++;
    }
  }
  if (needText) evictSearchText();

  return results.filter((e): e is FileEntry => e != null);
}

export async function listSessions(): Promise<SessionSummary[]> {
  const entries = await scanFiles(false);
  const summaries = entries
    .map((e) => e.summary)
    .filter((s): s is SessionSummary => s != null);
  for (const s of await loadExtraSessions()) {
    const { nodes, ...summary } = s;
    summaries.push(summary);
  }
  // Most recent first.
  summaries.sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));
  return summaries;
}

// Cross-session analytics: each file's compact record was already derived by the
// shared scan, so this just collects them (re-parsing only changed files).
export async function getAnalytics(): Promise<Analytics> {
  const entries = await scanFiles(false);
  const all = entries
    .map((e) => e.record)
    .filter((r): r is SessionRecord => r != null);
  for (const s of await loadExtraSessions()) all.push(sessionToRecord(s));
  return aggregate(all);
}

/** Flatten a session into the {summary, text} doc the search index consumes. */
export function searchEntry(session: UnifiedSession): SearchDoc {
  const { nodes, ...summary } = session;
  return { summary, text: sessionText(session) };
}

// Full-text search across every session body via an inverted index. The index
// is memoized: it's rebuilt only when the underlying corpus changes (file cache
// version bump, or a different number of non-file sessions), so typing a query
// reuses one index instead of re-scanning every body per keystroke.
let searchIndexCache: { sig: string; index: SearchIndex } | null = null;

export async function searchSessions(query: string): Promise<SearchHit[]> {
  if (!query.trim()) return [];

  const entries = await scanFiles(true);
  const extras = await loadExtraSessions();
  const sig = `${cacheVersion}:${extras.length}`;

  if (!searchIndexCache || searchIndexCache.sig !== sig) {
    const docs: SearchDoc[] = entries
      .filter((e) => e.summary != null && e.text != null)
      .map((e) => ({ summary: e.summary!, text: e.text! }));
    for (const s of extras) docs.push(searchEntry(s));
    searchIndexCache = { sig, index: buildIndex(docs) };
  }

  return searchIndexCache.index.search(query);
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
      : filePath.includes(`${join(".qwen", "tmp")}`)
        ? "qwen"
        : "claude-code";
  try {
    const raw = await readFile(filePath, "utf8");
    return parse(source, raw, filePath);
  } catch {
    return null;
  }
}
