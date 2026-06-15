// Adapter: OpenAI Codex CLI session rollouts.
// Files live at ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
// First line is session meta; subsequent lines are response_item / event_msg.
// Implemented best-effort against the documented format; tolerant of variants.

import type {
  SessionNode,
  SessionSummary,
  ToolInfo,
  UnifiedSession,
} from "../types";

const SOURCE = "codex" as const;

function textFromCodexContent(content: any): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (typeof b === "string") parts.push(b);
      else if (typeof b?.text === "string") parts.push(b.text);
    }
    return parts.length ? parts.join("\n") : undefined;
  }
  return undefined;
}

export function parseCodexSession(
  raw: string,
  filePath: string,
): UnifiedSession | null {
  const lines = raw.split("\n").filter((l) => l.trim());
  if (!lines.length) return null;

  const nodes: SessionNode[] = [];
  let cwd = "";
  let sessionId = "";
  let model: string | undefined;
  let title = "";
  let firstTs: string | null = null;
  let lastTs: string | null = null;
  let messageCount = 0;
  let toolCallCount = 0;
  let totalTokens = 0;
  let prevId: string | null = null;
  let i = 0;

  for (const line of lines) {
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = e.timestamp ?? null;
    if (ts) {
      if (!firstTs) firstTs = ts;
      lastTs = ts;
    }

    // Session metadata (first line).
    if (e.type === "session_meta" || e.payload?.cwd || e.cwd) {
      const meta = e.payload ?? e;
      if (meta.cwd) cwd = meta.cwd;
      if (meta.id) sessionId = meta.id;
      if (meta.model) model = meta.model;
      if (!cwd && e.cwd) cwd = e.cwd;
      continue;
    }

    // Token accounting (event_msg / token_count).
    if (e.type === "event_msg" || e.type === "token_count") {
      const info = e.payload ?? e;
      const total =
        info.total_tokens ??
        info.info?.total_token_usage?.total_tokens ??
        0;
      if (typeof total === "number" && total > totalTokens) totalTokens = total;
      continue;
    }

    // Response items: message / reasoning / function_call / function_call_output.
    const payload = e.payload ?? e;
    const ptype = payload.type;
    const id = `codex:${i++}`;

    if (ptype === "message") {
      const role = payload.role === "assistant" ? "assistant" : "user";
      const text = textFromCodexContent(payload.content);
      messageCount++;
      nodes.push({
        id,
        parentId: prevId,
        role,
        source: SOURCE,
        timestamp: ts,
        text,
      });
      if (!title && role === "user" && text) title = text.slice(0, 80);
      prevId = id;
    } else if (ptype === "reasoning") {
      const thinking = textFromCodexContent(
        payload.summary ?? payload.content,
      );
      nodes.push({
        id,
        parentId: prevId,
        role: "reasoning",
        source: SOURCE,
        timestamp: ts,
        thinking,
      });
      prevId = id;
    } else if (ptype === "function_call" || ptype === "local_shell_call") {
      toolCallCount++;
      let input: unknown = payload.arguments ?? payload.action;
      if (typeof input === "string") {
        try {
          input = JSON.parse(input);
        } catch {
          /* keep raw string */
        }
      }
      const tool: ToolInfo = {
        name: payload.name ?? (ptype === "local_shell_call" ? "shell" : "tool"),
        input,
      };
      nodes.push({
        id,
        parentId: prevId,
        role: "tool",
        source: SOURCE,
        timestamp: ts,
        tool,
      });
      prevId = id;
    } else if (ptype === "function_call_output") {
      // Attach to the most recent tool node.
      for (let j = nodes.length - 1; j >= 0; j--) {
        if (nodes[j].role === "tool" && nodes[j].tool && !nodes[j].tool!.result) {
          nodes[j].tool!.result = payload.output;
          break;
        }
      }
    }
  }

  if (!title) title = "(untitled session)";

  const summary: SessionSummary = {
    id: sessionId || filePath,
    source: SOURCE,
    cwd,
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
