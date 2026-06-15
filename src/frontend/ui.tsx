import type { NodeRole, Source } from "../lib/types";

const ROLE_COLORS: Record<NodeRole, string> = {
  user: "#4f9cf9",
  assistant: "#22c55e",
  reasoning: "#a78bfa",
  tool: "#f59e0b",
  system: "#64748b",
};

const ROLE_LABELS: Record<NodeRole, string> = {
  user: "User",
  assistant: "Assistant",
  reasoning: "Reasoning",
  tool: "Tool",
  system: "System",
};

export function roleColor(role: NodeRole): string {
  return ROLE_COLORS[role] ?? "#64748b";
}

export function roleLabel(role: NodeRole): string {
  return ROLE_LABELS[role] ?? role;
}

export function SourceBadge({ source }: { source: Source }) {
  const label = source === "claude-code" ? "Claude Code" : "Codex";
  return (
    <span className={`badge badge-${source}`}>{label}</span>
  );
}
