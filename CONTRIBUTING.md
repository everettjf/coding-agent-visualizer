# Contributing

Thanks for your interest in **Coding Agent Visualizer**! This project aims to be
the nicest way to *see* what a coding agent actually did. Contributions of all
sizes are welcome.

## Getting set up

Requires [Bun](https://bun.sh) ≥ 1.2.

```bash
bun install
bun dev            # http://localhost:3000
bun run typecheck  # keep this green before pushing
```

## Project layout

- `src/lib/` — source-agnostic core: the unified model (`types.ts`), analytics
  (`stats.ts`), discovery and the per-agent **adapters**.
- `src/server/` — the Bun fullstack server (UI + local-data API).
- `src/frontend/` — React UI: `App.tsx`, the graph, the detail panel, and the
  `views/` (timeline, files, stats, transcript).

## Adding support for a new agent

This is the highest-value contribution. To add e.g. Gemini CLI:

1. Add `src/lib/adapters/gemini.ts` exporting a function that takes the raw file
   contents and returns a `UnifiedSession`. Use `adapters/claudeCode.ts` as a
   reference — the key is mapping the agent's native log into `SessionNode`s with
   correct `parentId` relationships so the graph renders well.
2. Register its on-disk location and dispatch in `src/lib/discovery.ts`.
3. Run `bun dev` and confirm every view works with no adapter-specific code.

If you can include a small, **sanitized** sample log under `fixtures/`, even
better — it makes the adapter testable.

## Guidelines

- Keep the **unified model** the single source of truth — views should never read
  raw agent formats directly.
- Prefer dependency-free solutions for visuals (the charts are hand-rolled SVG).
- Keep `bun run typecheck` passing; the project is fully typed and `strict`.
- Match the existing code style — small, focused modules and clear names.
- One logical change per pull request, with a clear description.

## Reporting issues

Include the agent (Claude Code / Codex / …), what you expected, what you saw, and
— if you can share it — a **redacted** snippet of the session file. Never paste
secrets or tokens.
