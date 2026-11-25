// Ints known small, worked out as JavaScript numbers (C267, compiled
// JavaScript): an Int is a JS number while it is small (|x| < 2^28,
// int.ts) and a BigInt past it, so each sum and product checks its
// answer and remainder works on either. Where the program shows both
// inputs and the answer are small, `+`, `-`, `*` and `%` are enough: the
// flock's cell of a point, `(cz * 12 + cy) * 12 + cx` with each a
// remainder by 12, worked out 27 times for each bird each tick.
//
// Each Int gets a range [lo, hi] where one can be found: a literal is its
// own; a remainder by a positive literal k is in [0, k − 1] (Ints' is the
// floor's, never negative for a positive k); sums, differences and
// products of ranges are ranges; a branch, an attempt or a call is the
// join of what it can give. A function's inputs join what its calls give
// them, worked out again until nothing changes; one handed out as a value,
// or called from outside, takes anything. A range still growing after a
// few rounds (a loop's count) is no range.
// Prior art: interval analysis (Cousot and Cousot 1977) with widening;
// V8's own range analysis does this within a function for its Smis.

import type { CoreIR, SExpr } from "./scalar.ts";
import { kids, mapKids } from "./scalar.ts";

type Range = readonly [number, number];
// undefined: nothing yet (no value reaches it); null: any Int.
type R = Range | null | undefined;
const SMALL = 2 ** 28;
const join = (a: R, b: R): R => (a === undefined ? b : b === undefined ? a : a === null || b === null ? null : [Math.min(a[0], b[0]), Math.max(a[1], b[1])]);
const same = (a: R, b: R) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1]);
const small = (r: R): r is Range => !!r && r[0] > -SMALL && r[1] < SMALL;
const known = (r: R) => (r === undefined ? null : r);
const mul = (a: Range, b: Range): Range => { const p = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]]; return [Math.min(...p), Math.max(...p)]; };
const kLit = (e: SExpr) => (e.k === "int" && e.v > 0n && e.v < 1n << 31n ? Number(e.v) : null);

export function intRanges(ir: CoreIR, roots: Set<number>): number {
  const n = ir.funcs.length;
  // Functions handed out as values or called from outside take anything.
  const open = new Set<number>(roots);
  const called = new Set<number>();
  // And who calls whom, so a round reads again only a function whose
  // inputs or callees' results changed: the same rounds, in less time.
  const callers: Set<number>[] = ir.funcs.map(() => new Set());
  let at = 0;
  const scan = (e: SExpr) => { if (e.k === "closure") { open.add(e.fn); if (e.d !== undefined) open.add(e.d); } if (e.k === "call") { called.add(e.fn); callers[e.fn].add(at); if (e.cps) open.add(e.fn); } kids(e).forEach(scan); };
  ir.funcs.forEach((f, i) => { at = i; scan(f.body); });
  ir.funcs.forEach((f, i) => { if (!called.has(i) || f.multi || f.piece) open.add(i); });
  const params: R[][] = ir.funcs.map((f, i) => f.params.map(() => (open.has(i) ? null : undefined)));
  const results: R[] = ir.funcs.map(() => undefined);
  const locals: Map<number, R>[] = ir.funcs.map(() => new Map());
  let next: R[][] = params.map((p) => [...p]);
  const value = (fi: number, e: SExpr, env: Map<number, R>): R => {
    const v = (x: SExpr) => value(fi, x, env);
    switch (e.k) {
      case "int": { const x = Number(e.v); return Math.abs(x) < SMALL ? [x, x] : null; }
      case "local": return env.has(e.i) ? env.get(e.i) : ir.funcs[fi].locals[e.i] === "int" ? null : null;
      case "let": env.set(e.i, v(e.value)); return v(e.body);
      case "if": v(e.cond); return join(v(e.then), v(e.else));
      case "attempt": { env.set(e.res, v(e.body)); return join(v(e.ok), v(e.otherwise)); }
      case "fail": return undefined;
      case "call": {
        const xs = e.args.map(v);
        xs.forEach((x, j) => { if (!open.has(e.fn)) next[e.fn][j] = join(next[e.fn][j], x); });
        return results[e.fn];
      }
      case "rt": {
        const xs = e.args.map(v);
        const [a, b] = xs.map(known);
        switch (e.fn) {
          case "int.add": return a && b ? [a[0] + b[0], a[1] + b[1]] : null;
          case "int.sub": return a && b ? [a[0] - b[1], a[1] - b[0]] : null;
          case "int.neg": return a ? [-a[1], -a[0]] : null;
          case "int.mul": return a && b ? mul(a, b) : null;
          case "int.remainder": { const k = kLit(e.args[1]); return k ? [0, k - 1] : null; }
          default: return null;
        }
      }
      default: kids(e).forEach(v); return null;
    }
  };
  // (A call's inputs are joined into its callee's each round: one not
  // read again gives what it gave, which they hold already.)
  let dirty = new Set<number>(ir.funcs.keys());
  for (let round = 0; round < 12; round++) {
    next = params.map((p) => [...p]);
    let changed = false;
    const later = new Set<number>();
    ir.funcs.forEach((f, fi) => {
      if (!dirty.has(fi)) return;
      const env = new Map<number, R>();
      f.params.forEach((_, j) => env.set(j, params[fi][j]));
      const r = value(fi, f.body, env);
      const w = join(results[fi], r);
      if (!same(w, results[fi])) {
        results[fi] = round > 6 ? null : w; changed = true;
        // A caller after it reads the new result this round, one before
        // it the next, as when every function is read each round.
        for (const c of callers[fi]) (c > fi ? dirty : later).add(c);
      }
      locals[fi] = env;
    });
    for (let i = 0; i < n; i++) for (let j = 0; j < params[i].length; j++) {
      const w = join(params[i][j], next[i][j]);
      if (!same(w, params[i][j])) { params[i][j] = round > 6 ? null : w; changed = true; later.add(i); }
    }
    dirty = later;
    if (!changed) break;
    if (round === 11) return 0;
  }
  // Each sum, difference, product and remainder of small Ints giving a
  // small Int, as the JavaScript operator.
  let count = 0;
  ir.funcs.forEach((f, fi) => {
    const env = locals[fi];
    const r = (e: SExpr): R => {
      switch (e.k) {
        case "int": { const x = Number(e.v); return Math.abs(x) < SMALL ? [x, x] : null; }
        case "local": return env.get(e.i) ?? null;
        case "rt": return value(fi, e, new Map(env));
        default: return null;
      }
    };
    const go = (e: SExpr): SExpr => {
      const x = mapKids(e, go);
      if (x.k === "rt" && e.k === "rt" && /^int\.(add|sub|mul)$/.test(x.fn) && x.args.length === 2 && small(r(e.args[0])) && small(r(e.args[1])) && small(r(e))) { count++; return { ...x, fn: `${x.fn}Small` }; }
      // `first(remainder(a, k), else …)`, a small: never none.
      if (x.k === "attempt" && x.body.k === "rt" && x.body.fn === "int.remainder" && x.ok.k === "local" && x.ok.i === x.res && kLit(x.body.args[1]) && e.k === "attempt" && e.body.k === "rt" && small(r(e.body.args[0]))) {
        count++;
        return { ...x.body, fn: (r(e.body.args[0]) as Range)[0] >= 0 ? "int.remainderSmallUp" : "int.remainderSmall" };
      }
      return x;
    };
    f.body = go(f.body);
  });
  return count;
}
