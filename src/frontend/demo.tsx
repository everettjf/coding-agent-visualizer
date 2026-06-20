// Fully client-side demo: parses a dropped transcript in the browser (no server,
// nothing uploaded) and renders it through the same views as the full app. This
// is what ships to GitHub Pages so anyone can try the tool without installing.

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Tabs } from "radix-ui";
import {
  Network,
  AlignHorizontalDistributeCenter,
  Flame,
  Clock,
  Files as FilesIcon,
  BarChart3,
  MessageSquare,
  Upload,
  type LucideIcon,
} from "lucide-react";
import type { SessionNode, UnifiedSession } from "../lib/types";
import { parseUploadedText } from "../lib/parseUpload";
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

type ViewKey = "graph" | "waterfall" | "flame" | "timeline" | "files" | "stats" | "transcript";
const VIEWS: { key: ViewKey; label: string; icon: LucideIcon }[] = [
  { key: "graph", label: "Graph", icon: Network },
  { key: "waterfall", label: "Waterfall", icon: AlignHorizontalDistributeCenter },
  { key: "flame", label: "Flame", icon: Flame },
  { key: "timeline", label: "Timeline", icon: Clock },
  { key: "files", label: "Files", icon: FilesIcon },
  { key: "stats", label: "Stats", icon: BarChart3 },
  { key: "transcript", label: "Transcript", icon: MessageSquare },
];

function DemoApp() {
  const [session, setSession] = useState<UnifiedSession | null>(null);
  const [activeNode, setActiveNode] = useState<SessionNode | null>(null);
  const [view, setView] = useState<ViewKey>("graph");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setActiveNode(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openFile = async (file: File) => {
    setError(null);
    try {
      const parsed = parseUploadedText(file.name, await file.text());
      if (!parsed) {
        setError("Could not parse this file as a Claude Code, Codex or Gemini transcript.");
        return;
      }
      setActiveNode(null);
      setView("graph");
      setSession(parsed);
    } catch {
      setError("Could not read that file.");
    }
  };

  if (!session) {
    return (
      <div className="app-demo">
        <div
          className={`empty ${dragging ? "empty-drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void openFile(f);
          }}
        >
          <div className="empty-logo" />
          <h2>Coding Agent Visualizer — online demo</h2>
          <p className="muted">
            Drop a <strong>Claude Code</strong>, <strong>Codex</strong> or{" "}
            <strong>Gemini</strong> transcript here (or pick one) to see it as an
            execution graph, span waterfall, token-cost flame, timeline, file
            heatmap and stats. Everything runs in your browser — nothing is uploaded.
          </p>
          <label className="analytics-btn" style={{ maxWidth: 220, margin: "0 auto" }}>
            <Upload size={14} />
            Open a transcript file…
            <input
              type="file"
              accept=".jsonl,.json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void openFile(f);
                e.target.value = "";
              }}
            />
          </label>
          {error && <p className="upload-error small">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-demo">
      <main className="main">
        <header className="main-head">
          <div className="head-row">
            <SourceBadge source={session.source} />
            <span className="head-title">{session.title}</span>
            <button className="live-toggle" onClick={() => setSession(null)} title="Open another file">
              Open another
            </button>
          </div>
          <div className="muted small head-sub">
            {session.model ? `${session.model} · ` : ""}
            {session.messageCount} msgs · {session.toolCallCount} tools ·{" "}
            {fmtTokens(session.totalTokens)} tokens
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
          {view === "graph" ? (
            <GraphView session={session} activeId={activeNode?.id ?? null} onSelect={setActiveNode} />
          ) : view === "waterfall" ? (
            <WaterfallView session={session} activeId={activeNode?.id ?? null} onSelect={setActiveNode} />
          ) : view === "flame" ? (
            <FlameView session={session} activeId={activeNode?.id ?? null} onSelect={setActiveNode} />
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
      </main>
      {activeNode && (
        <DetailPanel node={activeNode} onClose={() => setActiveNode(null)} width={420} onResizeStart={() => {}} />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<DemoApp />);
