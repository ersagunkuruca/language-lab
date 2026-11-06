// A record built to be read in parts, built only in the parts read (C175):
// the ray marcher's motor is a 16-part Pga_2 whose place is three of them
// (`place of`), so a shader built all 16 for each axis of the gradient.
//
// Two steps, each changing no bit of any answer, since what they move or
// drop only computes:
// - A call of a small function (its body one pure expression, no lets)
//   given a record built where it is called is put in place: its inputs
//   are lets, and its reads of the record are reads of that let.
// - A let of a record built from parts, `let r = R(a, b, …)`, gives each
//   part a let of its own, and `r.a` reads it. What nothing reads is then
//   dropped (scalar.ts tidied), the record too when only its parts were
//   read.

import { kids, mapKids, type CoreIR, type SExpr } from "./scalar.ts";
import { binds, pureFuncs, pureTree } from "./share-calls.ts";

const size = (e: SExpr): number => 1 + kids(e).reduce((n, k) => n + size(k), 0);
const calls = (e: SExpr, g: number): boolean => (e.k === "call" && e.fn === g) || kids(e).some((k) => calls(k, g));
// A function of sums and products alone (lets too), which the WGSL
// printer may read whole as a matrix times a vector: left as it is.
const COSTLY = new Set(["sin", "cos", "tan", "exp", "log", "pow", "atan2", "sqrt", "div", "mod"]);
const plainSum = (e: SExpr): boolean => !(e.k === "op" && COSTLY.has(e.op)) && kids(e).every(plainSum);
const plain = (e: SExpr) => e.k === "num" || e.k === "bool" || e.k === "local";
// A record built here, after lets of what its parts read.
const built = (e: SExpr): boolean => (e.k === "make" && !e.t.mutable) || (e.k === "let" && !e.check && !e.seeded && built(e.body));

// How a local is read: whole, and which parts (by `get`).
function readsOf(e: SExpr, out = new Map<number, { whole: number; parts: Set<number> }>()) {
  const of = (i: number) => out.get(i) ?? out.set(i, { whole: 0, parts: new Set() }).get(i)!;
  if (e.k === "get" && e.rec.k === "local") { of(e.rec.i).parts.add(e.i); return out; }
  if (e.k === "local") of(e.i).whole++;
  for (const k of kids(e)) readsOf(k, out);
  return out;
}

export function recordParts(ir: CoreIR): number {
  const pure = pureFuncs(ir);
  let changed = 0;
  const small = (g: number) => { const b = ir.funcs[g].body; return pure.has(g) && pureTree(b, pure) && size(b) <= 64 && !calls(b, g); };
  // Input j of g, a record, read in half its parts or fewer (a vector read
  // whole, or a motor in most of its parts, is left to the printer's vector
  // and matrix operations).
  const fewParts = (g: number, j: number, n: number) => { const u = readsOf(ir.funcs[g].body).get(j); return !u || (u.whole === 0 && u.parts.size * 2 <= n); };
  const madeOf = (e: SExpr): number => (e.k === "make" ? e.t.fields.length : e.k === "let" ? madeOf(e.body) : 0);
  ir.funcs.forEach((f, fi) => {
    // The lets made here: an input put in place, a part.
    const made = new Set<number>();
    if (plainSum(f.body)) return;
    // Calls of small functions given a record built in place, put in place.
    const inline = (e: SExpr): SExpr => {
      const r = mapKids(e, inline);
      if (r.k !== "call" || r.cps || r.fn === fi || !small(r.fn) || !r.args.some((a, j) => built(a) && fewParts(r.fn, j, madeOf(a)))) return r;
      const g = ir.funcs[r.fn];
      const at = g.params.map((t) => f.locals.push(t) - 1);
      at.forEach((i) => made.add(i));
      const swap = (x: SExpr): SExpr => (x.k === "local" ? { k: "local", i: at[x.i] } : mapKids(x, swap));
      changed++;
      return r.args.reduceRight<SExpr>((body, value, j) => ({ k: "let", i: at[j], value, body }), swap(g.body));
    };
    f.body = inline(f.body);
    // Locals given a value once (a loop's inputs are given theirs again).
    const writes = new Map<number, number>();
    const scan = (e: SExpr) => { for (const b of binds(e)) writes.set(b, (writes.get(b) ?? 0) + 1); kids(e).forEach(scan); };
    scan(f.body);
    const used = readsOf(f.body);
    // A record's parts by the local holding it.
    const parts = new Map<number, SExpr[]>();
    const split = (e: SExpr): SExpr => {
      // let r = (let x = v in R(…)) is let x = v in let r = R(…).
      if (e.k === "let" && e.value.k === "let" && built(e.value) && writes.get(e.i) === 1 && !e.check && !e.seeded && !used.get(e.i)?.whole) {
        const inner = e.value;
        return split({ ...inner, body: { ...e, value: inner.body } });
      }
      // Only a record put in place above that nothing reads whole, so it
      // isn't built at all.
      if (e.k === "let" && e.value.k === "make" && !e.value.t.mutable && writes.get(e.i) === 1 && !e.check && !e.seeded && !used.get(e.i)?.whole) {
        const mk = e.value, lets: { i: number; value: SExpr }[] = [];
        const args = mk.args.map((a, k) => {
          const v = split(a);
          // A local given a value once, or an input, holds it until read.
          if (plain(v) && (v.k !== "local" || writes.get(v.i) === 1 || (v.i < f.params.length && !writes.has(v.i)))) return v;
          const i = f.locals.push(mk.t.fields[k].t) - 1;
          made.add(i);
          lets.push({ i, value: v });
          return { k: "local", i } as SExpr;
        });
        parts.set(e.i, args);
        if (lets.length) changed++;
        const inner: SExpr = { ...e, value: { ...mk, args }, body: split(e.body) };
        return lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), inner);
      }
      const r = mapKids(e, split);
      if (r.k === "get" && r.rec.k === "local" && parts.has(r.rec.i)) return parts.get(r.rec.i)![r.i];
      return r;
    };
    f.body = split(f.body);
    // A let made here read once, put where it's read, so a sum of products
    // stays one expression (the WGSL printer reads it as a matrix times a
    // vector); what nothing reads is dropped by tidied.
    const reads = new Map<number, number>();
    const count = (e: SExpr) => { if (e.k === "local") reads.set(e.i, (reads.get(e.i) ?? 0) + 1); kids(e).forEach(count); };
    count(f.body);
    const writes2 = new Map<number, number>();
    const scan2 = (e: SExpr) => { for (const b of binds(e)) writes2.set(b, (writes2.get(b) ?? 0) + 1); kids(e).forEach(scan2); };
    scan2(f.body);
    const steady = (e: SExpr): boolean => (e.k === "local" ? writes2.get(e.i) === 1 || (e.i < f.params.length && !writes2.has(e.i)) : kids(e).every(steady));
    const moved = new Map<number, SExpr>();
    const put = (e: SExpr): SExpr => {
      if (e.k === "let" && made.has(e.i) && reads.get(e.i) === 1 && writes2.get(e.i) === 1 && pureTree(e.value, pure) && steady(e.value)) {
        moved.set(e.i, put(e.value));
        return put(e.body);
      }
      if (e.k === "local" && moved.has(e.i)) return moved.get(e.i)!;
      return mapKids(e, put);
    };
    f.body = put(f.body);
  });
  return changed;
}
