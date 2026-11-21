// A definition's key (the incremental compile's part 2, plan doc
// "Incremental compile after edits"): the same for the same nodes, ids
// and all, typed the same, in any compile of any version of the program.
// A pass keeps what it worked out of some definitions (kept.ts) under
// their keys, and an edit that leaves those definitions as they were finds
// it again. The nodes' part is the check cache's number for their text
// (check-cache.ts defText, kept with the node objects); the types' part
// writes each node's type out with its variables numbered as they come,
// effects and all.
//
// A rewrite gives the nodes it makes new ids at random (model.ts freshId),
// so two compiles of one program differ there. Inside `keysOver(nodes, …)`
// (a lowering, over the program it was given) an id that isn't one of
// those nodes is written by the place it first comes in the definition's
// text, so a definition's key is the same in each compile.

import { mapIds, subtreeKept, type Code, type Id, type Node } from "../model.ts";
import type { Info } from "./infer.ts";
import { defText } from "./check-cache.ts";
import type { Row, Type } from "./types.ts";

let given: Record<Id, Node> | null = null;
export function keysOver<T>(nodes: Record<Id, Node>, f: () => T): T {
  const outer = given;
  given = nodes;
  try { return f(); } finally { given = outer; }
}
// The definition's nodes as text: the check cache's number for it where
// every id is one of the given nodes', else written out, made ids by place.
const madeTexts = new WeakMap<readonly Id[], { given: Record<Id, Node>; text: string }>();
function nodesText(code: Code, d: Id): string {
  const ids = subtreeKept(code, d), g = given;
  if (!g) return String(defText(code, d));
  const was = madeTexts.get(ids);
  if (was && was.given === g) return was.text;
  const at = new Map<Id, string>();
  let made = false;
  const f = (id: Id) => { if (g[id] !== undefined) return id; made = true; let k = at.get(id); if (k === undefined) at.set(id, (k = `#${at.size}`)); return k; };
  const parts = ids.map((id) => JSON.stringify(mapIds(code.nodes[id], f)));
  const text = made ? parts.join(",") : String(defText(code, d));
  madeTexts.set(ids, { given: g, text });
  return text;
}

export function defKey(code: Code, info: Info, d: Id): string {
  return `${nodesText(code, d)}${info.divergent.has(d) ? "!" : ""}:${typesText(code, info, d)}`;
}
// Each node's type written out, variables numbered as they come.
function typesText(code: Code, info: Info, d: Id): string {
  const vars = new Map<number, number>();
  const v = (n: number) => { let k = vars.get(n); if (k === undefined) vars.set(n, (k = vars.size)); return k; };
  const row = (r: Row): string => {
    const z = info.subst.resolveRow(r);
    const args = z.args ? Object.keys(z.args).sort().map((e) => `${e}(${z.args![e].map(show).join(",")})`).join(",") : "";
    return `{${[...z.effs].sort().join(",")}${z.tail === null ? "" : `|${v(z.tail)}`}${args ? `;${args}` : ""}}`;
  };
  const show = (t: Type): string => {
    t = info.subst.zonk(t);
    if (t.t === "var") return `'${v(t.v)}`;
    if (t.t === "con") return t.args.length ? `${t.id}(${t.args.map(show).join(",")})` : t.id;
    return `(${t.params.map(show).join(",")})${row(t.eff)}${show(t.ret)}`;
  };
  let types = "";
  for (const id of subtreeKept(code, d)) { const t = info.typeOf.get(id); types += t ? show(t) : "-"; types += ";"; }
  return types;
}

// Several definitions as one text with each literal's value left out, for
// what never reads one: every id that isn't `kept`'s written by the place
// it first comes (`placed`), so a program whose ids are named by their
// contents (stable-ids.ts, a literal's value among them) or made at random
// is written the same.
export function blindText(code: Code, info: Info, ds: Id[], kept: (id: Id) => boolean): { text: string; placed: Id[] } {
  const at = new Map<Id, string>(), placed: Id[] = [];
  const f = (id: Id) => { if (kept(id)) return id; let k = at.get(id); if (k === undefined) { at.set(id, (k = `#${placed.length}`)); placed.push(id); } return k; };
  const parts: string[] = [];
  for (const d of ds) {
    parts.push(`${f(d)}${info.divergent.has(d) ? "!" : ""}:${typesText(code, info, d)}`);
    for (const id of subtreeKept(code, d)) { const n = mapIds(code.nodes[id], f); parts.push(JSON.stringify(n.kind === "lit" ? { ...n, value: typeof n.value } : n)); }
  }
  return { text: parts.join("\n"), placed };
}

// The keys of several definitions as one, in an order of their own (a made
// definition's id is new each compile).
export const defsKey = (code: Code, info: Info, ds: Iterable<Id>): string => [...ds].map((d) => defKey(code, info, d)).sort().join("\n");
