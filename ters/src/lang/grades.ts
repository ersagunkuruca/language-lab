// Which parts of a multivector can be nonzero (GRADES.md, BACKLOG L43b).
//
// For an algebra the program writes down (a definition with no inputs
// whose value is `clifford algebra(squares, basis)`), each multivector a
// function makes gets a blade mask: bit i set when its part i may be
// nonzero. The reading is an abstract evaluation, as linear.ts reads a
// matrix: literals and records built by position give their mask
// directly (a part written as the literal 0 is off), + and − take the
// union, a number times a multivector keeps its mask, and the prelude's
// Clifford operations follow the algebra's own table. The product, the
// outer and inner products, the regressive product, the dual, the reverse
// and the involution are linear in each input, so their mask is the
// union over the input blades of what each pair of basis elements gives;
// that table of masks is worked out from the blades and the squares as
// the prelude defines each operation (so in PGA a product landing on
// e₀e₀ = 0 drops out), or, for a basis that isn't one 1 per element, by
// running the operation on the basis elements. The sandwich, a reflection, an inverse and the
// exponential are built from those (the exponential as a closure under
// the product). Anything the reading doesn't follow is every part, so a
// mask is never too small.
//
// Off means 0 in exact arithmetic. When a rule sees a cancellation (the
// grade rule for a sandwich, say), Float64s may leave rounding there
// (1e-17 of the rest), which storing only the masked parts drops.
//
// Lets, lambdas applied and the program's own definitions are read
// through (inlined, up to a depth); a definition's inputs are every part
// unless the caller says otherwise. The compiler (L43c) and the editor
// (L43d) use the masks. `gradeMistakes` refuses one thing: reading a part
// a value can't have (L43e's first step; `lab check` reports it).
//
// Prior art: Gaalop (Dietmar Hildenbrand) finds which blades of each
// result can be nonzero and generates code for those only; this is the
// same, by the language's own abstract evaluation over a finite lattice
// (Cousot and Cousot, POPL 1977). CREDITS.md.

import { children as childIds, dependencies, subtree, type Code, type Id, type Node, type NodeOf } from "../model.ts";
import type { Info } from "./infer.ts";
import { LIBRARY } from "./library.ts";
import { makeRunner, type Value } from "./run.ts";
import { ALGEBRA_V, ARITH, CONS, LIST, NIL, S, SET as S_SET, TRUE } from "./std.ts";
import { B } from "../prelude.ts";
import { MASK_TYPES, NUMBER } from "./types.ts";

export interface Algebra {
  // The definition whose value it is, and the record variant of its
  // multivectors.
  def: Id;
  variant: Id;
  parts: number;
  // Each part's blade: the basis vectors in it, numbered from 1.
  blades: number[][];
  full: number;
  // pair(op, i, j): the mask of op(eᵢ, eⱼ); one(op, i): of op(eᵢ).
  // Each is worked out from the blades (or, for an unusual basis, by
  // running the program's own operation the first time it is asked for).
  pair(op: Binary, i: number, j: number): number;
  one(op: Unary, i: number): number;
}
type Binary = "product" | "outer" | "inner" | "regressive";
type Unary = "reverse" | "involute" | "dual" | "undual";

type V =
  // l: loose, a mask the reading doesn't know (an input, a value it lost),
  // so every part; a named mask isn't checked against a loose one.
  | { k: "mask"; alg: Algebra; m: number; l?: boolean }
  | { k: "alg"; alg: Algebra }
  | { k: "num"; zero: boolean }
  | { k: "closure"; lambda: NodeOf<"lambda">; env: Map<Id, V> }
  // A list, and what its items are (null: it has none, as nil).
  | { k: "list"; item: V | null }
  | { k: "top" };

const TOP: V = { k: "top" };
const NUM: V = { k: "num", zero: false };
const DEPTH = 60;

const libId = (name: string): Id | undefined => Object.keys(LIBRARY.names).find((id) => LIBRARY.names[id] === name && LIBRARY.code.nodes[id]?.kind === "def");
const CL: Record<string, Id | undefined> = Object.fromEntries(
  ["algebra", "product", "outer", "inner", "regressive", "reverse", "involute", "dual", "undual", "versor inverse", "sandwich", "reflect", "project", "exp", "grade", "part", "with part"]
    .map((n) => [n, libId(`clifford ${n}`)]),
);
const byId = new Map(Object.entries(CL).flatMap(([n, id]) => (id ? [[id, n] as const] : [])));

const ADD = new Set<Id>([ARITH.add, B.add]), SUB = new Set<Id>([ARITH.sub, B.sub]);
const MUL = new Set<Id>([ARITH.mul, B.mul]), DIV = new Set<Id>([B.div]), NEG = new Set<Id>([ARITH.neg, B.neg]);

