// Termination by a value's spine (BACKLOG I84): the second order the
// termination check tries, when "is a piece of" can't see a recursion end.
//
// A value's spine is how many constructors it has along the fields of its
// own type: a list's length (plus one, for nil), a tree's node count. A
// case with no field of its own type has spine 1, so it is no longer than
// anything; a case with one such field is one longer than what is in it.
// That is a size every value has, whatever its type, and a piece taken
// apart at a field of the value's own type has a shorter one.
//
// The point is that a function's result can be said to be no longer than
// one of its inputs: Bounce's `bump into each(space, body, others)` gives
// back `(body, others')` with others' as long as others, since it rebuilds
// the list one cons per cons. `bump pairs` then recurs on others' and the
// call shrinks, which "is a piece of" can't say (others' isn't a piece of
// anything). This is a small case of sized types (Hughes, Pareto and Sabry,
// POPL 1996; Abel's MiniAgda), worked out per definition instead of
// written in its type: each definition's summary says, for its result and
// the fields of a record or tuple it returns, which inputs it is no longer
// than (or shorter than). A recursive definition's summary is the largest
// one its own body keeps (a greatest fixed point, from "as short as
// anything" down): a call that returns at all returns through the cases,
// so the summary holds by induction on the calls.
//
// The size-change check (Lee, Jones and Ben-Amram, 2001) then runs on
// these sizes as it runs on pieces in infer.ts.

import { isCall, isUse, type Code, type Id, type Node, type NodeOf } from "../model.ts";

// For each input i of the function being read, whether the value's spine
// is shorter than input i's (true) or no longer (false). `one`: the value
// has spine 1, so it is no longer than any input. `fields`: the case it is
// known to be, and each field's size.
// `top`: anything at all, where a recursive summary starts.
export interface Size { le: Map<number, boolean>; one?: boolean; of?: { variant: Id; fields: Size[] }; top?: boolean }
const NONE = (): Size => ({ le: new Map() });

export type Arc = [from: number, to: number, strict: boolean];
export interface CallGraph { from: Id; to: Id; arcs: Arc[] }

// Does every chain of calls that comes back to where it started have an
// input that strictly shrinks along it.
export function sizeChangeCloses(graphs: CallGraph[]): boolean {
  const norm = (from: Id, to: Id, arcs: Arc[]): CallGraph => {
    const best = new Map<string, Arc>();
    for (const [i, j, strict] of arcs) {
      const k = `${i},${j}`;
      best.set(k, [i, j, strict || (best.get(k)?.[2] ?? false)]);
    }
    return { from, to, arcs: [...best.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]) };
  };
  const key = (g: CallGraph) => `${g.from}\u0000${g.to}\u0000${g.arcs.map((a) => a.join(",")).join(";")}`;
  const compose = (g: CallGraph, h: CallGraph) =>
    norm(g.from, h.to, g.arcs.flatMap(([i, j, s1]) => h.arcs.filter(([k]) => k === j).map(([, l, s2]): Arc => [i, l, s1 || s2])));
  const all = new Map<string, CallGraph>();
  const todo = graphs.map((g) => norm(g.from, g.to, g.arcs));
  while (todo.length) {
    const g = todo.pop()!;
    if (all.has(key(g))) continue;
    all.set(key(g), g);
    for (const h of [...all.values()]) {
      if (g.to === h.from) todo.push(compose(g, h));
      if (h.to === g.from) todo.push(compose(h, g));
    }
  }
  return [...all.values()].every((g) => g.from !== g.to || key(compose(g, g)) !== key(g) || g.arcs.some(([i, j, strict]) => i === j && strict));
}

// Which fields of a case are of the case's own type.
const ownFields = new WeakMap<object, Map<Id, boolean[]>>();
function ownOf(code: Code, variant: Id): boolean[] | null {
  let m = ownFields.get(code.nodes);
  if (!m) {
    m = new Map();
    for (const n of Object.values(code.nodes)) {
      if (n.kind !== "def" || !n.body || code.nodes[n.body]?.kind !== "typedef") continue;
      for (const v of (code.nodes[n.body] as NodeOf<"typedef">).variants) {
        const vn = code.nodes[v];
        if (vn?.kind !== "variant") continue;
        m.set(v, vn.fields.map((f) => { const t = code.nodes[(code.nodes[f] as NodeOf<"field">)?.type]; return t?.kind === "tref" && t.target === n.id; }));
      }
    }
    ownFields.set(code.nodes, m);
  }
  return m.get(variant) ?? null;
}

