#!/usr/bin/env bun
// Launcher so the tool can be run with no clone:  bunx coding-agent-visualizer
// (or the short alias `cav`). It just boots the Bun fullstack server, which
// serves the UI and the local-data API from this one process.
//
// Bun's HTML bundling needs the Tailwind plugin wired in bunfig.toml, which Bun
// reads from the package root — so resolve our own directory and run from there.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(dirname(dirname(fileURLToPath(import.meta.url))));
await import(join(process.cwd(), "src", "server", "index.ts"));
