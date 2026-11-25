// A program as Run sends it to its worker (I177): only the nodes that
// aren't the library's own, the library's that are gone, and the
// definitions. The worker puts them back on its own copy of the library,
// so its check reads through to the library's kept check (infer.ts
// `under`, L216) instead of checking the ~27,000 library nodes again,
// which a copy of every node, made by postMessage, always did.
import type { Code, Id, Node } from "../ters/src/model.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { dropNode, idsOver, nodeIds, withNodes } from "../ters/src/model.ts";

export type SentCode = { own: Record<Id, Node>; gone: Id[]; defs: Id[] };

export function sendCode(code: Code): SentCode {
  const lib = LIBRARY.code.nodes, own: Record<Id, Node> = {}, gone: Id[] = [];
  // A program over the library (as the editor keeps one): read from its own
  // nodes, not the library's ~50,000 (E319k: for spacetime 18 ms an ask on
  // the editor's thread, now 6). Those it adds in the order a walk gives
  // them (at its end, but for a merge's listed first), as the worker's copy
  // lists them so.
  const mine = idsOver(code.nodes, lib);
  if (mine) {
    const added = new Set<Id>();
    for (const id of mine) {
      const n = code.nodes[id], was = lib[id];
      if (was === undefined) { if (n !== undefined) added.add(id); }
      else if (n === undefined) gone.push(id);
      else if (n !== was) own[id] = n;
    }
    if (added.size) {
      const ids = nodeIds(code.nodes), at: Id[] = [];
      for (let i = ids.length - 1; i >= 0 && at.length < added.size; i--) if (added.has(ids[i])) at.push(ids[i]);
      for (let i = at.length - 1; i >= 0; i--) own[at[i]] = code.nodes[at[i]];
    }
    return { own, gone, defs: code.defs };
  }
  for (const id of nodeIds(code.nodes)) if (code.nodes[id] !== lib[id]) own[id] = code.nodes[id];
  for (const id in lib) if (code.nodes[id] === undefined) gone.push(id);
  return { own, gone, defs: code.defs };
}

export function receivedCode(s: SentCode): Code {
  const nodes: Record<Id, Node> = withNodes(LIBRARY.code.nodes, { ...s.own });
  for (const id of s.gone) dropNode(nodes, id);
  return { nodes, defs: s.defs };
}

// A command line's words: split at spaces, a "quoted" stretch one word.
export function words(s: string): string[] {
  return [...s.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}
// Words back as a line words reads the same.
export const line = (ws: string[]) => ws.map((w) => (w === "" || /[\s"]/.test(w) ? `"${w}"` : w)).join(" ");