// The size of a function's result in terms of its inputs, given each
// argument's size in the caller's.
function through(summary: Size, args: Size[]): Size {
  if (summary.top) return summary;
  const le = new Map<number, boolean>();
  for (const [k, st] of summary.le) args[k]?.le.forEach((st2, i) => le.set(i, (le.get(i) ?? false) || st || st2));
  return {
    le, ...(summary.one ? { one: true } : {}),
    ...(summary.of ? { of: { variant: summary.of.variant, fields: summary.of.fields.map((f) => through(f, args)) } } : {}),
  };
}

// What two cases' values both are.
function meet(a: Size, b: Size, n: number): Size {
  if (a.top) return b;
  if (b.top) return a;
  const at = (s: Size, i: number): boolean | undefined => s.le.has(i) ? s.le.get(i) : s.one ? false : undefined;
  const le = new Map<number, boolean>();
  for (let i = 0; i < n; i++) { const x = at(a, i), y = at(b, i); if (x !== undefined && y !== undefined) le.set(i, x && y); }
  const of = a.of && b.of && a.of.variant === b.of.variant ? { variant: a.of.variant, fields: a.of.fields.map((f, k) => meet(f, b.of!.fields[k], n)) } : undefined;
  return { le, ...(a.one && b.one ? { one: true } : {}), ...(of ? { of } : {}) };
}
const same = (a: Size, b: Size): boolean =>
  !!a.top === !!b.top && !!a.one === !!b.one && a.le.size === b.le.size && [...a.le].every(([i, s]) => b.le.get(i) === s)
  && (!a.of ? !b.of : !!b.of && a.of.variant === b.of.variant && a.of.fields.every((f, k) => same(f, b.of!.fields[k])));

// Reading a function's body for sizes. `self`: what a call to the
// definition being summarized gives (its summary so far); `onCall`: each
// call to a member of the group being checked, with its arguments' sizes.
interface Reader { code: Code; n: number; self?: { def: Id; size: Size }; group?: Set<Id>; onCall?: (to: Id, args: Size[]) => void; bad?: boolean }
function read(r: Reader, id: Id | undefined, env: Map<Id, Size>): Size {
  const node = id === undefined ? undefined : r.code.nodes[id];
  if (!node) return NONE();
  const { code } = r;
  if (node.kind === "ref") {
    if (r.group?.has(node.target)) r.bad = true;
    // A case with no fields, as nil, written without a call.
    const v = code.nodes[node.target];
    if (v?.kind === "variant" && !v.fields.length) return { le: new Map(), one: true, of: { variant: v.id, fields: [] } };
    return env.get(node.target) ?? NONE();
  }
  if (node.kind === "lambda") { read(r, node.body, env); return NONE(); }
  if (isUse(node)) {
    Object.values(node.given).forEach((g) => read(r, g, env));
    if (node.body !== undefined) read(r, node.body, env);
    return NONE();
  }
  if (isCall(node)) {
    const f = code.nodes[node.fn];
    if (f?.kind === "lambda") {
      const args = node.args.map((a) => read(r, a, env));
      const inner = new Map(env);
      f.params.forEach((p, i) => inner.set(p, args[i] ?? NONE()));
      return read(r, f.body, inner);
    }
    if (f?.kind === "ref" && r.group?.has(f.target)) {
      const args = node.args.map((a) => read(r, a, env));
      r.onCall?.(f.target, args);
      return NONE();
    }
    const args = node.args.map((a) => read(r, a, env));
    if (f?.kind !== "ref") { read(r, node.fn, env); return NONE(); }
    const target = code.nodes[f.target];
    if (target?.kind === "variant") {
      const own = ownOf(code, f.target);
      const of = { variant: f.target, fields: args };
      if (!own) return { le: new Map(), of };
      const rec = own.flatMap((o, k) => (o ? [k] : []));
      if (!rec.length) return { le: new Map(), one: true, of };
      if (rec.length > 1) return { le: new Map(), of };
      // One longer than its own field: no longer than what that field is
      // shorter than.
      const le = new Map<number, boolean>();
      if (args[rec[0]]?.top) for (let i = 0; i < r.n; i++) le.set(i, false);
      args[rec[0]]?.le.forEach((st, i) => { if (st) le.set(i, false); });
      return { le, of };
    }
    if (r.self && f.target === r.self.def) return through(r.self.size, args);
    if (target?.kind === "def") { const s = summary(code, f.target); return s ? through(s, args) : NONE(); }
    return NONE();
  }
  if (node.kind === "match" || node.kind === "fold") {
    const from = read(r, node.scrutinee, env);
    let out: Size | null = null;
    const add = (s: Size) => { out = out ? meet(out, s, r.n) : s; };
    for (const a of node.arms) {
      const arm = code.nodes[a] as NodeOf<"arm">;
      const inner = new Map(env);
      const own = ownOf(code, arm.variant);
      arm.binds.forEach((b, k) => {
        // A fold's binds at its own fields are what the fold gave for them.
        if (node.kind === "fold") return;
        if (from.top) { inner.set(b, from); return; }
        if (from.of && from.of.variant === arm.variant) { inner.set(b, from.of.fields[k] ?? NONE()); return; }
        if (own?.[k]) inner.set(b, { le: new Map([...from.le.keys()].map((i) => [i, true])) });
      });
      add(read(r, arm.body, inner));
    }
    if (node.kind === "match" && node.otherwise) add(read(r, node.otherwise, env));
    return out ?? NONE();
  }
  return NONE();
}

