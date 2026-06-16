// Adapter: Gemini CLI session logs.
// Gemini CLI stores its conversation history as Gemini API `Content` objects
// (the @google/genai shape) under ~/.gemini/tmp/<project-hash>/ — saved chat
// checkpoints (`checkpoint-*.json`) and recorded sessions.
//
// A Content is { role: "user" | "model", parts: Part[] } where a Part is one of:
//   { text }                              — message / (when thought:true) reasoning
//   { thought: true, text }               — model thinking
//   { functionCall: { name, args } }      — a tool call
//   { functionResponse: { name, response } } — that tool's result (next user turn)
//
// We accept both a bare `Content[]` array and an envelope object that carries
// session metadata ({ model, cwd, sessionId, history|messages|contents }), and
// tolerate either a single JSON document or one-Content-per-line JSONL.

import type {
  SessionNode,
  SessionSummary,
  TokenUsage,
  ToolInfo,
  UnifiedSession,
} from "../types";

const SOURCE = "gemini" as const;

interface Part {
  text?: string;
  thought?: boolean;
  functionCall?: { name?: string; args?: unknown };
  functionResponse?: { name?: string; response?: unknown };
}
interface Content {
  role?: string;
  parts?: Part[];
  /** Some recordings attach per-turn usage to the model Content. */
  usageMetadata?: any;
}

function parseUsage(usage: any): TokenUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const input = usage.promptTokenCount ?? usage.prompt_tokens ?? 0;
  const output = usage.candidatesTokenCount ?? usage.candidates_tokens ?? 0;
  const cacheRead = usage.cachedContentTokenCount ?? usage.cached_content_tokens ?? 0;
  if (!input && !output && !cacheRead) return undefined;
  return { input, output, cacheRead, cacheCreation: 0 };
}

// Best-effort file extraction from Gemini tool args (write_file, replace,
// read_file, …) — the keys Gemini's built-in tools use for paths.
function filesFromArgs(args: unknown): string[] | undefined {
  if (!args || typeof args !== "object") return undefined;
  const out: string[] = [];
  for (const key of ["file_path", "absolute_path", "path", "filename"]) {
    const v = (args as Record<string, unknown>)[key];
    if (typeof v === "string") out.push(v);
  }
  return out.length ? out : undefined;
}

function partsText(parts: Part[], opts: { thought: boolean }): string | undefined {
  const acc: string[] = [];
  for (const p of parts) {
    if (typeof p.text !== "string" || !p.text) continue;
    if (!!p.thought === opts.thought) acc.push(p.text);
  }
  return acc.length ? acc.join("\n") : undefined;
}

// Locate the array of Content objects plus any envelope metadata.
interface Parsed {
  contents: Content[];
  model?: string;
  cwd?: string;
  sessionId?: string;
}

function parseRaw(raw: string): Parsed | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try a single JSON document first (checkpoint array or envelope object).
  try {
    const doc = JSON.parse(trimmed);
    if (Array.isArray(doc)) return { contents: doc as Content[] };
    if (doc && typeof doc === "object") {
      const contents =
        doc.history ?? doc.messages ?? doc.contents ?? doc.conversation;
      if (Array.isArray(contents)) {
        return {
          contents: contents as Content[],
          model: doc.model ?? doc.modelVersion,
          cwd: doc.cwd ?? doc.projectRoot,
          sessionId: doc.sessionId ?? doc.id,
        };
      }
    }
  } catch {
    /* fall through to JSONL */
  }

  // JSONL: one Content (or wrapper line) per line.
  const contents: Content[] = [];
  let model: string | undefined;
  let cwd: string | undefined;
  let sessionId: string | undefined;
  for (const line of trimmed.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj?.role && Array.isArray(obj.parts)) contents.push(obj);
      else if (obj?.type === "session" || obj?.sessionId) {
        model ??= obj.model;
        cwd ??= obj.cwd;
        sessionId ??= obj.sessionId ?? obj.id;
      }
    } catch {
      /* tolerate corrupt lines */
    }
  }
  return contents.length ? { contents, model, cwd, sessionId } : null;
}

export function parseGeminiSession(
  raw: string,
  filePath: string,
): UnifiedSession | null {
  const parsed = parseRaw(raw);
  if (!parsed || !parsed.contents.length) return null;

  const nodes: SessionNode[] = [];
  let model = parsed.model;
  let title = "";
  let messageCount = 0;
  let toolCallCount = 0;
  let totalTokens = 0;
  let prevId: string | null = null;
  let i = 0;

  // Tool nodes awaiting a functionResponse, oldest first, for name-based pairing.
  const pendingTools: SessionNode[] = [];

  for (const content of parsed.contents) {
    const role = content.role;
    const parts = Array.isArray(content.parts) ? content.parts : [];

    // A user turn carrying only functionResponse parts is a tool-result carrier.
    const responses = parts.filter((p) => p.functionResponse);
    if (role === "user" && responses.length && !partsText(parts, { thought: false })) {
      for (const r of responses) {
        const name = r.functionResponse?.name;
        const idx = name
          ? pendingTools.findIndex((t) => t.tool?.name === name)
          : 0;
        const target = idx >= 0 ? pendingTools.splice(idx, 1)[0] : pendingTools.shift();
        if (target?.tool) {
          const resp = r.functionResponse?.response as any;
          target.tool.result = resp?.output ?? resp?.content ?? resp ?? null;
          if (resp?.error || resp?.isError) target.tool.isError = true;
        }
      }
      continue;
    }

    if (role === "user") {
      const text = partsText(parts, { thought: false });
      if (!text) continue;
      messageCount++;
      const id = `gemini:${i++}`;
      nodes.push({ id, parentId: prevId, role: "user", source: SOURCE, timestamp: null, text });
      if (!title) title = text.replace(/\s+/g, " ").trim().slice(0, 80);
      prevId = id;
      continue;
    }

    // role === "model" (assistant turn): text, thinking and tool calls.
    const text = partsText(parts, { thought: false });
    const thinking = partsText(parts, { thought: true });
    const calls = parts.filter((p) => p.functionCall);
    const tokens = parseUsage(content.usageMetadata);
    if (tokens) totalTokens += tokens.input + tokens.output;

    if (text || thinking) {
      messageCount++;
      const id = `gemini:${i++}`;
      nodes.push({
        id,
        parentId: prevId,
        role: thinking && !text ? "reasoning" : "assistant",
        source: SOURCE,
        timestamp: null,
        text,
        thinking,
        tokens,
        model,
      });
      prevId = id;
    }

    for (const c of calls) {
      toolCallCount++;
      const name = c.functionCall?.name ?? "function";
      const args = c.functionCall?.args;
      const tool: ToolInfo = { name, input: args, files: filesFromArgs(args) };
      const id = `gemini:${i++}`;
      const toolNode: SessionNode = {
        id,
        parentId: prevId,
        role: "tool",
        source: SOURCE,
        timestamp: null,
        tool,
      };
      nodes.push(toolNode);
      pendingTools.push(toolNode);
      prevId = id;
    }
  }

  if (!nodes.length) return null;
  if (!title) title = "(untitled Gemini session)";

  const summary: SessionSummary = {
    id: parsed.sessionId || filePath,
    source: SOURCE,
    cwd: parsed.cwd ?? "",
    title,
    startedAt: null,
    endedAt: null,
    messageCount,
    toolCallCount,
    totalTokens,
    model,
    filePath,
  };

  return { ...summary, nodes };
}
