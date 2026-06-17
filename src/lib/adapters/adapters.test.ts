import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseClaudeCodeSession } from "./claudeCode";
import { parseCodexSession } from "./codex";
import { parseGeminiSession } from "./gemini";
import { buildClineSession } from "./cline";
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

describe("Gemini adapter", () => {
  const session = parseGeminiSession(read("gemini-sample.json"), "g.json")!;

  test("parses session metadata from the envelope", () => {
    expect(session.source).toBe("gemini");
    expect(session.cwd).toBe("/home/user/demo-project");
    expect(session.model).toBe("gemini-2.5-pro");
    expect(session.title).toBe("Add a hello function to utils.ts");
  });

  test("maps user/model/reasoning roles and tool calls", () => {
    const roles = session.nodes.map((n) => n.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
    expect(roles).toContain("reasoning"); // model turn with only a thought part
    expect(roles).toContain("tool");
    // every non-root node points at a real parent
    const ids = new Set(session.nodes.map((n) => n.id));
    for (const n of session.nodes) {
      if (n.parentId) expect(ids.has(n.parentId)).toBe(true);
    }
  });

  test("pairs functionResponse to its functionCall by name", () => {
    const readTool = session.nodes.find((n) => n.tool?.name === "read_file");
    expect(readTool!.tool!.result).toContain("export const x = 1;");
    const replaceTool = session.nodes.find((n) => n.tool?.name === "replace");
    expect(replaceTool!.tool!.result).toContain("File updated successfully.");
  });

  test("extracts edited file paths from tool args", () => {
    const replaceTool = session.nodes.find((n) => n.tool?.name === "replace");
    expect(replaceTool!.tool!.files).toEqual(["/home/user/demo-project/utils.ts"]);
  });

  test("sums token usage from usageMetadata", () => {
    expect(session.totalTokens).toBe(320 + 40 + 380 + 90 + 410 + 30);
    const stats = computeStats(session);
    expect(stats.totals.cacheTokens).toBe(512);
  });

  test("accepts a bare Content[] array too", () => {
    const bare = JSON.stringify([
      { role: "user", parts: [{ text: "hi there" }] },
      { role: "model", parts: [{ text: "hello!" }] },
    ]);
    const s = parseGeminiSession(bare, "bare.json")!;
    expect(s.title).toBe("hi there");
    expect(s.nodes.map((n) => n.role)).toEqual(["user", "assistant"]);
  });
});

describe("Cline adapter", () => {
  const history = JSON.parse(read("cline/task-123/api_conversation_history.json"));
  const ui = JSON.parse(read("cline/task-123/ui_messages.json"));
  const session = buildClineSession("task-123", history, ui)!;

  test("parses metadata and unwraps the <task> title", () => {
    expect(session.source).toBe("cline");
    expect(session.title).toBe("Add a hello function to utils.ts");
    expect(session.filePath).toBe("cline:task-123");
    expect(session.startedAt).toBe(new Date(1750000000000).toISOString());
  });

  test("maps user / reasoning / assistant / tool roles", () => {
    const roles = session.nodes.map((n) => n.role);
    expect(roles).toContain("user");
    expect(roles).toContain("reasoning"); // the thinking-only assistant turn
    expect(roles).toContain("assistant");
    expect(roles).toContain("tool");
    const ids = new Set(session.nodes.map((n) => n.id));
    for (const n of session.nodes) {
      if (n.parentId) expect(ids.has(n.parentId)).toBe(true);
    }
  });

  test("pairs tool_result back to its tool_use and extracts files", () => {
    const readTool = session.nodes.find((n) => n.tool?.name === "read_file");
    expect(readTool!.tool!.result).toContain("export const x = 1;");
    expect(readTool!.tool!.files).toEqual(["/home/user/demo-project/utils.ts"]);
    const replaceTool = session.nodes.find((n) => n.tool?.name === "replace_in_file");
    expect(replaceTool!.tool!.result).toContain("successfully saved");
  });

  test("assigns api_req_started token usage to assistant turns", () => {
    expect(session.totalTokens).toBe(320 + 40 + 380 + 90 + 410 + 30);
    const stats = computeStats(session);
    expect(stats.totals.cacheTokens).toBe(100 + 50 + 200);
    expect(stats.totals.cacheCreationTokens).toBe(100);
    expect(stats.totals.cacheReadTokens).toBe(250);
  });
});
