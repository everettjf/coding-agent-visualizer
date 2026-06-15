import { useEffect, useMemo, useState } from "react";
import type { SessionSummary, SessionNode, UnifiedSession } from "../lib/types";
import { GraphView } from "./GraphView";
import { DetailPanel } from "./DetailPanel";
import { SourceBadge } from "./ui";

function fmtTime(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString();
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<SessionSummary | null>(null);
  const [session, setSession] = useState<UnifiedSession | null>(null);
  const [activeNode, setActiveNode] = useState<SessionNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data: SessionSummary[]) => {
        setSessions(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setSession(null);
    setActiveNode(null);
    fetch(`/api/session?path=${encodeURIComponent(selected.filePath)}`)
      .then((r) => r.json())
      .then((data: UnifiedSession) => setSession(data));
  }, [selected]);

  const filtered = useMemo(() => {
    if (!query.trim()) return sessions;
    const q = query.toLowerCase();
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.cwd.toLowerCase().includes(q) ||
        s.source.includes(q),
    );
  }, [sessions, query]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <h1>Agent Visualizer</h1>
          <input
            className="search"
            placeholder="Search sessions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="session-list">
          {loading && <div className="muted pad">Scanning local sessions…</div>}
          {!loading && !filtered.length && (
            <div className="muted pad">No sessions found.</div>
          )}
          {filtered.map((s) => (
            <button
              key={s.filePath}
              className={`session-item ${selected?.filePath === s.filePath ? "active" : ""}`}
              onClick={() => setSelected(s)}
            >
              <div className="session-item-top">
                <SourceBadge source={s.source} />
                <span className="muted small">{fmtTime(s.endedAt)}</span>
              </div>
              <div className="session-title">{s.title}</div>
              <div className="session-meta muted small">
                <span>{s.messageCount} msgs</span>
                <span>{s.toolCallCount} tools</span>
                <span>{fmtTokens(s.totalTokens)} tok</span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        {!selected && (
          <div className="empty">
            <h2>Select a session</h2>
            <p className="muted">
              Reads Claude Code (<code>~/.claude/projects</code>) and Codex
              (<code>~/.codex/sessions</code>) transcripts and visualizes them
              as an interactive execution graph.
            </p>
          </div>
        )}
        {selected && (
          <>
            <header className="main-head">
              <div>
                <SourceBadge source={selected.source} />
                <span className="head-title">{selected.title}</span>
              </div>
              <div className="muted small">
                {selected.model} · {selected.cwd}
                {selected.gitBranch ? ` · ${selected.gitBranch}` : ""}
              </div>
            </header>
            <div className="graph-area">
              {session ? (
                <GraphView
                  session={session}
                  activeId={activeNode?.id ?? null}
                  onSelect={setActiveNode}
                />
              ) : (
                <div className="muted pad">Loading graph…</div>
              )}
            </div>
          </>
        )}
      </main>

      {activeNode && (
        <DetailPanel node={activeNode} onClose={() => setActiveNode(null)} />
      )}
    </div>
  );
}
