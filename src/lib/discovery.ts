// Discovers local agent session files and dispatches them to the right adapter.

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseClaudeCodeSession } from "./adapters/claudeCode";
import { parseCodexSession } from "./adapters/codex";
import type { Source, SessionSummary, UnifiedSession } from "./types";

const CLAUDE_DIR = join(homedir(), ".claude", "projects");
const CODEX_DIR = join(homedir(), ".codex", "sessions");

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Recursively collect *.jsonl files under a directory.
async function walkJsonl(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkJsonl(full)));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

function parse(
  source: Source,
  raw: string,
  filePath: string,
): UnifiedSession | null {
  return source === "claude-code"
    ? parseClaudeCodeSession(raw, filePath)
    : parseCodexSession(raw, filePath);
}

interface FileRef {
  source: Source;
  filePath: string;
}

async function listFiles(): Promise<FileRef[]> {
  const refs: FileRef[] = [];
  if (await exists(CLAUDE_DIR)) {
    for (const f of await walkJsonl(CLAUDE_DIR))
      refs.push({ source: "claude-code", filePath: f });
  }
  if (await exists(CODEX_DIR)) {
    for (const f of await walkJsonl(CODEX_DIR))
      refs.push({ source: "codex", filePath: f });
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

export async function getSession(
  filePath: string,
): Promise<UnifiedSession | null> {
  const source: Source = filePath.includes(`${join(".codex", "sessions")}`)
    ? "codex"
    : "claude-code";
  try {
    const raw = await readFile(filePath, "utf8");
    return parse(source, raw, filePath);
  } catch {
    return null;
  }
}
