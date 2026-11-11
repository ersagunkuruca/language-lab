// An in-place map over columns on C's threads (BACKLOG C201, after C60's
// columns and C207e's counts). A map written into its own array
// (owned-arrays.ts mapsInPlaceCounted), its count untagged (untagged-
// ints.ts), steps from the last slot to the first, each step reading
// fields of the slot it is at and writing fields of that slot, nothing
// else: drift's step. No slot's work reads another's, so the slots may be
// shared out on the threads in runs, each run the same loop from its last
// slot to its first, writing where it is.
//
// The loop (its copy `… counted`) gets a twin taking the slot to stop at
// as its first input (the map's empty array, unread past the start); the
// loop's callers ask `par:range:<twin>` first, which runs the twin on
// the threads over runs of the slots when the array has one holder (so
// every write is in place), they are many and the threads are free, and
// gives back whether it did. Run on one thread otherwise, as before.
//
// A step qualifies when, past the count, it only names what it read and
// numbers (Float64 and Bool values, no counts to take), with operators
// that cannot stop: c.ts lends the array to every run.
import { kids, type CoreIR, type SExpr, type SFunc } from "./scalar.ts";

const COL_GET = /^array\.cget\d+\.a\d+$/, COL_SET = /^array\.cset[\d_]+\.a\d+$/;
// scalar.ts's operators that cannot stop (its sharing's PURE).
const PURE = new Set<string>(["add", "sub", "mul", "div", "neg", "sqrt", "abs", "floor", "float32", "sin", "cos", "tan", "exp", "log", "pow", "atan2", "less", "equal", "beq", "and", "or", "not", "itof"]);
const lit = (e: SExpr, v: bigint) => e.k === "rt" && e.fn === "i64.lit" && e.args[0]?.k === "int" && e.args[0].v === v;

export function parallelColumnMaps(ir: CoreIR): number {
  let made = 0;
  const n0 = ir.funcs.length;
  for (let i = 0; i < n0; i++) {
    const f = ir.funcs[i], b = f.body;
    if (f.params.length !== 4 || f.params[1] !== "i64" || b.k !== "if") continue;
    if (!(b.cond.k === "rt" && b.cond.fn === "i64.eq" && b.cond.args[0].k === "local" && b.cond.args[0].i === 1 && lit(b.cond.args[1], 0n))) continue;
    if (b.then.k !== "local" || b.then.i !== 2) continue;
    const s = b.else;
    if (s.k !== "let" || !(s.value.k === "rt" && s.value.fn === "i64.sub" && s.value.args[0].k === "local" && s.value.args[0].i === 1 && lit(s.value.args[1], 1n))) continue;
    const j = s.i, again = s.body;
    if (again.k !== "call" || again.fn !== i || !again.tail) continue;
    const [a0, a1, a2, a3] = again.args;
    if (a0.k !== "local" || a0.i !== 0 || a1.k !== "local" || a1.i !== j || a3.k !== "local" || a3.i !== 3) continue;
    // The step: lets of reads of slot j and of plain values, then a write
    // of slot j.
    const at = (e: SExpr) => e.k === "rt" && e.fn === "i64.box" && e.args[0].k === "local" && e.args[0].i === j;
    const bound = new Set<number>();
    const plain = (i: number) => f.locals[i] === "f64" || f.locals[i] === "i32";
    const value = (e: SExpr): boolean => {
      if (e.k === "num" || e.k === "bool") return true;
      if (e.k === "local") return bound.has(e.i);
      if (e.k === "op") return PURE.has(e.op) && e.args.every(value);
      if (e.k === "rt" && COL_GET.test(e.fn)) return e.args.length === 2 && e.args[0].k === "local" && e.args[0].i === 2 && at(e.args[1]);
      return false;
    };
    const step = (e: SExpr): boolean => {
      if (e.k === "let") {
        if (!plain(e.i) || !value(e.value)) return false;
        bound.add(e.i);
        return step(e.body);
      }
      return e.k === "rt" && COL_SET.test(e.fn) && e.args[0].k === "local" && e.args[0].i === 2 && at(e.args[1]) && e.args.slice(2).every(value);
    };
    if (!step(a2)) continue;
    // Nothing in it names the inputs it is not given.
    const names = (e: SExpr): boolean => (e.k === "local" && (e.i === 0 || e.i === 3)) || kids(e).some(names);
    if (names(a2)) continue;
    const g = ir.funcs.length;
    const twin: SFunc = {
      ...f,
      name: `${f.name} run`,
      inner: true,
      params: ["i64", "i64", f.params[2], "i64"],
      locals: f.locals.map((t, k) => (k === 0 || k === 3 ? "i64" : t)),
      body: { ...b, cond: { k: "rt", fn: "i64.eq", args: [{ k: "local", i: 1 }, { k: "local", i: 0 }] }, else: { ...s, body: { ...again, fn: g } } },
    };
    ir.funcs.push(twin);
    // Asked once on the way in, not at each step: the loop's callers go
    // through a door that asks.
    const door: SFunc = { ...f, name: `${f.name} shared`, inner: true, locals: [...f.params], body: { k: "if", cond: { k: "rt", fn: `par:range:${g}`, args: [{ k: "local", i: 1 }, { k: "local", i: 2 }], host: { t: "i32", partial: false } }, then: { k: "local", i: 2 }, else: { k: "call", fn: i, tail: true, args: f.params.map((_, k): SExpr => ({ k: "local", i: k })) }, t: f.result } };
    const w = ir.funcs.push(door) - 1;
    for (let k = 0; k < n0; k++) {
      if (k === i) continue;
      const walk = (e: SExpr) => { if (e.k === "call" && e.fn === i) e.fn = w; kids(e).forEach(walk); };
      walk(ir.funcs[k].body);
    }
    made++;
  }
  return made;
}
