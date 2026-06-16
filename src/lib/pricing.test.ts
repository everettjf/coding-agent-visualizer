import { describe, expect, test } from "bun:test";
import { estimateCostUsd, fmtCost, modelPrice } from "./pricing";

describe("modelPrice", () => {
  test("matches model families by substring", () => {
    expect(modelPrice("claude-opus-4-8")!.output).toBe(75);
    expect(modelPrice("claude-sonnet-4-6")!.input).toBe(3);
    expect(modelPrice("gpt-5-codex")!.input).toBe(1.25);
    expect(modelPrice("gemini-2.5-pro")!.output).toBe(10);
  });

  test("more specific patterns win over generic ones", () => {
    // gemini-2.5-flash must not be captured by the generic "gemini" entry
    expect(modelPrice("gemini-2.5-flash")!.input).toBe(0.3);
  });

  test("unknown / missing models are unpriced", () => {
    expect(modelPrice("some-local-llama")).toBeNull();
    expect(modelPrice(undefined)).toBeNull();
    expect(modelPrice("")).toBeNull();
  });
});

describe("estimateCostUsd", () => {
  test("prices a token breakdown per million", () => {
    // 1M input + 1M output on Opus → $15 + $75
    const cost = estimateCostUsd(
      { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheCreation: 0 },
      "claude-opus-4-8",
    );
    expect(cost).toBeCloseTo(90, 5);
  });

  test("charges cache reads and writes at their own rates", () => {
    const cost = estimateCostUsd(
      { input: 0, output: 0, cacheRead: 1_000_000, cacheCreation: 1_000_000 },
      "claude-opus-4-8",
    );
    expect(cost).toBeCloseTo(1.5 + 18.75, 5);
  });

  test("unpriced models cost nothing (rather than guessing)", () => {
    expect(
      estimateCostUsd(
        { input: 9_999_999, output: 9_999_999, cacheRead: 0, cacheCreation: 0 },
        "mystery-model",
      ),
    ).toBe(0);
  });
});

describe("fmtCost", () => {
  test("formats across magnitudes", () => {
    expect(fmtCost(0)).toBe("$0");
    expect(fmtCost(0.004)).toBe("<$0.01");
    expect(fmtCost(0.42)).toBe("$0.42");
    expect(fmtCost(12.5)).toBe("$12.50");
    expect(fmtCost(2500)).toBe("$2,500");
  });
});
