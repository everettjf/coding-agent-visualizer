#!/usr/bin/env bun
// Entry point for `bunx coding-agent-visualizer` (alias: `bunx cav`).
//
// Bun loads bunfig.toml (which registers the Tailwind plugin) and resolves the
// HTML bundle relative to the *launch* cwd — which, under bunx, is wherever the
// user happened to run the command. So we re-launch the server with cwd pinned
// to the package root; otherwise styling and asset paths break. Discovery only
// reads absolute paths under $HOME, so the cwd change is otherwise harmless.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";

const pkgRoot = dirname(import.meta.dir); // <pkg>/src -> <pkg>
const entry = join(pkgRoot, "src", "server", "index.ts");

const child = spawn(process.execPath, [entry], {
  cwd: pkgRoot,
  stdio: "inherit",
  env: { NODE_ENV: "production", ...process.env },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
