import { describe, expect, test } from "bun:test";
import { toMarkdown, toHTML, slugify } from "./export";
import type { UnifiedSession } from "../../lib/types";

const session: UnifiedSession = {
  id: "s1",
  source: "claude-code",
  cwd: "/home/user/demo",
  gitBranch: "main",
  title: "Add a hello function",
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: "2026-01-01T00:05:00.000Z",
  messageCount: 2,
  toolCallCount: 1,
  totalTokens: 1200,
  model: "claude-opus-4-8",
  filePath: "x.jsonl",
  nodes: [
    { id: "u1", parentId: null, role: "user", source: "claude-code", timestamp: null, text: "Please add hello()" },
    { id: "a1", parentId: "u1", role: "assistant", source: "claude-code", timestamp: null, text: "Done." },
    {
      id: "t1", parentId: "a1", role: "tool", source: "claude-code", timestamp: null,
      tool: { name: "Edit", input: { file_path: "utils.ts", old_string: "a", new_string: "b" }, result: "updated", files: ["utils.ts"] },
    },
    { id: "s1n", parentId: "a1", role: "reasoning", source: "claude-code", timestamp: null, isSidechain: true, thinking: "think" },
  ],
};

describe("markdown export", () => {
  const md = toMarkdown(session);
  test("includes title, metadata and content", () => {
    expect(md).toContain("# Add a hello function");
    expect(md).toContain("**Model:** claude-opus-4-8");
    expect(md).toContain("👤 User");
    expect(md).toContain("Please add hello()");
    expect(md).toContain("🔧 Edit");
    expect(md).toContain("updated");
  });
  test("uses a code fence with a language hint for the tool input", () => {
    expect(md).toContain("```ts");
  });
  test("marks sub-agent nodes", () => {
    expect(md).toContain("_(sub-agent)_");
  });
});

describe("html export", () => {
  const html = toHTML(session);
  test("is a self-contained document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).not.toContain("<script");
  });
  test("escapes user content", () => {
    const evil = { ...session, title: "<img src=x onerror=alert(1)>" };
    const out = toHTML(evil);
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;img src=x");
  });
});

describe("slugify", () => {
  test("produces a filesystem-safe slug", () => {
    expect(slugify("Add a hello function!")).toBe("add-a-hello-function");
    expect(slugify("")).toBe("session");
  });
});
