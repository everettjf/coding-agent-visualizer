import { describe, expect, test } from "bun:test";
import { aggregate, sessionToRecord, type SessionRecord } from "./analytics";
import type { UnifiedSession } from "./types";

const rec = (over: Partial<SessionRecord>): SessionRecord => ({
  source: "claude-code",
  model: "claude-opus-4-8",
  project: "demo",
  date: "2026-01-01",
  tokens: 100,
  inputTokens: 60,
  outputTokens: 40,
  cacheTokens: 0,
  cost: 0,
  toolCalls: 1,
  tools: { Read: 1 },
  ...over,
});

describe("aggregate", () => {
  const records = [
    rec({ source: "claude-code", date: "2026-01-01", tokens: 100, tools: { Read: 2, Edit: 1 }, toolCalls: 3 }),
    rec({ source: "codex", model: "gpt-5-codex", project: "web", date: "2026-01-01", tokens: 50, tools: { Bash: 4 }, toolCalls: 4 }),
    rec({ source: "gemini", model: "gemini-2.5-pro", project: "demo", date: "2026-01-02", tokens: 200, tools: { Read: 1 }, toolCalls: 1 }),
  ];
  const a = aggregate(records);

  test("counts sessions and totals", () => {
    expect(a.sessionCount).toBe(3);
    expect(a.totalTokens).toBe(350);
    expect(a.totalToolCalls).toBe(8);
  });

  test("rolls up by month and computes burn rate", () => {
    expect(a.monthly.map((m) => m.date)).toEqual(["2026-01"]);
    expect(a.monthly[0].tokens).toBe(350); // 100 + 50 + 200
    expect(a.monthly[0].sessions).toBe(3);
    // 2 active days → per-active-day = totalCost / 2
    expect(a.burn.perActiveDay).toBeCloseTo(a.totalCost / 2, 10);
    // both active days fall within the last 30 (and 7) days of the latest day
    expect(a.burn.last30).toBeCloseTo(a.totalCost, 10);
  });

  test("buckets tokens by day, sorted ascending", () => {
    expect(a.daily.map((d) => d.date)).toEqual(["2026-01-01", "2026-01-02"]);
    expect(a.daily[0].tokens).toBe(150);
    expect(a.daily[0].sessions).toBe(2);
    expect(a.daily[1].tokens).toBe(200);
  });

  test("breaks down by source and model", () => {
    const src = Object.fromEntries(a.bySource.map((s) => [s.name, s.tokens]));
    expect(src).toEqual({ "claude-code": 100, codex: 50, gemini: 200 });
    expect(a.byModel.find((m) => m.name === "gemini-2.5-pro")?.tokens).toBe(200);
  });

  test("ranks projects by tokens and tools by count", () => {
    expect(a.topProjects[0].name).toBe("demo"); // 100 + 200
    expect(a.topProjects[0].tokens).toBe(300);
    // Bash(4) outranks Read(2+1=3) which outranks Edit(1).
    expect(a.topTools[0]).toEqual({ name: "Bash", count: 4 });
    expect(a.topTools[1]).toEqual({ name: "Read", count: 3 });
  });
});

describe("sessionToRecord", () => {
  const session: UnifiedSession = {
    id: "s",
    source: "codex",
    cwd: "/a/b/myproj",
    title: "t",
    startedAt: "2026-03-04T10:00:00.000Z",
    endedAt: "2026-03-04T10:10:00.000Z",
    messageCount: 1,
    toolCallCount: 1,
    totalTokens: 90,
    model: "gpt-5-codex",
    filePath: "f",
    nodes: [
      { id: "a", parentId: null, role: "assistant", source: "codex", timestamp: "2026-03-04T10:00:00.000Z", text: "hi", tokens: { input: 50, output: 40, cacheRead: 5, cacheCreation: 0 } },
      { id: "t1", parentId: "a", role: "tool", source: "codex", timestamp: "2026-03-04T10:01:00.000Z", tool: { name: "shell", input: "ls" } },
    ],
  };
  const r = sessionToRecord(session);

  test("derives date, project and token breakdown", () => {
    expect(r.date).toBe("2026-03-04");
    expect(r.project).toBe("myproj");
    expect(r.inputTokens).toBe(50);
    expect(r.outputTokens).toBe(40);
    expect(r.cacheTokens).toBe(5);
    expect(r.tools).toEqual({ shell: 1 });
  });

  test("estimates cost from the breakdown under the model's pricing", () => {
    // gpt-5-codex: 50 input·$1.25 + 40 output·$10 + 5 cacheRead·$0.125, per 1M
    const expected = (50 * 1.25 + 40 * 10 + 5 * 0.125) / 1_000_000;
    expect(r.cost).toBeCloseTo(expected, 10);
    expect(aggregate([r]).totalCost).toBeCloseTo(expected, 10);
  });
});
