// The one ÷ (BACKLOG L155, REVIEW-2026-11-02 §6): `divide` is Division's,
// an interface like Trig, resolved by type to Float64's, Rational's,
// Complex's, Dual's, Fixed's or Algebraic's own. Int has none. Dividing by
// 0 has no answer. Evaluated and compiled.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compiledMain } from "../../compiler/src/core-js.ts";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { COMPLEX_TYPE, LIBRARY, FIXED_TYPE } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { DIVIDE, INT_OPS, S, SHOW_ANY } from "../src/lang/std.ts";
import { RATIONAL_TYPE, schemeNeeds, showType } from "../src/lang/types.ts";
const L = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;


function check(build: (k: Lang) => void) {
  const k = new Lang(LIBRARY.code);
  build(k);
  const code = base(k.code), names = baseNames(k.names);
  return { k, code, names, info: infer(code, names, undefined, checkOptions) };
}

// What main's lines print, shown: evaluated, then compiled to JS.
async function both(lines: (k: Lang, own: Record<string, Id>) => Id[], defs: (k: Lang) => Record<string, Id> = () => ({})): Promise<[string[], string[] | string]> {
  let main = "";
  const { code, names, info } = check((k) => { const own = defs(k); main = k.def("main"); k.define(main, k.thunk(() => k.seq(...lines(k, own).map((v) => k.call(S.print, k.call(SHOW_ANY, v)))))); });
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ran: string[] = [];
  runMain(code, info, main, { print: (s) => ran.push(s), names });
  // Or why the core IR doesn't compile it yet (C137's gaps).
  const compiled: string[] = [];
  try { compiledMain(code, info, names, { print: (s: string) => compiled.push(s) } as never); } catch (e) { return [ran, (e as Error).message]; }
  return [ran, compiled];
}

test("one divide at Float64, Rational, Complex and Fixed, and a definition of your own over it; by 0, no answer", async () => {
  const all = (k: Lang, f: () => string) => k.call(S.all, k.thunk(f));
  const [ran, compiled] = await both((k, own) => [
    all(k, () => k.call(DIVIDE, k.lit(3), k.lit(4))),
    all(k, () => k.call(DIVIDE, k.at(RATIONAL_TYPE, "1/2"), k.at(RATIONAL_TYPE, "3/4"))),
    all(k, () => k.call(DIVIDE, k.at(COMPLEX_TYPE, 2), k.x(L("i")))),
    all(k, () => k.call(DIVIDE, k.at(FIXED_TYPE, 1), k.at(FIXED_TYPE, 4))),
    all(k, () => k.call(own.half, k.at(RATIONAL_TYPE, "1/3"))),
    all(k, () => k.call(own.half, k.lit(5))),
    all(k, () => k.call(DIVIDE, k.lit(1), k.lit(0))),
    all(k, () => k.call(DIVIDE, k.at(RATIONAL_TYPE, 1), k.at(RATIONAL_TYPE, 0))),
  ], (k) => {
    const half = k.def("half");
    k.define(half, k.fn(["x"], (x) => k.call(DIVIDE, x, k.lit(2))));
    return { half };
  });
  const want = ["[0.75]", "[2/3]", "[0 − 2i]", "[0.25]", "[1/6]", "[2.5]", "[]", "[]"];
  assert.deepEqual(ran, want);
  // A core IR gap (C137): Rational's divide.
  assert.equal(compiled, "Rational has no Division");
});

test("divide's type says Division; Int has none", () => {
  const half = check((k) => { const d = k.def("half"); k.define(d, k.fn(["x"], (x) => k.call(DIVIDE, x, k.lit(2)))); });
  const d = half.code.defs.find((x) => half.names[x] === "half")!;
  const s = half.info.schemes.get(d)!;
  assert.equal(showType(s.type, half.names, undefined, s.subs ?? [], schemeNeeds(s)), "(a) -[Choice]-> a where a has Division");
  const int = check((k) => { const u = k.def("use"); k.define(u, k.fn(["n"], (n) => k.call(DIVIDE, k.call(INT_OPS.add, n, k.int(2)), k.int(3)))); });
  assert.deepEqual(int.info.errors.map((e) => e.message), ["Int has no divide: use quotient and remainder, or turn it into a Float64 (as float64) or a fraction (as fraction) first"]);
});
