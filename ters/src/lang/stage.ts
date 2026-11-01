// Calls with data known now, worked out now (C65, Ersagun 2026-10-31:
// "Clifford tables first"). A call of a definition given data the program
// writes down, such as an algebra's signature and basis,
// `clifford sandwich(clifford algebra([1, 1, 1, 0], pga basis), motor,
// point)`, is evaluated
// as far as that data goes: the table is built, the folds over it are
// unrolled, the matches on it are decided, and what is left is the
// arithmetic on the parts that are only known when the program runs. The
// call is replaced by that arithmetic. A product of two multivectors
// becomes one sum per part with no lists, so it runs in a shader, and a
// motor known now makes moving a point linear in the point, which
// linear.ts and the compilers (C30b/c) store as a matrix.
//
// Values while staging: a Float64 known now (a number), data whose parts
// may be known or not ({ k: "data" }), a Float64 known only later (`dyn`,
// the code that computes it), other literals, and functions. Data that
// arrives later must be a record of Float64s, read part by part, so a
// later value is only ever a Float64; anything that would branch on one
// (a comparison of later numbers, a match on a list given later) stops the
// staging, and the call stays as it was. Effects, Choice and ways stop it
// too. Arithmetic with 0 and 1 known now is simplified (0 · x is 0, x + 0
// is x), so a sum over a table's lines keeps only the lines that matter.
// For a later x that is ∞ or NaN, 0 · x is NaN, not 0; staging assumes
// finite numbers, as compilers' fast-math does.
//
// Prior art: partial evaluation (Futamura 1971; Jones, Gomard and Sestoft,
// "Partial Evaluation and Automatic Program Generation", 1993), here
// online and first order: static data is folded, dynamic Float64s become
// residual code. Specialising geometric-algebra products for a known
// signature is what code generators like Gaigen (Fontijne) and ganja.js
// do.

import type { Code, Id, Node, NodeData, NodeOf } from "../model.ts";
import { children, freshId, subtree } from "../model.ts";
import type { Names } from "../presentation.ts";
import { impl, type Op } from "../prelude.ts";
import { equal, type Value } from "./run.ts";
import { ARITH, FALSE, S, STD_IMPL, TRUE } from "./std.ts";
import { NUMBER, type Type } from "./types.ts";
import { infer, type Info } from "./infer.ts";
import { recordVariant } from "./derive.ts";

class Stop extends Error {}
const stop = (): never => { throw new Stop(); };
// Running out of stack is running out of patience too.
const stopped = (e: unknown) => e instanceof Stop || e instanceof RangeError;

type Dyn = { k: "dyn"; make: () => Id; cheap: boolean; op?: Op; args?: PV[] };
type PV =
  | number
  | { k: "data"; tag: Id; fields: PV[] }
  | { k: "lit"; node: NodeOf<"lit"> }
  | Dyn
  | { k: "clo"; lambda: NodeOf<"lambda">; env: Map<Id, PV> }
  | { k: "ref"; target: Id };

const ARITH_B: Record<Id, Op> = { [ARITH.add]: "add", [ARITH.sub]: "sub", [ARITH.mul]: "mul", [ARITH.neg]: "neg" };
const LIMIT = 400_000, NODES = 40_000, LETS = 800;