const bits = (m: number) => { const out: number[] = []; for (let i = 0; m >> i; i++) if ((m >> i) & 1) out.push(i); return out; };
const listOf = (v: Value): Value[] => { const out: Value[] = []; let c = v as { tag: Id; fields: Value[] }; while (c.tag === CONS) { out.push(c.fields[0]); c = c.fields[1] as never; } return out; };

// The algebras a program writes down, each worked out once.
const cache = new WeakMap<Code, Map<Id, Algebra>>();
export function algebrasOf(code: Code, info: Info): Map<Id, Algebra> {
  let found = cache.get(code);
  if (found) return found;
  found = new Map();
  cache.set(code, found);
  if (!CL.algebra) return found;
  const r = makeRunner(code, info, { print: () => {} });
  const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };
  for (const d of code.defs) {
    const def = code.nodes[d] as NodeOf<"def">;
    const body = def?.kind === "def" && def.body ? code.nodes[def.body] : undefined;
    if (body?.kind !== "call" || (code.nodes[body.fn] as Node)?.kind !== "ref" || (code.nodes[body.fn] as NodeOf<"ref">).target !== CL.algebra) continue;
    try {
      const al = r.value(d) as { tag: Id; fields: Value[] };
      if (al?.tag !== ALGEBRA_V) continue;
      const pairs = listOf(al.fields[2]).map((p) => (p as { tag: Id; fields: Value[] }).fields);
      const elements = pairs.map(([, e]) => e as { tag: Id; fields: number[] });
      const parts = elements[0].fields.length;
      // Part i's element is the one with its 1 at i.
      const at = Array.from({ length: parts }, (_, i) => pairs.findIndex(([, e]) => (e as { fields: number[] }).fields[i] !== 0));
      const blades = at.map((k) => listOf(pairs[k][0]).flatMap((b, j) => ((b as { tag: Id }).tag === TRUE ? [j + 1] : [])));
      const el = (i: number) => elements[at[i]];
      const full = (1 << parts) - 1;
      // With one 1 per element (the basis as clifford table wants it),
      // each table is worked out from the blades and the squares, as the
      // prelude's own definitions give it: eₐ eᵦ = ± e_{A Δ B}, 0 when a
      // vector both have squares to 0; the outer product keeps the pairs
      // that share no vector, the inner product (a left contraction) those
      // where A is inside B; the reverse and the involution keep each
      // blade; the dual and the undual take it to its complement; and the
      // regressive product is undual(dual a ∧ dual b). Running the
      // operations instead took 14 seconds on Spacetime's 16 parts
      // (BACKLOG L43c); grades.test.ts checks the two agree.
      const squares = listOf(al.fields[0]) as number[];
      const unit = elements.every((e) => e.fields.filter((x) => x !== 0).length === 1);
      const vecs = blades.map((b) => b.reduce((m, v) => m | (1 << (v - 1)), 0));
      const partOf = new Map(vecs.map((v, i) => [v, i]));
      const bit = (v: number) => { const i = partOf.get(v); return i === undefined ? 0 : 1 << i; };
      const all = (1 << squares.length) - 1;
      const dies = (common: number) => squares.some((s, i) => (common >> i) & 1 && s === 0);
      const times = (A: number, B: number, keep: boolean) => (keep && !dies(A & B) ? bit(A ^ B) : 0);
      const spread = (m: number, f: (v: number) => number) => bits(m).reduce((r, i) => r | f(vecs[i]), 0);
      const table = {
        product: (A: number, B: number) => times(A, B, true),
        outer: (A: number, B: number) => times(A, B, (A & B) === 0),
        inner: (A: number, B: number) => times(A, B, (A & ~B) === 0),
        regressive: (A: number, B: number) => spread(bit(all & ~A), (a) => spread(bit(all & ~B), (b) => spread(times(a, b, (a & b) === 0), (c) => bit(all & ~c)))),
        reverse: (A: number) => bit(A),
        involute: (A: number) => bit(A),
        dual: (A: number) => bit(all & ~A),
        undual: (A: number) => bit(all & ~A),
      };
      const maskOf = (v: Value) => { const f = (v as { fields: number[] }).fields; return f.reduce((m, x, i) => (x !== 0 ? m | (1 << i) : m), 0); };
      const run = (op: string, ...xs: Value[]) => maskOf(first(r.call(r.value(CL[op]!), al, ...xs) as Iterable<Value>)!);
      const memo = new Map<string, number>();
      // An operation that fails on a part could give any part.
      const once = (key: string, f: () => number) => {
        let m = memo.get(key);
        if (m === undefined) { try { m = f(); } catch { m = full; } memo.set(key, m); }
        return m;
      };
      const alg: Algebra = {
        def: d, variant: elements[0].tag, parts, blades, full,
        pair: (op, i, j) => (unit ? table[op](vecs[i], vecs[j]) : once(`${op} ${i} ${j}`, () => run(op, el(i), el(j)))),
        one: (op, i) => (unit ? table[op](vecs[i]) : once(`${op} ${i}`, () => run(op, el(i)))),
      };
      found.set(d, alg);
    } catch { /* an algebra that doesn't run is not read */ }
  }
  return found;
}

