import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
  type NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Dagre from "@dagrejs/dagre";
import { ChevronRight, ChevronDown, Bot } from "lucide-react";
import type { SessionNode, UnifiedSession, NodeRole } from "../lib/types";
import { roleColor, roleLabel, nodeIcon } from "./ui";

const ALL_ROLES: NodeRole[] = ["user", "assistant", "reasoning", "tool", "system"];
type Dir = "LR" | "TB";

const NODE_W = 240;
const NODE_BASE_H = 56;

interface GraphNodeData extends Record<string, unknown> {
  node: SessionNode;
  tools: SessionNode[];
  active: boolean;
  dimmed: boolean;
  /** This node is the entry point of a sub-agent (sidechain) branch. */
  isSubAgentRoot: boolean;
  /** Number of descendants currently folded away under this root. */
  hiddenCount: number;
  collapsed: boolean;
  onToggleCollapse: (id: string) => void;
  onPickTool: (n: SessionNode) => void;
}

function estimateHeight(d: { tools: SessionNode[]; node: SessionNode }): number {
  const preview = d.node.text ?? d.node.thinking ?? "";
  let h = NODE_BASE_H;
  if (preview) h += 18;
  if (d.tools.length) h += 26;
  return h;
}

function AgentNode({ data }: NodeProps) {
  const {
    node, tools, active, dimmed,
    isSubAgentRoot, hiddenCount, collapsed, onToggleCollapse, onPickTool,
  } = data as GraphNodeData;
  const color = roleColor(node.role);
  const Icon = nodeIcon(node.role, node.tool?.name);
  const label = roleLabel(node.role);
  const preview = (node.text ?? node.thinking ?? "")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  const tokens = node.tokens ? node.tokens.input + node.tokens.output : 0;
  const canCollapse = isSubAgentRoot && (hiddenCount > 0 || collapsed);

  return (
    <div
      className={`rounded-xl border-[1.5px] bg-panel-2 px-2.5 py-2 text-xs shadow-lg transition-opacity ${
        node.isSidechain ? "border-dashed" : ""
      } ${active ? "ring-2 ring-accent" : ""} ${dimmed ? "opacity-25" : ""}`}
      style={{ width: NODE_W, borderColor: color }}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="flex items-center gap-1.5">
        <Icon size={13} style={{ color }} />
        <span className="font-semibold">{label}</span>
        {node.isSidechain && (
          <span className="rounded bg-white/5 px-1 text-[10px] text-muted">sub-agent</span>
        )}
        {canCollapse && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(node.id);
            }}
            title={collapsed ? `Expand sub-agent (${hiddenCount} hidden)` : "Collapse sub-agent"}
            className="inline-flex items-center gap-0.5 rounded border border-border px-1 text-[10px] text-muted hover:text-text hover:border-accent"
          >
            {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
            {collapsed && <span className="tabular-nums">{hiddenCount}</span>}
          </button>
        )}
        {tokens > 0 && (
          <span className="ml-auto text-[11px] text-muted tabular-nums">{tokens}</span>
        )}
      </div>
      {preview && (
        <div className="mt-1 truncate text-muted">{preview}</div>
      )}
      {tools.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {tools.map((t) => {
            const TIcon = nodeIcon("tool", t.tool?.name);
            return (
              <button
                key={t.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onPickTool(t);
                }}
                title={t.tool?.files?.join(", ") || t.tool?.name}
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] hover:bg-white/5 ${
                  t.tool?.isError ? "border-red-500/50 text-red-400" : "border-border text-role-tool"
                }`}
              >
                <TIcon size={10} />
                {t.tool?.name}
              </button>
            );
          })}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

interface AnchorNode {
  node: SessionNode;
  tools: SessionNode[];
}

// Turn the raw 200-node forest into a readable graph:
//   1. fold tool nodes into their turn as chips,
//   2. merge tool-only assistant turns into the previous content-bearing turn
//      ("chain compaction" — the single biggest readability win),
//   3. reconnect the fragments (parentUuid breaks where carrier entries were
//      dropped) into one chronological spine, preserving real sub-agent branches,
//   4. lay it out with dagre (LR/TB) instead of the depth×order staircase.
function layout(
  session: UnifiedSession,
  dir: Dir,
): {
  graphNodes: AnchorNode[];
  edges: Edge[];
  pos: Map<string, { x: number; y: number; h: number }>;
} {
  const byId = new Map<string, SessionNode>();
  for (const n of session.nodes) byId.set(n.id, n);

  const toolsByParent = new Map<string, SessionNode[]>();
  for (const n of session.nodes) {
    if (n.role === "tool" && n.parentId) {
      if (!toolsByParent.has(n.parentId)) toolsByParent.set(n.parentId, []);
      toolsByParent.get(n.parentId)!.push(n);
    }
  }

  const hasContent = (n: SessionNode) =>
    !!(n.text?.trim() || n.thinking?.trim()) || n.role === "user";

  // Build anchors in document (chronological) order, merging tool-only turns.
  const anchors: AnchorNode[] = [];
  const anchorIdOf = new Map<string, string>(); // any node id -> its anchor id
  let current: AnchorNode | null = null;
  for (const n of session.nodes) {
    if (n.role === "tool") continue;
    const tools = toolsByParent.get(n.id) ?? [];
    // A tool-only assistant turn folds into the running anchor.
    if (current && !hasContent(n) && !n.isSidechain && current.node.role !== "user") {
      current.tools.push(...tools);
      anchorIdOf.set(n.id, current.node.id);
      continue;
    }
    current = { node: n, tools: [...tools] };
    anchors.push(current);
    anchorIdOf.set(n.id, n.id);
  }

  const anchorIds = new Set(anchors.map((a) => a.node.id));
  const resolveAnchor = (id: string | null | undefined): string | null => {
    let cur = id;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      const a = anchorIdOf.get(cur);
      if (a && anchorIds.has(a)) return a;
      cur = byId.get(cur)?.parentId ?? null;
    }
    return null;
  };

  // Edges: real parent when resolvable, else chain to the previous anchor so the
  // dropped-carrier fragments form one connected flow.
  const edges: Edge[] = [];
  const seen = new Set<string>();
  let prev: string | null = null;
  for (const a of anchors) {
    const real = resolveAnchor(a.node.parentId);
    const source: string | null = real && real !== a.node.id ? real : prev;
    if (source && source !== a.node.id) {
      const id = `${source}->${a.node.id}`;
      if (!seen.has(id)) {
        seen.add(id);
        edges.push({
          id,
          source,
          target: a.node.id,
          type: "smoothstep",
          animated: a.node.isSidechain,
          style: { stroke: a.node.isSidechain ? "#a78bfa" : "#3a3f4b" },
        });
      }
    }
    prev = a.node.id;
  }

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: dir, ranksep: dir === "LR" ? 70 : 48, nodesep: 26 });
  for (const a of anchors) {
    g.setNode(a.node.id, { width: NODE_W, height: estimateHeight(a) });
  }
  for (const e of edges) g.setEdge(e.source, e.target);
  Dagre.layout(g);

  const pos = new Map<string, { x: number; y: number; h: number }>();
  for (const a of anchors) {
    const gn = g.node(a.node.id);
    if (gn) pos.set(a.node.id, { x: gn.x - gn.width / 2, y: gn.y - gn.height / 2, h: gn.height });
  }

  return { graphNodes: anchors, edges, pos };
}

function matches(node: SessionNode, tools: SessionNode[], q: string): boolean {
  if (!q) return false;
  const hay = [
    node.text,
    node.thinking,
    ...tools.map((t) => t.tool?.name),
    ...tools.map((t) =>
      typeof t.tool?.input === "string" ? t.tool.input : JSON.stringify(t.tool?.input ?? ""),
    ),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

export function GraphView({
  session,
  activeId,
  onSelect,
}: {
  session: UnifiedSession;
  activeId: string | null;
  onSelect: (n: SessionNode) => void;
}) {
  const [hidden, setHidden] = useState<Set<NodeRole>>(new Set());
  const [search, setSearch] = useState("");
  const [dir, setDir] = useState<Dir>("LR");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const base = useMemo(() => layout(session, dir), [session, dir]);

  // Forget collapse state when a different session loads (node ids change).
  useEffect(() => setCollapsed(new Set()), [session]);

  // Identify sub-agent (sidechain) branches and the anchors under each so we can
  // fold a whole sub-agent subtree into its entry node. The graph is a forest —
  // each anchor has at most one incoming edge — so a simple parent/child walk
  // recovers the subtrees.
  const subtrees = useMemo(() => {
    const anchorById = new Map(base.graphNodes.map((a) => [a.node.id, a]));
    const parentOf = new Map<string, string>();
    const childrenOf = new Map<string, string[]>();
    for (const e of base.edges) {
      parentOf.set(e.target, e.source);
      (childrenOf.get(e.source) ?? childrenOf.set(e.source, []).get(e.source)!).push(e.target);
    }
    const isSide = (id?: string | null) =>
      !!(id && anchorById.get(id)?.node.isSidechain);

    const roots = new Set<string>();
    for (const a of base.graphNodes) {
      if (a.node.isSidechain && !isSide(parentOf.get(a.node.id))) roots.add(a.node.id);
    }
    // Descendants of each root, following only into sidechain anchors so the
    // main thread that resumes after the sub-agent stays visible.
    const descendants = new Map<string, Set<string>>();
    for (const root of roots) {
      const set = new Set<string>();
      const stack = [...(childrenOf.get(root) ?? [])];
      while (stack.length) {
        const id = stack.pop()!;
        if (set.has(id) || !isSide(id)) continue;
        set.add(id);
        for (const c of childrenOf.get(id) ?? []) stack.push(c);
      }
      descendants.set(root, set);
    }
    return { roots, descendants };
  }, [base]);

  const collapsedHidden = useMemo(() => {
    const h = new Set<string>();
    for (const root of collapsed) {
      const d = subtrees.descendants.get(root);
      if (d) for (const id of d) h.add(id);
    }
    return h;
  }, [collapsed, subtrees]);

  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const nodes: Node[] = useMemo(() => {
    const q = search.trim();
    return base.graphNodes
      .filter(({ node }) => !hidden.has(node.role) && !collapsedHidden.has(node.id))
      .map(({ node, tools }) => {
        const p = base.pos.get(node.id) ?? { x: 0, y: 0, h: NODE_BASE_H };
        return {
          id: node.id,
          type: "agent",
          position: { x: p.x, y: p.y },
          data: {
            node,
            tools: hidden.has("tool") ? [] : tools,
            active: node.id === activeId,
            dimmed: q.length > 0 && !matches(node, tools, q),
            isSubAgentRoot: subtrees.roots.has(node.id),
            hiddenCount: subtrees.descendants.get(node.id)?.size ?? 0,
            collapsed: collapsed.has(node.id),
            onToggleCollapse: toggleCollapse,
            onPickTool: onSelect,
          } satisfies GraphNodeData,
        };
      });
  }, [base, hidden, activeId, search, onSelect, subtrees, collapsed, collapsedHidden]);

  const visibleIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const edges = useMemo(
    () => base.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    [base.edges, visibleIds],
  );

  const toggle = (role: NodeRole) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(role) ? next.delete(role) : next.add(role);
      return next;
    });

  return (
    <div className="relative h-full">
      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
        <input
          className="w-56 rounded-lg border border-border bg-panel-2/90 px-3 py-1.5 text-sm outline-none backdrop-blur focus:border-accent"
          placeholder="Highlight nodes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap gap-1.5">
          {ALL_ROLES.map((r) => (
            <button
              key={r}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs backdrop-blur transition-opacity ${
                hidden.has(r) ? "opacity-40" : ""
              }`}
              style={{ borderColor: roleColor(r) }}
              onClick={() => toggle(r)}
              title={hidden.has(r) ? `Show ${r}` : `Hide ${r}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: roleColor(r) }} />
              {roleLabel(r)}
            </button>
          ))}
        </div>
        <button
          className="rounded-full border border-border bg-panel-2/90 px-2.5 py-1 text-xs backdrop-blur hover:border-accent"
          onClick={() => setDir((d) => (d === "LR" ? "TB" : "LR"))}
          title="Toggle layout direction"
        >
          {dir === "LR" ? "↔ Horizontal" : "↕ Vertical"}
        </button>
        {subtrees.roots.size > 0 && (
          <button
            className="inline-flex items-center gap-1 rounded-full border border-border bg-panel-2/90 px-2.5 py-1 text-xs backdrop-blur hover:border-accent"
            onClick={() =>
              setCollapsed((prev) =>
                prev.size >= subtrees.roots.size ? new Set() : new Set(subtrees.roots),
              )
            }
            title="Collapse or expand all sub-agent branches"
          >
            <Bot size={12} />
            {collapsed.size >= subtrees.roots.size ? "Expand all" : "Collapse all"} (
            {subtrees.roots.size})
          </button>
        )}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ minZoom: 0.4, maxZoom: 1 }}
        minZoom={0.04}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => {
          const node = session.nodes.find((x) => x.id === n.id);
          if (node) onSelect(node);
        }}
        colorMode="dark"
      >
        <Background color="#222632" gap={20} />
        <Controls />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => roleColor((n.data as GraphNodeData).node.role)}
          maskColor="rgba(13,15,20,0.7)"
        />
      </ReactFlow>
    </div>
  );
}
