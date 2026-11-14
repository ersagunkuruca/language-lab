// Defunctionalisation (C225; Reynolds 1972, Danvy and Nielsen 2001): a
// shader has no function pointers, so a function value there is a record
// of which of its type's functions it is and what that one captured, and
// calling it runs the one it is. The whole program is known, so every
// closure of a function type is: a closure becomes that record (`which`,
// its number among them, then each one's captures, the others' left 0),
// its code reads its captures from the record, and a call through it is
// an if on `which` calling each one's code directly.
//
// The lowering (scalar.ts) makes closures for a shader's records profile
// as it does with `data`, and this turns them into records before a
// printer sees them, so WGSL needs nothing new. WebAssembly and C could
// switch the same way in place of an indirect call; they keep their
// closures until numbers show the calls cost.

import { isArray, isFn, isRecord, kids, mapKids, type CoreIR, type FType, type LType, type RType, type SExpr, type SFunc } from "./scalar.ts";

export class Undefunctionalised extends Error {}

export function defunctionalise(ir: CoreIR): void {
  if (!ir.fns.length) return;
  // Each function type's closures, by shape, and each shape's code.
  const alts = new Map<string, number[]>(), codeOf = new Map<number, number>();
  const seen = (e: SExpr) => {
    if (e.k === "closure") {
      if (e.d !== undefined) throw new Undefunctionalised("carries a derivative of a function chosen as it runs");
      const xs = alts.get(e.t.key) ?? [];
      if (!xs.includes(e.shape)) xs.push(e.shape);
      alts.set(e.t.key, xs);
      codeOf.set(e.shape, e.fn);
    }
    kids(e).forEach(seen);
  };
  ir.funcs.forEach((f) => seen(f.body));
  for (const t of ir.fns) if (t.several || t.waits) throw new Undefunctionalised("has a function value with several answers");

  // Its record: `which`, then each closure's captures in turn.
  const recs = new Map<string, RType>(), offset = new Map<number, number>();
  ir.fns.forEach((t, n) => {
    const r: RType = { key: `defunc:${t.key}`, name: `fn${n}`, def: "", variant: "", fields: [{ name: "which", t: "f64" }] };
    recs.set(t.key, r);
  });
  const ty = (t: LType): LType => (isFn(t) ? recs.get(t.key)! : t);
  for (const t of ir.fns) {
    const r = recs.get(t.key)!;
    for (const s of alts.get(t.key) ?? []) {
      offset.set(s, r.fields.length);
      ir.shapes[s].caps.forEach((c, i) => r.fields.push({ name: `s${s}c${i}`, t: ty(c) }));
    }
  }
  // Function types inside records and arrays.
  for (const r of ir.records) r.fields = r.fields.map((x) => ({ ...x, t: ty(x.t) }));
  for (const a of ir.arrays) a.item = ty(a.item);
  // A value of type t no closure gives: zeros.
  const zero = (t: LType): SExpr => {
    if (t === "f64") return { k: "num", v: 0 };
    if (t === "i32") return { k: "bool", v: false };
    if (t === "int32" || t === "i64") return { k: "int", v: 0n };
    if (isRecord(t)) return { k: "make", t, args: t.fields.map((x) => zero(x.t)) };
    throw new Undefunctionalised(`captures ${isArray(t) ? "an array" : "a value"} a function value can't hold here`);
  };

  const fresh = (f: SFunc, t: LType) => f.locals.push(t) - 1;
  const rewrite = (f: SFunc, self: number, e: SExpr): SExpr => {
    const go = (x: SExpr) => rewrite(f, self, x);
    switch (e.k) {
      case "closure": {
        const r = recs.get(e.t.key)!, at = offset.get(e.shape)!, which = alts.get(e.t.key)!.indexOf(e.shape);
        const args = r.fields.map((x, i) => (i === 0 ? ({ k: "num", v: which } as SExpr) : i >= at && i < at + e.caps.length ? go(e.caps[i - at]) : zero(x.t)));
        return { k: "make", t: r, args };
      }
      case "cap": {
        if (codeOf.get(e.shape) !== self) throw new Undefunctionalised("reads a closure's captures outside its code");
        return { k: "get", rec: { k: "local", i: 0 }, t: recs.get(e.t.key)!, i: offset.get(e.shape)! + e.i };
      }
      case "apply": {
        const r = recs.get(e.t.key)!, xs = alts.get(e.t.key) ?? [];
        const args = e.args.map(go), held = args.map((_, j) => fresh(f, ty(e.t.params[j])));
        const callOf = (s: number): SExpr => ({ k: "call", fn: codeOf.get(s)!, args: [{ k: "local", i: e.tmp }, ...held.map((i): SExpr => ({ k: "local", i }))], tail: e.tail });
        const which: SExpr = { k: "get", rec: { k: "local", i: e.tmp }, t: r, i: 0 };
        const result = ty(e.t.result);
        // The last closure is the one left once the others are ruled out.
        const chain = !xs.length ? zero(result) : xs.slice(0, -1).reduceRight<SExpr>((rest, s, n) => ({ k: "if", cond: { k: "op", op: "less", args: [which, { k: "num", v: n + 0.5 }] }, then: callOf(s), else: rest, t: result }), callOf(xs[xs.length - 1]));
        const body = held.reduceRight<SExpr>((b, i, j) => ({ k: "let", i, value: args[j], body: b }), chain);
        return { k: "let", i: e.tmp, value: go(e.fn), body };
      }
      default: {
        const out = mapKids(e, go);
        if ((out.k === "if" || out.k === "budget" || out.k === "attempt") && isFn(out.t)) return { ...out, t: ty(out.t) };
        if (out.k === "case" && isFn(out.result)) return { ...out, result: ty(out.result) };
        if (out.k === "rt" && out.host && isFn(out.host.t)) return { ...out, host: { ...out.host, t: ty(out.host.t) } };
        return out;
      }
    }
  };
  ir.funcs.forEach((f, i) => {
    f.body = rewrite(f, i, f.body);
    f.params = f.params.map(ty);
    f.locals = f.locals.map(ty);
    f.result = ty(f.result);
    if (f.answer) f.answer = ty(f.answer);
  });
  ir.records.push(...recs.values());
  ir.fns = [];
}

export type { FType };
