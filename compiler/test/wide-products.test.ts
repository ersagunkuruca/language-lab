// A product shifted down by a literal is one call on WebAssembly and C
// (wide-products.ts, L89): the 128-bit product of two Ints that fit 64
// bits, shifted, or the product and the shift past them. The evaluator's
// answers on small Ints, ones near 2⁶³, past 64 bits and negative; and
// the product alone, an i64's where it fits one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner, type Value } from "../../ters/src/lang/run.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { INT_OPS } from "../../ters/src/lang/std.ts";
import { norm } from "../../ters/src/lang/int.ts";
import { kids, lowerScalar, type SExpr } from "../src/scalar.ts";
import { emitWasm, fromInt, instantiate, toInt } from "../src/wasm.ts";
import { build, skip } from "./c-harness.ts";

const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };
const SHIFTS = [0, 1, 31, 32, 33, 62, 63];

function program() {
  const k = new Lang();
  const defs = SHIFTS.map((n) => k.def(`times${n}`));
  defs.forEach((d, i) => k.define(d, k.fn(["a", "b"], (a, b) => k.call(INT_OPS.shiftDown, k.call(INT_OPS.mul, a, b), k.int(SHIFTS[i])))));
  // And the product alone, which takes an i64's when it fits one.
  const times = k.def("times");
  k.define(times, k.fn(["a", "b"], (a, b) => k.call(INT_OPS.mul, a, b)));
  defs.push(times);
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), defs };
}

const ints = (() => {
  const edges = [0n, 1n, 2n ** 30n, 2n ** 31n, 2n ** 32n, 2n ** 33n, 2n ** 62n, 2n ** 63n, 2n ** 64n, 2n ** 96n].flatMap((x) => [x - 1n, x, x + 1n]);
  const odd = [3n, 6442450944n, 123456789012345n, 3037000499n, 0x5555555555555555n];
  return [...edges, ...odd].flatMap((x) => [x, -x]);
})();
const pairs = ints.flatMap((a, i) => [[a, ints[(i * 7 + 3) % ints.length]], [a, a], [a, -a], [a, -1n], [a, 3n]]);
const uses = (e: SExpr, fn: string): boolean => (e.k === "rt" && e.fn === fn) || kids(e).some((x) => uses(x, fn));

test("a product shifted down in WebAssembly: one call, the evaluator's answers", async () => {
  const p = program();
  const lowered = lowerScalar(p.code, p.info, p.names, p.defs, { data: true });
  assert.ok(lowered.funcs.filter((f) => f.name !== "times").every((f) => uses(f.body, "int.mulShift") && !uses(f.body, "int.mul")));
  const m = emitWasm(lowered);
  assert.ok(WebAssembly.validate(m.bytes));
  const w = await instantiate(m) as unknown as Record<string, (...xs: unknown[]) => unknown>;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  p.defs.forEach((def) => {
    const f = lowered.funcs.find((g) => g.def === def)!;
    for (const [a, b] of pairs) {
      const want = BigInt(first(r.call(r.value(def), norm(a), norm(b))) as number | bigint);
      assert.equal(fromInt(w, w[f.name](toInt(w, a), toInt(w, b))), want, `${f.name}(${a}n, ${b}n)`);
    }
  });
});

test("a product shifted down in C: the evaluator's answers, and every cell freed", { skip }, () => {
  const p = program();
  const lowered = lowerScalar(p.code, p.info, p.names, p.defs, { data: true });
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const calls: [number, Value[]][] = [];
  p.defs.forEach((def) => { const i = lowered.funcs.findIndex((g) => g.def === def); for (const [a, b] of pairs) calls.push([i, [norm(a), norm(b)]]); });
  const got = build(lowered)(calls);
  calls.forEach(([i, xs], k) => {
    assert.equal(String(got[k].value), String(first(r.call(r.value(lowered.funcs[i].def), ...xs))), `${lowered.funcs[i].name}(${xs.join(", ")})`);
    assert.equal(got[k].live, 0, `${lowered.funcs[i].name}: cells left`);
  });
});
