// inverse(f, y) and conjugate(f, g) of a named f compile to a solve on f
// (src/inverses.ts): the evaluator's answers. An f known only at run time
// goes to the interpreter (checked on the evaluator here).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Aborted, close, makeRunner, type Value } from "../../ters/src/lang/run.ts";
import type { Id } from "../../ters/src/model.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { S } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { compiledDefs } from "../src/core-js.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

test("inverse and conjugate of a named function: the evaluator's answers, as plain arithmetic", async () => {
  const k = new Lang(LIBRARY.code);
  const n = (v: number) => k.lit(v);
  const fns: Record<string, (x: Id) => Id> = {
    // atanh with x once; a 2.2 power; a line
    saturation: (x) => k.call(B.div, k.call(B.log, k.call(B.sub, k.call(B.div, n(2), k.call(B.sub, n(1), x)), n(1))), n(2)),
    light: (x) => k.call(B.pow, x, n(2.2)),
    line: (x) => k.call(B.add, k.call(B.mul, n(3), x), n(1)),
  };
  const exports: string[] = [];
  for (const [name, body] of Object.entries(fns)) {
    const f = k.def(name);
    k.define(f, k.fn(["x"], body));
    k.define(k.def(`back ${name}`), k.fn(["y"], (y) => k.call(S.first, k.thunk(() => k.call(lib("inverse"), f, y)), k.thunk(() => n(-1)))));
    k.define(k.def(`doubled in ${name}`), k.fn(["x"], (x) => k.call(S.first, k.thunk(() => k.call(k.call(lib("conjugate"), f, k.fn(["y"], (y) => k.call(B.mul, n(2), y))), x)), k.thunk(() => x))));
    exports.push(`back ${name}`, `doubled in ${name}`);
  }
  // A function only known when called: the interpreter's.
  k.define(k.def("back of"), k.fn(["h", "y"], (h, y) => k.call(S.first, k.thunk(() => k.call(lib("inverse"), h, y)), k.thunk(() => n(-1)))));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const defs = compiledDefs(code, info, names, exports) as Record<string, (...a: unknown[]) => unknown>;
  const r = makeRunner(code, info, { print: () => {} });
  const ev = (name: string, ...args: Value[]) => [...r.call(r.value(Object.keys(names).find((d) => names[d] === name && code.nodes[d]?.kind === "def")!), ...args)][0];
  // The same numbers as the language compares them (within 1e-9): the
  // interpreter solves with fractions, the plan with floats.
  for (const name of exports) for (const v of [0, 0.25, -0.5, 0.9, 3, -7]) {
    // A stop (L125c, the log of 0 or less) is an Abort with its reason, on both.
    const said = (run: () => unknown) => { try { return run(); } catch (e) { if (e instanceof Aborted) return `stops: ${e.reason}`; throw e; } };
    // A def with a Choice (L125b) gives a stream: its first answer.
    const first = (x: unknown) => (x && typeof (x as { next?: unknown }).next === "function" ? [...(x as Iterable<unknown>)][0] : x);
    const [got, want] = [said(() => first(defs[name](v))), said(() => ev(name, v))];
    // No answer in the evaluator is, for now, a stop with its reason in compiled JS (L125c3).
    if (typeof got === "string" && /^stops: .* has no answer$/.test(got) && typeof want !== "string") continue;
    assert.ok(typeof got === "number" && typeof want === "number" ? close(got, want) : got === want, `${name}(${v}): ${got} against ${want}`);
  }
  const line = r.value(Object.keys(names).find((d) => names[d] === "line" && code.nodes[d]?.kind === "def")!);
  assert.equal(ev("back of", line, 7), 2);
});

// conjugate((q) ↦ F(c, q), g), F with one answer back (examples/conjugate's
// quarter turn about): a solve on F given c, for every target, where
// before the interpreter ran `applied` with a function known only then.
test("conjugate of a function written in place: a solve on the function it calls", async () => {
  const { expandInverses } = await import("../src/inverses.ts");
  const k = new Lang(LIBRARY.code);
  const n = (v: number) => k.lit(v);
  const shifted = k.def("shifted");
  k.define(shifted, k.fn(["c", "x"], (c, x) => k.call(B.mul, n(3), k.call(B.sub, x, c))));
  k.define(k.def("doubled about"), k.fn(["c", "x"], (c, x) =>
    k.call(S.first, k.thunk(() => k.call(k.call(lib("conjugate"), k.fn(["q"], (q) => k.call(shifted, c, q)), k.fn(["y"], (y) => k.call(B.mul, n(2), y))), x)), k.thunk(() => x))));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  // The conjugate opened up, and the inverse inside it a solve on shifted.
  assert.equal(expandInverses(code, names).expanded.filter((x) => !LIBRARY.code.nodes[x]).length, 2);
  const defs = compiledDefs(code, info, names, ["doubled about"]) as Record<string, (...a: unknown[]) => unknown>;
  const r = makeRunner(code, info, { print: () => {} });
  const d = Object.keys(names).find((x) => names[x] === "doubled about" && code.nodes[x]?.kind === "def")!;
  for (const [c, x] of [[2, 3], [-1, 0.5], [0, 7]]) {
    const want = [...r.call(r.value(d), c, x)][0] as number;
    assert.ok(close(defs["doubled about"](c, x) as number, want), `doubled about(${c}, ${x})`);
    assert.ok(close(want, 2 * x - c), `doubled about(${c}, ${x}) = ${want}`);
  }
});
