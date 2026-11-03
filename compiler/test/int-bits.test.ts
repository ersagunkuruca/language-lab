// Int bits and, or and xor (C150) in WebAssembly and C: two's complement
// with ones going on forever for a negative, as int.ts has them, on
// small Ints, on ones past 64 bits and on negatives of both.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner, type Value } from "../../ters/src/lang/run.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { INT_OPS } from "../../ters/src/lang/std.ts";
import { norm } from "../../ters/src/lang/int.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, fromInt, instantiate, toInt } from "../src/wasm.ts";
import { emitC } from "../src/c.ts";
import { build, skip } from "./c-harness.ts";

const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };

function program() {
  const k = new Lang();
  const defs = {
    and: k.def("and"), or: k.def("or"), xor: k.def("xor"),
    // FNV-1a's step and a mask kept to 64 bits: what Word64 does.
    fnv: k.def("fnv"),
  };
  k.define(defs.and, k.fn(["a", "b"], (a, b) => k.call(INT_OPS.bitAnd, a, b)));
  k.define(defs.or, k.fn(["a", "b"], (a, b) => k.call(INT_OPS.bitOr, a, b)));
  k.define(defs.xor, k.fn(["a", "b"], (a, b) => k.call(INT_OPS.bitXor, a, b)));
  k.define(defs.fnv, k.fn(["h", "c"], (h, c) => k.call(INT_OPS.bitAnd,
    k.call(INT_OPS.mul, k.call(INT_OPS.bitXor, h, c), k.int(1099511628211)), k.call(INT_OPS.sub, k.call(INT_OPS.mul, k.int(4294967296), k.int(4294967296)), k.int(1)))));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), defs };
}

const ints = (() => {
  let seed = 99n;
  const next = () => (seed = (seed * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n);
  const edges = [0n, 1n, 2n ** 30n, 2n ** 31n, 2n ** 32n, 2n ** 62n, 2n ** 63n, 2n ** 64n, 2n ** 96n].flatMap((x) => [x - 1n, x, x + 1n]);
  const random = Array.from({ length: 12 }, (_, i) => { let v = 0n; for (let j = 0; j <= i % 4; j++) v = (v << 64n) | next(); return v >> (next() % 64n); });
  return [...edges, ...random].flatMap((x) => [x, -x]);
})();
const pairs = ints.flatMap((a, i) => [[a, ints[(i * 7 + 3) % ints.length]], [a, a], [a, -a], [a, -1n], [a, 0xffn]]);
const fnvs = [[14695981039346656037n, 97n], [0n, 0n], [2n ** 64n - 1n, 255n], [12345678901234567n, 33n]];

test("Int and, or and xor in WebAssembly: the evaluator's answers, small, past 64 bits and negative", async () => {
  const p = program();
  const lowered = lowerScalar(p.code, p.info, p.names, Object.values(p.defs), { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const m = emitWasm(lowered);
  assert.ok(WebAssembly.validate(m.bytes));
  const w = await instantiate(m) as unknown as Record<string, (...xs: unknown[]) => unknown>;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  for (const [name, inputs] of [["and", pairs], ["or", pairs], ["xor", pairs], ["fnv", fnvs]] as const) {
    const def = p.defs[name], f = lowered.funcs.find((g) => g.def === def)!;
    for (const [a, b] of inputs) {
      const want = BigInt(first(r.call(r.value(def), norm(a), norm(b))) as number | bigint);
      const got = fromInt(w, w[f.name](toInt(w, a), toInt(w, b)));
      assert.equal(got, want, `${name}(${a}n, ${b}n)`);
    }
  }
});

test("Int and, or and xor in C: the evaluator's answers, and every cell freed", { skip }, () => {
  const p = program();
  const lowered = lowerScalar(p.code, p.info, p.names, Object.values(p.defs), { data: true });
  assert.deepEqual([...emitC(lowered).refused.entries()], []);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const calls: [number, Value[]][] = [];
  for (const [name, inputs] of [["and", pairs], ["or", pairs], ["xor", pairs], ["fnv", fnvs]] as const) {
    const i = lowered.funcs.findIndex((g) => g.def === p.defs[name]);
    for (const [a, b] of inputs) calls.push([i, [norm(a), norm(b)]]);
  }
  const got = build(lowered)(calls);
  calls.forEach(([i, xs], k) => {
    const want = first(r.call(r.value(lowered.funcs[i].def), ...xs));
    assert.equal(String(got[k].value), String(want), `${lowered.funcs[i].name}(${xs.join(", ")})`);
    assert.equal(got[k].live, 0, `${lowered.funcs[i].name}: cells left`);
  });
});