const binary = (alg: Algebra, op: Binary, a: number, b: number) => {
  let m = 0;
  for (const i of bits(a)) for (const j of bits(b)) m |= alg.pair(op, i, j);
  return m;
};
const unary = (alg: Algebra, op: Unary, a: number) => bits(a).reduce((m, i) => m | alg.one(op, i), 0);
const gradeOf = (alg: Algebra, i: number) => alg.blades[i].length;
// Every blade of the grades x has.
const sameGrades = (alg: Algebra, x: number) => { const gs = new Set(bits(x).map((i) => gradeOf(alg, i))); return alg.blades.reduce((m, b, i) => (gs.has(b.length) ? m | (1 << i) : m), 0); };
const versor = (alg: Algebra, r: number) => {
  const gs = bits(r).map((i) => gradeOf(alg, i));
  return gs.length > 0 && (gs.every((g) => g === 1) || (gs.every((g) => g % 2 === 0) && Math.log2(alg.parts) <= 3));
};

// The mask of what `fn` (a definition or a lambda) gives, each input
// given as a mask (or every part when left out); null when it isn't a
// multivector of an algebra the program writes down.
// The reading itself, over one program: `ev` reads an expression in an
// environment of what its variables are. `onCall` sees each call of one of
// the program's own definitions, with what its inputs are there, and may
// answer for it (a summary) instead of reading it through; `onValue` sees
// each node read and what it was.
interface Hooks { onCall?: (call: NodeOf<"call">, args: V[]) => V | undefined; onValue?: (id: Id, v: V) => void }
function makeReader(code: Code, info: Info, mistakes?: Map<Id, string>, hooks: Hooks = {}) {
  const algebras = algebrasOf(code, info);
  const byVariant = new Map([...algebras.values()].map((a) => [a.variant, a]));
  const nodes = code.nodes;
  const lam = (id: Id): NodeOf<"lambda"> | null => {
    let n: Node | undefined = nodes[id];
    if (n?.kind === "def") n = n.body ? nodes[n.body] : undefined;
    return n?.kind === "lambda" ? n : null;
  };
  const maskIn = (v: V, alg: Algebra) => (v.k === "mask" && v.alg === alg ? v.m : alg.full);
  const join = (a: V, b: V): V => {
    if (a.k === "mask" && b.k === "mask" && a.alg === b.alg) return { k: "mask", alg: a.alg, m: a.m | b.m, l: a.l || b.l };
    if (a.k === "num" && b.k === "num") return { k: "num", zero: a.zero && b.zero };
    if (a.k === "list" && b.k === "list") return { k: "list", item: a.item && b.item ? join(a.item, b.item) : a.item ?? b.item };
    return TOP;
  };

  // A value the reading lost: a Float64 is still a number, and a
  // multivector of a known algebra still has every part.
  const byType = new Map<Id, Algebra>();
  for (const a of algebras.values()) {
    const t = code.defs.find((d) => { const b = (nodes[d] as NodeOf<"def">)?.body; const n = b ? nodes[b] : undefined; return n?.kind === "typedef" && n.variants.includes(a.variant); });
    if (t) byType.set(t, a);
  }
  const typed = (id: Id): V => {
    const t0 = info.typeOf.get(id), t = t0 && info.subst.zonk(t0);
    if (t?.t !== "con") return TOP;
    if (t.id === NUMBER) return NUM;
    const a = byType.get(t.id);
    return a ? { k: "mask", alg: a, m: a.full, l: true } : TOP;
  };

  // Named masks (L43e): a field whose type is `Vector of T` (types.ts
  // MASK_TYPES), T an algebra's record type, holds only T's vectors. A
  // value put there is checked; a value read from there has that mask.
  const declared = new Map<Id, { alg: Algebra; m: number; name: string }>();
  // Fields of type List (Vector of T) and the others (L43e3): each item.
  const declaredItems = new Map<Id, { alg: Algebra; m: number; name: string }>();
  for (const d of code.defs) {
    const b = (nodes[d] as NodeOf<"def">)?.body, td = b ? nodes[b] : undefined;
    if (td?.kind !== "typedef") continue;
    for (const v of td.variants) for (const f of (nodes[v] as NodeOf<"variant">)?.fields ?? []) {
      const outer = nodes[(nodes[f] as NodeOf<"field">)?.type];
      const listed = outer?.kind === "tref" && outer.target === LIST && outer.args.length === 1;
      const ty = listed ? nodes[outer.args[0]] : outer;
      const named = ty?.kind === "tref" ? MASK_TYPES[ty.target] : undefined;
      const arg = named && ty?.kind === "tref" && ty.args.length === 1 ? nodes[ty.args[0]] : undefined;
      const alg = arg?.kind === "tref" ? byType.get(arg.target) : undefined;
      if (!named || !alg) continue;
      const m = alg.blades.reduce((acc, bl, i) => ((named.grades === "even" ? bl.length % 2 === 0 : named.grades.includes(bl.length)) ? acc | (1 << i) : acc), 0);
      (listed ? declaredItems : declared).set(f, { alg, m, name: listed ? `a list of ${named.name}` : named.name });
    }
  }
  const fieldsOf = (variant: Id) => (nodes[variant] as NodeOf<"variant">).fields;
  const declares = (variant: Id) => nodes[variant]?.kind === "variant" && fieldsOf(variant).some((f) => declared.has(f) || declaredItems.has(f));
  // A value going where a named mask is: refused when its mask is known
  // and has a part the name doesn't allow.
  const put = (at: Id, field: Id, v: V) => {
    const want = declared.get(field)!;
    if (mistakes && v.k === "mask" && v.alg === want.alg && !v.l && v.m & ~want.m && !mistakes.has(at))
      mistakes.set(at, `puts a value that is ${describeMask(want.alg, v.m)} where ${want.name} goes, ${describeMask(want.alg, want.m)}`);
  };
  const held = (field: Id): V => { const w = declared.get(field)!; return { k: "mask", alg: w.alg, m: w.m }; };
  const heldItems = (field: Id): V => { const w = declaredItems.get(field)!; return { k: "list", item: { k: "mask", alg: w.alg, m: w.m } }; };
  // A list going where each item has a named mask: each item written out
  // in it is checked where it is, and what the rest is known to hold.
  const putItems = (at: Id, field: Id, env: Map<Id, V>, depth: number) => {
    const want = declaredItems.get(field)!;
    const check = (where: Id, v: V) => {
      if (mistakes && v.k === "mask" && v.alg === want.alg && !v.l && v.m & ~want.m && !mistakes.has(where))
        mistakes.set(where, `puts an item that is ${describeMask(want.alg, v.m)} where ${want.name} goes, ${describeMask(want.alg, want.m)} each`);
    };
    let id = at;
    for (;;) {
      const n = nodes[id];
      const f = n?.kind === "call" ? nodes[n.fn] : undefined;
      if (n?.kind === "call" && f?.kind === "ref" && f.target === CONS) { check(n.args[0], ev(n.args[0], env, depth + 1)); id = n.args[1]; continue; }
      const v = ev(id, env, depth + 1);
      if (v.k === "list" && v.item) check(id, v.item);
      return;
    }
  };
  const ev = (id: Id, env: Map<Id, V>, depth: number): V => {
    const v0 = ev1(id, env, depth);
    const v = v0.k === "top" ? typed(id) : v0;
    hooks.onValue?.(id, v);
    return v;
  };
  const ev1 = (id: Id, env: Map<Id, V>, depth: number): V => {
    if (depth > DEPTH) return TOP;
    const n = nodes[id];
    if (!n) return TOP;
    switch (n.kind) {
      case "lit": return typeof n.value === "number" ? { k: "num", zero: n.value === 0 } : TOP;
      case "lambda": return { k: "closure", lambda: n, env };
      case "ref": {
        if (env.has(n.target)) return env.get(n.target)!;
        if (n.target === NIL) return { k: "list", item: null };
        const alg = algebras.get(n.target);
        if (alg) return { k: "alg", alg };
        const t = nodes[n.target];
        if (t?.kind === "def" && t.body && depth < DEPTH) {
          const b = nodes[t.body];
          return b?.kind === "lambda" ? { k: "closure", lambda: b, env: new Map() } : ev(t.body, new Map(), depth + 1);
        }
        return TOP;
      }
      case "call": return call(n, env, depth);
      case "match": {
        // A record taken apart: its parts are numbers, zero where masked off.
        const s = ev(n.scrutinee, env, depth + 1);
        const arms = n.arms.map((a) => nodes[a] as NodeOf<"arm">);
        if (s.k === "mask" && arms.length === 1 && arms[0].variant === s.alg.variant) {
          const inner = new Map(env);
          arms[0].binds.forEach((b, i) => inner.set(b, { k: "num", zero: !((s.m >> i) & 1) }));
          return ev(arms[0].body, inner, depth + 1);
        }
        // Otherwise every arm may run: the union of what they give. A
        // field with a named mask binds that mask; a list's head binds
        // what its items are, and its tail the list.
        const bind = (a: NodeOf<"arm">, b: Id, i: number): V => {
          if (s.k === "list" && a.variant === CONS) return i === 0 ? s.item ?? TOP : s;
          const f = nodes[a.variant]?.kind === "variant" ? fieldsOf(a.variant)[i] : undefined;
          return f && declared.has(f) ? held(f) : f && declaredItems.has(f) ? heldItems(f) : TOP;
        };
        const outs = [...arms.map((a) => ev(a.body, new Map([...env, ...a.binds.map((b, i) => [b, bind(a, b, i)] as const)]), depth + 1)), ...(n.otherwise ? [ev(n.otherwise, env, depth + 1)] : [])];
        return outs.length ? outs.reduce(join) : TOP;
      }
      default: return TOP;
    }
  };

  const apply = (f: V, args: V[], depth: number): V => {
    if (f.k !== "closure") return TOP;
    const env = new Map(f.env);
    f.lambda.params.forEach((p, i) => env.set(p, args[i] ?? TOP));
    return ev(f.lambda.body, env, depth + 1);
  };

  const call = (n: NodeOf<"call">, env: Map<Id, V>, depth: number): V => {
    const fnNode = nodes[n.fn];
    const target = fnNode?.kind === "ref" ? fnNode.target : null;
    const arg = (i: number) => ev(n.args[i], env, depth + 1);
    if (target && byVariant.has(target)) {
      const alg = byVariant.get(target)!;
      return { k: "mask", alg, m: n.args.reduce((m, a, i) => { const v = ev(a, env, depth + 1); return v.k === "num" && v.zero ? m : m | (1 << i); }, 0) };
    }
    if (target && declares(target)) {
      fieldsOf(target).forEach((f, i) => { if (declared.has(f) && n.args[i]) put(n.args[i], f, arg(i)); if (declaredItems.has(f) && n.args[i]) putItems(n.args[i], f, env, depth); });
      return TOP;
    }
    if (target && declared.has(target)) return held(target);
    if (target && declaredItems.has(target)) return heldItems(target);
    if (target === CONS) {
      const [h, t] = [arg(0), arg(1)];
      return { k: "list", item: t.k === "list" ? (t.item ? join(h, t.item) : h) : TOP };
    }
    if (target === S_SET) {
      const fr = nodes[n.args[0]];
      if (fr?.kind === "ref" && declared.has(fr.target)) { put(n.args[2], fr.target, arg(2)); return TOP; }
      if (fr?.kind === "ref" && declaredItems.has(fr.target)) { putItems(n.args[2], fr.target, env, depth); return TOP; }
    }
    if (target && (ADD.has(target) || SUB.has(target))) {
      const [a, b] = [arg(0), arg(1)];
      return a.k === "num" && b.k === "num" ? { k: "num", zero: a.zero && b.zero } : join(a, b);
    }
    if (target && (MUL.has(target) || DIV.has(target))) {
      const [a, b] = [arg(0), arg(1)];
      if (a.k === "num" && b.k === "num") return { k: "num", zero: a.zero || (MUL.has(target) && b.zero) };
      if (a.k === "num" && b.k === "mask") return a.zero ? { ...b, m: 0 } : b;
      if (a.k === "mask" && b.k === "num") return MUL.has(target) && b.zero ? { ...a, m: 0 } : a;
      return TOP;
    }
    if (target && NEG.has(target)) { const a = arg(0); return a.k === "num" || a.k === "mask" ? a : TOP; }
    if (target === S.zipParts) {
      const [f, a, b] = [arg(0), arg(1), arg(2)];
      const op = nodes[n.args[0]]?.kind === "ref" ? (nodes[n.args[0]] as NodeOf<"ref">).target : null;
      if (a.k === "mask" && b.k === "mask" && a.alg === b.alg) {
        // A part is off when f of two zeros is zero, as for + and −.
        const z = op && (ADD.has(op) || SUB.has(op)) ? { k: "num", zero: true } as V : apply(f, [{ k: "num", zero: true }, { k: "num", zero: true }], depth);
        return z.k === "num" && z.zero ? { k: "mask", alg: a.alg, m: a.m | b.m, l: a.l || b.l } : { k: "mask", alg: a.alg, m: a.alg.full, l: a.l || b.l };
      }
      return TOP;
    }
    if (target === S.mapParts) {
      const [f, x] = [arg(0), arg(1)];
      if (x.k !== "mask") return TOP;
      const z = apply(f, [{ k: "num", zero: true }], depth);
      return z.k === "num" && z.zero ? x : { ...x, m: x.alg.full };
    }
    const op = target ? byId.get(target) : undefined;
    if (op && op !== "algebra") {
      const al = arg(0);
      if (al.k !== "alg") return TOP;
      const alg = al.alg;
      // A result is loose when a multivector it was made from is.
      let loose = false;
      const m = (i: number) => { const v = arg(i); if (!(v.k === "mask" && v.alg === alg && !v.l)) loose = true; return maskIn(v, alg); };
      const mask = (x: number): V => ({ k: "mask", alg, m: x, l: loose });
      switch (op) {
        case "product": case "outer": case "inner": case "regressive": return mask(binary(alg, op, m(1), m(2)));
        case "reverse": case "involute": case "dual": case "undual": return mask(unary(alg, op, m(1)));
        // ṽ / ⟨v ṽ⟩₀: the reverse's blades.
        case "versor inverse": return mask(unary(alg, "reverse", m(1)));
        // A reflection in a vector keeps grades (it is an outermorphism).
        // So does R x R̃ for any even R when no blade has more than three
        // vectors: it keeps x's parity (even · x · even) and its sign under
        // the reverse, and grades 0 to 3 all differ in one or the other.
        // Otherwise the products' blades.
        case "sandwich": { const r = m(1), x = m(2); const y = binary(alg, "product", binary(alg, "product", r, x), unary(alg, "reverse", r)); return mask(versor(alg, r) ? y & sameGrades(alg, x) : y); }
        case "reflect": { const nv = m(1), x = m(2); const y = binary(alg, "product", binary(alg, "product", unary(alg, "involute", nv), x), unary(alg, "reverse", nv)); return mask(versor(alg, nv) ? y & sameGrades(alg, x) : y); }
        case "project": { const b = m(1), x = m(2); return mask(x | binary(alg, "product", binary(alg, "product", unary(alg, "involute", b), x), unary(alg, "reverse", b))); }
        case "exp": {
          // 1 and b, closed under the product: the series and the closed forms both stay inside.
          const one = alg.blades.findIndex((b) => b.length === 0);
          let x = (1 << one) | m(1);
          for (;;) { const y = x | binary(alg, "product", x, x); if (y === x) return mask(x); x = y; }
        }
        case "grade": {
          const g = nodes[n.args[1]];
          const x = m(2);
          return g?.kind === "lit" && typeof g.value === "number" ? mask(bits(x).filter((i) => gradeOf(alg, i) === g.value).reduce((a, i) => a | (1 << i), 0)) : mask(x);
        }
        case "part": {
          // Reading a blade outside x's mask always gives 0: a wrong grade
          // (L43e, Ersagun 2026-10-31). The mask is never too small, so
          // this never refuses a read that could be nonzero.
          const i = blade(alg, n.args[2]), x = m(1);
          if (mistakes && i >= 0 && !((x >> i) & 1) && !mistakes.has(n.id))
            mistakes.set(n.id, `reads the ${describeMask(alg, 1 << i)} part of a value that is ${describeMask(alg, x)}, so it is always 0`);
          return NUM;
        }
        case "with part": {
          // The blade named by literal vectors, or any.
          const i = blade(alg, n.args[2]);
          return mask(m(1) | (i >= 0 ? 1 << i : i === -1 ? 0 : alg.full));
        }
      }
    }
    // A let, a lambda applied, a definition of the program: read through.
    if (target && hooks.onCall && nodes[target]?.kind === "def") {
      const r = hooks.onCall(n, n.args.map((a) => ev(a, env, depth + 1)));
      if (r) return r;
    }
    const f = ev(n.fn, env, depth + 1);
    if (f.k !== "closure") return TOP;
    return apply(f, n.args.map((a) => ev(a, env, depth + 1)), depth);
  };

  // The blade a list of literal vectors names: its index, -1 when it
  // names none, -2 when the list isn't literals.
  const blade = (alg: Algebra, id: Id): number => {
    const vs = listLits(id);
    return vs ? alg.blades.findIndex((b) => b.length === vs.length && [...b].sort().join() === [...new Set(vs)].sort().join() && new Set(vs).size === vs.length) : -2;
  };

  // A list written out of Int or Float64 literals.
  const listLits = (id: Id): number[] | null => {
    const out: number[] = [];
    let c = nodes[id];
    for (;;) {
      if (c?.kind === "ref" && c.target === NIL) return out;
      if (c?.kind !== "call") return null;
      const f = nodes[c.fn];
      if (f?.kind === "ref" && f.target === NIL) return out;
      if (f?.kind !== "ref" || f.target !== CONS) return null;
      const h = nodes[c.args[0]];
      if (h?.kind !== "lit") return null;
      out.push(Number(h.value));
      c = nodes[c.args[1]];
    }
  };

  return { algebras, ev, lam, byType };
}

