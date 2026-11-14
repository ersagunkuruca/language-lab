// A function building an array item by item from the front, one call a
// item (`points from(lines) = … cons(point of(line), points from(more))`),
// made a loop (C222). Each `cons(x, f(…))` took a frame of WebAssembly's
// stack, which Node's WASI and wasmtime hold some thousands of (trek's
// 10000 fixes didn't fit, GAPS.md round 16 R3), while compiled JavaScript
// goes on on the heap (C137c18) and C has a 1 GiB stack. Here f calls a
// copy of itself taking the items so far, pushed onto the back of an
// array as they are made, in the order the conses would have put them:
// tail recursion modulo cons (Friedman and Wise 1975; OCaml's
// [@tail_mod_cons]), with a push at the array's free end for the cell
// written later.
//
// A function answering `x and f(…)` (or `x or f(…)`) item by item, as
// trek's `in order` does, is the same with a Bool: `and` is strict, so x
// is worked out and then the call, and the copy carries the conjunction
// so far, `acc and x`, into the call instead, answering `acc and y` where
// f answered y. And and or are associative, so the answer is the same,
// and every call is still made, in the same order.
//
// Taken: a function whose every return is the empty array, a call of
// itself in tail position, or a cons of an item onto a call of itself,
// and which calls itself nowhere else. The item is worked out before the
// call's inputs, as it was, so what fails or prints does so in the same
// order.

import { isArray, kids, mapLocals, type CoreIR, type SExpr, type SFunc } from "./scalar.ts";

const PUSH_FRONT = /^array\.pushFront\.a(\d+)$/, EMPTY = /^array\.empty\.a(\d+)$/;

// The array index a function's body conses with, when it is `cons(item,
// rest)` and nothing else (array-list.ts `array cons`), or null.
function consOf(g: SFunc): number | null {
  const b = g.body;
  if (g.params.length !== 2 || b.k !== "rt" || b.args.length !== 2) return null;
  const m = PUSH_FRONT.exec(b.fn);
  const [rest, item] = b.args;
  return m && rest.k === "local" && rest.i === 1 && item.k === "local" && item.i === 0 ? Number(m[1]) : null;
}
// Whether a function's body is the empty array (`array nil`).
const nilOf = (g: SFunc): number | null => (g.params.length === 0 && g.body.k === "rt" && !g.body.args.length && EMPTY.test(g.body.fn) ? Number(EMPTY.exec(g.body.fn)![1]) : null);

export function consLoops(ir: CoreIR): number {
  const conses = new Map<number, number>(), nils = new Map<number, number>();
  ir.funcs.forEach((g, i) => { const c = consOf(g); if (c !== null) conses.set(i, c); const n = nilOf(g); if (n !== null) nils.set(i, n); });
  let made = 0;
  const n = ir.funcs.length;
  for (let fi = 0; fi < n; fi++) if (loopOf(ir, fi, conses, nils) || foldOf(ir, fi)) made++;
  return made;
}

function loopOf(ir: CoreIR, fi: number, conses: Map<number, number>, nils: Map<number, number>): boolean {
  const f = ir.funcs[fi];
  if (f.multi || f.spends || f.budgeted || !isArray(f.result)) return false;
  const a = f.result.index;
  const calls = (e: SExpr): number => (e.k === "call" && e.fn === fi ? 1 : 0) + kids(e).reduce((s, x) => s + calls(x), 0);
  // `cons(x, f(…))` as a call of the cons function or the push itself:
  // the item and the call.
  const consed = (e: SExpr): { item: SExpr; call: SExpr & { k: "call" } } | null => {
    if (e.k === "call" && conses.get(e.fn) === a && !e.cps) {
      const [item, rest] = e.args;
      if (rest.k === "call" && rest.fn === fi && !rest.cps && !calls(item) && !rest.args.some(calls)) return { item, call: rest };
    }
    // A push written as such takes the rest first, worked out before the
    // item: not taken, as the order would change.
    return null;
  };
  const empty = (e: SExpr) => (e.k === "call" && nils.get(e.fn) === a) || (e.k === "rt" && EMPTY.exec(e.fn)?.[1] === String(a) && !e.args.length);
  // Every return checked: a let's body, an if's sides, a case's arms.
  let consing = 0;
  const ok = (e: SExpr): boolean => {
    switch (e.k) {
      case "let": return !calls(e.value) && ok(e.body);
      case "if": return !calls(e.cond) && ok(e.then) && ok(e.else);
      case "case": return !calls(e.scrut) && e.arms.every((x) => !x || ok(x));
      default: {
        if (e.k === "call" && e.fn === fi && e.tail && !e.cps) return !e.args.some(calls);
        if (consed(e)) { consing++; return true; }
        return empty(e);
      }
    }
  };
  if (!ok(f.body) || !consing) return false;
  // g: f's inputs and the items so far, after them; its locals f's, moved
  // one on, and one for the item.
  const at = f.params.length, gi = ir.funcs.length;
  const shift = (i: number) => (i >= at ? i + 1 : i);
  const locals = [...f.locals.slice(0, at), f.result, ...f.locals.slice(at)];
  const acc: SExpr = { k: "local", i: at };
  const to = (e: SExpr): SExpr => {
    switch (e.k) {
      case "let": return { ...e, body: to(e.body) };
      case "if": return { ...e, then: to(e.then), else: to(e.else) };
      case "case": return { ...e, arms: e.arms.map((x) => x && to(x)) };
      default: {
        if (e.k === "call" && e.fn === fi) return { ...e, fn: gi, args: [...e.args, acc], tail: true };
        const c = consed(e);
        if (c) {
          const t = locals.push(ir.arrays[a].item) - 1;
          return { k: "let", i: t, value: c.item, body: { ...c.call, fn: gi, args: [...c.call.args, { k: "rt", fn: `array.push.a${a}`, args: [acc, { k: "local", i: t }] }], tail: true } };
        }
        return acc;
      }
    }
  };
  const g: SFunc = { ...f, name: `${f.name}$onto`, params: [...f.params, f.result], locals, body: to(mapLocals(f.body, shift)), inner: true };
  ir.funcs.push(g);
  f.body = { k: "call", fn: gi, args: [...f.params.map((_, i): SExpr => ({ k: "local", i })), { k: "rt", fn: `array.empty.a${a}`, args: [] }], tail: true };
  return true;
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
