// How big a list each way of running a program can take, and how long it
// takes. Run: node bench/limits.ts
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { CONS, NIL, S } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";

function sums(n: number, how: "fold" | "recursion") {
  const k = new Lang();
  const total = k.def("total");
  if (how === "fold") k.define(total, k.fn(["xs"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["h", "t"], results: [null, "r"], body: ([h], [, r]) => k.call(B.add, h, r!) },
  ])));
  else k.define(total, k.fn(["xs"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["h", "t"], body: ([h, t]) => k.call(B.add, h, k.call(total, t)) },
  ])));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(S.show, k.call(total, k.call(S.range, k.lit(n)))))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names), main };
}

for (const how of ["fold", "recursion"] as const) {
  for (const n of [1e3, 1e4, 1e5, 1e6]) {
    const p = sums(n, how);
    const t = performance.now();
    let out = "";
    try { runMain(p.code, p.info, p.main, { print: (s) => (out = s) }); } catch (e) { out = (e as Error).message.slice(0, 40); }
    console.log(`evaluator ${how.padEnd(9)} ${String(n).padStart(8)}: ${out.padEnd(16)} ${(performance.now() - t).toFixed(0)} ms`);
  }
}
