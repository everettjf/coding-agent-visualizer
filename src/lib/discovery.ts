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

export async function listSessions(): Promise<SessionSummary[]> {
  const refs = await listFiles();
  const summaries: SessionSummary[] = [];
  await Promise.all(
    refs.map(async ({ source, filePath }) => {
      try {
        const raw = await readFile(filePath, "utf8");
        const session = parse(source, raw, filePath);
        if (session) {
          const { nodes, ...summary } = session;
          summaries.push(summary);
        }
      } catch {
        // skip unreadable files
      }
    }),
  );
  // Most recent first.
  summaries.sort((a, b) =>
    (b.endedAt ?? "").localeCompare(a.endedAt ?? ""),
  );
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
