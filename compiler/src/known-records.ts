// A known record of functions given to a definition gets a copy of the
// definition for it (C224): `half through(halving at float64, y)`, which
// reads `how`'s `half` and calls it, calls the implementation's own `half`
// directly, and the record isn't built. An implementation passed by hand
// (INTERFACES.md, "dynamic dispatch, asked for") is a record of closures
// known when compiling, so dispatching through it is a constant field
// read: closure-args.ts's law (C30 s2c1) for a record of closures instead
// of one closure. Prior art: GHC's specialisation of dictionary arguments
// (SPECIALISE, and its specialiser's "call-pattern" copies), and
// constant-folding a field read of a known object (devirtualisation).
//
// Known: a record made from closures that capture nothing, written where
// it's given or the whole body of a definition that is a value (a
// constant, so neither made again nor dropped is seen). In the copy each
// read of a known field is that closure; a known closure applied is a
// direct call of its code, without the closure when the code doesn't read
// it; the record handed on goes to that callee's copy; and the input
// itself, once nothing reads it, is no longer given.

import type { CoreIR, RType, SExpr, SFunc } from "./scalar.ts";
import { kids, mapKids, mapLocals } from "./scalar.ts";

type Closure = Extract<SExpr, { k: "closure" }>;
type Make = Extract<SExpr, { k: "make" }>;

const reads = (e: SExpr, i: number): boolean => (e.k === "local" && e.i === i) || kids(e).some((x) => reads(x, i));
// Every place e binds a local afresh.
const bound = (e: SExpr, out: number[] = []): number[] => {
  switch (e.k) {
    case "let": out.push(e.i); break;
    case "case": out.push(e.s); break;
    case "attempt": case "search": out.push(e.res); break;
    case "apply": out.push(e.tmp); break;
    case "list": out.push(e.item, e.acc); break;
    case "handle": out.push(e.reason, e.save, ...(e.frame !== undefined ? [e.frame] : [])); break;
    case "budget": out.push(e.save, e.res); break;
    default: break;
  }
  kids(e).forEach((x) => bound(x, out));
  return out;
};

