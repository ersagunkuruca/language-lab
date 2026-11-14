// A function going down an array item by item and working out its answer
// on the way back up (trek's `steepest(ls)`: `it = steepest(more)`, then
// `steeper(l, …)`) holds a frame of WebAssembly's stack per item, which
// Node's WASI and wasmtime hold some thousands of (C222, GAPS.md round 16
// R3). cons-loops.ts makes the shapes whose way back up only conses or
// ands into loops; this makes the rest: what the way back up needs is
// kept on the heap, in a frame of a data type of the pass's own, and two
// loops run the function, one down (f's own body, each call of itself
// pushing a frame) and one back up (popping a frame and running what came
// after that call). What runs, runs in the same order: what f works out
// before the call of itself on the way down, then the innermost answer,
// then what came after each call, the deepest first. As compiled
// JavaScript's generators do (C137c18), and scalar.ts framesOf for a fold
// of data; C has a 1 GiB stack.
//
// Taken: a function calling itself non-tail at most once on any path, as
// `let r = f(…)` with nothing of f after it but r's uses, its input there
// the rest of an array input of its own (or a field of a case on it), so
// that it goes as deep as the array is long.

import { freeLocals, kids, mapLocals, type CoreIR, type DType, type LType, type SExpr, type SFunc } from "./scalar.ts";

type Call = SExpr & { k: "call" };
type Site = { at: SExpr & { k: "let" }; call: Call; live: number[] };

export function deepLoops(ir: CoreIR): number {
  let made = 0;
  const n = ir.funcs.length;
  for (let fi = 0; fi < n; fi++) if (deepLoop(ir, fi)) made++;
  return made;
}

// The kinds a body may hold: no handler, budget or search, which keep
// state in locals mapLocals doesn't move or go on after a call.
const OPAQUE = new Set(["handle", "budget", "search", "released"]);

