// Adapter: OpenCode CLI sessions.
// Unlike the JSONL agents, OpenCode stores each session across many small JSON
// files under ~/.local/share/opencode/storage:
//   session/<projectID>/ses_*.json   — session metadata (directory, title, time)
//   message/<sessionID>/msg_*.json   — one file per message (role, tokens, parentID)
//   part/<messageID>/prt_*.json      — message parts (text / reasoning / tool)
// We assemble those into the same UnifiedSession every other view consumes.

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  SessionNode,
  ToolInfo,
  TokenUsage,
  UnifiedSession,
} from "../types";

const SOURCE = "opencode" as const;
export const OPENCODE_STORAGE = join(
  homedir(),
  ".local",
  "share",
  "opencode",
  "storage",
);

const iso = (ms: number | undefined): string | null =>
  typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null;

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function listJson(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir))
      .filter((n) => n.endsWith(".json"))
      .sort(); // prt_/msg_ ids are time-ordered, so lexical sort == chronological
  } catch {
    return [];
  }
}

interface OcSession {
  id: string;
  directory?: string;
  title?: string;
  time?: { created?: number; updated?: number };
}
interface OcMessage {
  id: string;
  role?: string;
  parentID?: string;
  modelID?: string;
  providerID?: string;
  time?: { created?: number };
  tokens?: {
    input?: number;
    output?: number;
    cache?: { read?: number; write?: number };
  };
}

function tokenUsage(t: OcMessage["tokens"]): TokenUsage | undefined {
  if (!t) return undefined;
  return {
    input: t.input ?? 0,
    output: t.output ?? 0,
    cacheRead: t.cache?.read ?? 0,
    cacheCreation: t.cache?.write ?? 0,
  };
}

async function buildSession(
  sessionFile: string,
  storage: string,
): Promise<UnifiedSession | null> {
  const meta = await readJson<OcSession>(sessionFile);
  if (!meta?.id) return null;

  const msgDir = join(storage, "message", meta.id);
  const msgFiles = await listJson(msgDir);
  if (!msgFiles.length) return null;

  const messages = (
    await Promise.all(msgFiles.map((f) => readJson<OcMessage>(join(msgDir, f))))
  ).filter((m): m is OcMessage => !!m?.id);
  messages.sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));

  const nodes: SessionNode[] = [];
  let model: string | undefined;
  let messageCount = 0;
  let toolCallCount = 0;
  let totalTokens = 0;
  let firstTs: string | null = null;
  let lastTs: string | null = null;

  for (const m of messages) {
    const ts = iso(m.time?.created);
    if (ts) {
      if (!firstTs) firstTs = ts;
      lastTs = ts;
    }
    if (m.modelID) model = m.providerID ? `${m.providerID}/${m.modelID}` : m.modelID;

    const partDir = join(storage, "part", m.id);
    const parts = (
      await Promise.all(
        (await listJson(partDir)).map((f) => readJson<any>(join(partDir, f))),
      )
    ).filter(Boolean);

    const texts: string[] = [];
    const thinking: string[] = [];
    const tools: any[] = [];
    for (const p of parts) {
      if (p.type === "text" && p.text) texts.push(p.text);
      else if (p.type === "reasoning" && p.text) thinking.push(p.text);
      else if (p.type === "tool") tools.push(p);
    }

    const text = texts.join("\n").trim() || undefined;
    const think = thinking.join("\n").trim() || undefined;
    const tokens = tokenUsage(m.tokens);
    if (tokens) totalTokens += tokens.input + tokens.output;

    const role = m.role === "user" ? "user" : think && !text ? "reasoning" : "assistant";
    messageCount++;
    nodes.push({
      id: m.id,
      parentId: m.parentID ?? null,
      role,
      source: SOURCE,
      timestamp: ts,
      text,
      thinking: think,
      tokens,
      model: m.modelID,
    });

    let i = 0;
    for (const p of tools) {
      toolCallCount++;
      const input = p.state?.input ?? p.state?.metadata?.input;
      const fp = input?.filePath ?? input?.path;
      const tool: ToolInfo = {
        name: p.tool ?? "tool",
        input,
        result: p.state?.output,
        isError: p.state?.status === "error",
        files: typeof fp === "string" ? [fp] : undefined,
      };
      nodes.push({
        id: `${m.id}:tool:${i++}`,
        parentId: m.id,
        role: "tool",
        source: SOURCE,
        timestamp: ts,
        tool,
      });
    }
  }

  const title =
    meta.title?.replace(/\s+/g, " ").trim().slice(0, 80) || "(untitled session)";

  return {
    id: meta.id,
    source: SOURCE,
    cwd: meta.directory ?? "",
    title,
    startedAt: iso(meta.time?.created) ?? firstTs,
    endedAt: iso(meta.time?.updated) ?? lastTs,
    messageCount,
    toolCallCount,
    totalTokens,
    model,
    filePath: `opencode:${meta.id}`,
    nodes,
  };
}

// Collect every session/<proj>/ses_*.json path.
async function sessionFiles(storage: string): Promise<string[]> {
  const root = join(storage, "session");
  const out: string[] = [];
  let projects;
  try {
    projects = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    for (const f of await listJson(join(root, p.name)))
      out.push(join(root, p.name, f));
  }
  return out;
}

// Cache the full parse, invalidated by the newest session-file mtime (cheap to
// compute and bumps whenever any session is written).
let cache: { sig: string; sessions: UnifiedSession[] } | null = null;

async function signature(files: string[]): Promise<string> {
  let max = 0;
  for (const f of files) {
    try {
      max = Math.max(max, (await stat(f)).mtimeMs);
    } catch {}
  }
  return `${files.length}:${max}`;
}

export async function loadOpenCodeSessions(
  storage: string = OPENCODE_STORAGE,
): Promise<UnifiedSession[]> {
  const files = await sessionFiles(storage);
  if (!files.length) return [];
  const sig = await signature(files);
  // Only the default storage location is cached; tests pass an explicit root.
  const useCache = storage === OPENCODE_STORAGE;
  if (useCache && cache && cache.sig === sig) return cache.sessions;
  const sessions = (
    await Promise.all(files.map((f) => buildSession(f, storage)))
  ).filter((s): s is UnifiedSession => !!s);
  if (useCache) cache = { sig, sessions };
  return sessions;
}

export async function getOpenCodeSession(
  id: string,
  storage: string = OPENCODE_STORAGE,
): Promise<UnifiedSession | null> {
  if (storage === OPENCODE_STORAGE && cache) {
    const hit = cache.sessions.find((s) => s.id === id);
    if (hit) return hit;
  }
  const files = await sessionFiles(storage);
  const match = files.find((f) => f.endsWith(`${id}.json`));
  return match ? buildSession(match, storage) : null;
}
