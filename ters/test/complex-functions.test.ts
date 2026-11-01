// What Float64 has no answer for, on Complex (BACKLOG L127): principal
// values, a branch cut's points taken from above, against the numbers C99
// (and Python's cmath) give for a +0 imaginary part.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { makeRunner } from "../src/lang/run.ts";
import { COMPLEX_V, S } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;
const PI = Math.PI, ACOSH2 = Math.acosh(2);

// Each case: the function, its inputs as [re, im] pairs, and [re, im] or "none".
const CASES: [string, [number, number][], [number, number] | "none"][] = [
  ["complex sqrt", [[-4, 0]], [0, 2]],
  ["complex sqrt", [[4, 0]], [2, 0]],
  ["complex sqrt", [[0, 2]], [1, 1]],
  ["complex sqrt", [[-4, -1e-300]], [0, -2]],
  ["complex log", [[-1, 0]], [0, PI]],
  ["complex log", [[Math.E, 0]], [1, 0]],
  ["complex log", [[0, 0]], "none"],
  ["complex power", [[-8, 0], [1 / 3, 0]], [1, Math.sqrt(3)]],
  ["complex power", [[0, 1], [0, 1]], [Math.exp(-PI / 2), 0]],
  ["complex power", [[0, 0], [2, 0]], [0, 0]],
  ["complex power", [[0, 0], [-1, 0]], "none"],
  ["complex asin", [[2, 0]], [PI / 2, ACOSH2]],
  ["complex asin", [[-2, 0]], [-PI / 2, ACOSH2]],
  ["complex asin", [[0.5, 0]], [PI / 6, 0]],
  ["complex asin", [[0, 1e10]], [0, Math.asinh(1e10)]],
  ["complex asin", [[-1e10, 0]], [-PI / 2, Math.acosh(1e10)]],
  ["complex acos", [[2, 0]], [0, -ACOSH2]],
  ["complex acos", [[-2, 0]], [PI, -ACOSH2]],
  ["complex acos", [[0.5, 0]], [PI / 3, 0]],
];

test("complex sqrt, log, power, asin and acos give the principal values", () => {
  const k = new Lang(LIBRARY.code);
  const defs = CASES.map(([name, inputs], i) => {
    const d = k.def(`case ${i}`);
    k.define(d, k.thunk(() => k.call(S.optional, k.thunk(() => k.call(lib(name), ...inputs.map(([re, im]) => k.call(COMPLEX_V, k.lit(re), k.lit(im))))))));
    return d;
  });
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  CASES.forEach(([name, inputs, want], i) => {
    const got = [...r.call(r.value(defs[i]))][0] as { tag: string; fields: { fields: number[] }[] };
    const label = `${name}(${inputs.map(([a, b]) => `${a} + ${b}i`).join(", ")})`;
    if (want === "none") return assert.match(got.tag, /none$/, label);
    const [re, im] = got.fields[0].fields;
    assert.ok(Math.abs(re - want[0]) < 1e-9 * (1 + Math.abs(want[0])) && Math.abs(im - want[1]) < 1e-9 * (1 + Math.abs(want[1])), `${label}: ${re} + ${im}i, want ${want[0]} + ${want[1]}i`);
  });
});

test("√, asin and acos always answer on Complex; log and power only away from 0", () => {
  const code = base(LIBRARY.code), names = baseNames(LIBRARY.names), info = infer(code, names);
  const type = (n: string) => showType(info.typeOf.get(lib(n))!, names);
  assert.deepEqual(["complex sqrt", "complex asin", "complex acos", "complex log", "complex power"].map(type), [
    "(Complex) -> Complex", "(Complex) -> Complex", "(Complex) -> Complex", "(Complex) -[Choice]-> Complex", "(Complex, Complex) -[Choice]-> Complex",
  ]);
});
