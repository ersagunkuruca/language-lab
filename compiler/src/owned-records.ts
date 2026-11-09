// A record rebuilt from its own fields, written in place where nobody else
// can see the one it was made from (C93 s5, IN-PLACE.md): machine's
// `set register` and `stepped` make a Machine from the last one's fields
// with one or two changed, every step.
//
// one-holder.ts, asked with `rebuilds`, says from the program whether every
// value of a record type has one holder, a constructor given fields of one
// value of its type counting as a change of that value. Then each such
// `make` whose fields come from one local, last in its function, writes
// the changed fields into that local's value (core-js.ts prints it,
// keeping a value made outside, which isn't one of its classes, as it was).
//
// What is read of a value after it was changed elsewhere, as `stepped`
// reads `machine.pc` after `executed` took `machine`, was read before: each
// function reads the fields of such a local where the local is bound, so
// a field always says what it said when the value was named. That holds
// only where every field read is of a local bound by a parameter or a let:
// a closure captures a copy, and a type read through a match or another
// value's field is left as it was.

import type { Code, Id } from "../../ters/src/model.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { oneHolder } from "../../ters/src/lang/one-holder.ts";
import { kids, mapKids, type CoreIR, type LType, type RType, type SExpr, type SFunc } from "./scalar.ts";

const isD = (t: LType | undefined, d: RType) => typeof t === "object" && t !== null && "variant" in t && t.key === d.key;

export function ownedRecords(ir: CoreIR, code: Code, info: Info, names: Record<Id, string>, main: Id): number {
  let n = 0;
  for (const d of ir.records) {
    if (d.mutable || !d.fields.length) continue;
    if (!ir.funcs.some((f) => found(f.body, (e) => e.k === "make" && e.t.key === d.key && rootOf(e, d) !== null))) continue;
    if (!readable(ir, d)) continue;
    const rebuilt = new Set<Id>();
    if (!oneHolder(code, info, main, new Set([d.def]), new Set(), new Map(), names, undefined, true, rebuilt).ok) continue;
    let here = 0;
    for (const f of ir.funcs) {
      f.body = inPlace(f, f.body, d, rebuilt, () => here++);
    }
    if (!here) continue;
    for (const f of ir.funcs) { copyCaptures(ir, f, d); snapshot(f, d); }
    d.owned = true;
    n += here;
  }
  return n;
}

const found = (e: SExpr, p: (e: SExpr) => boolean): boolean => p(e) || kids(e).some((k) => found(k, p));

// The local whose fields a `make` of d is made from, when all of those of
// its type are one local's (and there is one).
function rootOf(e: Extract<SExpr, { k: "make" }>, d: RType): number | null {
  let got: number | null = null;
  for (const a of e.args) {
    if (a.k !== "get" || a.t.key !== d.key) continue;
    if (a.rec.k !== "local") return null;
    if (got !== null && got !== a.rec.i) return null;
    got = a.rec.i;
  }
  return got;
}

// Every field of d read is of a local a parameter or a let binds, or of a
// closure's capture; a closure captures one of d only from a local (or
// its own capture), and a match never binds one.
function readable(ir: CoreIR, d: RType): boolean {
  for (const f of ir.funcs) {
    const lets = new Set<number>();
    const walk = (e: SExpr): boolean => {
      if (e.k === "let") lets.add(e.i);
      if (e.k === "get" && e.t.key === d.key && !(e.rec.k === "cap" || (e.rec.k === "local" && (e.rec.i < f.params.length || lets.has(e.rec.i))))) return false;
      if (e.k === "closure" && e.caps.some((c) => c.k !== "local" && c.k !== "cap" && isD(typeOfCap(ir, e, c), d))) return false;
      if (e.k === "case" && isD(f.locals[e.s], d)) return false;
      return kids(e).every(walk);
    };
    if (!walk(f.body)) return false;
  }
  return true;
}
const typeOfCap = (ir: CoreIR, e: Extract<SExpr, { k: "closure" }>, c: SExpr): LType | undefined => ir.shapes[e.shape]?.caps[e.caps.indexOf(c)];

