// Holes in the compiler found by the reviews (docs/reports/reviews/
// REVIEW-2026-10-22b.md, then REVIEW-2026-11-02b.md, "R7"), as todo tests: they run, fail today, and don't fail the suite. When a fix lands,
// drop the todo and the test guards it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { Aborted, makeRunner } from "../../ters/src/lang/run.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { DIVERGE } from "../../ters/src/lang/types.ts";
import { B } from "../../ters/src/prelude.ts";
import { ABORT_OP, S } from "../../ters/src/lang/std.ts";
import { compile } from "../src/compile.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { lowerScalar } from "../src/scalar.ts";
import { emitWgsl } from "../src/wgsl.ts";

// The shader preview froze the browser: raymarch's `shadow` is a loop with
// no step limit, typed Diverge, and the scalar profile lets Diverge through
// ("it just runs"). On a GPU a loop that doesn't end hangs the page or
// resets the device. The type already knew; the profile didn't ask.
test("R2 §1.1 the shader profile refuses a loop it can't see end", () => {
  const k = new Lang();
  const spin = k.def("spin");
  // spin(x) = if x < 0 then x else spin(x + 1): never ends for x ≥ 0
  k.define(spin, k.fn(["x"], (x) => k.if(k.call(S.less, x, k.lit(0)), x, k.call(spin, k.call(B.add, x, k.lit(1))))));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  const t = info.typeOf.get(spin);
  assert.ok(t?.t === "fn" && t.eff.effs.includes(DIVERGE));
  const s = emitWgsl(lowerScalar(code, info, names, [spin]));
  assert.match(s.refused.get(spin) ?? "", /^may not finish \(its type has Diverge\)/, "a loop typed Diverge is printed as a WGSL loop with no bound");
});

// A Float64 overflow is checked late in compiled code (FLOAT-VALUES-2026-11-01.md
// §2: "pure code can't observe the difference between failed at the
// multiply and failed at the compare after it"). A handler of Abort can:
// the evaluator stops at the multiply, inside the handler, which answers 0;
// compiled JavaScript lets the ∞ out of the handler and stops at the show
// outside it, where nothing handles it.
test("R7 §1 an overflow inside a handler of Abort is handled there, compiled as evaluated", { todo: "compiled code checks an overflow late, after it has left the handler" }, async () => {
  const k = new Lang();
  const caught = k.def("caught");
  // caught(a, b) = show(match a · b { abort(why) → 0 })
  k.define(caught, k.fn(["a", "b"], (a, b) => k.call(S.show, k.handle(k.call(B.mul, k.call(B.add, a, k.lit(0)), k.call(B.add, b, k.lit(0))), [{ variant: ABORT_OP, names: ["why"], body: () => k.lit(0) }]))));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const said = (f: () => unknown) => { try { return String(f()); } catch (e) { if (e instanceof Aborted) return `stops: ${e.reason}`; throw e; } };
  const r = makeRunner(code, info, { print: () => {}, names });
  const evaluated = said(() => { for (const v of r.call(r.value(caught), 1e300, 1e300)) return v; });
  assert.equal(evaluated, "0");
  const path = join(mkdtempSync(join(tmpdir(), "holes-")), "holes.js");
  writeFileSync(path, compile(code, info, names, { runtime: pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href, exports: ["caught"] }));
  const js = (await import(pathToFileURL(path).href)).defs as Record<string, (a: number, b: number) => unknown>;
  // Today: "stops: the answer is too big for a Float64 (overflow)".
  assert.equal(said(() => js.caught(1e300, 1e300)), evaluated);
});