// A definition's summary: its result's size in its inputs'. null while it
// is being worked out (a call back to it from another definition knows
// nothing of it) or when it isn't a function.
const summaries = new WeakMap<object, Map<Id, Size | null>>();
// What is kept of a set of nodes changed in place (ports.ts filledFrom).
export const forgetSpine = (nodes: object) => { ownFields.delete(nodes); summaries.delete(nodes); };
const ROUNDS = 8;
function summary(code: Code, d: Id): Size | null {
  let memo = summaries.get(code.nodes);
  if (!memo) summaries.set(code.nodes, (memo = new Map()));
  if (memo.has(d)) return memo.get(d)!;
  memo.set(d, null);
  const def = code.nodes[d], lam = def?.kind === "def" && def.body ? code.nodes[def.body] : null;
  if (lam?.kind !== "lambda") return null;
  const n = lam.params.length;
  const env = new Map<Id, Size>(lam.params.map((p, i) => [p, { le: new Map([[i, false]]) }]));
  // From "as short as anything", down to what the body keeps.
  let size: Size | null = null;
  for (let round = 0; round < ROUNDS; round++) {
    const assumed: Size = size ?? { le: new Map(), top: true };
    const next = meet(read({ code, n, self: { def: d, size: assumed } }, lam.body, env), assumed, n);
    if (size && same(next, size)) break;
    size = next;
    if (round === ROUNDS - 1) size = NONE();
  }
  // A summary still at the top is of a function that never returns: true
  // of every call, but nothing to lean on.
  if (!size || size.top) size = NONE();
  memo.set(d, size);
  return size;
}

// The group ends by sizes: every call from a member to a member gives an
// arc from the caller's input i to the callee's input j when the argument
// is no longer (or shorter) than input i.
export function spineTerminates(code: Code, group: Id[], lambdaOf: (d: Id) => Node | null): boolean {
  const inGroup = new Set(group);
  const graphs: CallGraph[] = [];
  for (const d of group) {
    const lam = lambdaOf(d);
    if (lam?.kind !== "lambda") return false;
    const env = new Map<Id, Size>(lam.params.map((p, i) => [p, { le: new Map([[i, false]]) }]));
    const r: Reader = {
      code, n: lam.params.length, group: inGroup,
      onCall: (to, args) => graphs.push({ from: d, to, arcs: args.flatMap((s, j) => [...s.le].map(([i, st]): Arc => [i, j, st])) }),
    };
    read(r, lam.body, env);
    if (r.bad) return false;
  }
  return sizeChangeCloses(graphs);
}
