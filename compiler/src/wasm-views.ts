// C327c2 (ALLOCATIONS-2026-11-24.md): an array's view held by value on
// WebAssembly, where a function runs as a loop. A view is a GC struct (its
// buffer, a start and a length), and a loop that walks an array by `rest`
// made one a step: flock's `merge sorted` one per item merged. Here the
// views such a loop keeps are three locals each instead (the buffer, the
// start, the length): read in place by length, first, `item at`; `rest`
// moves the start; the loop's next round sets the three. A view is made
// only where one leaves the loop (an input of another function, a value
// given back), on a branch that doesn't go round again, so the struct a
// step becomes one a run, as C's views by value (C327c) made it none.
// Which views: a looping function's array inputs that some round gives
// the `rest` of one of them, and those rests; not where one would be made
// on a branch that goes round again, which would make a struct a step as
// before. Not for an array kept as versions (C285), whose view is the
// version: wasm.ts says which.

import { isArray, kids, mapKids, mapLocals, type AType, type LType, type SExpr, type SFunc } from "./scalar.ts";

// What wasm.ts reads besides the function: the locals each next round
// sets, in the order of its call's inputs, and what goes into the new
// locals before the loop.
export type ViewFunc = SFunc & { viewSlots?: number[]; viewEntry?: [number, SExpr][] };

// Reads that take the view first and nothing else of it (wasm.ts writes
// each again on the three, `view.first.a3`).
const READ = /^array\.(length|first|at|get)\.a(\d+)(\.i64)?$/;
const REST = /^array\.rest\.a(\d+)$/;
// A next round's view one item longer (a map's, built from the end).
const FEED = /^array\.(pushFront|push|pushOwned)\.a(\d+)$/;
const simple = (e: SExpr) => ["local", "num", "int", "bool", "text"].includes(e.k);

// A function that is one array function on its inputs (`array cons` is
// a push in front): its call read as that function's, where the inputs
// are locals or constants, so going first changes nothing.
export function arrayCall(g: SFunc): { fn: string; from: number[] } | null {
  const e = g.body;
  if (e.k !== "rt" || !(READ.test(e.fn) || REST.test(e.fn) || FEED.test(e.fn)) || !e.args.every((a) => a.k === "local" && a.i < g.params.length)) return null;
  return { fn: e.fn, from: e.args.map((a) => (a as { i: number }).i) };
}

// A let of another local is that local (the round's inputs don't change
// within it), and an array function's own call is it (arrayCall).
function plain(e: SExpr, calls: (fn: number) => { fn: string; from: number[] } | null): SExpr {
  if (e.k === "let" && e.i >= 0 && e.value.k === "local") { const v = e.i, x = e.value.i; return plain(mapLocals(e.body, (i) => (i === v ? x : i)), calls); }
  if (e.k === "call" && !e.tail && e.args.every(simple)) { const c = calls(e.fn); if (c) return { k: "rt", fn: c.fn, args: c.from.map((j) => plain(e.args[j], calls)) }; }
  return mapKids(e, (x) => plain(x, calls));
}

