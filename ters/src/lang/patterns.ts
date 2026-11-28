// Nested patterns, read back from nested matches (PATTERNS.md). The tree
// keeps one level per match; the text and the graph draw a chain of them
// as rows of patterns. A field a case's body matches on, and reads nowhere
// else, becomes that match's cases in its place; an inner otherwise is _
// there. The rows are the leaves of the decision tree, in its order.

import { freshId, parentLookup, scanningOnLayer, mapIds, subtree, type Code, type Id, type Node, type NodeOf, copyNodes, dropNode, nodeIds } from "../model.ts";
import type { Info } from "./infer.ts";
import { CONS, FALSE, NIL, TRUE } from "./std.ts";

// `lit`: a value a match on values (L164c) takes, `text` how it reads:
// a field matched on by value inside a case, cons("-", rest).
// A name an inner otherwise reads is its row's for the field. `as`: a
// field taken apart that the row's body reads whole too, number(x) as a.
export type Pat = { v: Id } | { con: Id; args: Pat[] } | { lit: Id; text: string } | { any: true } | { as: Id; p: Pat };
// `at` is the node a row stands for: its leaf case, or the inner match
// whose otherwise it is.
// `copies`: the other cases this row stands for, each with a copy of its
// body, as an otherwise is kept (a case it reads whole, below).
export interface Row { pat: Pat; binds: Id[]; body: Id; at: Id; copies?: Id[] }

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

const put = (p: Pat, b: Id, q: Pat): Pat => ("v" in p ? (p.v === b ? q : p) : "con" in p ? { con: p.con, args: p.args.map((a) => put(a, b, q)) } : "as" in p ? { as: p.as, p: put(p.p, b, q) } : p);

function litPat(code: Code, id: Id): Pat {
  const n = code.nodes[id] as NodeOf<"lit">;
  return { lit: id, text: typeof n.value === "string" && n.of === undefined ? JSON.stringify(n.value) : String(n.value) };
}

// The rows of a match's cases (its own otherwise not included).
export function matchRows(code: Code, info: Info | null, m: NodeOf<"match">): Row[] {
  const deeper = (binds: Id[], body: Id): NodeOf<"match"> | undefined => {
    const n = code.nodes[body];
    if (n.kind !== "match" || !plainMatch(code, info, n)) return undefined;
    const s = code.nodes[n.scrutinee];
    if (s.kind !== "ref" || !binds.includes(s.target)) return undefined;
    // A case may read it too: its row names the field there with `as`, as
    // the otherwise's names it. Cases that read it whole and none of their
    // parts are an otherwise kept as copies, one row naming the field, when
    // they say the same (two or more, or the same as the otherwise); else,
    // cons(_, _) as tail only saying it isn't empty, the match reads better
    // kept.
    const ws = whole(n);
    if (!ws.length) return n;
    const k = shape(code, ws[0].body);
    return ws.every((a) => shape(code, a.body) === k) && (ws.length > 1 || (n.otherwise !== null && shape(code, n.otherwise) === k)) && (n.otherwise === null || shape(code, n.otherwise) === k) ? n : undefined;
  };
  const whole = (n: NodeOf<"match">): NodeOf<"arm">[] => {
    const b = (code.nodes[n.scrutinee] as NodeOf<"ref">).target;
    return n.arms.map((x) => code.nodes[x] as NodeOf<"arm">).filter((a) => !a.value && reads(code, a.body, [b]) && !reads(code, a.body, a.binds));
  };
  // A row names a field whole only where its own body reads it.
  const plain = (p: Pat, body: Id): Pat => ("as" in p ? (reads(code, body, [p.as]) ? { as: p.as, p: plain(p.p, body) } : plain(p.p, body)) : "con" in p ? { con: p.con, args: p.args.map((a) => plain(a, body)) } : p);
  const rows = (pat: Pat, binds: Id[], body: Id, at: Id): Row[] => {
    const inner = deeper(binds, body);
    if (!inner) return [{ pat: plain(pat, body), binds, body, at }];
    const b = (code.nodes[inner.scrutinee] as NodeOf<"ref">).target;
    const rest = binds.filter((x) => x !== b);
    const ws = whole(inner);
    // The copies read as one row, last, the field named; with the
    // otherwise, if there is one, among them.
    // Each copy says the same, so its rows are the first's, row for row:
    // each of those stands for its place in every copy.
    const each = [...ws.map((a) => rows(put(pat, b, { v: b }), binds, a.body, a.id)), ...(ws.length && inner.otherwise ? [rows(put(pat, b, { v: b }), binds, inner.otherwise, inner.id)] : [])];
    const copies: Row[] = each.length ? each[0].map((r, i) => ({ ...r, copies: [...(r.copies ?? []), ...each.slice(1).flatMap((c) => [c[i].at, ...(c[i].copies ?? [])])] })) : [];
    return [
      ...inner.arms.filter((a) => !ws.some((w) => w.id === a)).flatMap((a) => {
        const arm = code.nodes[a] as NodeOf<"arm">;
        const q: Pat = arm.value ? litPat(code, arm.value) : { con: arm.variant, args: arm.binds.map((x) => ({ v: x })) };
        const whole = reads(code, arm.body, [b]);
        return rows(put(pat, b, whole ? { as: b, p: q } : q), [...(whole ? binds : rest), ...arm.binds], arm.body, a);
      }),
      ...copies,
      ...(inner.otherwise && !ws.length ? (reads(code, inner.otherwise, [b]) ? rows(put(pat, b, { v: b }), binds, inner.otherwise, inner.id) : rows(put(pat, b, { any: true }), rest, inner.otherwise, inner.id)) : []),
    ];
  };
  return m.arms.flatMap((a) => {
    const arm = code.nodes[a] as NodeOf<"arm">;
    return rows({ con: arm.variant, args: arm.binds.map((b) => ({ v: b })) }, arm.binds, arm.body, a);
  });
}

