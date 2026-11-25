// A gradient in one pass back (L285, docs/design/numbers/
// REVERSE-GRADIENT-2026-11-23.md): reverse-mode differentiation
// (Linnainmaa 1970, Speelpenning 1980) written as ordinary code, the way
// derive.ts writes forward mode's. Pearlmutter and Siskind gave the
// functional form ("Reverse-mode AD in a functional framework", 2008);
// JAX's `grad` does the same on its programs.
//
// `gradient(f)` of f : (Array Float64) -> Float64 becomes
//
//     (p) ↦ <p's slopes>
//
// where <p's slopes> is what going back through f's body from its result
// (seeded with 1) gives p, from n zeros (n = array length(p)). Going
// back through an expression is written in continuation-passing style:
// `back(e, seed, k)` is code that works out the slopes e's inputs get,
// then goes on with `k`, which is given them.
// So a let's value is bound once and is in scope for everything after it,
// and the slopes from its body are summed before they go back into its
// value (Speelpenning's adjoints, in reverse order of the lets).
//
// A slope of a Float64 is a Float64. An array's slopes are an array,
// carried through the pass back: n zeros at first, and each read of the
// array adds its slope at its position with `replace at`, in place where
// nothing else holds the array (JAX's transpose of a gather, a
// scatter-add; Futhark's reduce-by-index for reverse mode over arrays,
// Schenck et al. 2022). So `back` is also given the slopes so far, and
// gives them on with its own added: branches start from the same ones,
// and a map over items is a fold carrying them.
//
// Where the answer comes from a choice of branches (if, match, first),
// the way back takes the same branch: piecewise, as forward mode is.
// Calls of definitions are put in place (one calling itself gets a
// pullback of its own), and so are calls of functions written right
// there (`table of`'s f).

import { FN } from "../../../invertible/src/expr.js";
import type { Code, Id, Node, NodeData, NodeOf } from "../model.ts";
import { children, copyNodes, freshId, isCall, nodeIds, ownerOfTypeParts, type Call } from "../model.ts";
import type { Names } from "../presentation.ts";
import { impl } from "../prelude.ts";
import { LIBRARY } from "./library.ts";
import { ARITH, S, TRIG_OPS } from "./std.ts";
import { CONS, DIVIDE, NIL } from "./std-ids.ts";
import { tuplePart, tupleVariant } from "./std-values.ts";
import { ARRAY, NUMBER, type Type } from "./types.ts";
import type { Info } from "./infer.ts";
import { NotDifferentiable } from "./derive.ts";

interface SolverTree { k: "num" | "var" | "call"; v?: number; name?: string; f?: string; args?: SolverTree[] }
const PRIMS = FN as unknown as Record<string, { d: ((args: SolverTree[]) => SolverTree)[] }>;
// Each arithmetic operation's name in the primitive table: Float64's own,
// the generic ones (differentiated as Float64's, as derive.ts does) and
// Trig's.
const OPS: Record<Id, string> = {
  ...Object.fromEntries(Object.keys(impl).map((op) => [`builtin.${op}`, op])),
  ...Object.fromEntries(Object.entries(ARITH).filter(([op]) => op in impl).map(([op, id]) => [id, op])),
  ...Object.fromEntries(Object.entries(TRIG_OPS).filter(([op]) => op in impl).map(([op, id]) => [id, op])),
  [DIVIDE]: "div",
};
const ARRAY_AT = "builtin.array.at", ARRAY_REPLACE_AT = "builtin.array.replaceAt", ARRAY_OF = "builtin.array.of", ARRAY_LENGTH = "builtin.array.length";
// The primitive table's operations that every Number has.
const GENERIC: Record<string, Id> = { add: ARITH.add, sub: ARITH.sub, mul: ARITH.mul, neg: ARITH.neg, div: DIVIDE, ...Object.fromEntries(["sin", "cos", "tan", "exp", "log"].map((f) => [f, (TRIG_OPS as Record<string, Id>)[f]])) };
const lib = (name: string): Id => {
  const d = LIBRARY.code.defs.find((x) => LIBRARY.names[x] === name);
  if (!d) throw new Error(`pullback.ts: no library definition named ${name}`);
  return d;
};

// The slopes found so far, by the binder (in the code made) they go to:
// a Float64's, parts to add up; an array's, the array of them so far (the
// code reading it, a binder's). `base`: where an array's slopes so far
// are read from when they aren't here (a map's items', the slopes so far
// of the items gone back through before).
type Kind = "s" | "a";
// A record of Float64s (L285): its case and fields. Its slopes are its
// fields', each a Float64's under a key of its own (fieldKey).
interface Rec { variant: Id; fields: Id[] }
type Comp = { k: "s"; parts: (() => Id)[] } | { k: "a"; cur: () => Id };
class Res extends Map<Id, Comp> { base?: (key: Id) => Comp }
// What going back starts from: the code of a Float64's slope; or, for an
// array, the code adding its slopes into an array of them so far (`add`),
// and, where they are one array already, that array (`dense`).
type Seed = { k: "s"; at: () => Id } | { k: "a"; add: (cur: () => Id) => Id; dense?: () => Id };


interface Ctx {
  // A binder of the code read → the binder made for it.
  bind: Map<Id, Id>;
  // Binders of the code read whose value moves with the input.
  moving: Set<Id>;
  // Binders bound to a function written there: put in place where called.
  lams: Map<Id, { lam: Id; ctx: Ctx }>;
  // Definitions being put in place (one calling itself is refused).
  inlining: Set<Id>;
}

