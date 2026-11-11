// A loop folding a Bool with `and` stops once it's false (C207m): queens'
// `safe` goes on through every queen placed after one already attacks,
// where hand-written C returns at that one. Where a loop's every round
// passes on its Bool input `b` as `b and …`, and every answer it gives
// is `b and …` (or `b`), its answer is false from the round `b` is false
// on, whatever the rounds after do; and where those rounds only compute
// (no stop, no failure, no call but the loop's own, no host) and count
// one step at a time to an end they can't miss but past 2^62 steps, as
// a fold over positions does, nothing but the answer could tell them
// apart. So the loop answers false there and then.
// Prior art: short-circuit evaluation of a conjunction (McCarthy's
// conditional `and`, 1960), here found in a fold the program writes with
// the strict `and`.

import { kids, type CoreIR, type SExpr, type SFunc } from "./scalar.ts";

// What a round may do and still be left out.
const OPS = new Set(["add", "sub", "mul", "div", "neg", "sqrt", "abs", "floor", "less", "equal", "and", "or", "not"]);
const RT = /^(array\.(get|getb|length)\.a\d+|i64\.(add|sub|eq|less|lit|box|unbox|small|toNumber|and|shr)|int\.(add|sub|equal|less|toNumber))$/;

export function earlyAnd(ir: CoreIR): number {
  let made = 0;
  ir.funcs.forEach((f, fi) => {
    if (f.result !== "i32" || f.partial) return;
    const calls: (SExpr & { k: "call" })[] = [], answers: SExpr[] = [];
    let ok = true;
    // The rounds: only computing, and the loop's own tail calls.
    const pure = (e: SExpr): boolean => {
      switch (e.k) {
        case "num": case "int": case "bool": case "local": return true;
        case "op": return OPS.has(e.op) && e.args.every(pure);
        case "rt": return RT.test(e.fn) && e.args.every(pure);
        case "let": return pure(e.value) && pure(e.body);
        case "if": return !e.check && pure(e.cond) && pure(e.then) && pure(e.else);
        default: return false;
      }
    };
    // The answers, at the ends of the body.
    const ends = (e: SExpr) => {
      if (!ok) return;
      if (e.k === "let") { if (!pure(e.value)) ok = false; else ends(e.body); return; }
      if (e.k === "if" && !e.check) { if (!pure(e.cond)) ok = false; else { ends(e.then); ends(e.else); } return; }
      if (e.k === "call" && e.fn === fi && e.tail && !e.cps) { if (!e.args.every(pure)) ok = false; else calls.push(e); return; }
      if (pure(e)) answers.push(e); else ok = false;
    };
    ends(f.body);
    if (!ok || !calls.length || !answers.length) return;
    const isLocal = (e: SExpr, i: number) => e.k === "local" && e.i === i;
    const conj = (e: SExpr, i: number) => isLocal(e, i) || (e.k === "op" && e.op === "and" && e.args.some((a) => isLocal(a, i)));
    const bound = new Set<number>();
    const lets = (e: SExpr) => { if (e.k === "let") bound.add(e.i); kids(e).forEach(lets); };
    lets(f.body);
    // The Bool input, and a count stepped by one to an input left as it is.
    const b = f.params.findIndex((t, i) => t === "i32" && !bound.has(i) && calls.every((c) => conj(c.args[i], i)) && answers.every((a) => conj(a, i)));
    if (b < 0 || !counted(f, fi, calls, bound)) return;
    f.body = { k: "if", cond: { k: "local", i: b }, then: f.body, else: { k: "bool", v: false }, t: "i32" };
    made++;
  });
  return made;
}

// Is there an input i and an input n left as it is, i stepped by one each
// round, and the loop over when i = n? Then it ends, or stops past 2^62.
function counted(f: SFunc, fi: number, calls: (SExpr & { k: "call" })[], bound: Set<number>): boolean {
  const lets = new Map<number, SExpr>();
  const scan = (e: SExpr) => { if (e.k === "let") lets.set(e.i, e.value); kids(e).forEach(scan); };
  scan(f.body);
  const val = (e: SExpr): SExpr => (e.k === "local" && lets.has(e.i) ? val(lets.get(e.i)!) : e);
  const one = (e: SExpr) => (e.k === "int" && e.v === 1n) || (e.k === "rt" && e.fn === "i64.lit" && one(e.args[0]));
  const step = (e: SExpr, i: number) => { const v = val(e); return v.k === "rt" && /^(int|i64)\.add$/.test(v.fn) && v.args[0].k === "local" && v.args[0].i === i && one(v.args[1]); };
  // The loop's first test: i = n, its answer on one side and the rounds on the other.
  const top = ((e: SExpr): SExpr => (e.k === "let" ? (e.body.k === "if" ? e.body : e) : e))(f.body);
  if (top.k !== "if") return false;
  const c = top.cond;
  if (c.k !== "rt" || !/^(int\.equal|i64\.eq)$/.test(c.fn) || c.args.length !== 2) return false;
  const [x, y] = c.args;
  if (x.k !== "local" || y.k !== "local" || bound.has(x.i) || bound.has(y.i)) return false;
  return calls.every((k) => step(k.args[x.i], x.i) && k.args[y.i].k === "local" && (k.args[y.i] as { i: number }).i === y.i) || calls.every((k) => step(k.args[y.i], y.i) && k.args[x.i].k === "local" && (k.args[x.i] as { i: number }).i === x.i);
}

