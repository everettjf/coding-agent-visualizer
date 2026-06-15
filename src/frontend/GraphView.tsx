import { useMemo, useState } from "react";
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
import type { SessionNode, UnifiedSession, NodeRole } from "../lib/types";
import { roleColor, roleLabel } from "./ui";

const X_GAP = 230;
const Y_GAP = 88;
const ALL_ROLES: NodeRole[] = ["user", "assistant", "reasoning", "tool", "system"];

interface GraphNodeData extends Record<string, unknown> {
  node: SessionNode;
  active: boolean;
  dimmed: boolean;
}

function AgentNode({ data }: NodeProps) {
  const { node, active, dimmed } = data as GraphNodeData;
  const color = roleColor(node.role);
  const label = node.role === "tool" ? node.tool?.name ?? "tool" : roleLabel(node.role);
  const preview =
    node.role === "tool"
      ? node.tool?.files?.join(", ") ?? ""
      : (node.text ?? node.thinking ?? "").replace(/\s+/g, " ").slice(0, 70);

  return (
    <div
      className={`gnode ${active ? "gnode-active" : ""} ${node.isSidechain ? "gnode-side" : ""} ${dimmed ? "gnode-dim" : ""}`}
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="gnode-head">
        <span className="gnode-dot" style={{ background: color }} />
        <span className="gnode-label">{label}</span>
        {node.tokens && (
          <span className="gnode-tok">{node.tokens.input + node.tokens.output}</span>
        )}
      </div>
      {preview && <div className="gnode-preview">{preview}</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

function layout(session: UnifiedSession): {
  nodes: { node: SessionNode; x: number; y: number }[];
  edges: Edge[];
} {
  const childrenOf = new Map<string | null, SessionNode[]>();
  const byId = new Map<string, SessionNode>();
  for (const n of session.nodes) byId.set(n.id, n);
  for (const n of session.nodes) {
    const key = n.parentId && byId.has(n.parentId) ? n.parentId : null;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(n);
  }

  const positioned: { node: SessionNode; x: number; y: number }[] = [];
  let order = 0;
  const visit = (n: SessionNode, depth: number) => {
    positioned.push({ node: n, x: depth * X_GAP, y: order++ * Y_GAP });
    for (const c of childrenOf.get(n.id) ?? []) visit(c, depth + 1);
  };
  for (const root of childrenOf.get(null) ?? []) visit(root, 0);

  const edges: Edge[] = [];
  for (const n of session.nodes) {
    if (n.parentId && byId.has(n.parentId)) {
      edges.push({
        id: `${n.parentId}->${n.id}`,
        source: n.parentId,
        target: n.id,
        type: "smoothstep",
        style: { stroke: "#3a3f4b" },
      });
    }
  }
  return { nodes: positioned, edges };
}

function matches(node: SessionNode, q: string): boolean {
  if (!q) return false;
  const hay = [
    node.text,
    node.thinking,
    node.tool?.name,
    typeof node.tool?.input === "string" ? node.tool.input : JSON.stringify(node.tool?.input ?? ""),
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
  const base = useMemo(() => layout(session), [session]);

  const byId = useMemo(() => {
    const m = new Map<string, SessionNode>();
    for (const n of session.nodes) m.set(n.id, n);
    return m;
  }, [session]);

  const nodes: Node[] = useMemo(() => {
    const searching = search.trim().length > 0;
    return base.nodes
      .filter(({ node }) => !hidden.has(node.role))
      .map(({ node, x, y }) => ({
        id: node.id,
        type: "agent",
        position: { x, y },
        data: {
          node,
          active: node.id === activeId,
          dimmed: searching && !matches(node, search.trim()),
        } satisfies GraphNodeData,
      }));
  }, [base, hidden, activeId, search]);

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
    <div className="graph-wrap">
      <div className="graph-toolbar">
        <input
          className="graph-search"
          placeholder="Highlight nodes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="role-toggles">
          {ALL_ROLES.map((r) => (
            <button
              key={r}
              className={`role-toggle ${hidden.has(r) ? "off" : ""}`}
              style={{ borderColor: roleColor(r) }}
              onClick={() => toggle(r)}
              title={hidden.has(r) ? `Show ${r}` : `Hide ${r}`}
            >
              <span className="gnode-dot" style={{ background: roleColor(r) }} />
              {roleLabel(r)}
            </button>
          ))}
        </div>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => {
          const node = byId.get(n.id);
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
