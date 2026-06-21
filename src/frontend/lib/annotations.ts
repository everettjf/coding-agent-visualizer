// Local, private node annotations — flag a turn (e.g. "this is where it went
// wrong") and jot a note. Stored in localStorage keyed by session id, so they
// persist across visits and never leave the machine. Exportable to Markdown.

import type { UnifiedSession } from "../../lib/types";

export interface NodeAnnotation {
  flagged?: boolean;
  note?: string;
}
export type SessionAnnotations = Record<string, NodeAnnotation>;

const key = (sessionId: string) => `cav:annot:${sessionId}`;

const isEmpty = (a: NodeAnnotation) => !a.flagged && !a.note?.trim();

export function loadAnnotations(sessionId: string): SessionAnnotations {
  try {
    return JSON.parse(localStorage.getItem(key(sessionId)) || "{}") as SessionAnnotations;
  } catch {
    return {};
  }
}

/** Return the updated map (new object) after applying one node's annotation. */
export function saveAnnotation(
  sessionId: string,
  nodeId: string,
  annotation: NodeAnnotation,
): SessionAnnotations {
  const all = loadAnnotations(sessionId);
  if (isEmpty(annotation)) delete all[nodeId];
  else all[nodeId] = annotation;
  try {
    if (Object.keys(all).length) localStorage.setItem(key(sessionId), JSON.stringify(all));
    else localStorage.removeItem(key(sessionId));
  } catch {
    /* storage full / unavailable — annotations are best-effort */
  }
  return all;
}

export function annotationCount(all: SessionAnnotations): number {
  return Object.keys(all).length;
}

/** Render flagged/noted nodes as a Markdown review document. */
export function annotationsToMarkdown(
  session: UnifiedSession,
  all: SessionAnnotations,
): string {
  const byId = new Map(session.nodes.map((n) => [n.id, n]));
  const lines: string[] = [`# Notes — ${session.title}`, ""];
  const ordered = session.nodes.filter((n) => all[n.id]);
  if (!ordered.length) lines.push("_No annotations yet._");
  for (const n of ordered) {
    const a = all[n.id];
    const flag = a.flagged ? "🚩 " : "";
    const preview = (n.text || n.thinking || n.tool?.name || n.role).slice(0, 80);
    lines.push(`## ${flag}${n.role} — ${preview}`);
    if (a.note?.trim()) lines.push("", a.note.trim());
    lines.push("");
  }
  return lines.join("\n");
}
