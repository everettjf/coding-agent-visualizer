// Adapter: OpenAI Codex CLI session rollouts.
// Files live at ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
//
// Each line is a "RolloutLine": { timestamp, type, payload }. Types seen:
//   - session_meta      : { payload: { id, cwd, cli_version, model?, instructions, git } }
//   - response_item     : { payload: { type: message | reasoning | function_call
//                                       | function_call_output | local_shell_call } }
//   - event_msg         : { payload: { type: token_count | task_started | ... } }
//   - turn_context      : per-turn context (model, cwd) — used to fill metadata
// Message content blocks use input_text / output_text / summary_text { text }.

import type {
  SessionNode,
  SessionSummary,
  ToolInfo,
  UnifiedSession,
} from "../types";

const SOURCE = "codex" as const;

// Pull readable text from Codex content (string | block[] with input_text/
// output_text/summary_text/text).
function extractText(content: unknown): string | undefined {
  if (typeof content === "string") return content || undefined;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (typeof b === "string") parts.push(b);
      else if (b && typeof b === "object" && typeof (b as any).text === "string")
        parts.push((b as any).text);
    }
    return parts.length ? parts.join("\n") : undefined;
  }
  return undefined;
}

// Codex edits go through an `apply_patch` shell call; pull file paths out when
// we can so the file heatmap works for Codex too.
function filesFromArguments(name: string, input: unknown): string[] | undefined {
  const text =
    typeof input === "string" ? input : input ? JSON.stringify(input) : "";
  if (!/apply_patch|\*\*\* (Add|Update|Delete) File/.test(text)) {
    if (name === "apply_patch" && input && typeof input === "object") {
      // structured apply_patch
    } else if (!/apply_patch/.test(name)) {
      return undefined;
    }
  }
  const files = new Set<string>();
  // Stop at a real or escaped newline, backslash or quote so we capture just the path.
  const re = /\*\*\* (?:Add|Update|Delete) File: ([^\n\\"]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) files.add(m[1].trim());
  return files.size ? [...files] : undefined;
}

function mapRole(role: unknown): "user" | "assistant" | "system" {
  if (role === "assistant") return "assistant";
  if (role === "user") return "user";
  return "system"; // developer / tool / system
}

export function parseCodexSession(
  raw: string,
  filePath: string,
): UnifiedSession | null {
  const lines = raw.split("\n").filter((l) => l.trim());
  if (!lines.length) return null;

  const nodes: SessionNode[] = [];
  const toolByCallId = new Map<string, SessionNode>();

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

    const ts: string | null = e.timestamp ?? null;
    if (ts) {
      if (!firstTs) firstTs = ts;
      lastTs = ts;
    }

    const payload = e.payload ?? e;

    // --- session metadata / turn context ---
    if (e.type === "session_meta" || (e.type == null && payload?.instructions)) {
      if (payload.cwd) cwd = payload.cwd;
      if (payload.id) sessionId = payload.id;
      if (payload.model) model = payload.model;
      continue;
    }
    if (e.type === "turn_context") {
      if (payload.cwd && !cwd) cwd = payload.cwd;
      if (payload.model) model = payload.model;
      continue;
    }

    // --- token accounting ---
    if (e.type === "event_msg") {
      if (payload?.type === "token_count") {
        const total =
          payload.info?.total_token_usage?.total_tokens ??
          payload.total_tokens ??
          0;
        if (typeof total === "number" && total > totalTokens) totalTokens = total;
      }
      continue; // event_msg duplicates response_items for the UI; skip otherwise
    }

    // --- response items ---
    const ptype = payload?.type;
    const id = `codex:${i++}`;

    if (ptype === "message") {
      const role = mapRole(payload.role);
      const text = extractText(payload.content);
      if (!text) continue;
      messageCount++;
      nodes.push({ id, parentId: prevId, role, source: SOURCE, timestamp: ts, text });
      if (!title && role === "user") title = text.replace(/\s+/g, " ").trim().slice(0, 80);
      prevId = id;
    } else if (ptype === "reasoning") {
      const thinking = extractText(payload.summary ?? payload.content);
      if (!thinking) continue;
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
      let input: unknown = payload.arguments ?? payload.action ?? payload.command;
      if (typeof input === "string") {
        try {
          input = JSON.parse(input);
        } catch {
          /* keep raw string */
        }
      }
      const name =
        payload.name ?? (ptype === "local_shell_call" ? "shell" : "function");
      const tool: ToolInfo = {
        name,
        input,
        files: filesFromArguments(name, payload.arguments ?? input),
      };
      const node: SessionNode = {
        id,
        parentId: prevId,
        role: "tool",
        source: SOURCE,
        timestamp: ts,
        tool,
      };
      nodes.push(node);
      if (payload.call_id) toolByCallId.set(payload.call_id, node);
      prevId = id;
    } else if (ptype === "function_call_output") {
      const target =
        (payload.call_id && toolByCallId.get(payload.call_id)) ||
        [...nodes].reverse().find((n) => n.role === "tool" && n.tool && n.tool.result === undefined);
      if (target?.tool) {
        const out = payload.output;
        target.tool.result = out?.content ?? out;
        if (out?.metadata?.exit_code != null && out.metadata.exit_code !== 0)
          target.tool.isError = true;
      }
    }
  }

  if (!title) title = "(untitled Codex session)";

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
