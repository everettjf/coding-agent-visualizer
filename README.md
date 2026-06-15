# Coding Agent Visualizer

Turns the **local session data** of coding agents into a beautiful, interactive
graph. Today it reads **Claude Code** (`~/.claude/projects`) and **Codex**
(`~/.codex/sessions`); the architecture is built to add **Gemini** and **OpenAI**
by writing a single adapter each.

Not an office/animation gimmick — the focus is making an agent's real execution
(messages, reasoning, tool calls, file edits, tokens) legible and explorable.

## Stack

Bun-native fullstack — a single `Bun.serve` process serves both the React UI
and the local-data API. No external services; your transcripts never leave the
machine.

- **Runtime / bundler / package manager:** Bun
- **UI:** React 19 + [React Flow](https://reactflow.dev/) for the execution graph
- **Data:** source adapters normalize raw JSONL into one `UnifiedSession` model

## Run

```bash
bun install
bun dev            # http://localhost:3000  (--hot reload)
# or: PORT=3700 bun start
```

## Architecture

```
src/
  lib/
    types.ts              # UnifiedSession / SessionNode — the shared model
    adapters/
      claudeCode.ts       # ~/.claude/projects/*.jsonl  (uuid/parentUuid tree)
      codex.ts            # ~/.codex/sessions/**/rollout-*.jsonl
    discovery.ts          # scan local dirs, dispatch to adapters
  server/index.ts         # Bun.serve: serves UI + /api/sessions, /api/session
  frontend/
    App.tsx               # session list + selection
    GraphView.tsx         # React Flow execution graph (indented-tree layout)
    DetailPanel.tsx       # node inspector (message / reasoning / tool I/O)
```

Every visualization consumes the unified model, so a new agent source only
needs a new adapter under `lib/adapters/`.

## Unified model

```ts
UnifiedSession {
  id, source, cwd, gitBranch, startedAt, endedAt,
  messageCount, toolCallCount, totalTokens, model,
  nodes: SessionNode[]      // DAG via parentId; tool calls are child nodes
}
SessionNode {
  id, parentId, role: user|assistant|tool|reasoning|system,
  timestamp, isSidechain,   // isSidechain = Claude Code sub-agent (Task) branch
  text?, thinking?,
  tool?: { name, input, result, isError, files[] },
  tokens?: { input, output, cacheRead, cacheCreation }
}
```

## Status

**Stage 1 + first visualization** — data layer, both adapters, session list, and
the interactive execution graph (pan/zoom, click a node to inspect, sub-agent
and tool branches). Verified end-to-end against real Claude Code transcripts.

### Roadmap

- Timeline + token/duration swimlanes
- File-edit heatmap (which files a session touched, and how often)
- Inline diff rendering for edits
- Live tail (watch files, stream updates into the graph)
- Gemini CLI and OpenAI adapters
