// Tests for the two non-JSONL adapters: OpenCode (many small JSON files) and
// Cursor (a SQLite DB). OpenCode reads from a fixture storage root; Cursor runs
// against an in-memory database seeded to mirror the real cursorDiskKV schema.

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { loadOpenCodeSessions, getOpenCodeSession } from "./opencode";
import { buildSession as buildCursorSession } from "./cursor";
import { computeStats } from "../stats";

const storage = join(import.meta.dir, "../../../fixtures/opencode/storage");

describe("OpenCode adapter", () => {
  test("assembles a session from session/message/part files", async () => {
    const sessions = await loadOpenCodeSessions(storage);
    expect(sessions.length).toBe(1);
    const s = sessions[0];
    expect(s.source).toBe("opencode");
    expect(s.cwd).toBe("/home/user/demo-project");
    expect(s.title).toBe("Add a hello function to utils.ts");
    expect(s.model).toBe("anthropic/claude-sonnet-4-6");
    expect(s.filePath).toBe("opencode:ses_001");
  });

  test("maps text/reasoning/tool parts and tracks files + tokens", async () => {
    const s = (await loadOpenCodeSessions(storage))[0];
    const roles = s.nodes.map((n) => n.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
    expect(roles).toContain("tool");
    const ids = new Set(s.nodes.map((n) => n.id));
    for (const n of s.nodes) if (n.parentId) expect(ids.has(n.parentId)).toBe(true);

    const edit = s.nodes.find((n) => n.tool?.name === "edit")!;
    expect(edit.tool!.files).toEqual(["/home/user/demo-project/utils.ts"]);
    expect(edit.tool!.result).toContain("updated successfully");

    expect(s.totalTokens).toBe(470);
    expect(computeStats(s).totals.cacheTokens).toBe(250);
  });

  test("getOpenCodeSession fetches a single session by id", async () => {
    const s = await getOpenCodeSession("ses_001", storage);
    expect(s?.id).toBe("ses_001");
    expect(await getOpenCodeSession("nope", storage)).toBeNull();
  });
});

describe("Cursor adapter", () => {
  function seed(): Database {
    const db = new Database(":memory:");
    db.run("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)");
    const put = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");

    put.run(
      "composerData:c1",
      JSON.stringify({
        composerId: "c1",
        createdAt: 1750000000000,
        lastUpdatedAt: 1750000009000,
        fullConversationHeadersOnly: [
          { bubbleId: "b1", type: 1 },
          { bubbleId: "b2", type: 2 },
          { bubbleId: "b3", type: 2 },
        ],
      }),
    );
    put.run(
      "bubbleId:c1:b1",
      JSON.stringify({ type: 1, text: "Add a hello function to utils.ts" }),
    );
    put.run(
      "bubbleId:c1:b2",
      JSON.stringify({
        type: 2,
        text: "I'll edit the file.",
        tokenCount: { inputTokens: 300, outputTokens: 80 },
      }),
    );
    put.run(
      "bubbleId:c1:b3",
      JSON.stringify({
        type: 2,
        toolFormerData: {
          name: "edit_file",
          rawArgs: JSON.stringify({ target_file: "/home/user/demo-project/utils.ts" }),
          result: JSON.stringify({ ok: true }),
          status: "completed",
        },
      }),
    );
    return db;
  }

  test("builds a session from composer + bubble rows", () => {
    const db = seed();
    const s = buildCursorSession(db, "c1")!;
    db.close();

    expect(s.source).toBe("cursor");
    expect(s.title).toBe("Add a hello function to utils.ts");
    expect(s.filePath).toBe("cursor:c1");
    expect(s.totalTokens).toBe(380);

    const roles = s.nodes.map((n) => n.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
    expect(roles).toContain("tool");

    const tool = s.nodes.find((n) => n.role === "tool")!;
    expect(tool.tool!.name).toBe("edit_file");
    expect(tool.tool!.files).toEqual(["/home/user/demo-project/utils.ts"]);
  });

  test("returns null for an unknown composer id", () => {
    const db = seed();
    expect(buildCursorSession(db, "missing")).toBeNull();
    db.close();
  });
});
