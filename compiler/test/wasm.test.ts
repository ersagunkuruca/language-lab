// The scalar profile compiled to WebAssembly must give exactly the
// evaluator's numbers, and refuse what it can't run, with a reason.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRunner, type Value } from "../../projectional/src/lang/run.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, instantiate } from "../src/wasm.ts";
import { load } from "../src/program.ts";
import { area } from "../src/fixtures.ts";

const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };

for (const [name, expected] of [
  ["calculus", ["cubic", "wave", "kink", "bump", "cubic′", "wave′", "kink′", "bump′"]],
  ["physics", ["fall", "period"]],
] as const) {
  test(`${name}: scalar definitions compile to WebAssembly with the evaluator's exact numbers`, async () => {
    const p = load(name);
    const lowered = lowerScalar(p.code, p.info, p.pres.names, p.own.defs);
    for (const e of expected) assert.ok(lowered.funcs.some((f) => f.name === e), `${e} compiles`);
    const m = emitWasm(lowered);
    assert.ok(WebAssembly.validate(m.bytes));
    const w = await instantiate(m);
    const r = makeRunner(p.code, p.info, { print: () => {} });
    let compared = 0;
    for (const f of lowered.funcs) {
      for (const x of [-2.5, -1, 0, 0.5, 2, 3.7, 1e6]) {
        const args = f.params.map((_, i) => x + i);
        const want = first(r.call(r.value(f.def), ...args));
        const got = w[f.name](...args);
        if (f.result === "i32") assert.equal(got === 1, (want as { tag: string }).tag === "std.bool.true", `${f.name}(${args})`);
        else assert.ok(Object.is(got, want), `${f.name}(${args}): ${got} ≠ ${want}`);
        compared++;
      }
    }
    assert.ok(compared > 10);
  });
}

test("what isn't in the profile is refused, with the reason", () => {
  const p = load("calculus");
  const { refused } = lowerScalar(p.code, p.info, p.pres.names, p.own.defs);
  const why = (n: string) => refused.get(p.named(n));
  assert.match(why("sinc")!, /Choice/);
  assert.match(why("parabola")!, /calls polynomial/);
  assert.match(why("polynomial")!, /other than Number or Bool/);
});

test("tail calls are return_call: a million steps of recursion in constant stack", async () => {
  const a = area();
  const lowered = lowerScalar(a.code, a.info, a.names, [a.area]);
  assert.deepEqual([...lowered.refused.keys()], []);
  const m = emitWasm(lowered);
  assert.match(m.wat, /return_call \$area/);
  const w = await instantiate(m);
  const r = makeRunner(a.code, a.info, { print: () => {} });
  // Small enough for the evaluator: the same number, exactly.
  assert.ok(Object.is(w.area(0, 0.01, 200, 0), first(r.call(r.value(a.area), 0, 0.01, 200, 0))));
  // ∫₀² x³ − x − 1 dx = 4 − 2 − 2 = 0, in a million strips.
  assert.ok(Math.abs(w.area(0, 2e-6, 1e6, 0)) < 1e-4);
});
