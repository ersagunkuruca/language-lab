// A record chosen between, read only by its parts, as its parts (G3d step
// 2, compiled JavaScript): the flock's `first(birds item at j, else
// nobody)` is a bird made from the birds' columns or the stand-in, and
// `met` reads only its place and velocity. V8 makes the bird for every
// neighbour (60 million in 100 ticks of 5,000 birds), since what it reads
// is one of two objects; here each part read is chosen on its own, `if j
// is one of the birds then x of j else x of nobody's place`, and no bird is
// made. Changes no bit of any answer: the choice is pure, so working it
// out once for each part gives each part as before.
//
// `let r = V in B`, where B reads r only by its parts (r.place.x, or a let
// naming r.place, read by its parts too), and V is a choice of records:
// lets, ifs and attempts (`first`) over pure values, whose ends are
// records made, a local or no answer. Each part B reads gets a let of its
// own, V with each end read at that part. A small function called for V
// (`first(…)`'s, called from several places) is put in place first. A
// record V just makes is the same with no choice (record-parts.ts's
// step for the shaders).
// Prior art: scalar replacement of aggregates through phis (LLVM's SROA
// speculating loads through selects), and GHC's case-of-case.

import type { CoreIR, LType, RType, SExpr, SFunc } from "./scalar.ts";
import { isRecord, kids, mapKids, mapLocals, tidied } from "./scalar.ts";
import { PURE_OPS, SAFE_RT } from "./share-calls.ts";

const MAX_SIZE = 80, MAX_PARTS = 8;
const size = (e: SExpr): number => 1 + kids(e).reduce((n, k) => n + size(k), 0);
const COLUMN = /^array\.c(in|get\d+|length)\.a\d+$/;
// A value with nothing bound in it, worked out from locals by pure
// arithmetic and reads: safe to work out again.
const flat = (e: SExpr): boolean => {
  switch (e.k) {
    case "num": case "int": case "bool": case "text": case "local": return true;
    case "get": return flat(e.rec);
    case "op": return PURE_OPS.has(e.op) && e.args.every(flat);
    case "make": return e.into === undefined && !e.t.mutable && e.args.every(flat);
    case "rt": return !e.host && (SAFE_RT(e.fn) || COLUMN.test(e.fn)) && e.args.every(flat);
    default: return false;
  }
};
// A choice of records over flat values.
const choice = (e: SExpr): boolean => {
  switch (e.k) {
    case "let": return !e.check && !e.seeded && flat(e.value) && choice(e.body);
    case "if": return !e.check && flat(e.cond) && choice(e.then) && choice(e.else);
    case "attempt": return !e.spent && !e.resumes && e.ok.k === "local" && e.ok.i === e.res && choice(e.body) && choice(e.otherwise);
    case "fail": return true;
    default: return flat(e);
  }
};
// Some end of it is a record made.
const makes = (e: SExpr): boolean => e.k === "make" || (e.k === "let" ? makes(e.body) || (e.value.k === "make") : e.k === "if" ? makes(e.then) || makes(e.else) : e.k === "attempt" ? makes(e.body) || makes(e.otherwise) : false);
const typeAt = (t: LType, path: number[]): LType => path.reduce<LType>((x, i) => (x as RType).fields[i].t, t);
const getAt = (e: SExpr, t: LType, path: number[]): SExpr => path.reduce<{ e: SExpr; t: LType }>(({ e, t }, i) => ({ e: { k: "get", rec: e, t: t as RType, i }, t: (t as RType).fields[i].t }), { e, t }).e;
const splittable = (t: LType): t is RType => isRecord(t) && !t.mutable && t.fields.length > 0;

export function chosenParts(ir: CoreIR): number {
  let n = 0;
  // A function whose body may be put in place for V.
  const inlinable = (g: SFunc) => !g.inner && !g.partial && !g.spends && !g.budgeted && !g.multi && !g.piece && !g.value && g.bail === undefined && size(g.body) <= MAX_SIZE && choice(g.body);
  ir.funcs.forEach((f, fi) => {
    const before = n;
    const go = (e: SExpr): SExpr => {
      if (e.k === "let" && !e.check && !e.seeded && splittable(f.locals[e.i])) {
        const done = parts(f, e, inlinable, ir);
        if (done) { n++; return go(done); }
      }
      return mapKids(e, go);
    };
    f.body = go(f.body);
    if (n > before) f.body = tidied(f, fi).body;
  });
  return n;
}

