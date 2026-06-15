import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseClaudeCodeSession } from "./claudeCode";
import { parseCodexSession } from "./codex";
import { computeStats } from "../stats";

const fixtures = join(import.meta.dir, "../../../fixtures");
const read = (f: string) => readFileSync(join(fixtures, f), "utf8");

describe("Claude Code adapter", () => {
  const session = parseClaudeCodeSession(read("claude-code-sample.jsonl"), "x.jsonl")!;

  test("parses session metadata", () => {
    expect(session.source).toBe("claude-code");
    expect(session.cwd).toBe("/home/user/demo-project");
    expect(session.gitBranch).toBe("main");
    expect(session.model).toBe("claude-opus-4-8");
    expect(session.title).toBe("Add a hello function to utils.ts");
  });

  test("builds nodes with a parent chain", () => {
    const roles = session.nodes.map((n) => n.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
    expect(roles).toContain("tool");
    // every non-root node points at a real parent
    const ids = new Set(session.nodes.map((n) => n.id));
    for (const n of session.nodes) {
      if (n.parentId) expect(ids.has(n.parentId)).toBe(true);
    }
  });

  test("tool calls become child nodes with results attached", () => {
    const read = session.nodes.find((n) => n.tool?.name === "Read");
    expect(read).toBeDefined();
    expect(read!.parentId).toBe("a1");
    expect(read!.tool!.result).toContain("export const x = 1;");

    const edit = session.nodes.find((n) => n.tool?.name === "Edit");
    expect(edit!.tool!.files).toEqual(["/home/user/demo-project/utils.ts"]);
    expect(edit!.tool!.result).toContain("updated");
  });

  test("captures token usage", () => {
    expect(session.totalTokens).toBeGreaterThan(0);
    const stats = computeStats(session);
    expect(stats.totals.inputTokens).toBeGreaterThan(0);
    expect(stats.totals.outputTokens).toBeGreaterThan(0);
  });
});

describe("Codex adapter", () => {
  const session = parseCodexSession(read("codex-sample.jsonl"), "y.jsonl")!;

  test("parses session metadata", () => {
    expect(session.source).toBe("codex");
    expect(session.cwd).toBe("/home/user/demo-project");
    expect(session.model).toBe("gpt-5-codex");
    expect(session.title).toBe("Add a hello function to utils.ts");
  });

  test("maps message roles (developer -> system)", () => {
    const roles = session.nodes.map((n) => n.role);
    expect(roles).toContain("system"); // developer message
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
    expect(roles).toContain("reasoning");
  });

  test("links function_call_output to its call by call_id", () => {
    const tools = session.nodes.filter((n) => n.role === "tool");
    expect(tools.length).toBe(2);
    expect(tools[0].tool!.result).toContain("export const x = 1;");
    expect(tools[1].tool!.result).toContain("Success");
  });

  test("extracts files from apply_patch", () => {
    const patch = session.nodes.find((n) => n.tool?.files?.length);
    expect(patch).toBeDefined();
    expect(patch!.tool!.files).toContain("utils.ts");
  });

  test("reads token totals from token_count event", () => {
    expect(session.totalTokens).toBe(1540);
  });
});