export function viewsByValue(f0: SFunc, self: number, byValue: (a: AType) => boolean, buf: (a: AType) => LType, calls: (fn: number) => { fn: string; from: number[] } | null = () => null): ViewFunc | null {
  const isSelf = (e: SExpr): e is SExpr & { k: "call" } => e.k === "call" && e.tail && e.fn === self;
  const loops = (e: SExpr): boolean => isSelf(e) || kids(e).some(loops);
  if (f0.partial || f0.spends || !loops(f0.body)) return null;
  const f = { ...f0, body: plain(f0.body, calls) };
  const local = (e: SExpr, set: Set<number>) => (e.k === "local" && set.has(e.i) ? e.i : -1);
  // The rests: let v = rest(x).
  const restOf = new Map<number, number>();
  (function lets(e: SExpr): void { if (e.k === "let" && e.i >= 0 && e.value.k === "rt" && REST.test(e.value.fn) && e.value.args[0].k === "local") restOf.set(e.i, e.value.args[0].i); kids(e).forEach(lets); })(f.body);
  const C = new Set<number>();
  f.params.forEach((t, j) => { if (isArray(t) && byValue(t)) C.add(j); });
  for (const [v, x] of restOf) if (C.has(x)) C.add(v);
  // Fed by a rest at some round.
  const fed = new Set<number>();
  for (;;) {
    const size = C.size;
    fed.clear();
    const drop = new Set<number>();
    const walk = (e: SExpr, round: boolean): void => {
      if (e.k === "local") { if (C.has(e.i) && round) drop.add(e.i); return; }
      if (e.k === "rt" && READ.test(e.fn) && local(e.args[0], C) >= 0) { e.args.slice(1).forEach((a) => walk(a, round)); return; }
      if (e.k === "let" && C.has(e.i) && restOf.has(e.i)) { walk(e.body, round); return; }
      if (isSelf(e)) {
        e.args.forEach((a, j) => {
          const y = local(a, C);
          if (y >= 0 && C.has(j)) { if (restOf.has(y)) fed.add(j); }
          // Pushed onto (the inputs before it as they are, so the push
          // can go first).
          else if (C.has(j) && a.k === "rt" && FEED.test(a.fn) && local(a.args[0], C) >= 0 && e.args.slice(0, j).every(simple)) { fed.add(j); walk(a.args[1], round); }
          else if (C.has(j)) drop.add(j);
          else walk(a, round);
        });
        return;
      }
      if (e.k === "if") { walk(e.cond, round); walk(e.then, loops(e.then)); walk(e.else, loops(e.else)); return; }
      if (e.k === "case") { walk(e.scrut, round); e.arms.forEach((a) => a && walk(a, loops(a))); return; }
      kids(e).forEach((k) => walk(k, round));
    };
    walk(f.body, true);
    for (const x of drop) C.delete(x);
    for (const [v, x] of restOf) if (C.has(v) && !C.has(x)) C.delete(v);
    // An input no round gives a rest keeps its view.
    if (C.size === size) { for (const j of [...C]) if (j < f.params.length && !fed.has(j)) C.delete(j); }
    if (C.size === size) break;
  }
  if (![...C].some((j) => j < f.params.length)) return null;
  // Three locals each, and three more for an input pushed onto, which
  // hold the push's until the round's inputs are set.
  const locals = [...f.locals], at = new Map<number, number>(), tmp = new Map<number, number>();
  for (const x of [...C].sort((a, b) => a - b)) { at.set(x, locals.length); locals.push(buf(f.locals[x] as AType), "i32", "i32"); }
  for (const j of [...C].filter((j) => j < f.params.length).sort((a, b) => a - b)) { tmp.set(j, locals.length); locals.push(buf(f.locals[j] as AType), "i32", "i32"); }
  const get = (i: number): SExpr => ({ k: "local", i });
  const three = (x: number) => [0, 1, 2].map((k) => get(at.get(x)! + k));
  const index = (x: number) => (f.locals[x] as AType).index;
  const slots = f.params.map((_, j) => j);
  for (const j of f.params.keys()) if (C.has(j)) slots.push(at.get(j)!, at.get(j)! + 1, at.get(j)! + 2);
  const rw = (e: SExpr): SExpr => {
    if (e.k === "local" && C.has(e.i)) return { k: "rt", fn: `view.make.a${index(e.i)}`, args: three(e.i) };
    if (e.k === "rt" && READ.test(e.fn) && local(e.args[0], C) >= 0) {
      const x = local(e.args[0], C);
      return { ...e, fn: e.fn.replace(/^array\./, "view."), args: [...three(x), ...e.args.slice(1).map(rw)] };
    }
    if (e.k === "let" && C.has(e.i) && restOf.has(e.i)) {
      const x = restOf.get(e.i)!, [b, s, n] = three(x), v = at.get(e.i)!, a = index(x);
      return { k: "let", i: v, value: b, body: { k: "let", i: v + 1, value: { k: "rt", fn: `view.restStart.a${a}`, args: [b, s, n] }, body: { k: "let", i: v + 2, value: { k: "rt", fn: "view.restLength", args: [n] }, body: rw(e.body) } } };
    }
    if (isSelf(e)) {
      const extra: SExpr[] = [], pushes: [number, SExpr][] = [];
      const args = e.args.map((a, j) => {
        if (!C.has(j)) return rw(a);
        const y = local(a, C);
        if (y >= 0) { extra.push(...three(y)); return get(j); }
        // The push on the three: its buffer (the same or a copy), then
        // where the view starts in it, one longer.
        const p = a as SExpr & { k: "rt" }, [op, k] = FEED.exec(p.fn)!.slice(1), [b, s, n] = three(local(p.args[0], C)), t = tmp.get(j)!;
        pushes.push([t, { k: "rt", fn: `view.${op}.a${k}`, args: [b, s, n, rw(p.args[1])] }]);
        pushes.push([t + 1, { k: "rt", fn: `view.${op}Start.a${k}`, args: [get(t), b, s] }], [t + 2, { k: "rt", fn: "view.grown", args: [n] }]);
        extra.push(get(t), get(t + 1), get(t + 2));
        return get(j);
      });
      return pushes.reduceRight((body: SExpr, [i, value]) => ({ k: "let", i, value, body }), { ...e, args: [...args, ...extra] });
    }
    return mapKids(e, rw);
  };
  const entry: [number, SExpr][] = [];
  for (const j of f.params.keys()) if (C.has(j)) ["buf", "start", "count"].forEach((w, k) => entry.push([at.get(j)! + k, { k: "rt", fn: `view.${w}.a${index(j)}`, args: [get(j)] }]));
  return { ...f, locals, body: rw(f.body), viewSlots: slots, viewEntry: entry };
}