// Calls worth staging: a definition given, as some argument, data written
// down that has a list in it (a table, a signature, a basis). Each is
// replaced by what is left of it. The program is checked again by the
// caller; staged is empty when nothing changed.
// `rounded`: the staged calls that worked out a number Float32 can't hold,
// so a Float32 run of the same program rounds it differently.
export function stageCalls(code: Code, info: Info, names: Names, only?: Id[], copied: Set<Id> = new Set()): { code: Code; names: Names; staged: Id[]; rounded: Id[] } {
  const nodes = code.nodes;
  const staged: Id[] = [], rounded: Id[] = [];
  const out: Code = { nodes: { ...nodes }, defs: [...code.defs] };
  const outNames: Names = { ...names };
  const ty = (id: Id) => info.subst.zonk(info.typeOf.get(id) ?? { t: "var", v: -1 });
  const defValues = new Map<Id, PV | null>();
  const lists = new Set<Id>(), effectOps = new Set<Id>();
  for (const n of Object.values(nodes)) if (n.kind === "typedef" && n.effect) n.variants.forEach((v) => effectOps.add(v));
  // Recursive data (a list, a tree): what a table or a basis is written as.
  for (const d of code.defs) {
    const t = nodes[(nodes[d] as NodeOf<"def">)?.body ?? ""];
    if (t?.kind !== "typedef" || t.effect) continue;
    const refers = (ty: Id): boolean => { const x = nodes[ty]; return x?.kind === "tref" && (x.target === d || x.args.some(refers)); };
    if (t.variants.some((v) => (nodes[v] as NodeOf<"variant">).fields.some((f) => refers((nodes[f] as NodeOf<"field">).type)))) t.variants.forEach((v) => lists.add(v));
  }
  const closedMemo = new Map<Id, PV | null>();
  const ctx: Ctx = { code: out, names: outNames, defValues, effectOps, ty };

  const shape = shapeOf(code, info);

  for (const id of only ?? Object.keys(nodes)) {
    const n = nodes[id];
    if (n?.kind !== "call") continue;
    const f = nodes[n.fn];
    if (f?.kind !== "ref" || nodes[f.target]?.kind !== "def") continue;
    const def = nodes[f.target] as NodeOf<"def">;
    if (def.way || !def.body || nodes[def.body]?.kind !== "lambda") continue;
    if (!shape(id)) continue;
    // Which arguments are known now: closed, and worked out (once each).
    const known = n.args.map((a) => {
      if (!closedMemo.has(a)) {
        try { closedMemo.set(a, new Stager(ctx, LIMIT).closed(a)); } catch (e) { if (!stopped(e)) throw e; closedMemo.set(a, null); }
      }
      return closedMemo.get(a)!;
    });
    // Worth it when one of them is data with a list in it, or the
    // definition is a copy with such data in it (specialiseCalls).
    if (!copied.has(f.target) && !known.some((v) => v !== null && hasList(v, lists))) continue;
    if (!n.args.every((a, i) => known[i] || shape(a))) continue;
    try {
      const st = new Stager(ctx, LIMIT);
      // An argument given later is worked out too, its variables (Float64s
      // and records of them) read where they are, so `to pga(p)` is seen
      // to be mostly zeros; when it can't be, it is named once.
      st.free = (ref, b) => { const sh = shape(ref); return sh ? st.later(b, sh) : stop(); };
      const binders: (Id | null)[] = [];
      const args = n.args.map((a, i) => {
        if (known[i]) { binders.push(null); return known[i]!; }
        const mark = st.lets.length;
        try { const v = st.ev(a, new Map()); binders.push(null); return v; } catch (e) { if (!stopped(e)) throw e; st.lets.length = mark; }
        const b = st.binder(`staged ${i}`);
        binders.push(b);
        return st.later(b, shape(a)!);
      });
      const result = st.apply(st.defValue(f.target), args);
      const body = st.wrap(st.residual(result));
      // Each let nests one level; the compilers walk them recursively.
      if (st.made > NODES || st.lets.length > LETS) stop();
      const kept = binders.flatMap((b, i) => (b ? [{ b, a: n.args[i] }] : []));
      const root: NodeData = kept.length
        ? { kind: "call", fn: st.add({ kind: "lambda", params: kept.map((x) => x.b), body }), args: kept.map((x) => x.a) }
        : (() => { const r = out.nodes[body]; return { ...r } as NodeData; })();
      out.nodes[id] = { ...root, id } as Node;
      staged.push(id);
      if (st.rounded) rounded.push(id);
    } catch (e) {
      if (!stopped(e)) throw e;
      // Leave the call; its stray new nodes are unreachable.
    }
  }
  return staged.length ? { code: out, names: outNames, staged, rounded } : { code, names, staged, rounded };
}