export function bladeMask(code: Code, info: Info, fn: Id, given: (number | null)[] = [], mistakes?: Map<Id, string>): { algebra: Algebra; mask: number } | null {
  if (!algebrasOf(code, info).size) return null;
  const { algebras, ev, lam } = makeReader(code, info, mistakes);
  const l = lam(fn);
  const env = new Map<Id, V>();
  // An input given as a mask: of which algebra, if there's only one.
  const only = algebras.size === 1 ? [...algebras.values()][0] : null;
  l?.params.forEach((p, i) => env.set(p, given[i] != null && only ? { k: "mask", alg: only, m: given[i]! } : TOP));
  const v = l ? ev(l.body, env, 0) : ev(fn, env, 0);
  return v.k === "mask" ? { algebra: v.alg, mask: v.m } : null;
}

// The masks a program's values have wherever they are made (L43c), for
// the compiler: each definition's inputs are what its callers give it, the
// union over every call, worked out to a fixed point (a definition that
// calls itself gives its own inputs). A definition `open` names (called
// from outside: main, an export), or used other than by being called, has
// inputs of every part. Then each node a definition reads directly (not
// inside a lambda it hands on) has the union of what it was each time.
//
// A call the reading didn't reach in its own definition (past the depth,
// inside a fold's arms) or made from inside a lambda handed on (whose
// callers aren't known) gives its callee every part, so a mask is never
// too small. Off still means 0 in exact arithmetic, as above.
export function valueMasks(code: Code, info: Info, open: Iterable<Id>): Map<Id, { algebra: Algebra; mask: number }> {
  const out = new Map<Id, { algebra: Algebra; mask: number }>();
  if (!algebrasOf(code, info).size) return out;
  const nodes = code.nodes;
  // The program's own definitions; the library's are read as before.
  const fnDefs = code.defs.filter((d) => { const n = nodes[d] as NodeOf<"def">; return !LIBRARY.code.nodes[d] && n?.kind === "def" && !n.way && !!n.body && nodes[n.body]?.kind === "lambda"; });
  const isFn = new Set(fnDefs);
  // Each definition's own nodes: its body, through lets (a lambda called
  // where it is) but not into a lambda handed on.
  const own = new Map<Id, Set<Id>>(), ownerOf = new Map<Id, Id>();
  for (const d of fnDefs) {
    const set = new Set<Id>();
    const walk = (id: Id) => {
      const n = nodes[id];
      if (!n || set.has(id)) return;
      if (n.kind === "lambda" && id !== (nodes[d] as NodeOf<"def">).body) return;
      set.add(id);
      if (n.kind === "call" && nodes[n.fn]?.kind === "lambda") { set.add(n.fn); walk(node(n.fn).body); n.args.forEach(walk); return; }
      for (const c of childIds(n)) walk(c);
    };
    const lam = nodes[(nodes[d] as NodeOf<"def">).body!] as NodeOf<"lambda">;
    set.add(lam.id);
    walk(lam.body);
    own.set(d, set);
    for (const id of set) ownerOf.set(id, d);
  }
  function node(id: Id) { return nodes[id] as NodeOf<"lambda">; }
  // Every input of a definition called from somewhere unknown, or used as
  // a value, is every part.
  const wide = new Set<Id>([...open].filter((d) => isFn.has(d)));
  // Only what the open definitions reach calls anything: a definition no
  // one runs (a shader's other entry points, say) widens nothing.
  const reached: Node[] = [];
  for (const d of new Set([...open].flatMap((r) => (nodes[r] ? [r, ...dependencies(code, r)] : [])))) {
    if (nodes[d]?.kind === "def") for (const id of subtree(code, d)) reached.push(nodes[id]);
  }
  const sites = new Map<Id, Id>(); // call → callee
  for (const n of reached) {
    if (n.kind === "call") { const f = nodes[n.fn]; if (f?.kind === "ref" && isFn.has(f.target)) sites.set(n.id, f.target); }
  }
  const called = new Set([...sites.keys()].map((c) => (nodes[c] as NodeOf<"call">).fn));
  for (const n of reached) if (n.kind === "ref" && isFn.has(n.target) && !called.has(n.id)) wide.add(n.target);
  // A call from no definition's own nodes (inside a lambda handed on, or
  // outside every definition) widens its callee.
  for (const [c, callee] of sites) if (!ownerOf.has(c)) wide.add(callee);
  const reader0 = makeReader(code, info);
  const algOf = (b: Id) => { const t0 = info.typeOf.get(b), t = t0 && info.subst.zonk(t0); return t?.t === "con" ? reader0.byType.get(t.id) : undefined; };
  // What each input is so far: a mask (from 0, nothing seen) per input of
  // a multivector type; others are read as the reading reads them.
  const given = new Map<Id, number>();
  for (const d of fnDefs) for (const p of node((nodes[d] as NodeOf<"def">).body!).params) { const a = algOf(p); if (a) given.set(p, wide.has(d) ? a.full : 0); }
  const envFor = (d: Id) => {
    const env = new Map<Id, V>();
    for (const p of node((nodes[d] as NodeOf<"def">).body!).params) { const a = algOf(p); env.set(p, a ? { k: "mask", alg: a, m: given.get(p)! } : TOP); }
    return env;
  };
  // What each definition gives so far: a mask (from 0) when it gives a
  // multivector, read from its own body each round; otherwise unknown.
  const gives = new Map<Id, V>();
  for (const d of fnDefs) {
    const t0 = info.typeOf.get(d), t = t0 && info.subst.zonk(t0);
    const r = t?.t === "fn" ? info.subst.zonk(t.ret) : undefined;
    const a = r?.t === "con" ? reader0.byType.get(r.id) : undefined;
    gives.set(d, a ? { k: "mask", alg: a, m: 0 } : TOP);
  }
  let seen = new Map<Id, V>(), settled = false;
  for (let round = 0; round < 64 && !settled; round++) {
    let changed = false;
    seen = new Map();
    for (const d of fnDefs) {
      const mine = own.get(d)!, reached = new Set<Id>();
      const widen = (callee: Id, args: V[]) => {
        node((nodes[callee] as NodeOf<"def">).body!).params.forEach((p, i) => {
          if (!given.has(p)) return;
          const a = algOf(p)!, v = args[i];
          const m = v && v.k === "mask" && v.alg === a && !v.l ? v.m : a.full;
          const now = given.get(p)! | m;
          if (now !== given.get(p)) { given.set(p, now); changed = true; }
        });
      };
      const r = makeReader(code, info, undefined, {
        onCall: (c, args) => {
          const callee = sites.get(c.id);
          if (!callee) return undefined;
          if (mine.has(c.id)) { reached.add(c.id); widen(callee, args); }
          return gives.get(callee);
        },
        onValue: (id, v) => { if (!mine.has(id)) return; const was = seen.get(id); seen.set(id, was ? joinMasks(was, v) : v); },
      });
      const got = r.ev(node((nodes[d] as NodeOf<"def">).body!).body, envFor(d), 0);
      const was = gives.get(d)!;
      if (was.k === "mask") {
        const m = got.k === "mask" && got.alg === was.alg && !got.l ? was.m | got.m : was.alg.full;
        if (m !== was.m) { gives.set(d, { ...was, m }); changed = true; }
      }
      for (const c of mine) if (sites.has(c) && !reached.has(c)) widen(sites.get(c)!, []);
    }
    settled = !changed;
  }
  // Not settled is not known: nothing is said.
  if (!settled) return out;
  for (const [id, v] of seen) if (v.k === "mask" && !v.l) out.set(id, { algebra: v.alg, mask: v.m });
  return out;
}

