// Unified data model shared by all source adapters (Claude Code, Codex, ...).
// Every adapter normalizes its raw local files into these shapes so that all
// visualizations (graph, timeline, file heatmap, transcript) are source-agnostic.

export type Source = "claude-code" | "codex" | "gemini";

export type NodeRole =
  | "user"
  | "assistant"
  | "tool"
  | "reasoning"
  | "system";

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface ToolInfo {
  name: string;
  input: unknown;
  /** Rendered/structured result, when available. */
  result?: unknown;
  isError?: boolean;
  /** Files touched by this tool call (edits, writes, reads), best-effort. */
  files?: string[];
}

export interface SessionNode {
  id: string;
  parentId: string | null;
  role: NodeRole;
  source: Source;
  timestamp: string | null;
  /** Claude Code sub-agent (Task) branches. */
  isSidechain?: boolean;
  text?: string;
  thinking?: string;
  tool?: ToolInfo;
  tokens?: TokenUsage;
  model?: string;
}

export interface SessionSummary {
  id: string;
  source: Source;
  cwd: string;
  gitBranch?: string;
  title: string;
  startedAt: string | null;
  endedAt: string | null;
  messageCount: number;
  toolCallCount: number;
  totalTokens: number;
  model?: string;
  /** Absolute path of the underlying local file. */
  filePath: string;
}

export interface UnifiedSession extends SessionSummary {
  nodes: SessionNode[];
}
