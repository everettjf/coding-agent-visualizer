// Adapter: Cline (the VS Code agent extension, formerly Claude Dev).
// Each task is a directory under the extension's globalStorage:
//   tasks/<taskID>/api_conversation_history.json  — Anthropic-format messages
//   tasks/<taskID>/ui_messages.json               — UI events incl. token usage
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

const SOURCE = "cline" as const;

// Cline lives in VS Code's globalStorage, whose root differs per OS.
function taskRoots(): string[] {
  const home = homedir();
  const ext = join("globalStorage", "saoudrizwan.claude-dev", "tasks");
  return [
    join(home, "Library", "Application Support", "Code", "User", ext), // macOS
    join(home, ".config", "Code", "User", ext), // Linux
    join(home, "AppData", "Roaming", "Code", "User", ext), // Windows
  ];
}

const iso = (ms: number | undefined): string | null =>
  typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null;

// ---- Anthropic message content blocks --------------------------------------
interface TextBlock { type: "text"; text: string }
interface ThinkingBlock { type: "thinking"; thinking: string }
interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: unknown }
interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content?: unknown;
  is_error?: boolean;
}
type Block = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;
interface Message {
  role: "user" | "assistant";
  content: string | Block[];
}

interface UiMessage {
  ts?: number;
  type?: string;
  say?: string;
  text?: string;
}

function asBlocks(content: Message["content"]): Block[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "string" ? c : c?.text ?? ""))
      .join("\n");
  }
  return content == null ? "" : JSON.stringify(content);
}

function filesFrom(input: any): string[] | undefined {
  const p = input?.path ?? input?.filePath ?? input?.file ?? input?.target_file;
  return typeof p === "string" ? [p] : undefined;
}

// Cline emits an `api_req_started` UI event before each assistant turn whose
// `text` is JSON carrying that request's token usage. Collect them in order.
function reqTokens(ui: UiMessage[]): TokenUsage[] {
  const out: TokenUsage[] = [];
  for (const m of ui) {
    if (m.say !== "api_req_started" || !m.text) continue;
    try {
      const j = JSON.parse(m.text);
      out.push({
        input: j.tokensIn ?? 0,
        output: j.tokensOut ?? 0,
        cacheRead: j.cacheReads ?? 0,
        cacheCreation: j.cacheWrites ?? 0,
      });
    } catch {
      /* ignore malformed entries */
    }
  }
  return out;
}

/** Pure builder: turn a task's two JSON payloads into a UnifiedSession. */
export function buildClineSession(
  taskId: string,
  history: Message[],
  ui: UiMessage[],
): UnifiedSession | null {
  if (!Array.isArray(history) || !history.length) return null;

  const tokens = reqTokens(ui);
  let reqIdx = 0;

  const nodes: SessionNode[] = [];
  // Pair tool_result blocks (in user turns) back to their tool_use by id.
  const toolNodeById = new Map<string, SessionNode>();
  let messageCount = 0;
  let toolCallCount = 0;
  let totalTokens = 0;
  let prevMsg: string | null = null;
  let title = "";

  history.forEach((msg, mi) => {
    const blocks = asBlocks(msg.content);
    const texts: string[] = [];
    const thinking: string[] = [];
    const toolUses: ToolUseBlock[] = [];
    for (const b of blocks) {
      if (b.type === "text" && b.text) texts.push(b.text);
      else if (b.type === "thinking" && b.thinking) thinking.push(b.thinking);
      else if (b.type === "tool_use") toolUses.push(b);
      else if (b.type === "tool_result") {
        const node = toolNodeById.get(b.tool_use_id);
        if (node?.tool) {
          node.tool.result = resultText(b.content);
          node.tool.isError = !!b.is_error;
        }
      }
    }

    let text = texts.join("\n").trim() || undefined;
    const think = thinking.join("\n").trim() || undefined;

    // Cline wraps the opening user request in <task>…</task>; unwrap for title.
    if (text) {
      const m = text.match(/<task>([\s\S]*?)<\/task>/);
      if (m) text = m[1].trim();
    }

    // Skip pure tool-result user turns (no prose) — they're folded into results.
    const isToolResultOnly =
      msg.role === "user" && !text && !think && toolUses.length === 0;

    if (!isToolResultOnly) {
      const role = msg.role === "user" ? "user" : think && !text ? "reasoning" : "assistant";
      let tok: TokenUsage | undefined;
      if (role === "assistant" && reqIdx < tokens.length) {
        tok = tokens[reqIdx++];
        totalTokens += tok.input + tok.output;
      }
      messageCount++;
      const id = `${taskId}:${mi}`;
      nodes.push({
        id,
        parentId: prevMsg,
        role,
        source: SOURCE,
        timestamp: null,
        text,
        thinking: think,
        tokens: tok,
      });
      prevMsg = id;
      if (!title && role === "user" && text) {
        title = text.replace(/\s+/g, " ").slice(0, 80);
      }
    }

    toolUses.forEach((t, ti) => {
      toolCallCount++;
      const tool: ToolInfo = {
        name: t.name,
        input: t.input,
        files: filesFrom(t.input),
      };
      const node: SessionNode = {
        id: `${taskId}:${mi}:tool:${ti}`,
        parentId: prevMsg,
        role: "tool",
        source: SOURCE,
        timestamp: null,
        tool,
      };
      toolNodeById.set(t.id, node);
      nodes.push(node);
    });
  });

  if (!nodes.length) return null;

  const timestamps = ui.map((m) => m.ts).filter((t): t is number => !!t);
  const startedAt = iso(timestamps.length ? Math.min(...timestamps) : undefined);
  const endedAt = iso(timestamps.length ? Math.max(...timestamps) : undefined);

  return {
    id: taskId,
    source: SOURCE,
    cwd: "",
    title: title || "(untitled Cline task)",
    startedAt,
    endedAt,
    messageCount,
    toolCallCount,
    totalTokens,
    filePath: `cline:${taskId}`,
    nodes,
  };
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function existingRoot(): Promise<string | null> {
  for (const root of taskRoots()) {
    try {
      await stat(root);
      return root;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function loadTask(root: string, taskId: string): Promise<UnifiedSession | null> {
  const dir = join(root, taskId);
  const history = await readJson<Message[]>(join(dir, "api_conversation_history.json"));
  if (!history) return null;
  const ui = (await readJson<UiMessage[]>(join(dir, "ui_messages.json"))) ?? [];
  return buildClineSession(taskId, history, ui);
}

export async function loadClineSessions(): Promise<UnifiedSession[]> {
  const root = await existingRoot();
  if (!root) return [];
  let ids: string[];
  try {
    ids = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const sessions = await Promise.all(ids.map((id) => loadTask(root, id)));
  return sessions.filter((s): s is UnifiedSession => !!s);
}

export async function getClineSession(id: string): Promise<UnifiedSession | null> {
  const root = await existingRoot();
  return root ? loadTask(root, id) : null;
}