// Both passes, checked again after each, kept only while the program
// still checks: calls given their data worked out (stageCalls), then
// copies for data known at a call (specialiseCalls), and the calls inside
// those copies worked out in turn. `rounded` as stageCalls's.
export function stageProgram(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names; rounded: Id[] } {
  // A check again is a plain one (no pins), so it is measured against the
  // program as it came, checked the same way: a pinned generic definition
  // such as the prelude's `sum` can check worse plainly than it did under
  // its pin, and that is not the staging's doing (I121).
  const asCame = code, initial = info.errors.length;
  let base: number | null = null;
  const before = () => {
    if (base === null) { try { base = Math.max(initial, infer(asCame, names).errors.length); } catch { base = initial; } }
    return base;
  };
  // The last state that checked, and what is pending on top of it.
  let good = { code, names, info, rounded: [] as Id[] };
  let pending: Id[] | null = null;
  // Nodes made here that nothing reaches any more (calls staged a second
  // time, attempts that stopped) are dropped before each check.
  const given = new Set(Object.keys(code.nodes));
  // What calls given a copy were, kept while they may go back.
  let keep: Id[] = [];
  const prune = () => {
    const seen = new Set<Id>();
    const walk = (id: Id) => { if (seen.has(id) || !code.nodes[id]) return; seen.add(id); for (const c of children(code.nodes[id])) walk(c); };
    code.defs.forEach(walk);
    given.forEach(walk);
    keep.forEach(walk);
    const nodes: Code["nodes"] = {};
    for (const [id, n] of Object.entries(code.nodes)) if (seen.has(id)) nodes[id] = n;
    code = { nodes, defs: code.defs };
  };
  const check = (): boolean => {
    prune();
    // (Too deep to check, as a very long chain of lets can be: kept out.)
    let again: Info | null = null;
    try { again = infer(code, names); } catch (e) { if (!(e instanceof RangeError)) throw e; }
    if (!again || (again.errors.length > initial && again.errors.length > before())) { ({ code, names, info } = good); pending = null; return false; }
    info = again;
    good = { code, names, info, rounded: [...good.rounded, ...(pending ?? [])] };
    pending = null;
    return true;
  };
  const copied = new Set<Id>();
  const staged = new Set<Id>();
  const stage = (only?: Id[]) => {
    const st = stageCalls(code, info, names, only, copied);
    st.staged.forEach((id) => staged.add(id));
    if (!st.staged.length) return;
    ({ code, names } = st);
    pending = [...(pending ?? []), ...st.rounded];
  };
  stage();
  // Copies for the calls given data, and for the calls inside them given it
  // in turn, then checked (their calls need types) and their calls worked
  // out; the program is checked once more at the end.
  const calls = Object.keys(code.nodes).filter((id) => code.nodes[id].kind === "call");
  const copies = specialiseCalls(code, info, names, calls);
  if (copies.copies.length) {
    ({ code, names } = copies);
    copies.copies.forEach((c) => copied.add(c));
    keep = copies.sites.flatMap(([, n]) => children(n));
    if (check()) {
      stage(copies.inner.filter((id) => code.nodes[id]?.kind === "call"));
      // A copy is kept only where it paid: some call in it worked out, or
      // it calls a copy that did. Other calls go back to the definition.
      const paid = new Set(copies.copies.filter((c) => subtree(code, c).some((id) => staged.has(id))));
      for (let more = true; more;) {
        more = false;
        for (const [, , c, at] of copies.sites) if (at && !paid.has(at) && paid.has(c)) { paid.add(at); more = true; }
      }
      const back = copies.sites.filter(([id, , c]) => !paid.has(c) && !staged.has(id));
      if (back.length) {
        const unpaid = new Set(copies.copies.filter((c) => !paid.has(c)).flatMap((c) => [c, ...(copies.holders.get(c) ?? [])]));
        code = { nodes: { ...code.nodes }, defs: code.defs.filter((d) => !unpaid.has(d)) };
        for (const [id, n] of back) code.nodes[id] = n;
        pending = pending ?? [];
      }
      keep = [];
    }
  }
  if (pending) check();
  return { code: good.code, info: good.info, names: good.names, rounded: good.rounded };
}

