// Tiny, dependency-free syntax highlighter. The project deliberately avoids
// heavyweight tooling (no Prism/Shiki), so this is a small regex tokenizer that
// covers the constructs that make a code diff readable — strings, comments,
// numbers and keywords — across the languages coding agents touch most
// (JS/TS, Python, Go, Rust, JSON, shell). It is intentionally approximate:
// good enough to read a diff at a glance, never a full grammar.

import { Fragment, type ReactNode } from "react";

export type Lang = "default" | "hash"; // hash = #-style line comments

type TokenClass = "str" | "com" | "num" | "kw" | "lit" | "fn";

interface Rule {
  cls: TokenClass;
  re: RegExp;
}

// A shared keyword set spanning the common agent languages. Highlighting a
// keyword that doesn't exist in the actual language is harmless, so we keep one
// generous list rather than per-language grammars.
const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "do", "switch", "case", "break", "continue", "new", "class", "extends",
  "import", "export", "from", "as", "default", "async", "await", "yield",
  "try", "catch", "finally", "throw", "typeof", "instanceof", "in", "of",
  "interface", "type", "enum", "public", "private", "protected", "static",
  "readonly", "implements", "abstract", "def", "elif", "lambda", "pass",
  "with", "fn", "pub", "use", "mut", "impl", "struct", "trait", "match",
  "func", "package", "go", "defer", "range", "map", "select", "and", "or",
  "not", "is", "del", "raise", "except", "global", "nonlocal",
]);

const LITERALS = new Set([
  "true", "false", "null", "undefined", "None", "True", "False", "nil", "self", "this",
]);

// Comment style depends on language; pick the right line-comment rule.
function commentRule(lang: Lang): Rule {
  return lang === "hash"
    ? { cls: "com", re: /#.*/y }
    : { cls: "com", re: /\/\/.*/y };
}

// Order matters: strings and comments must win over identifiers/numbers.
function rules(lang: Lang): Rule[] {
  return [
    commentRule(lang),
    { cls: "com", re: /\/\*[\s\S]*?\*\//y },
    { cls: "str", re: /"(?:\\.|[^"\\])*"/y },
    { cls: "str", re: /'(?:\\.|[^'\\])*'/y },
    { cls: "str", re: /`(?:\\.|[^`\\])*`/y },
    { cls: "num", re: /\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y },
    { cls: "fn", re: /[A-Za-z_$][\w$]*(?=\s*\()/y },
    { cls: "kw", re: /[A-Za-z_$][\w$]*/y },
  ];
}

interface Tok {
  text: string;
  cls: TokenClass | null;
}

/** Tokenize a single line of source into classified spans. */
export function tokenizeLine(line: string, lang: Lang = "default"): Tok[] {
  const ruleset = rules(lang);
  const out: Tok[] = [];
  let i = 0;
  let plain = "";
  const flush = () => {
    if (plain) {
      out.push({ text: plain, cls: null });
      plain = "";
    }
  };

  while (i < line.length) {
    let matched = false;
    for (const rule of ruleset) {
      rule.re.lastIndex = i;
      const m = rule.re.exec(line);
      if (m && m.index === i && m[0].length > 0) {
        let cls: TokenClass | null = rule.cls;
        // The identifier rule double-classifies: promote keywords/literals.
        if (rule.cls === "kw") {
          if (KEYWORDS.has(m[0])) cls = "kw";
          else if (LITERALS.has(m[0])) cls = "lit";
          else cls = null; // a plain identifier
        }
        flush();
        out.push({ text: m[0], cls });
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      plain += line[i];
      i++;
    }
  }
  flush();
  return out;
}

/** Infer a comment style from a file path / language hint. */
export function langForFile(file?: string): Lang {
  if (!file) return "default";
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return ["py", "rb", "sh", "bash", "zsh", "yml", "yaml", "toml", "r", "pl"].includes(ext)
    ? "hash"
    : "default";
}

const CLASS_NAMES: Record<TokenClass, string> = {
  str: "tok-str",
  com: "tok-com",
  num: "tok-num",
  kw: "tok-kw",
  lit: "tok-lit",
  fn: "tok-fn",
};

/** Render a line of code as highlighted React spans. */
export function highlight(line: string, lang: Lang = "default"): ReactNode {
  const toks = tokenizeLine(line, lang);
  return toks.map((t, i) =>
    t.cls ? (
      <span key={i} className={CLASS_NAMES[t.cls]}>
        {t.text}
      </span>
    ) : (
      <Fragment key={i}>{t.text}</Fragment>
    ),
  );
}
