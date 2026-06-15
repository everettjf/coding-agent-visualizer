// Adapter: Claude Code session transcripts.
// Files live at ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
// Each line is one entry; entries form a tree via uuid / parentUuid.

import type {
  SessionNode,
  SessionSummary,
  TokenUsage,
  ToolInfo,
  UnifiedSession,
} from "../types";

interface RawEntry {
  type: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  isSidechain?: boolean;
  message?: any;
  toolUseResult?: any;
}

const SOURCE = "claude-code" as const;

function parseUsage(usage: any): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheCreation: usage.cache_creation_input_tokens ?? 0,
  };
}

// Best-effort: pull file paths out of common tool inputs.
function filesFromTool(name: string, input: any): string[] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: string[] = [];
  for (const key of ["file_path", "path", "notebook_path"]) {
    if (typeof input[key] === "string") out.push(input[key]);
  }
  return out.length ? out : undefined;
}

// Normalize a tool_result `content` (string | block[]) into a display string.
function toolResultText(content: any): string | undefined {
  if (typeof content === "string") return content || undefined;
  if (Array.isArray(content)) {
    const parts = content
      .map((b) => (typeof b === "string" ? b : typeof b?.text === "string" ? b.text : ""))
      .filter(Boolean);
    return parts.length ? parts.join("\n") : undefined;
  }
  return undefined;
}

function textFromContent(content: any): { text?: string; thinking?: string } {
  if (typeof content === "string") return { text: content };
  if (!Array.isArray(content)) return {};
  const texts: string[] = [];
  const thinking: string[] = [];
  for (const block of content) {
    if (block?.type === "text" && block.text) texts.push(block.text);
    else if (block?.type === "thinking" && block.thinking)
      thinking.push(block.thinking);
  }
  return {
    text: texts.length ? texts.join("\n") : undefined,
    thinking: thinking.length ? thinking.join("\n") : undefined,
  };
}

export function parseClaudeCodeSession(
  raw: string,
  filePath: string,
): UnifiedSession | null {
  const lines = raw.split("\n").filter((l) => l.trim());
  if (!lines.length) return null;

  const entries: RawEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // tolerate corrupt / partial lines (live sessions)
    }
  }
  if (!entries.length) return null;

  // Raw uuid -> parentUuid for ALL entries, so that when we skip an entry
  // (e.g. a tool_result carrier) we can still reconnect its children to the
  // nearest surviving ancestor instead of orphaning them.
  const rawParent = new Map<string, string | null>();
  for (const e of entries) {
    if (e.uuid) rawParent.set(e.uuid, e.parentUuid ?? null);
  }

  const nodes: SessionNode[] = [];
  // Map a tool_use id -> node so a later tool_result can attach to it.
  const toolNodeByUseId = new Map<string, SessionNode>();

  let cwd = "";
  let gitBranch: string | undefined;
  let sessionId = "";
  let model: string | undefined;
  let title = "";
  let firstTs: string | null = null;
  let lastTs: string | null = null;
  let messageCount = 0;
  let toolCallCount = 0;
  let totalTokens = 0;

  for (const e of entries) {
    if (e.cwd) cwd = e.cwd;
    if (e.gitBranch) gitBranch = e.gitBranch;
    if (e.sessionId) sessionId = e.sessionId;
    if (e.timestamp) {
      if (!firstTs) firstTs = e.timestamp;
      lastTs = e.timestamp;
    }

    const msg = e.message;

    if (e.type === "user" && msg) {
      // A user entry is either a real user prompt or a carrier for tool_result blocks.
      const content = msg.content;
      if (Array.isArray(content)) {
        const results = content.filter((b: any) => b?.type === "tool_result");
        if (results.length) {
          for (const r of results) {
            const node = toolNodeByUseId.get(r.tool_use_id);
            if (node && node.tool) {
              // Prefer the model-facing text (uniform & searchable); fall back to
              // the richer structured toolUseResult when there's no text content.
              node.tool.result = toolResultText(r.content) ?? e.toolUseResult;
              node.tool.isError = r.is_error === true;
            }
          }
          continue; // not a visible user turn
        }
      }
      const { text } = textFromContent(content);
      messageCount++;
      nodes.push({
        id: e.uuid!,
        parentId: e.parentUuid ?? null,
        role: "user",
        source: SOURCE,
        timestamp: e.timestamp ?? null,
        isSidechain: e.isSidechain,
        text,
      });
      if (!title && text) title = text.replace(/\s+/g, " ").trim().slice(0, 80);
    } else if (e.type === "assistant" && msg) {
      if (msg.model) model = msg.model;
      const { text, thinking } = textFromContent(msg.content);
      const tokens = parseUsage(msg.usage);
      if (tokens) totalTokens += tokens.input + tokens.output;
      messageCount++;

      const assistantNode: SessionNode = {
        id: e.uuid!,
        parentId: e.parentUuid ?? null,
        role: thinking && !text ? "reasoning" : "assistant",
        source: SOURCE,
        timestamp: e.timestamp ?? null,
        isSidechain: e.isSidechain,
        text,
        thinking,
        tokens,
        model: msg.model,
      };
      nodes.push(assistantNode);

      // Tool calls become child nodes of the assistant turn.
      const content = msg.content;
      if (Array.isArray(content)) {
        let idx = 0;
        for (const block of content) {
          if (block?.type !== "tool_use") continue;
          toolCallCount++;
          const tool: ToolInfo = {
            name: block.name,
            input: block.input,
            files: filesFromTool(block.name, block.input),
          };
          const toolNode: SessionNode = {
            id: `${e.uuid}:tool:${idx++}`,
            parentId: e.uuid!,
            role: "tool",
            source: SOURCE,
            timestamp: e.timestamp ?? null,
            isSidechain: e.isSidechain,
            tool,
          };
          nodes.push(toolNode);
          if (block.id) toolNodeByUseId.set(block.id, toolNode);
        }
      }
    }
    // attachment / system / mode / queue-operation / last-prompt are skipped
    // for the graph (they are metadata, surfaced elsewhere later).
  }

  // Reconnect nodes whose parent was a skipped entry to the nearest alive ancestor.
  const alive = new Set(nodes.map((n) => n.id));
  const resolveParent = (pid: string | null): string | null => {
    let cur = pid;
    const seen = new Set<string>();
    while (cur && !alive.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = rawParent.get(cur) ?? null;
    }
    return cur && alive.has(cur) ? cur : null;
  };
  for (const n of nodes) {
    if (n.parentId && !alive.has(n.parentId)) n.parentId = resolveParent(n.parentId);
  }

  if (!title) title = "(untitled session)";

  const summary: SessionSummary = {
    id: sessionId || filePath,
    source: SOURCE,
    cwd,
    gitBranch,
    title,
    startedAt: firstTs,
    endedAt: lastTs,
    messageCount,
    toolCallCount,
    totalTokens,
    model,
    filePath,
  };

  return { ...summary, nodes };
}
