// What a solve's written-out plan links against (relation.ts
// compileSolve): compile.ts's modules through runtime.js, and the core
// IR's printed plans through core-rt.ts (C167a), so a program whose solves
// are all written out carries the equation solver but not the evaluator
// or the program's nodes.

import { plan, stream } from '../../invertible/src/relation.js';
import { FN as $FN } from '../../invertible/src/expr.js';
export { $FN };

// A solve whose plan the compiler couldn't turn into straight-line code
// (tearing, Newton, periodic branches, a degenerate 0·x = 0 case) runs the
// solver here, with the plan worked out once when the program loads.

export function $planned(rel, known) {
  return { rel, plan: plan(rel, known) };
}

export function* $solveRuntime({ rel, plan: p }, values, binds) {
  for (const s of stream(rel, p, values)) {
    const out = binds.map((b) => s.values[b]);
    if (out.some((x) => x === null || x === undefined)) continue;
    yield out;
  }
}

// Same rounding and finiteness rules as invertible/src/relation.js, so a
// compiled solve gives exactly the numbers the solver gives.
export const $ok = Number.isFinite;
// $clean is the solver's +x.toPrecision(12), without the string: 12
// digits as a whole number n, then n over a power of ten, which division
// rounds correctly, as reading the digits back would. Where n might be a
// half away from where the product put it, or out of the powers' range,
// it asks toPrecision (the pedal's tanh was mostly this string: GAPS.md P1).
const TENS = Array.from({ length: 23 }, (_, i) => 10 ** i);
export const $clean = (x) => {
  const a = Math.abs(x);
  if (a < 1e-12) return 0;
  if (!(a < 1e22)) return +x.toPrecision(12);
  const k = 11 - Math.floor(Math.log10(a));
  if (k > 22 || k < -22) return +x.toPrecision(12);
  const t = k >= 0 ? a * TENS[k] : a / TENS[-k];
  if (Math.abs(t - Math.floor(t) - 0.5) < 1e-3 || t < 1e11 - 1 || t >= 1e12) return +x.toPrecision(12);
  const n = Math.round(t), r = k >= 0 ? n / TENS[k] : n * TENS[-k];
  return x < 0 ? -r : r;
};
export const $key = (xs) => xs.map((x) => Math.round(x * 1e8)).join();
export const $close = (l, r) => $ok(l) && $ok(r) && Math.abs(l - r) <= 1e-9 * (1 + Math.abs(l) + Math.abs(r));


// All of the above by name, for core-rt.ts's usePlans.
export const plans = { $planned, $solveRuntime, $ok, $clean, $key, $close, $FN };
