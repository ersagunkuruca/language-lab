// A gradient in one pass back (L285, docs/design/numbers/
// REVERSE-GRADIENT-2026-11-23.md): reverse-mode differentiation
// (Linnainmaa 1970, Speelpenning 1980) written as ordinary code, the way
// derive.ts writes forward mode's. Pearlmutter and Siskind gave the
// functional form ("Reverse-mode AD in a functional framework", 2008);
// JAX's `grad` does the same on its programs.
//
// `gradient(f)` of f : (Array Float64) -> Float64 becomes
//
//     (p) ↦ slopes into(n zeros, <p's slopes>), n = array length(p)
//
// where <p's slopes> is what going back through f's body from its result
// (seeded with 1) gives p. Going back through an expression is written in
// continuation-passing style: `back(e, seed, k)` is code that works out
// the slopes e's inputs get, then goes on with `k`, which is given them.
// So a let's value is bound once and is in scope for everything after it,
// and the slopes from its body are summed before they go back into its
// value (Speelpenning's adjoints, in reverse order of the lets).
//
// A slope of a Float64 is a Float64. A slope of an array is a bag, a
// Slopes: a tree of (position, slope)s, one for each read of the array,
// which `slopes into` adds into an array of zeros once at the end (JAX's
// transpose of a gather, a scatter-add; Futhark's reduce-by-index for
// reverse mode over arrays, Schenck et al. 2022). Two bags join in one
// step, `both slopes`, so the way back stays linear.
//
// Where the answer comes from a choice of branches (if, match, first),
// the way back takes the same branch: piecewise, as forward mode is.
// Calls of definitions are put in place (a definition calling itself is
// R3 in the design, not yet), and so are calls of functions written right
// there (`table of`'s f).

import { FN } from "../../../invertible/src/expr.js";
import type { Code, Id, NodeData, NodeOf } from "../model.ts";
import { children, copyNodes, freshId, isCall, nodeIds, type Call } from "../model.ts";
import type { Names } from "../presentation.ts";
import { impl } from "../prelude.ts";
import { LIBRARY } from "./library.ts";
import { ARITH, S, TRIG_OPS } from "./std.ts";
import { CONS, DIVIDE, NIL, SLOPES_V } from "./std-ids.ts";
import { tuplePart, tupleVariant } from "./std-values.ts";
import { ARRAY, NUMBER } from "./types.ts";
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
const lib = (name: string): Id => {
  const d = LIBRARY.code.defs.find((x) => LIBRARY.names[x] === name);
  if (!d) throw new Error(`pullback.ts: no library definition named ${name}`);
  return d;
};

