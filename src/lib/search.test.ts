import { describe, expect, test } from "bun:test";
import { buildIndex, tokenize, type SearchDoc } from "./search";
import type { SessionSummary } from "./types";

function summary(over: Partial<SessionSummary>): SessionSummary {
  return {
    id: "s",
    source: "claude-code",
    cwd: "/proj",
    title: "untitled",
    startedAt: null,
    endedAt: null,
    messageCount: 0,
    toolCallCount: 0,
    totalTokens: 0,
    filePath: "f",
    ...over,
  };
}

const docs: SearchDoc[] = [
  { summary: summary({ filePath: "a", endedAt: "2026-01-01" }), text: "the quick brown fox" },
  { summary: summary({ filePath: "b", endedAt: "2026-01-02" }), text: "quick fox jumps over the quick fox" },
  { summary: summary({ filePath: "c", endedAt: "2026-01-03" }), text: "refactor the discovery cache module" },
];
const index = buildIndex(docs);

describe("tokenize", () => {
  test("lowercases, splits on non-word chars, drops 1-char tokens", () => {
    expect(tokenize("Edit discovery.ts a b2")).toEqual(["edit", "discovery", "ts", "b2"]);
  });
});

describe("buildIndex / search", () => {
  test("requires every term (AND) and is case-insensitive", () => {
    const hits = index.search("QUICK fox");
    expect(hits.map((h) => h.summary.filePath).sort()).toEqual(["a", "b"]);
  });

  test("ranks by summed term frequency, then recency", () => {
    // 'quick' + 'fox' appear 2x each in b vs 1x each in a → b first
    expect(index.search("quick fox")[0].summary.filePath).toBe("b");
  });

  test("matches tokens by prefix (discover → discovery)", () => {
    const hits = index.search("discover");
    expect(hits.map((h) => h.summary.filePath)).toEqual(["c"]);
  });

  test("returns a snippet around the first matched term", () => {
    expect(index.search("brown")[0].snippet).toContain("brown");
  });

  test("empty / whitespace / unmatched queries yield nothing", () => {
    expect(index.search("   ")).toEqual([]);
    expect(index.search("nonexistentword")).toEqual([]);
  });

  test("honors the result limit", () => {
    expect(index.search("the", 1).length).toBe(1);
  });
});
