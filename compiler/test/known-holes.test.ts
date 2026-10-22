// Holes in the compiler found by projectional/REVIEW-2026-10-22b.md, as todo
// tests: they run, fail today, and don't fail the suite. When a fix lands,
// drop the todo and the test guards it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../projectional/src/lang/dsl.ts";
import { base, baseNames } from "../../projectional/src/lang/load.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { DIVERGE } from "../../projectional/src/lang/types.ts";
import { B } from "../../projectional/src/prelude.ts";
import { S } from "../../projectional/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWgsl } from "../src/wgsl.ts";

// The shader preview froze the browser: raymarch's `shadow` is a loop with
// no step limit, typed Diverge, and the scalar profile lets Diverge through
// ("it just runs"). On a GPU a loop that doesn't end hangs the page or
// resets the device. The type already knew; the profile didn't ask.
test("R2 §1.1 the shader profile refuses a loop it can't see end", { todo: "scalar.ts filters Diverge out of the row" }, () => {
  const k = new Lang();
  const spin = k.def("spin");
  // spin(x) = if x < 0 then x else spin(x + 1): never ends for x ≥ 0
  k.define(spin, k.fn(["x"], (x) => k.if(k.call(S.less, x, k.lit(0)), x, k.call(spin, k.call(B.add, x, k.lit(1))))));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  const t = info.typeOf.get(spin);
  assert.ok(t?.t === "fn" && t.eff.effs.includes(DIVERGE));
  const s = emitWgsl(lowerScalar(code, info, names, [spin]));
  assert.ok(s.refused.has(spin), "a loop typed Diverge is printed as a WGSL loop with no bound");
});
