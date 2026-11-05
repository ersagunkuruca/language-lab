// Which parts of a multivector can be nonzero (GRADES.md, BACKLOG L43b).
//
// For an algebra the program writes down (a definition with no inputs
// whose value is `clifford algebra(squares, basis)`), each multivector a
// function makes gets a blade mask: bit i set when its part i may be
// nonzero. The reading is an abstract evaluation, as linear.ts reads a
// matrix: literals and records built by position give their mask
// directly (a part written as the literal 0 is off), + and − take the
// union, a number times a multivector keeps its mask, and the prelude's
// Clifford operations are read through their own code (L203): the
// products are folds over the algebra's table, known before running, and
// the duals, the reverse and the involution folds over its blades. A few
// keep a rule by name that is sharper than their code (NAMED below). Those
// rules use each operation's table of masks over pairs of basis elements,
// worked out from the blades and the squares as the prelude defines each
// operation (so in PGA a product landing on e₀e₀ = 0 drops out), or, for
// a basis that isn't one 1 per element, by running the operation on the
// basis elements. Anything the reading doesn't follow is every part, so a
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

import { children as childIds, dependencies, subtree, type Code, type Id, type Node, type NodeOf, isCall, type Call, isUse } from "../model.ts";
import type { Info } from "./infer.ts";
import { LIBRARY } from "./library.ts";
import { makeRunner, type Value } from "./run.ts";
import { ALGEBRA_V, ARITH, CONS, LIST, NIL, S, SET as S_SET, TRUE, writtenItems } from "./std.ts";
import { B } from "../prelude.ts";
import { hashes } from "../hash.ts";
import { MASK_TYPES, NUMBER, type Type } from "./types.ts";