// Copies of definitions for data known at their call (I86): a call
// `step(solid, bodies)` of a definition given, as some argument, data
// written down that has a list in it (`solid`, a Space with its algebra) is
// a call of `step at solid`, a copy of step with that parameter replaced by
// the data, and so on for what step passes it to. Inside the copies the
// algebra is written down again, so stageCalls works their Clifford calls
// out. One copy per definition and data; a copy calling itself with the
// same data calls the copy. Generic code keeps its one source, and each
// world it is used in gets its own compiled copy, as C++ templates and
// MLton's whole-program specialisation do (prior art).
export function specialiseCalls(code: Code, info: Info, names: Names, calls: Id[]): { code: Code; names: Names; copies: Id[]; inner: Id[]; sites: [Id, Node, Id, Id | null][]; holders: Map<Id, Id[]> } {
  const out: Code = { nodes: { ...code.nodes }, defs: [...code.defs] };
  const outNames: Names = { ...names };
  const nodes = out.nodes;
  const lists = recursiveVariants(code);
  // A copy's nodes have the types of the nodes they were copied from, for
  // telling its Float64 literals apart before the program is checked again.
  const origin = new Map<Id, Id>();
  const ty = (id: Id) => info.subst.zonk(info.typeOf.get(origin.get(id) ?? id) ?? { t: "var", v: -1 });
  const ctx: Ctx = { code: out, names: outNames, defValues: new Map(), effectOps: new Set(), ty };
  for (const n of Object.values(nodes)) if (n.kind === "typedef" && n.effect) n.variants.forEach((v) => ctx.effectOps.add(v));
  // Data arguments are told apart by what they are made of.
  const known = (a: Id): string | null => {
    if (!closedTree(out, a)) return null;
    try {
      const v = new Stager(ctx, LIMIT).closed(a);
      if (!plainData(v) || !numbersIn(v, lists)) return null;
      return hasList(v, lists) ? JSON.stringify(v, (_, x) => (x && typeof x === "object" && x.k === "lit" ? { lit: String(x.node.value), of: x.node.of } : x)) : null;
    } catch (e) { if (stopped(e)) return null; throw e; }
  };
  const copies = new Map<string, Id>(), perDef = new Map<Id, number>();
  const made: Id[] = [];
  const add = (n: NodeData): Id => { const id = freshId(); nodes[id] = { id, ...n } as Node; return id; };
  const whole = (count: number, keys: (string | null)[]) => count > 0 && keys.every((k) => k);
  const pure = (fn: Id) => { const t = ty(fn); return t.t === "fn" && t.eff.effs.length === 0; };
  const inner: Id[] = [];
  // Each call made a call of a copy: what it was, the copy, and the copy
  // it is in (null at the top).
  const sites: [Id, Node, Id, Id | null][] = [];
  const within = new Map<Id, Id>(), holdersOf = new Map<Id, Id[]>();
  const todo = [...calls];
  while (todo.length) {
    const id = todo.pop()!;
    const n = nodes[id];
    if (n?.kind !== "call") continue;
    const f = nodes[n.fn];
    if (f?.kind !== "ref" || nodes[f.target]?.kind !== "def") continue;
    const def = nodes[f.target] as NodeOf<"def">;
    const lam = def.body ? nodes[def.body] : null;
    if (def.way || def.results || lam?.kind !== "lambda" || lam.params.length !== n.args.length) continue;
    const keys = n.args.map(known);
    if (!keys.some((k) => k)) continue;
    // (Calls stageCalls could work out whole are gone by now; those it
    // couldn't, such as clifford exp, which branches on its argument, get
    // a copy whose inner products it can.)
    const key = `${f.target} ${JSON.stringify(keys)}`;
    let copy = copies.get(key);
    if (!copy) {
      // A few copies per definition: one per world it is used in, not one
      // per step of a recursion that changes the data it passes on.
      const per = (perDef.get(f.target) ?? 0) + 1;
      if (copies.size >= 200 || per > 6) continue;
      perDef.set(f.target, per);
      // The data each fixed parameter stands for: the definition it names,
      // or a new one holding it.
      const fixed = new Map<Id, Id>(), newHolders: Id[] = [];
      n.args.forEach((a, i) => {
        if (!keys[i]) return;
        const arg = nodes[a];
        let holder = arg.kind === "ref" && nodes[arg.target]?.kind === "def" ? arg.target : null;
        if (!holder) {
          holder = add({ kind: "def", body: copyTree(out, outNames, a, new Map(), new Map(), origin) });
          out.defs.push(holder);
          newHolders.push(holder);
          outNames[holder] = `${names[f.target] ?? "it"}'s ${names[lam.params[i]] ?? "data"}`;
        }
        fixed.set(lam.params[i], holder);
      });
      copy = add({ kind: "def", body: null });
      copies.set(key, copy);
      holdersOf.set(copy, newHolders);
      const holders = [...fixed.values()].map((h) => outNames[h] ?? "").filter((x) => x);
      outNames[copy] = `${names[f.target] ?? "it"} at ${holders.join(", ")}`;
      // The body, with refs to the fixed parameters made refs to the data.
      // The parameters left are copied with the body.
      const map = new Map<Id, Id>(lam.params.filter((p) => !fixed.has(p)).map((p) => [p, freshId()]));
      const body = copyTree(out, outNames, lam.body, map, fixed, origin);
      // Given all its data, a definition with no effects is a value, worked
      // out once (a Clifford table), not a function of nothing.
      (nodes[copy] as NodeOf<"def">).body = whole(n.args.length, keys) && pure(lam.id) ? body : add({ kind: "lambda", params: lam.params.filter((p) => !fixed.has(p)).map((p) => map.get(p)!), body });
      out.defs.push(copy);
      made.push(copy);
      // The copy's own calls may be given the data too.
      for (const c of subtree(out, body)) if (nodes[c].kind === "call") { inner.push(c); todo.push(c); within.set(c, copy); }
    }
    sites.push([id, n, copy, within.get(id) ?? null]);
    nodes[id] = nodes[copy].kind === "def" && nodes[(nodes[copy] as NodeOf<"def">).body!]?.kind !== "lambda" && whole(n.args.length, keys)
      ? { id, kind: "ref", target: copy }
      : { id, kind: "call", fn: add({ kind: "ref", target: copy }), args: n.args.filter((_, i) => !keys[i]) };
  }
  return made.length ? { code: out, names: outNames, copies: made, inner, sites, holders: holdersOf } : { code, names, copies: [], inner: [], sites: [], holders: holdersOf };
}

