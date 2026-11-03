// I153: a function whose type names its effects, closed (a field's
// `step: (Int) -> Int`, which does nothing), called where the code beside it
// does more. The call made the code around it do only what the function
// does: `first(() -> remainder(step(kit)(n), 20), () -> 0)` was refused
// ("remainder performs Choice, which nothing here handles"), though first
// handles Choice. The function's row goes inside the caller's now, as a
// search's does. Found by the fuzz test (compiler/test/fuzz.test.ts, C127).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { makeRunner } from "../src/lang/run.ts";
import { INT_OPS, S } from "../src/lang/std.ts";
import { CHOICE, INT } from "../src/lang/types.ts";

function program(inner: "remainder of step" | "remainder beside step" | "step only") {
  const k = new Lang(LIBRARY.code);
  const Kit = k.type("Kit", [], [["kit", [["step", () => k.tfun([k.tref(INT)], k.tref(INT))]]]]);
  const g = k.def("g");
  k.define(g, k.fn(["n"], (n) => {
    const applied = k.call(k.call(Kit.f["kit.step"], k.call(Kit.v.kit, k.fn(["w"], (w) => k.call(INT_OPS.add, w, k.int(1))))), n);
    const body = inner === "remainder of step" ? k.call(INT_OPS.remainder, applied, k.int(20))
      : inner === "remainder beside step" ? k.call(INT_OPS.add, k.call(INT_OPS.remainder, n, k.int(20)), applied)
      : applied;
    return k.call(S.first, k.thunk(() => body), k.thunk(() => k.int(0)));
  }));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, g, info: infer(code, names, undefined, checkOptions) };
}

test("a function whose type closes its row, called beside a Choice that first handles, checks and runs (I153)", () => {
  for (const [inner, want] of [["remainder of step", 6n], ["remainder beside step", 31n], ["step only", 26n]] as const) {
    const p = program(inner);
    assert.deepEqual(p.info.errors.map((e) => e.message), [], inner);
    const r = makeRunner(p.code, p.info, { print: () => {} });
    const [got] = r.call(r.value(p.g), 25n) as Iterable<unknown>;
    assert.equal(BigInt(got as bigint), want, inner);
  }
});

test("the closed function's own effects still reach its caller (I153)", () => {
  // A field that may choose: its call outside any first leaves Choice in
  // the definition's type.
  const k = new Lang(LIBRARY.code);
  const Kit = k.type("Kit", [], [["kit", [["step", () => k.tfun([k.tref(INT)], k.tref(INT), [CHOICE])]]]]);
  const g = k.def("g");
  k.define(g, k.fn(["n"], (n) => k.call(k.call(Kit.f["kit.step"], k.call(Kit.v.kit, k.fn(["w"], (w) => k.call(INT_OPS.quotient, w, n)))), k.int(7))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const t = info.schemes.get(g)!.type;
  assert.ok(t.t === "fn" && info.subst.resolveRow(t.eff).effs.includes(CHOICE), "g has Choice");
});
