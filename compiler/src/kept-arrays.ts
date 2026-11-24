// Arrays a loop keeps, read in place from their buffer (C303, compiled
// JavaScript): mnist's `dot` walks two arrays a position at a time, each
// item read through `item at`, which looks the array's view up again
// (`instanceof`, `buf`: is this version the one its buffer holds?) for
// every read, two thirds of the loop's time. Where a function loops by
// calling itself and hands the same array on to the next round, the view,
// its buffer and where it starts are worked out once before the loop
// (core-js.ts), and each read is an index into the buffer.
//
// A buffer is shared by every version of one array, and reading an older
// version turns the buffer back to it (array-view.ts rerootArray). So the
// loop must read no other array (not through a call either) and change
// none: its body only computes on numbers, branches and calls itself or
// functions that touch no array at all. Two of the arrays it keeps may
// be versions of one buffer; then reading the second turned the buffer
// away from the first, and the printed loop reads them as before (a flag
// worked out once, before the loop).

import { kids, type CoreIR, type SExpr } from "./scalar.ts";

export const ARRAY_READ = /^array\.(at|get|length)\.a\d+$/;
// What a loop's body may do besides reading its arrays: numbers' and
// Ints' runtime functions read no array.
const NUMBERS_RT = /^(int\.|number\.)/;

// Functions that never touch an array: they compute on numbers, branch
// and call functions like them.
function arrayFree(ir: CoreIR): boolean[] {
  const free = ir.funcs.map(() => true);
  for (let changed = true; changed; ) {
    changed = false;
    ir.funcs.forEach((f, i) => {
      if (!free[i]) return;
      const ok = (e: SExpr): boolean => {
        switch (e.k) {
          case "rt": if (e.host || !NUMBERS_RT.test(e.fn)) return false; break;
          case "call": if (e.cps || !free[e.fn]) return false; break;
          case "attempt": if (e.spent || e.resumes) return false; break;
          case "num": case "int": case "bool": case "text": case "local": case "let": case "if": case "op": case "get": case "field": case "make": case "new": case "tag": case "fail": case "zero": case "case": break;
          default: return false;
        }
        return kids(e).every(ok);
      };
      if (f.multi || f.inner || !ok(f.body)) { free[i] = false; changed = true; }
    });
  }
  return free;
}

// The inputs of function fi, a loop, that it reads as arrays and hands on
// unchanged to its next round: each local that is one (the input, or a
// let of it, as a function put in place has its inputs) to the input;
// none where its body does anything else with arrays.
export function keptArrays(ir: CoreIR, fi: number, free = arrayFree(ir)): Map<number, number> {
  const f = ir.funcs[fi];
  const read = new Set<number>(), kept = new Set(f.params.map((_, j) => j));
  const of = new Map<number, number>(f.params.map((_, j) => [j, j]));
  const binds = new Map<number, number>();
  const bind = (e: SExpr) => { const i = e.k === "let" ? e.i : e.k === "attempt" ? e.res : e.k === "case" ? e.s : undefined; if (i !== undefined) binds.set(i, (binds.get(i) ?? 0) + 1); kids(e).forEach(bind); };
  bind(f.body);
  let ok = true;
  const walk = (e: SExpr) => {
    if (!ok) return;
    switch (e.k) {
      case "local": { const j = of.get(e.i); if (j !== undefined) kept.delete(j); return; }
      case "let":
        // A let of an input, set once: the input.
        if (e.value.k === "local" && e.value.i < f.params.length && binds.get(e.i) === 1 && !e.check && !e.seeded) { of.set(e.i, e.value.i); walk(e.body); return; }
        break;
      case "rt":
        if (e.host) { ok = false; return; }
        if (ARRAY_READ.test(e.fn)) {
          const j = e.args[0]?.k === "local" ? of.get(e.args[0].i) : undefined;
          if (j === undefined) { ok = false; return; }
          read.add(j);
          e.args.slice(1).forEach((a) => walk(a));
          return;
        }
        if (!NUMBERS_RT.test(e.fn)) { ok = false; return; }
        break;
      case "call":
        if (e.cps) { ok = false; return; }
        if (e.fn === fi && e.tail) {
          // The same array handed on, where it was: kept.
          e.args.forEach((a, j) => (a.k === "local" && of.get(a.i) === j ? undefined : walk(a)));
          return;
        }
        if (!free[e.fn]) { ok = false; return; }
        break;
      case "attempt": if (e.spent || e.resumes) { ok = false; return; } break;
      case "num": case "int": case "bool": case "text": case "if": case "op": case "get": case "field": case "make": case "new": case "tag": case "fail": case "zero": case "case": break;
      default: ok = false; return;
    }
    kids(e).forEach(walk);
  };
  walk(f.body);
  // An input read as an array is kept only when it is used as nothing
  // else (walk drops one used anywhere but as an array read's array or
  // handed on in place); and every array read is of one kept.
  if (!ok || ![...read].every((j) => kept.has(j))) return new Map();
  return new Map([...of].filter(([, j]) => read.has(j)));
}