export function knownRecords(ir: CoreIR): number {
  const funcs = ir.funcs;
  // The record a value of the program is: its make, every field a closure
  // that captures nothing.
  const plain = (m: SExpr): m is Make => m.k === "make" && m.into === undefined && !m.same && m.args.length > 0 && m.args.every((a) => a.k === "closure" && !a.caps.length && a.d === undefined);
  const knownOf = (a: SExpr): { key: string; make: Make; src: SExpr } | null => {
    if (plain(a)) return { key: JSON.stringify(a.args.map((c) => (c as Closure).fn)) + a.t.key, make: a, src: a };
    if (a.k === "call" && !a.args.length && !a.cps) {
      const g = funcs[a.fn];
      if (!g.params.length && !g.partial && !g.multi && g.answer === undefined && plain(g.body)) return { key: `v${a.fn}`, make: g.body, src: { k: "call", fn: a.fn, args: [], tail: false } };
    }
    return null;
  };
  // A closure's code without the closure, where the code doesn't read it.
  const direct = new Map<number, number>();
  const bare = (fn: number): number | undefined => {
    if (direct.has(fn)) return direct.get(fn);
    const g = funcs[fn];
    if (g.multi || g.answer !== undefined || reads(g.body, 0) || bound(g.body).includes(0)) return undefined;
    const c: SFunc = { ...g, name: `${g.name}$direct`, inner: true, params: g.params.slice(1), locals: g.locals.slice(1), body: mapLocals(g.body, (i) => i - 1) };
    const ci = funcs.push(c) - 1;
    direct.set(fn, ci);
    return ci;
  };
  // Calling closure c on args, directly.
  const callOf = (c: Closure, args: SExpr[], tail: boolean): SExpr => {
    const b = bare(c.fn);
    return b !== undefined ? { k: "call", fn: b, args, tail } : { k: "call", fn: c.fn, args: [c, ...args], tail };
  };
  // Whether function fi's input j can be given as known: never bound again,
  // and every local naming it named once.
  const fits = (fi: number, j: number): boolean => {
    const f = funcs[fi];
    if (f.multi || f.answer !== undefined || j >= f.params.length) return false;
    const bs = bound(f.body);
    return !bs.includes(j) && new Set(bs).size === bs.length;
  };
  // The copies made: function, input, record. Which give their input up
  // is settled once all are made: a copy calling itself (or one calling
  // it) hands the record on, which needn't keep it.
  type Copy = { at: number; j: number; src: SExpr };
  const copies = new Map<string, Copy>();
  const copyAt = new Map<number, Copy>();
  const copy = (fi: number, j: number, k: { key: string; make: Make; src: SExpr }): Copy => {
    const key = `${fi}|${j}|${k.key}`;
    const had = copies.get(key);
    if (had) return had;
    const f = funcs[fi];
    const c: SFunc = { ...f, name: `${f.name}·known`, inner: true, body: f.body };
    const made: Copy = { at: funcs.push(c) - 1, j, src: k.src };
    copies.set(key, made);
    copyAt.set(made.at, made);
    const t: RType = k.make.t;
    // The locals that are the record, and those that are one of its closures.
    const record = new Set([j]);
    const field = new Map<number, Closure>();
    const fieldOf = (e: SExpr): Closure | undefined => {
      if (e.k === "local") return field.get(e.i);
      if (e.k === "get" && e.rec.k === "local" && record.has(e.rec.i) && e.t.key === t.key) return k.make.args[e.i] as Closure;
      return undefined;
    };
    const rw = (e: SExpr): SExpr => {
      if (e.k === "let") {
        if (e.value.k === "local" && record.has(e.value.i)) { record.add(e.i); return rw(e.body); }
        const fc = fieldOf(e.value);
        if (fc && e.value.k === "get") { field.set(e.i, fc); return rw(e.body); }
        return { ...e, value: rw(e.value), body: rw(e.body) };
      }
      if (e.k === "local" && record.has(e.i)) return { k: "local", i: j };
      const fc = fieldOf(e);
      if (fc) return fc;
      if (e.k === "apply" && !e.cps) { const g = fieldOf(e.fn); if (g) return callOf(g, e.args.map(rw), e.tail); }
      if (e.k === "call" && !e.cps) {
        const at = e.args.findIndex((a) => a.k === "local" && record.has(a.i));
        if (at >= 0 && fits(e.fn, at)) {
          const into = copy(e.fn, at, k);
          return { ...e, fn: into.at, args: e.args.map((a, i) => (i === at ? { k: "local", i: j } as SExpr : rw(a))) };
        }
      }
      return mapKids(e, rw);
    };
    c.body = rw(f.body);
    return made;
  };
  let calls = 0;
  // Every function, the copies too (a known record given in one).
  for (let fi = 0; fi < funcs.length; fi++) {
    const rw = (e: SExpr): SExpr => {
      let r = mapKids(e, rw);
      for (let at = 0; r.k === "call" && !r.cps && at < r.args.length; at++) {
        const k = knownOf(r.args[at]);
        if (!k || !fits(r.fn, at)) continue;
        r = { ...r, fn: copy(r.fn, at, k).at };
        calls++;
      }
      return r;
    };
    funcs[fi].body = rw(funcs[fi].body);
  }
  // A copy gives its record up where it reads it only to hand it to a
  // copy, which knows it.
  const handed = (e: SExpr, j: number): boolean => {
    if (e.k === "local") return e.i === j;
    if (e.k === "call" && copyAt.has(e.fn)) { const x = copyAt.get(e.fn)!; return e.args.some((a, i) => !(i === x.j && a.k === "local" && a.i === j) && handed(a, j)); }
    return kids(e).some((x) => handed(x, j));
  };
  const dropped = new Set([...copyAt.values()].filter((x) => !handed(funcs[x.at].body, x.j)).map((x) => x.at));
  // A call of a copy that gave it up doesn't give it; one that kept it, from
  // a copy that gave it up, is given the record anew (a constant).
  funcs.forEach((f, fi) => {
    const own = dropped.has(fi) ? copyAt.get(fi)!.j : -1;
    const rw = (e: SExpr): SExpr => {
      const r = mapKids(e, rw);
      if (r.k !== "call" || !copyAt.has(r.fn)) return r;
      const x = copyAt.get(r.fn)!;
      if (dropped.has(r.fn)) return { ...r, args: r.args.filter((_, i) => i !== x.j) };
      const a = r.args[x.j];
      return a.k === "local" && a.i === own ? { ...r, args: r.args.map((b, i) => (i === x.j ? x.src : b)) } : r;
    };
    f.body = rw(f.body);
  });
  for (const at of dropped) {
    const c = funcs[at], j = copyAt.get(at)!.j;
    c.body = mapLocals(c.body, (i) => (i > j ? i - 1 : i));
    c.params = c.params.filter((_, i) => i !== j);
    c.locals = c.locals.filter((_, i) => i !== j);
  }
  return calls;
}