// Are these rows more than the match's own cases?
export const flattened = (rows: Row[]) => rows.some((r) => "as" in r.pat || ("con" in r.pat && r.pat.args.some((a) => !("v" in a))));

// Could a value match both? Rows of one decision tree can't, but for a
// row that takes anything somewhere (an otherwise read as _ or a name).
const overlap = (p: Pat, q: Pat): boolean =>
  "as" in p ? overlap(p.p, q) : "as" in q ? overlap(p, q.p)
  : "any" in p || "v" in p || "any" in q || "v" in q ? true
  : "lit" in p || "lit" in q ? "lit" in p && "lit" in q && p.text === q.text
  : p.con === q.con && p.args.every((a, i) => overlap(a, q.args[i]));

// The values both take, as a pattern; null when none.
const meet = (p: Pat, q: Pat): Pat | null =>
  "as" in p ? meet(p.p, q) : "as" in q ? meet(p, q.p)
  : "any" in p || "v" in p ? q : "any" in q || "v" in q ? p
  : "lit" in p || "lit" in q ? ("lit" in p && "lit" in q && p.text === q.text ? p : null)
  : p.con !== q.con ? null
  : (() => { const args = p.args.map((a, i) => meet(a, q.args[i])); return args.every(Boolean) ? { con: p.con, args: args as Pat[] } : null; })();
// Does p take every value q does?
const takes = (p: Pat, q: Pat): boolean =>
  "as" in p ? takes(p.p, q) : "as" in q ? takes(p, q.p)
  : "any" in p || "v" in p ? true : "any" in q || "v" in q ? false
  : "lit" in p ? "lit" in q && p.text === q.text : "lit" in q ? false
  : p.con === q.con && p.args.every((a, i) => takes(a, q.args[i]));

// What an expression says, without its ids: two copies of ‹bad line›(n)
// are the same.
export function shape(code: Code, root: Id): string {
  const ids = subtree(code, root), at = new Map(ids.map((x, i) => [x, i]));
  return JSON.stringify(ids.map((x) => JSON.stringify(code.nodes[x], (k, v) => (k === "id" ? undefined : typeof v === "string" && at.has(v) ? `#${at.get(v)}` : v))));
}

// Rows that give the same value, reading none of their own names, read
// once as the otherwise: the line too short, the line too long. Only when
// no row left after one of them could catch it (a _ or a name where they
// differ), as it would once that one is read last.
export function sharedOtherwise(code: Code, all: Row[], otherwise?: Id): { rows: Row[]; otherwise?: Id; folded: Row[] } {
  const groups = new Map<string, Row[]>();
  // A fresh match, every case still a hole, shares nothing: each case has
  // its own row and its own hole to fill, as the graph draws it (E177).
  if (all.length && all.every((r) => code.nodes[r.body]?.kind === "hole")) return { rows: all, otherwise, folded: [] };
  // Without a stored otherwise, unfilled cases never fold together: each
  // keeps its own hole to fill, after the first case is filled and after
  // a shared value is cleared too (E189).
  const open = (r: Row) => !otherwise && code.nodes[r.body]?.kind === "hole";
  for (const r of all) if (!open(r) && !reads(code, r.body, r.binds)) { const k = shape(code, r.body); groups.set(k, [...(groups.get(k) ?? []), r]); }
  const same = otherwise ? groups.get(shape(code, otherwise)) : [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length)[0];
  const kept = same ? all.filter((r) => !same.includes(r)) : all;
  // What they share some kept row before already takes: add(into, a,
  // number(0)) after add(into, number(_), b) is fine with
  // add(into, number(x), number(y)) first.
  const caught = (k: Row, r: Row) => { const both = meet(k.pat, r.pat); return !!both && kept.slice(0, kept.indexOf(k)).some((j) => takes(j.pat, both)); };
  if (!same || kept.some((k) => same.some((r) => all.indexOf(r) < all.indexOf(k) && overlap(k.pat, r.pat) && !caught(k, r)))) return { rows: all, otherwise, folded: [] };
  return { rows: kept, otherwise: otherwise ?? same[0].body, folded: same };
}

