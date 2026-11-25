// An array walk's range checked once (C336, on C): a loop that reads
// `at(a, p)` each round, p stepping by s, for n rounds, n going down by
// one until n ≤ 0 (mnist's `dot`, a row times a column), checks p against
// a's length every read. The whole walk is in range when its first index
// and its last, p + s·(n − 1), are (the indices step evenly between them),
// so here such a loop gets a copy that reads without the check
// (`array.get`), and the loop goes to it when that holds as a round
// starts, and runs as written when not (loop versioning; JVMs hoist
// range checks the same way). The C331 measure: every bounds check
// dropped bought mnist 14% of its instructions.
//
// The loop is untagged-ints.ts's copy, its counts int64_ts. What it must
// be: its body `if n ≤ 0 then (no round again) else (…)`, each call of
// itself last and in the else; each array it reads given again as it is,
// each index given as `p + s` (s an int64 given as it is, or a literal),
// n given as `n − 1`. Reads in the then are left checked: they come after
// the walk.

import { kids, mapKids, type CoreIR, type SExpr, type SFunc } from "./scalar.ts";

const AT = /^array\.at\.a(\d+)$/;
type Local = SExpr & { k: "local" };
const isLocal = (e: SExpr, i?: number): e is Local => e.k === "local" && (i === undefined || e.i === i);
const lit = (e: SExpr): bigint | null => (e.k === "rt" && e.fn === "i64.lit" && e.args[0].k === "int" ? e.args[0].v : e.k === "int" ? e.v : null);

// `n ≤ 0` as the counted copy has it: a call of `at most` on Int (its body
// not(less(y, x))) with the count boxed and 0, or i64.less(0, n) negated.
function atMostZero(ir: CoreIR, e: SExpr): number | null {
  if (e.k === "call" && !e.tail && e.args.length === 2 && lit(e.args[1]) === 0n) {
    const a = e.args[0], h = ir.funcs[e.fn].body;
    const notLess = h.k === "op" && h.op === "not" && h.args[0].k === "rt" && h.args[0].fn === "int.less" && isLocal(h.args[0].args[0], 1) && isLocal(h.args[0].args[1], 0);
    if (notLess && a.k === "rt" && a.fn === "i64.box" && a.args[0].k === "local") return a.args[0].i;
  }
  return null;
}

// A function that is a checked read of its two inputs: `at` on an array,
// or that read with an answer past the end (mnist's `at`, 0 there), the
// same read in range.
function readOf(ir: CoreIR, fn: number): number | null {
  const g = ir.funcs[fn];
  let b = g.body;
  if (b.k === "attempt" && isLocal(b.ok, b.res)) b = b.body;
  if (g.params.length !== 2 || b.k !== "rt" || !AT.test(b.fn) || !isLocal(b.args[0], 0) || !isLocal(b.args[1], 1)) return null;
  return Number(AT.exec(b.fn)![1]);
}

export function checkedOnce(ir: CoreIR, among: number[]): number {
  let made = 0;
  for (const i of among) {
    const f = ir.funcs[i], b = f.body;
    if (b.k !== "if") continue;
    const n = atMostZero(ir, b.cond);
    if (n === null || f.params[n] !== "i64") continue;
    const selfs: (SExpr & { k: "call" })[] = [];
    let elsewhere = false;
    (function walk(e: SExpr, inElse: boolean) {
      if (e.k === "call" && e.fn === i) { if (!e.tail || !inElse) elsewhere = true; else selfs.push(e); }
      kids(e).forEach((k) => walk(k, inElse));
    })(b.then, false);
    (function walk(e: SExpr) {
      if (e.k === "call" && e.fn === i) { if (!e.tail) elsewhere = true; else selfs.push(e); }
      kids(e).forEach(walk);
    })(b.else);
    if (elsewhere || !selfs.length) continue;
    // Each input's step in every round: given as it is (0), by a literal,
    // by another input given as it is, or n's −1.
    const same = new Set(f.params.map((_, j) => j).filter((j) => selfs.every((c) => isLocal(c.args[j], j))));
    if (!selfs.every((c) => { const a = c.args[n]; return a.k === "rt" && a.fn === "i64.sub" && isLocal(a.args[0], n) && lit(a.args[1]) === 1n; })) continue;
    const step = new Map<number, SExpr>();
    for (const j of f.params.keys()) {
      if (f.params[j] !== "i64" || j === n) continue;
      if (same.has(j)) { step.set(j, { k: "rt", fn: "i64.lit", args: [{ k: "int", v: 0n }] }); continue; }
      const by = (c: SExpr & { k: "call" }): SExpr | null => {
        const a = c.args[j];
        if (a.k !== "rt" || a.fn !== "i64.add" || !isLocal(a.args[0], j)) return null;
        const s = a.args[1];
        if (lit(s) !== null) return { k: "rt", fn: "i64.lit", args: [{ k: "int", v: lit(s)! }] };
        return isLocal(s) && same.has(s.i) && f.params[s.i] === "i64" ? s : null;
      };
      const s0 = by(selfs[0]);
      if (s0 && selfs.every((c) => JSON.stringify(by(c), (_, v) => (typeof v === "bigint" ? `${v}` : v)) === JSON.stringify(s0, (_, v) => (typeof v === "bigint" ? `${v}` : v)))) step.set(j, s0);
    }
    // The reads in the else: an array given as it is, at a stepped index.
    const reads = new Map<string, [number, number, number]>();
    const isRead = (e: SExpr): [number, number, number] | null => {
      if (e.k !== "call" || e.tail) return null;
      const k = readOf(ir, e.fn), [a, p] = e.args;
      if (k === null || !isLocal(a) || a.i >= f.params.length || !same.has(a.i)) return null;
      if (!(p.k === "rt" && p.fn === "i64.box" && isLocal(p.args[0]) && step.has(p.args[0].i))) return null;
      return [k, a.i, (p.args[0] as Local).i];
    };
    (function walk(e: SExpr) { const r = isRead(e); if (r) reads.set(`${r[1]} ${r[2]}`, r); kids(e).forEach(walk); })(b.else);
    if (!reads.size) continue;
    // The copy: the else's reads unchecked, going round in itself.
    const g = ir.funcs.length;
    const rw = (e: SExpr): SExpr => {
      const r = isRead(e);
      if (r) return { k: "rt", fn: `array.get.a${r[0]}`, args: (e as SExpr & { k: "call" }).args };
      if (e.k === "call" && e.fn === i) return { ...e, fn: g, args: e.args.map(rw) };
      return mapKids(e, rw);
    };
    // Kept apart: put into its caller, gcc kept the walk's sum in memory,
    // a store and a load a round (mnist slower than with the checks).
    const copy: SFunc = { ...f, name: `${f.name} in range`, inner: true, apart: true, body: { ...b, else: rw(b.else) } };
    ir.funcs.push(copy);
    // As written: to the copy when n ≤ 0 or every walk is in range.
    const cond = [...reads.values()].map(([, a, p]): SExpr => ({ k: "rt", fn: "i64.walkIn", args: [{ k: "local", i: a }, { k: "local", i: p }, step.get(p)!, { k: "local", i: n }] })).reduce((x, y) => ({ k: "op", op: "and", args: [x, y] }));
    const go: SExpr = { k: "call", fn: g, tail: true, args: f.params.map((_, j): SExpr => ({ k: "local", i: j })) };
    ir.funcs[i] = { ...f, body: { k: "if", cond, then: go, else: b, t: f.result } };
    made++;
  }
  return made;
}