// The only case of a record type.
function oneCase(code: Code, variant: Id): boolean {
  return Object.values(code.nodes).some((n) => n.kind === "typedef" && !n.effect && n.variants.length === 1 && n.variants[0] === variant);
}
// No variable from outside the tree at root.
function closedTree(code: Code, root: Id, fixed: Map<Id, Id> = new Map()): boolean {
  const ids = subtree(code, root), bound = new Set<Id>();
  for (const id of ids) {
    const n = code.nodes[id];
    if (n.kind === "lambda") n.params.forEach((p) => bound.add(p));
    if (n.kind === "arm") [...n.binds, ...n.results].forEach((p) => p && bound.add(p));
    if (n.kind === "solve") Object.values(n.binds).forEach((p) => bound.add(p));
  }
  return ids.every((id) => { const n = code.nodes[id]; return n.kind !== "ref" || code.nodes[n.target]?.kind !== "binder" || bound.has(n.target) || fixed.has(n.target); });
}
// Data all the way down, no functions in it.
function plainData(v: PV): boolean {
  return typeof v === "number" || v.k === "lit" || (v.k === "data" && v.fields.every(plainData));
}
// A list with numbers in it, such as an algebra's signature or basis
// (an HTML element's children aren't worth a copy).
function numbersIn(v: PV, lists: Set<Id>, inList = false): boolean {
  if (typeof v === "number") return inList;
  return v.k === "data" && v.fields.some((f) => numbersIn(f, lists, inList || lists.has(v.tag)));
}
// A copy of the tree at root with fresh ids; refs to a binder inside it
// point at the copy, and refs to a `fixed` binder at that definition.
function copyTree(code: Code, names: Names, root: Id, map: Map<Id, Id>, fixed = new Map<Id, Id>(), origin = new Map<Id, Id>()): Id {
  const ids = subtree(code, root);
  for (const id of ids) map.set(id, freshId());
  // Binders are reached through their binding nodes' fields, not children.
  for (const id of ids) {
    const n = code.nodes[id];
    const bound = n.kind === "lambda" ? n.params : n.kind === "arm" ? [...n.binds, ...n.results.filter((r): r is Id => !!r)] : n.kind === "solve" ? Object.values(n.binds) : [];
    for (const b of bound) if (!map.has(b)) map.set(b, freshId());
  }
  const re = (x: Id) => map.get(x) ?? x;
  // A record a fixed parameter holds, taken apart by a match: its parts
  // are that definition's parts, read where they are used, so a call given
  // them is given data written down too.
  const parts = new Map<Id, { field: Id; holder: Id }>();
  for (const id of ids) {
    const n = code.nodes[id];
    if (n.kind !== "match") continue;
    const s = code.nodes[n.scrutinee];
    if (s?.kind !== "ref" || !fixed.has(s.target)) continue;
    for (const a of n.arms) {
      const arm = code.nodes[a] as NodeOf<"arm">;
      const variant = code.nodes[arm.variant] as NodeOf<"variant">;
      if (!oneCase(code, arm.variant)) continue;
      arm.binds.forEach((b, i) => parts.set(b, { field: variant.fields[i], holder: fixed.get(s.target)! }));
    }
  }
  // A let of something known now (`table = clifford table(squares,
  // basis)` with squares and basis fixed) is read where it is used, so a
  // call given it is given data written down too.
  const known = new Map<Id, Id>();
  for (const id of ids) {
    const n = code.nodes[id];
    const lam = n.kind === "call" ? code.nodes[n.fn] : null;
    if (n.kind === "call" && lam?.kind === "lambda" && lam.params.length === 1 && n.args.length === 1 && closedTree(code, n.args[0], fixed)) known.set(lam.params[0], n.args[0]);
  }
  for (const [old, fresh] of map) {
    const n = code.nodes[old];
    if (!n) continue;
    let c: Node;
    const part = n.kind === "ref" ? parts.get(n.target) : undefined;
    const value = n.kind === "ref" ? known.get(n.target) : undefined;
    if (value) {
      const root = copyTree(code, names, value, new Map(), fixed, origin);
      code.nodes[fresh] = { ...code.nodes[root], id: fresh } as Node;
      continue;
    }
    if (part) {
      const at = (target: Id) => { const id = freshId(); code.nodes[id] = { id, kind: "ref", target }; return id; };
      c = { id: fresh, kind: "call", fn: at(part.field), args: [at(part.holder)] };
    } else if (n.kind === "ref") c = fixed.has(n.target) ? { id: fresh, kind: "ref", target: fixed.get(n.target)! } : { ...n, id: fresh, target: re(n.target) };
    else c = JSON.parse(JSON.stringify(n), (k, v) => (k === "" ? v : typeof v === "string" && map.has(v) && k !== "kind" && k !== "op" && k !== "variant" ? map.get(v) : v)) as Node;
    c.id = fresh;
    code.nodes[fresh] = c;
    origin.set(fresh, origin.get(old) ?? old);
    if (names[old] !== undefined) names[fresh] = names[old];
  }
  return map.get(root)!;
}

function recursiveVariants(code: Code): Set<Id> {
  const nodes = code.nodes, lists = new Set<Id>();
  for (const d of code.defs) {
    const t = nodes[(nodes[d] as NodeOf<"def">)?.body ?? ""];
    if (t?.kind !== "typedef" || t.effect) continue;
    const refers = (ty: Id): boolean => { const x = nodes[ty]; return x?.kind === "tref" && (x.target === d || x.args.some(refers)); };
    if (t.variants.some((v) => (nodes[v] as NodeOf<"variant">).fields.some((f) => refers((nodes[f] as NodeOf<"field">).type)))) t.variants.forEach((v) => lists.add(v));
  }
  return lists;
}

