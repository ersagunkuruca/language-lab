// Nested patterns, read back from nested matches (PATTERNS.md). The tree
// keeps one level per match; the text and the graph draw a chain of them
// as rows of patterns. A field a case's body matches on, and reads nowhere
// else, becomes that match's cases in its place; an inner otherwise is _
// there. The rows are the leaves of the decision tree, in its order.

import { children, freshId, mapIds, subtree, type Code, type Id, type Node, type NodeOf } from "../model.ts";
import type { Info } from "./infer.ts";
import { CONS, FALSE, NIL, TRUE } from "./std.ts";

export type Pat = { v: Id } | { con: Id; args: Pat[] } | { any: true };
// `at` is the node a row stands for: its leaf case, or the inner match
// whose otherwise it is.
export interface Row { pat: Pat; binds: Id[]; body: Id; at: Id }

const reads = (code: Code, root: Id, ids: Id[]) => subtree(code, root).some((y) => ids.includes((code.nodes[y] as { target?: Id }).target!));

// A match on a Bool is an if, and a match on an effect's operations handles
// it: neither is taking a value apart.
function plainMatch(code: Code, info: Info | null, m: NodeOf<"match">): boolean {
  const vs = m.arms.map((a) => (code.nodes[a] as NodeOf<"arm">).variant);
  if (vs.length === 2 && vs.every((v) => v === TRUE || v === FALSE)) return false;
  const owner = vs.length ? info?.owner.get(vs[0]) : undefined;
  const d = owner ? code.nodes[owner] : null;
  return !(d?.kind === "def" && d.body && (code.nodes[d.body] as { effect?: true }).effect);
}

const put = (p: Pat, b: Id, q: Pat): Pat => ("v" in p ? (p.v === b ? q : p) : "con" in p ? { con: p.con, args: p.args.map((a) => put(a, b, q)) } : p);

// The rows of a match's cases (its own otherwise not included).
export function matchRows(code: Code, info: Info | null, m: NodeOf<"match">): Row[] {
  const deeper = (binds: Id[], body: Id): NodeOf<"match"> | undefined => {
    const n = code.nodes[body];
    if (n.kind !== "match" || !plainMatch(code, info, n)) return undefined;
    const s = code.nodes[n.scrutinee];
    if (s.kind !== "ref" || !binds.includes(s.target)) return undefined;
    return [...n.arms, ...(n.otherwise ? [n.otherwise] : [])].some((x) => reads(code, x, [s.target])) ? undefined : n;
  };
  const rows = (pat: Pat, binds: Id[], body: Id, at: Id): Row[] => {
    const inner = deeper(binds, body);
    if (!inner) return [{ pat, binds, body, at }];
    const b = (code.nodes[inner.scrutinee] as NodeOf<"ref">).target;
    const rest = binds.filter((x) => x !== b);
    return [
      ...inner.arms.flatMap((a) => {
        const arm = code.nodes[a] as NodeOf<"arm">;
        return rows(put(pat, b, { con: arm.variant, args: arm.binds.map((x) => ({ v: x })) }), [...rest, ...arm.binds], arm.body, a);
      }),
      ...(inner.otherwise ? rows(put(pat, b, { any: true }), rest, inner.otherwise, inner.id) : []),
    ];
  };
  return m.arms.flatMap((a) => {
    const arm = code.nodes[a] as NodeOf<"arm">;
    return rows({ con: arm.variant, args: arm.binds.map((b) => ({ v: b })) }, arm.binds, arm.body, a);
  });
}

// Are these rows more than the match's own cases?
export const flattened = (rows: Row[]) => rows.some((r) => "con" in r.pat && r.pat.args.some((a) => !("v" in a)));

const hasAny = (p: Pat): boolean => "any" in p || ("con" in p && p.args.some(hasAny));

// What an expression says, without its ids: two copies of ‹bad line›(n)
// are the same.
export function shape(code: Code, root: Id): string {
  const ids = subtree(code, root), at = new Map(ids.map((x, i) => [x, i]));
  return JSON.stringify(ids.map((x) => JSON.stringify(code.nodes[x], (k, v) => (k === "id" ? undefined : typeof v === "string" && at.has(v) ? `#${at.get(v)}` : v))));
}

// Rows that give the same value, reading none of their own names, read
// once as the otherwise: the line too short, the line too long. Only when
// no row left has a _ that would catch them first.
export function sharedOtherwise(code: Code, all: Row[], otherwise?: Id): { rows: Row[]; otherwise?: Id; folded: Row[] } {
  const groups = new Map<string, Row[]>();
  for (const r of all) if (!reads(code, r.body, r.binds)) { const k = shape(code, r.body); groups.set(k, [...(groups.get(k) ?? []), r]); }
  const same = otherwise ? groups.get(shape(code, otherwise)) : [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length)[0];
  const kept = same ? all.filter((r) => !same.includes(r)) : all;
  if (!same || kept.some((r) => hasAny(r.pat))) return { rows: all, otherwise, folded: [] };
  return { rows: kept, otherwise: otherwise ?? same[0].body, folded: same };
}

