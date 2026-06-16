import type { NodeRole, Source } from "../lib/types";
import {
  User,
  Sparkles,
  Brain,
  Wrench,
  Settings,
  BookOpen,
  Pencil,
  FilePlus2,
  Terminal,
  Search,
  FolderSearch,
  Bot,
  Globe,
  ListTodo,
  NotebookPen,
  GitBranch,
  Gem,
  type LucideIcon,
} from "lucide-react";

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

const ROLE_ICONS: Record<NodeRole, LucideIcon> = {
  user: User,
  assistant: Sparkles,
  reasoning: Brain,
  tool: Wrench,
  system: Settings,
};

export function roleColor(role: NodeRole): string {
  return ROLE_COLORS[role] ?? "#64748b";
}

export function roleLabel(role: NodeRole): string {
  return ROLE_LABELS[role] ?? role;
}

export function roleIcon(role: NodeRole): LucideIcon {
  return ROLE_ICONS[role] ?? Wrench;
}

// Map a tool's name to an evocative icon. Matches Claude Code + Codex tools,
// falling back to a wrench. Loose substring matching tolerates name variants.
const TOOL_ICON_RULES: [RegExp, LucideIcon][] = [
  [/^read|cat|view/i, BookOpen],
  [/^edit|update|str_replace/i, Pencil],
  [/^write|create|multiedit/i, FilePlus2],
  [/bash|shell|exec|run|command/i, Terminal],
  [/^grep|^search|ripgrep/i, Search],
  [/^glob|^ls|find|listdir/i, FolderSearch],
  [/task|agent|spawn|dispatch/i, Bot],
  [/web|fetch|http|url|browse/i, Globe],
  [/todo/i, ListTodo],
  [/notebook|jupyter/i, NotebookPen],
];

export function toolIcon(name: string | undefined): LucideIcon {
  if (!name) return Wrench;
  for (const [re, icon] of TOOL_ICON_RULES) if (re.test(name)) return icon;
  return Wrench;
}

/** Icon for a node, picking a tool-specific glyph for tool nodes. */
export function nodeIcon(role: NodeRole, toolName?: string): LucideIcon {
  return role === "tool" ? toolIcon(toolName) : roleIcon(role);
}

const SOURCE_META: Record<Source, { icon: LucideIcon; label: string }> = {
  "claude-code": { icon: Sparkles, label: "Claude Code" },
  codex: { icon: GitBranch, label: "Codex" },
  gemini: { icon: Gem, label: "Gemini" },
};

export function SourceBadge({ source }: { source: Source }) {
  const { icon: Icon, label } = SOURCE_META[source] ?? SOURCE_META["claude-code"];
  return (
    <span className={`badge badge-${source} inline-flex items-center gap-1`}>
      <Icon size={11} />
      {label}
    </span>
  );
}
