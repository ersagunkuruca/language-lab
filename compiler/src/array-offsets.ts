// An array a function walks item by item read by position (C196): where a
// parameter of array type is only read (its first item, its length, its
// rest) and its rests only so, or handed back to the function itself in
// the same place, the function is a wrapper of one that takes the array
// as it came and how far in it is, a number. Each rest is then the same
// array one further, not a view made for it: the pedal's `following`,
// `matching` and `bands` read a block of 128 samples with no object an
// item, as a cons list's match reads its cells.
//
// Changes no answer: the item at position k of a rest taken m times is
// the item at k + m of the array, and its length the array's less m.
// The core IR's JavaScript only (its arrays are views, std.ts ArrayView);
// a function inner to another, or with a call that keeps the rest of the
// search (cps), is left as it is.

import { isArray, kids, mapKids, mapLocals, type CoreIR, type SExpr, type SFunc } from "./scalar.ts";

const READ = /^array\.(first|length|rest)\.a(\d+)$/;

export function arrayOffsets(ir: CoreIR): number {
  let n = 0;
  const count = ir.funcs.length;
  for (let fi = 0; fi < count; fi++) {
    const f = ir.funcs[fi];
    if (f.inner || f.multi) continue;
    // Each such input in turn: the function made for one is walked again
    // for the next (matching's dry and wet).
    let at = fi;
    for (let p = 0; p < f.params.length; p++) {
      const g = ir.funcs[at];
      if (!isArray(g.params[p]) || !walked(g, at, p)) continue;
      at = offsetBy(ir, at, p);
      n++;
    }
  }
  return n;
}

// Is parameter p only read, its rests too, or given back to f in place p?
// At least one rest, so there is something to save.
function walked(f: SFunc, fi: number, p: number): boolean {
  const derived = new Set([p]);
  let rests = 0;
  const isDerived = (e: SExpr) => e.k === "local" && derived.has(e.i);
  const ok = (e: SExpr): boolean => {
    if (e.k === "local") return !derived.has(e.i);
    if (e.k === "let" && e.value.k === "rt" && READ.exec(e.value.fn)?.[1] === "rest" && isDerived(e.value.args[0])) {
      derived.add(e.i);
      rests++;
      return ok(e.body);
    }
    if (e.k === "rt" && READ.test(e.fn) && e.args.length === 1 && isDerived(e.args[0])) return READ.exec(e.fn)![1] !== "rest";
    if (e.k === "call" && e.fn === fi) {
      if (e.cps) return false;
      return e.args.every((a, j) => (j === p && isDerived(a)) || ok(a));
    }
    if (e.k === "call" && e.cps) return false;
    return kids(e).every(ok);
  };
  return ok(f.body) && rests > 0;
}

// f becomes a call of a new function g taking f's inputs and a number, how
// many items of input p have been passed (0 from f).
function offsetBy(ir: CoreIR, fi: number, p: number): number {
  const f = ir.funcs[fi], at = f.params.length, gi = ir.funcs.length;
  const array = f.params[p];
  if (!isArray(array)) return fi;
  const a = array.index;
  // g's locals: f's, with the offset after its inputs.
  const shift = (i: number) => (i >= at ? i + 1 : i);
  const depth = new Map<number, number>([[p, 0]]);
  const k: SExpr = { k: "local", i: at };
  // The count a number (a JavaScript one, as an array's positions are).
  const off = (m: number): SExpr => (m ? { k: "op", op: "add", args: [k, { k: "num", v: m }] } : k);
  const of = (e: SExpr) => (e.k === "local" ? depth.get(e.i) : undefined);
  const put = (e: SExpr): SExpr => {
    if (e.k === "let" && e.value.k === "rt" && READ.exec(e.value.fn)?.[1] === "rest" && of(e.value.args[0]) !== undefined) {
      depth.set(e.i, of(e.value.args[0])! + 1);
      return put(e.body);
    }
    if (e.k === "rt" && e.args.length === 1 && of(e.args[0]) !== undefined) {
      const m = of(e.args[0])!, what = READ.exec(e.fn)?.[1];
      const arr: SExpr = { k: "local", i: p };
      if (what === "first") return { k: "rt", fn: `array.get.a${a}`, args: [arr, off(m)] };
      if (what === "length") return { k: "op", op: "sub", args: [{ k: "rt", fn: `array.length.a${a}`, args: [arr] }, off(m)] };
    }
    if (e.k === "call" && e.fn === fi) {
      const m = of(e.args[p]) ?? 0;
      return { ...e, fn: gi, args: [...e.args.map((x, j) => (j === p ? { k: "local", i: p } as SExpr : put(x))), off(m)] };
    }
    return mapKids(e, put);
  };
  const body = put(mapLocals(f.body, shift));
  const g: SFunc = { ...f, name: `${f.name}$from`, params: [...f.params, "f64"], locals: [...f.locals.slice(0, at), "f64", ...f.locals.slice(at)], body, inner: true };
  ir.funcs.push(g);
  f.body = { k: "call", fn: gi, args: [...f.params.map((_, i): SExpr => ({ k: "local", i })), { k: "num", v: 0 }], tail: true };
  return gi;
}