const joinMasks = (a: V, b: V): V => (a.k === "mask" && b.k === "mask" && a.alg === b.alg ? { k: "mask", alg: a.alg, m: a.m | b.m, l: a.l || b.l } : { k: "top" });

// Wrong grades (L43e's first step): every place a definition reads a part
// its value can't have, which is always 0. Each definition is read with
// its inputs every part, and what it calls with the masks it gives them.
export function gradeMistakes(code: Code, info: Info, defs: Id[]): { at: Id; def: Id; message: string }[] {
  const out: { at: Id; def: Id; message: string }[] = [];
  const seen = new Set<Id>();
  for (const d of defs) {
    const found = new Map<Id, string>();
    bladeMask(code, info, d, [], found);
    for (const [at, message] of found) if (!seen.has(at)) { seen.add(at); out.push({ at, def: d, message }); }
  }
  return out;
}

const SUB_DIGITS = "₀₁₂₃₄₅₆₇₈₉";
const sub = (n: number) => String(n).split("").map((d) => SUB_DIGITS[Number(d)]).join("");
const GRADE = ["a scalar", "a vector", "a bivector", "a trivector"];

// A mask in words: "a vector", "even", or its blades.
export function describeMask(alg: Algebra, mask: number): string {
  const on = bits(mask);
  if (!on.length) return "0";
  const grades = new Set(on.map((i) => gradeOf(alg, i)));
  const all = (g: (k: number) => boolean) => alg.blades.every((b, i) => !g(b.length) || ((mask >> i) & 1));
  if (grades.size === 1) {
    const [g] = grades;
    if (all((k) => k === g)) return GRADE[g] ?? `grade ${g}`;
  }
  if ([...grades].every((g) => g % 2 === 0) && all((k) => k % 2 === 0)) return "even (a rotor or motor)";
  if ([...grades].every((g) => g % 2 === 1) && all((k) => k % 2 === 1)) return "odd";
  return on.map((i) => (alg.blades[i].length ? `e${alg.blades[i].map(sub).join("")}` : "1")).join(", ");
}

// For the record: a value's mask, read off a value the evaluator gave.
export const maskOfValue = (v: Value): number => ((v as { fields: number[] }).fields ?? []).reduce((m, x, i) => (x !== 0 ? m | (1 << i) : m), 0);