// `origin`: the definition a copy was made from (arith.ts copies generic
// definitions per type, info.copyOf), so sum and map are known after it.
// `generic`: over an array of another Number than Float64 (Dual, for the
// Hessian times a vector: forward over reverse), the slopes' arithmetic
// the one + − · / and Trig's, which that number's own ways answer.
// `still(id)`: whether a node's value can't move, known by its type.
export function pullbacker(code: Code, names: Names = {}, origin: (id: Id) => Id = (id) => id, generic = false, still: (id: Id) => boolean = () => false) {
  // The definitions made (pullbacks of definitions that call themselves).
  const defs: Id[] = [];
  const is = (target: Id, name: string) => {
    if (origin(target) === lib(name)) return true;
    // A copy's body is known as a copy of the library's body.
    const body = (nodes[target] as { body?: Id } | undefined)?.body;
    return !!body && origin(body) === (LIBRARY.code.nodes[lib(name)] as NodeOf<"def">).body;
  };
  const nodes = code.nodes;
  const add = (n: NodeData): Id => { const id = freshId(); nodes[id] = { id, ...n } as never; return id; };
  const binder = () => add({ kind: "binder" });
  const ref = (target: Id) => add({ kind: "ref", target });
  const call = (fn: Id, ...args: Id[]) => add({ kind: "call", fn: ref(fn), args });
  const num = (v: number) => add(generic ? { kind: "lit", value: v } : { kind: "lit", value: v, of: NUMBER });
  // An operation of the primitive table at the slopes' number.
  const op = (name: string): Id => (generic ? GENERIC[name] ?? cant(`no ${name} for every Number`) : `builtin.${name}`);
  const letIn = (bs: Id[], vs: Id[], body: Id) => add({ kind: "call", fn: add({ kind: "lambda", params: bs, body }), args: vs });
  const thunk = (body: Id) => add({ kind: "lambda", params: [], body });
  const nm = (id: Id) => names[id] ?? id;
  const cant = (why: string): never => { throw new NotDifferentiable(why); };

  // ---- records ----
  // A field read, `r.f`: the record read and where f is in its case.
  let owners: Map<Id, Id> | undefined;
  function recOf(field: Id): Rec | null {
    if (nodes[field]?.kind !== "field") return null;
    const def = (owners ??= ownerOfTypeParts(code)).get(field);
    const td = def ? nodes[(nodes[def] as NodeOf<"def">).body ?? ""] : undefined;
    if (td?.kind !== "typedef" || td.variants.length !== 1) return null;
    const v = nodes[td.variants[0]] as NodeOf<"variant">;
    return { variant: v.id, fields: v.fields };
  }
  function fieldRead(id: Id): { of: Id; rec: Rec; at: number } | null {
    const n = nodes[id];
    if (!isCall(n) || n.args.length !== 1 || nodes[n.fn]?.kind !== "ref") return null;
    const f = (nodes[n.fn] as NodeOf<"ref">).target, rec = recOf(f);
    return rec ? { of: n.args[0], rec, at: rec.fields.indexOf(f) } : null;
  }
  // The key a record binder's field's slopes go to.
  const fieldKeys = new Map<string, Id>();
  const fieldKey = (b: Id, at: number): Id => {
    const key = `${b}.${at}`;
    let k = fieldKeys.get(key);
    if (!k) fieldKeys.set(key, (k = binder()));
    return k;
  };
  // A record's slopes as a record: each field's, 0 where none was found.
  const recordOf = (r: Res, b: Id, rec: Rec): Id => call(rec.variant, ...rec.fields.map((_, i) => { const c = r.get(fieldKey(b, i)); return c?.k === "s" ? total(c.parts) : num(0); }));
  // Its slopes `whole` (a record) added to binder b's fields'.
  const addRecord = (acc: Res, b: Id, rec: Rec, whole: () => Id): Res => {
    let out = acc;
    rec.fields.forEach((f, i) => {
      const key = fieldKey(b, i), was = out.get(key);
      out = put(out, key, { k: "s", parts: [...(was?.k === "s" ? was.parts : []), () => call(f, whole())] });
    });
    return out;
  };

  // ---- the code read, copied with its binders renamed ----
  function copy(id: Id, ctx: Ctx): Id {
    const n = nodes[id];
    switch (n.kind) {
      case "lit": return add({ kind: "lit", value: n.value, ...(n.of ? { of: n.of } : {}), ...(n.unit ? { unit: n.unit } : {}) });
      case "ref": {
        const b = ctx.bind.get(n.target);
        if (b) return ref(b);
        const l = ctx.lams.get(n.target);
        return l ? copy(l.lam, l.ctx) : ref(n.target);
      }
      case "call":
        if (!isCall(n)) return cant("a relation used backwards");
        return add({ kind: "call", fn: copy(n.fn, ctx), args: n.args.map((a) => copy(a, ctx)) });
      case "lambda": {
        const inner = scope(ctx, n.params);
        return add({ kind: "lambda", params: n.params.map((p) => inner.bind.get(p)!), body: copy(n.body, inner) });
      }
      case "match": case "fold": {
        const arms = n.arms.map((a) => {
          const arm = nodes[a] as NodeOf<"arm">;
          const inner = scope(ctx, [...arm.binds, ...arm.results.filter((r): r is Id => r !== null)]);
          return add({ kind: "arm", variant: arm.variant, binds: arm.binds.map((b) => inner.bind.get(b)!), results: arm.results.map((r) => (r === null ? null : inner.bind.get(r)!)), body: copy(arm.body, inner) });
        });
        const scrutinee = copy(n.scrutinee, ctx);
        return n.kind === "fold" ? add({ kind: "fold", scrutinee, arms }) : add({ kind: "match", scrutinee, arms, otherwise: n.otherwise ? copy(n.otherwise, ctx) : null });
      }
      default: return cant(`can't copy a ${n.kind}`);
    }
  }
  // The context with fresh binders for `bs`, none of them moving.
  function scope(ctx: Ctx, bs: Id[]): Ctx {
    const bind = new Map(ctx.bind), moving = new Set(ctx.moving), lams = new Map(ctx.lams);
    for (const b of bs) { bind.set(b, binder()); moving.delete(b); lams.delete(b); }
    return { ...ctx, bind, moving, lams };
  }

  // Whether expression `id` moves with the input.
  function moves(id: Id, ctx: Ctx, seen = new Set<Id>()): boolean {
    const n = nodes[id];
    if (still(id)) return false;
    if (n.kind === "ref") {
      if (ctx.moving.has(n.target)) return true;
      const l = ctx.lams.get(n.target);
      if (l && !seen.has(l.lam)) { seen.add(l.lam); return moves(l.lam, l.ctx, seen); }
      return false;
    }
    if (n.kind === "binder") return false;
    // An array's length is an Int, the same at every point near.
    if (isCall(n) && nodes[n.fn]?.kind === "ref" && (nodes[n.fn] as NodeOf<"ref">).target === ARRAY_LENGTH) return false;
    return children(n).some((c) => moves(c, ctx, seen));
  }

  // ---- slopes ----
  // `acc` with `key`'s slopes `c` (or none).
  const put = (acc: Res, key: Id, c?: Comp): Res => {
    const out = new Res(acc);
    out.base = acc.base;
    if (c) out.set(key, c); else out.delete(key);
    return out;
  };
  // An array's slopes so far: here, or read from the base.
  const sofar = (acc: Res, key: Id): (() => Id) | undefined => {
    const c = acc.get(key) ?? acc.base?.(key);
    if (c && c.k !== "a") cant("a value read both as a number and as an array");
    return c?.k === "a" ? c.cur : undefined;
  };
  // Over another Number (generic), each slope in an array is kept in a
  // pair of its own (the second part unread): the slopes are added into
  // in place, a position at a time, and so the arrays of them can only be
  // rows (columns.ts keeps no replace but a map's). Of a type of their
  // own, they leave the program's arrays of that Number as it stores them
  // (mnist's Duals as columns, read in place by Newton's dot: C304c).
  const slot = (v: Id): Id => (generic ? call(tupleVariant(2), v, num(0)) : v);
  const unslot = (v: Id): Id => (generic ? call(tuplePart(2, 0), v) : v);
  // n zeros, and as many as array `of` has.
  const zerosOf = (n: () => Id): Id => call(ARRAY_OF, call(lib("map"), call("builtin.int.range", n()), add({ kind: "lambda", params: [binder()], body: slot(num(0)) })));
  const zerosLike = (of: Id): Id => zerosOf(() => call(ARRAY_LENGTH, ref(of)));
  // An item of an array, 0 outside it.
  const itemOr0 = (arr: () => Id, i: () => Id): Id => call(S.first, thunk(unslot(call(ARRAY_AT, arr(), i()))), thunk(num(0)));
  // Slope s added at position i of the slopes so far: replaced, so where
  // nothing else holds them it is in place.
  const addAt = (i: Id, s: Id) => (cur: () => Id): Id => {
    const v = binder();
    return letIn([v], [itemOr0(cur, () => ref(i))], call(ARRAY_REPLACE_AT, cur(), ref(i), slot(call(op("add"), ref(v), ref(s)))));
  };
  // Two arrays of slopes, added item by item.
  const addArrays = (cur: () => Id, more: () => Id): Id => {
    const j = binder();
    return call(ARRAY_OF, call(lib("map"), call("builtin.int.range", call(ARRAY_LENGTH, cur())), add({ kind: "lambda", params: [j], body: slot(call(op("add"), itemOr0(cur, () => ref(j)), itemOr0(more, () => ref(j)))) })));
  };
  // A dense array's slopes as a seed.
  const denseSeed = (d: () => Id): Seed => ({ k: "a", dense: d, add: (cur) => addArrays(cur, d) });
  // One code for the sum of a Float64's slopes found.
  const total = (parts: (() => Id)[]): Id => parts.slice(1).reduce((s, p) => call(op("add"), s, p()), parts[0]());
  // Slopes as one value, a tuple of them (tuples nest past 8), and taken
  // apart again.
  function tupled(vals: (() => Id)[]): Id {
    if (vals.length === 1) return vals[0]();
    if (vals.length <= 8) return call(tupleVariant(vals.length), ...vals.map((v) => v()));
    const chunks: (() => Id)[] = [];
    for (let i = 0; i < vals.length; i += 8) { const c = vals.slice(i, i + 8); chunks.push(() => tupled(c)); }
    return tupled(chunks);
  }
  // The parts of a packed value, as code reading each from `whole`.
  function unpack(whole: () => Id, n: number): (() => Id)[] {
    if (n === 1) return [whole];
    if (n <= 8) return Array.from({ length: n }, (_, i) => () => call(tuplePart(n, i), whole()));
    const sizes: number[] = [];
    for (let i = 0; i < n; i += 8) sizes.push(Math.min(8, n - i));
    const outer = unpack(whole, sizes.length);
    return sizes.flatMap((s, j) => unpack(outer[j], s));
  }
  // The slopes after the packed value `whole`, of `keys`: a Float64's
  // added to those before, an array's bound (so it is read once).
  function unpacked(whole: Id, keys: Id[], kinds: Map<Id, Kind>, acc: Res, k: (r: Res) => Id): Id {
    const parts = unpack(() => ref(whole), keys.length);
    let out = acc;
    const bs: Id[] = [], vs: Id[] = [];
    keys.forEach((key, i) => {
      if (kinds.get(key) === "s") {
        const was = acc.get(key);
        out = put(out, key, { k: "s", parts: [...(was?.k === "s" ? was.parts : []), parts[i]] });
        return;
      }
      const b = binder();
      bs.push(b); vs.push(parts[i]());
      out = put(out, key, { k: "a", cur: () => ref(b) });
    });
    return bs.length ? letIn(bs, vs, k(out)) : k(out);
  }
  const kindsOf = (rs: Res[]): Map<Id, Kind> => {
    const kinds = new Map<Id, Kind>();
    for (const r of rs) for (const [key, c] of r) { if (kinds.has(key) && kinds.get(key) !== c.k) cant("a value read both as a number and as an array"); kinds.set(key, c.k); }
    return kinds;
  };
  // Going back through branches (arms, first's two): each starts from the
  // arrays' slopes so far and gives its slopes packed, in one order of
  // keys known once all are gone back through. `branches` makes the code
  // of each, given the slopes so far and how to finish; `join` puts them
  // together into the code of the value.
  function branching(branches: ((given: Res, finish: (r: Res) => Id) => Id)[], join: (codes: Id[]) => Id, acc: Res, k: (r: Res) => Id): Id {
    const given = new Res();
    given.base = acc.base;
    for (const [key, c] of acc) if (c.k === "a") given.set(key, c);
    const results: Res[] = [], holes: Id[] = [];
    const codes = branches.map((b) => b(given, (r) => { results.push(r); const h = add({ kind: "hole" }); holes.push(h); return h; }));
    const kinds = kindsOf(results);
    // An array's slopes no branch added to are as they were.
    const keys = [...kinds.keys()].filter((key) => !(given.has(key) && results.every((r) => r.get(key) === given.get(key))));
    if (!keys.length) { holes.forEach((h) => { nodes[h] = { ...nodes[num(0)], id: h } as never; }); return k(acc); }
    holes.forEach((h, i) => {
      const r = results[i];
      const p = tupled(keys.map((key) => () => {
        const c = r.get(key);
        if (kinds.get(key) === "s") return c?.k === "s" ? total(c.parts) : num(0);
        const was = c?.k === "a" ? c.cur : sofar(given, key);
        return was ? was() : zerosLike(key);
      }));
      nodes[h] = { ...nodes[p], id: h } as never;
    });
    const whole = binder();
    return letIn([whole], [join(codes)], unpacked(whole, keys, kinds, acc, k));
  }

  // A slope bound to a binder, so the code that reads it more than once
  // works it out once.
  function bound(c: () => Id, then: (at: () => Id) => Id): Id {
    const b = binder();
    return letIn([b], [c()], then(() => ref(b)));
  }

  // ---- going back ----
  // `want`: the value of `id` too, as the slopes of VAL. Lets, calls put
  // in place and branches give their body's; anything else is worked out
  // once where the way back starts, its lets in scope.
  const VAL = binder();
  function passesValue(n: Node, ctx: Ctx): boolean {
    if (n.kind === "match") return !n.otherwise;
    if (!isCall(n)) return false;
    const head = nodes[n.fn];
    if (head.kind === "lambda") return true;
    if (head.kind !== "ref") return false;
    const t = head.target;
    if (ctx.lams.has(t)) return true;
    if (OPS[t] || t === S.float32 || t === ARRAY_AT || t === S.first || t === ARRAY_OF || is(t, "sum")) return false;
    const d = nodes[t];
    return d?.kind === "def" && !!d.body && nodes[d.body].kind === "lambda" && !recursive(t);
  }
  function back(id: Id, seed: Seed, ctx: Ctx, acc: Res, k: (r: Res) => Id, want = false): Id {
    if (want && (!moves(id, ctx) || !passesValue(nodes[id], ctx))) {
      const v = binder();
      return letIn([v], [copy(id, ctx)], back(id, seed, ctx, put(acc, VAL, { k: "s", parts: [() => ref(v)] }), k));
    }
    if (!moves(id, ctx)) return k(acc);
    const n = nodes[id];
    switch (n.kind) {
      case "ref": {
        const b = ctx.bind.get(n.target);
        if (!b || !ctx.moving.has(n.target)) return cant(`a function ${nm(n.target)} used as a value`);
        if (seed.k === "s") {
          const was = acc.get(b);
          if (was && was.k !== "s") cant("a value read both as a number and as an array");
          return k(put(acc, b, { k: "s", parts: [...(was?.k === "s" ? was.parts : []), seed.at] }));
        }
        const was = sofar(acc, b);
        const next = was ? seed.add(was) : seed.dense ? seed.dense() : bound(() => zerosLike(b), seed.add);
        return bound(() => next, (cur) => k(put(acc, b, { k: "a", cur })));
      }
      case "call": {
        if (!isCall(n)) return cant("a relation used backwards");
        const head = nodes[n.fn];
        if (head.kind === "lambda") return letBack(n.args, head, ctx, seed, ctx, acc, k, want);
        if (head.kind !== "ref") return cant("a call of a function worked out there");
        const target = head.target;
        const lam = ctx.lams.get(target);
        if (lam) return letBack(n.args, nodes[lam.lam] as NodeOf<"lambda">, ctx, seed, lam.ctx, acc, k, want);
        if (OPS[target]) return chain(OPS[target], n.args, seed, ctx, acc, k);
        if (target === S.float32) return back(n.args[0], seed, ctx, acc, k);
        if (target === ARRAY_AT) return readBack(n.args[0], n.args[1], seed, ctx, acc, k, true);
        if (target === S.first) return firstBack(n, seed, ctx, acc, k);
        const read = fieldRead(id);
        if (read) return readFieldBack(read, seed, ctx, acc, k);
        if (is(target, "sum")) return sumBack(n.args[0], seed, ctx, acc, k);
        if (target === ARRAY_OF) return arrayBack(n.args[0], seed, ctx, acc, k);
        const t = nodes[target];
        if (t?.kind === "def" && t.body && nodes[t.body].kind === "lambda") {
          // One calling itself gets a pullback of its own, which calls
          // itself the same way (as forward mode's g′ calls g′).
          if (recursive(target)) return recursiveBack(n.args, target, seed, ctx, acc, k);
          const inner: Ctx = { bind: new Map(), moving: new Set(), lams: new Map(), inlining: new Set([...ctx.inlining, target]) };
          return letBack(n.args, nodes[t.body] as NodeOf<"lambda">, ctx, seed, inner, acc, k, want);
        }
        return cant(`the slope goes through ${nm(target)}, which isn't arithmetic`);
      }
      case "match": return matchBack(n, seed, ctx, acc, k, want);
      default: return cant(`can't go back through a ${n.kind}`);
    }
  }

  // r.f: the slope goes to f's own key of the record binder r is; of a
  // record written there, to what f is given.
  function readFieldBack(read: { of: Id; rec: Rec; at: number }, seed: Seed, ctx: Ctx, acc: Res, k: (r: Res) => Id): Id {
    if (seed.k !== "s") return cant("a field read as an array");
    const r = nodes[read.of];
    if (r.kind === "ref" && ctx.moving.has(r.target) && ctx.bind.has(r.target)) {
      const key = fieldKey(ctx.bind.get(r.target)!, read.at), was = acc.get(key);
      return k(put(acc, key, { k: "s", parts: [...(was?.k === "s" ? was.parts : []), seed.at] }));
    }
    if (isCall(r) && nodes[r.fn]?.kind === "ref" && (nodes[r.fn] as NodeOf<"ref">).target === read.rec.variant) return back(r.args[read.at], seed, ctx, acc, k);
    return cant("a field of a record worked out there");
  }

  // Whether a definition reaches itself through the definitions it calls.
  const recursiveKept = new Map<Id, boolean>();
  function recursive(def: Id): boolean {
    let r = recursiveKept.get(def);
    if (r === undefined) {
      const seen = new Set<Id>(), todo = [def];
      r = false;
      while (todo.length && !r) {
        const d = todo.pop()!;
        const walk = (id: Id): void => {
          const x = nodes[id];
          if (!x || r) return;
          if (x.kind === "ref") {
            if (x.target === def) r = true;
            else if (nodes[x.target]?.kind === "def" && !seen.has(x.target)) { seen.add(x.target); todo.push(x.target); }
            return;
          }
          for (const c of children(x)) walk(c);
        };
        const body = (nodes[d] as NodeOf<"def">).body;
        if (body) walk(body);
      }
      recursiveKept.set(def, r);
    }
    return r;
  }
  // A function that reads no binder from around it.
  function closed(lam: Id): boolean {
    const inside = new Set<Id>();
    const walk = (id: Id): boolean => {
      const x = nodes[id];
      if (!x) return true;
      if (x.kind === "binder") { inside.add(id); return true; }
      if (x.kind === "ref") return nodes[x.target]?.kind !== "binder" || inside.has(x.target) || bindersIn(lam).has(x.target);
      return children(x).every(walk);
    };
    return walk(lam);
  }
  const bindersIn = (lam: Id): Set<Id> => {
    const out = new Set<Id>();
    const walk = (id: Id) => { const x = nodes[id]; if (!x) return; if (x.kind === "binder") out.add(id); for (const c of children(x)) walk(c); };
    walk(lam);
    return out;
  };
  // An input read as an array in the definition's body: item at's first,
  // or given where a definition it calls reads one.
  const arrayKept = new Map<Id, boolean>();
  function readAsArray(p: Id, body: Id): boolean {
    const was = arrayKept.get(p);
    if (was !== undefined) return was;
    arrayKept.set(p, false);
    const isP = (a: Id | undefined) => !!a && nodes[a]?.kind === "ref" && (nodes[a] as NodeOf<"ref">).target === p;
    const walk = (id: Id): boolean => {
      const x = nodes[id];
      if (!x) return false;
      if (isCall(x) && nodes[x.fn]?.kind === "ref") {
        const target = (nodes[x.fn] as NodeOf<"ref">).target;
        if (target === ARRAY_AT && isP(x.args[0])) return true;
        const t = nodes[target];
        const lam = t?.kind === "def" && t.body && nodes[t.body]?.kind === "lambda" ? nodes[t.body] as NodeOf<"lambda"> : null;
        if (lam && x.args.some((a, i) => isP(a) && lam.params[i] && readAsArray(lam.params[i], lam.body))) return true;
      }
      if (isCall(x) && nodes[x.fn]?.kind === "lambda") {
        const lam = nodes[x.fn] as NodeOf<"lambda">;
        if (x.args.some((a, i) => isP(a) && lam.params[i] && readAsArray(lam.params[i], lam.body))) return true;
      }
      return children(x).some(walk);
    };
    const r = walk(body);
    arrayKept.set(p, r);
    return r;
  }
  // An input read as a record of Float64s in the definition's body: its
  // field read, or given where a definition it calls reads one.
  const recordKept = new Map<Id, Rec | null>();
  function readAsRecord(p: Id, body: Id): Rec | null {
    if (recordKept.has(p)) return recordKept.get(p)!;
    recordKept.set(p, null);
    const isP = (a: Id | undefined) => !!a && nodes[a]?.kind === "ref" && (nodes[a] as NodeOf<"ref">).target === p;
    const walk = (id: Id): Rec | null => {
      const x = nodes[id];
      if (!x) return null;
      const read = fieldRead(id);
      if (read && isP(read.of)) return read.rec;
      if (isCall(x)) {
        const head = nodes[x.fn];
        const t = head?.kind === "ref" ? nodes[(head as NodeOf<"ref">).target] : undefined;
        const lam = head?.kind === "lambda" ? head : t?.kind === "def" && t.body && nodes[t.body]?.kind === "lambda" ? nodes[t.body] as NodeOf<"lambda"> : null;
        if (lam) for (let i = 0; i < x.args.length; i++) { if (isP(x.args[i]) && lam.params[i]) { const r = readAsRecord(lam.params[i], lam.body); if (r) return r; } }
      }
      for (const c of children(x)) { const r = walk(c); if (r) return r; }
      return null;
    };
    const r = walk(body);
    recordKept.set(p, r);
    return r;
  }
  // The pullback of a definition that calls itself, for the inputs that
  // move (by place) and the kind of its result's slope: a definition of
  // the inputs, the slope and an array input's slopes so far, giving the
  // moving inputs' slopes packed (an array's, its slopes so far with the
  // definition's added).
  const pullbacks = new Map<string, { def: Id; kinds: Kind[]; recs: (Rec | null)[] }>();
  function pullbackDef(target: Id, going: number[], fns: Map<number, Id>): { def: Id; kinds: Kind[]; recs: (Rec | null)[] } {
    const key = `${target}:${going.join(",")}:${[...fns].map(([i, l]) => `${i}=${l}`).join(",")}`;
    const was = pullbacks.get(key);
    if (was) return was;
    const lam = nodes[(nodes[target] as NodeOf<"def">).body!] as NodeOf<"lambda">;
    const kinds = going.map((i): Kind => (readAsArray(lam.params[i], lam.body) ? "a" : "s"));
    const recs = going.map((i, j) => (kinds[j] === "s" ? readAsRecord(lam.params[i], lam.body) : null));
    const def = add({ kind: "def", body: null });
    defs.push(def);
    if (names[target]) names[def] = `${names[target]} back`;
    const out = { def, kinds, recs };
    pullbacks.set(key, out);
    const ctx = scope({ bind: new Map(), moving: new Set(), lams: new Map(), inlining: new Set() }, lam.params);
    for (const i of going) ctx.moving.add(lam.params[i]);
    // A function it is given, written there and closed, is put in place
    // where it is called (the binder is still given it, unread).
    for (const [i, l] of fns) ctx.lams.set(lam.params[i], { lam: l, ctx: { bind: new Map(), moving: new Set(), lams: new Map(), inlining: new Set() } });
    const seedB = binder();
    const keys = going.map((i) => ctx.bind.get(lam.params[i])!);
    const start = new Res(), sofarBs: Id[] = [];
    keys.forEach((key, j) => { if (kinds[j] !== "a") return; const b = binder(); sofarBs.push(b); start.set(key, { k: "a", cur: () => ref(b) }); });
    const body = back(lam.body, { k: "s", at: () => ref(seedB) }, ctx, start, (r) => tupled(keys.map((key, j) => () => {
      if (recs[j]) return recordOf(r, key, recs[j]!);
      const c = r.get(key);
      if (c && c.k !== kinds[j]) cant(`${nm(target)}'s input read both as a number and as an array`);
      return c?.k === "s" ? total(c.parts) : c?.k === "a" ? c.cur() : num(0);
    })));
    (nodes[def] as { body: Id | null }).body = add({ kind: "lambda", params: [...lam.params.map((p) => ctx.bind.get(p)!), seedB, ...sofarBs], body });
    return out;
  }
  function recursiveBack(args: Id[], target: Id, seed: Seed, ctx: Ctx, acc: Res, k: (r: Res) => Id): Id {
    if (seed.k !== "s") return cant(`${nm(target)} calls itself and gives an array`);
    const fns = new Map<number, Id>();
    args.forEach((a, i) => {
      const x = nodes[a];
      const l = x?.kind === "lambda" ? a : x?.kind === "ref" && ctx.lams.has(x.target) ? ctx.lams.get(x.target)!.lam : null;
      if (!l) return;
      if (!closed(l)) cant(`${nm(target)} calls itself and is given a function that reads what is around it`);
      fns.set(i, l);
    });
    const going = args.map((_, i) => i).filter((i) => !fns.has(i) && moves(args[i], ctx));
    if (!going.length) return k(acc);
    const { def, kinds, recs } = pullbackDef(target, going, fns);
    // An array input given as a binder's value: that binder's slopes so
    // far go in, and come out with the definition's added. Any other
    // array: from zeros, and gone back through with what came out.
    const given = going.map((i, j) => {
      if (kinds[j] !== "a") return null;
      const a = nodes[args[i]];
      return a.kind === "ref" && ctx.moving.has(a.target) ? ctx.bind.get(a.target) ?? null : null;
    });
    const sofarArgs = going.flatMap((i, j) => {
      if (kinds[j] !== "a") return [];
      const b = given[j];
      const was = b ? sofar(acc, b) : undefined;
      return [was ? was() : b ? zerosLike(b) : zerosOf(() => call(ARRAY_LENGTH, copy(args[i], ctx)))];
    });
    const t = binder();
    const parts = unpack(() => ref(t), going.length);
    const step = (j: number, acc2: Res): Id => {
      if (j === going.length) return k(acc2);
      const rec = recs[j];
      if (rec) {
        // A record's slopes, added to its binder's fields'.
        const a = nodes[args[going[j]]];
        if (a.kind !== "ref" || !ctx.bind.has(a.target)) return cant(`${nm(target)} calls itself with a record worked out there`);
        return bound(parts[j], (whole) => step(j + 1, addRecord(acc2, ctx.bind.get(a.target)!, rec, whole)));
      }
      if (kinds[j] === "s") return back(args[going[j]], { k: "s", at: parts[j] }, ctx, acc2, (r) => step(j + 1, r));
      const b = binder();
      const rest = (r: Res) => step(j + 1, r);
      return letIn([b], [parts[j]()], given[j] ? rest(put(acc2, given[j]!, { k: "a", cur: () => ref(b) })) : back(args[going[j]], denseSeed(() => ref(b)), ctx, acc2, rest));
    };
    return letIn([t], [call(def, ...args.map((a) => copy(a, ctx)), seed.at(), ...sofarArgs)], step(0, acc));
  }

  // A let, or a call put in place: `(x₁ … xₙ ↦ body)(v₁ … vₙ)`. The values
  // are bound first (a function written there is put in place where it is
  // called instead, and a binder's value read as that binder), the body
  // gone back through, then each value with the slopes its binder got,
  // last binder first. `outer` reads the values, `inner` the body (the
  // definition's own, for a call put in place).
  function letBack(args: Id[], lam: NodeOf<"lambda">, outer: Ctx, seed: Seed, inner: Ctx, acc: Res, k: (r: Res) => Id, want = false): Id {
    const ctx = scope(inner, lam.params);
    const bs: Id[] = [], vs: Id[] = [], going: { p: Id; a: Id }[] = [];
    lam.params.forEach((p, i) => {
      const a = args[i], an = nodes[a];
      const fnArg = an?.kind === "lambda" ? { lam: a, ctx: outer }
        : an?.kind === "ref" && outer.lams.has(an.target) ? outer.lams.get(an.target)!
        : null;
      if (fnArg) { ctx.lams.set(p, fnArg); ctx.bind.delete(p); return; }
      if (an?.kind === "ref" && outer.bind.has(an.target)) {
        ctx.bind.set(p, outer.bind.get(an.target)!);
        if (outer.moving.has(an.target)) ctx.moving.add(p);
        return;
      }
      bs.push(ctx.bind.get(p)!);
      vs.push(copy(a, outer));
      if (moves(a, outer)) { ctx.moving.add(p); going.push({ p, a }); }
    });
    going.reverse();
    const body = back(lam.body, seed, ctx, acc, (r) => {
      // Each moving value, last first, with its binder's slopes.
      const step = (j: number, acc2: Res): Id => {
        if (j === going.length) return k(acc2);
        const key = ctx.bind.get(going[j].p)!;
        const c = acc2.get(key);
        // A record bound: its fields' slopes, each to what its case was
        // given for that field.
        const rec = !c ? readAsRecord(going[j].p, lam.body) : null;
        if (rec && rec.fields.some((_, i) => acc2.has(fieldKey(key, i)))) {
          const v = nodes[going[j].a];
          if (!isCall(v) || nodes[v.fn]?.kind !== "ref" || (nodes[v.fn] as NodeOf<"ref">).target !== rec.variant) return cant("a record worked out there, other than by its case");
          let rest = acc2;
          const fieldParts = rec.fields.map((_, i) => { const f = rest.get(fieldKey(key, i)); rest = put(rest, fieldKey(key, i)); return f?.k === "s" ? f.parts : null; });
          const field = (i: number, r2: Res): Id => {
            if (i === rec.fields.length) return step(j + 1, r2);
            const ps = fieldParts[i];
            if (!ps) return field(i + 1, r2);
            return bound(() => total(ps), (at) => back(v.args[i], { k: "s", at }, outer, r2, (r3) => field(i + 1, r3)));
          };
          return field(0, rest);
        }
        if (!c) return step(j + 1, acc2);
        const rest = put(acc2, key);
        const then = (r2: Res) => step(j + 1, r2);
        if (c.k === "a") return back(going[j].a, denseSeed(c.cur), outer, rest, then);
        return bound(() => total(c.parts), (at) => back(going[j].a, { k: "s", at }, outer, rest, then));
      };
      return step(0, r);
    }, want);
    return bs.length ? letIn(bs, vs, body) : body;
  }

  // Arithmetic: each moving input's slope is the seed times the
  // operation's partial there, from the solver's primitive table.
  function chain(name: string, args: Id[], seed: Seed, ctx: Ctx, acc: Res, k: (r: Res) => Id): Id {
    if (seed.k !== "s") return cant("arithmetic on an array");
    const prim = PRIMS[name];
    if (!prim) return cant(`no slope for ${name}`);
    const vals = args.map((a) => () => copy(a, ctx));
    const holes = args.map((_, i): SolverTree => ({ k: "var", name: `#${i}` }));
    // x to a whole power (a quotient's slope has its bottom squared), as
    // products where only the one + − · / are known.
    const power = (t: SolverTree): Id | null => {
      const [x, n] = t.args!;
      if (!generic || n.k !== "num" || !Number.isInteger(n.v) || n.v! < 1 || n.v! > 4) return null;
      let out = tree(x);
      for (let i = 1; i < n.v!; i++) out = call(op("mul"), out, tree(x));
      return out;
    };
    const tree = (t: SolverTree): Id => (t.k === "num" ? num(t.v!) : t.k === "var" ? vals[+t.name!.slice(1)]() : (t.f === "pow" && power(t)) || call(op(t.f!), ...t.args!.map(tree)));
    const going = args.map((a, i) => i).filter((i) => moves(args[i], ctx));
    const step = (j: number, acc2: Res): Id => {
      if (j === going.length) return k(acc2);
      const i = going[j];
      return bound(() => call(op("mul"), seed.at(), tree(prim.d[i](holes))), (at) => back(args[i], { k: "s", at }, ctx, acc2, (r) => step(j + 1, r)));
    };
    return step(0, acc);
  }

  // item at(a, i): the slope goes to position i of a's. The read is kept
  // (`checked`), so where it fails the way back fails too; under a first
  // whose other way doesn't move it isn't: there a read outside a adds to
  // no slope, as the other way gives none.
  function readBack(arr: Id, at: Id, seed: Seed, ctx: Ctx, acc: Res, k: (r: Res) => Id, checked: boolean): Id {
    if (seed.k !== "s") return cant("an array of arrays");
    const i = binder(), s = binder();
    const rest = letIn([s], [seed.at()], back(arr, { k: "a", add: addAt(i, s) }, ctx, acc, k));
    return letIn([i], [copy(at, ctx)], checked ? letIn([binder()], [call(ARRAY_AT, copy(arr, ctx), ref(i))], rest) : rest);
  }
  // An index that always has a value: binders, numbers and + − ·.
  const sure = (id: Id): boolean => {
    const x = nodes[id];
    if (x.kind === "ref") return nodes[x.target]?.kind === "binder";
    if (x.kind === "lit") return true;
    return isCall(x) && nodes[x.fn]?.kind === "ref" && ["add", "sub", "mul", "neg"].includes(OPS[(nodes[x.fn] as NodeOf<"ref">).target]) && x.args.every(sure);
  };

  // first(() ↦ a, () ↦ b): back through a, or through b where a fails.
  function firstBack(n: NodeOf<"call">, seed: Seed, ctx: Ctx, acc: Res, k: (r: Res) => Id): Id {
    const [a, b] = (n.args ?? []).map((x) => nodes[x]);
    if (a?.kind !== "lambda" || b?.kind !== "lambda" || a.params.length || b.params.length) return cant("first of something not written there");
    // first(item at(xs, i), else what doesn't move): the read's slope
    // added at i, which adds nothing outside xs.
    const r = nodes[a.body];
    if (isCall(r) && nodes[r.fn]?.kind === "ref" && (nodes[r.fn] as NodeOf<"ref">).target === ARRAY_AT && sure(r.args[1]) && !moves(b.body, ctx) && moves(r.args[0], ctx)) return readBack(r.args[0], r.args[1], seed, ctx, acc, k, false);
    return branching([a.body, b.body].map((body) => (given: Res, finish: (r: Res) => Id) => back(body, seed, ctx, given, finish)), ([ca, cb]) => call(S.first, thunk(ca), thunk(cb)), acc, k);
  }

  // sum(map(list, (x) ↦ e)) of a list that doesn't move: each item's e
  // gets the seed, and what reaches the rest is summed over the items.
  function sumBack(of: Id, seed: Seed, ctx: Ctx, acc: Res, k: (r: Res) => Id): Id {
    const m = nodes[of];
    const f = isCall(m) && nodes[m.fn]?.kind === "ref" && is((nodes[m.fn] as NodeOf<"ref">).target, "map") ? nodes[m.args[1]] : null;
    if (!isCall(m) || f?.kind !== "lambda" || f.params.length !== 1 || moves(m.args[0], ctx)) return cant("a sum of something other than a map over a list that doesn't move");
    return overItems(m.args[0], f, () => seed, ctx, acc, k);
  }
  // array of(map(list, (x) ↦ e)): the array's slopes, made one array once,
  // and each item's e given its own.
  function arrayBack(of: Id, seed: Seed, ctx: Ctx, acc: Res, k: (r: Res) => Id): Id {
    if (seed.k !== "a") return cant("an array read as a number");
    const m = nodes[of];
    const f = isCall(m) && nodes[m.fn]?.kind === "ref" && is((nodes[m.fn] as NodeOf<"ref">).target, "map") ? nodes[m.args[1]] : null;
    if (!isCall(m) || f?.kind !== "lambda" || f.params.length !== 1 || moves(m.args[0], ctx)) return cant("an array made other than by a map over a list that doesn't move");
    // The list's length, from range(n).
    const dense = binder(), pos = binder();
    const ln = nodes[m.args[0]];
    if (!isCall(ln) || nodes[ln.fn]?.kind !== "ref" || (nodes[ln.fn] as NodeOf<"ref">).target !== "builtin.int.range") return cant("an array made other than over range(n)");
    const slopes = seed.dense ? seed.dense() : bound(() => zerosOf(() => copy(ln.args[0], ctx)), seed.add);
    // Item j's slope: position j of the array of slopes.
    const itemSeed = (): Seed => ({ k: "s", at: () => itemOr0(() => ref(dense), () => ref(pos)) });
    return letIn([dense], [slopes], overItems(m.args[0], f, itemSeed, ctx, acc, k, pos));
  }
  // Going back through each item of `list` (which doesn't move) with f,
  // the seed for an item from `seedOf` (which may read the item's place,
  // `pos`, as the list is a range from 0): a fold over the items, carrying
  // the slopes so far of what they read, a Float64's summed and an
  // array's added into.
  function overItems(list: Id, f: NodeOf<"lambda">, seedOf: () => Seed, ctx: Ctx, acc: Res, k: (r: Res) => Id, pos?: Id): Id {
    const inner = scope(ctx, f.params);
    const x = inner.bind.get(f.params[0])!;
    // The slopes so far, read in the body before the keys are known:
    // holes, filled once they are.
    const state = binder(), reads = new Map<Id, Id[]>();
    const start = new Res();
    start.base = (key) => {
      if (!reads.has(key)) reads.set(key, []);
      return { k: "a", cur: () => { const h = add({ kind: "hole" }); reads.get(key)!.push(h); return h; } };
    };
    let done: Res = start;
    const finished = add({ kind: "hole" });
    const body = back(f.body, seedOf(), inner, start, (r) => { done = r; return finished; });
    const kinds = kindsOf([done]);
    for (const key of reads.keys()) kinds.set(key, "a");
    const keys = [...kinds.keys()];
    if (!keys.length) return k(acc);
    const parts = unpack(() => ref(state), keys.length);
    keys.forEach((key, i) => { for (const h of reads.get(key) ?? []) nodes[h] = { ...nodes[parts[i]()], id: h } as never; });
    const next = tupled(keys.map((key, i) => () => {
      const c = done.get(key);
      if (!c) return parts[i]();
      return c.k === "s" ? call(op("add"), parts[i](), total(c.parts)) : c.cur();
    }));
    nodes[finished] = { ...nodes[next], id: finished } as never;
    const first = tupled(keys.map((key) => () => {
      if (kinds.get(key) === "s") return num(0);
      const was = sofar(acc, key);
      return was ? was() : zerosLike(key);
    }));
    const whole = binder();
    const fold = add({ kind: "fold", scrutinee: copy(list, ctx), arms: [
      add({ kind: "arm", variant: NIL, binds: [], results: [], body: first }),
      add({ kind: "arm", variant: CONS, binds: [x, binder()], results: [null, state], body: pos ? letIn([pos], [ref(x)], body) : body }),
    ] });
    return letIn([whole], [fold], unpacked(whole, keys, kinds, acc, k));
  }

  // if / match on what doesn't move (or on a comparison of what does: the
  // slope doesn't go through a choice): each arm gone back through.
  function matchBack(n: NodeOf<"match">, seed: Seed, ctx: Ctx, acc: Res, k: (r: Res) => Id, want = false): Id {
    if (n.otherwise) return cant("a handler");
    const arms = n.arms.map((a) => nodes[a] as NodeOf<"arm">);
    const inners = arms.map((arm) => scope(ctx, [...arm.binds, ...arm.results.filter((r): r is Id => r !== null)]));
    if (arms.some((arm) => arm.binds.length && moves(n.scrutinee, ctx))) return cant("taking apart data that moves");
    return branching(arms.map((arm, i) => (given: Res, finish: (r: Res) => Id) => back(arm.body, seed, inners[i], given, finish, want)), (codes) => add({
      kind: "match", scrutinee: copy(n.scrutinee, ctx), otherwise: null,
      arms: arms.map((arm, i) => add({ kind: "arm", variant: arm.variant, binds: arm.binds.map((b) => inners[i].bind.get(b)!), results: arm.results.map((r) => (r === null ? null : inners[i].bind.get(r)!)), body: codes[i] })),
    }), acc, k);
  }

  // gradient(f) of f : (Array Float64) -> Float64, as a lambda: the
  // input's slopes, from n zeros, each added in where it is found. With
  // `value`, value and gradient's: f's value and the slopes, a pair.
  function gradient(lamId: Id, value = false): Id {
    const lam = nodes[lamId] as NodeOf<"lambda">;
    if (lam.kind !== "lambda" || lam.params.length !== 1) return cant("gradient of a function of more than one input");
    const ctx = scope({ bind: new Map(), moving: new Set(), lams: new Map(), inlining: new Set() }, lam.params);
    const p = lam.params[0], np = ctx.bind.get(p)!;
    ctx.moving.add(p);
    const one = binder();
    const rec = readAsRecord(p, lam.body);
    const body = letIn([one], [num(1)], back(lam.body, { k: "s", at: () => ref(one) }, ctx, new Res(), (r) => {
      if (rec) {
        const slopes = recordOf(r, np, rec);
        if (!value) return slopes;
        const v = r.get(VAL);
        return v?.k === "s" ? call(tupleVariant(2), total(v.parts), slopes) : cant("the value not found on the way back");
      }
      const c = r.get(np);
      if (c && c.k !== "a") cant("the input read as a number");
      const slots = c?.k === "a" ? c.cur() : zerosLike(np);
      // Out of their pairs.
      const plain = (): Id => {
        if (!generic) return slots;
        const b = binder(), j = binder();
        return letIn([b], [slots], call(ARRAY_OF, call(lib("map"), call("builtin.int.range", call(ARRAY_LENGTH, ref(b))), add({ kind: "lambda", params: [j], body: itemOr0(() => ref(b), () => ref(j)) }))));
      };
      if (!value) return plain();
      const v = r.get(VAL);
      return v?.k === "s" ? call(tupleVariant(2), total(v.parts), plain()) : cant("the value not found on the way back");
    }, value));
    return add({ kind: "lambda", params: [np], body });
  }

  return { gradient, defs, copied: (id: Id): Id => copy(id, { bind: new Map(), moving: new Set(), lams: new Map(), inlining: new Set() }) };
}