// A record of Float64s by its type, or "number" for a Float64; null for
// anything else.
function shapeOf(code: Code, info: Info): (id: Id) => Id | "number" | null {
  const nodes = code.nodes;
  return (id) => {
    const t = info.subst.zonk(info.typeOf.get(id) ?? { t: "var", v: -1 });
    if (t.t !== "con") return null;
    if (t.id === NUMBER) return "number";
    if (t.args.length) return null;
    const v = recordVariant(code, t.id);
    if (!v) return null;
    const ok = (nodes[v] as NodeOf<"variant">).fields.every((f) => {
      const ft = nodes[(nodes[f] as NodeOf<"field">).type];
      return ft?.kind === "tref" && ft.target === NUMBER && !ft.args.length;
    });
    return ok ? v : null;
  };
}

function hasList(v: PV, lists: Set<Id>): boolean {
  return typeof v === "object" && v.k === "data" && (lists.has(v.tag) || v.fields.some((f) => hasList(f, lists)));
}

interface Ctx { code: Code; names: Names; defValues: Map<Id, PV | null>; effectOps: Set<Id>; ty: (id: Id) => Type }

class Stager {
  steps = 0;
  depth = 0;
  lets: { b: Id; value: Id }[] = [];
  rounded = false;
  // A variable from around the call, read where it is (null: none allowed).
  free: ((ref: Id, binder: Id) => PV) | null = null;
  code: Code;
  names: Names;
  defValues: Map<Id, PV | null>;
  ctx: Ctx;
  limit: number;
  constructor(ctx: Ctx, limit: number) {
    this.ctx = ctx; this.limit = limit;
    this.code = ctx.code; this.names = ctx.names; this.defValues = ctx.defValues;
  }

  made = 0;
  add(n: NodeData): Id {
    const id = freshId();
    this.made++;
    this.code.nodes[id] = { id, ...n } as Node;
    return id;
  }
  binder(name: string): Id {
    const id = this.add({ kind: "binder" });
    this.names[id] = name;
    return id;
  }
  ref(target: Id) { return this.add({ kind: "ref", target }); }

  // A value given later: a Float64, or a record of them read part by part.
  later(b: Id, shape: Id | "number"): PV {
    if (shape === "number") return { k: "dyn", make: () => this.ref(b), cheap: true };
    const fields = (this.code.nodes[shape] as NodeOf<"variant">).fields;
    return { k: "data", tag: shape, fields: fields.map((f) => ({ k: "dyn", make: () => this.add({ kind: "call", fn: this.ref(f), args: [this.ref(b)] }), cheap: true }) as Dyn) };
  }

  // An expression with no variables, known now; Stop otherwise.
  closed(id: Id): PV {
    const v = this.ev(id, new Map());
    if (later(v)) stop();
    return v;
  }

  // Residual code for a value; the lets made on the way wrap it (wrap).
  residual(v: PV): Id {
    if (typeof v === "number") return this.add({ kind: "lit", value: v, of: NUMBER });
    switch (v.k) {
      case "dyn": return v.make();
      case "lit": { const { id: _, ...rest } = v.node; return this.add(rest); }
      case "data": {
        const variant = this.code.nodes[v.tag] as NodeOf<"variant">;
        return variant.fields.length ? this.add({ kind: "call", fn: this.ref(v.tag), args: v.fields.map((f) => this.residual(f)) }) : this.ref(v.tag);
      }
      default: return stop();
    }
  }
  wrap(body: Id): Id {
    this.inlineSingleUse(body);
    for (let i = this.lets.length - 1; i >= 0; i--) {
      const { b, value } = this.lets[i];
      body = this.add({ kind: "call", fn: this.add({ kind: "lambda", params: [b], body }), args: [value] });
    }
    return body;
  }
  // A let read once is put where it's read (I96): each let nests one
  // level, and a sandwich in PGA named over a thousand parts, past what
  // the checker and compilers walk (LETS), most of them read once. The
  // values are arithmetic with nothing to run twice or out of order.
  inlineSingleUse(body: Id) {
    const uses = new Map<Id, Id[]>();
    const lets = new Set(this.lets.map((l) => l.b));
    for (const root of [body, ...this.lets.map((l) => l.value)]) {
      for (const id of subtree(this.code, root)) {
        const n = this.code.nodes[id];
        if (n.kind === "ref" && lets.has(n.target)) uses.set(n.target, [...(uses.get(n.target) ?? []), id]);
      }
    }
    const values = new Map(this.lets.map((l) => [l.b, l.value] as const));
    // From the last let back, so a value put in place carries the lets
    // put into it before.
    for (let i = this.lets.length - 1; i >= 0; i--) {
      const { b, value } = this.lets[i];
      const at = uses.get(b) ?? [];
      if (at.length !== 1) continue;
      this.code.nodes[at[0]] = { ...this.code.nodes[value], id: at[0] } as Node;
      values.delete(b);
    }
    this.lets = this.lets.filter((l) => values.has(l.b));
  }
  // A value bound to a name: a later Float64 that costs something is
  // computed once, into a let.
  bind(v: PV): PV {
    if (typeof v !== "object") return v;
    if (v.k === "data") return v.fields.some((f) => typeof f === "object" && f.k === "dyn" && !f.cheap) ? { ...v, fields: v.fields.map((f) => this.bind(f)) } : v;
    if (v.k !== "dyn" || v.cheap) return v;
    const b = this.binder("part");
    this.lets.push({ b, value: v.make() });
    return { k: "dyn", make: () => this.ref(b), cheap: true };
  }

