import { useMemo } from "react";
import { hierarchy, partition } from "d3-hierarchy";
import type { SessionNode, UnifiedSession } from "../../lib/types";
import { buildHierarchy, fmtTokens, type HierNode } from "../../lib/stats";
import { roleColor, roleLabel } from "../ui";

const ROW_H = 30;

// Token-cost icicle (top-down flame graph): width ∝ tokens, vertical stacking =
// call depth. Makes "where did the tokens go" — and any token-heavy sub-agent
// branch — pop out immediately. Driven by the same hierarchy as the graph.
export function FlameView({
  session,
  activeId,
  onSelect,
}: {
  session: UnifiedSession;
  activeId: string | null;
  onSelect: (n: SessionNode) => void;
}) {
  const { rects, depth, total } = useMemo(() => {
    const data = buildHierarchy(session);
    const root = hierarchy<HierNode>(data, (d) => d.children).sum((d) => d.self);
    if (!root.value) return { rects: [], depth: 0, total: 0 };
    partition<HierNode>().size([1, root.height + 1]).padding(0)(root);

    const rects = root
      .descendants()
      .filter((d) => d.depth >= 1 && (d.value ?? 0) > 0 && d.data.node)
      .map((d) => ({
        node: d.data.node as SessionNode,
        x0: (d as any).x0 as number,
        x1: (d as any).x1 as number,
        depth: d.depth,
        value: d.value ?? 0,
      }));
    return { rects, depth: root.height, total: root.value };
  }, [session]);

  if (!rects.length) {
    return (
      <div className="p-6 text-muted">No token usage recorded for this session.</div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold">Token-cost flame</h3>
        <p className="text-xs text-muted">
          {fmtTokens(total)} tokens · width ∝ tokens · depth = call nesting ·
          click a block to inspect
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="relative w-full" style={{ height: depth * ROW_H }}>
          {rects.map((r) => {
            const color = roleColor(r.node.role);
            const widthPct = (r.x1 - r.x0) * 100;
            const label =
              r.node.role === "tool"
                ? r.node.tool?.name ?? "tool"
                : roleLabel(r.node.role);
            const active = r.node.id === activeId;
            return (
              <button
                key={r.node.id}
                onClick={() => onSelect(r.node)}
                title={`${label} · ${fmtTokens(r.value)} tokens`}
                className={`absolute overflow-hidden rounded-sm border border-bg/60 px-1.5 text-left text-[11px] leading-[26px] transition-[filter] hover:brightness-125 ${
                  active ? "ring-1 ring-white" : ""
                }`}
                style={{
                  left: `${r.x0 * 100}%`,
                  width: `${widthPct}%`,
                  top: (r.depth - 1) * ROW_H,
                  height: ROW_H - 3,
                  background: color,
                  color: "#0d0f14",
                }}
              >
                {widthPct > 4 && (
                  <span className="truncate font-medium">
                    {label}
                    {widthPct > 12 && (
                      <span className="opacity-70"> · {fmtTokens(r.value)}</span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