export const keptArraysOf = (ir: CoreIR): ((fi: number) => Map<number, number>) => {
  const free = arrayFree(ir);
  return (fi) => keptArrays(ir, fi, free);
};

// A loop's positions and counts as plain numbers (C303): an Int is a
// JavaScript number while small and a BigInt past 2^28 (int.ts), so each
// `+` checks its answer, and V8 then can't keep the loop's Ints as
// machine integers (mnist's `dot`: its two positions and its count, 0.9
// of its 1.6 s with the arrays read in place). An input of a loop counts
// when the loop only reads an array at it, compares it with a constant
// or an input it hands on unchanged, and hands it on to its next round
// as it was or with one constant step (`i + step`, `n - 1`): it never
// leaves the loop. As numbers its rounds are the Ints' exactly until one
// passes 2^53; the step's sign doesn't change, so from there it only
// goes further, past every array's length and every constant compared
// with, as the Ints do, and every read and comparison answers as theirs.
// The loop starts so when these inputs and steps are numbers (small
// Ints), else it goes on as written (core-js.ts `$s`).
export interface Counted {
  // The inputs counted, and the inputs their steps and comparisons read.
  ints: number[];
  steady: number[];
  // The steps, worked out as numbers.
  plain: WeakSet<SExpr>;
  // Each counted input's step: down or up, by a constant or an input.
  step: Map<number, { down: boolean; by: bigint | number; input: boolean }>;
  // The inputs stepped by every call of the loop's next round.
  always: Set<number>;
}
const SMALL = 2n ** 28n;
export function countedInts(ir: CoreIR, fi: number): Counted | null {
  const f = ir.funcs[fi], n = f.params.length;
  const of = new Map<number, number>(f.params.map((_, j) => [j, j]));
  const lits = new Map<number, bigint>();
  const binds = new Map<number, number>();
  const bind = (e: SExpr) => { const i = e.k === "let" ? e.i : e.k === "attempt" ? e.res : e.k === "case" ? e.s : undefined; if (i !== undefined) binds.set(i, (binds.get(i) ?? 0) + 1); kids(e).forEach(bind); };
  bind(f.body);
  const dropped = new Set<number>(), inPlace = new Set(f.params.map((_, j) => j));
  const steps = new Map<number, Set<string>>(), reads = new Map<number, Set<number>>();
  const stepNodes: [SExpr, number][] = [];
  const stepOf = new Map<number, { down: boolean; by: bigint | number; input: boolean }>();
  const stepped = new Map<number, number>();
  let rounds = 0;
  const alias = (e: SExpr) => (e.k === "local" ? of.get(e.i) : undefined);
  // A constant or an input: its key, and the input it reads.
  const steady = (e: SExpr): [string, number | undefined] | null => {
    const v = e.k === "int" ? e.v : e.k === "local" ? lits.get(e.i) : undefined;
    if (v !== undefined) return v < SMALL && v > -SMALL ? [`${v}`, undefined] : null;
    const s = alias(e);
    return s === undefined ? null : [`l${s}`, s];
  };
  const needs = (j: number, s: number | undefined) => { if (s !== undefined) { const r = reads.get(j) ?? new Set(); reads.set(j, r.add(s)); } };
  const walk = (e: SExpr): void => {
    switch (e.k) {
      case "local": { const j = of.get(e.i); if (j !== undefined) dropped.add(j); return; }
      case "let":
        if (binds.get(e.i) === 1 && !e.check && !e.seeded) {
          if (e.value.k === "local" && e.value.i < n) { of.set(e.i, e.value.i); walk(e.body); return; }
          if (e.value.k === "int") { lits.set(e.i, e.value.v); walk(e.body); return; }
        }
        break;
      case "rt":
        // An array's item at the input: read as it is.
        if (/^array\.(at|get)\.a\d+$/.test(e.fn) && e.args.length === 2 && alias(e.args[1]) !== undefined) { walk(e.args[0]); return; }
        if ((e.fn === "int.less" || e.fn === "int.equal") && e.args.length === 2) {
          const [a, b] = e.args, ja = alias(a), jb = alias(b), sa = steady(a), sb = steady(b);
          if (ja !== undefined && jb === undefined && sb) { needs(ja, sb[1]); return; }
          if (jb !== undefined && ja === undefined && sa) { needs(jb, sa[1]); return; }
        }
        break;
      case "call":
        if (e.fn === fi && e.tail) {
          rounds++;
          e.args.forEach((a, j) => {
            if (alias(a) === j) return;
            inPlace.delete(j);
            if (a.k === "rt" && (a.fn === "int.add" || a.fn === "int.sub") && a.args.length === 2) {
              const [x, y] = a.args, st = alias(x) === j ? steady(y) : a.fn === "int.add" && alias(y) === j ? steady(x) : null;
              if (st) {
                (steps.get(j) ?? steps.set(j, new Set()).get(j)!).add(`${a.fn} ${st[0]}`);
                needs(j, st[1]);
                stepNodes.push([a, j]);
                stepped.set(j, (stepped.get(j) ?? 0) + 1);
                const by = alias(x) === j ? y : x, lit = by.k === "int" ? by.v : by.k === "local" ? lits.get(by.i) : undefined;
                stepOf.set(j, { down: a.fn === "int.sub", by: lit ?? st[1]!, input: lit === undefined });
                return;
              }
            }
            walk(a);
          });
          return;
        }
        break;
    }
    kids(e).forEach(walk);
  };
  walk(f.body);
  const ints = [...steps.keys()].filter((j) => f.locals[j] === "int" && !dropped.has(j) && steps.get(j)!.size === 1 && [...reads.get(j) ?? []].every((s) => s !== j && inPlace.has(s) && f.locals[s] === "int")).sort((a, b) => a - b);
  if (!ints.length) return null;
  const plain = new WeakSet<SExpr>();
  for (const [a, j] of stepNodes) if (ints.includes(j)) plain.add(a);
  const read = new Set(ints.flatMap((j) => [...reads.get(j) ?? []]));
  const always = new Set(ints.filter((j) => stepped.get(j) === rounds));
  return { ints, steady: [...read].filter((s) => !ints.includes(s)).sort((a, b) => a - b), plain, step: new Map(ints.map((j) => [j, stepOf.get(j)!])), always };
}

