import { useMemo } from "react";
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

const X_GAP = 230; // horizontal indent per depth level
const Y_GAP = 88; // vertical spacing per node in traversal order

interface GraphNodeData extends Record<string, unknown> {
  node: SessionNode;
  active: boolean;
}

function AgentNode({ data }: NodeProps) {
  const { node, active } = data as GraphNodeData;
  const color = roleColor(node.role);
  const label =
    node.role === "tool"
      ? node.tool?.name ?? "tool"
      : roleLabel(node.role);
  const preview =
    node.role === "tool"
      ? (node.tool?.files?.join(", ") ?? "")
      : (node.text ?? node.thinking ?? "").replace(/\s+/g, " ").slice(0, 70);

  return (
    <div
      className={`gnode ${active ? "gnode-active" : ""} ${node.isSidechain ? "gnode-side" : ""}`}
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="gnode-head">
        <span className="gnode-dot" style={{ background: color }} />
        <span className="gnode-label">{label}</span>
        {node.tokens && (
          <span className="gnode-tok">
            {node.tokens.input + node.tokens.output}
          </span>
        )}
      </div>
      {preview && <div className="gnode-preview">{preview}</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

// Indented-tree layout: in-order DFS gives each node an increasing Y,
// while depth (distance from a root) drives X. Reads as an outline graph:
// the main conversation runs down the left, tool/sub-agent branches step right.
function layout(session: UnifiedSession): { nodes: Node[]; edges: Edge[] } {
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

  const nodes: Node[] = positioned.map(({ node, x, y }) => ({
    id: node.id,
    type: "agent",
    position: { x, y },
    data: { node, active: false } satisfies GraphNodeData,
  }));

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
  return { nodes, edges };
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
  const base = useMemo(() => layout(session), [session]);

  const nodes = useMemo(
    () =>
      base.nodes.map((n) => ({
        ...n,
        data: { ...(n.data as GraphNodeData), active: n.id === activeId },
      })),
    [base, activeId],
  );

  const byId = useMemo(() => {
    const m = new Map<string, SessionNode>();
    for (const n of session.nodes) m.set(n.id, n);
    return m;
  }, [session]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={base.edges}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.15}
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
        nodeColor={(n) =>
          roleColor((((n.data as GraphNodeData).node.role) as NodeRole) ?? "user")
        }
        maskColor="rgba(13,15,20,0.7)"
      />
    </ReactFlow>
  );
}