// A closure capturing a local of d captures a copy, made of the fields as
// they were when the local was named (snapshot): the closure may run after
// the value was written in place.
function copyCaptures(ir: CoreIR, f: SFunc, d: RType): void {
  const go = (e: SExpr): SExpr => {
    const x = mapKids(e, go);
    if (x.k !== "closure") return x;
    return { ...x, caps: x.caps.map((c) => (c.k === "local" && isD(f.locals[c.i], d) ? { k: "make", t: d, args: d.fields.map((_, i) => ({ k: "get", rec: c, t: d, i })) } : c)) };
  };
  f.body = go(f.body);
  void ir;
}

// The `make`s of d last in f, made from fields of a local the program's
// check saw changed, written into it.
function inPlace(f: SFunc, e: SExpr, d: RType, rebuilt: Set<Id>, count: () => void): SExpr {
  switch (e.k) {
    case "let": return { ...e, body: inPlace(f, e.body, d, rebuilt, count) };
    case "if": return { ...e, then: inPlace(f, e.then, d, rebuilt, count), else: inPlace(f, e.else, d, rebuilt, count) };
    case "case": return { ...e, arms: e.arms.map((a) => a && inPlace(f, a, d, rebuilt, count)) };
    case "make": {
      if (e.t.key !== d.key) return e;
      const y = rootOf(e, d), b = y === null ? undefined : f.binders?.[y];
      if (y === null || !b || !rebuilt.has(b)) return e;
      count();
      const same = e.args.flatMap((a, i) => (a.k === "get" && a.t.key === d.key && a.i === i ? [i] : []));
      return { ...e, into: y, same };
    }
    default: return e;
  }
}

// Each local of d whose fields f reads has them read where it is bound:
// a parameter's at the start, a let's at the start of its body.
function snapshot(f: SFunc, d: RType): void {
  const reads = new Map<number, Map<number, number>>(); // local -> field -> snapshot local
  const collect = (e: SExpr) => {
    if (e.k === "get" && e.t.key === d.key && e.rec.k === "local") {
      const m = reads.get(e.rec.i) ?? new Map<number, number>();
      if (!m.has(e.i)) { m.set(e.i, f.locals.length); f.locals.push(d.fields[e.i].t); }
      reads.set(e.rec.i, m);
    }
    kids(e).forEach(collect);
  };
  collect(f.body);
  if (!reads.size) return;
  const bindings = (y: number, body: SExpr): SExpr => {
    const m = reads.get(y);
    if (!m) return body;
    return [...m].reduceRight<SExpr>((acc, [i, s]) => ({ k: "let", i: s, value: { k: "get", rec: { k: "local", i: y }, t: d, i }, body: acc }), body);
  };
  const swap = (e: SExpr): SExpr => {
    if (e.k === "get" && e.t.key === d.key && e.rec.k === "local") return { k: "local", i: reads.get(e.rec.i)!.get(e.i)! };
    if (e.k === "let") { const value = swap(e.value); return { ...e, value, body: bindings(e.i, swap(e.body)) }; }
    return mapKids(e, swap);
  };
  let body = swap(f.body);
  for (let y = f.params.length - 1; y >= 0; y--) body = bindings(y, body);
  f.body = body;
}

// For a target whose records are structs with no classes (WebAssembly, C56):
// each `make` written into a local becomes its changed fields, every input
// first (into new locals), then each written with `set`, the local its
// value; the record's fields become mutable. Gives how many it wrote so.
export function intoAsSets(ir: CoreIR): number {
  let n = 0;
  for (const f of ir.funcs) {
    const go = (e: SExpr): SExpr => {
      const x = mapKids(e, go);
      if (x.k !== "make" || x.into === undefined) return x;
      n++;
      const changed = x.args.flatMap((a, i) => (x.same?.includes(i) ? [] : [{ a, i, at: (f.locals.push(x.t.fields[i].t), f.locals.length - 1) }]));
      const into: SExpr = { k: "local", i: x.into };
      const sets = changed.reduceRight<SExpr>((acc, c) => ({ k: "set", rec: into, t: x.t, i: c.i, value: { k: "local", i: c.at }, then: acc }), into);
      return changed.reduceRight<SExpr>((acc, c) => ({ k: "let", i: c.at, value: c.a, body: acc }), sets);
    };
    f.body = go(f.body);
  }
  for (const d of ir.records) if (d.owned) d.mutable = true;
  return n;
}