// Reads that stay in their arrays (C303c): a loop that goes on only while
// a count is at least 1, takes 1 from it in every next round, and reads
// its kept arrays only on the way on, each at a counted position stepped
// by a constant step, reads at the positions p, p + s, …, p + (c − 1)s
// at most, c the count it starts with. When the first and the last of
// those are in the array (worked out once before the loop: in numbers,
// and past 2^53 too far to be in any array), no read in it can fall
// outside, and each reads its slot unchecked (core-js.ts). Otherwise the
// loop runs with its checks (`$c`).
export interface Bounded { count: number; reads: { array: number; at: number }[] }
export function boundedReads(ir: CoreIR, fi: number, kept: Map<number, number>, counted: Counted): Bounded | null {
  const f = ir.funcs[fi], n = f.params.length;
  const of = new Map<number, number>(f.params.map((_, j) => [j, j]));
  const lits = new Map<number, bigint>();
  // The lets the loop starts with (a function put in place has its
  // inputs as lets), down to its test.
  let e = f.body;
  while (e.k === "let") {
    if (e.value.k === "local" && e.value.i < n) of.set(e.i, e.value.i);
    else if (e.value.k === "int") lits.set(e.i, e.value.v);
    e = e.body;
  }
  if (e.k !== "if") return null;
  const lit = (x: SExpr) => (x.k === "int" ? x.v : x.k === "local" ? lits.get(x.i) : undefined);
  const alias = (x: SExpr) => (x.k === "local" ? of.get(x.i) : undefined);
  // The test as "c ≥ 1", and which way goes on (its own lets first).
  let cond = e.cond, flip = false;
  while (cond.k === "let") {
    if (cond.value.k === "local" && cond.value.i < n) of.set(cond.i, cond.value.i);
    else if (cond.value.k === "int") lits.set(cond.i, cond.value.v);
    cond = cond.body;
  }
  if (cond.k === "op" && cond.op === "not" && cond.args.length === 1) { cond = cond.args[0]; flip = true; }
  if (cond.k !== "rt" || cond.fn !== "int.less" || cond.args.length !== 2) return null;
  const [a, b] = cond.args;
  let count: number | undefined, onIfLess: boolean;
  if (lit(a) === 0n && alias(b) !== undefined) { count = alias(b); onIfLess = true; } // 0 < c
  else if (alias(a) !== undefined && lit(b) === 1n) { count = alias(a); onIfLess = false; } // c < 1
  else return null;
  const step = counted.step.get(count!);
  if (step === undefined || !counted.always.has(count!) || !step.down || step.input || step.by !== 1n) return null;
  const [on, off] = onIfLess !== flip ? [e.then, e.else] : [e.else, e.then];
  const selfCall = (x: SExpr): boolean => (x.k === "call" && x.fn === fi) || kids(x).some(selfCall);
  const keptRead = (x: SExpr): boolean => (x.k === "rt" && ARRAY_READ.test(x.fn) && x.args[0]?.k === "local" && kept.has(x.args[0].i)) || kids(x).some(keptRead);
  if (selfCall(off) || keptRead(off)) return null;
  // Every read of a kept array on the way on, at a counted position.
  const reads = new Map<string, { array: number; at: number }>();
  let ok = true;
  const walk = (x: SExpr) => {
    if (x.k === "let" && x.value.k === "local" && of.has(x.value.i)) of.set(x.i, of.get(x.value.i)!);
    if (x.k === "rt" && ARRAY_READ.test(x.fn) && x.args[0]?.k === "local" && kept.has(x.args[0].i)) {
      if (x.fn.startsWith("array.length.")) return;
      const at = x.args[1] && alias(x.args[1]);
      if (at === undefined || !counted.step.has(at)) { ok = false; return; }
      const array = kept.get(x.args[0].i)!;
      reads.set(`${array} ${at}`, { array, at });
    }
    kids(x).forEach(walk);
  };
  walk(on);
  return ok && reads.size ? { count: count!, reads: [...reads.values()] } : null;
}
