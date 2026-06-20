// Browser-safe parsing of an uploaded/dropped transcript whose source is
// unknown. Imports only the pure file-based adapters (no node:fs), so it runs
// both on the server (discovery) and entirely client-side in the static demo.
//
// Tries every file-based adapter and keeps whichever produced the richest
// session. Gemini and Qwen share a format, so a Gemini-shaped upload is labeled
// "gemini" — the source can't be told apart from content alone.

import { parseClaudeCodeSession } from "./adapters/claudeCode";
import { parseCodexSession } from "./adapters/codex";
import { parseGeminiSession } from "./adapters/gemini";
import type { UnifiedSession } from "./types";

const PARSERS: ((raw: string, filePath: string) => UnifiedSession | null)[] = [
  parseClaudeCodeSession,
  parseCodexSession,
  parseGeminiSession,
];

export function parseUploadedText(name: string, raw: string): UnifiedSession | null {
  const filePath = `upload:${name}`;
  let best: UnifiedSession | null = null;
  for (const parse of PARSERS) {
    let candidate: UnifiedSession | null = null;
    try {
      candidate = parse(raw, filePath);
    } catch {
      candidate = null;
    }
    if (candidate?.nodes.length && (!best || candidate.nodes.length > best.nodes.length)) {
      best = candidate;
    }
  }
  if (best) best.filePath = filePath;
  return best;
}
