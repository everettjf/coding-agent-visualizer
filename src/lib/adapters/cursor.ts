// Adapter: Cursor (the IDE's agent chats).
// Cursor keeps every conversation in one SQLite DB (not per-session files):
//   key "composerData:<id>"            — a conversation (title, ordered bubbles)
//   key "bubbleId:<composerId>:<id>"   — one message bubble (type, text, tool)
// type 1 = user, 2 = assistant. The live DB is locked + ~200MB, so we copy it to
// a temp file (only when its mtime changes) and read from the copy.

import { Database } from "bun:sqlite";
import { copyFile, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionNode, ToolInfo, UnifiedSession } from "../types";

const SOURCE = "cursor" as const;
const DB_PATH = join(
  homedir(),
  "Library",
  "Application Support",
  "Cursor",
  "User",
  "globalStorage",
  "state.vscdb",
);
const COPY_PATH = join(tmpdir(), "cav-cursor-state.vscdb");

interface Header {
  bubbleId: string;
  type?: number;
}
interface Composer {
  composerId?: string;
  text?: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  fullConversationHeadersOnly?: Header[];
}

function parseJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

const iso = (ms: number | undefined): string | null =>
  typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null;

function toolFromBubble(t: any): ToolInfo {
  let input = t?.params ?? t?.args;
  if (input == null && typeof t?.rawArgs === "string") input = parseJson(t.rawArgs) ?? t.rawArgs;
  const fp =
    input?.filePath ?? input?.path ?? input?.target_file ?? input?.relativePath;
  let result = t?.result;
  if (typeof result === "string") result = parseJson(result) ?? result;
  return {
    name: t?.name ?? "tool",
    input,
    result,
    isError: t?.status === "error" || t?.status === "failed",
    files: typeof fp === "string" ? [fp] : undefined,
  };
}

export function buildSession(db: Database, composerId: string): UnifiedSession | null {
  const row = db
    .query("SELECT value FROM cursorDiskKV WHERE key = ?")
    .get(`composerData:${composerId}`) as { value: string } | null;
  if (!row) return null;
  const c = parseJson<Composer>(row.value);
  const heads = c?.fullConversationHeadersOnly;
  if (!c || !Array.isArray(heads) || !heads.length) return null;

  const bubbleStmt = db.query(
    "SELECT value FROM cursorDiskKV WHERE key = ?",
  );

  const nodes: SessionNode[] = [];
  let messageCount = 0;
  let toolCallCount = 0;
  let totalTokens = 0;
  let title = "";
  let prevMsg: string | null = null;

  for (const h of heads) {
    const br = bubbleStmt.get(`bubbleId:${composerId}:${h.bubbleId}`) as
      | { value: string }
      | null;
    if (!br) continue;
    const b = parseJson<any>(br.value);
    if (!b) continue;

    const text: string | undefined = b.text?.trim() || undefined;
    const thinkBlocks = Array.isArray(b.allThinkingBlocks)
      ? b.allThinkingBlocks.map((x: any) => x?.text ?? "").join("\n").trim()
      : "";
    const thinking = thinkBlocks || undefined;
    const tok = b.tokenCount;
    if (tok) totalTokens += (tok.inputTokens ?? 0) + (tok.outputTokens ?? 0);

    if (text || thinking || !b.toolFormerData) {
      const role = b.type === 1 ? "user" : thinking && !text ? "reasoning" : "assistant";
      messageCount++;
      const id = `${composerId}:${h.bubbleId}`;
      nodes.push({
        id,
        parentId: prevMsg,
        role,
        source: SOURCE,
        timestamp: null,
        text,
        thinking,
        tokens: tok
          ? { input: tok.inputTokens ?? 0, output: tok.outputTokens ?? 0, cacheRead: 0, cacheCreation: 0 }
          : undefined,
      });
      prevMsg = id;
      if (!title && role === "user" && text) title = text.replace(/\s+/g, " ").slice(0, 80);
    }

    if (b.toolFormerData) {
      toolCallCount++;
      nodes.push({
        id: `${composerId}:${h.bubbleId}:tool`,
        parentId: prevMsg,
        role: "tool",
        source: SOURCE,
        timestamp: null,
        tool: toolFromBubble(b.toolFormerData),
      });
    }
  }

  if (!nodes.length) return null;
  if (!title) title = c.text?.replace(/\s+/g, " ").trim().slice(0, 80) || "(untitled chat)";

  return {
    id: composerId,
    source: SOURCE,
    cwd: "",
    title,
    startedAt: iso(c.createdAt),
    endedAt: iso(c.lastUpdatedAt ?? c.createdAt),
    messageCount,
    toolCallCount,
    totalTokens,
    filePath: `cursor:${composerId}`,
    nodes,
  };
}

// Copy the locked live DB to a temp file, refreshed only when its mtime changes.
let copyMtime = 0;
async function freshCopy(): Promise<string | null> {
  let st;
  try {
    st = await stat(DB_PATH);
  } catch {
    return null; // Cursor not installed
  }
  if (st.mtimeMs !== copyMtime) {
    try {
      await copyFile(DB_PATH, COPY_PATH);
      copyMtime = st.mtimeMs;
    } catch {
      return null;
    }
  }
  return COPY_PATH;
}

let cache: { mtime: number; sessions: UnifiedSession[] } | null = null;

export async function loadCursorSessions(): Promise<UnifiedSession[]> {
  const path = await freshCopy();
  if (!path) return [];
  if (cache && cache.mtime === copyMtime) return cache.sessions;

  const db = new Database(path);
  try {
    const ids = (
      db.query("SELECT key FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as {
        key: string;
      }[]
    ).map((r) => r.key.slice("composerData:".length));
    const sessions = ids
      .map((id) => buildSession(db, id))
      .filter((s): s is UnifiedSession => !!s);
    cache = { mtime: copyMtime, sessions };
    return sessions;
  } finally {
    db.close();
  }
}

export async function getCursorSession(
  id: string,
): Promise<UnifiedSession | null> {
  if (cache) {
    const hit = cache.sessions.find((s) => s.id === id);
    if (hit) return hit;
  }
  const path = await freshCopy();
  if (!path) return null;
  const db = new Database(path);
  try {
    return buildSession(db, id);
  } finally {
    db.close();
  }
}
