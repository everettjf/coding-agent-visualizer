import { useEffect, useMemo, useState } from "react";
import { Tabs } from "radix-ui";
import {
  Network,
  AlignHorizontalDistributeCenter,
  Flame,
  Clock,
  Files as FilesIcon,
  BarChart3,
  MessageSquare,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import type { SessionSummary, SessionNode, UnifiedSession, Source } from "../lib/types";
import { fmtTokens } from "../lib/stats";
import { GraphView } from "./GraphView";
import { DetailPanel } from "./DetailPanel";
import { StatsView } from "./views/StatsView";
import { TimelineView } from "./views/TimelineView";
import { FilesView } from "./views/FilesView";
import { TranscriptView } from "./views/TranscriptView";
import { WaterfallView } from "./views/WaterfallView";
import { FlameView } from "./views/FlameView";
import { SourceBadge } from "./ui";

type ViewKey =
  | "graph"
  | "waterfall"
  | "flame"
  | "timeline"
  | "files"
  | "stats"
  | "transcript";
const VIEWS: { key: ViewKey; label: string; icon: LucideIcon }[] = [
  { key: "graph", label: "Graph", icon: Network },
  { key: "waterfall", label: "Waterfall", icon: AlignHorizontalDistributeCenter },
  { key: "flame", label: "Flame", icon: Flame },
  { key: "timeline", label: "Timeline", icon: Clock },
  { key: "files", label: "Files", icon: FilesIcon },
  { key: "stats", label: "Stats", icon: BarChart3 },
  { key: "transcript", label: "Transcript", icon: MessageSquare },
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
  const [live, setLive] = useState(true);

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

  // Esc closes the node detail panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveNode(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!selected) return;
    setSession(null);
    setActiveNode(null);
    const path = encodeURIComponent(selected.filePath);

    if (!live) {
      let cancelled = false;
      fetch(`/api/session?path=${path}`)
        .then((r) => r.json())
        .then((data: UnifiedSession) => !cancelled && setSession(data));
      return () => {
        cancelled = true;
      };
    }

    // Live tail: stream session updates as the file changes on disk.
    const es = new EventSource(`/api/watch?path=${path}`);
    es.onmessage = (e) => setSession(JSON.parse(e.data));
    return () => es.close();
  }, [selected, live]);

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
          {loading && (
            <div className="scanning">
              <div className="scanning-head">
                <span className="spinner" />
                <span className="muted small">Scanning local sessions…</span>
              </div>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton-item">
                  <div className="sk sk-line" style={{ width: "40%" }} />
                  <div className="sk sk-line" style={{ width: "85%" }} />
                  <div className="sk sk-line" style={{ width: "55%" }} />
                </div>
              ))}
            </div>
          )}
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
                <button
                  className={`live-toggle ${live ? "live-on" : ""}`}
                  onClick={() => setLive((v) => !v)}
                  title={live ? "Live tail on — click to pause" : "Live tail off"}
                >
                  <span className="live-dot" />
                  {live ? "LIVE" : "PAUSED"}
                </button>
              </div>
              <div className="muted small head-sub">
                {selected.model} · {selected.cwd}
                {selected.gitBranch ? ` · ${selected.gitBranch}` : ""} ·{" "}
                {selected.messageCount} msgs · {selected.toolCallCount} tools ·{" "}
                {fmtTokens(selected.totalTokens)} tokens
              </div>
              <Tabs.Root value={view} onValueChange={(v) => setView(v as ViewKey)}>
                <Tabs.List className="-mb-px flex flex-wrap gap-1" aria-label="Views">
                  {VIEWS.map((v) => {
                    const Icon = v.icon;
                    return (
                      <Tabs.Trigger
                        key={v.key}
                        value={v.key}
                        className="inline-flex items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm text-muted transition-colors hover:text-text data-[state=active]:border-accent data-[state=active]:text-text"
                      >
                        <Icon size={14} />
                        {v.label}
                      </Tabs.Trigger>
                    );
                  })}
                </Tabs.List>
              </Tabs.Root>
            </header>
            <div className="view-area">
              {!session ? (
                <div className="loading-center">
                  <span className="spinner spinner-lg" />
                  <span className="muted small">Building visualization…</span>
                </div>
              ) : view === "graph" ? (
                <GraphView
                  session={session}
                  activeId={activeNode?.id ?? null}
                  onSelect={setActiveNode}
                />
              ) : view === "waterfall" ? (
                <WaterfallView
                  session={session}
                  activeId={activeNode?.id ?? null}
                  onSelect={setActiveNode}
                />
              ) : view === "flame" ? (
                <FlameView
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
