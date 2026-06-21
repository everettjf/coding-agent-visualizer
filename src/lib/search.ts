// In-memory inverted index for full-text session search.
//
// The naive approach scans every session body on every keystroke — O(total
// characters) per query. Instead we tokenize each body once into an inverted
// index (token → postings of {doc, term-frequency}); a query then only touches
// the postings of its terms. Query terms match tokens by prefix (so "discover"
// finds "discovery"), results are AND-combined across terms and ranked by
// summed term frequency, then recency. Snippets are computed lazily for just
// the handful of results returned.

import type { SessionSummary } from "./types";

export interface SearchDoc {
  summary: SessionSummary;
  /** Flattened, original-case session body. */
  text: string;
}

export interface SearchHit {
  summary: SessionSummary;
  /** Number of query terms matched (always all of them — AND semantics). */
  hits: number;
  /** A short excerpt of the body around the first match (original case). */
  snippet: string;
}

const MIN_TOKEN = 2;

export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length >= MIN_TOKEN);
}

interface Posting {
  doc: number;
  tf: number;
}

export interface SearchIndex {
  search(query: string, limit?: number): SearchHit[];
  size: number;
}

export function buildIndex(docs: SearchDoc[]): SearchIndex {
  const postings = new Map<string, Posting[]>();
  for (let doc = 0; doc < docs.length; doc++) {
    const freq = new Map<string, number>();
    for (const tok of tokenize(docs[doc].text)) {
      freq.set(tok, (freq.get(tok) ?? 0) + 1);
    }
    for (const [tok, tf] of freq) {
      let list = postings.get(tok);
      if (!list) postings.set(tok, (list = []));
      list.push({ doc, tf });
    }
  }
  // Sorted vocabulary enables prefix expansion via binary search.
  const vocab = [...postings.keys()].sort();

  // First index ≥ prefix.
  const lowerBound = (prefix: string): number => {
    let lo = 0;
    let hi = vocab.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (vocab[mid] < prefix) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  // Accumulate doc → score for every token starting with `prefix`.
  const matchPrefix = (prefix: string): Map<number, number> => {
    const out = new Map<number, number>();
    for (let i = lowerBound(prefix); i < vocab.length && vocab[i].startsWith(prefix); i++) {
      for (const { doc, tf } of postings.get(vocab[i])!) {
        out.set(doc, (out.get(doc) ?? 0) + tf);
      }
    }
    return out;
  };

  const snippetFor = (text: string, term: string, span = 120): string => {
    const at = text.toLowerCase().indexOf(term);
    if (at < 0) return text.slice(0, span).replace(/\s+/g, " ").trim();
    const start = Math.max(0, at - Math.floor(span / 3));
    const raw = text.slice(start, start + span).replace(/\s+/g, " ").trim();
    return (start > 0 ? "…" : "") + raw + (start + span < text.length ? "…" : "");
  };

  return {
    size: docs.length,
    search(query, limit = 50) {
      const terms = tokenize(query);
      if (!terms.length) return [];

      // AND across terms: intersect the per-term matched-doc sets, summing scores.
      let acc: Map<number, number> | null = null;
      for (const term of terms) {
        const matched = matchPrefix(term);
        if (acc === null) {
          acc = matched;
        } else {
          const next = new Map<number, number>();
          for (const [doc, score] of acc) {
            const m = matched.get(doc);
            if (m !== undefined) next.set(doc, score + m);
          }
          acc = next;
        }
        if (acc.size === 0) return [];
      }

      const ranked = [...acc!.entries()].sort(
        (a, b) =>
          b[1] - a[1] ||
          (docs[b[0]].summary.endedAt ?? "").localeCompare(docs[a[0]].summary.endedAt ?? ""),
      );

      return ranked.slice(0, limit).map(([doc]) => ({
        summary: docs[doc].summary,
        hits: terms.length,
        snippet: snippetFor(docs[doc].text, terms[0]),
      }));
    },
  };
}
