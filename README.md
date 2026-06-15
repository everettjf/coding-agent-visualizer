<div align="center">

![Coding Agent Visualizer](assets/banner.svg)

# Coding Agent Visualizer

**Turn the local session files of your coding agents into a beautiful, interactive map.**

[![Bun](https://img.shields.io/badge/runtime-Bun-fbf0df?logo=bun&logoColor=black)](https://bun.sh)
[![React](https://img.shields.io/badge/UI-React%2019-61dafb?logo=react&logoColor=black)](https://react.dev)
[![React Flow](https://img.shields.io/badge/graph-React%20Flow-ff0072)](https://reactflow.dev)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-a78bfa.svg)](CONTRIBUTING.md)

[**Live demo / landing page →**](https://everettjf.github.io/coding-agent-visualizer/)

</div>

---

Coding agents like **Claude Code** and **OpenAI Codex** quietly record every
session to disk as JSONL — messages, reasoning, tool calls, file edits and token
usage. That data is a goldmine, but it lives in raw log files no one reads.

**Coding Agent Visualizer** reads those local files and renders them as an
interactive **execution graph**, **timeline**, **file heatmap** and **analytics
dashboard** — so you can actually *see* what your agent did, how it branched into
sub-agents, which files it hammered, and where the tokens went.

No office mascots, no 3D robots. Just a fast, good-looking, *useful* lens on
real agent runs. Everything runs locally — your transcripts never leave your
machine.

## ✨ Features

| | |
|---|---|
| 🕸️ **Execution graph** | Conversation rebuilt as a DAG (via `parentUuid`). Tool calls become child nodes; Claude Code sub-agents (`Task`) render as dashed branches. Pan, zoom, click to inspect. |
| ⏱️ **Timeline** | Every event placed on a time track with role colors and previews — see the rhythm and gaps of a session. |
| 🔥 **File heatmap** | Which files the session touched and how often, colored cool→hot by edit frequency. |
| 📊 **Stats dashboard** | Duration, message/tool counts, input/output/cache tokens, a cumulative-token sparkline and per-tool usage bars. |
| 💬 **Transcript** | A clean, readable conversation view with collapsible tool blocks. |
| 🔍 **Graph search & filters** | Highlight matching nodes; toggle roles (hide reasoning/tools) to declutter. |
| 🧩 **Diff & inspect** | Click any node for full message / reasoning / tool I/O, with colored diffs for `Edit`/`Write` and one-click copy. |
| 🗂️ **Multi-source** | Claude Code and Codex today; pluggable adapters for **Gemini** and **OpenAI** next. |
| 🔴 **Live tail** | Toggle **LIVE** to stream a session into the graph as the agent writes to disk — watch it think in real time. |

## 🚀 Quick start

Requires [Bun](https://bun.sh) (≥ 1.2).

```bash
git clone https://github.com/everettjf/coding-agent-visualizer.git
cd coding-agent-visualizer
bun install
bun dev          # → http://localhost:3000
```

The app auto-discovers sessions from:

- **Claude Code** — `~/.claude/projects/<encoded-cwd>/*.jsonl`
- **Codex** — `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`

Pick a session from the sidebar and explore. Nothing is uploaded anywhere.

## 🧱 Architecture

A single **Bun fullstack server** (`Bun.serve`) serves both the React UI and a
tiny local-data API — no separate backend, no database, no telemetry.

```
src/
├─ lib/
│  ├─ types.ts            # UnifiedSession / SessionNode — the shared model
│  ├─ stats.ts            # computeStats(): tools, files, tokens, timeline
│  ├─ discovery.ts        # scan ~/.claude & ~/.codex, dispatch to adapters
│  └─ adapters/
│     ├─ claudeCode.ts    # uuid/parentUuid tree → nodes; tool calls; tokens
│     └─ codex.ts         # rollout response_items → nodes
├─ server/index.ts        # Bun.serve: UI + /api/sessions, /api/session
└─ frontend/
   ├─ App.tsx             # sidebar, tabs, panel orchestration
   ├─ GraphView.tsx       # React Flow execution graph
   ├─ DetailPanel.tsx     # node inspector (message / reasoning / tool / diff)
   ├─ charts.tsx          # dependency-free SVG charts
   └─ views/              # Timeline / Files / Stats / Transcript
```

### The unified model

Every adapter normalizes its raw format into one shape, so all views are
source-agnostic and a new agent only needs a new adapter:

```ts
UnifiedSession {
  id, source, cwd, gitBranch, startedAt, endedAt,
  messageCount, toolCallCount, totalTokens, model,
  nodes: SessionNode[]          // DAG via parentId; tool calls are children
}

SessionNode {
  id, parentId, role: user | assistant | tool | reasoning | system,
  timestamp, isSidechain,       // isSidechain = Claude Code sub-agent branch
  text?, thinking?,
  tool?:   { name, input, result, isError, files[] },
  tokens?: { input, output, cacheRead, cacheCreation }
}
```

## 🔌 Adding a new source

1. Create `src/lib/adapters/<name>.ts` exporting a parser that returns a
   `UnifiedSession` (see `claudeCode.ts` as the reference).
2. Register its directory + dispatch in `src/lib/discovery.ts`.
3. That's it — every view works automatically.

## 🗺️ Roadmap

- [x] Live tail — watch files and stream updates into the graph
- [ ] Gemini CLI and OpenAI adapters
- [ ] Cross-session analytics (cost over time, tool trends)
- [ ] Inline syntax-highlighted diffs
- [ ] Export a session as Markdown / shareable HTML
- [ ] Collapse/expand sub-agent subtrees in the graph

See [CONTRIBUTING.md](CONTRIBUTING.md) to help build these.

## 🛠️ Scripts

| Command | Description |
|---|---|
| `bun dev` | Dev server with hot reload |
| `bun start` | Production server |
| `bun run typecheck` | TypeScript check (`tsc --noEmit`) |

## 🔒 Privacy

Everything is read from your local disk and rendered in your local browser.
There is no backend service, no account, and no network egress.

## 📄 License

[MIT](LICENSE) © everettjf