function parts(f: SFunc, e: Extract<SExpr, { k: "let" }>, inlinable: (g: SFunc) => boolean, ir: CoreIR): SExpr | null {
  const r = f.locals[e.i] as RType;
  let v = e.value;
  // A small function's body for its call. Its inputs are worked out
  // first, in order, as lets before the parts' (what isn't flat), or in V
  // (what is, a record made of them too, so the stand-in `nobody` is read
  // at the part, not made).
  const outer: { i: number; value: SExpr }[] = [];
  if (v.k === "call" && !v.cps && !v.tail && inlinable(ir.funcs[v.fn])) {
    const g = ir.funcs[v.fn], at = g.locals.map((t) => f.locals.push(t) - 1);
    const out = (x: SExpr, t: LType): SExpr => { if (flat(x)) return x; const i = f.locals.push(t) - 1; outer.push({ i, value: x }); return { k: "local", i }; };
    const arg = (x: SExpr, t: LType): SExpr => {
      if (x.k === "let" && !x.check && !x.seeded) { outer.push({ i: x.i, value: x.value }); return arg(x.body, t); }
      return x.k === "make" && x.into === undefined && !x.t.mutable ? { ...x, args: x.args.map((y, k) => out(y, x.t.fields[k].t)) } : out(x, t);
    };
    const inner = v.args.map((x, j) => arg(x, g.locals[j]));
    v = inner.reduceRight<SExpr>((body, value, j) => ({ k: "let", i: at[j], value, body }), mapLocals(g.body, (i) => at[i]));
  }
  if (!choice(v) || !makes(v) || size(v) > MAX_SIZE) return null;
  // Where B reads r: each read's path of parts, r's lets of its parts
  // (`let p = r.place`) followed.
  const alias = new Map<number, number[]>([[e.i, []]]);
  const reads: number[][] = [];
  let ok = true;
  const chain = (x: SExpr): number[] | null => {
    if (x.k === "local") return alias.get(x.i) ?? null;
    if (x.k === "get") { const c = chain(x.rec); return c && [...c, x.i]; }
    return null;
  };
  const scan = (x: SExpr) => {
    if (!ok) return;
    if (x.k === "let") { const c = chain(x.value); if (c && splittable(f.locals[x.i])) { alias.set(x.i, c); scan(x.body); return; } }
    const c = chain(x);
    if (c) { reads.push(c); return; }
    if (x.k === "make" && x.into !== undefined && alias.has(x.into)) ok = false;
    kids(x).forEach(scan);
  };
  scan(e.body);
  if (!ok) return null;
  // The parts kept: each read's shortest path among the reads.
  const kept: number[][] = [];
  for (const p of reads.sort((a, b) => a.length - b.length)) if (!kept.some((q) => q.length <= p.length && q.every((x, k) => x === p[k]))) kept.push(p);
  if (!kept.length || kept.some((p) => !p.length) || kept.length > MAX_PARTS) return null;
  const local = kept.map((p) => f.locals.push(typeAt(r, p)) - 1);
  // B with each read a read of its part's let.
  const rw = (x: SExpr): SExpr => {
    if (x.k === "let" && alias.has(x.i) && x.i !== e.i) return rw(x.body);
    const c = chain(x);
    if (c) { const k = kept.findIndex((q) => q.every((y, j) => y === c[j])); return getAt({ k: "local", i: local[k] }, typeAt(r, kept[k]), c.slice(kept[k].length)); }
    return mapKids(x, rw);
  };
  const body = rw(e.body);
  const split = kept.reduceRight<SExpr>((b, p, k) => ({ k: "let", i: local[k], value: at(f, v, r, p, new Map(), new Map()), body: b }), body);
  return outer.reduceRight<SExpr>((b, l) => ({ k: "let", i: l.i, value: l.value, body: b }), split);
}

// V read at path p: each end at that part, V's own locals new for each
// part. `made`: V's lets of records made, read at the part where read.
function at(f: SFunc, v: SExpr, t: LType, p: number[], ren: Map<number, number>, made: Map<number, SExpr>): SExpr {
  const re = (x: SExpr) => mapLocals(x, (i) => ren.get(i) ?? i);
  switch (v.k) {
    case "let": {
      const i = f.locals.push(f.locals[v.i]) - 1, value = re(v.value), inner = new Map(ren).set(v.i, i);
      const m = value.k === "make" ? new Map(made).set(i, value) : made;
      return { k: "let", i, value, body: at(f, v.body, t, p, inner, m) };
    }
    case "if": return { k: "if", cond: re(v.cond), then: at(f, v.then, t, p, ren, made), else: at(f, v.else, t, p, ren, made), t: typeAt(t, p) };
    case "attempt": {
      const res = f.locals.push(typeAt(t, p)) - 1, body = at(f, v.body, t, p, ren, made), otherwise = at(f, v.otherwise, t, p, ren, made);
      return answers(body, otherwise) ?? { k: "attempt", body, res, ok: { k: "local", i: res }, otherwise, t: typeAt(t, p) };
    }
    case "fail": return v;
    case "make": return p.length ? at(f, v.args[p[0]], (t as RType).fields[p[0]].t, p.slice(1), ren, made) : re(v);
    case "local": { const i = ren.get(v.i) ?? v.i, m = made.get(i); return m && p.length ? at(f, m, t, p, new Map(), made) : getAt({ k: "local", i }, t, p); }
    default: return getAt(re(v), t, p);
  }
}

// An attempt whose body has no answer only where it says so (`item at`'s
// check, `if j is one of them then … else no answer`): that place is the
// otherwise, and no attempt is left.
const sure = (e: SExpr): boolean => e.k !== "fail" && !(e.k === "rt" && !COLUMN.test(e.fn) && /^array\.at\./.test(e.fn)) && kids(e).every(sure);
function answers(body: SExpr, otherwise: SExpr): SExpr | null {
  if (body.k === "fail") return otherwise;
  if (body.k === "let") { if (!sure(body.value)) return null; const b = answers(body.body, otherwise); return b && { ...body, body: b }; }
  if (body.k === "if") {
    if (!sure(body.cond)) return null;
    const a = answers(body.then, otherwise), b = a && answers(body.else, otherwise);
    return b && { ...body, then: a!, else: b };
  }
  return sure(body) ? body : null;
}
