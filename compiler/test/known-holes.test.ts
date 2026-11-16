// Holes in the compiler found by the reviews (docs/reports/reviews/
// REVIEW-2026-10-22b.md, REVIEW-2026-11-02c.md "R8", then
// REVIEW-2026-11-16.md "R11"), as todo tests:
// they run, fail today, and don't fail the suite. When a fix lands,
// drop the todo and the test guards it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { Aborted, makeRunner } from "../../ters/src/lang/run.ts";
import { bodiesTyped, forgetLibraryChecks, infer, typedBodies } from "../../ters/src/lang/infer.ts";
import { DIVERGE } from "../../ters/src/lang/types.ts";
import { B } from "../../ters/src/prelude.ts";
import { ABORT_OP, S } from "../../ters/src/lang/std.ts";
import { Aborted as CoreAborted, Stopped, compiledDefs, reachedImplementing } from "../src/core-js.ts";
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
// Fixed by L166: an overflow is a stop no handler catches, on every engine
// (compiled code checks it late, after it may have left the handler).
test("R8 §1 an overflow inside a handler of Abort stops, compiled as evaluated", async () => {
  const k = new Lang();
  const caught = k.def("caught");
  // caught(a, b) = show(match a · b { abort(why) → 0 })
  k.define(caught, k.fn(["a", "b"], (a, b) => k.call(S.show, k.handle(k.call(B.mul, k.call(B.add, a, k.lit(0)), k.call(B.add, b, k.lit(0))), [{ variant: ABORT_OP, names: ["why"], body: () => k.lit(0) }]))));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const said = (f: () => unknown) => { try { return String(f()); } catch (e) { if (e instanceof Aborted || e instanceof CoreAborted) return `stops: ${e.reason}`; if (e instanceof Stopped) return `stops: ${e.message}`; throw e; } };
  const r = makeRunner(code, info, { print: () => {}, names });
  const evaluated = said(() => { for (const v of r.call(r.value(caught), 1e300, 1e300)) return v; });
  assert.equal(evaluated, "stops: the answer is too big for a Float64 (overflow)");
  const js = compiledDefs(code, info, names, ["caught"]) as Record<string, (a: number, b: number) => unknown>;
  assert.equal(said(() => js.caught(1e300, 1e300)), evaluated);
});

// ---------------------------------------------------------------- the eleventh review (REVIEW-2026-11-16.md)

// I193g made the check lazy: a program is checked over the library's
// skeleton, each library definition's type from its pin, no body typed
// (ters known-holes "R10 §2" guards that). Compiling the program typed them
// all anyway: the passes walked every node of the code, the library's too,
// and the first ask about any library node checked the whole library.
// I313 types a body when one of its nodes is asked for, and keeps the
// passes from asking for every one (a cold `ters run wc` 3.7 → 2.0 s). The
// lowering is given what main reaches with the implementations it may
// resolve to (core-js.ts reachedImplementing), and types only those bodies
// (I314: 21 of 760 here).
test("R11 §2 compiling a main that prints one text types only the library bodies it reaches", () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.lit("hi"))));
  const code = base(k.code), names = baseNames(k.names);
  forgetLibraryChecks();
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors, []);
  assert.ok(info.layer && !bodiesTyped(info.layer), "checked without typing the library's bodies");
  compiledDefs(code, info, names, ["main"]);
  const reached = new Set(reachedImplementing(code, [main], info).defs);
  const typed = [...typedBodies(info.layer)];
  assert.ok(typed.length > 0);
  assert.deepEqual(typed.filter((d) => !reached.has(d)).map((d) => names[d] ?? d), []);
});
