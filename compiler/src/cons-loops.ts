// A function answering `x and f(…)` (or `x or f(…)`) item by item, as
// trek's `in order` does, made a loop: each call took a frame of
// WebAssembly's stack, which Node's WASI and wasmtime hold some thousands
// of (trek's 10000 fixes didn't fit, GAPS.md round 16 R3, C222). `and` is
// strict, so x is worked out and then the call, and the copy carries the
// conjunction so far, `acc and x`, into the call instead, answering
// `acc and y` where f answered y. And and or are associative, so the
// answer is the same, and every call is still made, in the same order.
//
// Taken: a function whose every return is a call of itself in tail
// position, `x and f(…)`, or an answer without a call of itself.
//
// A list built by cons onto a call of itself is made a loop before
// lowering, the same for every way a list is stored (ters/src/lang
// cons-onto.ts, library-reps.ts loopsOnto, C252); the list as written
// keeps its own (scalar.ts modCons).

import { kids, mapLocals, type CoreIR, type SExpr, type SFunc } from "./scalar.ts";

export function consLoops(ir: CoreIR): number {
  let made = 0;
  const n = ir.funcs.length;
  for (let fi = 0; fi < n; fi++) if (foldOf(ir, fi)) made++;
  return made;
}

// `x and f(…)` and `x or f(…)`, where f is the function itself.
function foldOf(ir: CoreIR, fi: number): boolean {
  const f = ir.funcs[fi];
  if (f.multi || f.spends || f.budgeted || f.result !== "i32") return false;
  const calls = (e: SExpr): number => (e.k === "call" && e.fn === fi ? 1 : 0) + kids(e).reduce((s, x) => s + calls(x), 0);
  let op: "and" | "or" | null = null, folding = 0;
  const folded = (e: SExpr): { item: SExpr; call: SExpr & { k: "call" } } | null => {
    if (e.k !== "op" || (e.op !== "and" && e.op !== "or") || e.args.length !== 2) return null;
    const [item, call] = e.args;
    if (call.k !== "call" || call.fn !== fi || call.cps || calls(item) || call.args.some(calls)) return null;
    if (op && op !== e.op) return null;
    op = e.op;
    return { item, call };
  };
  const ok = (e: SExpr): boolean => {
    switch (e.k) {
      case "let": return !calls(e.value) && ok(e.body);
      case "if": return !calls(e.cond) && ok(e.then) && ok(e.else);
      case "case": return !calls(e.scrut) && e.arms.every((x) => !x || ok(x));
      default: {
        if (e.k === "call" && e.fn === fi && e.tail && !e.cps) return !e.args.some(calls);
        if (folded(e)) { folding++; return true; }
        return !calls(e);
      }
    }
  };
  if (!ok(f.body) || !folding || !op) return false;
  const o: "and" | "or" = op;
  const at = f.params.length, gi = ir.funcs.length;
  const shift = (i: number) => (i >= at ? i + 1 : i);
  const locals = [...f.locals.slice(0, at), "i32" as const, ...f.locals.slice(at)];
  const acc: SExpr = { k: "local", i: at };
  const to = (e: SExpr): SExpr => {
    switch (e.k) {
      case "let": return { ...e, body: to(e.body) };
      case "if": return { ...e, then: to(e.then), else: to(e.else) };
      case "case": return { ...e, arms: e.arms.map((x) => x && to(x)) };
      default: {
        if (e.k === "call" && e.fn === fi) return { ...e, fn: gi, args: [...e.args, acc], tail: true };
        const c = folded(e);
        if (c) {
          // The item first, then the call's inputs, as `x and f(…)` had them.
          const t = locals.push("i32") - 1;
          return { k: "let", i: t, value: c.item, body: { ...c.call, fn: gi, args: [...c.call.args, { k: "op", op: o, args: [acc, { k: "local", i: t }] }], tail: true } };
        }
        return { k: "op", op: o, args: [acc, e] };
      }
    }
  };
  const g: SFunc = { ...f, name: `${f.name}$${o}`, params: [...f.params, "i32"], locals, body: to(mapLocals(f.body, shift)), inner: true };
  ir.funcs.push(g);
  f.body = { k: "call", fn: gi, args: [...f.params.map((_, i): SExpr => ({ k: "local", i })), { k: "bool", v: o === "and" }], tail: true };
  return true;
}
