// An Int's +, -, *, < or = whose inputs aren't locals or literals, given
// them as locals first (C361), so the printers' small case written out
// reaches it: the core IR's JavaScript (C359) and WebAssembly's i31s
// (C207e) inline only an operation on locals and literals. typeset's
// `offers` adds `4 · j` and `cj`, its `line ratio` sums of sums: on
// WebAssembly those were calls of the runtime's int.add, each step.
// The inputs are worked out in the order they were, the first first.

import { kids, mapKids, type CoreIR, type SExpr, type SFunc } from "./scalar.ts";

const OPS = new Set(["int.add", "int.sub", "int.mul", "int.less"]);
const plain = (e: SExpr) => e.k === "local" || e.k === "int";
// Not when an input reads an array anywhere inside (`j < length - 1`):
// the printers read those where they are, and greenhouse's walks from
// the end measured slower given them as locals.
const reads = (e: SExpr): boolean => (e.k === "rt" && e.fn.startsWith("array.")) || kids(e).some(reads);
const ours = (e: SExpr) => e.k === "rt" && OPS.has(e.fn) && e.args.length === 2 && !e.args.every(plain) && !e.args.some(reads);

export function intArgs(ir: CoreIR): number {
  let n = 0;
  for (const f of ir.funcs) {
    if (!has(f.body)) continue;
    f.body = walk(f, f.body);
  }
  return n;
  function has(e: SExpr): boolean { return ours(e) || kids(e).some(has); }
  function walk(f: SFunc, e: SExpr): SExpr {
    const mine = ours(e);
    const done = mapKids(e, (x) => walk(f, x));
    if (!mine || done.k !== "rt") return done;
    n++;
    const lets: { i: number; value: SExpr }[] = [];
    const args = done.args.map((a: SExpr) => { if (plain(a)) return a; const i = f.locals.push("int") - 1; lets.push({ i, value: a }); return { k: "local", i } as SExpr; });
    return lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), { ...done, args });
  }
}