// For the evaluator: gradient(f) at an array, as a lambda (kept, as
// derive.ts keeps its own).
const kept = new WeakMap<object, Map<Id, Id>>();
export function arrayGradientLambda(code: Code, lambda: Id, origin?: (id: Id) => Id): Id {
  let c = kept.get(code.nodes);
  if (!c) kept.set(code.nodes, (c = new Map()));
  if (!c.has(lambda)) c.set(lambda, pullbacker(code, {}, origin).gradient(lambda));
  return c.get(lambda)!;
}

// gradient(f) over an array, of a function written right there, made
// ahead as code (as derive.ts expandDerivatives makes forward mode's), so
// every target runs it with nothing of its own; value and gradient(f) too,
// its value from the same run forward. Over a record or a Float64, value
// and gradient(f) is written as (q) ↦ (f(q), gradient(f)(q)), whose
// gradient forward mode makes later (over a Float64, derivative(f)).
// `info`: the code's check, which says what each call is over.
// `only`: the calls to make (all of them when not given).
export function expandArrayGradients(code: Code, names: Names, info: Info, only?: (call: Id) => boolean): { code: Code; names: Names; expanded: Id[] } {
  const over = (call: Id) => gradientOver(code, info, call);
  const overArray = (call: Id) => over(call)?.of === ARRAY;
  // Over a record of Float64s too (L285): one pass back for all its
  // fields, where forward mode makes one pass for each; where the pass
  // back can't be made, forward mode's.
  const overRecord = (call: Id) => { const o = over(call); return !!o && o.of !== ARRAY && o.of !== NUMBER && recordType(code, o.of); };
  const overMany = (call: Id) => overArray(call) || overRecord(call);
  const asked = (n: Node | undefined) => isCall(n) && n.args.length === 1 && code.nodes[n.fn]?.kind === "ref" ? (code.nodes[n.fn] as NodeOf<"ref">).target : null;
  const calls = nodeIds(code.nodes).filter((id) => {
    const n = code.nodes[id], t = asked(n);
    if ((t !== S.gradient && t !== S.valueAndGradient) || (only && !only(id))) return false;
    const f = (n as Call).args[0];
    return t === S.valueAndGradient ? !!lambdaOf(code, f) || code.nodes[f]?.kind === "ref" : !!lambdaOf(code, f) && overMany(id);
  });
  if (!calls.length) return { code, names, expanded: [] };
  const out: Code = { nodes: copyNodes(code.nodes), defs: [...code.defs] };
  const outNames = { ...names };
  const expanded: Id[] = [];
  for (const id of calls) {
    const item = over(id)?.item, generic = !!item && item !== NUMBER;
    const pb = pullbacker(out, outNames, undefined, generic, generic ? stillBesides(info, item) : undefined);
    const n = out.nodes[id] as Call, f = n.args[0], value = asked(n) === S.valueAndGradient;
    let lam: Id | null = null;
    // Over a record, one pass back where it can be made.
    if (lambdaOf(out, f) && overRecord(id)) {
      try { lam = pb.gradient(lambdaOf(out, f)!, value); } catch (e) { if (!(e instanceof NotDifferentiable)) throw e; if (!value) continue; }
    }
    if (lam) { /* made */ } else if (value && !(lambdaOf(out, f) && overArray(id))) {
      // f(q) and gradient(f)(q), f written twice (a definition's name, or
      // the function written there copied).
      const add = (d: NodeData): Id => { const x = freshId(); out.nodes[x] = { id: x, ...d } as never; return x; };
      const fn = () => (out.nodes[f]?.kind === "lambda" ? pb.copied(f) : add({ kind: "ref", target: (out.nodes[f] as NodeOf<"ref">).target }));
      const q = add({ kind: "binder" }), at = () => add({ kind: "ref", target: q });
      const grad = add({ kind: "call", fn: add({ kind: "call", fn: add({ kind: "ref", target: over(id)?.of === NUMBER ? S.derivative : S.gradient }), args: [fn()] }), args: [at()] });
      lam = add({ kind: "lambda", params: [q], body: add({ kind: "call", fn: add({ kind: "ref", target: tupleVariant(2) }), args: [add({ kind: "call", fn: fn(), args: [at()] }), grad] }) });
    } else {
      try { lam = pb.gradient(lambdaOf(out, f)!, value); } catch (e) { if (e instanceof NotDifferentiable) continue; throw e; }
    }
    out.nodes[id] = { ...out.nodes[lam], id } as never;
    out.defs.push(...pb.defs);
    expanded.push(id);
  }
  return { code: out, names: outNames, expanded };
}

