import { useEffect, useMemo, useState } from "react";
import type { SessionSummary, SessionNode, UnifiedSession, Source } from "../lib/types";
import { fmtTokens } from "../lib/stats";
import { GraphView } from "./GraphView";
import { DetailPanel } from "./DetailPanel";
import { StatsView } from "./views/StatsView";
import { TimelineView } from "./views/TimelineView";
import { FilesView } from "./views/FilesView";
import { TranscriptView } from "./views/TranscriptView";
import { SourceBadge } from "./ui";

type ViewKey = "graph" | "timeline" | "files" | "stats" | "transcript";
const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "graph", label: "Graph" },
  { key: "timeline", label: "Timeline" },
  { key: "files", label: "Files" },
  { key: "stats", label: "Stats" },
  { key: "transcript", label: "Transcript" },
];

function fmtTime(ts: string | null): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
}

function projectName(cwd: string): string {
  if (!cwd) return "unknown";
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

export function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<SessionSummary | null>(null);
  const [session, setSession] = useState<UnifiedSession | null>(null);
  const [activeNode, setActiveNode] = useState<SessionNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<Source | "all">("all");
  const [view, setView] = useState<ViewKey>("graph");

  const loadSessions = () => {
    setLoading(true);
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data: SessionSummary[]) => {
        setSessions(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(loadSessions, []);

  useEffect(() => {
    if (!selected) return;
    setSession(null);
    setActiveNode(null);
    fetch(`/api/session?path=${encodeURIComponent(selected.filePath)}`)
      .then((r) => r.json())
      .then((data: UnifiedSession) => setSession(data));
  }, [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (sourceFilter !== "all" && s.source !== sourceFilter) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.cwd.toLowerCase().includes(q) ||
        s.source.includes(q)
      );
    });
  }, [sessions, query, sourceFilter]);

  // Group by project (cwd basename).
  const groups = useMemo(() => {
    const map = new Map<string, SessionSummary[]>();
    for (const s of filtered) {
      const key = projectName(s.cwd);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()];
  }, [filtered]);

  const sourceCounts = useMemo(() => {
    let cc = 0,
      cx = 0;
    for (const s of sessions) s.source === "claude-code" ? cc++ : cx++;
    return { cc, cx };
  }, [sessions]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <h1>
            <span className="logo-dot" /> Agent Visualizer
          </h1>
          <input
            className="search"
            placeholder="Search sessions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="filter-row">
            {(["all", "claude-code", "codex"] as const).map((f) => (
              <button
                key={f}
                className={`chip ${sourceFilter === f ? "chip-on" : ""}`}
                onClick={() => setSourceFilter(f)}
              >
                {f === "all"
                  ? `All (${sessions.length})`
                  : f === "claude-code"
                    ? `Claude (${sourceCounts.cc})`
                    : `Codex (${sourceCounts.cx})`}
              </button>
            ))}
            <button className="chip refresh" onClick={loadSessions} title="Rescan">
              ⟳
            </button>
          </div>
        </div>
        <div className="session-list">
          {loading && <div className="muted pad">Scanning local sessions…</div>}
          {!loading && !filtered.length && (
            <div className="muted pad">No sessions found.</div>
          )}
          {groups.map(([proj, items]) => (
            <div key={proj} className="session-group">
              <div className="group-head">{proj}</div>
              {items.map((s) => (
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
          ))}
        </div>
      </aside>

      <main className="main">
        {!selected && (
          <div className="empty">
            <div className="empty-logo" />
            <h2>Coding Agent Visualizer</h2>
            <p className="muted">
              Reads Claude Code (<code>~/.claude/projects</code>) and Codex
              (<code>~/.codex/sessions</code>) transcripts and turns them into an
              interactive execution graph, timeline, file heatmap and analytics.
            </p>
            <p className="muted small">Select a session on the left to begin.</p>
          </div>
        )}
        {selected && (
          <>
            <header className="main-head">
              <div className="head-row">
                <SourceBadge source={selected.source} />
                <span className="head-title">{selected.title}</span>
              </div>
              <div className="muted small head-sub">
                {selected.model} · {selected.cwd}
                {selected.gitBranch ? ` · ${selected.gitBranch}` : ""} ·{" "}
                {selected.messageCount} msgs · {selected.toolCallCount} tools ·{" "}
                {fmtTokens(selected.totalTokens)} tokens
              </div>
              <nav className="tabs">
                {VIEWS.map((v) => (
                  <button
                    key={v.key}
                    className={`tab ${view === v.key ? "tab-on" : ""}`}
                    onClick={() => setView(v.key)}
                  >
                    {v.label}
                  </button>
                ))}
              </nav>
            </header>
            <div className="view-area">
              {!session ? (
                <div className="muted pad">Loading…</div>
              ) : view === "graph" ? (
                <GraphView
                  session={session}
                  activeId={activeNode?.id ?? null}
                  onSelect={setActiveNode}
                />
              ) : view === "timeline" ? (
                <TimelineView session={session} onSelect={setActiveNode} />
              ) : view === "files" ? (
                <FilesView session={session} />
              ) : view === "stats" ? (
                <StatsView session={session} />
              ) : (
                <TranscriptView session={session} />
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