  tick() { if (++this.steps > this.limit) stop(); }

  ev(id: Id, env: Map<Id, PV>): PV {
    this.tick();
    const n = this.code.nodes[id];
    if (!n) return stop();
    switch (n.kind) {
      case "lit":
        // A plain number literal is a Float64 only where it was checked as one.
        if (typeof n.value === "number" && !n.unit && (n.of === NUMBER || (n.of === undefined && isNumber(this.ctx.ty(id))))) return n.value;
        return { k: "lit", node: n };
      case "lambda": return { k: "clo", lambda: n, env };
      case "ref": {
        if (env.has(n.target)) return env.get(n.target)!;
        const t = this.code.nodes[n.target];
        if (!t) return stop();
        if (t.kind === "variant" && !t.fields.length) return { k: "data", tag: n.target, fields: [] };
        if (t.kind === "def") return this.defValue(n.target);
        if (t.kind === "binder") return this.free ? this.free(id, n.target) : stop();
        return { k: "ref", target: n.target };
      }
      case "call": return this.apply(this.ev(n.fn, env), n.args.map((a) => this.ev(a, env)));
      case "match": {
        const s = this.ev(n.scrutinee, env);
        if (typeof s !== "object" || s.k !== "data") return stop();
        const arm = n.arms.map((a) => this.code.nodes[a] as NodeOf<"arm">).find((a) => a.variant === s.tag);
        if (!arm) return n.otherwise ? this.ev(n.otherwise, env) : stop();
        const inner = new Map(env);
        arm.binds.forEach((b, i) => inner.set(b, this.bind(s.fields[i])));
        return this.ev(arm.body, inner);
      }
      case "fold": return this.fold(n, this.ev(n.scrutinee, env), env);
      default: return stop();
    }
  }

  fold(n: NodeOf<"fold">, s: PV, env: Map<Id, PV>): PV {
    if (typeof s !== "object" || s.k !== "data") return stop();
    if (++this.depth > 600) stop();
    const arm = n.arms.map((a) => this.code.nodes[a] as NodeOf<"arm">).find((a) => a.variant === s.tag);
    if (!arm) return stop();
    const inner = new Map(env);
    arm.binds.forEach((b, i) => inner.set(b, this.bind(s.fields[i])));
    arm.results.forEach((r, i) => { if (r) inner.set(r, this.bind(this.fold(n, s.fields[i], env))); });
    const out = this.ev(arm.body, inner);
    this.depth--;
    return out;
  }

  defValue(def: Id): PV {
    if (this.defValues.has(def)) { const v = this.defValues.get(def); return v ?? stop(); }
    const d = this.code.nodes[def] as NodeOf<"def">;
    if (!d.body || d.way) { this.defValues.set(def, null); return stop(); }
    const body = this.code.nodes[d.body];
    if (body.kind === "typedef") return stop();
    // A function is a closure; a constant is worked out once, if it can be.
    if (body.kind === "lambda") { const v: PV = { k: "clo", lambda: body, env: new Map() }; this.defValues.set(def, v); return v; }
    this.defValues.set(def, null);
    const v = this.ev(d.body, new Map());
    if (later(v)) return stop();
    this.defValues.set(def, v);
    return v;
  }

  apply(f: PV, args: PV[]): PV {
    this.tick();
    if (typeof f !== "object") return stop();
    if (f.k === "clo") {
      if (f.lambda.params.length !== args.length) return stop();
      if (++this.depth > 600) stop();
      const env = new Map(f.env);
      f.lambda.params.forEach((p, i) => env.set(p, this.bind(args[i])));
      const out = this.ev(f.lambda.body, env);
      this.depth--;
      return out;
    }
    if (f.k !== "ref") return stop();
    const t = this.code.nodes[f.target];
    if (t?.kind === "variant") {
      if (args.length !== t.fields.length || this.ctx.effectOps.has(f.target)) return stop();
      return { k: "data", tag: f.target, fields: args };
    }
    if (t?.kind === "field") {
      const r = args[0];
      if (typeof r !== "object" || r.k !== "data") return stop();
      const j = (this.code.nodes[r.tag] as NodeOf<"variant">).fields.indexOf(f.target);
      return j < 0 ? stop() : r.fields[j];
    }
    if (t?.kind === "builtin") return this.builtin(f.target, t.op, args);
    return stop();
  }

