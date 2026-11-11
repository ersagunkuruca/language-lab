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
import { finiteChecks } from "./finite-checks.ts";
import { envSet } from "./zero-parts.ts";

const SMALL = 1n << 61n;
const small = (e: SExpr) => e.k === "int" && e.v > -SMALL && e.v < SMALL;
const STEP = new Set(["int.add", "int.sub"]);
const COMPARE: Record<string, string> = { "int.equal": "i64.eq", "int.less": "i64.less" };

export function untaggedLoops(ir: CoreIR): number {
  const n0 = ir.funcs.length, copies: number[] = [];
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
    if (valueLoop(ir, i)) { made++; continue; }
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
    copies.push(g);
    // As written: to the copy when the counts given are small.
    const ps = [...params];
    const cond = ps.map((j): SExpr => ({ k: "rt", fn: "i64.small", args: [{ k: "local", i: j }] })).reduce((a, b) => ({ k: "op", op: "and", args: [a, b] }));
    const go: SExpr = { k: "call", fn: g, tail: true, args: f.params.map((_, j): SExpr => (params.has(j) ? { k: "rt", fn: "i64.unbox", args: [{ k: "local", i: j }] } : { k: "local", i: j })) };
    ir.funcs[i] = { ...f, body: { k: "if", cond, then: go, else: f.body, t: f.result } };
    made++;
  }
  // A Float64 made from a count needs no overflow check (C207j).
  if (copies.length && !envSet("NO_FINITE")) finiteChecks(ir, copies);
  return made;
}

// A loop that only computes on Ints (C207i: collatz's `steps to one`,
// halving or taking 3n + 1): every input an Int, and each round only
// compares, adds, takes, multiplies, masks and shifts them before going
// round again or giving one. Its copy keeps every one of them, not only
// the counts, as an int64_t. A value that would leave the small range
// (a product past 2^62) can't be stepped there, and nothing has happened
// in the round but computing, so the round starts again with the loop as
// written (`bail`, c.ts: `goto lab_bail`), which takes the Int as big;
// a count past 2^62 is no different here.
const VALUE_FN: Record<string, string> = { "int.add": "i64.addv", "int.sub": "i64.subv", "int.mul": "i64.mulv", "int.bitAnd": "i64.and" };
class Not extends Error {}
function valueLoop(ir: CoreIR, i: number): boolean {
  const f = ir.funcs[i];
  if (!f.params.length || !f.params.every((t) => t === "int")) return false;
  const g = ir.funcs.length, locals = f.locals.map((t, j) => (j < f.params.length ? "i64" : t)), ints = new Set(f.params.map((_, j) => j));
  type Lets = [number, SExpr][];
  const wrap = (lets: Lets, e: SExpr): SExpr => lets.reduceRight<SExpr>((body, [j, value]) => ({ k: "let", i: j, value, body }), e);
  const lit = (e: SExpr): SExpr => ({ k: "rt", fn: "i64.lit", args: [e] });
  // An Int's int64_t as a local or literal, what it takes computed first.
  const atom = (e: SExpr, lets: Lets): SExpr => {
    const x = val(e, lets);
    if (x.k === "local" || (x.k === "rt" && x.fn === "i64.lit")) return x;
    locals.push("i64");
    lets.push([locals.length - 1, x]);
    return { k: "local", i: locals.length - 1 };
  };
  const own = (e: SExpr, how: (e: SExpr, lets: Lets) => SExpr): SExpr => { const lets: Lets = []; const x = how(e, lets); return wrap(lets, x); };
  const val = (e: SExpr, lets: Lets): SExpr => {
    if (e.k === "local" && ints.has(e.i)) return e;
    if (small(e)) return lit(e);
    if (e.k === "rt" && VALUE_FN[e.fn] && e.args.length === 2) return { k: "rt", fn: VALUE_FN[e.fn], args: e.args.map((a) => atom(a, lets)) };
    if (e.k === "rt" && e.fn === "int.shiftDown" && e.args.length === 2 && e.args[1].k === "int" && e.args[1].v >= 0n && e.args[1].v < 62n) return { k: "rt", fn: "i64.shr", args: [atom(e.args[0], lets), lit(e.args[1])] };
    if (e.k === "if" && e.t === "int") return { k: "if", cond: test(e.cond, lets), then: own(e.then, val), else: own(e.else, val), t: "i64" };
    if (e.k === "let" && f.locals[e.i] === "int") { ints.add(e.i); locals[e.i] = "i64"; lets.push([e.i, own(e.value, val)]); return val(e.body, lets); }
    throw new Not();
  };
  const test = (e: SExpr, lets: Lets): SExpr => {
    if (e.k === "bool") return e;
    if (e.k === "rt" && (e.fn === "int.less" || e.fn === "int.equal") && e.args.length === 2) return { k: "rt", fn: e.fn === "int.less" ? "i64.less" : "i64.eq", args: e.args.map((a) => atom(a, lets)) };
    throw new Not();
  };
  const tail = (e: SExpr): SExpr => {
    if (e.k === "if") { const lets: Lets = []; const cond = test(e.cond, lets); return wrap(lets, { ...e, cond, then: tail(e.then), else: tail(e.else) }); }
    if (e.k === "let" && f.locals[e.i] === "int") { ints.add(e.i); locals[e.i] = "i64"; return { ...e, value: own(e.value, val), body: tail(e.body) }; }
    if (e.k === "call" && e.fn === i && e.tail) { const lets: Lets = []; const args = e.args.map((a) => atom(a, lets)); return wrap(lets, { ...e, fn: g, args }); }
    if (f.result === "int") return own(e, (x, lets) => ({ k: "rt", fn: "i64.box", args: [atom(x, lets)] }));
    if (f.result === "i32") return own(e, test);
    throw new Not();
  };
  let body: SExpr;
  try { body = tail(f.body); } catch (e) { if (e instanceof Not) return false; throw e; }
  // The copy, then the loop as written that a round leaving the small
  // range starts again in, then the loop: to the copy when its inputs are
  // small.
  ir.funcs.push({ ...f, name: `${f.name} counted`, inner: true, params: f.params.map(() => "i64"), locals, body, bail: g + 1 });
  ir.funcs.push({ ...f, name: `${f.name} as written`, inner: true });
  const cond = f.params.map((_, j): SExpr => ({ k: "rt", fn: "i64.small", args: [{ k: "local", i: j }] })).reduce((a, b) => ({ k: "op", op: "and", args: [a, b] }));
  const go: SExpr = { k: "call", fn: g, tail: true, args: f.params.map((_, j): SExpr => ({ k: "rt", fn: "i64.unbox", args: [{ k: "local", i: j }] })) };
  ir.funcs[i] = { ...f, body: { k: "if", cond, then: go, else: f.body, t: f.result } };
  return true;
}