// Over another Number than Float64, a value of a type without it in it
// can't move: none of that Number's operations makes one (a part of one
// read out, as a dual number's value, is no slope's way: the hand-written
// pass takes it as a constant too). A type left open isn't known to be one.
function stillBesides(info: Info, item: Id): (id: Id) => boolean {
  const without = (t: Type): boolean => t.t === "con" ? t.id !== item && t.args.every(without) : t.t === "fn" ? t.params.every(without) && without(t.ret) : false;
  return (id) => { const t = info.typeOf.get(id); return !!t && without(info.subst.zonk(t)); };
}

// A type of one case whose fields are all Float64s.
function recordType(code: Code, type: Id): boolean {
  const td = code.nodes[(code.nodes[type] as NodeOf<"def"> | undefined)?.body ?? ""];
  if (td?.kind !== "typedef" || td.variants.length !== 1 || td.params.length) return false;
  const v = code.nodes[td.variants[0]] as NodeOf<"variant">;
  return v.fields.length > 0 && v.fields.every((f) => { const t = code.nodes[(code.nodes[f] as NodeOf<"field">).type]; return t?.kind === "tref" && t.target === NUMBER && !t.args.length; });
}

// gradient's function, written right there or a definition's.
function lambdaOf(code: Code, f: Id): Id | null {
  const n = code.nodes[f];
  if (n?.kind === "lambda") return f;
  const d = n?.kind === "ref" ? code.nodes[n.target] : undefined;
  return d?.kind === "def" && d.body && code.nodes[d.body]?.kind === "lambda" ? d.body : null;
}

// The type the checker gave gradient call `call`'s function's input (an
// Array, a record, Float64), by its id, and an array's items'.
export function gradientOver(code: Code, info: Info, call: Id): { of: Id; item: Id | null } | null {
  const f = (code.nodes[call] as Call | undefined)?.args?.[0];
  const t = f ? info.typeOf.get(f) : undefined;
  const z = t && info.subst.zonk(t);
  if (z?.t !== "fn" || z.params.length !== 1 || z.params[0].t !== "con") return null;
  const p = z.params[0], item = p.id === ARRAY ? p.args[0] : undefined;
  return { of: p.id, item: item?.t === "con" ? item.id : null };
}
