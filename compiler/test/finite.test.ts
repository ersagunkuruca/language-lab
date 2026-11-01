// A Float64 is finite on compiled JavaScript too (L125c,
// FLOAT-VALUES-2026-11-01.md §2): where the evaluator stops with a reason
// (run.ts finiteFloat), compiled code stops with the same one. No answer
// (x / 0, √ of a negative, log of 0, 0 to a negative power) is checked on
// the argument; an overflow is checked late, where it would otherwise
// vanish or decide something: a comparison, `show`, a divisor, `exp`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { infer } from "../../ters/src/lang/infer.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { Aborted, makeRunner } from "../../ters/src/lang/run.ts";
import { ABORT_OP, S } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import type { Id } from "../../ters/src/model.ts";
import { compile } from "../src/compile.ts";

// Each definition takes two Float64s and shows its answer.
const CASES: [string, (k: Lang, a: Id, b: Id) => Id][] = [
  ["divide", (k, a, b) => k.call(B.div, a, b)],
  ["root", (k, a) => k.call(B.sqrt, a)],
  ["log", (k, a) => k.call(B.log, a)],
  ["power", (k, a, b) => k.call(B.pow, a, b)],
  ["mod", (k, a, b) => k.call(S.mod, a, b)],
  // Overflow in a chain, seen first by show.
  ["grow", (k, a, b) => k.call(B.add, k.call(B.mul, a, b), k.lit(1))],
  // An overflow exp would turn into 0, and a divisor would turn into 0.
  ["exp", (k, a, b) => k.call(B.exp, k.call(B.neg, k.call(B.mul, a, b)))],
  ["over", (k, a, b) => k.call(B.div, k.lit(1), k.call(B.mul, a, b))],
  ["atan2", (k, a, b) => k.call(B.atan2, k.call(B.mul, a, b), k.lit(-1))],
];
// Overflow decides a comparison: the show is of a Bool, so only less sees it.
const LESS = (k: Lang, a: Id, b: Id) => k.call(S.less, k.call(B.mul, a, b), k.lit(0));

test("compiled JavaScript stops where the evaluator does, with the same reason", async () => {
  const k = new Lang();
  const defs = [...CASES.map(([name, f]): [string, Id] => {
    const d = k.def(name);
    k.define(d, k.fn(["a", "b"], (a, b) => k.call(S.show, f(k, k.call(B.add, a, k.lit(0)), k.call(B.add, b, k.lit(0))))));
    return [name, d];
  })];
  const less = k.def("less");
  k.define(less, k.fn(["a", "b"], (a, b) => k.if(LESS(k, k.call(B.add, a, k.lit(0)), k.call(B.add, b, k.lit(0))), k.lit(1), k.lit(2))));
  defs.push(["less", less]);
  // The stop is an Abort performed where the division was: a handler in
  // the program gets it, in both.
  const caught = k.def("caught");
  k.define(caught, k.fn(["a", "b"], (a, b) => k.handle(k.call(S.show, k.call(B.div, k.call(B.add, a, k.lit(0)), b)), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }])));
  defs.push(["caught", caught]);
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const path = join(mkdtempSync(join(tmpdir(), "finite-")), "finite.js");
  writeFileSync(path, compile(code, info, names, { runtime: pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href, exports: defs.map(([n]) => n) }));
  const js = (await import(pathToFileURL(path).href)).defs as Record<string, (a: number, b: number) => unknown>;
  const r = makeRunner(code, info, { print: () => {}, names });
  // What a run says: its answer, or the reason it stopped.
  const said = (f: () => unknown) => { try { return String(f()); } catch (e) { if (e instanceof Aborted) return `stops: ${e.reason}`; throw e; } };
  const evaluated = (d: Id, a: number, b: number) => said(() => { for (const v of r.call(r.value(d), a, b)) return typeof v === "object" ? JSON.stringify(v) : v; });
  const inputs = [[1, 0], [0, 0], [-4, 2], [0, -1], [-8, 0.5], [6, 4], [1e300, 1e300], [-1e300, 1e300], [2, 3], [-0, 1]];
  const stops = new Set<string>();
  for (const [name, d] of defs) for (const [a, b] of inputs) {
    const want = evaluated(d, a, b), got = said(() => { const v = js[name](a, b); return typeof v === "object" ? JSON.stringify(v) : v; });
    if (name !== "less") assert.equal(got, want, `${name}(${a}, ${b})`);
    else assert.equal(got.startsWith("stops"), want.startsWith("stops"), `${name}(${a}, ${b}): ${got} vs ${want}`);
    if (want.startsWith("stops")) stops.add(want);
  }
  assert.equal(said(() => js.caught(1, 0)), "x / 0 has no answer");
  // Every reason the evaluator gives came up, so each was compared.
  assert.deepEqual([...stops].sort(), [
    "stops: 0 to a negative power has no answer",
    "stops: a negative number to a fractional power has no answer",
    "stops: the answer is too big for a Float64 (overflow)",
    "stops: the log of 0 or less has no answer",
    "stops: the square root of a negative number has no answer",
    "stops: x / 0 has no answer",
    "stops: x mod 0 has no answer",
  ]);
});