// The slopes found so far, by the binder (in the code made) they go to:
// a Float64's to add up, or an array's bags to join.
type Kind = "s" | "b";
type Comp = { k: Kind; parts: (() => Id)[] };
type Res = Map<Id, Comp>;
// What going back starts from: the code of a Float64's slope, or of an
// array's bag.
type Seed = { k: Kind; at: () => Id };

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
export function pullbacker(code: Code, names: Names = {}, origin: (id: Id) => Id = (id) => id) {
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
  const num = (v: number) => add({ kind: "lit", value: v, of: NUMBER });
  const letIn = (bs: Id[], vs: Id[], body: Id) => add({ kind: "call", fn: add({ kind: "lambda", params: bs, body }), args: vs });
  const thunk = (body: Id) => add({ kind: "lambda", params: [], body });
  const nm = (id: Id) => names[id] ?? id;
  const cant = (why: string): never => { throw new NotDifferentiable(why); };

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
  const merge = (a: Res, b: Res): Res => {
    const out: Res = new Map(a);
    for (const [k, c] of b) {
      const was = out.get(k);
      if (was && was.k !== c.k) cant("a value read both as a number and as an array");
      out.set(k, was ? { k: c.k, parts: [...was.parts, ...c.parts] } : c);
    }
    return out;
  };
  const zero = (k: Kind) => (k === "s" ? num(0) : ref(SLOPES_V.none));
  // A list of bags as one: a fold, each joined to the rest's.
  const joinAll = (list: Id): Id => {
    const x = binder(), rest = binder(), r = binder();
    return add({ kind: "fold", scrutinee: list, arms: [
      add({ kind: "arm", variant: NIL, binds: [], results: [], body: ref(SLOPES_V.none) }),
      add({ kind: "arm", variant: CONS, binds: [x, rest], results: [null, r], body: call(SLOPES_V.both, ref(x), ref(r)) }),
    ] });
  };
  // One code for the sum of the slopes found.
  function total(c: Comp): Id {
    if (c.k === "s") return c.parts.slice(1).reduce((s, p) => call("builtin.add", s, p()), c.parts[0]());
    return c.parts.slice(0, -1).reduceRight((r, p) => call(SLOPES_V.both, p(), r), c.parts[c.parts.length - 1]());
  }
  // Slopes as one value, a tuple of them in `keys`' order (tuples nest
  // past 8), and taken apart again.
  function pack(r: Res, keys: Id[], kinds: Map<Id, Kind>): Id {
    const vals = keys.map((k) => () => (r.has(k) ? total(r.get(k)!) : zero(kinds.get(k)!)));
    return tupled(vals);
  }
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
  // Going back through several branches (arms, first's two, a map's
  // items): each gives its slopes packed, in one order of keys known once
  // all are gone back through. `branches` makes the code of each, given
  // how to finish one; `join` puts them together into the code of the
  // value; `rest` reads the packed parts (`many`: the value is a list of
  // packs, one per item, the parts summed or joined over them).
  function branching(branches: ((finish: (r: Res) => Id) => Id)[], join: (codes: Id[]) => Id, k: (r: Res) => Id, many = false): Id {
    const results: Res[] = [], holes: Id[] = [];
    const codes = branches.map((b) => b((r) => { results.push(r); const h = add({ kind: "hole" }); holes.push(h); return h; }));
    const kinds = new Map<Id, Kind>();
    for (const r of results) for (const [key, c] of r) { if (kinds.has(key) && kinds.get(key) !== c.k) cant("a value read both as a number and as an array"); kinds.set(key, c.k); }
    const keys = [...kinds.keys()];
    // Each branch's finish becomes its pack.
    holes.forEach((h, i) => { const p = keys.length ? pack(results[i], keys, kinds) : num(0); nodes[h] = { ...nodes[p], id: h } as never; });
    if (!keys.length) return k(new Map());
    const whole = binder();
    const value = join(codes);
    const parts = unpack(() => ref(whole), keys.length);
    const out: Res = new Map();
    if (!many) keys.forEach((key, i) => out.set(key, { k: kinds.get(key)!, parts: [parts[i]] }));
    else keys.forEach((key, i) => {
      // Over a list of packs: each part's list, summed or flattened.
      const item = binder();
      const each = () => call(lib("map"), ref(whole), add({ kind: "lambda", params: [item], body: unpackOne(item, keys.length, i) }));
      out.set(key, { k: kinds.get(key)!, parts: [kinds.get(key) === "s" ? () => call(lib("sum"), each()) : () => joinAll(each())] });
    });
    // The parts are read more than once only in `many`; bound once.
    return letIn([whole], [value], k(out));
  }
  const unpackOne = (item: Id, n: number, i: number): Id => unpack(() => ref(item), n)[i]();

  // A slope bound to a binder, so the code that reads it more than once
  // works it out once.
  function bound(c: () => Id, then: (at: () => Id) => Id): Id {
    const b = binder();
    return letIn([b], [c()], then(() => ref(b)));
  }

  // ---- going back ----
  function back(id: Id, seed: Seed, ctx: Ctx, k: (r: Res) => Id): Id {
    if (!moves(id, ctx)) return k(new Map());
    const n = nodes[id];
    switch (n.kind) {
      case "ref": {
        const b = ctx.bind.get(n.target);
        if (b && ctx.moving.has(n.target)) return k(new Map([[b, { k: seed.k, parts: [seed.at] }]]));
        return cant(`a function ${nm(n.target)} used as a value`);
      }
      case "call": {
        if (!isCall(n)) return cant("a relation used backwards");
        const head = nodes[n.fn];
        if (head.kind === "lambda") return letBack(n.args, head, ctx, seed, ctx, k);
        if (head.kind !== "ref") return cant("a call of a function worked out there");
        const target = head.target;
        const lam = ctx.lams.get(target);
        if (lam) return letBack(n.args, nodes[lam.lam] as NodeOf<"lambda">, ctx, seed, lam.ctx, k);
        if (OPS[target]) return chain(OPS[target], n.args, seed, ctx, k);
        if (target === S.float32) return back(n.args[0], seed, ctx, k);
        if (target === ARRAY_AT) return readBack(n.args[0], n.args[1], seed, ctx, k);
        if (target === S.first) return firstBack(n, seed, ctx, k);
        if (is(target, "sum")) return sumBack(n.args[0], seed, ctx, k);
        if (target === ARRAY_OF) return arrayBack(n.args[0], seed, ctx, k);
        const t = nodes[target];
        if (t?.kind === "def" && t.body && nodes[t.body].kind === "lambda") {
          // One calling itself gets a pullback of its own, which calls
          // itself the same way (as forward mode's g′ calls g′).
          if (recursive(target)) return recursiveBack(n.args, target, seed, ctx, k);
          const inner: Ctx = { bind: new Map(), moving: new Set(), lams: new Map(), inlining: new Set([...ctx.inlining, target]) };
          return letBack(n.args, nodes[t.body] as NodeOf<"lambda">, ctx, seed, inner, k);
        }
        return cant(`the slope goes through ${nm(target)}, which isn't arithmetic`);
      }
      case "match": return matchBack(n, seed, ctx, k);
      default: return cant(`can't go back through a ${n.kind}`);
    }
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
  // The pullback of a definition that calls itself, for the inputs that
  // move (by place) and the kind of its result's slope: a definition of
  // the inputs and the slope, giving the moving inputs' slopes packed.
  const pullbacks = new Map<string, { def: Id; kinds: Kind[] }>();
  function pullbackDef(target: Id, going: number[], seedKind: Kind, fns: Map<number, Id>): { def: Id; kinds: Kind[] } {
    const key = `${target}:${going.join(",")}:${seedKind}:${[...fns].map(([i, l]) => `${i}=${l}`).join(",")}`;
    const was = pullbacks.get(key);
    if (was) return was;
    const lam = nodes[(nodes[target] as NodeOf<"def">).body!] as NodeOf<"lambda">;
    const kinds = going.map((i): Kind => (readAsArray(lam.params[i], lam.body) ? "b" : "s"));
    const def = add({ kind: "def", body: null });
    defs.push(def);
    if (names[target]) names[def] = `${names[target]} back`;
    const out = { def, kinds };
    pullbacks.set(key, out);
    const ctx = scope({ bind: new Map(), moving: new Set(), lams: new Map(), inlining: new Set() }, lam.params);
    for (const i of going) ctx.moving.add(lam.params[i]);
    // A function it is given, written there and closed, is put in place
    // where it is called (the binder is still given it, unread).
    for (const [i, l] of fns) ctx.lams.set(lam.params[i], { lam: l, ctx: { bind: new Map(), moving: new Set(), lams: new Map(), inlining: new Set() } });
    const seedB = binder();
    const keys = going.map((i) => ctx.bind.get(lam.params[i])!);
    const kindOf = new Map(keys.map((k, j) => [k, kinds[j]]));
    const body = back(lam.body, { k: seedKind, at: () => ref(seedB) }, ctx, (r) => {
      for (const [key, c] of r) if (kindOf.get(key) !== c.k) cant(`${nm(target)}'s input read both as a number and as an array`);
      return pack(r, keys, kindOf);
    });
    (nodes[def] as { body: Id | null }).body = add({ kind: "lambda", params: [...lam.params.map((p) => ctx.bind.get(p)!), seedB], body });
    return out;
  }
  function recursiveBack(args: Id[], target: Id, seed: Seed, ctx: Ctx, k: (r: Res) => Id): Id {
    const fns = new Map<number, Id>();
    args.forEach((a, i) => {
      const x = nodes[a];
      const l = x?.kind === "lambda" ? a : x?.kind === "ref" && ctx.lams.has(x.target) ? ctx.lams.get(x.target)!.lam : null;
      if (!l) return;
      if (!closed(l)) cant(`${nm(target)} calls itself and is given a function that reads what is around it`);
      fns.set(i, l);
    });
    const going = args.map((_, i) => i).filter((i) => !fns.has(i) && moves(args[i], ctx));
    const { def, kinds } = pullbackDef(target, going, seed.k, fns);
    const t = binder();
    const parts = unpack(() => ref(t), going.length);
    const step = (j: number, acc: Res): Id => (j === going.length ? k(acc) : back(args[going[j]], { k: kinds[j], at: parts[j] }, ctx, (r) => step(j + 1, merge(acc, r))));
    return letIn([t], [call(def, ...args.map((a) => copy(a, ctx)), seed.at())], step(0, new Map()));
  }

  // A let, or a call put in place: `(x₁ … xₙ ↦ body)(v₁ … vₙ)`. The values
  // are bound first (a function written there is put in place where it is
  // called instead), the body gone back through, then each value with the
  // slopes its binder got, last binder first. `outer` reads the values,
  // `inner` the body (the definition's own, for a call put in place).
  function letBack(args: Id[], lam: NodeOf<"lambda">, outer: Ctx, seed: Seed, inner: Ctx, k: (r: Res) => Id): Id {
    const ctx = scope(inner, lam.params);
    const bs: Id[] = [], vs: Id[] = [];
    lam.params.forEach((p, i) => {
      const a = args[i], an = nodes[a];
      const fnArg = an?.kind === "lambda" ? { lam: a, ctx: outer }
        : an?.kind === "ref" && outer.lams.has(an.target) ? outer.lams.get(an.target)!
        : null;
      if (fnArg) { ctx.lams.set(p, fnArg); ctx.bind.delete(p); return; }
      bs.push(ctx.bind.get(p)!);
      vs.push(copy(a, outer));
      if (moves(a, outer)) ctx.moving.add(p);
    });
    const body = back(lam.body, seed, ctx, (r) => {
      // Each moving value, last first, with its binder's slopes.
      const going = lam.params.map((p, i) => ({ p, a: args[i] })).filter(({ p }) => ctx.moving.has(p)).reverse();
      const step = (j: number, acc: Res): Id => {
        if (j === going.length) return k(acc);
        const key = ctx.bind.get(going[j].p)!;
        const c = acc.get(key);
        if (!c) return step(j + 1, acc);
        const rest = new Map(acc);
        rest.delete(key);
        return bound(() => total(c), (at) => back(going[j].a, { k: c.k, at }, outer, (r2) => step(j + 1, merge(rest, r2))));
      };
      return step(0, r);
    });
    return bs.length ? letIn(bs, vs, body) : body;
  }

  // Arithmetic: each moving input's slope is the seed times the
  // operation's partial there, from the solver's primitive table.
  function chain(name: string, args: Id[], seed: Seed, ctx: Ctx, k: (r: Res) => Id): Id {
    if (seed.k !== "s") return cant("arithmetic on an array");
    const prim = PRIMS[name];
    if (!prim) return cant(`no slope for ${name}`);
    const vals = args.map((a) => () => copy(a, ctx));
    const holes = args.map((_, i): SolverTree => ({ k: "var", name: `#${i}` }));
    const tree = (t: SolverTree): Id => (t.k === "num" ? num(t.v!) : t.k === "var" ? vals[+t.name!.slice(1)]() : call(`builtin.${t.f}`, ...t.args!.map(tree)));
    const going = args.map((a, i) => i).filter((i) => moves(args[i], ctx));
    const step = (j: number, acc: Res): Id => {
      if (j === going.length) return k(acc);
      const i = going[j];
      return bound(() => call("builtin.mul", seed.at(), tree(prim.d[i](holes))), (at) => back(args[i], { k: "s", at }, ctx, (r) => step(j + 1, merge(acc, r))));
    };
    return step(0, new Map());
  }

  // item at(a, i): the slope goes to position i of a's. The read is kept,
  // so where it fails the way back fails too.
  function readBack(arr: Id, at: Id, seed: Seed, ctx: Ctx, k: (r: Res) => Id): Id {
    if (seed.k !== "s") return cant("an array of arrays");
    const i = binder(), checked = binder();
    const bag = () => call(SLOPES_V.one, ref(i), seed.at());
    return letIn([i], [copy(at, ctx)], letIn([checked], [call(ARRAY_AT, copy(arr, ctx), ref(i))], back(arr, { k: "b", at: bag }, ctx, k)));
  }

  // first(() ↦ a, () ↦ b): back through a, or through b where a fails.
  function firstBack(n: NodeOf<"call">, seed: Seed, ctx: Ctx, k: (r: Res) => Id): Id {
    const [a, b] = (n.args ?? []).map((x) => nodes[x]);
    if (a?.kind !== "lambda" || b?.kind !== "lambda" || a.params.length || b.params.length) return cant("first of something not written there");
    return branching([a.body, b.body].map((body) => (finish: (r: Res) => Id) => back(body, seed, ctx, finish)), ([ca, cb]) => call(S.first, thunk(ca), thunk(cb)), k);
  }

  // sum(map(list, (x) ↦ e)) of a list that doesn't move: each item's e
  // gets the seed, and what reaches the rest is summed over the items.
  function sumBack(of: Id, seed: Seed, ctx: Ctx, k: (r: Res) => Id): Id {
    const m = nodes[of];
    const f = isCall(m) && nodes[m.fn]?.kind === "ref" && is((nodes[m.fn] as NodeOf<"ref">).target, "map") ? nodes[m.args[1]] : null;
    if (!isCall(m) || f?.kind !== "lambda" || f.params.length !== 1 || moves(m.args[0], ctx)) return cant("a sum of something other than a map over a list that doesn't move");
    return overItems(m.args[0], f, () => seed, ctx, k);
  }
  // array of(map(list, (x) ↦ e)): the array's slopes, made one array once,
  // and each item's e given its own.
  function arrayBack(of: Id, seed: Seed, ctx: Ctx, k: (r: Res) => Id): Id {
    if (seed.k !== "b") return cant("an array read as a number");
    const m = nodes[of];
    const f = isCall(m) && nodes[m.fn]?.kind === "ref" && is((nodes[m.fn] as NodeOf<"ref">).target, "map") ? nodes[m.args[1]] : null;
    if (!isCall(m) || f?.kind !== "lambda" || f.params.length !== 1 || moves(m.args[0], ctx)) return cant("an array made other than by a map over a list that doesn't move");
    // The list's length, from range(n) or counted.
    const dense = binder(), pos = binder();
    const ln = nodes[m.args[0]];
    if (!isCall(ln) || nodes[ln.fn]?.kind !== "ref" || (nodes[ln.fn] as NodeOf<"ref">).target !== "builtin.int.range") return cant("an array made other than over range(n)");
    const len = () => copy(ln.args[0], ctx);
    // Item j's slope: position j of the array of slopes.
    const itemSeed = (): Seed => ({ k: "s", at: () => call(S.first, thunk(call(ARRAY_AT, ref(dense), ref(pos))), thunk(num(0))) });
    return letIn([dense], [slopesAt(len, seed.at)], overItems(m.args[0], f, itemSeed, ctx, k, pos));
  }
  // Going back through each item of `list` (which doesn't move) with f,
  // the seed for an item from `seedOf` (which may read the item's place,
  // `pos`, as the list is a range from 0).
  function overItems(list: Id, f: NodeOf<"lambda">, seedOf: () => Seed, ctx: Ctx, k: (r: Res) => Id, pos?: Id): Id {
    const inner = scope(ctx, f.params);
    const x = inner.bind.get(f.params[0])!;
    return branching([(finish) => {
      const s = seedOf();
      const body = back(f.body, s, inner, finish);
      return add({ kind: "lambda", params: [x], body: pos ? letIn([pos], [ref(x)], body) : body });
    }], ([lam]) => call(lib("map"), copy(list, ctx), lam), k, true);
  }

  // if / match on what doesn't move (or on a comparison of what does: the
  // slope doesn't go through a choice): each arm gone back through.
  function matchBack(n: NodeOf<"match">, seed: Seed, ctx: Ctx, k: (r: Res) => Id): Id {
    if (n.otherwise) return cant("a handler");
    const arms = n.arms.map((a) => nodes[a] as NodeOf<"arm">);
    const inners = arms.map((arm) => scope(ctx, [...arm.binds, ...arm.results.filter((r): r is Id => r !== null)]));
    if (arms.some((arm) => arm.binds.length && moves(n.scrutinee, ctx))) return cant("taking apart data that moves");
    return branching(arms.map((arm, i) => (finish: (r: Res) => Id) => back(arm.body, seed, inners[i], finish)), (codes) => add({
      kind: "match", scrutinee: copy(n.scrutinee, ctx), otherwise: null,
      arms: arms.map((arm, i) => add({ kind: "arm", variant: arm.variant, binds: arm.binds.map((b) => inners[i].bind.get(b)!), results: arm.results.map((r) => (r === null ? null : inners[i].bind.get(r)!)), body: codes[i] })),
    }), k);
  }

  // An array of n zeros with each (position, slope) of the bag added in.
  // Written as a definition of the program, made once, so every target
  // runs it as it runs the program's own: each slope added in place into
  // an array of n zeros, which has one holder.
  let into: Id | null = null;
  function slopesInto(): Id {
    if (into) return into;
    into = add({ kind: "def", body: null });
    defs.push(into);
    names[into] = "slopes into";
    const acc = binder(), t = binder(), i = binder(), s = binder(), l = binder(), r = binder(), v = binder();
    const arms = [
      add({ kind: "arm", variant: SLOPES_V.none, binds: [], results: [], body: ref(acc) }),
      add({ kind: "arm", variant: SLOPES_V.one, binds: [i, s], results: [null, null], body: letIn([v], [call(ARRAY_AT, ref(acc), ref(i))], call(ARRAY_REPLACE_AT, ref(acc), ref(i), call("builtin.add", ref(v), ref(s)))) }),
      add({ kind: "arm", variant: SLOPES_V.both, binds: [l, r], results: [null, null], body: call(into, call(into, ref(acc), ref(l)), ref(r)) }),
    ];
    (nodes[into] as { body: Id | null }).body = add({ kind: "lambda", params: [acc, t], body: add({ kind: "match", scrutinee: ref(t), arms, otherwise: null }) });
    return into;
  }
  const slopesAt = (n: () => Id, bag: () => Id): Id => {
    const k = binder();
    return call(slopesInto(), call(ARRAY_OF, call(lib("map"), call("builtin.int.range", n()), add({ kind: "lambda", params: [k], body: num(0) }))), bag());
  };

  // gradient(f) of f : (Array Float64) -> Float64, as a lambda.
  function gradient(lamId: Id): Id {
    const lam = nodes[lamId] as NodeOf<"lambda">;
    if (lam.kind !== "lambda" || lam.params.length !== 1) return cant("gradient of a function of more than one input");
    const ctx = scope({ bind: new Map(), moving: new Set(), lams: new Map(), inlining: new Set() }, lam.params);
    const p = lam.params[0], np = ctx.bind.get(p)!;
    ctx.moving.add(p);
    const one = binder();
    const body = letIn([one], [num(1)], back(lam.body, { k: "s", at: () => ref(one) }, ctx, (r) => {
      const c = r.get(np);
      if (c && c.k !== "b") cant("the input read as a number");
      return slopesAt(() => call(ARRAY_LENGTH, ref(np)), () => (c ? total(c) : zero("b")));
    }));
    return add({ kind: "lambda", params: [np], body });
  }

  return { gradient, defs };
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
// every target runs it with nothing of its own. `overArray(call)`: whether
// the checker typed that gradient's function over an Array Float64.
export function expandArrayGradients(code: Code, names: Names, overArray: (call: Id) => boolean): { code: Code; names: Names; expanded: Id[] } {
  const calls = nodeIds(code.nodes).filter((id) => {
    const n = code.nodes[id];
    return isCall(n) && n.args.length === 1 && code.nodes[n.fn]?.kind === "ref" && (code.nodes[n.fn] as NodeOf<"ref">).target === S.gradient && lambdaOf(code, n.args[0]) && overArray(id);
  });
  if (!calls.length) return { code, names, expanded: [] };
  const out: Code = { nodes: copyNodes(code.nodes), defs: [...code.defs] };
  const outNames = { ...names };
  const expanded: Id[] = [];
  for (const id of calls) {
    const pb = pullbacker(out, outNames);
    let lam: Id;
    try { lam = pb.gradient(lambdaOf(out, (out.nodes[id] as Call).args[0])!); } catch (e) { if (e instanceof NotDifferentiable) continue; throw e; }
    out.nodes[id] = { ...out.nodes[lam], id } as never;
    out.defs.push(...pb.defs);
    expanded.push(id);
  }
  return { code: out, names: outNames, expanded };
}

// gradient's function, written right there or a definition's.
function lambdaOf(code: Code, f: Id): Id | null {
  const n = code.nodes[f];
  if (n?.kind === "lambda") return f;
  const d = n?.kind === "ref" ? code.nodes[n.target] : undefined;
  return d?.kind === "def" && d.body && code.nodes[d.body]?.kind === "lambda" ? d.body : null;
}

// Whether the checker typed gradient call `call`'s function over an
// Array Float64.
export function gradientOverArray(code: Code, info: Info, call: Id): boolean {
  const f = (code.nodes[call] as Call | undefined)?.args?.[0];
  const t = f ? info.typeOf.get(f) : undefined;
  const z = t && info.subst.zonk(t);
  return z?.t === "fn" && z.params.length === 1 && z.params[0].t === "con" && z.params[0].id === ARRAY;
}
