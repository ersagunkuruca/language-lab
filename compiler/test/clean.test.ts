// The solver rounds each answer to 12 digits, as +x.toPrecision(12) does;
// the compiled runtime's $clean does it without the string, and must give
// the same number every time.

import { test } from "node:test";
import assert from "node:assert/strict";
import { $clean } from "../src/runtime.js";

const slow = (x: number) => (Math.abs(x) < 1e-12 ? 0 : +x.toPrecision(12));

test("$clean is toPrecision(12), on edge values and 300,000 others", () => {
  const edges = [0, -0, 1e-12, -1e-12, 1e-13, 0.5, 1, 2, 10, 100, 1e11, 1e12, 1e21, 1e22, 1e300, -1e300, 5e-324, Infinity, -Infinity,
    0.1 + 0.2, 1 / 3, 2 / 3, 999999999999.5, 1.0000000000005, 1.00000000000049, Math.SQRT2, Math.PI, -0.30000000000000004, 123456789012.5];
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const xs = [...edges, ...Array.from({ length: 300000 }, (_, i) =>
    i % 3 === 0 ? (rnd() - 0.5) * 10 ** (rnd() * 44 - 17) : i % 3 === 1 ? Math.round(rnd() * 1e6) / 1000 : Math.tanh(rnd() * 4 - 2))];
  for (const x of xs) assert.ok(Object.is($clean(x), slow(x)) || ($clean(x) === 0 && slow(x) === 0), `${x}: ${$clean(x)} against ${slow(x)}`);
  assert.ok(Number.isNaN($clean(NaN)));
});
