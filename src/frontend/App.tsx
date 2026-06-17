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
  Download,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { SessionSummary, SessionNode, UnifiedSession, Source } from "../lib/types";
import { fmtTokens } from "../lib/stats";
import { toMarkdown, toHTML, download, slugify } from "./lib/export";
import { GraphView } from "./GraphView";
import { DetailPanel } from "./DetailPanel";
import { StatsView } from "./views/StatsView";
import { TimelineView } from "./views/TimelineView";
import { FilesView } from "./views/FilesView";
import { TranscriptView } from "./views/TranscriptView";
import { WaterfallView } from "./views/WaterfallView";
import { FlameView } from "./views/FlameView";
import { AnalyticsView } from "./views/AnalyticsView";
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

// Export the loaded session to Markdown or a self-contained HTML file.
function ExportMenu({ session }: { session: UnifiedSession }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  const doExport = (kind: "md" | "html") => {
    const base = slugify(session.title);
    if (kind === "md") download(`${base}.md`, toMarkdown(session), "text/markdown");
    else download(`${base}.html`, toHTML(session), "text/html");
    setOpen(false);
  };

  return (
    <div className="relative ml-2" onClick={(e) => e.stopPropagation()}>
      <button
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-panel-2 px-3 py-1 text-[11px] font-semibold text-muted hover:border-accent hover:text-text"
        onClick={() => setOpen((o) => !o)}
        title="Export this session"
      >
        <Download size={13} />
        Export
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-panel-2 text-sm shadow-xl">
          <button
            className="block w-full px-3 py-2 text-left hover:bg-white/5"
            onClick={() => doExport("md")}
          >
            Markdown <span className="text-muted">(.md)</span>
          </button>
          <button
            className="block w-full border-t border-border px-3 py-2 text-left hover:bg-white/5"
            onClick={() => doExport("html")}
          >
            Shareable HTML <span className="text-muted">(.html)</span>
          </button>
        </div>
      )}
    </div>
  );
}

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
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("sidebarWidth"));
    return saved >= 200 && saved <= 600 ? saved : 300;
  });
  const [detailWidth, setDetailWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("detailWidth"));
    return saved >= 320 && saved <= 900 ? saved : 420;
  });

  // Drag a divider to resize a panel. `edge` decides which window edge the
  // width is measured from: "left" for the sidebar, "right" for the detail panel.
  const makeResizer =
    (edge: "left" | "right", min: number, max: number, set: (w: number) => void) =>
    (e: React.MouseEvent) => {
      e.preventDefault();
      const onMove = (ev: MouseEvent) => {
        const raw = edge === "left" ? ev.clientX : window.innerWidth - ev.clientX;
        set(Math.min(max, Math.max(min, raw)));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

  const startResize = makeResizer("left", 200, 600, setSidebarWidth);
  const startDetailResize = makeResizer("right", 320, 900, setDetailWidth);

  useEffect(() => {
    localStorage.setItem("sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);
  useEffect(() => {
    localStorage.setItem("detailWidth", String(detailWidth));
  }, [detailWidth]);

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
    const c: Record<Source, number> = {
      "claude-code": 0,
      codex: 0,
      gemini: 0,
      opencode: 0,
      cursor: 0,
    };
    for (const s of sessions) c[s.source]++;
    return c;
  }, [sessions]);

  const SOURCE_CHIPS: { source: Source; label: string }[] = [
    { source: "claude-code", label: "Claude" },
    { source: "codex", label: "Codex" },
    { source: "gemini", label: "Gemini" },
    { source: "opencode", label: "OpenCode" },
    { source: "cursor", label: "Cursor" },
  ];

  return (
    <div
      className="app"
      style={{ gridTemplateColumns: `${sidebarWidth}px 1fr` }}
    >
      <aside className="sidebar">
        <div className="sidebar-head">
          <h1>
            <span className="logo-dot" /> Coding Agent Visualizer
          </h1>
          <input
            className="search"
            placeholder="Search sessions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="filter-row">
            <button
              className={`chip ${sourceFilter === "all" ? "chip-on" : ""}`}
              onClick={() => setSourceFilter("all")}
            >
              All ({sessions.length})
            </button>
            {SOURCE_CHIPS.filter((c) => sourceCounts[c.source] > 0).map((c) => (
              <button
                key={c.source}
                className={`chip ${sourceFilter === c.source ? "chip-on" : ""}`}
                onClick={() => setSourceFilter(c.source)}
              >
                {c.label} ({sourceCounts[c.source]})
              </button>
            ))}
            <button className="chip refresh" onClick={loadSessions} title="Rescan">
              ⟳
            </button>
          </div>
          <button
            className={`analytics-btn ${showAnalytics ? "analytics-on" : ""}`}
            onClick={() => setShowAnalytics(true)}
            title="Cross-session analytics"
          >
            <TrendingUp size={14} />
            Cross-session analytics
          </button>
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
                  className={`session-item ${selected?.filePath === s.filePath && !showAnalytics ? "active" : ""}`}
                  onClick={() => {
                    setSelected(s);
                    setShowAnalytics(false);
                  }}
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

      <div
        className="resizer"
        style={{ left: `${sidebarWidth}px` }}
        onMouseDown={startResize}
        title="Drag to resize sidebar"
      />

      <main className="main">
        {showAnalytics && (
          <>
            <header className="main-head">
              <div className="head-row">
                <span className="head-title">Cross-session analytics</span>
                <button
                  className="live-toggle"
                  onClick={() => setShowAnalytics(false)}
                  title="Back to session view"
                >
                  Close
                </button>
              </div>
              <div className="muted small head-sub">
                Aggregated across all discovered sessions — nothing leaves your machine.
              </div>
            </header>
            <div className="view-area">
              <AnalyticsView />
            </div>
          </>
        )}
        {!showAnalytics && !selected && (
          <div className="empty">
            <div className="empty-logo" />
            <h2>Coding Agent Visualizer</h2>
            <p className="muted">
              Reads Claude Code (<code>~/.claude/projects</code>), Codex
              (<code>~/.codex/sessions</code>) and Gemini
              (<code>~/.gemini/tmp</code>) transcripts and turns them into an
              interactive execution graph, timeline, file heatmap and analytics.
            </p>
            <p className="muted small">Select a session on the left to begin.</p>
          </div>
        )}
        {!showAnalytics && selected && (
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
                {session && <ExportMenu session={session} />}
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
        <DetailPanel
          node={activeNode}
          onClose={() => setActiveNode(null)}
          width={detailWidth}
          onResizeStart={startDetailResize}
        />
      )}
    </div>
  );
}