// A list of two or more, or one that ends, reads as a list: [a, b],
// [a, b, ..rest]. Made of whatever the view draws names, cases and
// punctuation as: text here, selectable pieces in the blocks (render.ts).
export function patternWith<T>(p: Pat, name: (id: Id) => T, con: (id: Id) => T, punct: (s: string) => T): T[] {
  const commas = (ks: T[][]) => ks.flatMap((k, i) => (i ? [punct(", "), ...k] : k));
  const parts = (q: Pat): T[] => {
    if ("v" in q) return [name(q.v)];
    if ("any" in q) return [punct("_")];
    const items: Pat[] = [];
    let end: Pat = q;
    while ("con" in end && end.con === CONS) { items.push(end.args[0]); end = end.args[1]; }
    const ends = "con" in end && end.con === NIL;
    if (items.length && (ends || items.length > 1)) return [punct("["), ...commas([...items.map(parts), ...(ends ? [] : [[punct(".."), ...parts(end)]])]), punct("]")];
    return [con(q.con), ...(q.args.length ? [punct("("), ...commas(q.args.map(parts)), punct(")")] : [])];
  };
  return parts(p);
}

export const patternText = (p: Pat, name: (id: Id) => string, con: (id: Id) => string): string => patternWith(p, name, con, (s) => s).join("");

// Where a body the text draws once, as the otherwise, really is: one place
// per row it stands for, and the match's own otherwise if it has one.
export interface Place { parent: Id; slot: "body" | "otherwise"; binds: Id[] }
const inPlace = (code: Code, p: Place): Id | undefined => (code.nodes[p.parent] as { body?: Id; otherwise?: Id | null } | undefined)?.[p.slot] ?? undefined;

export function sharedPlaces(code: Code, info: Info | null, m: NodeOf<"match">): Place[] {
  const { folded } = sharedOtherwise(code, matchRows(code, info, m), m.otherwise ?? undefined);
  if (!folded.length) return [];
  const rows = folded.map((r): Place => ({ parent: r.at, slot: code.nodes[r.at].kind === "arm" ? "body" : "otherwise", binds: r.binds }));
  return m.otherwise ? [...rows, { parent: m.id, slot: "otherwise", binds: [] }] : rows;
}

// The copies are one row: an edit that changes one of them, leaving it
// reading none of its own names, is made to all of them (each a fresh
// copy of the edited one), in the same step. Gives back the copies' ids,
// from → to, so their names can go with them, and how many places changed.
export function sameEverywhere(before: Code, after: Code, info: Info | null): { code: Code; copied: [Id, Id][]; places: number } {
  const none = { code: after, copied: [], places: 0 };
  const changed = Object.keys(after.nodes).filter((id) => before.nodes[id] !== after.nodes[id]);
  if (!changed.length) return none;
  const up = new Map<Id, Id>();
  for (const n of Object.values(after.nodes)) for (const c of children(n)) up.set(c, n.id);
  const matches = new Set<Id>();
  for (const id of changed) for (let x: Id | undefined = id; x; x = up.get(x)) if (after.nodes[x].kind === "match" && before.nodes[x]?.kind === "match") matches.add(x);
  // A match drawn as rows of the one around it isn't drawn on its own.
  const was = new Map<Id, Id>();
  for (const n of Object.values(before.nodes)) for (const c of children(n)) was.set(c, n.id);
  const inner = new Set([...matches].flatMap((m) => matchRows(before, info, before.nodes[m] as NodeOf<"match">).map((r) => (before.nodes[r.at].kind === "arm" ? was.get(r.at)! : r.at)).filter((x) => x !== m)));
  let code = after, places = 0;
  const copied: [Id, Id][] = [];
  for (const m of matches) {
    if (inner.has(m)) continue;
    const ps = sharedPlaces(before, info, before.nodes[m] as NodeOf<"match">);
    if (ps.length < 2) continue;
    const old = shape(before, inPlace(before, ps[0])!);
    const now = ps.map((p) => inPlace(code, p));
    if (now.some((x) => !x)) continue;
    const edited = ps.filter((p, i) => shape(code, now[i]!) !== old);
    if (edited.length !== 1 || reads(code, inPlace(code, edited[0])!, edited[0].binds)) continue;
    const from = inPlace(code, edited[0])!, ids = subtree(code, from);
    const nodes = { ...code.nodes };
    for (const p of ps) {
      if (p === edited[0]) continue;
      const fresh = new Map(ids.map((x) => [x, freshId()]));
      for (const x of ids) { const c = mapIds(code.nodes[x], (y) => fresh.get(y) ?? y); nodes[c.id] = c; copied.push([x, c.id]); }
      for (const x of subtree(code, inPlace(code, p)!)) delete nodes[x];
      nodes[p.parent] = { ...nodes[p.parent], [p.slot]: fresh.get(from)! } as Node;
    }
    code = { nodes, defs: code.defs };
    places += ps.length;
  }
  return { code, copied, places };
}
