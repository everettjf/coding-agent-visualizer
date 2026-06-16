// Model pricing → real dollar cost. Token counts are the universal currency of
// agent runs, but what people actually want to know is "how much did this cost?".
// This module maps a model name to a published price and turns a token breakdown
// into USD. Prices are USD per 1,000,000 tokens and are necessarily approximate
// — providers change them and tier them by context length — so they're kept in
// one obvious table that's easy to audit and update.

export interface ModelPrice {
  /** USD per 1M input (prompt) tokens. */
  input: number;
  /** USD per 1M output (completion) tokens. */
  output: number;
  /** USD per 1M tokens read from the prompt cache (much cheaper than input). */
  cacheRead: number;
  /** USD per 1M tokens written to the prompt cache (Anthropic charges a premium). */
  cacheWrite: number;
}

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

// Matched top-to-bottom by case-insensitive substring on the model id, so more
// specific patterns must come before their generic fallbacks. A model that
// matches nothing is treated as unpriced (cost 0 / "unknown").
const PRICES: [pattern: string, price: ModelPrice][] = [
  // Anthropic — Claude
  ["opus", { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
  ["sonnet", { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ["haiku", { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }],

  // OpenAI — GPT / Codex (no separate cache-write charge; cached input is discounted)
  ["gpt-5-codex", { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 }],
  ["gpt-5", { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 }],
  ["codex", { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 }],
  ["o3", { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 }],
  ["gpt-4o", { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 }],
  ["gpt-4", { input: 10, output: 30, cacheRead: 5, cacheWrite: 10 }],

  // Google — Gemini
  ["gemini-2.5-pro", { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 1.25 }],
  ["gemini-2.5-flash", { input: 0.3, output: 2.5, cacheRead: 0.075, cacheWrite: 0.3 }],
  ["gemini-1.5-pro", { input: 1.25, output: 5, cacheRead: 0.31, cacheWrite: 1.25 }],
  ["gemini-1.5-flash", { input: 0.075, output: 0.3, cacheRead: 0.019, cacheWrite: 0.075 }],
  ["gemini", { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 1.25 }],
];

/** Look up a published price for a model id, or null when it isn't recognized. */
export function modelPrice(model?: string): ModelPrice | null {
  if (!model) return null;
  const m = model.toLowerCase();
  for (const [pattern, price] of PRICES) {
    if (m.includes(pattern)) return price;
  }
  return null;
}

/** Estimate the USD cost of a token breakdown under a given model's pricing. */
export function estimateCostUsd(tokens: TokenCounts, model?: string): number {
  const p = modelPrice(model);
  if (!p) return 0;
  return (
    (tokens.input * p.input +
      tokens.output * p.output +
      tokens.cacheRead * p.cacheRead +
      tokens.cacheCreation * p.cacheWrite) /
    1_000_000
  );
}

/** Format a USD amount with cent / sub-cent precision suited to agent runs. */
export function fmtCost(usd: number): string {
  if (usd <= 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
