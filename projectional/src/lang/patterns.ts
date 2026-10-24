// Nested patterns, read back from nested matches (PATTERNS.md). The tree
// keeps one level per match; the text and the graph draw a chain of them
// as rows of patterns. A field a case's body matches on, and reads nowhere
// else, becomes that match's cases in its place; an inner otherwise is _
// there. The rows are the leaves of the decision tree, in its order.

import { subtree, type Code, type Id, type NodeOf } from "../model.ts";
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
// [a, b, ..rest].
export function patternText(p: Pat, name: (id: Id) => string, con: (id: Id) => string): string {
  const text = (q: Pat): string => {
    if ("v" in q) return name(q.v);
    if ("any" in q) return "_";
    const items: Pat[] = [];
    let end: Pat = q;
    while ("con" in end && end.con === CONS) { items.push(end.args[0]); end = end.args[1]; }
    const ends = "con" in end && end.con === NIL;
    if (items.length && (ends || items.length > 1)) return `[${[...items.map(text), ...(ends ? [] : [`..${text(end)}`])].join(", ")}]`;
    return q.args.length ? `${con(q.con)}(${q.args.map(text).join(", ")})` : con(q.con);
  };
  return text(p);
}