// A list of two or more, or one that ends, reads as a list: [a, b],
// [a, b, ..rest]. Made of whatever the view draws names, cases and
// punctuation as: text here, selectable pieces in the blocks (render.ts).
// A value, "-", is `lit`'s, or else its text.
export function patternWith<T>(p: Pat, name: (id: Id) => T, con: (id: Id) => T, punct: (s: string) => T, lit?: (id: Id) => T[]): T[] {
  const commas = (ks: T[][]) => ks.flatMap((k, i) => (i ? [punct(", "), ...k] : k));
  const parts = (q: Pat): T[] => {
    if ("v" in q) return [name(q.v)];
    if ("any" in q) return [punct("_")];
    if ("lit" in q) return lit ? lit(q.lit) : [punct(q.text)];
    if ("as" in q) return [...parts(q.p), punct(" as "), name(q.as)];
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

// A row an otherwise's copies stand for (`copies`): each copy's place,
// with the case's own names, none of which they read.
export function copyPlaces(code: Code, info: Info | null, m: NodeOf<"match">): Place[][] {
  const place = (at: Id): Place => (code.nodes[at].kind === "arm" ? { parent: at, slot: "body", binds: (code.nodes[at] as NodeOf<"arm">).binds } : { parent: at, slot: "otherwise", binds: [] });
  return matchRows(code, info, m).filter((r) => r.copies?.length).map((r) => [place(r.at), ...r.copies!.map(place)]);
}

// The copies are one row: an edit that changes one of them, leaving it
// reading none of its own names, is made to all of them (each a fresh
// copy of the edited one), in the same step. Gives back the copies' ids,
// from → to, so their names can go with them, and how many places changed.
export function sameEverywhere(before: Code, after: Code, info: Info | null): { code: Code; copied: [Id, Id][]; places: number } {
  const none = { code: after, copied: [], places: 0 };
  const changed = nodeIds(after.nodes).filter((id) => before.nodes[id] !== after.nodes[id]);
  if (!changed.length) return none;
  // Each node's parent, from the library's parents found once where the
  // program is on it (T14h: two walks of every node at each edit).
  const parentsOf = (c: Code) => scanningOnLayer(c, () => parentLookup(c));
  const up = parentsOf(after);
  const matches = new Set<Id>();
  for (const id of changed) for (let x: Id | undefined = id; x; x = up(x)) if (after.nodes[x].kind === "match" && before.nodes[x]?.kind === "match") matches.add(x);
  if (!matches.size) return none;
  // A match drawn as rows of the one around it isn't drawn on its own.
  const was = parentsOf(before);
  const inner = new Set([...matches].flatMap((m) => matchRows(before, info, before.nodes[m] as NodeOf<"match">).map((r) => (before.nodes[r.at].kind === "arm" ? was(r.at)! : r.at)).filter((x) => x !== m)));
  let code = after, places = 0;
  const copied: [Id, Id][] = [];
  for (const m of matches) {
    if (inner.has(m)) continue;
    for (const ps of [sharedPlaces(before, info, before.nodes[m] as NodeOf<"match">), ...copyPlaces(before, info, before.nodes[m] as NodeOf<"match">)]) {
    if (ps.length < 2) continue;
    const old = shape(before, inPlace(before, ps[0])!);
    const now = ps.map((p) => inPlace(code, p));
    if (now.some((x) => !x)) continue;
    const edited = ps.filter((p, i) => shape(code, now[i]!) !== old);
    if (edited.length !== 1 || reads(code, inPlace(code, edited[0])!, edited[0].binds)) continue;
    // Nor names only the edited copy has, a case's around it inside the copy.
    const named = (p: Place) => { const out: Id[] = []; for (let x: Id | undefined = p.parent; x && x !== m; x = up(x)) { const n = code.nodes[x]; if (n?.kind === "arm") out.push(...n.binds); } return out; };
    const own = named(edited[0]);
    if (ps.some((p) => p !== edited[0] && reads(code, inPlace(code, edited[0])!, own.filter((b) => !named(p).includes(b))))) continue;
    const from = inPlace(code, edited[0])!, ids = subtree(code, from);
    const nodes = copyNodes(code.nodes);
    for (const p of ps) {
      if (p === edited[0]) continue;
      const fresh = new Map(ids.map((x) => [x, freshId()]));
      for (const x of ids) { const c = mapIds(code.nodes[x], (y) => fresh.get(y) ?? y); nodes[c.id] = c; copied.push([x, c.id]); }
      for (const x of subtree(code, inPlace(code, p)!)) dropNode(nodes, x);
      nodes[p.parent] = { ...nodes[p.parent], [p.slot]: fresh.get(from)! } as Node;
    }
    code = { nodes, defs: code.defs };
    places += ps.length;
    }
  }
  return { code, copied, places };
}
