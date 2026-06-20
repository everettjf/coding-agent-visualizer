import { describe, expect, test } from "bun:test";
import { annotationCount, annotationsToMarkdown } from "./annotations";
import type { UnifiedSession } from "../../lib/types";

const session: UnifiedSession = {
  id: "s",
  source: "claude-code",
  cwd: "/proj",
  title: "Fix the parser",
  startedAt: null,
  endedAt: null,
  messageCount: 0,
  toolCallCount: 0,
  totalTokens: 0,
  filePath: "f",
  nodes: [
    { id: "a", parentId: null, role: "user", source: "claude-code", timestamp: null, text: "do the thing" },
    { id: "b", parentId: "a", role: "assistant", source: "claude-code", timestamp: null, text: "broke it here" },
    { id: "c", parentId: "b", role: "tool", source: "claude-code", timestamp: null, tool: { name: "Edit", input: {} } },
  ],
};

describe("annotationsToMarkdown", () => {
  test("renders flagged/noted nodes in document order with flags and notes", () => {
    const md = annotationsToMarkdown(session, {
      b: { flagged: true, note: "wrong edit target" },
      a: { note: "good prompt" },
    });
    expect(md).toContain("# Notes — Fix the parser");
    // document order: a before b
    expect(md.indexOf("good prompt")).toBeLessThan(md.indexOf("wrong edit target"));
    expect(md).toContain("🚩"); // b is flagged
    expect(md).toContain("wrong edit target");
  });

  test("handles no annotations", () => {
    expect(annotationsToMarkdown(session, {})).toContain("_No annotations yet._");
    expect(annotationCount({})).toBe(0);
    expect(annotationCount({ a: { flagged: true } })).toBe(1);
  });
});
