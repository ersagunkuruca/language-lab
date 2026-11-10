// A loop's Ints kept untagged (BACKLOG C207e, on C). A function that calls
// itself last is a loop in C (`for (;;)`), and an Int it counts with is a
// tagged lab_int: each step tests the tag, untags, checks the range and
// tags again, and counts and drops what it keeps. Here such a function gets
// a copy whose counting Ints are plain int64_ts: a parameter every call of
// itself gives back a count (one of these, or a small literal), and a let
// that adds or takes a small literal from one. The function as written
// goes to the copy when those inputs are small Ints (as nearly every count
// is), and runs as before otherwise.
//
// In the copy a count is compared, added to and made a Float64 as it is;
// anywhere else it is tagged where it is used (LAB_SMALL, cheap, as it is
// always in the small range). Counting past the small range (2^62, after
// some 2^62 steps of a small literal) stops with a reason rather than
// growing into a big Int: that many steps never finish in practice.
//
// The ops (c.ts prints them inline; wasm-rt.ts knows only their shapes):
// i64.eq, i64.less, i64.add, i64.sub and i64.toNumber on counts and small
// literals; i64.box (a count as an Int), i64.small (an Int is small),
// i64.unbox (a small Int's count) and i64.lit (a literal as a count).
import { kids, mapKids, type CoreIR, type SExpr, type SFunc } from "./scalar.ts";

const SMALL = 1n << 61n;
const small = (e: SExpr) => e.k === "int" && e.v > -SMALL && e.v < SMALL;
const STEP = new Set(["int.add", "int.sub"]);
const COMPARE: Record<string, string> = { "int.equal": "i64.eq", "int.less": "i64.less" };

export function untaggedLoops(ir: CoreIR): number {
  const n0 = ir.funcs.length;
  let made = 0;
  for (let i = 0; i < n0; i++) {
    const f = ir.funcs[i];
    const calls: (SExpr & { k: "call" })[] = [];
    let other = false;
    (function walk(e: SExpr) {
      if (e.k === "call" && e.fn === i) { if (e.tail) calls.push(e); else other = true; }
      kids(e).forEach(walk);
    })(f.body);
    if (!calls.length || other) continue;
    // The counts: parameters, then the lets stepping one of them.
    let params = new Set(f.params.flatMap((t, j) => (t === "int" ? [j] : [])));
    let counts = new Set<number>();
    for (;;) {
      const all = () => new Set([...params, ...counts]);
      counts = new Set();
      const ok = (e: SExpr) => small(e) || (e.k === "local" && (params.has(e.i) || counts.has(e.i)));
      (function walk(e: SExpr) {
        if (e.k === "let" && e.value.k === "rt" && STEP.has(e.value.fn) && e.value.args.length === 2 && e.value.args.every(ok) && e.value.args.some((a) => a.k === "local")) counts.add(e.i);
        kids(e).forEach(walk);
      })(f.body);
      const keep = new Set([...params].filter((j) => calls.every((c) => { const a = c.args[j]; return small(a) || (a.k === "local" && all().has(a.i)); })));
      if (keep.size === params.size) break;
      params = keep;
    }
    // Worth it only where a count is stepped.
    if (!params.size || !counts.size) continue;
    const w = new Set([...params, ...counts]);
    const raw = (e: SExpr): SExpr => (e.k === "local" && w.has(e.i) ? e : small(e) ? { k: "rt", fn: "i64.lit", args: [e] } : rw(e));
    const isCount = (e: SExpr) => e.k === "local" && w.has(e.i);
    const g = ir.funcs.length;
    const rw = (e: SExpr): SExpr => {
      if (e.k === "local" && w.has(e.i)) return { k: "rt", fn: "i64.box", args: [e] };
      if (e.k === "rt" && COMPARE[e.fn] && e.args.length === 2 && e.args.some(isCount) && e.args.every((a) => isCount(a) || small(a))) return { k: "rt", fn: COMPARE[e.fn], args: e.args.map((a) => (isCount(a) ? a : { k: "rt", fn: "i64.lit", args: [a] })) };
      if (e.k === "rt" && e.fn === "int.toNumber" && isCount(e.args[0])) return { k: "rt", fn: "i64.toNumber", args: [e.args[0]] };
      if (e.k === "let" && counts.has(e.i) && e.value.k === "rt") return { ...e, value: { k: "rt", fn: e.value.fn === "int.add" ? "i64.add" : "i64.sub", args: e.value.args.map(raw) }, body: rw(e.body) };
      if (e.k === "call" && e.fn === i && e.tail) return { ...e, fn: g, args: e.args.map((a, j) => (params.has(j) ? raw(a) : rw(a))) };
      return mapKids(e, rw);
    };
    const copy: SFunc = { ...f, name: `${f.name} counted`, inner: true, params: f.params.map((t, j) => (params.has(j) ? "i64" : t)), locals: f.locals.map((t, j) => (w.has(j) ? "i64" : t)), body: rw(f.body) };
    ir.funcs.push(copy);
    // As written: to the copy when the counts given are small.
    const ps = [...params];
    const cond = ps.map((j): SExpr => ({ k: "rt", fn: "i64.small", args: [{ k: "local", i: j }] })).reduce((a, b) => ({ k: "op", op: "and", args: [a, b] }));
    const go: SExpr = { k: "call", fn: g, tail: true, args: f.params.map((_, j): SExpr => (params.has(j) ? { k: "rt", fn: "i64.unbox", args: [{ k: "local", i: j }] } : { k: "local", i: j })) };
    ir.funcs[i] = { ...f, body: { k: "if", cond, then: go, else: f.body, t: f.result } };
    made++;
  }
  return made;
}
