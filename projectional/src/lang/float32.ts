// Float32: Float64, with every job rounded to the nearest binary32 value, as
// a GPU computes (NUMBERS.md, "Float32"). An approximate representation:
// the representing type is Float64 itself and `meaning` is the identity,
// since every f32 value is a Float64. Each job is an ordinary definition,
// `x op y` rounded by `round to Float32`, made for the program that asks
// for it; literals are rounded once. So the evaluator, the compiled JS and
// the CPU fallback for pictures give the GPU's answers for + − × and
// comparisons, and close ones where WGSL's own bounds are loose (÷, sqrt,
// sin …).

import { merge, type Code, type Id } from "../model.ts";
import type { Names } from "../presentation.ts";
import { B } from "../prelude.ts";
import { Lang } from "./dsl.ts";
import type { Representation } from "./represent.ts";
import { S } from "./std.ts";
import { NUMBER } from "./types.ts";
import { infer } from "./infer.ts";
import { resolveArithmetic, usesGenericArithmetic } from "./arith.ts";

// The Float64 builtins whose answer on f32 inputs may not be an f32, with
// how many inputs each takes. negate, abs and floor of an f32 are f32
// already, so they keep their own definitions.
export const ROUNDED: [Id, number][] = [
  [B.add, 2], [B.sub, 2], [B.mul, 2], [B.div, 2], [B.sqrt, 1], [B.pow, 2],
  [B.sin, 1], [B.cos, 1], [B.tan, 1], [B.atan2, 2], [B.exp, 1], [B.log, 1], [S.mod, 2],
];

// The program with Float32's jobs added, and the representation that uses
// them (give it to `represent`).
export function withFloat32(code: Code, names: Names): { code: Code; names: Names; rep: Representation } {
  // The one generic + − · first made each type's own (arith.ts), so the
  // ones at Float64 are Float64's builtins and get rounded below.
  if (usesGenericArithmetic(code)) ({ code, names } = resolveArithmetic(code, infer(code, names), names));
  const k = new Lang();
  const impl: Record<Id, Id> = {};
  for (const [op, n] of ROUNDED) {
    const d = k.def(`${names[op] ?? op} in Float32`);
    k.define(d, k.fn(["a", "b"].slice(0, n), (...xs) => k.call(S.float32, k.call(op, ...xs))));
    impl[op] = d;
  }
  const cost = Object.fromEntries([...Object.keys(impl), "space"].map((j) => [j, "1"]));
  return {
    code: merge(code, k.code),
    names: { ...names, ...k.names },
    rep: { name: "Float32", of: NUMBER, type: NUMBER, meaning: null, canonical: true, approximate: true, literal: S.float32, impl, cost },
  };
}