export interface Algebra {
  // The definition whose value it is, and the record variant of its
  // multivectors.
  def: Id;
  variant: Id;
  // The algebra's own value: its squares, basis, pairs and table.
  value: Value;
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
  // A value of a case with fields (a record, a tuple) and what each field
  // is (C77): a state record's multivectors keep their masks through it.
  | { k: "rec"; variant: Id; fields: V[] }
  // A value known before running (L203b): a definition's value that runs
  // (a table), the algebra's fields, a part of either.
  | { k: "known"; v: Value }
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
// The program's own definitions that are one of those by what they are,
// not by name or id (L203a): a copy of the prelude's Clifford operations,
// as a library of its own holds them, has the prelude's meaning hash
// (hash.ts; a library id is `@` and its hash), so it reads the same way.
const opsCache = new WeakMap<Code, Map<Id, string>>();
function cliffordOps(code: Code): Map<Id, string> {
  let ops = opsCache.get(code);
  if (ops) return ops;
  ops = new Map(byId);
  const own = code.defs.filter((d) => !LIBRARY.code.nodes[d] && code.nodes[d]?.kind === "def");
  if (own.length) {
    try {
      for (const [d, h] of hashes(code, own)) { const op = own.includes(d) ? byId.get(`@${h}`) : undefined; if (op) ops.set(d, op); }
    } catch { /* a program that doesn't hash is read by the prelude's ids only */ }
  }
  opsCache.set(code, ops);
  return ops;
}

// A mask says which parts of a record can be nonzero, so two algebras on
// one record (a program's own and a copy's, or Cl(3, 0) and Cl(2, 1) on
// eight parts) have masks that mean the same.
const sameRecord = (a: Algebra, b: Algebra) => a === b || (a.variant === b.variant && a.parts === b.parts);

// Library calls already read, by their inputs, per program.
const readsCache = new WeakMap<Code, Map<string, V>>();
const readsOf = (code: Code) => { let m = readsCache.get(code); if (!m) readsCache.set(code, (m = new Map())); return m; };
// A known value's key: its identity.
const knownKeys = new WeakMap<object, number>();
let knownCount = 0;
const knownKey = (v: Value): string => {
  if (typeof v !== "object" || v === null) return JSON.stringify(v);
  let k = knownKeys.get(v);
  if (k === undefined) knownKeys.set(v, (k = ++knownCount));
  return `#${k}`;
};

// The operations still read by name (L203): each has a rule sharper than
// reading its code gives. The sandwich and the reflection keep grades
// (the grade rule below), the exponential is closed under the product,
// and a part named by literal vectors is found by its blade. The others
// (the geometric, outer, inner and regressive products, the duals, the
// reverse, the involution and the versor inverse) are read from their own
// code, folds over the algebra's known table and blades, with the same
// masks (grades.test.ts).
const NAMED = new Set(["sandwich", "reflect", "project", "exp", "grade", "part", "with part"]);

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
    if (!isCall(body) || (code.nodes[body.fn] as Node)?.kind !== "ref" || cliffordOps(code).get((code.nodes[body.fn] as NodeOf<"ref">).target) !== "algebra") continue;
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
        def: d, variant: elements[0].tag, value: al, parts, blades, full,
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
interface Hooks { onCall?: (call: Call, args: V[]) => V | undefined; onValue?: (id: Id, v: V) => void }
function makeReader(code: Code, info: Info, mistakes?: Map<Id, string>, hooks: Hooks = {}) {
  const algebras = algebrasOf(code, info);
  const ops = cliffordOps(code);
  const byVariant = new Map([...algebras.values()].map((a) => [a.variant, a]));
  const nodes = code.nodes;
  const lam = (id: Id): NodeOf<"lambda"> | null => {
    let n: Node | undefined = nodes[id];
    if (n?.kind === "def") n = n.body ? nodes[n.body] : undefined;
    return n?.kind === "lambda" ? n : null;
  };
  const maskIn = (v: V, alg: Algebra) => (v.k === "mask" && sameRecord(v.alg, alg) ? v.m : alg.full);
  // A known value read as the reading's own: a number is a number, zero or
  // not, and a multivector of an algebra its mask of nonzero parts.
  const lower = (v: V): V => {
    if (v.k !== "known") return v;
    const x = v.v as { tag?: Id; fields?: Value[] };
    if (typeof v.v === "number") return { k: "num", zero: v.v === 0 };
    const alg = x && typeof x === "object" && x.tag !== undefined ? byVariant.get(x.tag) : undefined;
    if (alg && x.fields!.every((f) => typeof f === "number")) return { k: "mask", alg, m: (x.fields as number[]).reduce((m, f, i) => (f !== 0 ? m | (1 << i) : m), 0) };
    return v;
  };
  // A multivector with no part on is known: the record of zeros.
  const zeros = new Map<Id, Value>();
  const knownOf = (v: V): Value | undefined => {
    if (v.k === "known") return v.v;
    if (v.k === "alg") return v.alg.value;
    if (v.k === "mask" && v.m === 0 && !v.l) {
      let z = zeros.get(v.alg.variant);
      if (!z) zeros.set(v.alg.variant, (z = { tag: v.alg.variant, fields: Array.from({ length: v.alg.parts }, () => 0) } as Value));
      return z;
    }
    return undefined;
  };
  // What a scrutinee is known to be: read so, or a definition's value.
  const knownAt = (id: Id, v: V): Value | undefined => {
    const k = knownOf(v);
    if (k !== undefined) return k;
    const n = nodes[id];
    return n?.kind === "ref" && nodes[n.target]?.kind === "def" ? valueOf(n.target) : undefined;
  };
  // A definition's value that runs, kept (a table written down or worked
  // out from literals); undefined when it doesn't run or isn't data.
  let runner: ReturnType<typeof makeRunner> | undefined;
  const ran = new Map<Id, Value | undefined>();
  const valueOf = (d: Id): Value | undefined => {
    if (ran.has(d)) return ran.get(d);
    let v: Value | undefined;
    const def = nodes[d] as NodeOf<"def"> | undefined, t = info.typeOf.get(d), z = t && info.subst.zonk(t);
    if (def?.kind === "def" && def.body && nodes[def.body]?.kind !== "lambda" && z?.t === "con") {
      try { v = (runner ??= makeRunner(code, info, { print: () => {} })).value(d); } catch { v = undefined; }
    }
    ran.set(d, v);
    return v;
  };
  // Known data taken apart by a fold: each case's body read with its
  // fields known and its recursive fields' results folded first.
  const foldKnown = (x: Value, arms: NodeOf<"arm">[], env: Map<Id, V>, depth: number, left: { n: number }): V => {
    const r = x as { tag?: Id; fields?: Value[] };
    if (!r || typeof r !== "object" || r.tag === undefined || --left.n < 0) return TOP;
    const arm = arms.find((a) => a.variant === r.tag);
    if (!arm) return TOP;
    const inner = new Map(env);
    arm.binds.forEach((b, i) => inner.set(b, { k: "known", v: r.fields![i] }));
    for (const [i, res] of arm.results.entries()) if (res) inner.set(res, foldKnown(r.fields![i], arms, env, depth, left));
    return ev(arm.body, inner, depth + 1);
  };
  const join = (a0: V, b0: V): V => {
    const a = lower(a0), b = lower(b0);
    if (a.k === "mask" && b.k === "mask" && sameRecord(a.alg, b.alg)) return { k: "mask", alg: a.alg, m: a.m | b.m, l: a.l || b.l };
    if (a.k === "num" && b.k === "num") return { k: "num", zero: a.zero && b.zero };
    if (a.k === "list" && b.k === "list") return { k: "list", item: a.item && b.item ? join(a.item, b.item) : a.item ?? b.item };
    if (a.k === "rec" && b.k === "rec" && a.variant === b.variant) return { k: "rec", variant: a.variant, fields: a.fields.map((f, i) => join(f, b.fields[i] ?? TOP)) };
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
  // A case of a data type with fields, not an effect's operation.
  const isData = (variant: Id) => {
    const v = nodes[variant];
    if (v?.kind !== "variant" || !v.fields.length || v.returns || v.later) return false;
    const owner = info.owner.get(variant), body = owner ? (nodes[owner] as NodeOf<"def"> | undefined)?.body : undefined, td = body ? nodes[body] : undefined;
    return td?.kind === "typedef" && !td.effect;
  };
  const declares = (variant: Id) => nodes[variant]?.kind === "variant" && fieldsOf(variant).some((f) => declared.has(f) || declaredItems.has(f));
  // A value going where a named mask is: refused when its mask is known
  // and has a part the name doesn't allow.
  const put = (at: Id, field: Id, v: V) => {
    const want = declared.get(field)!;
    if (mistakes && v.k === "mask" && sameRecord(v.alg, want.alg) && !v.l && v.m & ~want.m && !mistakes.has(at))
      mistakes.set(at, `puts a value that is ${describeMask(want.alg, v.m)} where ${want.name} goes, ${describeMask(want.alg, want.m)}`);
  };
  const held = (field: Id): V => { const w = declared.get(field)!; return { k: "mask", alg: w.alg, m: w.m }; };
  const heldItems = (field: Id): V => { const w = declaredItems.get(field)!; return { k: "list", item: { k: "mask", alg: w.alg, m: w.m } }; };
  // A list going where each item has a named mask: each item written out
  // in it is checked where it is, and what the rest is known to hold.
  const putItems = (at: Id, field: Id, env: Map<Id, V>, depth: number) => {
    const want = declaredItems.get(field)!;
    const check = (where: Id, v: V) => {
      if (mistakes && v.k === "mask" && sameRecord(v.alg, want.alg) && !v.l && v.m & ~want.m && !mistakes.has(where))
        mistakes.set(where, `puts an item that is ${describeMask(want.alg, v.m)} where ${want.name} goes, ${describeMask(want.alg, want.m)} each`);
    };
    let id = at;
    for (;;) {
      const n = nodes[id];
      const f = isCall(n) ? nodes[n.fn] : undefined;
      if (isCall(n) && f?.kind === "ref" && f.target === CONS) { check(n.args[0], ev(n.args[0], env, depth + 1)); id = n.args[1]; continue; }
      if (isCall(n) && f?.kind === "ref" && f.target === S.listOf) { for (const x of n.args) check(x, ev(x, env, depth + 1)); return; }
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
      case "call": return isUse(n) ? TOP : call(n, env, depth);
      case "match": {
        // A record taken apart: its parts are numbers, zero where masked off.
        const s0 = ev(n.scrutinee, env, depth + 1);
        const arms = n.arms.map((a) => nodes[a] as NodeOf<"arm">);
        // Known data: only its case's arm, its fields known (L203b).
        const kv = knownAt(n.scrutinee, s0) as { tag?: Id; fields?: Value[] } | undefined;
        if (kv && typeof kv === "object" && kv.tag !== undefined) {
          const arm = arms.find((a) => a.variant === kv.tag && a.value === undefined);
          if (arm) return ev(arm.body, new Map([...env, ...arm.binds.map((b, i) => [b, { k: "known", v: kv.fields![i] } as V] as const)]), depth + 1);
        }
        const s = lower(s0);
        if (s.k === "mask" && arms.length === 1 && arms[0].variant === s.alg.variant) {
          const inner = new Map(env);
          arms[0].binds.forEach((b, i) => inner.set(b, { k: "num", zero: !((s.m >> i) & 1) }));
          return ev(arms[0].body, inner, depth + 1);
        }
        // A case value whose case is known: only its arm runs, given what
        // each field is (C77).
        if (s.k === "rec") {
          const arm = arms.find((a) => a.variant === s.variant);
          if (arm) return ev(arm.body, new Map([...env, ...arm.binds.map((b, i) => [b, s.fields[i] ?? TOP] as const)]), depth + 1);
          if (n.otherwise) return ev(n.otherwise, env, depth + 1);
        }
        // Otherwise every arm may run: the union of what they give. A
        // field with a named mask binds that mask; a list's head binds
        // what its items are, and its tail the list.
        const bind = (a: NodeOf<"arm">, b: Id, i: number): V => {
          if (s.k === "list" && a.variant === CONS) return i === 0 ? s.item ?? TOP : s;
          const f = nodes[a.variant]?.kind === "variant" ? fieldsOf(a.variant)[i] : undefined;
          return f && declared.has(f) ? held(f) : f && declaredItems.has(f) ? heldItems(f) : TOP;
        };
        // An arm that fails gives no value, so nothing to the union (L203e).
        const fails = (id: Id) => { const b = nodes[id]; const f = isCall(b) ? nodes[b.fn] : undefined; return f?.kind === "ref" && f.target === S.fail; };
        const outs = [...arms.filter((a) => !fails(a.body)).map((a) => ev(a.body, new Map([...env, ...a.binds.map((b, i) => [b, bind(a, b, i)] as const)]), depth + 1)), ...(n.otherwise && !fails(n.otherwise) ? [ev(n.otherwise, env, depth + 1)] : [])];
        return outs.length ? outs.reduce(join) : TOP;
      }
      case "fold": {
        // Known data folded case by case (a table's lines): exact (L203b).
        const kv = knownAt(n.scrutinee, ev(n.scrutinee, env, depth + 1));
        return kv === undefined ? TOP : foldKnown(kv, n.arms.map((a) => nodes[a] as NodeOf<"arm">), env, depth, { n: 1 << 16 });
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

  const call = (n: Call, env: Map<Id, V>, depth: number): V => {
    const fnNode = nodes[n.fn];
    const target = fnNode?.kind === "ref" ? fnNode.target : null;
    const raw = (i: number) => ev(n.args[i], env, depth + 1);
    const arg = (i: number) => lower(raw(i));
    if (target && byVariant.has(target)) {
      const alg = byVariant.get(target)!;
      return { k: "mask", alg, m: n.args.reduce((m, a, i) => { const v = ev(a, env, depth + 1); return v.k === "num" && v.zero ? m : m | (1 << i); }, 0) };
    }
    if (target && declares(target)) {
      fieldsOf(target).forEach((f, i) => { if (declared.has(f) && n.args[i]) put(n.args[i], f, arg(i)); if (declaredItems.has(f) && n.args[i]) putItems(n.args[i], f, env, depth); });
    }
    // A case with fields built: what each field is (C77). A list's cons is
    // read as a list, below.
    if (target && target !== CONS && isData(target) && n.args.length === fieldsOf(target).length)
      return { k: "rec", variant: target, fields: n.args.map((_, i) => arg(i)) };
    // A field read from a case value whose fields are known; a named mask
    // where it says more.
    if (target && nodes[target]?.kind === "field" && n.args.length === 1) {
      const kx = knownOf(raw(0)) as { tag?: Id; fields?: Value[] } | undefined;
      if (kx && typeof kx === "object" && kx.tag !== undefined && nodes[kx.tag]?.kind === "variant") {
        const j = fieldsOf(kx.tag).indexOf(target);
        if (j >= 0) return { k: "known", v: kx.fields![j] };
      }
      const x = arg(0), i = x.k === "rec" ? fieldsOf(x.variant).indexOf(target) : -1;
      const v = x.k === "rec" && i >= 0 ? x.fields[i] : TOP;
      if (declared.has(target) && !(v.k === "mask" && !v.l)) return held(target);
      if (declaredItems.has(target) && v.k !== "list") return heldItems(target);
      if (v.k !== "top") return v;
    }
    if (target && declared.has(target)) return held(target);
    if (target && declaredItems.has(target)) return heldItems(target);
    if (target === CONS) {
      const [h, t] = [arg(0), arg(1)];
      return { k: "list", item: t.k === "list" ? (t.item ? join(h, t.item) : h) : TOP };
    }
    // A written list (L181d): its items joined, as the conses would give.
    if (target === S.listOf) {
      const items = n.args.map((_, i) => arg(i));
      return { k: "list", item: items.reduce((a, b) => join(a, b)) };
    }
    if (target === S_SET) {
      const fr = nodes[n.args[0]];
      if (fr?.kind === "ref" && declared.has(fr.target)) put(n.args[2], fr.target, arg(2));
      if (fr?.kind === "ref" && declaredItems.has(fr.target)) putItems(n.args[2], fr.target, env, depth);
      // A record with one field changed: the others as they were (C77).
      const r = arg(1), i = fr?.kind === "ref" && r.k === "rec" ? fieldsOf(r.variant).indexOf(fr.target) : -1;
      if (r.k === "rec" && i >= 0) return { ...r, fields: r.fields.map((f, j) => (j === i ? arg(2) : f)) };
      return TOP;
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
      if (a.k === "mask" && b.k === "mask" && sameRecord(a.alg, b.alg)) {
        // A part is off when f of two zeros is zero, as for + and −.
        const Z: V = { k: "num", zero: true };
        const z = op && (ADD.has(op) || SUB.has(op)) ? Z : apply(f, [Z, Z], depth);
        // Off where either is, when a zero on either side gives zero (·).
        const zeroes = (v: V) => v.k === "num" && v.zero;
        if (op && MUL.has(op) || (zeroes(apply(f, [Z, NUM], depth)) && zeroes(apply(f, [NUM, Z], depth)))) return { k: "mask", alg: a.alg, m: a.m & b.m, l: a.l || b.l };
        return z.k === "num" && z.zero ? { k: "mask", alg: a.alg, m: a.m | b.m, l: a.l || b.l } : { k: "mask", alg: a.alg, m: a.alg.full, l: a.l || b.l };
      }
      return TOP;
    }
    // The sum of a multivector's parts: zero when none is on.
    if (target === S.total && n.args.length === 1) { const x = arg(0); return x.k === "mask" ? { k: "num", zero: x.m === 0 } : x.k === "num" ? x : NUM; }
    if (target === S.mapParts) {
      const [f, x] = [arg(0), arg(1)];
      if (x.k !== "mask") return TOP;
      const z = apply(f, [{ k: "num", zero: true }], depth);
      // Every part made zero (0 · part, a weight known to be 0): none on.
      const any = apply(f, [NUM], depth);
      if (any.k === "num" && any.zero) return { ...x, m: 0 };
      return z.k === "num" && z.zero ? x : { ...x, m: x.alg.full };
    }
    const op = target ? ops.get(target) : undefined;
    if (op && NAMED.has(op)) {
      const al = arg(0);
      if (al.k !== "alg") return TOP;
      const alg = al.alg;
      // A result is loose when a multivector it was made from is.
      let loose = false;
      const m = (i: number) => { const v = arg(i); if (!(v.k === "mask" && sameRecord(v.alg, alg) && !v.l)) loose = true; return maskIn(v, alg); };
      const mask = (x: number): V => ({ k: "mask", alg, m: x, l: loose });
      switch (op) {
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
    // A definition called with only known inputs (functions among them
    // written in place, reading nothing around them) runs, when its type
    // says it is pure and it isn't one that may not stop: `clifford table
    // where(squares, basis, wanted)` gives the outer product's table this
    // way (GRADES.md "Any library's algebra", step 1).
    // Each input read once from here on.
    const vs = n.args.map((a) => ev(a, env, depth + 1));
    if (target && nodes[target]?.kind === "def" && lam(target) && n.args.length && !info.divergent.has(target)) {
      const known = knownCall(n, vs, env);
      if (known !== undefined) return lower({ k: "known", v: known });
    }
    // A let, a lambda applied, a definition of the program: read through.
    if (target && hooks.onCall && nodes[target]?.kind === "def") {
      const r = hooks.onCall(n, vs);
      if (r) return r;
    }
    const f = ev(n.fn, env, depth + 1);
    if (f.k !== "closure") return TOP;
    // A library definition given no function (whose reading would be the
    // program's own nodes) reads the same for the same inputs: kept.
    const key = target && LIBRARY.code.nodes[target] ? keyOf(target, vs) : null;
    if (key !== null) { const was = libReads.get(key); if (was) return was; }
    const out = apply(f, vs, depth);
    if (key !== null) libReads.set(key, out);
    return out;
  };

  const pure = (t: Type | undefined) => {
    const z = t && info.subst.zonk(t);
    return z?.t === "fn" && info.subst.resolveRow(z.eff).effs.length === 0;
  };
  const runs = new Map<Id, { args: Value[]; v: Value | undefined }[]>();
  // What a library call's inputs are, as a key; null when one is or holds
  // a function.
  const libReads = readsOf(code);
  const keyOf = (target: Id, vs: V[]): string | null => {
    const part = (v: V): string | null => {
      switch (v.k) {
        case "mask": return `m${v.alg.def}.${v.m}${v.l ? "l" : ""}`;
        case "alg": return `a${v.alg.def}`;
        case "num": return v.zero ? "0" : "n";
        case "top": return "t";
        case "known": return `k${knownKey(v.v)}`;
        case "list": { if (!v.item) return "[]"; const i = part(v.item); return i === null ? null : `[${i}]`; }
        case "rec": { const fs = v.fields.map(part); return fs.includes(null) ? null : `r${v.variant}(${fs.join(",")})`; }
        default: return null;
      }
    };
    const ps = vs.map(part);
    return ps.includes(null) ? null : `${target}|${ps.join("|")}`;
  };
  const knownCall = (n: Call, vs: V[], env: Map<Id, V>): Value | undefined => {
    const target = (nodes[n.fn] as NodeOf<"ref">).target;
    if (!pure(info.schemes.get(target)?.type)) return undefined;
    const args: (Value | Id)[] = [];
    for (const a of n.args) {
      const x = nodes[a];
      if (x?.kind === "lambda") {
        if (!pure(info.typeOf.get(a)) || subtree(code, a).some((id) => { const r = nodes[id]; return r?.kind === "ref" && env.has(r.target); })) return undefined;
        args.push(a);
        continue;
      }
      const k = knownOf(vs[args.length]);
      if (k === undefined) return undefined;
      args.push(k);
    }
    const r = (runner ??= makeRunner(code, info, { print: () => {} }));
    const values = args.map((a, i) => (nodes[n.args[i]]?.kind === "lambda" && a === n.args[i] ? undefined : (a as Value)));
    const was = runs.get(n.id)?.find((x) => x.args.every((v, i) => v === values[i]));
    if (was) return was.v;
    let v: Value | undefined;
    try {
      const given = args.map((a, i) => (values[i] === undefined ? first(r.ev(a as Id, new Map())) : a)) as Value[];
      v = first(r.call(r.value(target), ...given));
    } catch { v = undefined; }
    runs.set(n.id, [...(runs.get(n.id) ?? []), { args: values as Value[], v }]);
    return v;
  };
  const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };

  // The blade a list of literal vectors names: its index, -1 when it
  // names none, -2 when the list isn't literals.
  const blade = (alg: Algebra, id: Id): number => {
    const vs = listLits(id);
    return vs ? alg.blades.findIndex((b) => b.length === vs.length && [...b].sort().join() === [...new Set(vs)].sort().join() && new Set(vs).size === vs.length) : -2;
  };

  // A list written out of Int or Float64 literals.
  const listLits = (id: Id): number[] | null => {
    const items = writtenItems(nodes, id);
    if (!items) return null;
    const out: number[] = [];
    for (const x of items) { const h = nodes[x]; if (h?.kind !== "lit") return null; out.push(Number(h.value)); }
    return out;
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
      if (isCall(n) && nodes[n.fn]?.kind === "lambda") { set.add(n.fn); walk(node(n.fn).body); n.args.forEach(walk); return; }
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
  const reached: Node[] = [], reachedDefs = new Set([...open].flatMap((r) => (nodes[r] ? [r, ...dependencies(code, r)] : [])));
  for (const d of reachedDefs) {
    if (nodes[d]?.kind === "def") for (const id of subtree(code, d)) reached.push(nodes[id]);
  }
  // A definition the open ones don't reach has callers nobody knows: if
  // something compiles it anyway (a caller that forgot to name it open),
  // its inputs are every part, never staged as zeros (C77,
  // REVIEW-2026-11-01b §7).
  for (const d of fnDefs) if (!reachedDefs.has(d)) wide.add(d);
  const sites = new Map<Id, Id>(); // call → callee
  for (const n of reached) {
    if (isCall(n)) { const f = nodes[n.fn]; if (f?.kind === "ref" && isFn.has(f.target)) sites.set(n.id, f.target); }
  }
  const called = new Set([...sites.keys()].map((c) => (nodes[c] as Call).fn));
  for (const n of reached) if (n.kind === "ref" && isFn.has(n.target) && !called.has(n.id)) wide.add(n.target);
  // A call from no definition's own nodes (inside a lambda handed on, or
  // outside every definition) widens its callee.
  for (const [c, callee] of sites) if (!ownerOf.has(c)) wide.add(callee);
  const reader0 = makeReader(code, info);
  // A value of type t, nothing seen yet: a mask of 0 for a multivector, and
  // for a record (one case) or tuple with one inside (C77) that case with
  // each field so; null for a type with no multivector in it.
  const shapeOf = (t0: Type, depth = 0): V | null => {
    const t = info.subst.zonk(t0);
    if (t.t !== "con" || depth > 8) return null;
    const a = reader0.byType.get(t.id);
    if (a) return { k: "mask", alg: a, m: 0 };
    const b = (nodes[t.id] as NodeOf<"def"> | undefined)?.body, td = b ? nodes[b] : undefined;
    if (td?.kind !== "typedef" || td.effect || td.variants.length !== 1) return null;
    const v = nodes[td.variants[0]] as NodeOf<"variant">;
    if (!v.fields.length || v.returns || v.later) return null;
    const args = new Map(td.params.map((p, i) => [p, t.args[i]] as const));
    const asType = (id: Id): Type | null => {
      const n = nodes[id];
      if (n?.kind !== "tref") return null;
      if (args.has(n.target)) return args.get(n.target) ?? null;
      const xs = n.args.map(asType);
      return xs.every(Boolean) ? { t: "con", id: n.target, args: xs as Type[] } : null;
    };
    const fields = v.fields.map((f) => { const ft = asType((nodes[f] as NodeOf<"field">).type); return (ft && shapeOf(ft, depth + 1)) ?? TOP; });
    return fields.some((f) => f.k !== "top") ? { k: "rec", variant: v.id, fields } : null;
  };
  // The same with every part: what anything of that type may be.
  const fullOf = (v: V): V => (v.k === "mask" ? { ...v, m: v.alg.full } : v.k === "rec" ? { ...v, fields: v.fields.map(fullOf) } : v);
  // What was so far, and v besides: a mask's parts added; one that isn't
  // a known mask of the same algebra (lost, loose) is every part.
  const grow = (was: V, v: V | undefined): V => {
    if (was.k === "mask") return { ...was, m: was.m | (v && v.k === "mask" && sameRecord(v.alg, was.alg) && !v.l ? v.m : was.alg.full) };
    if (was.k === "rec") return { ...was, fields: was.fields.map((f, i) => grow(f, v?.k === "rec" && v.variant === was.variant ? v.fields[i] : undefined)) };
    return was;
  };
  const same = (a: V, b: V): boolean => (a.k === "mask" && b.k === "mask" ? a.m === b.m : a.k === "rec" && b.k === "rec" ? a.fields.every((f, i) => same(f, b.fields[i])) : a.k === b.k);
  const typeOf = (id: Id) => info.typeOf.get(id);
  // What each input is so far (a mask from 0, nothing seen, per input
  // with a multivector in its type); others are read as the reading reads
  // them.
  const given = new Map<Id, V>();
  for (const d of fnDefs) for (const p of node((nodes[d] as NodeOf<"def">).body!).params) {
    const t = typeOf(p), shape = t && shapeOf(t);
    if (shape) given.set(p, wide.has(d) ? fullOf(shape) : shape);
  }
  const envFor = (d: Id) => {
    const env = new Map<Id, V>();
    for (const p of node((nodes[d] as NodeOf<"def">).body!).params) env.set(p, given.get(p) ?? TOP);
    return env;
  };
  // What each definition gives so far, read from its own body each round:
  // from nothing seen when it gives a multivector or a record of them;
  // otherwise unknown.
  const gives = new Map<Id, V>();
  for (const d of fnDefs) {
    const t0 = typeOf(d), t = t0 && info.subst.zonk(t0);
    gives.set(d, (t?.t === "fn" && shapeOf(t.ret)) || TOP);
  }
  let seen = new Map<Id, V>(), settled = false;
  for (let round = 0; round < 64 && !settled; round++) {
    let changed = false;
    seen = new Map();
    for (const d of fnDefs) {
      const mine = own.get(d)!, reached = new Set<Id>();
      const widen = (callee: Id, args: V[]) => {
        node((nodes[callee] as NodeOf<"def">).body!).params.forEach((p, i) => {
          const was = given.get(p);
          if (!was) return;
          const now = grow(was, args[i]);
          if (!same(now, was)) { given.set(p, now); changed = true; }
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
      const was = gives.get(d)!, now = grow(was, got);
      if (!same(now, was)) { gives.set(d, now); changed = true; }
      for (const c of mine) if (sites.has(c) && !reached.has(c)) widen(sites.get(c)!, []);
    }
    settled = !changed;
  }
  // Not settled is not known: nothing is said.
  if (!settled) return out;
  for (const [id, v] of seen) if (v.k === "mask" && !v.l) out.set(id, { algebra: v.alg, mask: v.m });
  return out;
}

const joinMasks = (a: V, b: V): V => (a.k === "mask" && b.k === "mask" && sameRecord(a.alg, b.alg) ? { k: "mask", alg: a.alg, m: a.m | b.m, l: a.l || b.l } : { k: "top" });

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