  builtin(id: Id, op: string, args: PV[]): PV {
    const arith = ARITH_B[id] ?? (id === `builtin.${op}` && op in impl ? (op as Op) : null);
    if (arith) return this.arith(arith, args);
    const bool = (b: boolean): PV => ({ k: "data", tag: b ? TRUE : FALSE, fields: [] });
    const isTrue = (v: PV) => (typeof v === "object" && v.k === "data" ? v.tag === TRUE : stop());
    switch (id) {
      case S.mapParts: return this.parts(args[1], (x) => this.apply(args[0], [x]));
      case S.zipParts: {
        const b = args[2];
        if (typeof args[1] === "object" && args[1].k === "data") {
          if (typeof b !== "object" || b.k !== "data" || b.tag !== args[1].tag) return stop();
          return { ...args[1], fields: args[1].fields.map((x, i) => this.apply(args[0], [x, b.fields[i]])) };
        }
        return this.apply(args[0], [args[1], b]);
      }
      case S.total: {
        const r = args[0];
        if (typeof r !== "object" || r.k !== "data") return r;
        return r.fields.reduce((x, y) => this.arith("add", [x, y]));
      }
    }
    if (args.some(later)) return stop();
    switch (id) {
      case S.equal: return bool(equal(value(args[0]), value(args[1])));
      case S.less: return typeof args[0] === "number" && typeof args[1] === "number" ? bool(args[0] < args[1]) : stop();
      case S.and: return bool(isTrue(args[0]) && isTrue(args[1]));
      case S.or: return bool(isTrue(args[0]) || isTrue(args[1]));
      case S.not: return bool(!isTrue(args[0]));
    }
    const f = STD_IMPL[id];
    if (!f) return stop();
    return fromValue(f(...args.map(value)));
  }

  parts(r: PV, f: (x: PV) => PV): PV {
    if (typeof r === "object" && r.k === "data") return { ...r, fields: r.fields.map(f) };
    return f(r);
  }

  arith(op: Op, args: PV[]): PV {
    // A literal whose type was left open where it was written (in generic
    // code, copied for its data) is the Float64 it is used with.
    const float = (a: PV) => typeof a === "number" || (typeof a === "object" && a.k === "dyn");
    if (args.some(float)) args = args.map((a) => (typeof a === "object" && a.k === "lit" && typeof a.node.value === "number" && !a.node.unit && a.node.of === undefined ? a.node.value : a));
    if (args.every((a) => typeof a === "number")) {
      const r = impl[op](...(args as number[]));
      if (Math.fround(r) !== r && !Number.isNaN(r)) this.rounded = true;
      return r;
    }
    if (!args.every(float)) return stop();
    const [a, b] = args;
    const is = (x: PV, c: number) => typeof x === "number" && x === c;
    // −(c · x) is (−c) · x, exactly.
    const neg = (x: PV): PV => {
      if (typeof x === "number") return -x;
      const d = x as Dyn;
      if (d.op === "neg") return d.args![0];
      if (d.op === "mul" && typeof d.args![0] === "number") return this.dyn("mul", [-d.args![0], d.args![1]]);
      if (d.op === "mul" && typeof d.args![1] === "number") return this.dyn("mul", [d.args![0], -d.args![1]]);
      return this.dyn("neg", [x]);
    };
    switch (op) {
      case "add": if (is(a, 0)) return b; if (is(b, 0)) return a; break;
      case "sub": if (is(b, 0)) return a; if (is(a, 0)) return neg(b); break;
      case "mul":
        if (is(a, 0) || is(b, 0)) return 0;
        if (is(a, 1)) return b;
        if (is(b, 1)) return a;
        if (is(a, -1)) return neg(b);
        if (is(b, -1)) return neg(a);
        break;
      case "div": if (is(b, 1)) return a; break;
      case "neg": return neg(a);
    }
    return this.dyn(op, args);
  }
  dyn(op: Op, args: PV[]): Dyn {
    // A number known now times a cheap part is cheap to write twice.
    const cheap = (op === "neg" || op === "mul") && args.every((x) => typeof x === "number" || (x as Dyn).cheap) && args.some((x) => typeof x === "number");
    return { k: "dyn", op, args, cheap, make: () => this.add({ kind: "call", fn: this.ref(`builtin.${op}`), args: args.map((x) => this.residual(x)) }) };
  }
}

function later(v: PV): boolean {
  return typeof v === "object" && (v.k === "dyn" || (v.k === "data" && v.fields.some(later)));
}
function value(v: PV): Value {
  if (typeof v === "number") return v;
  if (v.k === "data") return { tag: v.tag, fields: v.fields.map(value) } as Value;
  if (v.k === "lit") return v.node.value as Value;
  return stop();
}
function fromValue(x: unknown): PV {
  if (typeof x === "number") return x;
  if (x && typeof x === "object" && "tag" in x && "fields" in x) return { k: "data", tag: (x as { tag: Id }).tag, fields: (x as { fields: unknown[] }).fields.map(fromValue) };
  return stop();
}
function isNumber(t: Type): boolean {
  return t.t === "con" && t.id === NUMBER;
}
