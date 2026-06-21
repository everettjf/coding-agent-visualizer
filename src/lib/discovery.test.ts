import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseUploaded, searchEntry } from "./discovery";
import type { UnifiedSession } from "./types";

const fixtures = join(import.meta.dir, "../../fixtures");
const readFixture = (f: string) => readFileSync(join(fixtures, f), "utf8");

function session(over: Partial<UnifiedSession>): UnifiedSession {
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
    nodes: [],
    ...over,
  };
}

describe("searchEntry", () => {
  test("flattens message text, reasoning and tool I/O into one body", () => {
    const e = searchEntry(
      session({
        title: "Fix the parser",
        nodes: [
          { id: "a", parentId: null, role: "user", source: "claude-code", timestamp: null, text: "please refactor discovery" },
          { id: "b", parentId: "a", role: "reasoning", source: "claude-code", timestamp: null, thinking: "consider the cache" },
          { id: "c", parentId: "b", role: "tool", source: "claude-code", timestamp: null, tool: { name: "Edit", input: { path: "discovery.ts" }, result: "patched" } },
        ],
      }),
    );
    expect(e.text).toContain("Fix the parser");
    expect(e.text).toContain("refactor discovery");
    expect(e.text).toContain("consider the cache");
    expect(e.text).toContain("Edit");
    expect(e.text).toContain("discovery.ts");
    expect(e.text).toContain("patched");
  });
});

describe("parseUploaded", () => {
  test("auto-detects the source of a dropped transcript", () => {
    expect(parseUploaded("a.jsonl", readFixture("claude-code-sample.jsonl"))!.source).toBe("claude-code");
    expect(parseUploaded("b.jsonl", readFixture("codex-sample.jsonl"))!.source).toBe("codex");
    expect(parseUploaded("c.json", readFixture("gemini-sample.json"))!.source).toBe("gemini");
  });

  test("stamps an upload: file path so the UI loads it in memory", () => {
    const s = parseUploaded("my session.jsonl", readFixture("claude-code-sample.jsonl"))!;
    expect(s.filePath).toBe("upload:my session.jsonl");
    expect(s.nodes.length).toBeGreaterThan(0);
  });

  test("returns null for content that matches no adapter", () => {
    expect(parseUploaded("x.txt", "this is just prose, not a transcript")).toBeNull();
  });
});
