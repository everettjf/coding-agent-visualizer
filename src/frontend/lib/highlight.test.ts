import { describe, expect, test } from "bun:test";
import { tokenizeLine, langForFile } from "./highlight";

// Helper: collect the classified (non-plain) tokens for easy assertions.
const classified = (line: string, lang?: Parameters<typeof tokenizeLine>[1]) =>
  tokenizeLine(line, lang).filter((t) => t.cls != null);

describe("syntax highlighter", () => {
  test("tokens reassemble into the original line losslessly", () => {
    const line = `const x = foo("a", 42); // note`;
    expect(tokenizeLine(line).map((t) => t.text).join("")).toBe(line);
  });

  test("classifies keywords, literals, strings, numbers and calls", () => {
    const toks = classified(`const ok = compute(1, true, "hi");`);
    const find = (cls: string) => toks.filter((t) => t.cls === cls).map((t) => t.text);
    expect(find("kw")).toContain("const");
    expect(find("lit")).toContain("true");
    expect(find("str")).toContain(`"hi"`);
    expect(find("num")).toContain("1");
    expect(find("fn")).toContain("compute");
  });

  test("plain identifiers are not classified", () => {
    const toks = tokenizeLine("foobar = baz");
    const idents = toks.filter((t) => t.text === "foobar" || t.text === "baz");
    expect(idents.every((t) => t.cls == null)).toBe(true);
  });

  test("a // comment swallows the rest of the line", () => {
    const toks = classified(`x = 1 // const not a keyword here`);
    const com = toks.find((t) => t.cls === "com");
    expect(com?.text).toBe("// const not a keyword here");
    // The keyword inside the comment must not be separately classified.
    expect(toks.some((t) => t.cls === "kw")).toBe(false);
  });

  test("hash language treats # as a line comment", () => {
    const toks = classified(`x = 1  # const`, "hash");
    expect(toks.find((t) => t.cls === "com")?.text).toBe("# const");
  });

  test("strings with escaped quotes stay one token", () => {
    const toks = classified(`s = "a\\"b"`);
    expect(toks.find((t) => t.cls === "str")?.text).toBe(`"a\\"b"`);
  });

  test("langForFile picks comment style from extension", () => {
    expect(langForFile("a/b/c.py")).toBe("hash");
    expect(langForFile("script.sh")).toBe("hash");
    expect(langForFile("util.ts")).toBe("default");
    expect(langForFile(undefined)).toBe("default");
  });
});