function deepLoop(ir: CoreIR, fi: number): boolean {
  const f = ir.funcs[fi];
  if (f.multi || f.spends || f.budgeted) return false;
  const calls = (e: SExpr): number => (e.k === "call" && e.fn === fi ? 1 : 0) + kids(e).reduce((s, x) => s + calls(x), 0);
  let bad = false;
  const scan = (e: SExpr) => { if (OPAQUE.has(e.k) || (e.k === "call" && e.fn === fi && e.cps)) bad = true; kids(e).forEach(scan); };
  scan(f.body);
  if (bad) return false;
  // Locals bound to what: the input a call goes down by.
  const bound = new Map<number, SExpr>();
  const binds = (e: SExpr) => { if (e.k === "let") bound.set(e.i, e.value); kids(e).forEach(binds); };
  binds(f.body);
  const scruts = new Map<number, number>();
  const cases = (e: SExpr) => { if (e.k === "case" && e.scrut.k === "local") scruts.set(e.s, e.scrut.i); kids(e).forEach(cases); };
  cases(f.body);
  const val = (e: SExpr): SExpr => (e.k === "local" && bound.has(e.i) ? val(bound.get(e.i)!) : e);
  // Input j's rest: array rest of it, or a field of a case on it.
  const down = (e: SExpr, j: number): boolean => {
    const v = val(e);
    if (v.k === "rt" && /^array\.(rest|drop|slice)\.a\d+$/.test(v.fn) && v.args[0]?.k === "local" && v.args[0].i === j) return true;
    return v.k === "field" && v.rec.k === "local" && (v.rec.i === j || scruts.get(v.rec.i) === j) && v.t === f.params[j];
  };
  const sites: Site[] = [];
  // Every path: control (let, if, case) with no call of f in what it
  // tests or binds, down to a leaf with none either, a call of f in tail
  // position, or `let r = f(…)` whose body has none.
  const ok = (e: SExpr): boolean => {
    switch (e.k) {
      case "let": {
        if (e.value.k === "call" && e.value.fn === fi && !e.value.cps && !e.value.args.some(calls) && !calls(e.body)) {
          const c = e.value;
          if (!c.args.some((a, j) => down(a, j))) return false;
          sites.push({ at: e, call: c, live: freeLocals(e.body).filter((i) => i !== e.i) });
          return true;
        }
        return !calls(e.value) && ok(e.body);
      }
      case "if": return !calls(e.cond) && ok(e.then) && ok(e.else);
      case "case": return !calls(e.scrut) && e.arms.every((x) => !x || ok(x));
      default:
        if (e.k === "call" && e.fn === fi && e.tail && !e.cps) return !e.args.some(calls);
        return !calls(e);
    }
  };
  if (!ok(f.body) || !sites.length) return false;
  const at = f.params.length, gi = ir.funcs.length, ui = gi + 1;
  // The frames: done, or one case per call, the locals what comes after
  // it reads, and the frames under it.
  const key = `${f.name}$frames.${fi}`;
  const frames: DType = { key, name: `${f.name}.frames`, def: f.def, cases: [{ variant: `${key}.done`, name: "done", fields: [] }], inner: true };
  sites.forEach((s, k) => frames.cases.push({ variant: `${key}.${k}`, name: `after${k}`, fields: [...s.live.map((i) => ({ name: `l${i}`, t: f.locals[i] })), { name: "next", t: frames }] }));
  ir.data.push(frames);
  const untail = (e: SExpr): SExpr => (e.k === "call" || e.k === "apply" ? { ...e, tail: false } : e);
  // g: down. f's inputs and the frames, then f's locals moved one on.
  const gShift = (i: number) => (i >= at ? i + 1 : i);
  const gLocals: LType[] = [...f.locals.slice(0, at), frames, ...f.locals.slice(at)];
  const S: SExpr = { k: "local", i: at };
  const up = (v: SExpr, s: SExpr): SExpr => ({ k: "call", fn: ui, args: [untail(v), s], tail: true });
  const toG = (e: SExpr): SExpr => {
    switch (e.k) {
      case "let": {
        const k = sites.findIndex((s) => s.at === e);
        if (k >= 0) {
          const s = sites[k];
          return { k: "call", fn: gi, args: [...s.call.args.map((a) => mapLocals(a, gShift)), { k: "new", t: frames, c: k + 1, args: [...s.live.map((i): SExpr => ({ k: "local", i: gShift(i) })), S] }], tail: true };
        }
        return { ...e, i: gShift(e.i), value: mapLocals(e.value, gShift), body: toG(e.body) };
      }
      case "if": return { ...e, cond: mapLocals(e.cond, gShift), then: toG(e.then), else: toG(e.else) };
      case "case": return { ...e, scrut: mapLocals(e.scrut, gShift), s: gShift(e.s), arms: e.arms.map((x) => x && toG(x)) };
      default:
        if (e.k === "call" && e.fn === fi) return { ...e, fn: gi, args: [...e.args.map((a) => mapLocals(a, gShift)), S], tail: true };
        return up(mapLocals(e, gShift), S);
    }
  };
  // u: up. The answer so far and the frames, then f's locals moved two
  // on, then the case's own.
  const uShift = (i: number) => i + 2;
  const uLocals: LType[] = [f.result, frames, ...f.locals];
  const sAt = uLocals.push(frames) - 1;
  const V: SExpr = { k: "local", i: 0 }, F: SExpr = { k: "local", i: 1 };
  const toU = (e: SExpr, next: SExpr): SExpr => {
    switch (e.k) {
      case "let": return { ...e, i: uShift(e.i), value: mapLocals(e.value, uShift), body: toU(e.body, next) };
      case "if": return { ...e, cond: mapLocals(e.cond, uShift), then: toU(e.then, next), else: toU(e.else, next) };
      case "case": return { ...e, scrut: mapLocals(e.scrut, uShift), s: uShift(e.s), arms: e.arms.map((x) => x && toU(x, next)) };
      default: return { k: "call", fn: ui, args: [untail(mapLocals(e, uShift)), next], tail: true };
    }
  };
  const field = (c: number, i: number): SExpr => ({ k: "field", rec: { k: "local", i: sAt }, t: frames, c, i });
  const uBody: SExpr = { k: "case", scrut: F, s: sAt, t: frames, result: f.result, arms: [V, ...sites.map((s, k): SExpr => {
    const next = field(k + 1, s.live.length);
    const after = { k: "let", i: uShift(s.at.i), value: V, body: toU(s.at.body, next) } as SExpr;
    return s.live.reduceRight<SExpr>((body, i, j) => ({ k: "let", i: uShift(i), value: field(k + 1, j), body }), after);
  })] };
  const g: SFunc = { ...f, name: `${f.name}$down`, params: [...f.params, frames], locals: gLocals, body: toG(f.body), inner: true };
  const u: SFunc = { ...f, name: `${f.name}$up`, params: [f.result, frames], locals: uLocals, body: uBody, inner: true };
  ir.funcs.push(g, u);
  f.body = { k: "call", fn: gi, args: [...f.params.map((_, i): SExpr => ({ k: "local", i })), { k: "new", t: frames, c: 0, args: [] }], tail: true };
  return true;
}
