// New ids named by what they hold (the compiler redesign's stage 4). A
// rewrite's new nodes get random ids (model.ts freshId), so a check of the
// program it made never found its groups kept from the last compile
// (check-cache.ts keys a group by its nodes' text, ids and all): machine's
// representation choice was checked again whole on every compile. Each is
// renamed here from its definition's text, the new ids in it numbered by
// place: the same rewrite gives the same ids in any process, and two
// definitions that differ in anything give theirs apart, so an id stands
// for one node.
//
// `made`: the ids the rewrite made (model.ts idsMadeBy). `within`: the
// definitions they may be in (what the rewrite reaches); `naming`: those
// that may name one without holding one (a copy calling a definition
// made, the program's own calling a job's copy); a new definition is
// looked into anyway. One in none stays as it is: no check of the program
// meets it. A new definition is named by its text with the other new
// definitions it names left out, then its place among those with the
// same text; each definition's other new nodes by its text with those
// names in, then their place in it.

import { mapIds, subtree, type Code, type Id, type Node, nodeIds, renamedOver } from "./model.ts";
import { base32, sha256 } from "./sha256.ts";
import { keptMap } from "./kept.ts";

// Each text's name, kept across compiles: a definition an edit left alone
// has the same text, and hashing every one again was most of naming
// machine's choice (L266).
// (Up to some 16 million characters of texts.)
const named = keptMap<string, string>();
let namedChars = 0;
const nameOf = (text: string, n?: number): string => {
  const key = n === undefined ? text : `${n}|${text}`;
  let v = named.get(key);
  if (v === undefined) {
    if (!named.size || (namedChars += key.length) > 16_000_000) { named.clear(); namedChars = key.length; }
    named.set(key, (v = base32(sha256(text), n)));
  }
  return v;
};

const DIGITS = "0123456789abcdefghijklmnopqrstuv";
const place = (i: number) => { let s = ""; for (let k = 0; k < 10; k++) { s = DIGITS[i & 31] + s; i = Math.floor(i / 32); } return s; };

export function stableIds(code: Code, made: ReadonlySet<Id>, within: Iterable<Id>, naming: Iterable<Id>): { code: Code; rename: Map<Id, Id> } {
  const rename = new Map<Id, Id>();
  if (!made.size) return { code, rename };
  // The definitions holding new nodes, each with its nodes in order.
  const holding = new Map<Id, Id[]>();
  const walk = (d: Id, naming: boolean) => {
    if (holding.has(d) || !code.nodes[d]) return;
    const ids = subtree(code, d);
    let names = false;
    const see = (x: Id) => { if (made.has(x)) names = true; return x; };
    if (!ids.some((id) => made.has(id)) && !(naming && ids.some((id) => (mapIds(code.nodes[id], see), names)))) return;
    holding.set(d, ids);
  };
  for (const d of within) walk(d, false);
  for (const d of naming) walk(d, true);
  for (const d of code.defs) if (made.has(d)) walk(d, true);
  if (!holding.size) return { code, rename };
  const texts = (d: Id, ids: Id[], other: (id: Id) => Id): string => {
    const at = new Map<Id, string>();
    let i = 0;
    for (const id of ids) if (made.has(id)) at.set(id, `#${i++}`);
    const f = (id: Id) => at.get(id) ?? (made.has(id) ? other(id) : id);
    return ids.map((id) => JSON.stringify(mapIds(code.nodes[id], f))).join("\n");
  };
  // New definitions first, by their text without the others' names.
  const seen = new Map<string, number>();
  for (const [d, ids] of holding) {
    if (!made.has(d)) continue;
    const text = texts(d, ids, () => "^");
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    rename.set(d, nameOf(`def\n${n}\n${text}`));
  }
  for (const [d, ids] of holding) {
    const own = rename.get(d) ?? d;
    const prefix = nameOf(`${own}\n${texts(d, ids, (x) => rename.get(x) ?? "^")}`, 16);
    let i = 0;
    for (const id of ids) if (made.has(id) && id !== d) rename.set(id, prefix + place(i++));
  }
  const f = (id: Id) => rename.get(id) ?? id;
  // In the order they were: what walks every node meets them so.
  const mapped = new Map<Id, Node>();
  for (const ids of holding.values()) for (const id of ids) mapped.set(id, mapIds(code.nodes[id], f));
  const over = renamedOver(code.nodes, rename, mapped);
  if (over) return { code: { ...code, nodes: over, defs: code.defs.map(f) }, rename };
  const nodes: Record<Id, Node> = {};
  for (const id of nodeIds(code.nodes)) { const n = mapped.get(id); nodes[n ? n.id : id] = n ?? code.nodes[id]; }
  return { code: { ...code, nodes, defs: code.defs.map(f) }, rename };
}
